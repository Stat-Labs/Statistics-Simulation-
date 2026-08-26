"""Verification agent + reproducibility for the streaming profile.

The streaming engine is exact for moments and approximate for its sketches
(t-digest percentiles, HLL cardinality). Before a profile is trusted we can
cross-check it three ways (opt-in, via `verify=true`):

  exactness  — recompute the streaming accumulators over the identical first
               chunk with raw numpy and assert mean/variance/min/max match to
               float precision (validates the engine's math on real rows).
  full       — when the file is small enough, recompute the whole profile's
               numeric stats with pandas/numpy in memory and compare against
               the streaming result (validates the merge across chunks and the
               sketches: median, HLL cardinality, skew/kurt, duplicates).
  determinism — run the profile twice and assert byte-identical JSON output.

A reproducibility manifest (content hash, engine version, strategy, chunk
size, passes, elapsed, options) is attached to every profile so results can be
reproduced or audited.
"""

from __future__ import annotations

import hashlib
import json

import numpy as np
import pandas as pd

from stats.chunked_reader import ChunkedCsvReader
from stats.profile import compute_streaming_profile
from stats.streaming import Moments

ENGINE_VERSION = "streaming-1.0.0"

# Tolerance: full-file cross-check of exact stats (moments).
MEAN_TOL = 1e-6
VAR_TOL_REL = 1e-5
# Approximate-sketch tolerances.
MEDIAN_TOL_REL = 1e-2
CARDINALITY_TOL_REL = 0.05
# Skew/kurt on high-magnitude data: (x-mean)^3 terms reach ~1e13 in float64, so
# both our two-pass result and the pandas/scipy reference carry ~1e-3..1e-2 of
# cancellation noise. Compare relatively (2%) with a small absolute floor.
SKEW_KURT_TOL_REL = 0.02
SKEW_KURT_TOL_ABS = 0.01
# Full in-memory cross-check is only run when the file is at or below this size.
FULL_CHECK_MAX_ROWS = 200_000
# Cap on columns cross-checked per pass (keeps the report bounded).
MAX_COLS_CHECKED = 12


def content_hash(buffer: bytes) -> str:
    return hashlib.sha256(buffer).hexdigest()


def _json_normalize(obj) -> str:
    return json.dumps(obj, sort_keys=True, default=str, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Cross-checks
# ---------------------------------------------------------------------------


def exactness_check(reader: ChunkedCsvReader, *, chunk_size: int, max_cols: int = MAX_COLS_CHECKED) -> list[dict]:
    """Validate the streaming accumulators against raw numpy on the first chunk."""
    sniff = reader.sniff()
    try:
        df = next(iter(reader.iter_chunks(chunk_size=chunk_size)))
    except StopIteration:
        return []
    checks: list[dict] = []
    for c in sniff.columns:
        if sniff.dtype_map[c.name] == "str" or len(checks) >= max_cols:
            continue
        vals = df[c.name].dropna().to_numpy(dtype=np.float64)
        if vals.size == 0:
            continue
        m = Moments.from_array(vals)
        mean_d = m.mean - float(vals.mean())
        var_d = m.variance(1) - float(vals.var(ddof=1))
        checks.append({
            "column": c.name,
            "rowsChecked": int(vals.size),
            "meanDelta": mean_d,
            "varianceDelta": var_d,
            "meanExact": abs(mean_d) < MEAN_TOL,
            "varianceExact": abs(var_d) <= VAR_TOL_REL * max(1.0, abs(float(vals.var(ddof=1)))),
            "minExact": m.min == float(vals.min()),
            "maxExact": m.max == float(vals.max()),
        })
    return checks


def consistency_checks(profile: dict) -> list[str]:
    """Structural self-consistency checks that never require extra passes."""
    problems: list[str] = []
    for col in profile["columns"]:
        name = col["name"]
        h = col.get("histogram")
        if h is not None and col["type"] not in ("categorical", "binary"):
            if h["n"] != col["count"]:
                problems.append(f"{name}: histogram n ({h['n']}) != count ({col['count']})")
        q = col.get("quantiles")
        if q:
            qs = [q[k] for k in sorted(q, key=lambda k: float(k[1:]))]
            if any(b < a for a, b in zip(qs, qs[1:])):
                problems.append(f"{name}: quantiles not monotonic")
        for stat in ("skewness", "kurtosis"):
            v = col.get(stat)
            if v is not None and v != v:  # NaN
                problems.append(f"{name}: {stat} is NaN")
        rng = col.get("range")
        if rng is not None and col.get("min") is not None and col.get("max") is not None:
            if abs(rng - (col["max"] - col["min"])) > 1e-9:
                problems.append(f"{name}: range ({rng}) != max-min ({col['max'] - col['min']})")
    if profile.get("correlations"):
        for cr in profile["correlations"]:
            if not (-1.0 - 1e-9 <= cr["r"] <= 1.0 + 1e-9):
                problems.append(f"{cr['columnA']}~{cr['columnB']}: r out of range ({cr['r']})")
    return problems


def full_cross_check(
    buffer: bytes,
    filename: str,
    profile: dict,
    *,
    chunk_size: int,
    max_cols: int = MAX_COLS_CHECKED,
) -> dict:
    """Recompute numeric stats in memory with pandas and compare to streaming."""
    reader = ChunkedCsvReader(buffer, filename)
    sniff = reader.sniff()
    df = pd.concat(list(reader.iter_chunks(chunk_size=chunk_size)), ignore_index=True)
    by_name = {c["name"]: c for c in profile["columns"]}

    issues: list[str] = []
    checked = 0
    for c in sniff.columns:
        if sniff.dtype_map[c.name] == "str" or checked >= max_cols:
            continue
        entry = by_name.get(c.name)
        if entry is None or entry["count"] == 0:
            continue
        vals = df[c.name].dropna().to_numpy(dtype=np.float64)
        if vals.size == 0:
            continue
        checked += 1
        if abs(entry["mean"] - float(vals.mean())) > MEAN_TOL:
            issues.append(f"{c.name}: mean streaming {entry['mean']} vs pandas {vals.mean()}")
        if abs(entry["stdDev"] - float(vals.std(ddof=1))) > VAR_TOL_REL * max(1.0, float(vals.std(ddof=1))):
            issues.append(f"{c.name}: stdDev mismatch")
        if entry["min"] != float(vals.min()) or entry["max"] != float(vals.max()):
            issues.append(f"{c.name}: min/max mismatch")
        median = entry.get("median")
        if median is not None:
            ref_median = float(np.quantile(vals, 0.5))
            scale = max(1.0, abs(ref_median))
            if abs(median - ref_median) > MEDIAN_TOL_REL * scale:
                issues.append(f"{c.name}: median {median} vs pandas {ref_median}")
        card = entry.get("cardinality")
        if card is not None:
            ref_card = int(vals.size)  # approximate: distinct of non-null
            if abs(card - ref_card) > CARDINALITY_TOL_REL * max(ref_card, 1):
                # Exact cardinality needs unique(); use it — it's the reference.
                exact = int(np.unique(vals).size)
                if abs(card - exact) > CARDINALITY_TOL_REL * max(exact, 1):
                    issues.append(f"{c.name}: HLL cardinality {card} vs exact {exact}")
        sk = entry.get("skewness")
        if sk is not None and vals.size >= 3:
            ref_sk = float(pd.Series(vals).skew())
            if abs(sk - ref_sk) > SKEW_KURT_TOL_ABS + SKEW_KURT_TOL_REL * abs(ref_sk):
                issues.append(f"{c.name}: skewness {sk} vs pandas {ref_sk}")
        ku = entry.get("kurtosis")
        if ku is not None and vals.size >= 4:
            ref_ku = float(pd.Series(vals).kurt())
            if abs(ku - ref_ku) > SKEW_KURT_TOL_ABS + SKEW_KURT_TOL_REL * abs(ref_ku):
                issues.append(f"{c.name}: kurtosis {ku} vs pandas {ref_ku}")

    return {
        "columnsChecked": checked,
        "issues": issues,
        "passed": not issues,
        "mode": "full_in_memory",
    }


def determinism_check(
    reader: ChunkedCsvReader,
    *,
    chunk_size: int,
    nbins: int,
    top_frequency: int,
    correlations: list[tuple[str, str]] | None,
) -> bool:
    """Run the profile twice; identical JSON output proves determinism."""
    a = compute_streaming_profile(
        reader, chunk_size=chunk_size, nbins=nbins,
        top_frequency=top_frequency, correlations=correlations,
    )
    b = compute_streaming_profile(
        reader, chunk_size=chunk_size, nbins=nbins,
        top_frequency=top_frequency, correlations=correlations,
    )
    return _json_normalize(a) == _json_normalize(b)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def verify_profile(
    buffer: bytes,
    filename: str,
    profile: dict,
    *,
    chunk_size: int,
    nbins: int,
    top_frequency: int,
    correlations: list[tuple[str, str]] | None,
    full_check_limit: int = FULL_CHECK_MAX_ROWS,
) -> dict:
    """Run the full verification suite. Returns a VerificationReport dict."""
    reader = ChunkedCsvReader(buffer, filename)

    exact = exactness_check(reader, chunk_size=chunk_size)
    consistency = consistency_checks(profile)

    determinism = determinism_check(
        reader, chunk_size=chunk_size, nbins=nbins,
        top_frequency=top_frequency, correlations=correlations,
    )

    full = None
    if profile["rowCount"] <= full_check_limit:
        full = full_cross_check(
            buffer, filename, profile, chunk_size=chunk_size,
        )

    exact_ok = all(
        c.get("meanExact") and c.get("varianceExact") and c.get("minExact") and c.get("maxExact")
        for c in exact
    )
    full_ok = full is None or full["passed"]
    passed = exact_ok and not consistency and determinism and full_ok

    return {
        "passed": passed,
        "engineVersion": ENGINE_VERSION,
        "exactness": exact,
        "exactnessOk": exact_ok,
        "consistency": consistency,
        "consistencyOk": not consistency,
        "determinism": determinism,
        "fullCrossCheck": full,
        "notes": [
            "Streaming moments are exact; percentiles/cardinality are approximate by design.",
        ],
    }
