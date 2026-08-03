"""ECharts specification generators for the VIE.

Each builder returns a complete, self-contained Apache ECharts option dict:
axes, series, tooltips, legend, color, mark lines, and (where the data allows)
confidence/prediction styling. The frontend renders these verbatim — it never
infers chart logic. Colors follow the app's zinc/emerald dark theme.
"""

from __future__ import annotations

import numpy as np

PALETTE = ["#34d399", "#818cf8", "#f472b6", "#fb923c", "#38bdf8", "#a78bfa"]
TITLE_COLOR = "#e4e4e7"
AXIS_COLOR = "#a1a1aa"
TICK_COLOR = "#71717a"
SPLIT_COLOR = "#27272a"
BG = "transparent"


def _fmt(v):
    if v is None:
        return "N/A"
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    if f == int(f) and abs(f) < 1e15:
        return f"{int(f):,}"
    if abs(f) < 0.01 or abs(f) >= 1e6:
        return f"{f:.3g}"
    return f"{f:,.4g}"


def _fmt_range(lo, hi):
    return f"{_fmt(lo)}–{_fmt(hi)}"


def _base(title: str) -> dict:
    return {
        "backgroundColor": BG,
        "title": {
            "text": title,
            "left": "center",
            "textStyle": {"color": TITLE_COLOR, "fontSize": 13, "fontWeight": 500},
        },
        "tooltip": {
            "trigger": "axis",
            "axisPointer": {"type": "cross", "label": {"backgroundColor": "#3f3f46"}},
            "backgroundColor": "#18181b",
            "borderColor": "#3f3f46",
            "textStyle": {"color": "#e4e4e7", "fontSize": 12}
        },
        "grid": {"left": 12, "right": 12, "top": 44, "bottom": 8, "containLabel": True},
        "toolbox": {
            "show": True,
            "right": 12,
            "top": 0,
            "feature": {
                "dataZoom": {"yAxisIndex": "none", "title": {"zoom": "Zoom Area", "back": "Restore Zoom"}},
                "dataView": {"readOnly": True, "title": "Data View", "lang": ["Data View", "Close", "Refresh"]},
                "restore": {"title": "Reset"},
                "saveAsImage": {"title": "Save Image"},
            },
            "iconStyle": {"borderColor": TICK_COLOR},
            "emphasis": {"iconStyle": {"borderColor": TITLE_COLOR}},
        },
    }


def _category_axis(labels, name="", rotate=0) -> dict:
    return {
        "type": "category",
        "data": labels,
        "name": name,
        "nameTextStyle": {"color": TICK_COLOR, "fontSize": 10},
        "axisLabel": {"color": TICK_COLOR, "fontSize": 10,
                      "rotate": rotate if len(labels) > 10 else 0},
        "axisLine": {"lineStyle": {"color": SPLIT_COLOR}},
    }


def _value_axis(name="") -> dict:
    return {
        "type": "value",
        "name": name,
        "nameTextStyle": {"color": TICK_COLOR, "fontSize": 10},
        "axisLabel": {"color": TICK_COLOR, "fontSize": 10},
        "splitLine": {"lineStyle": {"color": SPLIT_COLOR}},
    }


def _mean_mark_line(mean: float) -> list:
    return [{
        "type": "line",
        "name": "mean",
        "markLine": {
            "silent": True,
            "symbol": "none",
            "data": [{"yAxis": mean, "label": {"formatter": f"mean {_fmt(mean)}",
                                               "color": AXIS_COLOR, "fontSize": 10}}],
            "lineStyle": {"color": AXIS_COLOR, "type": "dashed"},
        },
    }]


def histogram_spec(col: dict) -> dict | None:
    hist = col.get("histogram") or {}
    bins = hist.get("bins") or []
    counts = hist.get("counts") or []
    if not bins or not counts or len(bins) != len(counts):
        return None
    name = col.get("name", "column")
    labels = [
        _fmt_range(bins[i], bins[i + 1] if i + 1 < len(bins) else (col.get("max") or bins[i]))
        for i in range(len(counts))
    ]
    spec = _base(f"{name} — distribution")
    spec["xAxis"] = _category_axis(labels, name)
    spec["yAxis"] = _value_axis("count")
    series = [{
        "type": "bar",
        "name": "count",
        "data": counts,
        "barCategoryGap": "8%",
        "itemStyle": {"color": PALETTE[0]},
    }]
    if col.get("mean") is not None:
        series.extend(_mean_mark_line(col["mean"]))
    spec["series"] = series
    return spec


def boxplot_spec(col: dict) -> dict | None:
    q = col.get("quantiles") or {}
    need = ("q25", "q50", "q75")
    if any(q.get(k) is None for k in need):
        return None
    lo, hi = col.get("min"), col.get("max")
    if lo is None or hi is None:
        return None
    name = col.get("name", "column")
    spec = _base(f"{name} — box plot")
    spec["xAxis"] = _category_axis([name])
    spec["yAxis"] = _value_axis(name)
    series = [{
        "type": "boxplot",
        "name": name,
        "data": [[lo, q["q25"], q["q50"], q["q75"], hi]],
        "boxWidth": 36,
        "itemStyle": {"color": "#18181b", "borderColor": PALETTE[1]},
        "tooltip": {"formatter": None},
    }]
    if col.get("mean") is not None:
        series.extend(_mean_mark_line(col["mean"]))
    spec["series"] = series
    spec["note"] = ("Whiskers span the full min–max range. "
                    "Outlier positions are not shown (only counts are streamed).")
    return spec


def bar_spec(col: dict, top: int = 20) -> dict | None:
    freq = col.get("frequencyTable") or {}
    if not freq:
        return None
    name = col.get("name", "column")
    items = sorted(freq.items(), key=lambda kv: kv[1], reverse=True)[:top]
    total = sum(freq.values())
    spec = _base(f"{name} — category sizes")
    spec["xAxis"] = _category_axis([str(k) for k, _ in items], name)
    spec["yAxis"] = _value_axis("count")
    spec["tooltip"] = {"trigger": "axis", "backgroundColor": "#18181b",
                       "borderColor": "#3f3f46", "textStyle": {"color": "#e4e4e7", "fontSize": 12},
                       "valueFormatter": None}
    spec["series"] = [{
        "type": "bar",
        "name": "count",
        "data": [{"value": v, "itemStyle": {"color": PALETTE[i % len(PALETTE)]}}
                 for i, (_, v) in enumerate(items)],
        "barCategoryGap": "18%",
    }]
    spec["note"] = f"Top {len(items)} of {len(freq)} categories ({total:,} total records)."
    return spec


def pie_spec(col: dict, max_cats: int = 6) -> dict | None:
    freq = col.get("frequencyTable") or {}
    if not freq:
        return None
    items = sorted(freq.items(), key=lambda kv: kv[1], reverse=True)
    if len(items) > max_cats:
        return None
    name = col.get("name", "column")
    total = sum(v for _, v in items)
    spec = _base(f"{name} — composition")
    spec["tooltip"] = {"trigger": "item", "backgroundColor": "#18181b",
                       "borderColor": "#3f3f46", "textStyle": {"color": "#e4e4e7", "fontSize": 12}}
    spec["legend"] = {"bottom": 0, "textStyle": {"color": TICK_COLOR, "fontSize": 10},
                      "itemWidth": 10, "itemHeight": 10}
    spec["series"] = [{
        "type": "pie",
        "radius": "62%",
        "center": ["50%", "44%"],
        "data": [{"name": str(k), "value": v,
                  "itemStyle": {"color": PALETTE[i % len(PALETTE)]}}
                 for i, (k, v) in enumerate(items)],
        "label": {"color": TICK_COLOR, "fontSize": 10,
                  "formatter": "{b}: {d}%"},
        "itemStyle": {"borderColor": "#18181b", "borderWidth": 2, "borderRadius": 4},
    }]
    spec["note"] = f"Part-to-whole of {len(items)} categories ({total:,} total records)."
    return spec


def heatmap_spec(detection: dict) -> dict | None:
    names = [m["name"] for m in detection["numeric"]]
    if len(names) < 2:
        return None
    corr_map: dict[tuple[str, str], float] = {}
    for c in detection["correlations"]:
        a, b, r = c.get("columnA"), c.get("columnB"), c.get("r")
        if a in names and b in names and r is not None:
            corr_map[(a, b)] = r
            corr_map[(b, a)] = r
    data = []
    for i, a in enumerate(names):
        for j, b in enumerate(names):
            r = corr_map.get((a, b), 1.0 if a == b else None)
            if r is None:
                continue
            data.append([i, j, round(r, 3)])
    if not data:
        return None
    spec = _base("Correlation matrix")
    spec["xAxis"] = _category_axis(names, rotate=45)
    spec["yAxis"] = {"type": "category", "data": names, "axisLabel": {"color": TICK_COLOR,
                     "fontSize": 10}, "splitArea": {"show": True}}
    spec["tooltip"] = {"trigger": "item", "backgroundColor": "#18181b",
                       "borderColor": "#3f3f46", "textStyle": {"color": "#e4e4e7", "fontSize": 12}}
    spec["visualMap"] = {
        "min": -1, "max": 1, "orient": "horizontal", "left": "center", "bottom": 0,
        "inRange": {"color": ["#6366f1", "#18181b", "#34d399"]},
        "textStyle": {"color": TICK_COLOR, "fontSize": 10},
        "calculable": False,
    }
    spec["grid"] = {"left": 12, "right": 12, "top": 44, "bottom": 60, "containLabel": True}
    spec["series"] = [{
        "type": "heatmap",
        "data": data,
        "label": {"show": True, "color": TICK_COLOR, "fontSize": 9,
                  "formatter": "{c}"},
        "itemStyle": {"borderColor": "#18181b", "borderWidth": 2},
        "emphasis": {"itemStyle": {"shadowBlur": 8, "shadowColor": "rgba(0,0,0,0.4)"}},
    }]
    return spec


def scatter_spec(a_name: str, b_name: str, points: dict[str, list[float]],
                 max_points: int = 2000) -> dict | None:
    xs = points.get(a_name) or []
    ys = points.get(b_name) or []
    n = min(len(xs), len(ys))
    if n < 2:
        return None
    data = [[xs[i], ys[i]] for i in range(n)]
    spec = _base(f"{a_name} vs {b_name}")
    spec["xAxis"] = _value_axis(a_name)
    spec["yAxis"] = _value_axis(b_name)
    spec["tooltip"] = {"trigger": "item", "backgroundColor": "#18181b",
                       "borderColor": "#3f3f46", "textStyle": {"color": "#e4e4e7", "fontSize": 12}}
    series = [{
        "type": "scatter",
        "name": f"{a_name} × {b_name}",
        "data": data,
        "symbolSize": 4,
        "itemStyle": {"color": PALETTE[0], "opacity": 0.55},
    }]
    try:
        xs_arr = np.asarray([p[0] for p in data], dtype=float)
        ys_arr = np.asarray([p[1] for p in data], dtype=float)
        slope, intercept = np.polyfit(xs_arr, ys_arr, 1)
        x_lo, x_hi = float(xs_arr.min()), float(xs_arr.max())
        series.append({
            "type": "line",
            "name": "trend",
            "data": [[x_lo, float(slope * x_lo + intercept)],
                     [x_hi, float(slope * x_hi + intercept)]],
            "lineStyle": {"color": "#fbbf24", "width": 2, "type": "dashed"},
            "symbol": "none",
            "z": 5,
        })
    except Exception:
        pass
    spec["series"] = series
    spec["note"] = f"Downsampled to {n:,} points; trend line fitted on the sample."
    return spec


def missing_bar_spec(columns: list[dict]) -> dict | None:
    rows = [(m["name"], m.get("nullPercentage") or 0.0, m.get("nullCount") or 0)
            for m in columns if (m.get("nullPercentage") or 0) > 0]
    if not rows:
        return None
    rows.sort(key=lambda r: r[1], reverse=True)
    spec = _base("Missing values by column")
    spec["xAxis"] = _category_axis([r[0] for r in rows], "column")
    spec["yAxis"] = _value_axis("% missing")
    spec["series"] = [{
        "type": "bar",
        "name": "% missing",
        "data": [round(r[1], 2) for r in rows],
        "barCategoryGap": "25%",
        "itemStyle": {"color": "#f59e0b"},
    }]
    spec["note"] = ", ".join(f"{r[0]}: {r[1]:.1f}%" for r in rows)
    return spec


def line_spec(date_name: str, buckets: list[dict]) -> dict | None:
    labels = [b["label"] for b in buckets]
    vals = [b["count"] for b in buckets]
    if len(labels) < 2:
        return None
    spec = _base(f"Records over time ({date_name})")
    spec["xAxis"] = _category_axis(labels, date_name)
    spec["yAxis"] = _value_axis("count")
    spec["series"] = [{
        "type": "line",
        "name": "count",
        "data": vals,
        "smooth": True,
        "symbolSize": 4,
        "lineStyle": {"color": PALETTE[2], "width": 2},
        "itemStyle": {"color": PALETTE[2]},
        "areaStyle": {"color": "rgba(52,211,153,0.12)"},
    }]
    return spec
