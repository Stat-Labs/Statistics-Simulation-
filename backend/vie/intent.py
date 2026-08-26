"""Intent detection layer of the VIE.

Infers what the user is likely trying to understand from the dataset structure
alone (deterministic, no LLM). Free-text prompts are NOT required: every intent
carries concrete evidence strings from the detection report so the dashboard can
explain why each intent was assumed. The LLM (later phases) may map a user
prompt onto these same intent ids — it never creates charts itself.
"""

from __future__ import annotations

from vie.detect import CATS_LOW, CORR_NOTE, build_detection


def infer_intents(detection: dict) -> list[dict]:
    """Return ranked Intent dicts inferred from the detection report."""
    numeric = detection["numeric"]
    categorical = detection["categorical"]
    correlations = detection["correlations"]
    patterns = detection["patterns"]

    intents: list[dict] = []

    if numeric:
        n = len(numeric)
        intents.append({
            "id": "distribution",
            "label": "Distribution & shape",
            "description": f"Understand the distribution of the {n} numeric column(s).",
            "confidence": min(0.95, 0.7 + 0.1 * n),
            "evidence": [
                f"{m['name']}: {m['shapeLabel']} (skewness = {m['skewness']:.3g})"
                for m in numeric[:3] if m["skewness"] is not None
            ],
        })

    if len(numeric) >= 2 and correlations:
        intents.append({
            "id": "relationship",
            "label": "Relationships & correlation",
            "description": "Explore how numeric columns move together.",
            "confidence": 0.9,
            "evidence": [
                f"strongest pair: {c['columnA']} × {c['columnB']} r = {c['r']:.3g}"
                for c in sorted(
                    (c for c in correlations if c.get("r") is not None),
                    key=lambda c: abs(c["r"]), reverse=True,
                )[:1]
            ],
        })
    elif len(numeric) >= 2:
        intents.append({
            "id": "relationship",
            "label": "Relationships & correlation",
            "description": "Explore how numeric columns move together (correlations were not computed).",
            "confidence": 0.55,
            "evidence": [],
        })

    for m in categorical:
        cats = m["cardinality"]
        if cats is None:
            continue
        if cats <= CATS_LOW:
            intents.append({
                "id": "composition",
                "label": f"Composition of {m['name']}",
                "description": f"Break down the share of each category in '{m['name']}'.",
                "confidence": 0.9,
                "evidence": [f"{cats} categories — a part-to-whole view is meaningful."],
            })
        else:
            intents.append({
                "id": "compare_categories",
                "label": f"Compare {m['name']} categories",
                "description": f"Compare category sizes in '{m['name']}'.",
                "confidence": 0.85,
                "evidence": [f"{cats} categories — bar comparison recommended over pie."],
            })

    if any(p["name"] == "time_series" for p in patterns):
        intents.append({
            "id": "trend_over_time",
            "label": "Trend over time",
            "description": "Track how a metric evolves across the date column.",
            "confidence": 0.85,
            "evidence": [
                f"date column: {p['column']}"
                for p in patterns if p["name"] == "time_series"
            ],
        })

    missing = [m for m in detection["columns"] if (m["nullPercentage"] or 0) > 0]
    if missing:
        intents.append({
            "id": "data_quality",
            "label": "Data quality",
            "description": "Spot missing values and duplicates before analysing further.",
            "confidence": 0.9,
            "evidence": [
                f"{len(missing)} column(s) with missing values"
            ],
        })

    intents.sort(key=lambda i: i["confidence"], reverse=True)
    return intents
