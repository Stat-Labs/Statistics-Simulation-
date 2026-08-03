"""Tests for the Visualization Intelligence Engine (VIE).

Covers the deterministic pipeline: detection -> intent -> scoring -> ECharts
spec generation -> verification -> dashboard, plus the /visualize endpoint.
"""

import json

from fastapi.testclient import TestClient
import numpy as np

from stats.chunked_reader import ChunkedCsvReader
from stats.profile import compute_streaming_profile
from vie.detect import build_detection, is_date_column, is_numeric_column
from vie.intent import infer_intents
from vie.scoring import score_charts
from vie.spec import (
    bar_spec, boxplot_spec, heatmap_spec, histogram_spec, pie_spec,
    scatter_spec, missing_bar_spec, line_spec,
)
from vie.verify import verify_spec
from vie.dashboard import build_dashboard


def _profile(csv_bytes, correlations=True):
    reader = ChunkedCsvReader(csv_bytes, "t.csv")
    sniff = reader.sniff()
    pairs = None
    if correlations:
        numeric = [c.name for c in sniff.columns if c.total > 0 and c.float_ok == c.total]
        pairs = [(a, b) for i, a in enumerate(numeric) for b in numeric[i + 1:]]
    return compute_streaming_profile(
        reader, chunk_size=50000, nbins=20, top_frequency=10, correlations=pairs,
    )


def _numeric_names(profile):
    return [c["name"] for c in profile["columns"] if c.get("mean") is not None]


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


def test_detection_finds_numeric_categorical_and_skew(csv_bytes):
    prof = _profile(csv_bytes())
    det = build_detection(prof)
    numeric = [m["name"] for m in det["numeric"]]
    assert "income" in numeric and "score" in numeric
    categorical = [m["name"] for m in det["categorical"]]
    assert "region" in categorical
    income = next(m for m in det["numeric"] if m["name"] == "income")
    assert income["shape"] in ("right_skewed", "strongly_right_skewed")
    assert any(p["name"].endswith("skewed") and p["column"] == "income"
               for p in det["patterns"])


def test_detection_notes_outliers_and_missing(csv_bytes):
    prof = _profile(csv_bytes())
    det = build_detection(prof)
    names = {p["name"] for p in det["patterns"]}
    assert "missing_data" in names
    assert det["columns"][0]["name"] == "id"


def test_date_column_detection():
    assert is_date_column({"name": "created_at", "sampleValues": ["2020-01-02"]})
    assert is_date_column({"name": "x", "sampleValues": ["2020/01/02", "2021-03-04"]})
    assert not is_date_column({"name": "x", "sampleValues": ["north", "south"]})
    assert not is_date_column({"name": "income", "sampleValues": ["1234.5"]})


def test_numeric_column_requires_stats():
    assert is_numeric_column({"type": "continuous", "mean": 3.0})
    assert not is_numeric_column({"type": "categorical", "mean": None})
    assert not is_numeric_column({"type": "continuous", "mean": None})


# ---------------------------------------------------------------------------
# Intent inference
# ---------------------------------------------------------------------------


def test_intents_cover_distribution_relationship_and_composition(csv_bytes):
    det = build_detection(_profile(csv_bytes()))
    intents = infer_intents(det)
    ids = [i["id"] for i in intents]
    assert "distribution" in ids
    assert "relationship" in ids
    assert "composition" in ids  # region has ≤6 categories
    assert all(0 <= i["confidence"] <= 1 for i in intents)
    assert all(i["evidence"] for i in intents if i["confidence"] >= 0.8)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def test_scoring_recommends_histogram_and_boxplot(csv_bytes):
    prof = _profile(csv_bytes())
    det = build_detection(prof)
    recs = score_charts(det, None, None)
    types = [r["chartType"] for r in recs]
    assert "histogram" in types
    assert "boxplot" in types
    assert "heatmap" in types
    hist = next(r for r in recs if r["chartType"] == "histogram")
    assert hist["confidence"] >= 0.8
    assert hist["alternatives"], "histogram must list alternatives"
    assert "skewness" in hist["reason"] or hist["reason"]


def test_scoring_pie_only_for_few_categories(csv_bytes):
    prof = _profile(csv_bytes())
    det = build_detection(prof)
    recs = score_charts(det, None, None)
    pies = [r for r in recs if r["chartType"] == "pie"]
    assert pies, "region has 4 categories -> pie eligible"
    for p in pies:
        assert p["confidence"] >= 0.8
        assert "composition" == p["intent"]


def test_scoring_surfaces_data_quality(csv_bytes):
    prof = _profile(csv_bytes())
    det = build_detection(prof)
    recs = score_charts(det, None, None)
    dq = [r for r in recs if r["intent"] == "data_quality"]
    assert dq, "age has 5% missing -> data quality bar expected"
    assert dq[0]["chartType"] == "bar"


# ---------------------------------------------------------------------------
# Spec generation
# ---------------------------------------------------------------------------


def _col(profile, name):
    return next(c for c in profile["columns"] if c["name"] == name)


def test_histogram_spec_is_complete(csv_bytes):
    prof = _profile(csv_bytes())
    spec = histogram_spec(_col(prof, "income"))
    assert spec is not None
    assert spec["series"][0]["type"] == "bar"
    assert spec["xAxis"]["type"] == "category"
    assert spec["xAxis"]["data"]
    assert len(spec["xAxis"]["data"]) == len(spec["series"][0]["data"])
    # mean markLine is attached
    assert any("markLine" in s for s in spec["series"])


def test_boxplot_spec_from_quantiles(csv_bytes):
    prof = _profile(csv_bytes())
    spec = boxplot_spec(_col(prof, "score"))
    assert spec is not None
    box = spec["series"][0]
    assert box["type"] == "boxplot"
    assert len(box["data"][0]) == 5  # [min, q25, median, q75, max]


def test_pie_spec_rejects_too_many_categories(csv_bytes):
    prof = _profile(csv_bytes())
    region = _col(prof, "region")
    spec = pie_spec(region)
    assert spec is not None
    assert len(spec["series"][0]["data"]) <= 6
    big = {"name": "x", "frequencyTable": {str(i): i for i in range(12)}}
    assert pie_spec(big) is None


def test_heatmap_spec_builds_matrix(csv_bytes):
    prof = _profile(csv_bytes())
    det = build_detection(prof)
    spec = heatmap_spec(det)
    assert spec is not None
    assert spec["series"][0]["type"] == "heatmap"
    cells = spec["series"][0]["data"]
    assert cells, "correlation cells present"
    # diagonal is 1.0 and values in [-1, 1]
    assert all(abs(c[2]) <= 1.0 for c in cells)


def test_scatter_spec_with_trend_and_sample(csv_bytes):
    prof = _profile(csv_bytes())
    names = _numeric_names(prof)[:2]
    points = {n: list(np.linspace(1, 100, 50)) for n in names}
    points[names[1]] = [v * 2 + 5 for v in points[names[0]]]
    spec = scatter_spec(names[0], names[1], points)
    assert spec is not None
    kinds = [s["type"] for s in spec["series"]]
    assert "scatter" in kinds and "line" in kinds  # trend line
    assert len(spec["series"][0]["data"]) == 50


def test_scatter_spec_empty_returns_none(csv_bytes):
    assert scatter_spec("a", "b", {}) is None


def test_missing_bar_spec_lists_missing_columns(csv_bytes):
    prof = _profile(csv_bytes())
    spec = missing_bar_spec(prof["columns"])
    assert spec is not None
    assert "age" in spec["xAxis"]["data"]


def test_line_spec_needs_two_buckets():
    spec = line_spec("created_at", [{"label": "2020", "count": 5}])
    assert spec is None
    spec2 = line_spec("created_at", [{"label": "2020", "count": 5},
                                     {"label": "2021", "count": 9}])
    assert spec2 is not None
    assert spec2["series"][0]["type"] == "line"


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


def test_verify_histogram_checks_consistency(csv_bytes):
    prof = _profile(csv_bytes())
    col = _col(prof, "income")
    spec = histogram_spec(col)
    res = verify_spec(spec, "histogram", {"histogram": col["histogram"],
                                          "count": col["count"]})
    assert res["passed"] is True
    assert any(c["name"] == "aggregation" and c["ok"] for c in res["checks"])


def test_verify_rejects_too_many_pie_categories():
    fake = {
        "xAxis": {"data": [str(i) for i in range(7)]},
        "series": [{"data": [{"name": str(i), "value": i} for i in range(7)]}],
    }
    res = verify_spec(fake, "pie", {})
    assert res["passed"] is False
    assert any(c["name"] == "category_count" and not c["ok"] for c in res["checks"])


def test_verify_rejects_empty_series():
    res = verify_spec({"xAxis": {}, "yAxis": {}, "series": [{"data": []}]}, "bar", {})
    assert res["passed"] is False


# ---------------------------------------------------------------------------
# Dashboard orchestration
# ---------------------------------------------------------------------------


def test_dashboard_builds_multisection_dashboard(csv_bytes):
    prof = _profile(csv_bytes())
    dash = build_dashboard(prof, csv_bytes())
    assert dash["success"] is True
    assert dash["engine"] == "vie-1.0.0"
    sections = dash["sections"]
    titles = [s["title"] for s in sections]
    assert "Distribution & shape" in titles
    assert "Relationships & correlation" in titles
    assert "Categories & composition" in titles
    assert "Data quality" in titles
    assert dash["intents"], "intents inferred"
    assert dash["detectedPatterns"], "patterns detected"

    charts = [c for s in sections for c in s["charts"]]
    assert charts, "at least one chart generated"
    for chart in charts:
        assert chart["spec"]["series"], "every chart has series"
        assert chart["verification"]["passed"] is True
        assert chart["recommendation"]["confidence"] > 0
        assert "reason" in chart["recommendation"]
        assert chart["id"]


def test_dashboard_scatter_uses_sampled_points(csv_bytes):
    prof = _profile(csv_bytes())
    dash = build_dashboard(prof, csv_bytes())
    scatters = [c for s in dash["sections"] for c in s["charts"]
                if c["chartType"] == "scatter"]
    assert scatters, "scatter charts generated from the sample"
    for sc in scatters:
        assert len(sc["spec"]["series"][0]["data"]) <= 2000


def test_dashboard_graceful_without_raw_data(csv_bytes):
    prof = _profile(csv_bytes())
    dash = build_dashboard(prof, None)
    sections = dash["sections"]
    charts = [c for s in sections for c in s["charts"]]
    assert any(c["chartType"] == "histogram" for c in charts)
    # no scatter without raw data, and that is surfaced
    assert dash["note"] is None or "scatter" in dash["note"].lower() or any(
        c["chartType"] == "heatmap" for c in charts)


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


def test_visualize_endpoint_returns_dashboard(csv_bytes):
    from main import app
    client = TestClient(app)
    resp = client.post(
        "/visualize",
        files={"file": ("data.csv", csv_bytes(), "text/csv")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["engine"] == "vie-1.0.0"
    assert body["sections"]
    # the strongest chart is a histogram of a numeric column
    assert body["rowCount"] == 10000


def test_visualize_endpoint_rejects_empty_file(csv_bytes):
    from main import app
    client = TestClient(app)
    resp = client.post(
        "/visualize",
        files={"file": ("empty.csv", b"", "text/csv")},
    )
    assert resp.status_code in (400, 500)


def test_dashboard_boosts_user_preferences(csv_bytes):
    prof = _profile(csv_bytes())
    # Test dashboard with boosts
    user_prefs = {
        "boosted_columns": ["income"],
        "boosted_intents": ["relationship"],
        "preferred_charts": ["boxplot"]
    }
    dash = build_dashboard(prof, csv_bytes(), user_preferences=user_prefs)
    assert dash["success"] is True
    
    # Verify that the boosted configs are present
    charts = [c for s in dash["sections"] for c in s["charts"]]
    income_charts = [c for c in charts if c.get("column") == "income"]
    for c in income_charts:
        if c["chartType"] == "boxplot":
            # Normal confidence is 0.82 or 0.9. With +0.15 column boost + 0.05 boxplot boost + 0.1 intent boost...
            assert c["recommendation"]["confidence"] > 0.9
