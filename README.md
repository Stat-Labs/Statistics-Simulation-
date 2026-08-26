# StatLab

Intelligent statistical analysis platform. Upload a CSV, get exact full-population
descriptive/inferential/predictive analysis (even for datasets that don't fit in
RAM), AI-powered plain-English interpretation, and a downloadable PDF report.

Built by the **Department of Statistics, University of Benin** for the **Physical
Science Innovation Competition 2026**.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [API Surface](#api-surface)
  - [Next.js routes](#nextjs-routes)
  - [Python backend (FastAPI)](#python-backend-fastapi)
- [Statistical Engine](#statistical-engine)
  - [Streaming / mergeable algorithms](#streaming--mergeable-algorithms)
  - [In-memory analysis (cleaning, modeling)](#in-memory-analysis-cleaning-modeling)
- [Verification, Reproducibility & Cache](#verification-reproducibility--cache)
- [Background Jobs](#background-jobs)
- [AI Layer](#ai-layer)
- [PDF Generation](#pdf-generation)
- [Frontend](#frontend)
- [Types Reference](#types-reference)
- [Environment Variables](#environment-variables)
- [File Tree](#file-tree)

---

## Overview

StatLab runs a **dual-backend architecture**:

1. **Next.js 14 (App Router)** — auth, uploads, storage, workspace memory/RAG,
   AI profiling/interpretation, and the browser UI. It also proxies all
   statistical work to the Python service.
2. **FastAPI (Python)** — the statistical computation engine. All statistics
   run here, never in the Next.js routes.

The headline capability is the **streaming engine**: every statistic is computed
over **100% of the population** using exact mergeable accumulators, so memory
stays proportional to a single chunk regardless of dataset size (fits Render's
free tier). A verification agent independently cross-checks results, and every
profile carries a reproducibility manifest plus an in-process result cache.

**Key features:**

- **Exact full-population statistics** — mean/variance/std/min/max/skew/kurtosis
  are exact; percentiles (t-digest) and cardinality (HLL) are approximate by
  design with bounded error.
- **Two-pass streaming profile** (`/profile`) — descriptors, percentiles,
  histograms, frequency tables, cardinalities, row duplicates, optional
  pairwise correlations, all in near-constant memory.
- **Background jobs** (`/jobs/*`) — long computations are queued on a worker
  pool and polled for progress, so HTTP stays responsive.
- **Verification agent** — cross-checks the engine (exactness vs raw numpy,
  full pandas recompute for files ≤ 200k rows, determinism, consistency) and
  attaches a sha256 reproducibility manifest to every profile.
- **Multi-model predictive engine** — linear, polynomial, multiple (ridge
  fallback), logistic, timeseries, random forest, plus XGBoost/LightGBM/optuna
  tuning for model training.
- **Workspace memory / RAG** — datasets, analyses, findings, glossary, and KPIs
  are stored per workspace and queryable in natural language.
- **AI interpretation** — a fallback chain of 5 providers (Groq → Mistral →
  Gemini → DeepSeek → HuggingFace). Never fails; returns a generic summary if
  all providers are down.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    Browser (Next.js :3000)                      │
│   upload  →  analyse page  →  charts/tables  →  PDF export     │
└───────────────────────────────┬────────────────────────────────┘
                                │ browser calls /api/* only (no :8000)
┌───────────────────────────────┴────────────────────────────────┐
│                    Next.js API Routes (server)                  │
│  /api/analyse            → proxy → FastAPI /analyse             │
│  /api/stream-profile     → proxy → FastAPI /profile             │
│  /api/stream-profile/jobs→ proxy → FastAPI /jobs/profile + poll │
│  /api/profile   /api/interpret   (AI, pure Next.js)             │
│  /api/memory/*  /api/datasets /api/analyses /api/uploads        │
│  /api/auth/*    /api/settings/*                                 │
└───────────────────────────────┬────────────────────────────────┘
                                │ PYTHON_BACKEND_URL (default http://127.0.0.1:8000)
┌───────────────────────────────┴────────────────────────────────┐
│                    FastAPI (Python :8000)                       │
│  POST /analyse   POST /profile   POST /jobs/analyse             │
│  POST /jobs/profile   GET /jobs/{id}   GET /jobs   GET /health  │
│                                                                 │
│  backend/stats/   streaming engine (mergeable accumulators)     │
│  backend/planner.py  backend/verify.py  backend/cache.py        │
│  backend/jobs.py     backend/models.py                          │
└─────────────────────────────────────────────────────────────────┘
```

**Design principles:**

- **Statistics always in Python.** `lib/stats/*.ts` is a **dead mirror** — only
  the vitest suite imports it. The production path is `backend/stats/*.py`;
  never fix math bugs in the TS files.
- **Full population, bounded memory.** Streaming stages hold at most one chunk;
  in-memory stages are used only when the algorithm genuinely requires the full
  dataset (cleaning, model training).
- **Graceful degradation.** Every layer has a fallback: missing values get
  imputed, singular matrices trigger ridge regression, AI failures return
  generic results.

---

## Quick Start

```bash
# 1. Install + configure the frontend
npm install
cp .env.local.example .env.local
# 2. Python backend
python -m venv .venv && .venv/Scripts/activate   # (Windows) — or venv/bin/activate
pip install -r backend/requirements.txt

# 3. Run BOTH processes (two terminals)
npm run dev           # Next.js on :3000
npm run dev:backend   # uvicorn FastAPI on :8000 (backend.main:app)

# Verify
curl http://127.0.0.1:8000/health   # {"status":"ok"}
```

The frontend and backend are independent. Statistics need no AI keys; the
profiler/interpreter need at least one (Groq recommended).

### Tests

```bash
npm test              # vitest — TS lib/stats mirror only
npm run build         # next build (runs lint + typecheck)
python -m pytest backend/tests   # Python engine (92 tests, no services)
```

---

## API Surface

### Next.js routes

| Route | Purpose |
|-------|---------|
| `POST /api/analyse` | Proxies `file` + `analyses` to FastAPI `/analyse`; 502/504 mapping if the Python backend is down. |
| `POST /api/stream-profile` | Proxies to FastAPI `/profile` (sync); optional `correlations`, `verify`, `cache`. |
| `POST /api/stream-profile/jobs` · `GET /api/stream-profile/jobs/[id]` | Submit a profile job and poll it. |
| `POST /api/profile` | **AI profiler** (pure Next.js) — schema → recommended analyses + charts. |
| `POST /api/interpret` | **AI interpretation** (pure Next.js) — results → plain-English summary. |
| `POST /api/visualize` | **Visualization Intelligence Engine proxy** — proxies to FastAPI `/visualize` to get a deterministic, verified ECharts dashboard. |
| `POST /api/memory/extract` · `/api/memory/ask` · `/api/memory/query` · `/api/memory/summary` | Workspace memory / RAG. |
| `POST /api/datasets` · `/api/analyses` · `/api/analyses/[id]` | Persisted datasets & analyses. |
| `POST /api/uploads` + chunk endpoints | Resumable storage uploads (local/cloudinary). |
| `POST /api/detect-codes` | Coded-column detection. |
| `/api/auth/*`, `/api/settings/*` | Auth (session, register, login, invite) and key settings. |

### Python backend (FastAPI)

| Endpoint | Purpose |
|----------|---------|
| `POST /analyse` | Full in-memory pipeline: parse → clean → descriptive / inferential / predictive / model training. Materializes the dataset (needed for cleaning + charts). |
| `POST /profile` | **Streaming full-population profile.** Form fields: `file`, `correlations` (JSON `[["a","b"]]`), `chunk_size`, `nbins`, `top_frequency`, `verify`, `cache`. |
| `POST /visualize` | **Visualization Intelligence Engine.** Deterministic chart recommendations (Histogram, Box Plot, Scatter Plot, Bar Chart, Line Chart, Heatmap, Pie Chart) and validated ECharts JSON specifications. |
| `POST /jobs/profile` · `POST /jobs/analyse` | Submit long work to the background worker; returns a `jobId` immediately. |
| `GET /jobs/{id}` · `GET /jobs` | Poll progress (`progress` 0–1, `stage`) and fetch `result` on success. |
| `GET /health` | Liveness probe. |

Full request/response shapes live in `docs/API.md`.

---

## Statistical Engine

Source: `backend/stats/*.py`. The engine is split into a **streaming/mergeable**
layer for full-population statistics and an **in-memory** layer for operations
that require the whole dataset.

### Streaming / mergeable algorithms

All in `backend/stats/streaming.py` — accumulators mergeable across chunks so
one pass is enough:

| Algorithm | Accuracy | Notes |
|-----------|----------|-------|
| `Moments` | **exact** | Welford M2 → mean/variance/std/min/max/sum. No skew/kurt (single-pass M3/M4 drifts at scale). |
| `TwoPassCentral` | **exact** | Skew/kurtosis via a second pass of squared/cubed/4th-power deviations from the pass-1 mean; more accurate than scipy's single-pass. |
| `TDigest` | approximate | q-adaptive greedy merge (`max(4·δ·n·q(1−q), 1)`), batch-compressed; ~1e-3 error, mergeable. |
| `HyperLogLog` | approximate | 128-bit md5 register indexing, `p=14` → ~1.6% error; cardinality without counting. |
| `Histogram` / `FrequencyCounter` / `RowDuplicateCounter` | exact (until cap) | `capped` flag when the memory cap is hit. |
| `Correlation` | **exact** | streaming Pearson + OLS sums; `from_arrays` drops NaN rows pairwise. |

`ChunkedCsvReader` (`backend/stats/chunked_reader.py`) does the two passes:
pass 1 sniffs types/cardinality/row count with stdlib csv, pass 2 streams pandas
`read_csv(chunksize=...)` with the sniffed dtype map.

`backend/planner.py` picks strategy (`streaming`/`in_memory`/`hybrid`), an
adaptive chunk size from the worker's available memory, and ordered progress
stages with honest memory/runtime estimates.

### In-memory analysis (cleaning, modeling)

- `descriptive.py`, `inferential.py` — scipy-based stats, correlations,
  hypothesis tests, regression.
- `preprocessing.py` / `cleaning.py` — imputation (incl. KNN/iterative), outlier
  handling, categorical/state standardization, deduplication.
- `predictive.py`, `model_training.py` — sklearn models plus XGBoost/LightGBM
  with optuna tuning, ridge fallback for singular XᵀX, logistic retries.
- `feature_engineering.py`, `explainability.py`, `business_translation.py`.

---

## Verification, Reproducibility & Cache

- Every `/profile` response carries a `ReproducibilityManifest` (sha256
  `fileHash`, engine version `streaming-1.0.0`, strategy, chunk size, passes,
  elapsed, options).
- With `verify=true`, `verify_profile` runs four checks:
  1. **Exactness** — re-derives the streaming accumulators over the first chunk
     with raw numpy.
  2. **Full cross-check** — pandas in-memory recompute for files ≤ 200k rows.
  3. **Determinism** — profiles twice, asserts byte-identical JSON.
  4. **Consistency** — structural checks (quantiles monotonic, range = max−min,
     histogram n = count, |r| ≤ 1).
- Skew/kurt are compared to the pandas reference with a 2%-relative + 0.01-
  absolute tolerance: on high-magnitude data both implementations carry
  float64 cancellation noise.
- `ProfileCache` (in-process LRU, 8 entries) serves identical requests in
  ~0.06s (vs ~6.5s cold); `cacheHit` is set on the response. Cache lookup runs
  **before** the ~3s sniff pass.

---

## Background Jobs

Render Free gives one small worker, so `JobManager` (`backend/jobs.py`) runs
jobs on a one-worker `ThreadPoolExecutor`. `POST /jobs/profile` and
`POST /jobs/analyse` accept the same multipart forms as their synchronous
counterparts, return a `jobId` immediately, and the frontend polls
`GET /jobs/{id}` (`status`, `progress` 0–1, `stage`, then `result` on success).
Finished jobs expire after 1 hour; `ProfileCache` is shared, so a cache hit
completes a job instantly.

The `StreamProfilePanel` on `/analyse` submits a job, renders a live progress
bar, and surfaces `manifest`, `verification`, and `cacheHit` from the result.

---

## AI Layer

**Files:** `lib/ai/providerChain.ts`, `lib/ai/profilerPrompt.ts`,
`lib/ai/interpreterPrompt.ts`, `lib/ai/rag.ts`

A fallback chain tries providers in order until one succeeds:
Groq → Mistral → Gemini → HuggingFace → DeepSeek. Responses are validated
against expected JSON schema; on failure the chain falls through.

Three AI roles:

1. **Profiler** (`POST /api/profile`) — given a schema, recommends an analysis
   plan + charts. Rule-based fallback if AI fails.
2. **Interpreter** (`POST /api/interpret`) — turns computed results into
   plain-English explanations. Never returns `success: false`.
3. **Memory assistant** (`POST /api/memory/ask`) — answers questions about the
   workspace by retrieving stored findings/KPIs/glossary via RAG.

---

## PDF Generation

**Files:** `lib/pdf/generator.ts`, `lib/pdf/usePDFExport.ts`

Fully client-side: `html2canvas` screenshots DOM sections (matched by `id`) and
`jsPDF` assembles them with a programmatic cover page.

```ts
const { exportPDF, isGenerating } = usePDFExport()
await exportPDF({
  title: 'Titanic Dataset Analysis',
  fileName: 'statlab-report.pdf',
  includeTimestamp: true,
  sections: [
    { elementId: 'descriptive-stats', title: 'Descriptive Statistics' },
    { elementId: 'charts-panel', title: 'Charts & Visualisations' },
  ],
})
```

---

## Frontend

### Pages

| Route | File | Description |
|-------|------|-------------|
| `/` | `app/page.tsx` | Upload + kick-off the analysis pipeline. |
| `/upload` | `app/upload/page.tsx` | Storage-backed dataset upload. |
| `/analyse` | `app/analyse/page.tsx` | Results: charts, tables, model cards, AI text, PDF export, streaming profile panel. |
| `/dashboard` | `app/dashboard/page.tsx` | Saved analyses + workspace memory. |
| `/login` `/signup` `/signup/enterprise` | `app/(auth)/…` | Auth. |
| `/settings/keys` | `app/settings/keys/page.tsx` | AI key management. |

### Key components & hooks

| Piece | File | Description |
|-------|------|-------------|
| `useStatLab()` | `lib/useStatLab.ts` | Primary state manager: pipeline state, file/schema, session history, `submit()`, `loadSession()`, `runPredictiveModel()`. |
| `StreamProfilePanel` | `components/StreamProfilePanel.tsx` | Job-submitted streaming profile with progress bar + manifest/verification/cache badges. |
| `StatLabProvider` | `components/StatLabProvider.tsx` | React context provider. |
| `ErrorBoundary` | `components/ErrorBoundary.tsx` | Catches chart render errors. |
| `usePDFExport()` | `lib/pdf/usePDFExport.ts` | PDF generation wrapper. |

---

## Types Reference

All types live in `lib/types.ts`. Key additions for the Python engine:

| Type | Description |
|------|-------------|
| `StreamProfileResponse` | Full-population profile: columns, correlations, execution, manifest, verification, `cacheHit`. |
| `ProfileColumn` | Per-column profile entry (count/null%/cardinality/mean/median/std/skew/quantiles/histogram/frequency). |
| `ReproducibilityManifest` | sha256 `fileHash`, engine version, strategy, chunk size, passes, elapsed, options. |
| `VerificationReport` | exactness / consistency / determinism / full cross-check results. |
| `ExecutionInfo` | planner strategy, chunk size, memory & runtime estimates, ordered stages. |

Legacy types (`Column`, `DatasetSchema`, `ModelType`, `DescriptiveResult`,
`CorrelationResult`, `RegressionResult`, `PredictiveResult`,
`ChartSuggestion`, `MissingValueStrategy`) are unchanged.

---

## Environment Variables

| Variable | Required | Notes |
|----------|----------|-------|
| `GROQ_API_KEY` | Recommended | Fastest AI provider — first in the chain. |
| `MISTRAL_API_KEY` | Optional | AI fallback. |
| `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` / `HUGGINGFACE_API_KEY` | Optional | Further fallbacks. |
| `AUTH_SECRET` | Yes (prod) | ≥32 chars (`openssl rand -base64 32`). |
| `DATABASE_URL` / `DB_DRIVER` | Blank in dev | Blank → SQLite at `db/statlab.sqlite`; prod → Postgres. |
| `STORAGE_PROVIDER` | dev: `local` | `local` (files in `./storage/`) · `cloudinary` (default). |
| `ENCRYPTION_MASTER_KEY` | Yes (prod) | Base64 32-byte key for BYOK keys at rest. |
| `PYTHON_BACKEND_URL` | No | `http://127.0.0.1:8000` default; only needed if the backend runs elsewhere. |
| `RETAIN_RAW_DATASETS` | No | `false` (default) deletes raw datasets after knowledge extraction. |
| `NEXT_PUBLIC_APP_URL` | No | Public base URL for invite links. |

At least one AI key is required for the profiler/interpreter. **Statistics work
with no keys** — the Python engine is pure math.

---

## File Tree

```
├── app/
│   ├── analyse/page.tsx              # Results + streaming profile panel
│   ├── upload/  dashboard/  settings/  (auth)/   # Other pages
│   ├── api/
│   │   ├── analyse/route.ts          # proxy → FastAPI /analyse
│   │   ├── stream-profile/route.ts   # proxy → FastAPI /profile
│   │   ├── stream-profile/jobs/…     # job submit + poll proxies
│   │   ├── profile/  interpret/      # AI (pure Next.js)
│   │   ├── memory/  datasets/  analyses/  uploads/  detect-codes/
│   │   ├── auth/  settings/
│   └── page.tsx                      # Upload page
├── components/  StatLabProvider.tsx  ErrorBoundary.tsx  StreamProfilePanel.tsx
├── lib/
│   ├── ai/            providerChain.ts profilerPrompt.ts interpreterPrompt.ts rag.ts
│   ├── pdf/           generator.ts usePDFExport.ts
│   ├── stats/         TS MIRROR (dead at runtime — tests only)
│   ├── types.ts  useStatLab.ts  useDebounce.ts
│   └── utils/         errors.ts validation.ts rateLimit.ts schemas.ts
├── backend/                          # FastAPI service
│   ├── main.py  models.py  planner.py  verify.py  cache.py  jobs.py
│   ├── stats/  streaming.py chunked_reader.py profile.py descriptive.py
│   │           inferential.py predictive.py model_training.py cleaning.py …
│   └── tests/                        # pytest (68 tests)
├── tests/                            # vitest (TS mirror)
├── db/  storage/  drizzle.config.*
└── docs/  API.md  FRONTEND.md  ROUTES.md  TYPES.md  AGENTS.md
```
