"""
File-size stress test — realistic CSV datasets through the actual FastAPI endpoints.

Tests 0.5/1/2/5 MB files (practical for dev/CI).
Measures the complete request lifecycle: upload → parse → compute → serialize.
"""
import gc
import io
import json
import os
import sys
import time
import tracemalloc

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def generate_csv(target_mb, seed=42):
    rng = np.random.default_rng(seed)
    rows = int(target_mb * 1024 * 1024 / 80)
    df = pd.DataFrame({
        'id': range(rows),
        'category': rng.choice(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'], rows),
        'region': rng.choice(['North', 'South', 'East', 'West', 'Central'], rows),
        'value_a': rng.normal(100, 25, rows).round(2),
        'value_b': rng.uniform(0, 1000, rows).round(2),
        'value_c': rng.exponential(50, rows).round(2),
        'score': rng.integers(1, 101, rows),
        'flag': rng.choice([True, False], rows),
        'date': pd.date_range('2020-01-01', periods=rows, freq='h').strftime('%Y-%m-%d %H:%M:%S'),
        'text': [f'record_{i:08d}' for i in range(rows)],
    })
    csv_bytes = df.to_csv(index=False).encode()
    return csv_bytes, rows, len(csv_bytes) / (1024 * 1024)


class TestFileSizeStress:

    def test_profile_lifecycle(self):
        sizes = [(0.5, "0.5 MB"), (1, "1 MB"), (2, "2 MB"), (5, "5 MB")]
        results = []
        for target_mb, label in sizes:
            gc.collect()
            tracemalloc.start()
            csv_bytes, rows, actual_mb = generate_csv(target_mb)

            t0 = time.perf_counter()
            files = {'file': (f'test.csv', io.BytesIO(csv_bytes), 'text/csv')}
            resp = client.post('/profile', files=files, timeout=60)
            elapsed = time.perf_counter() - t0

            _, peak = get_rss_mb()
            tracemalloc.stop()
            data = resp.json()
            results.append({
                'label': label, 'actual_mb': round(actual_mb, 1), 'rows': rows,
                'runtime_s': round(elapsed, 2), 'peak_traced_mb': round(peak, 1),
                'success': data.get('success', False), 'server_rows': data.get('rowCount', 0),
                'error': data.get('error'),
            })
            gc.collect()

        print("\n" + "=" * 90)
        print("FILE-SIZE STRESS TEST: /profile endpoint")
        print("=" * 90)
        print(f"{'Label':<10} {'MB':>8} {'Rows':>10} {'Runtime':>10} {'Peak RAM':>10} {'OK':>5}")
        print("-" * 90)
        for r in results:
            ok = 'Y' if r['success'] else 'N'
            print(f"{r['label']:<10} {r['actual_mb']:>8.1f} {r['rows']:>10,} "
                  f"{r['runtime_s']:>9.2f}s {r['peak_traced_mb']:>9.1f} {ok:>5}")
        print("=" * 90)
        for r in results:
            assert r['success'], f"{r['label']} failed: {r['error']}"

    def test_analyse_lifecycle(self):
        gc.collect()
        tracemalloc.start()
        csv_bytes, rows, actual_mb = generate_csv(2)

        analyses = json.dumps({
            'mode': 'manual',
            'descriptive': {
                'columns': ['value_a', 'value_b', 'value_c'],
                'measures': ['central', 'spread', 'distribution'],
            },
            'inferential': {
                'correlationPairs': [['value_a', 'value_b'], ['value_b', 'value_c']],
            },
        })

        t0 = time.perf_counter()
        files = {'file': ('test.csv', io.BytesIO(csv_bytes), 'text/csv')}
        resp = client.post('/analyse', files=files, data={'analyses': analyses}, timeout=60)
        elapsed = time.perf_counter() - t0
        _, peak = get_rss_mb()
        tracemalloc.stop()
        data = resp.json()

        print("\n" + "=" * 90)
        print("FILE-SIZE STRESS TEST: /analyse endpoint (2 MB)")
        print("=" * 90)
        print(f"  Rows:         {rows:,}")
        print(f"  Runtime:      {elapsed:.2f}s")
        print(f"  Peak RAM:     {peak:.1f} MB")
        print(f"  Success:      {data.get('success', False)}")
        desc = data.get('result', {}).get('descriptive', [])
        corrs = data.get('result', {}).get('inferential', {}).get('correlations', [])
        print(f"  Descriptive:  {len(desc)} columns")
        print(f"  Correlations: {len(corrs)} pairs")
        print("=" * 90)
        assert data.get('success'), f"Failed: {data.get('error')}"

    def test_visualize_lifecycle(self):
        gc.collect()
        tracemalloc.start()
        csv_bytes, rows, actual_mb = generate_csv(2)

        t0 = time.perf_counter()
        files = {'file': ('test.csv', io.BytesIO(csv_bytes), 'text/csv')}
        resp = client.post('/visualize', files=files, timeout=60)
        elapsed = time.perf_counter() - t0
        _, peak = get_rss_mb()
        tracemalloc.stop()
        data = resp.json()

        sections = data.get('sections', [])
        chart_count = sum(len(s.get('charts', [])) for s in sections)

        print("\n" + "=" * 90)
        print("FILE-SIZE STRESS TEST: /visualize endpoint (2 MB)")
        print("=" * 90)
        print(f"  Rows:         {rows:,}")
        print(f"  Runtime:      {elapsed:.2f}s")
        print(f"  Peak RAM:     {peak:.1f} MB")
        print(f"  Success:      {data.get('success', False)}")
        print(f"  Charts:       {chart_count} across {len(sections)} sections")
        print("=" * 90)
        assert data.get('success'), f"Failed: {data.get('error')}"


def get_rss_mb():
    current, peak = tracemalloc.get_traced_memory()
    return current / 1024 / 1024, peak / 1024 / 1024


if __name__ == '__main__':
    pytest.main([__file__, '-v', '-s', '--tb=short'])
