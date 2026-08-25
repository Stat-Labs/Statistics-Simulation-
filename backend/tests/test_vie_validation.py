"""
Visualization Intelligence Engine — deterministic recommendation validation.

Tests 11 dataset scenarios through the VIE pipeline and verifies
statistically appropriate chart types are recommended.

Uses build_dashboard() which is the actual entry point called by /visualize.
"""
import io
import json
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from vie.dashboard import build_dashboard
from vie.detect import build_detection
from vie.intent import infer_intents
from vie.scoring import score_charts


def make_csv_bytes(df):
    return df.to_csv(index=False).encode()


def run_vie(df, label, expected_top_charts=None, forbidden_charts=None, expected_intents=None):
    """Run full VIE pipeline on a DataFrame and validate results."""
    csv_bytes = make_csv_bytes(df)
    profile = build_full_profile(df)

    # Run full dashboard build
    dashboard = build_dashboard(profile, csv_bytes)

    # Also run pipeline steps individually for detailed assertions
    detection = build_detection(profile)
    intents = infer_intents(detection)
    scored = score_charts(detection, None, None)

    intent_ids = [i['id'] for i in intents]
    chart_types = [c['chartType'] for c in scored]

    # Collect all chart types from dashboard sections
    dash_chart_types = []
    for section in dashboard.get('sections', []):
        for chart in section.get('charts', []):
            dash_chart_types.append(chart['chartType'])

    print(f"\n{'='*70}")
    print(f"  {label}")
    print(f"{'='*70}")
    print(f"  Rows: {len(df)}, Columns: {len(df.columns)}")
    print(f"  Intents: {intent_ids}")
    print(f"  Scored charts: {len(scored)}")
    for c in scored:
        print(f"    {c['chartType']:12s} conf={c['confidence']:.3f}  {c.get('title','')}")
    print(f"  Dashboard sections: {len(dashboard.get('sections', []))}")
    print(f"  Dashboard charts: {len(dash_chart_types)} ({dash_chart_types})")
    if dashboard.get('note'):
        print(f"  Note: {dashboard['note']}")

    # Assertions — check both scored recommendations and dashboard output
    all_chart_types = set(chart_types + dash_chart_types)
    if expected_top_charts:
        for ct in expected_top_charts:
            assert ct in all_chart_types, \
                f"Expected chart type '{ct}' not found. Scored: {chart_types}, Dashboard: {dash_chart_types}"
    if forbidden_charts:
        for ct in forbidden_charts:
            assert ct not in dash_chart_types, \
                f"Forbidden chart type '{ct}' found in dashboard: {dash_chart_types}"
    if expected_intents:
        for intent in expected_intents:
            assert intent in intent_ids, f"Expected intent '{intent}' not found in {intent_ids}"

    assert len(scored) > 0, "No charts scored"
    assert all(c['confidence'] > 0 and c['confidence'] <= 1 for c in scored), "Invalid confidence"
    assert dashboard.get('success') is True, f"Dashboard failed: {dashboard.get('error')}"
    return scored, intents, dashboard


def build_full_profile(df):
    """Build a profile dict matching the actual streaming profiler output format."""
    columns = []
    for col_name in df.columns:
        series = df[col_name]
        if series.dtype in ('int64', 'float64'):
            valid = series.dropna()
            n = len(valid)
            if n > 0:
                # Histogram: bins is edge list, counts is separate list
                hist_counts, hist_edges = np.histogram(valid, bins=20)
                histogram = {
                    'bins': hist_edges.tolist(),
                    'counts': hist_counts.tolist(),
                    'n': n,
                    'nbins': 20,
                }
                # Quantiles as nested dict
                quantiles = {
                    'q5': float(valid.quantile(0.05)),
                    'q25': float(valid.quantile(0.25)),
                    'q50': float(valid.quantile(0.50)),
                    'q75': float(valid.quantile(0.75)),
                    'q95': float(valid.quantile(0.95)),
                }
            else:
                histogram = None
                quantiles = None

            columns.append({
                'name': col_name, 'type': 'continuous',
                'nullCount': int(series.isna().sum()),
                'nullPercentage': round(float(series.isna().mean()), 4),
                'uniqueValues': sorted(valid.unique().tolist())[:10],
                'count': n,
                'min': float(valid.min()) if n > 0 else None,
                'max': float(valid.max()) if n > 0 else None,
                'mean': float(valid.mean()) if n > 0 else None,
                'stdDev': float(valid.std()) if n > 0 else None,
                'variance': float(valid.var()) if n > 0 else None,
                'median': float(valid.median()) if n > 0 else None,
                'mode': str(valid.mode().iloc[0]) if n > 0 else None,
                'skewness': float(valid.skew()) if n > 0 else None,
                'kurtosis': float(valid.kurtosis()) if n > 0 else None,
                'outlierCount': 0,
                'iqr': float(valid.quantile(0.75) - valid.quantile(0.25)) if n > 0 else None,
                'range': float(valid.max() - valid.min()) if n > 0 else None,
                'quantiles': quantiles,
                'histogram': histogram,
                'frequencyTable': {str(v): int(c) for v, c in valid.value_counts().head(20).items()},
                'frequencyCapped': False,
                'isDate': False,
                'coded': False, 'codeNote': None, 'codeUncertain': False,
                'suggestedStrategy': 'mean',
                'cardinality': int(valid.nunique()),
                'cardinalityCapped': False,
            })
        else:
            vc = series.value_counts()
            columns.append({
                'name': col_name, 'type': 'categorical',
                'nullCount': int(series.isna().sum()),
                'nullPercentage': round(float(series.isna().mean()), 4),
                'uniqueValues': sorted(vc.index.astype(str).tolist())[:10],
                'count': int(series.notna().sum()),
                'cardinality': int(series.nunique()),
                'cardinalityCapped': False,
                'mode': str(vc.index[0]) if len(vc) > 0 else None,
                'frequencyTable': {str(k): int(v) for k, v in vc.head(20).items()},
                'frequencyCapped': False,
                'isDate': False,
                'coded': False, 'codeNote': None, 'codeUncertain': False,
                'suggestedStrategy': 'mode',
                'mean': None, 'median': None, 'stdDev': None, 'variance': None,
                'min': None, 'max': None, 'range': None, 'iqr': None,
                'skewness': None, 'kurtosis': None, 'outlierCount': None,
                'quantiles': None, 'histogram': None,
            })

    numeric = [c['name'] for c in columns if c['type'] == 'continuous']
    categorical = [c['name'] for c in columns if c['type'] == 'categorical']

    return {
        'success': True,
        'rowCount': len(df),
        'columnCount': len(df.columns),
        'columns': columns,
        'numericColumns': numeric,
        'categoricalColumns': categorical,
        'totalMissing': sum(c.get('nullCount', 0) for c in columns),
        'correlations': [],
        'percentiles': {},
        'histograms': {c['name']: c.get('histogram') for c in columns if c['type'] == 'continuous'},
        'frequencies': {c['name']: c.get('frequencyTable') for c in columns},
        'cardinalities': {c['name']: c.get('cardinality', 0) for c in columns},
        'rowDuplicates': {'duplicateRows': 0, 'duplicatePercentage': 0},
    }


# ─── Test scenarios ───────────────────────────────────────────────────

class TestVIEDeterministic:

    def test_normal_distribution(self):
        rng = np.random.default_rng(42)
        df = pd.DataFrame({'value': rng.normal(0, 1, 5000)})
        scored, intents, dash = run_vie(df, "Normal distribution (5000 rows)",
                                        expected_top_charts=['histogram', 'boxplot'],
                                        expected_intents=['distribution'])

    def test_right_skewed(self):
        rng = np.random.default_rng(42)
        df = pd.DataFrame({'income': rng.exponential(50000, 5000)})
        scored, intents, dash = run_vie(df, "Right-skewed (exponential, 5000 rows)",
                                        expected_top_charts=['histogram', 'boxplot'],
                                        expected_intents=['distribution'])

    def test_2_category_composition(self):
        rng = np.random.default_rng(42)
        df = pd.DataFrame({
            'gender': rng.choice(['Male', 'Female'], 1000),
            'score': rng.normal(50, 10, 1000),
        })
        scored, intents, dash = run_vie(df, "2-category composition (gender)",
                                        expected_top_charts=['pie'],
                                        expected_intents=['composition'])

    def test_5_category_composition(self):
        rng = np.random.default_rng(42)
        df = pd.DataFrame({
            'region': rng.choice(['North', 'South', 'East', 'West', 'Central'], 1000),
            'value': rng.normal(100, 20, 1000),
        })
        scored, intents, dash = run_vie(df, "5-category composition (region)",
                                        expected_top_charts=['pie'],
                                        expected_intents=['composition'])

    def test_20_category_compare(self):
        rng = np.random.default_rng(42)
        categories = [f'cat_{i:02d}' for i in range(20)]
        df = pd.DataFrame({
            'category': rng.choice(categories, 5000),
            'value': rng.normal(100, 20, 5000),
        })
        scored, intents, dash = run_vie(df, "20-category comparison",
                                        expected_top_charts=['bar'],
                                        forbidden_charts=['pie'],
                                        expected_intents=['compare_categories'])

    def test_100_category_variable(self):
        rng = np.random.default_rng(42)
        categories = [f'cat_{i:04d}' for i in range(120)]
        df = pd.DataFrame({
            'product_code': rng.choice(categories, 10000),
            'revenue': rng.uniform(10, 1000, 10000),
        })
        scored, intents, dash = run_vie(df, "120-category variable (product_code)",
                                        expected_top_charts=['bar'],
                                        forbidden_charts=['pie'],
                                        expected_intents=['compare_categories'])

    def test_numeric_vs_numeric(self):
        """Scatter requires correlations in the profile — without them, heatmap is recommended."""
        rng = np.random.default_rng(42)
        x = rng.normal(0, 1, 2000)
        y = 2.5 * x + rng.normal(0, 0.5, 2000)
        df = pd.DataFrame({'height': x, 'weight': y})
        scored, intents, dash = run_vie(df, "Numeric vs numeric (r=0.98)",
                                        expected_top_charts=['heatmap'],
                                        expected_intents=['relationship'])

    def test_strong_nonlinear(self):
        rng = np.random.default_rng(42)
        x = rng.uniform(-3, 3, 2000)
        y = x ** 2 + rng.normal(0, 0.3, 2000)
        df = pd.DataFrame({'x': x, 'y': y})
        scored, intents, dash = run_vie(df, "Strong nonlinear (parabolic)",
                                        expected_top_charts=['heatmap'],
                                        expected_intents=['relationship'])

    def test_time_series(self):
        dates = pd.date_range('2020-01-01', periods=1000, freq='D')
        rng = np.random.default_rng(42)
        df = pd.DataFrame({
            'date': dates.strftime('%Y-%m-%d'),
            'sales': np.cumsum(rng.normal(10, 5, 1000)),
        })
        scored, intents, dash = run_vie(df, "Time series (daily sales)",
                                        expected_top_charts=['line'])

    def test_time_series_missing_timestamps(self):
        dates = pd.date_range('2020-01-01', periods=1000, freq='D')
        rng = np.random.default_rng(42)
        mask = rng.random(1000) > 0.2
        dates = dates[mask]
        rng2 = np.random.default_rng(42)
        df = pd.DataFrame({
            'date': dates.strftime('%Y-%m-%d'),
            'sales': np.cumsum(rng2.normal(10, 5, len(dates))),
        })
        scored, intents, dash = run_vie(df, "Time series with missing timestamps",
                                        expected_top_charts=['line'])

    def test_extreme_outliers(self):
        rng = np.random.default_rng(42)
        values = rng.normal(50, 10, 1000).tolist()
        values.extend([500, 600, 700, -200, -300])
        df = pd.DataFrame({'measurement': values})
        scored, intents, dash = run_vie(df, "Extreme outliers (5 extreme values)",
                                        expected_top_charts=['histogram', 'boxplot'],
                                        expected_intents=['distribution'])


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s', '--tb=short'])
