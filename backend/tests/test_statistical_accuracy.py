"""
Comprehensive statistical accuracy verification.

Runs StatLab's streaming and in-memory implementations against numpy/scipy
reference implementations on synthetic datasets with known properties.
"""
import math
import os
import sys
import tracemalloc

import numpy as np
import pandas as pd
import pytest
from scipy import stats as scipy_stats

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stats.streaming import Moments, TwoPassCentral, TDigest, Histogram, Correlation, HyperLogLog
from stats.descriptive import compute_descriptive
from stats.inferential import compute_correlations, compute_regression
from stats.parser import parse_file

# ---------------------------------------------------------------------------
# Tolerances
# ---------------------------------------------------------------------------
RTOL_MEAN = 1e-10
RTOL_VAR = 1e-6
RTOL_SKEW = 1e-4
RTOL_KURT = 1e-4
RTOL_CORR = 1e-4
RTOL_REG_COEF = 1e-6
ATOL_QUANTILE = 0.05


# ---------------------------------------------------------------------------
# Synthetic dataset generators
# ---------------------------------------------------------------------------

def make_normal(n=10000, mean=50.0, std=10.0, seed=42):
    rng = np.random.default_rng(seed)
    vals = rng.normal(mean, std, n)
    df = pd.DataFrame({
        'value': vals,
        'category': rng.choice(['A', 'B', 'C'], n),
        'group': rng.choice(['X', 'Y'], n),
    })
    return df

def make_skewed(n=10000, seed=42):
    rng = np.random.default_rng(seed)
    vals = rng.exponential(2.0, n)
    df = pd.DataFrame({
        'value': vals,
        'log_value': np.log1p(vals),
        'category': rng.choice(['A', 'B', 'C', 'D', 'E'], n),
    })
    return df

def make_correlated(n=5000, r=0.85, seed=42):
    rng = np.random.default_rng(seed)
    cov = np.array([[1, r], [r, 1]])
    vals = rng.multivariate_normal([0, 0], cov, n)
    df = pd.DataFrame({
        'x': vals[:, 0],
        'y': vals[:, 1],
        'z': rng.normal(5, 2, n),
    })
    return df

def make_regression(n=5000, seed=42):
    rng = np.random.default_rng(seed)
    x1 = rng.normal(0, 1, n)
    x2 = rng.normal(0, 1, n)
    noise = rng.normal(0, 0.5, n)
    y = 3.0 + 2.0 * x1 - 1.5 * x2 + noise
    df = pd.DataFrame({'y': y, 'x1': x1, 'x2': x2})
    return df


# ---------------------------------------------------------------------------
# Tests: Streaming Moments vs numpy
# ---------------------------------------------------------------------------

class TestStreamingMoments:
    def test_mean_matches_numpy(self):
        df = make_normal(50000)
        m = Moments.from_array(df['value'].values)
        np_mean = df['value'].mean()
        assert m.mean == pytest.approx(np_mean, rel=RTOL_MEAN)

    def test_variance_matches_numpy(self):
        df = make_normal(50000)
        m = Moments.from_array(df['value'].values)
        # Moments.variance(ddof=0) is population variance
        np_var = df['value'].var(ddof=0)
        assert m.variance(ddof=0) == pytest.approx(np_var, rel=RTOL_VAR)

    def test_std_matches_numpy(self):
        df = make_normal(50000)
        m = Moments.from_array(df['value'].values)
        np_std = df['value'].std(ddof=0)
        assert m.std(ddof=0) == pytest.approx(np_std, rel=RTOL_VAR)

    def test_min_max_exact(self):
        df = make_normal(50000)
        m = Moments.from_array(df['value'].values)
        assert m.min == df['value'].min()
        assert m.max == df['value'].max()

    def test_sum_exact(self):
        df = make_normal(50000)
        m = Moments.from_array(df['value'].values)
        assert m.sum_ == pytest.approx(df['value'].sum(), rel=RTOL_MEAN)

    def test_count_exact(self):
        df = make_normal(50000)
        m = Moments.from_array(df['value'].values)
        assert m.count == 50000

    def test_merge_matches_batch(self):
        df = make_normal(100000)
        vals = df['value'].values
        mid = len(vals) // 2
        m1 = Moments.from_array(vals[:mid])
        m2 = Moments.from_array(vals[mid:])
        m1.merge(m2)
        np_mean = vals.mean()
        np_var = vals.var(ddof=0)
        assert m1.mean == pytest.approx(np_mean, rel=RTOL_MEAN)
        assert m1.variance(ddof=0) == pytest.approx(np_var, rel=RTOL_VAR)

    def test_incremental_update(self):
        rng = np.random.default_rng(42)
        vals = rng.normal(0, 1, 10000)
        m = Moments()
        for v in vals:
            m.update(float(v))
        assert m.mean == pytest.approx(vals.mean(), rel=RTOL_MEAN)
        assert m.variance(ddof=0) == pytest.approx(vals.var(ddof=0), rel=RTOL_VAR)
        assert m.count == 10000

    def test_with_nan_values(self):
        rng = np.random.default_rng(99)
        vals = rng.normal(0, 1, 10000).astype(float)
        vals[100] = np.nan
        vals[5000] = np.nan
        clean = vals[~np.isnan(vals)]
        m = Moments.from_array(vals)
        assert m.count == len(clean)


# ---------------------------------------------------------------------------
# Tests: TwoPassCentral skewness/kurtosis vs scipy
# ---------------------------------------------------------------------------

class TestTwoPassCentral:
    def _compute_skew_kurt(self, vals):
        m = Moments.from_array(vals)
        tp = TwoPassCentral(m.mean)
        for v in vals:
            if not math.isnan(float(v)):
                tp.update(float(v))
        return tp

    def test_skewness_normal(self):
        df = make_normal(10000)
        tp = self._compute_skew_kurt(df['value'].values)
        scipy_skew = scipy_stats.skew(df['value'].values, bias=True)
        assert tp.skewness() == pytest.approx(scipy_skew, abs=RTOL_SKEW)

    def test_kurtosis_normal(self):
        df = make_normal(10000)
        tp = self._compute_skew_kurt(df['value'].values)
        scipy_kurt = scipy_stats.kurtosis(df['value'].values, fisher=True, bias=True)
        assert tp.kurtosis() == pytest.approx(scipy_kurt, abs=RTOL_KURT)

    def test_skewness_skewed(self):
        df = make_skewed(10000)
        tp = self._compute_skew_kurt(df['value'].values)
        scipy_skew = scipy_stats.skew(df['value'].values, bias=True)
        assert tp.skewness() == pytest.approx(scipy_skew, abs=RTOL_SKEW)

    def test_kurtosis_heavy_tailed(self):
        rng = np.random.default_rng(42)
        vals = rng.standard_t(df=5, size=10000)
        tp = self._compute_skew_kurt(vals)
        scipy_kurt = scipy_stats.kurtosis(vals, fisher=True, bias=True)
        assert tp.kurtosis() == pytest.approx(scipy_kurt, abs=RTOL_KURT)

    def test_small_sample_returns_zero(self):
        tp = TwoPassCentral(1.5)
        tp.update(1.0)
        tp.update(2.0)
        assert tp.skewness() == 0.0
        assert tp.kurtosis() == 0.0


# ---------------------------------------------------------------------------
# Tests: TDigest quantile accuracy
# ---------------------------------------------------------------------------

class TestTDigest:
    def test_median_accuracy(self):
        df = make_normal(50000)
        td = TDigest(delta=0.01)
        td.add_many(df['value'].values)
        np_median = np.percentile(df['value'].values, 50)
        assert td.quantile(0.5) == pytest.approx(np_median, abs=ATOL_QUANTILE)

    def test_quartile_accuracy(self):
        df = make_normal(50000)
        td = TDigest(delta=0.01)
        td.add_many(df['value'].values)
        vals = df['value'].values
        q25 = np.percentile(vals, 25)
        q75 = np.percentile(vals, 75)
        assert td.quantile(0.25) == pytest.approx(q25, abs=ATOL_QUANTILE)
        assert td.quantile(0.75) == pytest.approx(q75, abs=ATOL_QUANTILE)

    def test_extreme_quantiles(self):
        df = make_normal(50000)
        td = TDigest(delta=0.01)
        td.add_many(df['value'].values)
        vals = df['value'].values
        assert td.quantile(0.01) == pytest.approx(np.percentile(vals, 1), abs=0.5)
        assert td.quantile(0.99) == pytest.approx(np.percentile(vals, 99), abs=0.5)

    def test_merge_preserves_accuracy(self):
        rng = np.random.default_rng(42)
        vals = rng.normal(50, 10, 100000)
        mid = len(vals) // 2
        td1 = TDigest(delta=0.01)
        td1.add_many(vals[:mid])
        td2 = TDigest(delta=0.01)
        td2.add_many(vals[mid:])
        td1.merge(td2)
        np_median = np.percentile(vals, 50)
        assert td1.quantile(0.5) == pytest.approx(np_median, abs=ATOL_QUANTILE)

    def test_single_value(self):
        td = TDigest()
        td.add(42.0)
        assert td.quantile(0.5) == pytest.approx(42.0, abs=0.01)


# ---------------------------------------------------------------------------
# Tests: Correlation vs numpy
# ---------------------------------------------------------------------------

class TestCorrelation:
    def test_pearson_r_exact(self):
        df = make_correlated(10000, r=0.85)
        corr = Correlation.from_arrays(df['x'].values, df['y'].values)
        np_r = np.corrcoef(df['x'].values, df['y'].values)[0, 1]
        assert corr.pearson_r() == pytest.approx(np_r, rel=RTOL_CORR)

    def test_zero_correlation(self):
        rng = np.random.default_rng(42)
        x = rng.normal(0, 1, 10000)
        y = rng.normal(0, 1, 10000)
        corr = Correlation.from_arrays(x, y)
        np_r = np.corrcoef(x, y)[0, 1]
        assert corr.pearson_r() == pytest.approx(np_r, abs=0.02)

    def test_perfect_negative(self):
        rng = np.random.default_rng(42)
        x = rng.normal(0, 1, 5000)
        corr = Correlation.from_arrays(x, -x)
        assert corr.pearson_r() == pytest.approx(-1.0, abs=1e-10)

    def test_regression_slope_intercept(self):
        df = make_regression(5000)
        corr = Correlation.from_arrays(df['x1'].values, df['y'].values)
        ols = corr.ols()
        np_coeffs = np.polyfit(df['x1'].values, df['y'].values, 1)
        assert ols['slope'] == pytest.approx(np_coeffs[0], rel=RTOL_REG_COEF)
        assert ols['intercept'] == pytest.approx(np_coeffs[1], rel=RTOL_REG_COEF)

    def test_r_squared_matches(self):
        df = make_regression(5000)
        corr = Correlation.from_arrays(df['x1'].values, df['y'].values)
        ols = corr.ols()
        assert corr.pearson_r() ** 2 == pytest.approx(ols['rSquared'], abs=1e-10)

    def test_merge_correlation(self):
        rng = np.random.default_rng(42)
        x = rng.normal(0, 1, 10000)
        y = 2 * x + rng.normal(0, 0.1, 10000)
        mid = 5000
        c1 = Correlation.from_arrays(x[:mid], y[:mid])
        c2 = Correlation.from_arrays(x[mid:], y[mid:])
        c1.merge(c2)
        np_r = np.corrcoef(x, y)[0, 1]
        assert c1.pearson_r() == pytest.approx(np_r, rel=RTOL_CORR)


# ---------------------------------------------------------------------------
# Tests: In-memory descriptive stats vs scipy
# ---------------------------------------------------------------------------

class TestDescriptiveStats:
    def test_mean_median_std(self):
        df = make_normal(10000)
        result = compute_descriptive(df, ['value'])
        assert len(result) == 1
        r = result[0]
        assert r.mean == pytest.approx(df['value'].mean(), rel=RTOL_MEAN)
        assert r.median == pytest.approx(df['value'].median(), rel=RTOL_MEAN)
        assert r.stdDev == pytest.approx(df['value'].std(ddof=1), rel=RTOL_VAR)

    def test_variance_ddof1(self):
        df = make_normal(10000)
        result = compute_descriptive(df, ['value'])
        assert result[0].variance == pytest.approx(df['value'].var(ddof=1), rel=RTOL_VAR)

    def test_skewness_matches_scipy(self):
        df = make_skewed(10000)
        result = compute_descriptive(df, ['value'])
        scipy_skew = scipy_stats.skew(df['value'].values, bias=True)
        assert result[0].skewness == pytest.approx(scipy_skew, abs=RTOL_SKEW)

    def test_kurtosis_matches_scipy(self):
        df = make_normal(10000)
        result = compute_descriptive(df, ['value'])
        scipy_kurt = scipy_stats.kurtosis(df['value'].values, fisher=True, bias=True)
        assert result[0].kurtosis == pytest.approx(scipy_kurt, abs=RTOL_KURT)

    def test_iqr(self):
        df = make_normal(10000)
        result = compute_descriptive(df, ['value'])
        q75 = np.percentile(df['value'].values, 75)
        q25 = np.percentile(df['value'].values, 25)
        assert result[0].iqr == pytest.approx(q75 - q25, rel=RTOL_VAR)

    def test_outlier_count(self):
        rng = np.random.default_rng(42)
        vals = np.concatenate([rng.normal(0, 1, 990), np.array([100, -100, 200, -200] * 2)])
        df = pd.DataFrame({'value': vals})
        result = compute_descriptive(df, ['value'])
        q75 = np.percentile(vals, 75)
        q25 = np.percentile(vals, 25)
        iqr = q75 - q25
        expected_outliers = int(np.sum((vals < q25 - 1.5 * iqr) | (vals > q75 + 1.5 * iqr)))
        assert result[0].outlierCount == expected_outliers


# ---------------------------------------------------------------------------
# Tests: Regression vs numpy.lstsq
# ---------------------------------------------------------------------------

class TestRegression:
    def test_simple_regression_coefficients(self):
        df = make_regression(5000)
        results = compute_regression(df, 'y', ['x1', 'x2'])
        X = np.column_stack([np.ones(len(df)), df['x1'].values, df['x2'].values])
        y = df['y'].values
        np_coef, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
        assert results.intercept == pytest.approx(np_coef[0], rel=RTOL_REG_COEF)
        assert results.coefficients[0] == pytest.approx(np_coef[1], rel=RTOL_REG_COEF)
        assert results.coefficients[1] == pytest.approx(np_coef[2], rel=RTOL_REG_COEF)

    def test_r_squared(self):
        df = make_regression(5000)
        results = compute_regression(df, 'y', ['x1', 'x2'])
        X = np.column_stack([np.ones(len(df)), df['x1'].values, df['x2'].values])
        y = df['y'].values
        np_coef, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
        y_pred = X @ np_coef
        ss_res = np.sum((y - y_pred) ** 2)
        ss_tot = np.sum((y - y.mean()) ** 2)
        expected_r2 = 1 - ss_res / ss_tot
        assert results.rSquared == pytest.approx(expected_r2, abs=0.01)

    def test_predictions_match(self):
        df = make_regression(5000)
        results = compute_regression(df, 'y', ['x1', 'x2'])
        X = np.column_stack([np.ones(len(df)), df['x1'].values, df['x2'].values])
        np_coef, _, _, _ = np.linalg.lstsq(X, df['y'].values, rcond=None)
        expected_preds = (X @ np_coef).tolist()
        for i in range(0, len(results.predictions), max(1, len(results.predictions) // 100)):
            assert results.predictions[i] == pytest.approx(expected_preds[i], rel=RTOL_REG_COEF)

    def test_residuals_sum_to_zero(self):
        df = make_regression(5000)
        results = compute_regression(df, 'y', ['x1', 'x2'])
        if results.residuals:
            assert sum(results.residuals) == pytest.approx(0.0, abs=1.0)


# ---------------------------------------------------------------------------
# Tests: Correlation computation (inferential.py)
# ---------------------------------------------------------------------------

class TestInferentialCorrelation:
    def test_pearson_correlation(self):
        df = make_correlated(5000, r=0.85)
        results = compute_correlations(df, [('x', 'y')], {'x': 'continuous', 'y': 'continuous'})
        np_r = np.corrcoef(df['x'].values, df['y'].values)[0, 1]
        assert len(results) == 1
        assert results[0].r == pytest.approx(np_r, abs=0.01)

    def test_p_value(self):
        df = make_correlated(5000, r=0.5)
        results = compute_correlations(df, [('x', 'y')], {'x': 'continuous', 'y': 'continuous'})
        assert results[0].pValue < 0.01

    def test_confidence_interval(self):
        df = make_correlated(5000, r=0.5)
        results = compute_correlations(df, [('x', 'y')], {'x': 'continuous', 'y': 'continuous'})
        ci_lower = results[0].confidenceIntervalLower
        ci_upper = results[0].confidenceIntervalUpper
        assert ci_lower is not None
        assert ci_upper is not None
        assert ci_lower < results[0].r < ci_upper


# ---------------------------------------------------------------------------
# Tests: Parse + full pipeline
# ---------------------------------------------------------------------------

class TestParsePipeline:
    def test_normal_dataset_parse(self):
        df = make_normal(1000)
        csv = df.to_csv(index=False)
        schema, parsed_df, missing = parse_file(csv.encode(), 'test.csv')
        assert schema.rowCount == 1000
        assert schema.columnCount == 3

    def test_missing_value_detection(self):
        rng = np.random.default_rng(42)
        vals = rng.normal(0, 1, 1000).astype(object)
        vals[100] = None
        vals[200] = None
        df = pd.DataFrame({'x': vals, 'y': range(1000)})
        csv = df.to_csv(index=False)
        schema, parsed_df, missing = parse_file(csv.encode(), 'test.csv')
        assert missing.byColumn['x'].count == 2


# ---------------------------------------------------------------------------
# Tests: Memory measurement
# ---------------------------------------------------------------------------

class TestMemoryUsage:
    def test_streaming_moments_100k(self):
        rng = np.random.default_rng(42)
        vals = rng.normal(0, 1, 100000)
        tracemalloc.start()
        m = Moments.from_array(vals)
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        peak_mb = peak / 1024 / 1024
        assert peak_mb < 50, f"Peak memory {peak_mb:.1f}MB exceeds 50MB"

    def test_tdigest_200k(self):
        rng = np.random.default_rng(42)
        vals = rng.normal(0, 1, 200000)
        tracemalloc.start()
        td = TDigest(delta=0.01)
        td.add_many(vals)
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        peak_mb = peak / 1024 / 1024
        assert peak_mb < 50, f"Peak memory {peak_mb:.1f}MB exceeds 50MB"

    def test_histogram_100k(self):
        rng = np.random.default_rng(42)
        vals = rng.normal(0, 1, 100000)
        tracemalloc.start()
        h = Histogram(min_value=float(np.min(vals)), max_value=float(np.max(vals)), nbins=50)
        h.update_many(vals)
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        peak_mb = peak / 1024 / 1024
        assert peak_mb < 50, f"Peak memory {peak_mb:.1f}MB exceeds 50MB"


# ---------------------------------------------------------------------------
# Tests: Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:
    def test_single_value(self):
        m = Moments()
        m.update(42.0)
        assert m.mean == 42.0
        assert m.variance() == 0.0
        assert m.count == 1

    def test_identical_values(self):
        m = Moments.from_array(np.ones(10000))
        assert m.mean == 1.0
        assert m.variance() == 0.0

    def test_very_large_values(self):
        m = Moments()
        m.update(1e15)
        m.update(1e15 + 1)
        m.update(1e15 + 2)
        assert m.mean == pytest.approx(1e15 + 1, rel=1e-10)

    def test_very_small_values(self):
        m = Moments()
        m.update(1e-15)
        m.update(2e-15)
        m.update(3e-15)
        assert m.mean == pytest.approx(2e-15, rel=1e-10)

    def test_all_nan_column(self):
        vals = np.array([np.nan] * 100)
        m = Moments.from_array(vals)
        assert m.count == 0

    def test_empty_array(self):
        m = Moments.from_array(np.array([]))
        assert m.count == 0

    def test_hyperloglog_approximate(self):
        rng = np.random.default_rng(42)
        vals = rng.integers(0, 10000, size=50000)
        hll = HyperLogLog(p=14)
        for v in vals:
            hll.update(int(v))
        exact = len(set(vals))
        estimated = hll.estimate()
        error = abs(estimated - exact) / exact
        assert error < 0.05, f"HLL error {error:.3f} exceeds 5%"


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
