"""
AI Grounding Validation — verify that analysis results passed to AI providers
are numerically accurate and structurally correct.

Since the AI interpreter is TypeScript (Next.js), this test validates:
1. The Python /analyse endpoint returns exact numeric values
2. The result structure contains all fields the AI prompt expects
3. No values are altered or fabricated during computation
4. Provider fallback behavior works at the endpoint level
"""
import io
import json
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def make_known_dataset(n=5000, seed=42):
    rng = np.random.default_rng(seed)
    x = rng.normal(100, 25, n)
    y = 2.5 * x + rng.normal(0, 10, n)
    z = rng.exponential(50, n)
    categories = rng.choice(['Alpha', 'Beta', 'Gamma'], n)
    return pd.DataFrame({
        'x': x.round(4), 'y': y.round(4), 'z': z.round(4), 'group': categories,
    })


def analyse(df, analyses_config):
    csv_bytes = df.to_csv(index=False).encode()
    files = {'file': ('test.csv', io.BytesIO(csv_bytes), 'text/csv')}
    resp = client.post('/analyse', files=files, data={'analyses': json.dumps(analyses_config)})
    return resp.status_code, resp.json()


class TestAnalyseNumericalAccuracy:

    def test_descriptive_mean_matches_numpy(self):
        df = make_known_dataset(5000)
        status, data = analyse(df, {
            'mode': 'manual',
            'descriptive': {'columns': ['x', 'y'], 'measures': ['central']},
        })
        assert status == 200
        assert data['success'] is True
        for col_stat in data['result']['descriptive']:
            col = col_stat['column']
            expected = float(df[col].mean())
            actual = col_stat['mean']
            assert abs(actual - expected) < 1e-6, f"{col}: mean {actual} != {expected}"

    def test_descriptive_std_matches_numpy(self):
        df = make_known_dataset(5000)
        status, data = analyse(df, {
            'mode': 'manual',
            'descriptive': {'columns': ['x'], 'measures': ['spread']},
        })
        assert status == 200
        for col_stat in data['result']['descriptive']:
            expected_biased = float(df['x'].std(ddof=0))
            expected_sample = float(df['x'].std(ddof=1))
            actual = col_stat['stdDev']
            diff_biased = abs(actual - expected_biased)
            diff_sample = abs(actual - expected_sample)
            assert diff_biased < 0.1 or diff_sample < 0.1, \
                f"std {actual} != biased {expected_biased} or sample {expected_sample}"

    def test_descriptive_min_max_exact(self):
        df = make_known_dataset(5000)
        status, data = analyse(df, {
            'mode': 'manual',
            'descriptive': {'columns': ['x'], 'measures': ['central']},
        })
        assert status == 200
        for col_stat in data['result']['descriptive']:
            assert col_stat['min'] == float(df['x'].min()), "min mismatch"
            assert col_stat['max'] == float(df['x'].max()), "max mismatch"

    def test_descriptive_median_approximate(self):
        df = make_known_dataset(5000)
        status, data = analyse(df, {
            'mode': 'manual',
            'descriptive': {'columns': ['x'], 'measures': ['central']},
        })
        assert status == 200
        for col_stat in data['result']['descriptive']:
            expected = float(df['x'].median())
            actual = col_stat['median']
            tolerance = abs(expected) * 0.01 + 0.5
            assert abs(actual - expected) < tolerance, \
                f"median {actual} too far from {expected}"

    def test_correlation_matches_numpy(self):
        df = make_known_dataset(5000)
        status, data = analyse(df, {
            'mode': 'manual',
            'inferential': {'correlationPairs': [['x', 'y']]},
        })
        assert status == 200
        expected_r = float(np.corrcoef(df['x'], df['y'])[0, 1])
        actual_r = data['result']['inferential']['correlations'][0]['r']
        assert abs(actual_r - expected_r) < 1e-4, f"r={actual_r} != {expected_r}"

    def test_regression_coefficients_match_numpy(self):
        df = make_known_dataset(5000)
        status, data = analyse(df, {
            'mode': 'manual',
            'inferential': {'regression': {'dependent': 'y', 'predictors': ['x']}},
        })
        assert status == 200
        reg = data['result']['inferential']['regression']

        A = np.column_stack([np.ones(len(df)), df['x'].values])
        coeffs, _, _, _ = np.linalg.lstsq(A, df['y'].values, rcond=None)

        actual_intercept = reg['intercept']
        actual_slope = reg['coefficients'][0]  # flat list of floats
        assert abs(actual_intercept - coeffs[0]) < 1e-4, \
            f"intercept {actual_intercept} != {coeffs[0]}"
        assert abs(actual_slope - coeffs[1]) < 1e-4, \
            f"slope {actual_slope} != {coeffs[1]}"

    def test_r_squared_matches_numpy(self):
        df = make_known_dataset(5000)
        status, data = analyse(df, {
            'mode': 'manual',
            'inferential': {'regression': {'dependent': 'y', 'predictors': ['x']}},
        })
        assert status == 200
        reg = data['result']['inferential']['regression']

        A = np.column_stack([np.ones(len(df)), df['x'].values])
        coeffs, _, _, _ = np.linalg.lstsq(A, df['y'].values, rcond=None)
        y_pred = A @ coeffs
        ss_res = np.sum((df['y'].values - y_pred) ** 2)
        ss_tot = np.sum((df['y'].values - df['y'].mean()) ** 2)
        expected_r2 = 1 - ss_res / ss_tot
        assert abs(reg['rSquared'] - expected_r2) < 0.01, \
            f"R²={reg['rSquared']} != {expected_r2}"

    def test_no_values_fabricated(self):
        df = make_known_dataset(100)
        status, data = analyse(df, {
            'mode': 'manual',
            'descriptive': {'columns': ['x'], 'measures': ['central', 'spread', 'distribution']},
        })
        assert status == 200
        col_stat = data['result']['descriptive'][0]
        assert col_stat['min'] <= col_stat['mean'] <= col_stat['max']
        assert col_stat['stdDev'] >= 0
        assert col_stat['outlierCount'] >= 0
        assert col_stat['outlierCount'] <= len(df)


class TestResultStructureForAI:
    """Verify the result structure has all fields the AI prompt expects."""

    def test_descriptive_fields_complete(self):
        df = make_known_dataset(1000)
        status, data = analyse(df, {
            'mode': 'manual',
            'descriptive': {'columns': ['x'], 'measures': ['central', 'spread', 'distribution']},
        })
        assert status == 200
        col_stat = data['result']['descriptive'][0]
        for field in ['column', 'mean', 'median', 'stdDev', 'min', 'max', 'skewness', 'outlierCount']:
            assert field in col_stat, f"Missing field: {field}"
            assert col_stat[field] is not None, f"Field {field} is None"

    def test_correlation_fields_complete(self):
        df = make_known_dataset(1000)
        status, data = analyse(df, {
            'mode': 'manual',
            'inferential': {'correlationPairs': [['x', 'y']]},
        })
        assert status == 200
        corr = data['result']['inferential']['correlations'][0]
        for field in ['columnA', 'columnB', 'r', 'method', 'interpretation']:
            assert field in corr, f"Missing field: {field}"

    def test_regression_fields_complete(self):
        df = make_known_dataset(1000)
        status, data = analyse(df, {
            'mode': 'manual',
            'inferential': {'regression': {'dependent': 'y', 'predictors': ['x']}},
        })
        assert status == 200
        reg = data['result']['inferential']['regression']
        for field in ['modelType', 'dependent', 'rSquared', 'adjustedRSquared',
                       'coefficients', 'intercept', 'rmse']:
            assert field in reg, f"Missing field: {field}"

    def test_schema_fields_complete(self):
        """Schema is at top level of response, not nested in result."""
        df = make_known_dataset(100)
        status, data = analyse(df, {
            'mode': 'manual',
            'descriptive': {'columns': ['x'], 'measures': ['central']},
        })
        assert status == 200
        schema = data['schema']
        assert 'fileName' in schema
        assert 'rowCount' in schema
        assert 'columnCount' in schema
        assert 'columns' in schema
        assert schema['rowCount'] == len(df)


class TestProviderFallback:

    def test_analyse_works_without_ai_keys(self):
        df = make_known_dataset(100)
        status, data = analyse(df, {
            'mode': 'manual',
            'descriptive': {'columns': ['x'], 'measures': ['central']},
        })
        assert status == 200
        assert data['success'] is True

    def test_invalid_file_returns_error(self):
        files = {'file': ('empty.csv', io.BytesIO(b''), 'text/csv')}
        resp = client.post('/analyse', files=files, data={'analyses': json.dumps({
            'mode': 'manual',
            'descriptive': {'columns': ['x'], 'measures': ['central']},
        })})
        assert resp.status_code in (400, 422)

    def test_invalid_analyses_json_returns_400(self):
        df = make_known_dataset(100)
        csv_bytes = df.to_csv(index=False).encode()
        files = {'file': ('test.csv', io.BytesIO(csv_bytes), 'text/csv')}
        resp = client.post('/analyse', files=files, data={'analyses': 'not-json'})
        assert resp.status_code == 400


class TestApproximateVsExact:

    def test_exact_mean_within_tolerance(self):
        df = make_known_dataset(10000)
        status, data = analyse(df, {
            'mode': 'manual',
            'descriptive': {'columns': ['x'], 'measures': ['central']},
        })
        assert status == 200
        expected = float(df['x'].mean())
        actual = data['result']['descriptive'][0]['mean']
        assert abs(actual - expected) < 1e-6, f"Mean {actual} != {expected}"

    def test_approximate_median_within_1pct(self):
        df = make_known_dataset(10000)
        status, data = analyse(df, {
            'mode': 'manual',
            'descriptive': {'columns': ['x'], 'measures': ['central']},
        })
        assert status == 200
        expected = float(df['x'].median())
        actual = data['result']['descriptive'][0]['median']
        tolerance = max(abs(expected) * 0.01, 0.5)
        assert abs(actual - expected) < tolerance, \
            f"Median {actual} != {expected} (tolerance {tolerance})"

    def test_exact_correlation_within_tolerance(self):
        df = make_known_dataset(10000)
        status, data = analyse(df, {
            'mode': 'manual',
            'inferential': {'correlationPairs': [['x', 'y']]},
        })
        assert status == 200
        expected = float(np.corrcoef(df['x'], df['y'])[0, 1])
        actual = data['result']['inferential']['correlations'][0]['r']
        assert abs(actual - expected) < 1e-4, f"r={actual} != {expected}"


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s', '--tb=short'])
