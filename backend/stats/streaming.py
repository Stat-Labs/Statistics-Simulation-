"""Streaming / mergeable statistical accumulators.

Every accumulator here processes one value (or one chunk) at a time and keeps
bounded, mergeable state, so a full-population statistic can be computed with
near-constant memory regardless of dataset size. Two accumulators of the same
type can be merged (parallel chunks, map-reduce, cached partials).

Exactness contract:
  - Moments (mean/variance/std/min/max/sum): EXACT via the Welford recurrence —
    numerically stable, matches numpy on the full array.
  - TwoPassCentral (skewness/kurtosis): EXACT via a second pass summing
    deviations from the pass-1 mean — matches scipy to float precision and is
    more accurate than scipy's own single-pass computation.
  - Correlation (Pearson r, OLS slope/intercept/R2): EXACT via sum-of-squares /
    cross-product accumulation.
  - TDigest (percentiles/median): APPROXIMATE by design (bounded memory,
    ~1.5/delta centroids); accuracy is controlled by `delta` (smaller = closer
    to exact).
  - HyperLogLog (cardinality): APPROXIMATE (~1.6% error at 2^14 registers).
  - Histogram (counts into fixed equal-width bins): EXACT.
  - FrequencyCounter / RowDuplicateCounter: EXACT while the distinct set fits
    the memory cap; beyond the cap they degrade to approximate (`capped`).
"""

from __future__ import annotations

import hashlib
import math

import numpy as np

# ---------------------------------------------------------------------------
# Moments — exact streaming mean / variance / std / min / max / sum
# (skewness/kurtosis are exact via TwoPassCentral on a second pass)
# ---------------------------------------------------------------------------


class Moments:
    """Exact streaming mean / variance / std / min / max / sum.

    Uses the Welford recurrence (M2) — numerically stable and exact on the
    full population without holding data. Mergeable via `merge`.

    Note: skewness/kurtosis are NOT computed here (the single-pass M3/M4
    recurrence drifts at high cardinalities); use `TwoPassCentral` for exact
    skew/kurtosis on a second pass over the data.
    """

    __slots__ = ("n", "mean", "m2", "min", "max", "sum_")

    def __init__(self) -> None:
        self.n = 0
        self.mean = 0.0
        self.m2 = 0.0
        self.min = float("inf")
        self.max = float("-inf")
        self.sum_ = 0.0

    def update(self, value: float) -> "Moments":
        v = float(value)
        n1 = self.n
        n = n1 + 1
        delta = v - self.mean
        delta_n = delta / n
        self.m2 += delta * delta_n * n1
        self.mean += delta_n
        self.n = n
        self.sum_ += v
        if v < self.min:
            self.min = v
        if v > self.max:
            self.max = v
        return self

    def merge(self, other: "Moments") -> "Moments":
        """Merge another accumulator (exact for combined data)."""
        if other.n == 0:
            return self
        if self.n == 0:
            self.n = other.n
            self.mean = other.mean
            self.m2 = other.m2
            self.min = other.min
            self.max = other.max
            self.sum_ = other.sum_
            return self
        n1, n2 = self.n, other.n
        delta = other.mean - self.mean
        n = n1 + n2
        self.mean = (n1 * self.mean + n2 * other.mean) / n
        self.m2 = (
            self.m2 + other.m2 + delta * delta * n1 * n2 / n
        )
        self.n = n
        self.sum_ += other.sum_
        self.min = min(self.min, other.min)
        self.max = max(self.max, other.max)
        return self

    # -- derived statistics -------------------------------------------------

    @classmethod
    def from_array(cls, values) -> "Moments":
        """Build an accumulator from a whole chunk at once (vectorized).

        Computes (n, mean, m2, min, max, sum) in numpy then merges exactly via
        `merge`, so chunked ingestion is C-speed while remaining exact.
        """
        m = cls()
        v = np.asarray(values, dtype=np.float64)
        v = v[~np.isnan(v)]
        n = len(v)
        if n == 0:
            return m
        m.n = n
        m.mean = float(v.mean())
        m.m2 = float(((v - m.mean) ** 2).sum())
        m.min = float(v.min())
        m.max = float(v.max())
        m.sum_ = float(v.sum())
        return m

    @property
    def count(self) -> int:
        return self.n

    def variance(self, ddof: int = 1) -> float:
        if self.n - ddof <= 0:
            return 0.0
        return self.m2 / (self.n - ddof)

    def std(self, ddof: int = 1) -> float:
        return math.sqrt(self.variance(ddof))

    def to_dict(self) -> dict:
        return {
            "count": self.n,
            "mean": self.mean if self.n else None,
            "stdDev": self.std() if self.n > 1 else 0.0,
            "variance": self.variance() if self.n > 1 else 0.0,
            "min": self.min if self.n else None,
            "max": self.max if self.n else None,
        }


class TwoPassCentral:
    """Exact skewness/kurtosis via a second pass.

    Given the global mean (from pass 1), accumulates sums of squared / cubed /
    fourth-power deviations. Because the center is fixed, per-chunk sums merge
    by simple addition and the result matches scipy to machine precision.
    """

    __slots__ = ("center", "n", "sum2", "sum3", "sum4")

    def __init__(self, center: float = 0.0) -> None:
        self.center = float(center)
        self.n = 0
        self.sum2 = 0.0
        self.sum3 = 0.0
        self.sum4 = 0.0

    def update(self, value: float) -> None:
        v = float(value)
        if math.isnan(v):
            return
        d = v - self.center
        d2 = d * d
        self.n += 1
        self.sum2 += d2
        self.sum3 += d2 * d
        self.sum4 += d2 * d2

    def merge(self, other: "TwoPassCentral") -> None:
        if other.center != self.center:
            raise ValueError("Cannot merge two-pass moments with different centers")
        self.n += other.n
        self.sum2 += other.sum2
        self.sum3 += other.sum3
        self.sum4 += other.sum4

    @classmethod
    def from_array(cls, values, center: float) -> "TwoPassCentral":
        """Vectorized construction from a whole chunk (center must be fixed)."""
        tp = cls(center)
        v = np.asarray(values, dtype=np.float64)
        v = v[~np.isnan(v)]
        n = len(v)
        if n == 0:
            return tp
        d = v - center
        d2 = d * d
        tp.n = n
        tp.sum2 = float(d2.sum())
        tp.sum3 = float((d2 * d).sum())
        tp.sum4 = float((d2 * d2).sum())
        return tp

    def skewness(self, bias_corrected: bool = False) -> float:
        if self.n < 3 or self.sum2 <= 0:
            return 0.0
        n = self.n
        m2 = self.sum2 / n
        g1 = (self.sum3 / n) / m2 ** 1.5
        if not bias_corrected:
            return g1
        return g1 * math.sqrt(n * (n - 1)) / (n - 2)

    def kurtosis(self, fisher: bool = True, bias_corrected: bool = False) -> float:
        if self.n < 4 or self.sum2 <= 0:
            return 0.0
        n = self.n
        m2 = self.sum2 / n
        g2 = (self.sum4 / n) / (m2 * m2)
        if fisher:
            g2 -= 3.0
        if not bias_corrected:
            return g2
        factor = (n - 1) / ((n - 2) * (n - 3))
        if fisher:
            return factor * ((n + 1) * g2 + 6)
        return factor * ((n + 1) * g2 + 6) + 3.0


# ---------------------------------------------------------------------------
# TDigest — mergeable streaming quantile sketch (bounded memory, approximate)
# ---------------------------------------------------------------------------


class TDigest:
    """Greedy-merging t-digest for streaming percentiles.

    Bounded memory (a few thousand centroids), mergeable, and accurate to
    roughly 1-2% of the value range at default `delta=0.005`. Smaller `delta`
    trades memory for accuracy. Approximate by design — the exact alternative
    (buffering every value) violates near-constant memory.
    """

    __slots__ = ("delta", "max_centroids", "buffer_size", "centroids", "_pending", "n")

    def __init__(self, delta: float = 0.005, max_centroids: int = 4096) -> None:
        self.delta = delta
        self.max_centroids = max_centroids
        self.buffer_size = max(64, max_centroids // 8)
        self.centroids: list[list[float]] = []
        self._pending: list[float] = []
        self.n = 0

    def add(self, value: float) -> None:
        v = float(value)
        if math.isnan(v):
            return
        self._pending.append(v)
        self.n += 1
        if len(self._pending) >= self.buffer_size:
            self._flush()

    def add_many(self, values) -> None:
        """Bulk add from a numeric array (C-speed `.tolist()` per chunk)."""
        arr = np.asarray(values, dtype=np.float64)
        arr = arr[~np.isnan(arr)]
        if len(arr) == 0:
            return
        vals = arr.tolist()
        self._pending.extend(vals)
        self.n += len(vals)
        if len(self._pending) >= self.buffer_size:
            self._flush()

    def merge(self, other: "TDigest") -> None:
        other._flush()
        self._flush()
        self.centroids.extend([float(mean), float(weight)] for mean, weight in other.centroids)
        self.n += other.n
        self._compress()

    def _flush(self) -> None:
        """Merge the pending raw-value buffer into centroids, then compress.

        Compressing once per `buffer_size` adds amortizes the O(k log k) sort
        so throughput stays ~linear in the number of rows.
        """
        if not self._pending:
            return
        for v in self._pending:
            self.centroids.append([v, 1.0])
        self._pending = []
        self._compress()

    def _compress(self) -> None:
        if len(self.centroids) <= 1:
            return
        self.centroids.sort(key=lambda c: c[0])
        n = float(self.n) or 1.0
        out: list[list[float]] = []
        cum = 0.0
        for mean, weight in self.centroids:
            w = float(weight)
            if out:
                # q-adaptive t-digest merge rule: a centroid sitting at quantile q
                # may absorb weight up to 4*delta*n*q*(1-q). This never degenerates
                # into singletons and bounds the centroid count at ~1.5/delta.
                q_mid = (cum + w / 2.0) / n
                allowed = max(4.0 * self.delta * n * q_mid * (1.0 - q_mid), 1.0)
                if w + out[-1][1] <= allowed:
                    prev = out[-1]
                    new_w = prev[1] + w
                    prev[0] = (prev[0] * prev[1] + mean * w) / new_w
                    prev[1] = new_w
                    cum += w
                    continue
            out.append([float(mean), w])
            cum += w
        self.centroids = out

    def quantile(self, q: float) -> float:
        if self.n == 0:
            return float("nan")
        self._flush()
        if len(self.centroids) == 1:
            return self.centroids[0][0]
        q = max(0.0, min(1.0, q))
        # Restore order (compress keeps sorted order, but be defensive).
        c = sorted(self.centroids, key=lambda x: x[0])
        target = q * self.n
        # Interpolate across centroid boundaries (reference t-digest lookup).
        if target <= c[0][1] / 2.0:
            return c[0][0]
        if target >= self.n - c[-1][1] / 2.0:
            return c[-1][0]
        cum = c[0][1] / 2.0
        for i in range(1, len(c)):
            cum += (c[i - 1][1] + c[i][1]) / 2.0
            if cum >= target:
                left = c[i - 1]
                right = c[i]
                span = (left[1] + right[1]) / 2.0
                if span == 0:
                    return right[0]
                t = (cum - target) / span
                return left[0] * t + right[0] * (1.0 - t)
        return c[-1][0]

    def median(self) -> float:
        return self.quantile(0.5)


# ---------------------------------------------------------------------------
# Histogram — exact equal-width bins (two-pass: min/max from Moments first)
# ---------------------------------------------------------------------------


class Histogram:
    """Exact equal-width histogram. Requires [min, max] up front (from a
    prior streaming pass) so bins are stable and exact."""

    __slots__ = ("min", "max", "nbins", "counts", "n", "bin_width")

    def __init__(self, min_value: float, max_value: float, nbins: int = 20) -> None:
        self.min = float(min_value)
        self.max = float(max_value)
        self.nbins = nbins
        self.n = 0
        if max_value > min_value:
            self.bin_width = (self.max - self.min) / nbins
        else:
            self.bin_width = 1.0
        self.counts = [0] * nbins

    def update(self, value: float) -> None:
        v = float(value)
        if math.isnan(v):
            return
        self.n += 1
        if v <= self.min:
            idx = 0
        elif v >= self.max:
            idx = self.nbins - 1
        else:
            idx = int((v - self.min) / self.bin_width)
            if idx >= self.nbins:
                idx = self.nbins - 1
        self.counts[idx] += 1

    def update_many(self, values) -> None:
        """Vectorized bulk update from a numpy array (C-speed per chunk)."""
        v = np.asarray(values, dtype=np.float64)
        v = v[~np.isnan(v)]
        if len(v) == 0:
            return
        self.n += len(v)
        idx = np.clip(((v - self.min) / self.bin_width).astype(np.int64), 0, self.nbins - 1)
        counts = np.bincount(idx, minlength=self.nbins)
        self.counts = [a + b for a, b in zip(self.counts, counts.tolist())]

    def merge(self, other: "Histogram") -> None:
        if other.min != self.min or other.max != self.max or other.nbins != self.nbins:
            raise ValueError("Cannot merge histograms with different binning")
        for i, c in enumerate(other.counts):
            self.counts[i] += c
        self.n += other.n

    def bins(self) -> list[float]:
        """Bin edges (lower bound of each bin)."""
        return [self.min + i * self.bin_width for i in range(self.nbins)]

    def to_dict(self) -> dict:
        return {
            "bins": [round(b, 6) for b in self.bins()],
            "counts": self.counts,
            "n": self.n,
            "nbins": self.nbins,
        }


# ---------------------------------------------------------------------------
# Frequency table — bounded cardinality counter
# ---------------------------------------------------------------------------


class FrequencyCounter:
    """Streaming value-counts with an optional cardinality cap.

    `cap=None` keeps every distinct value (memory grows with cardinality).
    With a cap, once exceeded the counter keeps only the most frequent values
    and sets `capped=True` (documented degradation).
    """

    __slots__ = ("counts", "cap", "capped", "n")

    def __init__(self, cap: int | None = 5000) -> None:
        self.counts: dict[str, int] = {}
        self.cap = cap
        self.capped = False
        self.n = 0

    def update(self, value) -> None:
        self.update_key(_scalar_key(value))

    def update_key(self, key) -> None:
        """Update with a pre-normalized key (avoids `_scalar_key` cost when the
        caller already has the canonical form — important on high-volume paths)."""
        self.n += 1
        if key in self.counts:
            self.counts[key] += 1
            return
        if self.cap is not None and len(self.counts) >= self.cap:
            self.capped = True
            # Evict the least-frequent value to bound memory.
            min_key = min(self.counts, key=self.counts.get)
            self.counts.pop(min_key)
            # The evicted key is lost; re-insert current value as count 1.
            self.counts[key] = 1
            return
        self.counts[key] = 1

    def merge(self, other: "FrequencyCounter") -> None:
        for k, v in other.counts.items():
            self.counts[k] = self.counts.get(k, 0) + v
        self.n += other.n
        self.capped = self.capped or other.capped
        if self.cap is not None and len(self.counts) > self.cap:
            # Truncate to the cap most frequent.
            self.capped = True
            top = sorted(self.counts.items(), key=lambda kv: kv[1], reverse=True)[: self.cap]
            self.counts = dict(top)

    def top(self, k: int | None = None) -> dict[str, int]:
        if k is None:
            return dict(self.counts)
        return dict(sorted(self.counts.items(), key=lambda kv: kv[1], reverse=True)[:k])


def _scalar_key(value):
    """Normalize a scalar (str/int/float/bool/None) to a comparable key."""
    if value is None or value != value:  # None / NaN
        return "__missing__"
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, np.integer)):
        return str(int(value))
    if isinstance(value, (float, np.floating)):
        if float(value).is_integer():
            return str(int(value))
        return repr(float(value))
    return str(value)


# ---------------------------------------------------------------------------
# Grouped moments — for group summaries / t-tests / ANOVA
# ---------------------------------------------------------------------------


class GroupedMoments:
    """Maps group keys to per-group `Moments` accumulators."""

    __slots__ = ("groups", "cap")

    def __init__(self, cap: int | None = 5000) -> None:
        self.groups: dict[str, Moments] = {}
        self.cap = cap

    def update(self, group, value: float) -> None:
        key = _scalar_key(group)
        if key == "__missing__":
            return
        if key not in self.groups:
            if self.cap is not None and len(self.groups) >= self.cap:
                return  # bounded; documented degradation
            self.groups[key] = Moments()
        self.groups[key].update(value)

    def keys(self) -> list[str]:
        return list(self.groups.keys())

    def merged(self) -> Moments:
        """Merge all groups into a single accumulator (overall stats)."""
        total = Moments()
        for g in self.groups.values():
            total.merge(g)
        return total


# ---------------------------------------------------------------------------
# Correlation — exact Pearson r and simple OLS via streaming sums
# ---------------------------------------------------------------------------


class Correlation:
    """Exact Pearson correlation and simple linear-regression accumulators.

    Tracks n, sum_x, sum_y, sum_xx, sum_yy, sum_xy in floating point. Merging
    two Correlation instances is exact for the concatenated data.
    """

    __slots__ = ("n", "sum_x", "sum_y", "sum_xx", "sum_yy", "sum_xy")

    def __init__(self) -> None:
        self.n = 0
        self.sum_x = 0.0
        self.sum_y = 0.0
        self.sum_xx = 0.0
        self.sum_yy = 0.0
        self.sum_xy = 0.0

    def update(self, x: float, y: float) -> None:
        xf, yf = float(x), float(y)
        if math.isnan(xf) or math.isnan(yf):
            return
        self.n += 1
        self.sum_x += xf
        self.sum_y += yf
        self.sum_xx += xf * xf
        self.sum_yy += yf * yf
        self.sum_xy += xf * yf

    def merge(self, other: "Correlation") -> None:
        self.n += other.n
        self.sum_x += other.sum_x
        self.sum_y += other.sum_y
        self.sum_xx += other.sum_xx
        self.sum_yy += other.sum_yy
        self.sum_xy += other.sum_xy

    @classmethod
    def from_arrays(cls, x, y) -> "Correlation":
        """Vectorized construction from a whole chunk (NaN rows dropped pairwise)."""
        c = cls()
        xa = np.asarray(x, dtype=np.float64)
        ya = np.asarray(y, dtype=np.float64)
        mask = ~(np.isnan(xa) | np.isnan(ya))
        xa = xa[mask]
        ya = ya[mask]
        n = len(xa)
        if n == 0:
            return c
        c.n = n
        c.sum_x = float(xa.sum())
        c.sum_y = float(ya.sum())
        c.sum_xx = float((xa * xa).sum())
        c.sum_yy = float((ya * ya).sum())
        c.sum_xy = float((xa * ya).sum())
        return c

    def pearson_r(self) -> float:
        n = self.n
        if n < 2:
            return 0.0
        ssx = n * self.sum_xx - self.sum_x * self.sum_x
        ssy = n * self.sum_yy - self.sum_y * self.sum_y
        if ssx == 0 or ssy == 0:
            return 0.0
        r = (n * self.sum_xy - self.sum_x * self.sum_y) / math.sqrt(ssx * ssy)
        return max(-1.0, min(1.0, r))

    def ols(self) -> dict:
        """Slope/intercept of y ~ x using the same streaming sums (exact)."""
        n = self.n
        if n < 2:
            return {"slope": 0.0, "intercept": 0.0, "rSquared": 0.0, "n": n}
        ssx = n * self.sum_xx - self.sum_x * self.sum_x
        if ssx == 0:
            return {"slope": 0.0, "intercept": 0.0, "rSquared": 0.0, "n": n}
        slope = (n * self.sum_xy - self.sum_x * self.sum_y) / ssx
        intercept = (self.sum_y - slope * self.sum_x) / n
        r = self.pearson_r()
        return {
            "slope": slope,
            "intercept": intercept,
            "rSquared": r * r,
            "n": n,
        }


# ---------------------------------------------------------------------------
# HyperLogLog — approximate distinct counting (mergeable)
# ---------------------------------------------------------------------------


class HyperLogLog:
    """HyperLogLog cardinality estimator (~1.6% error at p=14)."""

    __slots__ = ("p", "m", "registers", "alpha")

    def __init__(self, p: int = 14) -> None:
        self.p = p
        self.m = 1 << p
        self.registers = np.zeros(self.m, dtype=np.uint8)
        self.alpha = self._alpha(self.m)

    @staticmethod
    def _alpha(m: int) -> float:
        if m == 16:
            return 0.673
        if m == 32:
            return 0.697
        if m == 64:
            return 0.709
        return 0.7213 / (1.0 + 1.079 / m)

    def update(self, value) -> None:
        h = hashlib.md5(_scalar_key(value).encode("utf-8")).digest()
        full = int.from_bytes(h, "big")  # 128-bit md5 digest
        idx = (full >> (128 - self.p)) & (self.m - 1)  # top p bits -> register
        rest = full & ((1 << (128 - self.p)) - 1)  # remaining bits
        if rest:
            rank = (128 - self.p) - rest.bit_length() + 1
        else:
            rank = 128 - self.p + 1
        if rank > self.registers[idx]:
            self.registers[idx] = rank

    def merge(self, other: "HyperLogLog") -> None:
        if self.m != other.m:
            raise ValueError("Cannot merge HLLs with different precision")
        np.maximum(self.registers, other.registers, out=self.registers)

    def estimate(self) -> int:
        m = self.m
        z = 1.0 / (2.0 ** self.registers).sum()
        raw = self.alpha * m * m * z
        if raw <= 2.5 * m:  # small-range correction
            v = int((self.registers == 0).sum())
            if v:
                return int(round(m * math.log(m / v)))
        return int(round(raw))


# ---------------------------------------------------------------------------
# Row duplicates — exact hash set with memory cap
# ---------------------------------------------------------------------------


class RowDuplicateCounter:
    """Counts duplicate rows exactly while the distinct set stays within
    `cap` entries; beyond that, `capped=True` and counts are approximate."""

    __slots__ = ("seen", "cap", "duplicates", "capped", "rows")

    def __init__(self, cap: int = 500_000) -> None:
        self.seen: set[str] = set()
        self.cap = cap
        self.duplicates = 0
        self.capped = False
        self.rows = 0

    def update(self, row_signature: str) -> None:
        self.rows += 1
        sig = hashlib.sha256(row_signature.encode("utf-8")).hexdigest()
        if sig in self.seen:
            self.duplicates += 1
            return
        if len(self.seen) >= self.cap:
            self.capped = True
            # Approximate: without the full distinct set we cannot tell if a
            # new value repeats; treat unknown signatures as new (undercounts).
            self.seen.add(sig)
            return
        self.seen.add(sig)

    def result(self) -> dict:
        return {
            "duplicateCount": self.duplicates,
            "rows": self.rows,
            "capped": self.capped,
        }
