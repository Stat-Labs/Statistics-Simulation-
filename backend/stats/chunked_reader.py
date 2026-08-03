"""Two-pass, adaptive-chunk CSV reader for near-constant-memory analysis.

Architecture
------------
Pass 1 (sniff) streams the raw bytes with the stdlib `csv` module (no pandas,
no full buffering) and infers, per column: type, distinct cardinality (HLL),
min/max, missing counts, parseability, first values, plus the total row count
and an average bytes-per-row estimate.

Pass 2 (`iter_chunks`) streams the file again through pandas' C-speed
`read_csv(chunksize=...)` using the sniffed dtype map, yielding bounded
`DataFrame` chunks. Only one chunk is alive at a time, so memory is
proportional to the chunk size, not the file size. Callers feed each chunk
into the mergeable accumulators in `streaming.py`.

The chunksize is adaptive: `adaptive_chunk_size()` sizes it from the worker's
available memory and the measured bytes-per-row.
"""

from __future__ import annotations

import csv
import io
import math
import os

import numpy as np
import pandas as pd

from stats.streaming import HyperLogLog

NA_TOKENS = {"", "na", "n/a", "nan", "null", "none", "-", "nul", "missing"}
CSV_EXTS = {".csv", ".tsv", ".txt"}
DEFAULT_CHUNK_ROWS = 50_000
MIN_CHUNK_ROWS = 1_000
MAX_CHUNK_ROWS = 500_000
# Only this fraction of available RAM is budgeted for one chunk (safety factor).
MEMORY_SAFETY_FRACTION = 0.4


def _decode(buffer: bytes) -> tuple[io.StringIO, str]:
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = buffer.decode(enc)
            return io.StringIO(text), enc
        except UnicodeDecodeError:
            continue
    return io.StringIO(buffer.decode("latin-1", errors="replace")), "latin-1"


def _detect_delimiter(sample_lines: list[str]) -> str:
    candidates = [",", "\t", ";", "|"]
    best, best_score = ",", 0
    for delim in candidates:
        score = 0
        for line in sample_lines[:5]:
            try:
                score += len(next(csv.reader([line], delimiter=delim)))
            except csv.Error:
                continue
        if score > best_score:
            best, best_score = delim, score
    return best


class ColumnSniff:
    """Per-column statistics gathered during pass 1."""

    __slots__ = (
        "name", "total", "missing", "count", "float_ok", "int_ok",
        "min_f", "max_f", "hll", "sample", "all_int", "raw", "first_non_null",
    )

    def __init__(self, name: str, hll_p: int = 14) -> None:
        self.name = name
        self.total = 0
        self.missing = 0
        self.count = 0  # non-missing
        self.float_ok = 0
        self.int_ok = 0
        self.min_f = float("inf")
        self.max_f = float("-inf")
        self.hll = HyperLogLog(p=hll_p)
        self.sample: list = []  # first 5 non-missing raw values
        self.all_int = True
        self.raw: list = []  # first 200 raw values for date/type hints
        self.first_non_null: str | None = None

    def observe(self, raw: str) -> None:
        self.total += 1
        if raw == "":
            self.missing += 1
            return
        self.count += 1
        if len(self.sample) < 5:
            self.sample.append(raw)
        if len(self.raw) < 200:
            self.raw.append(raw)
        self.hll.update(raw)
        s = raw.strip().lower()
        if s in NA_TOKENS and s != "":
            self.missing += 1
            return
        try:
            f = float(s)
            self.float_ok += 1
            if f < self.min_f:
                self.min_f = f
            if f > self.max_f:
                self.max_f = f
            if f.is_integer() and "." not in s and "e" not in s and "E" not in s:
                self.int_ok += 1
            else:
                self.all_int = False
        except (ValueError, TypeError):
            self.all_int = False

    def numeric_fraction(self) -> float:
        return (self.float_ok / self.count) if self.count else 0.0

    def integer_fraction(self) -> float:
        return (self.int_ok / self.count) if self.count else 0.0


class SniffResult:
    """Result of the pass-1 scan."""

    __slots__ = ("columns", "dtype_map", "row_count", "byte_size", "delimiter", "encoding", "header")

    def __init__(self, columns, dtype_map, row_count, byte_size, delimiter, encoding, header) -> None:
        self.columns: list[ColumnSniff] = columns
        self.dtype_map: dict[str, str] = dtype_map
        self.row_count: int = row_count
        self.byte_size: int = byte_size
        self.delimiter: str = delimiter
        self.encoding: str = encoding
        self.header: list[str] = header

    def bytes_per_row(self) -> float:
        if self.row_count <= 0:
            return 0.0
        return self.byte_size / self.row_count


def infer_column_type(col: "ColumnSniff") -> str:
    """Return 'int' | 'float' | 'str' for dtype-map purposes."""
    if col.count and col.numeric_fraction() >= 0.95:
        if col.all_int and col.integer_fraction() >= 0.95:
            return "int"
        return "float"
    return "str"


def adaptive_chunk_size(
    file_size_bytes: int,
    available_memory_bytes: int,
    bytes_per_row: float,
    *,
    min_rows: int = MIN_CHUNK_ROWS,
    max_rows: int = MAX_CHUNK_ROWS,
    default_rows: int = DEFAULT_CHUNK_ROWS,
) -> int:
    """Pick a chunk size that fits the memory budget (bounded and sanely clamped).

    Uses measured bytes-per-row so a wide/sparse file gets smaller chunks.
    """
    budget = max(1, int(available_memory_bytes * MEMORY_SAFETY_FRACTION))
    if bytes_per_row > 0:
        est = int(budget / bytes_per_row)
    else:
        est = int(budget / max(1, file_size_bytes // max(1, default_rows)))
    return int(max(min_rows, min(max_rows, est or default_rows)))


class ChunkedCsvReader:
    """Streaming CSV reader: pass-1 sniff + pass-2 chunked iteration."""

    def __init__(self, buffer: bytes, filename: str = "uploaded.csv") -> None:
        self.buffer = buffer
        self.filename = filename
        self._sniff: SniffResult | None = None

    # -- pass 1 -------------------------------------------------------------

    def sniff(self, hll_p: int = 14) -> SniffResult:
        if self._sniff is not None:
            return self._sniff
        text, encoding = _decode(self.buffer)
        header_row, delimiter = self._read_header(text)
        columns = [ColumnSniff(name, hll_p=hll_p) for name in header_row]

        reader = csv.reader(text, delimiter=delimiter, skipinitialspace=True)
        row_count = 0
        for raw in reader:
            if not raw or (len(raw) == 1 and not raw[0].strip()):
                continue
            for i, cell in enumerate(raw):
                if i < len(columns):
                    columns[i].observe(cell)
                # tolerate short rows silently; extra cells are ignored
            row_count += 1

        dtype_map = {c.name: infer_column_type(c) for c in columns}
        self._sniff = SniffResult(
            columns=columns,
            dtype_map=dtype_map,
            row_count=row_count,
            byte_size=len(self.buffer),
            delimiter=delimiter,
            encoding=encoding,
            header=header_row,
        )
        return self._sniff

    def _read_header(self, text: io.StringIO) -> tuple[list[str], str]:
        """Read and dedupe the header, leaving `text` positioned at the first
        data line so the body scan starts exactly at row 1."""
        leading = 0
        first = None
        while True:
            line = text.readline()
            if not line:
                break
            if line.strip():
                first = line
                break
            leading += 1
        if first is None:
            raise ValueError("CSV file is empty")
        sample = [first]
        for _ in range(3):
            nxt = text.readline()
            if not nxt:
                break
            sample.append(nxt)
        delimiter = _detect_delimiter(sample)
        try:
            header = next(csv.reader(io.StringIO(first), delimiter=delimiter, skipinitialspace=True))
        except csv.Error:
            header = []
        # Deduplicate header names so pandas doesn't mangle them.
        seen: dict[str, int] = {}
        uniq: list[str] = []
        for name in header:
            name = name.strip()
            if not name:
                name = f"column_{len(uniq) + 1}"
            if name in seen:
                seen[name] += 1
                name = f"{name}_{seen[name]}"
            else:
                seen[name] = 1
            uniq.append(name)
        # Reset cursor to just after the header line (account for leading blanks).
        text.seek(0)
        for _ in range(leading + 1):
            text.readline()
        return uniq, delimiter

    # -- pass 2 -------------------------------------------------------------

    def iter_chunks(self, chunk_size: int = DEFAULT_CHUNK_ROWS):
        """Yield bounded pandas DataFrame chunks using the sniffed dtype map."""
        sniff = self.sniff()
        if sniff.delimiter == "\t":
            sep = "\t"
        else:
            sep = sniff.delimiter
        dtype_map = {}
        for name, dt in sniff.dtype_map.items():
            dtype_map[name] = "float64" if dt in ("int", "float") else "object"
        na_values = list(NA_TOKENS - {""})
        text, _ = _decode(self.buffer)
        reader = pd.read_csv(
            text,
            sep=sep,
            dtype=dtype_map,
            na_values=na_values,
            keep_default_na=True,
            skipinitialspace=True,
            chunksize=chunk_size,
        )
        for df in reader:
            yield df

    @property
    def is_supported(self) -> bool:
        ext = os.path.splitext(self.filename)[1].lower()
        return ext in CSV_EXTS or ext in (".xlsx", ".xls")


def row_count_estimate(buffer: bytes, sample_chars: int = 2_000_000) -> int:
    """Cheap first-pass row estimate by sampling the front of the file."""
    if not buffer:
        return 0
    sample = buffer[:sample_chars]
    text, _ = _decode(sample)
    if not text.read():
        return 0
    text.seek(0)
    reader = csv.reader(text)
    try:
        header = next(reader)
    except (csv.Error, StopIteration):
        return 0
    n_headers = len(header) or 1
    lines = 0
    for _ in reader:
        lines += 1
    if lines == 0:
        return 0
    bytes_per_row = len(sample) / max(lines, 1)
    total_lines = len(buffer) / max(bytes_per_row, 1)
    return max(0, int(total_lines))
