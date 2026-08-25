"""
Large dataset stress test — synthetic data at multiple sizes.

Measures processing time, peak memory, and accuracy for each size.
"""
import gc
import io
import os
import sys
import time
import tracemalloc

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stats.streaming import Moments, TwoPassCentral, TDigest, Histogram, Correlation
from stats.descriptive import compute_descriptive
from stats.inferential import compute_correlations, compute_regression
from stats.parser import parse_file


def generate_dataset(rows, cols=10, seed=42):
    """Generate a synthetic CSV dataset with known properties."""
    rng = np.random.default_rng(seed)
    data = {}
    for i in range(cols):
        if i % 3 == 0:
            data[f'num_{i}'] = rng.normal(100, 15, rows)
        elif i % 3 == 1:
            data[f'cat_{i}'] = rng.choice(['A', 'B', 'C', 'D', 'E'], rows)
        else:
            data[f'uni_{i}'] = rng.uniform(0, 100, rows)
    df = pd.DataFrame(data)
    return df.to_csv(index=False).encode()


def measure_operation(name, fn, *args, **kwargs):
    """Run a function and measure time + peak memory."""
    gc.collect()
    tracemalloc.start()
    t0 = time.perf_counter()
    result = fn(*args, **kwargs)
    elapsed = time.perf_counter() - t0
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    gc.collect()
    return {
        'operation': name,
        'elapsed_s': round(elapsed, 3),
        'peak_mb': round(peak / 1024 / 1024, 1),
        'result': result,
    }


class TestStressStreaming:
    """Test streaming operations at various dataset sizes."""

    @pytest.mark.parametrize("rows", [10000, 50000, 100000, 500000])
    def test_moments_scaling(self, rows):
        rng = np.random.default_rng(42)
        vals = rng.normal(0, 1, rows)
        m = measure_operation(f'Moments({rows})', Moments.from_array, vals)
        assert m['peak_mb'] < 100, f"Memory {m['peak_mb']}MB too high for {rows} rows"
        # Verify accuracy
        result = m['result']
        assert result.mean == pytest.approx(vals.mean(), rel=1e-10)
        assert result.variance(ddof=0) == pytest.approx(vals.var(ddof=0), rel=1e-6)

    @pytest.mark.parametrize("rows", [10000, 50000, 100000, 500000])
    def test_tdigest_scaling(self, rows):
        rng = np.random.default_rng(42)
        vals = rng.normal(0, 1, rows)
        td = measure_operation(f'TDigest({rows})', TDigest, delta=0.01)
        # Actually add values
        tracemalloc.start()
        t0 = time.perf_counter()
        td_obj = TDigest(delta=0.01)
        td_obj.add_many(vals)
        elapsed = time.perf_counter() - t0
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        assert peak / 1024 / 1024 < 100, f"Memory too high for {rows} rows"
        # Verify quantile accuracy
        np_median = np.percentile(vals, 50)
        assert td_obj.quantile(0.5) == pytest.approx(np_median, abs=0.1)

    @pytest.mark.parametrize("rows", [10000, 50000, 100000])
    def test_correlation_scaling(self, rows):
        rng = np.random.default_rng(42)
        x = rng.normal(0, 1, rows)
        y = 2 * x + rng.normal(0, 0.1, rows)
        corr = measure_operation(f'Correlation({rows})', Correlation.from_arrays, x, y)
        assert corr['peak_mb'] < 100
        np_r = np.corrcoef(x, y)[0, 1]
        assert corr['result'].pearson_r() == pytest.approx(np_r, rel=1e-4)


class TestStressDescriptive:
    """Test in-memory descriptive stats at various sizes."""

    @pytest.mark.parametrize("rows", [10000, 50000, 100000])
    def test_descriptive_scaling(self, rows):
        rng = np.random.default_rng(42)
        df = pd.DataFrame({
            'a': rng.normal(0, 1, rows),
            'b': rng.uniform(0, 100, rows),
        })
        gc.collect()
        tracemalloc.start()
        t0 = time.perf_counter()
        result = compute_descriptive(df, ['a', 'b'])
        elapsed = time.perf_counter() - t0
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        assert peak / 1024 / 1024 < 200, f"Memory too high for {rows} rows"
        assert len(result) == 2


class TestStressRegression:
    """Test regression at various sizes."""

    @pytest.mark.parametrize("rows", [1000, 5000, 10000, 50000])
    def test_regression_scaling(self, rows):
        rng = np.random.default_rng(42)
        x1 = rng.normal(0, 1, rows)
        x2 = rng.normal(0, 1, rows)
        y = 3 + 2 * x1 - 1.5 * x2 + rng.normal(0, 0.5, rows)
        df = pd.DataFrame({'y': y, 'x1': x1, 'x2': x2})
        gc.collect()
        tracemalloc.start()
        t0 = time.perf_counter()
        result = compute_regression(df, 'y', ['x1', 'x2'])
        elapsed = time.perf_counter() - t0
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        assert peak / 1024 / 1024 < 200
        # Verify accuracy
        X = np.column_stack([np.ones(rows), x1, x2])
        np_coef, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
        assert result.intercept == pytest.approx(np_coef[0], rel=1e-4)
        assert result.coefficients[0] == pytest.approx(np_coef[1], rel=1e-4)
        assert result.coefficients[1] == pytest.approx(np_coef[2], rel=1e-4)


class TestStressParse:
    """Test CSV parsing at various sizes."""

    @pytest.mark.parametrize("rows", [10000, 50000, 100000])
    def test_parse_scaling(self, rows):
        csv_bytes = generate_dataset(rows, cols=10)
        gc.collect()
        tracemalloc.start()
        t0 = time.perf_counter()
        schema, df, missing = parse_file(csv_bytes, f'test_{rows}.csv')
        elapsed = time.perf_counter() - t0
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        assert schema.rowCount == rows
        assert schema.columnCount == 10
        assert peak / 1024 / 1024 < 500, f"Memory {peak/1024/1024:.0f}MB too high for {rows} rows"


class TestStressWide:
    """Test wide datasets (many columns)."""

    @pytest.mark.parametrize("cols", [10, 50, 100])
    def test_wide_dataset(self, cols):
        rng = np.random.default_rng(42)
        data = {f'col_{i}': rng.normal(0, 1, 1000) for i in range(cols)}
        df = pd.DataFrame(data)
        gc.collect()
        tracemalloc.start()
        t0 = time.perf_counter()
        result = compute_descriptive(df, list(df.columns))
        elapsed = time.perf_counter() - t0
        current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        assert len(result) == cols
        assert peak / 1024 / 1024 < 200


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short', '-k', 'TestStress'])
