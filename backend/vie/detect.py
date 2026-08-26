"""Statistical detection layer of the VIE.

Turns a `StreamProfileResponse` dict into a compact `DetectionReport`: one
shape/quality summary per column plus dataset-level facts (correlation
strength, missingness, time-series signal, cardinality regimes). Every fact is
derived deterministically from the profile and feeds both intent inference and
chart scoring. All thresholds live here so they can be unit tested.
"""

from __future__ import annotations

import re

# Skewness thresholds (Pearson moment skewness).
SKEW_MODERATE = 0.5
SKEW_STRONG = 1.0
# Excess kurtosis thresholds (Fisher/scipy convention: 0 for normal).
KURT_HEAVY = 1.0
# Outlier ratio above which a column deserves an outlier-focused chart.
OUTLIER_RATIO = 0.01
# Cardinality regimes (guide pie/bar eligibility and "many categories" notes).
CATS_LOW = 6
CATS_MID = 30
# Correlation magnitude that marks a noteworthy relationship.
CORR_NOTE = 0.5
CORR_STRONG = 0.7
# Hard cap on numeric columns/features we will chart.
MAX_NUMERIC_CHARTS = 8
MAX_SCATTER_PAIRS = 4

DATE_NAME_TOKENS = {
    "date", "dates", "day", "days", "month", "months", "year", "years",
    "time", "timestamp", "datetime", "created", "createdat", "created_at",
    "updated", "updatedat", "updated_at", "birth", "dob", "week", "quarter",
    "hired", "start", "startdate", "enddate",
}
_ISO_DATE_RE = re.compile(
    r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$"
)

NUMERIC_TYPES = {"continuous", "ordinal"}


def _tokens(name: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", name.lower()))


def is_date_column(col: dict) -> bool:
    """Best-effort date detection from column name hints or sample values."""
    name = str(col.get("name", ""))
    if _tokens(name) & DATE_NAME_TOKENS:
        return True
    samples = [str(v) for v in (col.get("sampleValues") or []) if v is not None]
    if samples and all(bool(_ISO_DATE_RE.match(s)) for s in samples):
        return True
    return False


def is_numeric_column(col: dict) -> bool:
    return col.get("type") in NUMERIC_TYPES and col.get("mean") is not None


def _shape(col: dict) -> tuple[str, str, float]:
    """Return (shape, short_label, signal) from skewness/kurtosis."""
    s = col.get("skewness")
    k = col.get("kurtosis")
    if s is None:
        return "unknown", "unknown", 0.0
    if abs(s) < SKEW_MODERATE and (k is None or abs(k) < KURT_HEAVY):
        return "approximately_normal", "approximately normal", abs(s)
    if s > SKEW_STRONG:
        return "strongly_right_skewed", "strongly right-skewed", s
    if s < -SKEW_STRONG:
        return "strongly_left_skewed", "strongly left-skewed", abs(s)
    if s > SKEW_MODERATE:
        return "right_skewed", "right-skewed", s
    if s < -SKEW_MODERATE:
        return "left_skewed", "left-skewed", abs(s)
    if k is not None and abs(k) >= KURT_HEAVY:
        return "heavy_tailed", "heavy-tailed", abs(k)
    return "symmetric", "symmetric", abs(s)


def build_detection(profile: dict) -> dict:
    """Compute a DetectionReport dict from a StreamProfileResponse dict."""
    columns = profile.get("columns") or []
    correlations = profile.get("correlations") or []

    col_meta = []
    numeric = []
    categorical = []
    for col in columns:
        name = col.get("name", "")
        meta = {
            "name": name,
            "type": col.get("type"),
            "cardinality": col.get("cardinality"),
            "nullPercentage": col.get("nullPercentage", 0.0),
            "isNumeric": is_numeric_column(col),
            "isDate": is_date_column(col),
            "constant": (col.get("cardinality") or 0) <= 1,
            "skewness": col.get("skewness"),
            "kurtosis": col.get("kurtosis"),
            "outlierRatio": None,
            "hasFrequency": bool(col.get("frequencyTable")),
        }
        shape, label, signal = _shape(col)
        meta["shape"] = shape
        meta["shapeLabel"] = label
        meta["shapeSignal"] = signal
        count = col.get("count") or 0
        outliers = col.get("outlierCount")
        if isinstance(outliers, int) and count > 0:
            meta["outlierRatio"] = outliers / count
        col_meta.append(meta)
        if meta["isNumeric"]:
            numeric.append(meta)
        elif col.get("type") in ("categorical", "binary") or meta["hasFrequency"]:
            categorical.append(meta)

    patterns = []
    for meta in col_meta:
        if meta["constant"]:
            patterns.append({
                "name": "constant_column", "column": meta["name"],
                "description": f"'{meta['name']}' has a single value (cardinality 1).",
                "signal": 1.0,
            })
        if meta["skewness"] is not None and meta["shape"] not in ("approximately_normal", "unknown"):
            patterns.append({
                "name": meta["shape"], "column": meta["name"],
                "description": (f"'{meta['name']}' is {meta['shapeLabel']} "
                                f"(skewness = {meta['skewness']:.3g})."),
                "signal": meta["shapeSignal"],
            })
        if meta["outlierRatio"] is not None and meta["outlierRatio"] >= OUTLIER_RATIO:
            patterns.append({
                "name": "outliers", "column": meta["name"],
                "description": (f"'{meta['name']}' has {meta['outlierRatio']:.1%} of values "
                                "outside the IQR fences."),
                "signal": meta["outlierRatio"],
            })
        if meta["isDate"]:
            patterns.append({
                "name": "time_series", "column": meta["name"],
                "description": f"'{meta['name']}' looks like a date/time column.",
                "signal": 1.0,
            })

    strong_pairs = []
    for c in correlations:
        r = c.get("r")
        if r is None:
            continue
        mag = abs(r)
        if mag >= CORR_NOTE:
            strong_pairs.append(c)
        if mag >= CORR_STRONG:
            patterns.append({
                "name": "strong_correlation",
                "column": f"{c.get('columnA')} × {c.get('columnB')}",
                "description": (f"Strong {'positive' if r > 0 else 'negative'} correlation "
                                f"r = {r:.3g} between '{c.get('columnA')}' and "
                                f"'{c.get('columnB')}'."),
                "signal": r,
            })

    total_missing = profile.get("totalMissing") or 0
    if total_missing > 0:
        patterns.append({
            "name": "missing_data", "column": None,
            "description": f"{total_missing:,} missing values across the dataset.",
            "signal": float(total_missing),
        })

    return {
        "columns": col_meta,
        "numeric": numeric,
        "categorical": categorical,
        "correlations": correlations,
        "strongPairs": strong_pairs,
        "patterns": patterns,
        "maxNumeric": len(numeric),
    }
