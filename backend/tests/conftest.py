import os
import sys

import pytest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)


@pytest.fixture
def csv_bytes():
    """A small, realistic CSV with numeric + categorical + missing values."""

    def _make(rows: int = 10_000, seed: int = 7) -> bytes:
        import io

        import numpy as np

        rng = np.random.default_rng(seed)
        buf = io.StringIO()
        buf.write("id,age,income,region,score\n")
        regions = ["north", "south", "east", "west"]
        for i in range(rows):
            age = int(rng.integers(18, 80))
            income = round(float(rng.lognormal(10, 0.4)), 2)
            region = regions[i % 4]
            score = round(float(rng.normal(70, 10)), 3)
            age_str = "" if i % 20 == 0 else str(age)  # 5% missing age
            buf.write(f"{i},{age_str},{income},{region},{score}\n")
        return buf.getvalue().encode("utf-8")

    return _make
