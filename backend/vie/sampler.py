"""Visualization-ready data sampling.

The profile streams aggregates but carries no raw rows, and we must never send
millions of rows to the browser. This module makes one bounded, reservoir-
sampled pass over the CSV to produce (a) aligned scatter points for a handful
of numeric columns and (b) time-bucketed counts for date columns. Memory stays
proportional to the sample size, not the file.
"""

from __future__ import annotations

import io

import numpy as np
import pandas as pd

MAX_POINTS = 2000
CHUNK_ROWS = 50000


def sample_rows(csv_bytes: bytes, columns: list[str],
                dtypes: dict | None = None,
                max_points: int = MAX_POINTS, seed: int = 42) -> list[dict]:
    """Reservoir-sample up to `max_points` rows (aligned across columns).

    Returns a list of row dicts keyed by column name (values are native floats
    where possible). Deterministic for a fixed seed. `dtypes` is an optional
    per-column pandas dtype map (from the sniff) that skips dtype inference and
    makes the pass much faster. On any parse problem the file cannot be read
    this way and we return an empty list — the dashboard degrades gracefully.
    """
    if not columns or not csv_bytes:
        return []
    try:
        reservoir: list = [None] * max_points
        n_seen = 0
        rng = np.random.default_rng(seed)
        reader = pd.read_csv(io.BytesIO(csv_bytes), usecols=columns,
                             dtype=dtypes, chunksize=CHUNK_ROWS, low_memory=False)
        for chunk in reader:
            m = len(chunk)
            if m == 0:
                continue
            idx = np.arange(n_seen, n_seen + m)
            keep = rng.random(m) < (max_points / (idx + 1))
            if keep.any():
                vals = chunk[keep]
                slots = rng.integers(0, max_points, size=int(keep.sum()))
                for k, slot in enumerate(slots):
                    reservoir[int(slot)] = vals.iloc[k].to_dict()
            n_seen += m
        return [r for r in reservoir if r]
    except Exception:
        return []


def scatter_data(csv_bytes: bytes, numeric_names: list[str],
                 dtypes: dict | None = None,
                 max_points: int = MAX_POINTS) -> dict[str, list[float]]:
    """Extract aligned float arrays per numeric column from the sample."""
    rows = sample_rows(csv_bytes, numeric_names, dtypes=dtypes, max_points=max_points)
    out: dict[str, list[float]] = {}
    for name in numeric_names:
        out[name] = [r[name] for r in rows
                     if isinstance(r.get(name), (int, float, np.number))]
    return out


def date_buckets(csv_bytes: bytes, date_name: str,
                 dtypes: dict | None = None,
                 max_points: int = MAX_POINTS) -> list[dict]:
    """Bucket sampled date values into count-per-period (year/month/day).

    Returns sorted [{label, count}] with the period auto-selected from the span
    of the sampled dates. Empty when the column cannot be parsed as dates.
    """
    rows = sample_rows(csv_bytes, [date_name], dtypes=dtypes, max_points=max_points)
    if not rows:
        return []
    parsed = pd.Series(pd.to_datetime([r.get(date_name) for r in rows], errors="coerce"))
    parsed = parsed.dropna()
    if parsed.empty:
        return []
    span_days = (parsed.max() - parsed.min()).days
    if span_days > 730:
        key = parsed.dt.year
    elif span_days > 61:
        key = parsed.dt.year.astype(str) + "-" + parsed.dt.month.astype(str).str.zfill(2)
    else:
        key = parsed.dt.strftime("%Y-%m-%d")
    counts = key.value_counts().sort_index()
    return [{"label": str(k), "count": int(v)} for k, v in counts.items()]
