"""Full-population streaming data profile.

Runs the mergeable accumulators in `streaming.py` over two passes of the
chunked reader, so every statistic covers 100% of the data while memory stays
proportional to one chunk.

  Pass 1 (single loop over chunks):
    - Moments.from_array per numeric column (mean / variance / std / min / max)
    - TDigest per numeric column (percentiles / median / IQR)
    - FrequencyCounter per column (mode / frequency table, capped)
    - Correlation.from_arrays per requested numeric pair (streaming)
    - RowDuplicateCounter over vectorized per-row hashes
    - sample rows (first few) for the schema preview

  Pass 2 (single loop over chunks, given pass-1 means and IQR fences):
    - TwoPassCentral.from_array (EXACT skewness / kurtosis)
    - Histogram.update_many (exact equal-width bins from pass-1 min/max)
    - outlier counts inside the IQR fences
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from models import ColumnType
from stats.chunked_reader import ChunkedCsvReader
from stats.parser import (
    _name_hint, _looks_like_codes, _is_code_uncertain,
    _infer_missing_strategy, BINARY_TRUE_VALUES, BINARY_FALSE_VALUES,
)
from stats.streaming import (
    Moments, TwoPassCentral, TDigest, Histogram,
    FrequencyCounter, Correlation, RowDuplicateCounter, _scalar_key,
)

QUANTILES = (0.05, 0.25, 0.5, 0.75, 0.95)
NBINS = 20
MAX_CORR_COLS = 25
# Frequency tables are only meaningful below this cardinality; above it we skip
# counting entirely (the sniff pass already estimates cardinality via HLL).
FREQ_CARDINALITY_LIMIT = 500


@dataclass
class _Accumulators:
    """Per-column state threaded across the two passes."""
    name: str
    dtype: str  # "int" | "float" | "str"
    sniff = None  # ColumnSniff from pass 1
    moments: Moments = field(default_factory=Moments)
    tdigest: TDigest = field(default_factory=lambda: TDigest(delta=0.005))
    freq: FrequencyCounter = field(default_factory=lambda: FrequencyCounter(cap=5000))
    two_pass: TwoPassCentral | None = None  # created in pass 2 with the mean
    hist: Histogram | None = None
    outliers: int = 0


def _as_float_array(values) -> np.ndarray:
    arr = np.asarray(values, dtype=np.float64)
    return arr[~np.isnan(arr)]


def _freq_values(freq: FrequencyCounter, all_int: bool) -> set:
    out: set = set()
    for k in freq.counts:
        try:
            f = float(k)
            if all_int and f.is_integer():
                out.add(int(f))
            else:
                out.add(f)
        except (TypeError, ValueError):
            out.add(k)
    return out


def classify_column(name: str, dtype: str, unique_vals: set, n_unique: int, all_int: bool) -> ColumnType:
    """Streaming equivalent of parser._detect_column_type using accumulated stats."""
    binary_hint, ordinal_hint, cat_hint = _name_hint(name)
    if dtype == "str":
        low = {str(v).lower().strip() for v in unique_vals if v is not None}
        if 0 < len(low) <= 2 and low <= (BINARY_TRUE_VALUES | BINARY_FALSE_VALUES | {""}):
            return ColumnType.binary
        return ColumnType.categorical
    if binary_hint and n_unique == 2:
        return ColumnType.binary
    if cat_hint and not ordinal_hint:
        return ColumnType.categorical
    if ordinal_hint:
        return ColumnType.ordinal
    if n_unique == 2:
        nums = {int(v) for v in unique_vals if isinstance(v, (int, np.integer))}
        if nums <= {0, 1}:
            return ColumnType.binary
    if n_unique <= 15:
        return ColumnType.ordinal
    return ColumnType.continuous


def compute_streaming_profile(
    reader: ChunkedCsvReader,
    *,
    chunk_size: int | None = None,
    nbins: int = NBINS,
    quantiles: tuple[float, ...] = QUANTILES,
    top_frequency: int = 10,
    correlations: list[tuple[str, str]] | None = None,
    include_duplicates: bool = True,
    progress_cb=None,
) -> dict:
    """Two-pass streaming profile over the reader. Returns a plain dict.

    Correlations are computed only when explicitly requested and the number of
    numeric columns stays within MAX_CORR_COLS (keeps accumulators bounded).

    `progress_cb(progress, stage)` (optional) is invoked at pass boundaries so
    a background job can report coarse progress.
    """
    chunk_size = chunk_size or 50_000
    sniff = reader.sniff()
    if progress_cb:
        progress_cb(0.15, "sniffing")
    columns = sniff.columns

    accs: list[_Accumulators] = []
    for c in columns:
        a = _Accumulators(name=c.name, dtype=sniff.dtype_map[c.name])
        a.sniff = c
        accs.append(a)

    corr_accs: dict[tuple[str, str], Correlation] = {}
    corr_numeric = {a.name for a in accs if a.dtype != "str"}
    if correlations:
        if len(corr_numeric) <= MAX_CORR_COLS:
            for x, y in correlations:
                if x in corr_numeric and y in corr_numeric:
                    corr_accs[(x, y)] = Correlation()
        else:
            return {
                **{k: None for k in ("fileName", "rowCount", "columnCount", "columns", "sampleRows")},
                "duplicateRowCount": None,
                "duplicateCountCapped": False,
                "totalMissing": 0,
                "correlations": None,
                "error": f"Too many numeric columns ({len(corr_numeric)}) for streaming pairwise correlations; requested pairs were skipped.",
            }

    dup_counter = RowDuplicateCounter(cap=500_000) if include_duplicates else None
    sample_rows: list[dict] = []

    # ------------------- PASS 1 -------------------
    if progress_cb:
        progress_cb(0.20, "pass 1: moments, percentiles, frequencies, correlations")
    for df in reader.iter_chunks(chunk_size=chunk_size):
        if len(sample_rows) < 5:
            sample_rows.extend(df.head(5 - len(sample_rows)).to_dict(orient="records"))

        for a in accs:
            # Skip frequency counting for high-cardinality columns — the sniff
            # pass already estimated cardinality, and counting every value here
            # is the dominant cost for large numeric datasets.
            count_freq = a.sniff.hll.estimate() <= FREQ_CARDINALITY_LIMIT
            if a.dtype == "str":
                if not count_freq:
                    continue
                for v in df[a.name].fillna("").tolist():
                    if v is None or (isinstance(v, float) and np.isnan(v)):
                        a.freq.update_key("")
                    else:
                        a.freq.update_key(v)
            else:
                vals = _as_float_array(df[a.name].to_numpy())
                if len(vals):
                    a.moments.merge(Moments.from_array(vals))
                    a.tdigest.add_many(vals)
                if count_freq:
                    for v in df[a.name].tolist():
                        if isinstance(v, (float, np.floating)) and np.isnan(v):
                            continue
                        a.freq.update_key(float(v))

        for (x, y), acc in corr_accs.items():
            acc.merge(Correlation.from_arrays(df[x].to_numpy(), df[y].to_numpy()))

        if dup_counter is not None:
            hashes = pd.util.hash_pandas_object(df, index=False).to_numpy()
            for h in hashes:
                dup_counter.update(str(h))

    # ------------------- FINALIZE BOUNDS -------------------
    if progress_cb:
        progress_cb(0.62, "pass 1 done")
    for a in accs:
        if a.dtype == "str" or a.moments.n == 0:
            continue
        a.two_pass = TwoPassCentral(center=a.moments.mean)
        if a.moments.max > a.moments.min:
            a.hist = Histogram(a.moments.min, a.moments.max, nbins)
        q1 = a.tdigest.quantile(0.25)
        q3 = a.tdigest.quantile(0.75)
        if np.isnan(q1) or np.isnan(q3):
            a._fence = None  # type: ignore[attr-defined]
        else:
            a._fence = (q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1))  # type: ignore[attr-defined]

    # ------------------- PASS 2 -------------------
    if progress_cb:
        progress_cb(0.68, "pass 2: skewness, kurtosis, histograms, outliers")
    for df in reader.iter_chunks(chunk_size=chunk_size):
        for a in accs:
            if a.dtype == "str" or a.moments.n == 0:
                continue
            vals = _as_float_array(df[a.name].to_numpy())
            if len(vals) == 0:
                continue
            a.two_pass.merge(TwoPassCentral.from_array(vals, center=a.moments.mean))
            if a.hist is not None:
                a.hist.update_many(vals)
            fence = getattr(a, "_fence", None)
            if fence is not None:
                a.outliers += int(((vals < fence[0]) | (vals > fence[1])).sum())

    # ------------------- BUILD OUTPUT -------------------
    profile_columns: list[dict] = []
    total_missing = sum(c.missing for c in columns)
    for a in accs:
        c = a.sniff
        unique_vals = _freq_values(a.freq, c.all_int) if a.dtype != "str" else set(a.freq.counts)
        counted_freq = c.hll.estimate() <= FREQ_CARDINALITY_LIMIT
        n_unique = c.hll.estimate()
        if counted_freq:
            n_unique = len(unique_vals)
        col_type = classify_column(a.name, a.dtype, unique_vals, n_unique, c.all_int)

        coded = False
        code_note = None
        code_uncertain = False
        if col_type not in (ColumnType.datetime, ColumnType.categorical) and a.dtype != "str":
            if _looks_like_codes(a.name, unique_vals, c.all_int, n_unique, col_type):
                coded = True
                code_note = "Values look like discrete codes, not raw measurements."
            elif _is_code_uncertain(a.name, unique_vals, c.all_int, n_unique):
                code_uncertain = True
                coded = None

        null_pct = round(c.missing / max(c.total, 1) * 100, 2)
        mode_value = None
        if a.freq.counts:
            for k, _cnt in a.freq.top(top_frequency).items():
                if k == "" or k is None:
                    continue
                mode_value = _scalar_key(k)
                break
        entry: dict = {
            "name": a.name,
            "type": col_type.value,
            "coded": coded,
            "codeNote": code_note,
            "codeUncertain": code_uncertain,
            "count": c.count,
            "nullCount": c.missing,
            "nullPercentage": null_pct,
            "suggestedStrategy": _infer_missing_strategy(col_type, null_pct),
            "mode": mode_value,
            "cardinality": n_unique,
            "cardinalityCapped": a.freq.capped,
            "sampleValues": c.sample[:5],
        }

        if col_type in (ColumnType.continuous, ColumnType.ordinal, ColumnType.binary) and a.moments.n > 0:
            m = a.moments
            tp = a.two_pass
            entry.update({
                "mean": m.mean,
                "min": m.min,
                "max": m.max,
                "range": m.max - m.min if m.max > m.min else 0.0,
                "stdDev": m.std(),
                "variance": m.variance(),
                "median": a.tdigest.median(),
                "iqr": a.tdigest.quantile(0.75) - a.tdigest.quantile(0.25),
                "skewness": tp.skewness() if tp and tp.n >= 3 else 0.0,
                "kurtosis": tp.kurtosis() if tp and tp.n >= 4 else 0.0,
                "outlierCount": a.outliers,
                "quantiles": {f"q{int(q * 100)}": a.tdigest.quantile(q) for q in quantiles},
            })
            if a.hist is not None:
                entry["histogram"] = a.hist.to_dict()

        # Frequency table only when it is meaningful (bounded cardinality).
        if (
            counted_freq
            and (
                col_type in (ColumnType.categorical, ColumnType.binary)
                or (a.dtype != "str" and n_unique <= 15)
            )
            and a.freq.counts
        ):
            entry["frequencyTable"] = {_scalar_key(k): v for k, v in a.freq.top(top_frequency).items()}
            entry["frequencyCapped"] = a.freq.capped
            if len(unique_vals) <= 15:
                entry["uniqueValues"] = sorted(unique_vals, key=str)

        profile_columns.append(entry)

    corr_list: list[dict] | None = None
    if corr_accs:
        corr_list = []
        for (x, y), acc in corr_accs.items():
            corr_list.append({
                "columnA": x,
                "columnB": y,
                "r": acc.pearson_r(),
                "n": acc.n,
                "method": "pearson",
            })

    dup_result = dup_counter.result() if dup_counter is not None else {"duplicateCount": None, "capped": False}

    if progress_cb:
        progress_cb(1.0, "done")

    return {
        "fileName": reader.filename,
        "rowCount": sniff.row_count,
        "columnCount": len(columns),
        "columns": profile_columns,
        "sampleRows": sample_rows,
        "duplicateRowCount": dup_result["duplicateCount"],
        "duplicateCountCapped": dup_result["capped"],
        "totalMissing": total_missing,
        "correlations": corr_list,
    }
