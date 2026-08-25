# AGENTS.md

StatLab: Next.js (14, app router) frontend + Next API routes. Statistical computation runs in a **separate FastAPI Python backend**, not in the route code.

## The most important gotcha: dual backends

- `POST /api/analyse` (`app/api/analyse/route.ts:51`) **proxies all statistics** to a FastAPI service at `PYTHON_BACKEND_URL` (default `http://127.0.0.1:8000`, `app/api/analyse/route.ts:5`). If it's not running you get HTTP 502 "Python backend is not running."
- To run the full stack you need **two** processes:
  - Frontend: `npm run dev` (Next.js)
  - Backend: `npm run dev:backend` (uvicorn `backend.main:app` on port 8000)
- **Do not fix math/statistics bugs in `lib/stats/*.ts`.** Those TS files are now dead in the runtime — only the vitest tests import them. The production path is the Python `backend/stats/*.py` mirror. Fix the Python code.
- The AI routes (`/api/profile`, `/api/interpret`) are still pure Next.js — they call the AI provider chain in `lib/ai/`, not the Python backend.

## Python backend

- Source in `backend/` (`main.py` FastAPI app, `stats/` for computation, `planner.py` for the execution planner).
- Python tests: `python -m pytest backend/tests` (pytest 9.x, no extra services). Tests import `stats.*`/`models` directly via `backend/tests/conftest.py`.
- First-time setup: `pip install -r backend/requirements.txt`. Fresh venv recommended.
- Endpoints: `POST /analyse` (multipart: `file`, `analyses` JSON, optional `strategies` JSON), `POST /profile` (multipart `file`, optional `correlations`/`chunk_size`/`nbins` JSON) and `GET /health`. CORS allows only `http://localhost:3000`.
- `PYTHON_BACKEND_URL` is not in `.env.local.example`; rely on the default unless the backend runs elsewhere.
- `npm run dev:backend` (`uvicorn backend.main:app`) works from the repo root because `main.py` bootstraps `sys.path` with its own directory — `models`/`stats` are imported relative to `backend/`.

### Streaming / mergeable engine (`backend/stats/streaming.py`)

- `Moments` (Welford M2): EXACT mean/variance/std/min/max/sum; mergeable. Does NOT compute skew/kurt — the single-pass M3/M4 recurrence drifts at high cardinality.
- `TwoPassCentral`: EXACT skewness/kurtosis via a second pass of squared/cubed/4th-power deviations from the pass-1 mean; more accurate than scipy's own single-pass (matches Kahan compensated summation). Defaults to scipy's biased convention (matches `backend/stats/descriptive.py`).
- `TDigest`: q-adaptive greedy merge (`allowed = max(4·delta·n·q(1−q), 1)`) — NOT the constant `4·n·delta` limit, which degenerates to ~n singletons. Batch-compresses every `buffer_size` adds (amortized O(k log k)); ~0.7s for 200k values, ~1.5/delta centroids.
- `HyperLogLog`: register index = top `p` bits of the 128-bit md5; rank from the remaining `128-p` bits. `p=14` → ~1.6% error.
- `Histogram`/`FrequencyCounter`/`RowDuplicateCounter`/`GroupedMoments`/`Correlation` (exact Pearson + OLS via streaming sums; `from_arrays`/`from_array` give C-speed chunk ingestion; `Correlation.from_arrays` drops NaN rows pairwise).
- `ChunkedCsvReader` (two passes): pass 1 sniffs types/cardinality/row count with stdlib csv (header is consumed and the cursor reset so row counts are exact); pass 2 streams pandas `read_csv(chunksize=...)` with the sniffed dtype map. `row_count_estimate()` samples the file head.

### Verification agent + cache (`backend/verify.py`, `backend/cache.py`)

- `POST /profile` attaches a `ReproducibilityManifest` (sha256 `fileHash`, `ENGINE_VERSION="streaming-1.0.0"`, strategy, chunk size, passes, elapsed, options) to every response. With `verify=true` it also runs `verify_profile`: (1) exactness — re-derive the streaming accumulators over the first chunk with raw numpy; (2) full cross-check — pandas in-memory recompute for files ≤ `FULL_CHECK_MAX_ROWS` (200k); (3) determinism — profile twice, assert byte-identical JSON; plus structural `consistency_checks`.
- Skew/kurt cross-check uses a 2%-relative + 0.01-absolute tolerance vs the pandas reference: on high-magnitude data `(x-mean)^3` terms reach ~1e13 in float64 and BOTH implementations carry cancellation noise. Streaming moments are otherwise exact.
- `consistency_checks` must sort quantile keys numerically (`float(k[1:])`) — lexicographic `sorted()` on `"q5"/"q25"` compares out of order and false-positives.
- `ProfileCache` is an in-process LRU (8 entries). `/profile` checks the cache BEFORE `sniff()` (which costs ~3s on 100k rows) using a `chunk_size=None` sentinel key, and stores under both the sentinel and the resolved chunk-size keys. Cache hit: ~0.06s vs ~6.5s cold. `verify=true` and `cache=false` bypass it.

### Background jobs (`backend/jobs.py`)

- `JobManager` runs jobs on a one-worker `ThreadPoolExecutor` (Render Free = one small worker); `submit` returns a `JobResponse` immediately and the frontend polls `GET /jobs/{id}`. `result` is only attached on `succeeded`; finished jobs are dropped after 1h (`ttl`). In-process state only, like `ProfileCache`.
- `/analyse` and `/profile` bodies were extracted into `_run_analyse_sync` / `_run_profile_sync` (both take an optional `report(progress, stage, message)` callback); the synchronous endpoints call them directly and map `ValueError`→400, `RuntimeError`→500. `_run_analyse_sync` returns `model_dump(by_alias=True)` so the payload key is `schema` (not `schema_`).
- `compute_streaming_profile(progress_cb=...)` reports at pass boundaries (sniff → pass 1 → pass 2 → done) so jobs surface coarse progress.
- Frontend proxy: `app/api/stream-profile/route.ts` (mirrors `app/api/analyse/route.ts`), types in `lib/types.ts`, UI in `components/StreamProfilePanel.tsx` (rendered on `/analyse`). The panel now submits a background job via `app/api/stream-profile/jobs/route.ts` and polls `app/api/stream-profile/jobs/[id]/route.ts` for progress.
- **Poll proxies must use `cache: 'no-store'` on their `fetch`** — Next's default fetch cache froze the first `running` snapshot for the entire dev session, so the progress bar never advanced (jobs first polled after finishing hid the bug).
- Note: `python -m pytest backend/tests -q` currently expects 92 passing tests (incl. `test_verify.py`, `test_cache.py`, `test_jobs.py`, `test_job_endpoints.py`, `test_vie.py`). Frontend `npm test` expects 71 passing (incl. `tests/stream-profile-route.test.ts`, `tests/stream-profile-jobs-route.test.ts`, and `tests/visualize-route.test.ts` which exercise the proxies with a stubbed global `fetch`).

### Visualization Intelligence Engine (VIE) (`backend/vie/`)

- A deterministic, explainable, and statistically correct chart recommendation and specification engine. The AI model does **NOT** decide the chart types; it only explains the generated charts.
- The pipeline runs as: Raw Dataset → Metadata Extraction (Dataset Profiler) → Statistical Pattern Detection (`backend/vie/detect.py`) → Intent Detection (`backend/vie/intent.py`) → Visualization Scoring (`backend/vie/scoring.py`) → Chart Recommendation & Verification (`backend/vie/verify.py`) → ECharts Specification Generator (`backend/vie/spec.py`) → Dashboard Orchestration (`backend/vie/dashboard.py`).
- Supported charts: Histogram, Box Plot, Scatter Plot, Bar Chart, Line Chart, Heatmap, Pie/Donut (only ≤6 categories, one total, no primary comparison).
- The ECharts specifications generated are complete and self-contained (with axis titles, series type, tooltip, visualMap, legends, etc.).
- A verification step (`verify_spec`) validates every generated chart configuration for axis labels, category limits, non-emptiness, and correct aggregations.
- The `/visualize` endpoint returns a `VisualizationResponse` that is rendered by `VizDashboard` via `EChart` wrapper components on the frontend.

## Commands

```bash
npm run dev          # frontend only
npm run dev:backend  # Python backend only (uvicorn, port 8000)
npm test             # vitest (tests the TS lib/stats mirror only)
npm run build        # next build (runs lint + typecheck)
npx tsc --noEmit     # typecheck only
npm run lint         # next lint
```

- Tests are vitest with `@/` aliasing to repo root; no test DB or services required (`npm test` then `npm run build` to verify).

## Environment

- At least one AI key (Groq recommended) in `.env.local` for profiler/interpreter. Stats work with no keys.
- Git history already commits `agents.md` as lowercase alongside `README.md`; keep it.

## Notable past fixes (don't regress)

- Train/test split for held-out metrics must be called once (a double-split bug produced invalid test metrics).
- Multiple regression falls back to ridge (L2) when XᵀX is singular; logistic retries with more steps / stronger L2 if it fails to converge.
- Imputation stats use all rows including rows whose dependent value is later dropped.
- T-digest compression MUST use the q-adaptive merge rule — a constant `4·n·delta` limit degenerates to ~n singleton centroids once the cumulative weight passes the limit.
- `ChunkedCsvReader._read_header` must reset the stream cursor to just after the header, or pass-1 row counts are off by the header (and dtype sniffing sees the header cell as a data value).
- The streaming profile skips `FrequencyCounter` counting above ~500 distinct (the sniff HLL already knows cardinality); per-value counting of high-cardinality columns was a ~50s/100k-rows bottleneck.
- Skewness/kurtosis come from `TwoPassCentral` (two-pass), never from a single-pass M3/M4 recurrence.
- `/profile` cache lookup must run BEFORE `reader.sniff()` (sniff is ~3s on 100k rows); default chunk size is cached under a `None` sentinel key so hits skip it.