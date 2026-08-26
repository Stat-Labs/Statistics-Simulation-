"""Tests for the streaming data profile."""

import io

import numpy as np
import pandas as pd
import pytest

from stats.chunked_reader import ChunkedCsvReader
from stats.profile import compute_streaming_profile, classify_column
from models import ColumnType


def _profile(csv: bytes, **kw):
    reader = ChunkedCsvReader(csv, "sample.csv")
    return compute_streaming_profile(reader, **kw)


def test_profile_numeric_stats_match_pandas(csv_bytes):
    data = csv_bytes(rows=2_000)
    prof = _profile(data, chunk_size=500)
    df = pd.read_csv(io.BytesIO(data))
    age = next(c for c in prof["columns"] if c["name"] == "age")
    assert age["count"] == 2_000 - 2_000 // 20
    assert age["nullCount"] == 2_000 // 20
    assert age["type"] == "continuous" or age["type"] == "ordinal"
    assert abs(age["mean"] - df["age"].mean()) < 0.01
    assert abs(age["stdDev"] - df["age"].std()) < 0.01
    assert abs(age["min"] - df["age"].min()) < 1e-6
    assert abs(age["max"] - df["age"].max()) < 1e-6
    assert abs(age["median"] - df["age"].median()) < 0.5
    assert abs(age["skewness"] - df["age"].skew()) < 0.05
    assert abs(age["kurtosis"] - df["age"].kurt()) < 0.05
    assert age["histogram"]["n"] == age["count"]


def test_profile_categorical_frequency(csv_bytes):
    data = csv_bytes(rows=500)
    prof = _profile(data, chunk_size=200)
    region = next(c for c in prof["columns"] if c["name"] == "region")
    assert region["type"] == "categorical"
    assert region["cardinality"] == 4
    ft = region["frequencyTable"]
    assert sum(ft.values()) == 500
    assert len(ft) == 4


def test_profile_row_duplicates(csv_bytes):
    data = csv_bytes(rows=300)
    prof = _profile(data)
    assert prof["rowCount"] == 300
    # Rows are unique because the id column is unique.
    assert prof["duplicateRowCount"] == 0


def test_profile_correlations(csv_bytes):
    data = csv_bytes(rows=1_000)
    prof = _profile(data, correlations=[("age", "score")])
    corrs = prof["correlations"]
    assert corrs is not None
    pair = corrs[0]
    df = pd.read_csv(io.BytesIO(data))
    expected = df[["age", "score"]].corr().iloc[0, 1]
    assert abs(pair["r"] - expected) < 0.02


def test_profile_type_classification():
    assert classify_column("sex", "int", {1, 2}, 2, True) is ColumnType.binary
    assert classify_column("weight", "float", {x for x in range(50)}, 50, False) is ColumnType.continuous
    assert classify_column("region", "str", {"north", "south", "east"}, 3, False) is ColumnType.categorical
    assert classify_column("age_group", "int", {1, 2, 3, 4}, 4, True) is ColumnType.ordinal


def test_profile_handles_missing_only_column():
    data = b"a,b\n1,\n2,\n3,\n"
    prof = _profile(data)
    b = next(c for c in prof["columns"] if c["name"] == "b")
    assert b["nullCount"] == 3
    assert b["nullPercentage"] == 100.0


def test_profile_sample_rows(csv_bytes):
    data = csv_bytes(rows=10)
    prof = _profile(data)
    assert len(prof["sampleRows"]) == 5
    assert set(prof["sampleRows"][0].keys()) == {"id", "age", "income", "region", "score"}
