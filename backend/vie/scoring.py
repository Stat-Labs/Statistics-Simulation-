"""Scoring & chart recommendation layer of the VIE.

Deterministic statistical best-practice rules produce every candidate chart
with a confidence score, a written reason grounded in the detected signals,
explicit advantages/limitations, and ranked alternatives. The engine never
hardcodes a single chart: the highest-scoring valid candidate for each
analysis is chosen and the runner-ups are surfaced as alternatives.
"""

from __future__ import annotations

from vie.detect import (
    CATS_LOW, CORR_NOTE, CORR_STRONG, MAX_NUMERIC_CHARTS, MAX_SCATTER_PAIRS,
    OUTLIER_RATIO, SKEW_MODERATE,
)


def _clamp(v: float, lo: float = 0.05, hi: float = 0.99) -> float:
    return max(lo, min(hi, v))


def _alternative(chart_type: str, title: str, confidence: float, reason: str) -> dict:
    return {"chartType": chart_type, "title": title,
            "confidence": round(_clamp(confidence), 3), "reason": reason}


def _reason(parts: list[str]) -> str:
    return " ".join(p for p in parts if p) + "."


def _score_distribution(col: dict, meta: dict) -> list[dict]:
    """Candidates for a single numeric column (distribution intent)."""
    name = meta["name"]
    skew = meta.get("skewness")
    kurt = meta.get("kurtosis")
    outliers = meta.get("outlierRatio") or 0.0
    shape = meta.get("shapeLabel", "unknown")
    out: list[dict] = []

    # Histogram — the default shape view; boosted when the shape is notable.
    reasons = [f"'{name}' is {shape}"]
    hist_conf = 0.88
    if skew is not None and abs(skew) >= SKEW_MODERATE:
        hist_conf += 0.05
        reasons.append(f"(skewness {skew:.2g})")
    reasons.append("so the histogram shows the full shape")
    out.append({
        "chartType": "histogram",
        "title": f"{name} distribution",
        "confidence": _clamp(hist_conf),
        "reason": _reason(reasons),
        "advantages": ["reveals skew, modality, and gaps in one view",
                       "exact equal-width bins from the full population"],
        "limitations": ["bin count is fixed by nbins",
                        "does not highlight individual outliers"],
        "intent": "distribution",
    })

    # Box plot — boosted when outliers are present.
    box_conf = 0.82
    box_reasons = [f"'{name}' has {outliers:.1%} values outside the IQR fences"] \
        if outliers >= OUTLIER_RATIO else \
        [f"'{name}' summarizes its five-number summary compactly"]
    if outliers >= OUTLIER_RATIO:
        box_conf += 0.08
    box_reasons.append("so the box plot shows spread and tails")
    out.append({
        "chartType": "boxplot",
        "title": f"{name} box plot",
        "confidence": _clamp(box_conf),
        "reason": _reason(box_reasons),
        "advantages": ["robust to outliers", "compact comparison of spread"],
        "limitations": ["hides modality", "outlier positions not shown (counts only)"],
        "intent": "distribution",
    })

    # Alternatives.
    out[0]["alternatives"] = [
        _alternative("boxplot", f"{name} box plot", box_conf,
                     "better for outliers and tail comparison"),
        _alternative("violin", f"{name} violin plot", box_conf - 0.06,
                     "shows density as well as the box; requires raw data"),
    ]
    out[1]["alternatives"] = [
        _alternative("histogram", f"{name} histogram", hist_conf,
                     "shows the exact shape and modality"),
        _alternative("qq", f"{name} QQ plot", 0.74,
                     "directly tests normality; requires raw data"),
    ]
    return out


def _score_relationship(a: dict, b: dict, r: float, has_sample: bool) -> list[dict]:
    """Candidates for a numeric-numeric pair (relationship intent)."""
    a_name, b_name = a["name"], b["name"]
    mag = abs(r)
    out: list[dict] = []

    conf = 0.85
    reasons = [f"'{a_name}' and '{b_name}' correlate at r = {r:.3g}"]
    if mag >= CORR_STRONG:
        conf += 0.06
        reasons.append("(strong)")
    elif mag >= CORR_NOTE:
        reasons.append("(moderate)")
    reasons.append("so a scatter plot shows the shape of the relationship")
    out.append({
        "chartType": "scatter",
        "title": f"{a_name} vs {b_name}",
        "confidence": _clamp(conf),
        "reason": _reason(reasons),
        "advantages": ["reveals non-linear patterns a correlation coefficient hides",
                       "trend line fitted and overlaid"],
        "limitations": ["points are downsampled for large datasets",
                        "dense overplotting can hide structure"],
        "intent": "relationship",
    })

    alternatives = [_alternative("hexbin", f"{a_name} vs {b_name} (hexbin)", 0.72,
                                 "density of points instead of individual points for large n")]
    if not has_sample:
        alternatives = [_alternative("correlation", f"{a_name} × {b_name} correlation", 0.6,
                                     "quantifies the relationship numerically without raw data")]
    out[0]["alternatives"] = alternatives
    return out


def score_charts(
    detection: dict,
    scatter_data: dict | None,
    date_buckets: list | None,
    user_preferences: dict | None = None,
) -> list[dict]:
    """Produce every scored ChartRecommendation for the dashboard builder."""
    recs: list[dict] = []
    numeric = detection["numeric"]
    categorical = detection["categorical"]
    columns = detection["columns"]
    correlations = detection["correlations"]
    by_name = {m["name"]: m for m in columns}

    # Distribution: one histogram + boxplot per numeric column, capped.
    for meta in numeric[:MAX_NUMERIC_CHARTS]:
        col = by_name.get(meta["name"]) or {}
        for cand in _score_distribution(col, meta):
            cand["column"] = meta["name"]
            recs.append(cand)

    # Relationship: scatter per notable pair, capped by strength.
    ranked = sorted([c for c in correlations if c.get("r") is not None],
                    key=lambda c: abs(c["r"]), reverse=True)
    for c in ranked[:MAX_SCATTER_PAIRS]:
        a, b = by_name.get(c["columnA"]), by_name.get(c["columnB"])
        if not a or not b:
            continue
        has_sample = bool(scatter_data and c["columnA"] in scatter_data
                          and c["columnB"] in scatter_data)
        for cand in _score_relationship(a, b, c["r"], has_sample):
            cand["column"] = f"{c['columnA']}×{c['columnB']}"
            recs.append(cand)

    # Correlation heatmap when enough numeric columns exist.
    if len(numeric) >= 2:
        recs.append({
            "chartType": "heatmap",
            "title": "Correlation matrix",
            "confidence": _clamp(0.9 + (0.04 if any(abs(c.get("r") or 0) >= CORR_STRONG
                                                    for c in correlations) else 0)),
            "reason": _reason([f"{len(numeric)} numeric columns",
                               "so the correlation matrix surfaces collinearity at a glance"]),
            "advantages": ["whole-matrix view of linear relationships",
                           "color-coded strength and direction"],
            "limitations": ["only pairs that were computed are shown",
                            "masks non-linear relationships"],
            "intent": "relationship",
            "column": None,
            "alternatives": [
                _alternative("scatter", "Top correlation pair scatter", 0.85,
                             "zooms into the strongest pair with a trend line"),
            ],
        })

    # Composition / compare: bar or pie for categorical columns with frequencies.
    for meta in categorical:
        if not meta["hasFrequency"]:
            continue
        cats = meta.get("cardinality")
        if cats is not None and cats <= CATS_LOW:
            recs.append({
                "chartType": "pie",
                "title": f"{meta['name']} composition",
                "confidence": _clamp(0.86),
                "reason": _reason([f"'{meta['name']}' has {cats} categories",
                                   "so a part-to-whole view is meaningful"]),
                "advantages": ["instant part-to-whole reading", "low cognitive load"],
                "limitations": ["comparison is harder than in a bar chart",
                                "only valid for a small number of categories"],
                "intent": "composition",
                "column": meta["name"],
                "alternatives": [
                    _alternative("bar", f"{meta['name']} category sizes", 0.9,
                                 "ordered bars compare category sizes more precisely"),
                ],
            })
        else:
            label = f"{cats} categories" if cats else "many categories"
            recs.append({
                "chartType": "bar",
                "title": f"{meta['name']} category sizes",
                "confidence": _clamp(0.9),
                "reason": _reason([f"'{meta['name']}' has {label}",
                                   "so ordered bars compare sizes accurately"]),
                "advantages": ["precise length comparison", "handles many categories"],
                "limitations": ["small differences can be hard to read when N is large"],
                "intent": "compare_categories",
                "column": meta["name"],
                "alternatives": [
                    _alternative("pie", f"{meta['name']} composition", 0.6,
                                 "only if the category count drops to ≤6"),
                ],
            })

    # Data quality: missing-value bar.
    if any((m.get("nullPercentage") or 0) > 0 for m in columns):
        recs.append({
            "chartType": "bar",
            "title": "Missing values by column",
            "confidence": _clamp(0.85),
            "reason": _reason(["some columns contain missing values",
                               "so quantifying the gap up front informs imputation"]),
            "advantages": ["surfaces data-quality risk early"],
            "limitations": ["does not show missingness patterns across rows"],
            "intent": "data_quality",
            "column": None,
            "alternatives": [
                _alternative("table", "Missing values table", 0.6,
                             "exact per-column counts in tabular form"),
            ],
        })

    # Trend over time: line chart when a date column produced buckets.
    if date_buckets:
        recs.append({
            "chartType": "line",
            "title": "Records over time",
            "confidence": _clamp(0.88),
            "reason": _reason(["a date column was detected",
                               "so a line chart tracks the metric over time"]),
            "advantages": ["shows seasonality and trend", "low data volume (aggregated)"],
            "limitations": ["bucketing granularity is automatic",
                            "based on a downsampled sample"],
            "intent": "trend_over_time",
            "column": None,
            "alternatives": [
                _alternative("bar", "Counts per time bucket", 0.7,
                             "ordered bars when the trend is step-like"),
            ],
        })

    # Apply user preference and prompt boosts if user_preferences is provided
    if user_preferences:
        boosted_cols = user_preferences.get("boosted_columns") or []
        boosted_intents = user_preferences.get("boosted_intents") or []
        preferred_charts = user_preferences.get("preferred_charts") or []

        boosted_cols_set = {c.strip().lower() for c in boosted_cols}
        boosted_intents_set = {i.strip().lower() for i in boosted_intents}
        preferred_charts_set = {t.strip().lower() for t in preferred_charts}

        for rec in recs:
            boost = 0.0

            col_name = rec.get("column")
            if col_name:
                col_name_lower = col_name.lower()
                if col_name_lower in boosted_cols_set:
                    boost += 0.15
                elif "×" in col_name_lower:
                    parts = col_name_lower.split("×")
                    if len(parts) == 2:
                        part_a, part_b = parts[0].strip(), parts[1].strip()
                        if part_a in boosted_cols_set or part_b in boosted_cols_set:
                            boost += 0.15

            intent_name = rec.get("intent")
            if intent_name and intent_name.lower() in boosted_intents_set:
                boost += 0.1

            chart_type = rec.get("chartType")
            if chart_type and chart_type.lower() in preferred_charts_set:
                boost += 0.05

            if boost > 0:
                rec["confidence"] = _clamp(rec["confidence"] + boost)

            for alt in rec.get("alternatives") or []:
                alt_boost = 0.0
                alt_type = alt.get("chartType")
                if alt_type and alt_type.lower() in preferred_charts_set:
                    alt_boost += 0.05
                if intent_name and intent_name.lower() in boosted_intents_set:
                    alt_boost += 0.1
                if alt_boost > 0:
                    alt["confidence"] = _clamp(alt["confidence"] + alt_boost)

    recs.sort(key=lambda r: r["confidence"], reverse=True)
    return recs
