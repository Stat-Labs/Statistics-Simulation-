"""Tests for the in-process profile LRU cache."""

from cache import ProfileCache


def test_miss_then_hit():
    cache = ProfileCache()
    assert cache.get(("k1",)) is None
    cache.put(("k1",), {"value": 1})
    assert cache.get(("k1",)) == {"value": 1}


def test_lru_eviction():
    cache = ProfileCache(max_entries=2)
    cache.put(("a",), 1)
    cache.put(("b",), 2)
    cache.put(("c",), 3)
    assert cache.get(("a",)) is None  # evicted (oldest)
    assert cache.get(("b",)) == 2
    assert cache.get(("c",)) == 3


def test_lru_refreshes_recency():
    cache = ProfileCache(max_entries=2)
    cache.put(("a",), 1)
    cache.put(("b",), 2)
    cache.get(("a",))  # refresh a
    cache.put(("c",), 3)
    assert cache.get(("b",)) is None  # b now oldest -> evicted
    assert cache.get(("a",)) == 1
    assert cache.get(("c",)) == 3


def test_invalidate():
    cache = ProfileCache()
    cache.put(("a",), 1)
    cache.invalidate()
    assert len(cache) == 0
    assert cache.get(("a",)) is None


def test_composite_key():
    cache = ProfileCache()
    key = ("abc123", 50000, 20, 10, (("age", "score"),), "x.csv")
    cache.put(key, "profile")
    assert cache.get(key) == "profile"
    # Different options -> different key.
    assert cache.get(("abc123", 50000, 20, 10, (), "x.csv")) is None
