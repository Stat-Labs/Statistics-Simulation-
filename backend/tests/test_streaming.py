"""Tests for the streaming / mergeable accumulators in stats.streaming."""

import math

import numpy as np
import pytest
from scipy import stats as scipy_stats

from stats.streaming import (
    Moments, TwoPassCentral, TDigest, Histogram, FrequencyCounter,
    Correlation, HyperLogLog, RowDuplicateCounter,
)


class TestMoments:
    def test_matches_numpy_on_multiple_distributions(self):
        rng = np.random.default_rng(1234)
        for dist in [
            rng.normal(5, 2, 10_000),
            rng.lognormal(0, 1, 10_000),
            rng.uniform(-10, 10, 10_000),
            rng.exponential(2, 10_000),
        ]:
            m = Moments()
            for v in dist:
                m.update(v)
            assert abs(m.mean - dist.mean()) < 1e-9
            assert abs(m.variance(1) - dist.var(ddof=1)) < 1e-6
            assert abs(m.std(1) - dist.std(ddof=1)) < 1e-6
            assert m.min == dist.min()
            assert m.max == dist.max()

    def test_two_pass_skew_kurtosis_match_scipy(self):
        rng = np.random.default_rng(1234)
        for dist in [
            rng.normal(5, 2, 10_000),
            rng.lognormal(0, 1, 10_000),
            rng.uniform(-10, 10, 10_000),
            rng.exponential(2, 10_000),
        ]:
            m = Moments()
            for v in dist:
                m.update(v)
            tp = TwoPassCentral.from_array(dist, center=m.mean)
            assert abs(tp.skewness() - scipy_stats.skew(dist)) < 1e-5
            assert abs(tp.kurtosis() - scipy_stats.kurtosis(dist)) < 1e-5

    def test_merge_is_exact(self):
        rng = np.random.default_rng(9)
        a, b = rng.normal(0, 1, 5_000), rng.normal(3, 2, 5_000)
        m1, m2 = Moments(), Moments()
        for v in a:
            m1.update(v)
        for v in b:
            m2.update(v)
        allv = np.concatenate([a, b])
        m1.merge(m2)
        assert abs(m1.mean - allv.mean()) < 1e-9
        assert abs(m1.variance(1) - allv.var(ddof=1)) < 1e-6

    def test_from_array_matches_sequential(self):
        rng = np.random.default_rng(3)
        vals = rng.normal(0, 1, 20_000)
        seq = Moments()
        for v in vals:
            seq.update(v)
        vec = Moments.from_array(vals)
        assert abs(seq.mean - vec.mean) < 1e-12
        assert abs(seq.m2 - vec.m2) < 1e-9

    def test_two_pass_more_accurate_than_scipy(self):
        # The two-pass sum is the compensated reference; scipy itself carries
        # float noise on near-zero skewness.
        rng = np.random.default_rng(1234)
        a = rng.normal(5, 2, 10_000)
        m = Moments()
        for v in a:
            m.update(v)

        def kahan(xs):
            s = c = 0.0
            for x in xs:
                y = x - c
                t = s + y
                c = (t - s) - y
                s = t
            return s

        mu = kahan(a.tolist()) / len(a)
        d = [x - mu for x in a.tolist()]
        m2 = kahan([x * x for x in d]) / len(a)
        m3 = kahan([x * x * x for x in d]) / len(a)
        g1 = m3 / m2 ** 1.5
        ref = g1 * math.sqrt(len(a) * (len(a) - 1)) / (len(a) - 2)
        assert abs(TwoPassCentral.from_array(a, center=m.mean).skewness(bias_corrected=True) - ref) < 1e-9


class TestTDigest:
    def test_accuracy_and_bounded_centroids(self):
        rng = np.random.default_rng(42)
        d = rng.normal(0, 1, 200_000)
        td = TDigest(delta=0.005)
        for v in d:
            td.add(v)
        assert len(td.centroids) < 5_000
        for q in (0.1, 0.25, 0.5, 0.75, 0.9, 0.99):
            assert abs(td.quantile(q) - np.quantile(d, q)) < 0.01

    def test_mergeable(self):
        rng = np.random.default_rng(42)
        d = rng.normal(0, 1, 200_000)
        half = len(d) // 2
        t1, t2 = TDigest(), TDigest()
        for v in d[:half]:
            t1.add(v)
        for v in d[half:]:
            t2.add(v)
        t2.merge(t1)
        for q in (0.25, 0.5, 0.75):
            assert abs(t2.quantile(q) - np.quantile(d, q)) < 0.01

    def test_constant_input(self):
        td = TDigest()
        for _ in range(100):
            td.add(5.0)
        assert td.median() == 5.0


class TestHistogram:
    def test_exact_bins_match_numpy(self):
        vals = np.random.default_rng(1).normal(0, 1, 50_000)
        h = Histogram(-5, 5, 20)
        h.update_many(vals)
        lo, hi, nb = -5, 5, 20
        width = (hi - lo) / nb
        idx = np.clip(((vals - lo) / width).astype(int), 0, nb - 1)
        expected = np.bincount(idx, minlength=nb)
        assert list(h.counts) == expected.tolist()

    def test_merge(self):
        h1, h2 = Histogram(0, 10, 5), Histogram(0, 10, 5)
        for v in (1, 2, 3):
            h1.update(v)
        for v in (4, 5, 6):
            h2.update(v)
        h1.merge(h2)
        assert h1.n == 6
        assert sum(h1.counts) == 6

    def test_different_binning_rejected(self):
        h1, h2 = Histogram(0, 10, 5), Histogram(0, 10, 4)
        with pytest.raises(ValueError):
            h1.merge(h2)


class TestCorrelation:
    def test_matches_numpy_and_ols(self):
        rng = np.random.default_rng(2)
        x = rng.normal(0, 1, 100_000)
        y = 2.5 * x + rng.normal(0, 1, 100_000)
        c = Correlation()
        for xi, yi in zip(x, y):
            c.update(xi, yi)
        r = np.corrcoef(x, y)[0, 1]
        assert abs(c.pearson_r() - r) < 1e-9
        ols = c.ols()
        slope, intercept = np.polyfit(x, y, 1)
        assert abs(ols["slope"] - slope) < 1e-9
        assert abs(ols["intercept"] - intercept) < 1e-9

    def test_from_arrays_and_merge(self):
        rng = np.random.default_rng(5)
        a = rng.normal(0, 1, 10_000)
        b = 0.5 * a + rng.normal(0, 1, 10_000)
        c1 = Correlation.from_arrays(a[:5000], b[:5000])
        c2 = Correlation.from_arrays(a[5000:], b[5000:])
        c1.merge(c2)
        assert abs(c1.pearson_r() - np.corrcoef(a, b)[0, 1]) < 1e-9

    def test_nan_pairwise_dropped(self):
        x = np.array([1.0, 2.0, np.nan, 4.0])
        y = np.array([2.0, 4.0, 6.0, np.nan])
        c = Correlation.from_arrays(x, y)
        assert c.n == 2


class TestHyperLogLog:
    def test_cardinality_accuracy(self):
        hll = HyperLogLog(p=14)
        for i in range(100_000):
            hll.update(str(i))
        est = hll.estimate()
        assert abs(est - 100_000) / 100_000 < 0.03

    def test_mergeable(self):
        h1, h2 = HyperLogLog(p=12), HyperLogLog(p=12)
        for i in range(10_000):
            h1.update(str(i))
        for i in range(10_000, 20_000):
            h2.update(str(i))
        h1.merge(h2)
        assert abs(h1.estimate() - 20_000) / 20_000 < 0.05


class TestFrequencyCounter:
    def test_counts_and_top(self):
        fc = FrequencyCounter(cap=100)
        for i in range(1_000):
            fc.update(f"k{i % 50}")
        assert fc.n == 1_000
        assert sum(fc.counts.values()) == 1_000
        assert len(fc.top(5)) == 5
        assert not fc.capped

    def test_cap_truncation(self):
        fc = FrequencyCounter(cap=10)
        for i in range(1_000):
            fc.update(f"k{i % 500}")
        assert fc.capped
        assert len(fc.counts) <= 10


class TestRowDuplicateCounter:
    def test_exact_duplicates(self):
        dups = RowDuplicateCounter(cap=100_000)
        for i in range(50_000):
            dups.update(f"a,b,{i % 100}")
        res = dups.result()
        assert res["duplicateCount"] == 50_000 - 100
        assert not res["capped"]
