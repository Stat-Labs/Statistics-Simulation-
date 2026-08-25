"""Tests for the verification agent and reproducibility manifest."""

import pytest

from stats.chunked_reader import ChunkedCsvReader
from stats.profile import compute_streaming_profile
from verify import (
    content_hash, exactness_check, consistency_checks,
    full_cross_check, determinism_check, verify_profile, ENGINE_VERSION,
)


def _profile(csv: bytes, **kw):
    reader = ChunkedCsvReader(csv, "sample.csv")
    return compute_streaming_profile(reader, **kw)


def test_content_hash_is_deterministic():
    h1 = content_hash(b"a,b\n1,2\n")
    h2 = content_hash(b"a,b\n1,2\n")
    assert h1 == h2
    assert len(h1) == 64


def test_exactness_check_passes(csv_bytes):
    data = csv_bytes(rows=500)
    reader = ChunkedCsvReader(data, "sample.csv")
    checks = exactness_check(reader, chunk_size=200)
    assert checks
    for c in checks:
        assert c["meanExact"], c
        assert c["varianceExact"], c
        assert c["minExact"], c
        assert c["maxExact"], c


def test_exactness_check_skips_strings(csv_bytes):
    data = csv_bytes(rows=200)
    reader = ChunkedCsvReader(data, "sample.csv")
    checks = exactness_check(reader, chunk_size=100)
    assert all(c["column"] != "region" for c in checks)


def test_consistency_checks_clean_profile(csv_bytes):
    data = csv_bytes(rows=300)
    prof = _profile(data)
    assert consistency_checks(prof) == []


def test_consistency_checks_detect_corruption(csv_bytes):
    data = csv_bytes(rows=300)
    prof = _profile(data)
    prof["columns"][0]["range"] = 999.0  # corrupt
    for col in prof["columns"]:
        if col.get("quantiles"):
            q = col["quantiles"]
            keys = sorted(q)
            q[keys[-1]] = q[keys[0]] - 100.0  # non-monotonic
    problems = consistency_checks(prof)
    assert any("range" in p for p in problems)
    assert any("quantiles" in p for p in problems)


def test_full_cross_check_passes(csv_bytes):
    data = csv_bytes(rows=1_000)
    reader = ChunkedCsvReader(data, "sample.csv")
    prof = compute_streaming_profile(reader, chunk_size=250)
    report = full_cross_check(data, "sample.csv", prof, chunk_size=250)
    assert report["passed"], report["issues"]
    assert report["columnsChecked"] > 0


def test_determinism_check(csv_bytes):
    data = csv_bytes(rows=1_000)
    reader = ChunkedCsvReader(data, "sample.csv")
    assert determinism_check(reader, chunk_size=250, nbins=20, top_frequency=10, correlations=None)


def test_verify_profile_full_suite(csv_bytes):
    data = csv_bytes(rows=1_000)
    reader = ChunkedCsvReader(data, "sample.csv")
    prof = compute_streaming_profile(reader, chunk_size=250)
    report = verify_profile(
        data, "sample.csv", prof, chunk_size=250, nbins=20,
        top_frequency=10, correlations=None,
    )
    assert report["passed"], report
    assert report["engineVersion"] == ENGINE_VERSION
    assert report["exactnessOk"]
    assert report["consistencyOk"]
    assert report["determinism"] is True
    assert report["fullCrossCheck"]["mode"] == "full_in_memory"


def test_verify_skips_full_check_for_large_files(csv_bytes):
    data = csv_bytes(rows=100)
    reader = ChunkedCsvReader(data, "sample.csv")
    prof = compute_streaming_profile(reader, chunk_size=50)
    report = verify_profile(
        data, "sample.csv", prof, chunk_size=50, nbins=20,
        top_frequency=10, correlations=None, full_check_limit=10,
    )
    assert report["fullCrossCheck"] is None
    assert report["passed"]
