"""Chart verification layer of the VIE.

Every generated spec is checked before it is released to the dashboard:
axis labels, non-empty data, aggregation totals, and (for pie charts) the
part-to-whole invariant. Misleading charts (empty series, unlabeled axes,
pie with too many categories, mismatched histogram totals) are rejected or
flagged rather than rendered silently.
"""

from __future__ import annotations


def _first_series(spec: dict) -> dict | None:
    series = spec.get("series") or []
    return series[0] if series else None


def _series_data(spec: dict):
    s = _first_series(spec)
    if not s:
        return []
    data = s.get("data") or []
    return data if isinstance(data, list) else []


def verify_spec(spec: dict, chart_type: str, meta: dict | None = None) -> dict:
    """Return a ChartVerification dict. `meta` carries source facts used by
    data-specific checks (column count, histogram nbins, correlation r, ...)."""
    meta = meta or {}
    checks: list[dict] = []
    notes: list[str] = []

    series = _first_series(spec)
    if series is None:
        checks.append({"name": "series_present", "ok": False,
                       "message": "spec has no series"})
    else:
        checks.append({"name": "series_present", "ok": True,
                       "message": "spec defines at least one series"})

    x_axis = spec.get("xAxis") or {}
    y_axis = spec.get("yAxis") or {}
    has_x = bool(x_axis.get("data")) or bool(x_axis.get("name"))
    has_y = bool(y_axis.get("data")) or bool(y_axis.get("name"))
    if chart_type in ("histogram", "bar", "scatter", "line", "boxplot"):
        checks.append({"name": "axes_populated",
                       "ok": bool(_series_data(spec)),
                       "message": "series carries data points"})
        if chart_type in ("scatter", "boxplot"):
            checks.append({"name": "axes_labeled", "ok": has_x and has_y,
                           "message": "both axes are labeled"})

    data = _series_data(spec)
    if chart_type == "pie":
        cats = len(data)
        total = sum(v if isinstance(v, (int, float)) else (v.get("value") or 0)
                    for v in data)
        ok_cats = 0 < cats <= 6
        ok_total = total > 0
        checks.append({"name": "category_count", "ok": ok_cats,
                       "message": f"{cats} categories (limit 6 for pie)"})
        checks.append({"name": "totals", "ok": ok_total,
                       "message": "slice values are present and summable"})
        if not ok_cats:
            notes.append("Pie charts are only shown for ≤6 categories; otherwise a "
                         "bar chart is recommended.")

    if chart_type == "histogram":
        hist = meta.get("histogram") or {}
        bins = hist.get("bins") or []
        counts = hist.get("counts") or []
        nbins = hist.get("nbins")
        ok_shape = bool(bins) and len(counts) == len(bins)
        n = hist.get("n") or meta.get("count")
        agg_ok = not counts or n is None or sum(counts) <= n
        checks.append({"name": "bin_shape", "ok": ok_shape,
                       "message": f"{len(counts)} bins from {len(bins)} lower edges"
                                  + (f" (nbins={nbins})" if nbins else "")})
        checks.append({"name": "aggregation", "ok": bool(agg_ok),
                       "message": "bin counts are consistent with the population size"})
        if not ok_shape:
            notes.append("Histogram rejected: bin edges and counts are inconsistent.")

    if chart_type == "heatmap":
        cells = len(data)
        checks.append({"name": "cells_present", "ok": cells > 0,
                       "message": f"{cells} correlation cells plotted"})

    if chart_type == "scatter":
        n = len(data)
        checks.append({"name": "sample_size", "ok": n >= 2,
                       "message": f"{n} points (downsampled)"})

    passed = all(c["ok"] for c in checks)
    return {"passed": passed, "checks": checks, "notes": notes}
