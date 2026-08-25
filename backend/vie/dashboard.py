"""Dashboard orchestration for the VIE.

Runs the full deterministic pipeline over a StreamProfileResponse dict:

    detection -> intents -> scoring -> spec generation -> verification

and assembles the multi-chart EDA dashboard grouped into labelled sections
with the confidence/reasoning and verification metadata attached to every
chart. This is the top-level entry point consumed by the `/visualize` route.
"""

from __future__ import annotations

from vie.detect import build_detection
from vie.intent import infer_intents
from vie.sampler import date_buckets, scatter_data
from vie.scoring import score_charts
from vie.spec import (
    bar_spec, boxplot_spec, heatmap_spec, histogram_spec, line_spec,
    missing_bar_spec, pie_spec, scatter_spec,
)
from vie.verify import verify_spec

ENGINE_VERSION = "vie-1.0.0"

SECTION_ORDER = ["trend_over_time", "distribution", "relationship",
                 "composition", "compare_categories", "data_quality"]
SECTION_TITLES = {
    "trend_over_time": "Trend over time",
    "distribution": "Distribution & shape",
    "relationship": "Relationships & correlation",
    "composition": "Categories & composition",
    "compare_categories": "Categories & composition",
    "data_quality": "Data quality",
}
SECTION_DESCRIPTIONS = {
    "trend_over_time": "How the dataset evolves over time.",
    "distribution": "The shape and spread of every numeric column.",
    "relationship": "How numeric columns move together.",
    "composition": "Category sizes and part-to-whole structure.",
    "data_quality": "Missingness and duplicate-risk signals.",
}


def _slug(title: str) -> str:
    return "".join(ch for ch in title.lower() if ch.isalnum() or ch in "-_").replace(" ", "-")


def _build_spec_for(rec: dict, profile: dict, detection: dict,
                    scatter: dict, buckets: list | None, by_name: dict):
    chart_type = rec["chartType"]
    meta: dict = {}
    if chart_type in ("histogram", "boxplot", "pie", "bar"):
        col = by_name.get(rec.get("column")) or {}
        if chart_type == "histogram":
            meta = {"histogram": col.get("histogram") or {}, "count": col.get("count")}
            spec = histogram_spec(col)
        elif chart_type == "boxplot":
            spec = boxplot_spec(col)
        elif chart_type == "pie":
            spec = pie_spec(col)
        else:
            spec = bar_spec(col)
    elif chart_type == "scatter":
        parts = (rec.get("column") or "").split("×")
        if len(parts) == 2:
            spec = scatter_spec(parts[0].strip(), parts[1].strip(), scatter)
        else:
            spec = None
    elif chart_type == "heatmap":
        spec = heatmap_spec(detection)
    elif chart_type == "line":
        if buckets:
            date_cols = [m["name"] for m in detection["columns"] if m["isDate"]]
            spec = line_spec(date_cols[0], buckets)
        else:
            spec = None
    else:
        spec = None
    if chart_type == "bar" and rec.get("intent") == "data_quality":
        spec = missing_bar_spec(detection["columns"])
    return spec, meta


def build_dashboard(profile: dict, csv_bytes: bytes | None = None,
                    dtypes: dict | None = None, user_preferences: dict | None = None) -> dict:
    detection = build_detection(profile)
    intents = infer_intents(detection)
    by_name = {c["name"]: c for c in (profile.get("columns") or [])}

    scatter: dict[str, list[float]] = {}
    buckets: list[dict] | None = None
    if csv_bytes:
        numeric_names = [m["name"] for m in detection["numeric"]]
        if numeric_names:
            scatter = scatter_data(csv_bytes, numeric_names, dtypes=dtypes)
        date_cols = [m["name"] for m in detection["columns"] if m["isDate"]]
        if date_cols:
            buckets = date_buckets(csv_bytes, date_cols[0], dtypes=dtypes)

    recs = score_charts(detection, scatter, buckets, user_preferences)

    sections: dict[str, list[dict]] = {}
    skipped: list[str] = []
    seen_ids: set[str] = set()
    for rec in recs:
        spec, meta = _build_spec_for(rec, profile, detection, scatter, buckets, by_name)
        if spec is None:
            skipped.append(rec["title"])
            continue
        verification = verify_spec(spec, rec["chartType"], meta)
        if not verification["passed"]:
            skipped.append(f"{rec['title']} (verification: "
                           + "; ".join(c["message"] for c in verification["checks"]
                                       if not c["ok"]) + ")")
            continue
        intent = rec["intent"]
        section_key = intent if intent in SECTION_ORDER else "distribution"
        sec = sections.setdefault(section_key, [])
        uid = _slug(rec["title"])
        if uid in seen_ids:
            uid = f"{uid}-{len(seen_ids)}"
        seen_ids.add(uid)
        sec.append({
            "id": uid,
            "section": SECTION_TITLES[section_key],
            "intent": intent,
            "title": rec["title"],
            "chartType": rec["chartType"],
            "recommendation": {k: rec[k] for k in
                               ("chartType", "title", "intent", "confidence",
                                "reason", "advantages", "limitations", "alternatives")},
            "spec": spec,
            "verification": verification,
        })

    ordered_sections = []
    for key in SECTION_ORDER:
        charts = sections.get(key)
        if not charts:
            continue
        ordered_sections.append({
            "id": key,
            "title": SECTION_TITLES[key],
            "description": SECTION_DESCRIPTIONS.get(key, ""),
            "charts": charts,
        })

    note = None
    if skipped:
        note = "Charts not generated: " + ", ".join(skipped) + "."

    return {
        "success": True,
        "engine": ENGINE_VERSION,
        "fileName": profile.get("fileName", ""),
        "rowCount": profile.get("rowCount", 0),
        "columnCount": profile.get("columnCount", 0),
        "detectedPatterns": detection["patterns"],
        "intents": intents,
        "sections": ordered_sections,
        "note": note,
    }
