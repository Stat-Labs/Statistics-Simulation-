"""Tests for the two-pass adaptive-chunk CSV reader."""

import pandas as pd
import pytest

from stats.chunked_reader import (
    ChunkedCsvReader, adaptive_chunk_size,
    row_count_estimate, _detect_delimiter,
)

SIMPLE_CSV = b"a,b,c\n1,2,3\n4,5,6\n7,8,9\n"


def test_delimiter_detection():
    assert _detect_delimiter(["a,b,c", "1,2,3"]) == ","
    assert _detect_delimiter(["a\tb\tc", "1\t2\t3"]) == "\t"


def test_sniff_counts_and_dtypes():
    reader = ChunkedCsvReader(SIMPLE_CSV, "x.csv")
    sniff = reader.sniff()
    assert sniff.row_count == 3
    assert sniff.header == ["a", "b", "c"]
    assert sniff.dtype_map == {"a": "int", "b": "int", "c": "int"}
    assert sniff.bytes_per_row() == pytest.approx(len(SIMPLE_CSV) / 3)


def test_sniff_missing_and_float():
    data = b"x,y\n1,1.5\n,2.5\n3,\n"
    reader = ChunkedCsvReader(data, "x.csv")
    sniff = reader.sniff()
    assert sniff.row_count == 3
    assert sniff.dtype_map["x"] == "int"
    assert sniff.dtype_map["y"] == "float"
    xcol = sniff.columns[0]
    assert xcol.missing == 1
    assert xcol.total == 3
    assert xcol.count == 2


def test_sniff_string_column():
    data = b"name,val\nabc,1\ndef,2\n"
    reader = ChunkedCsvReader(data, "x.csv")
    sniff = reader.sniff()
    assert sniff.dtype_map["name"] == "str"
    assert sniff.dtype_map["val"] == "int"


def test_tab_delimited():
    data = b"a\tb\n1\tx\n2\ty\n"
    reader = ChunkedCsvReader(data, "x.tsv")
    sniff = reader.sniff()
    assert sniff.delimiter == "\t"
    assert sniff.dtype_map["a"] == "int"
    assert sniff.dtype_map["b"] == "str"


def test_chunked_iteration_reconstructs_data():
    data = b"a,b,c\n1,2,3\n4,5,6\n7,8,9\n"
    reader = ChunkedCsvReader(data, "x.csv")
    chunks = list(reader.iter_chunks(chunk_size=2))
    assert len(chunks) == 2
    df = pd.concat(chunks, ignore_index=True)
    assert df.shape == (3, 3)
    assert df["a"].tolist() == [1, 4, 7]
    assert df["b"].tolist() == [2, 5, 8]


def test_chunked_nan_conversion():
    data = b"x,y\n1,1.5\n,2.5\n3,\n"
    reader = ChunkedCsvReader(data, "x.csv")
    chunks = list(reader.iter_chunks(chunk_size=10))
    df = pd.concat(chunks, ignore_index=True)
    assert df["x"].isna().sum() == 1
    assert df["y"].isna().sum() == 1
    assert df["y"].tolist()[0] == 1.5


def test_header_deduplication():
    data = b"a,a,a\n1,2,3\n"
    reader = ChunkedCsvReader(data, "x.csv")
    sniff = reader.sniff()
    assert sniff.header == ["a", "a_2", "a_3"]


def test_adaptive_chunk_size_bounded():
    # Large budget -> clamped at the max row cap.
    assert adaptive_chunk_size(1_000_000, 512 * 1024 * 1024, 100) == 500_000
    tiny = adaptive_chunk_size(1_000_000, 1024 * 1024, 10_000)
    assert tiny >= 1_000


def test_row_count_estimate():
    rows = b"a,b,c\n" + b"1,2,3\n" * 5000
    assert row_count_estimate(rows) == 5000


def test_empty_file_raises():
    reader = ChunkedCsvReader(b"", "x.csv")
    with pytest.raises(ValueError):
        reader.sniff()
