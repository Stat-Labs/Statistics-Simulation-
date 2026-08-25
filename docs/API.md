# StatLab API Reference

## Quick Reference
| What you need | Where to look |
|---------------|---------------|
| All endpoints | ## Endpoints section below |
| Type definitions | docs/TYPES.md or lib/types.ts |
| Route map | docs/ROUTES.md |
| PDF export | ## PDF Export section below |
| AI provider setup | ## AI Layer section below |
| Frontend call examples | Each endpoint entry has an example |

## Overview
StatLab is a stateless analysis tool. Users upload a CSV, receive 
instant statistical analysis and AI interpretation, then download 
a PDF report. Nothing is stored — no database, no user accounts, 
no cloud storage.

## Base URL
All routes relative to `/api`

## Authentication
None. The platform has no user accounts.

## Architecture
- CSV parsing: csv-parse (pure JS, no native dependencies)
- All computation: simple-statistics + ml-* libraries (never AI)
- All interpretation: AI provider chain (Groq → Mistral → Gemini → DeepSeek → HuggingFace)
- PDF generation: client-side jsPDF + html2canvas (never uploaded anywhere)
- No persistence layer of any kind

```
lib/
├── ai/
│   ├── providerChain.ts
│   ├── profilerPrompt.ts
│   └── interpreterPrompt.ts
├── pdf/
│   ├── generator.ts
│   ├── usePDFExport.ts
│   └── index.ts
├── stats/
│   ├── descriptive.ts
│   ├── inferential.ts
│   ├── parser.ts
│   └── predictive.ts
└── types.ts
```

## Shared Types
All request/response bodies are fully typed.
Full reference: docs/TYPES.md or lib/types.ts directly.

Frontend import example:
import type { ChartSuggestion, AnalysisResult } from '@/lib/types'

Backend import example:
import type { AnalyseRequestBody, AnalyseResponseBody } from '@/lib/types'

## Data Pipeline

### parseCSV
- Location: lib/stats/parser.ts
- Input: Buffer (raw CSV file), fileName: string
- Output: ParsedDataset { schema, data, missingValueReport }
- Called by: /api/analyse and /api/profile routes

### detectMissingValues
- Location: lib/stats/parser.ts  
- Input: Row[], Column[]
- Output: MissingValueReport
- Note: called automatically inside parseCSV

### applyMissingValueStrategy
- Location: lib/stats/parser.ts
- Input: Row[], Column[], MissingValueStrategyMap
- Output: cleaned Row[]
- Note: called before any statistical computation runs
- Smart default: if no strategy map provided, auto-applies 
  suggestedStrategy from MissingValueReport

### computeAllDescriptive
- Location: lib/stats/descriptive.ts
- Input: Row[], Column[], optional selectedColumns string[]
- Output: DescriptiveResult[]
- Computes: mean, median, mode, std dev, variance, min, max, 
  range, IQR, skewness, kurtosis, frequency tables
- Note: type-aware — skips irrelevant measures per column type

### computeInferential
- Location: lib/stats/inferential.ts
- Input: Row[], Column[], AnalysisRequest["inferential"]
- Output: InferentialResult
- Computes: Pearson/Spearman/point-biserial correlation,
  t-test (one and two sample), chi-square, ANOVA,
  full correlation matrix for heatmap
- Auto-selects correlation method based on column types

### runPredictive
- Location: lib/stats/predictive.ts
- Input: Row[], Column[], AnalysisRequest["predictive"]
- Output: PredictiveResult
- Models: linear, polynomial, logistic, multiple, 
  timeseries, random forest
- Auto-selects model if modelType not specified
- Handles missing values automatically before running
- Includes 5-period forecast for timeseries models
- Includes feature importance for random forest models

### selectModel
- Location: lib/stats/predictive.ts
- Input: dependent Column, predictor Column[], Row[]
- Output: ModelType
- Logic: binary target → logistic, multiple predictors → multiple,
  datetime predictor → timeseries, low linear R² → polynomial,
  large dataset → random forest, default → linear

## AI Layer

### callAI
- Location: lib/ai/providerChain.ts
- Input: systemPrompt: string, userPrompt: string, validator?: (content: string) => boolean
- Output: AIResponse { content, provider, fallbackUsed }
- Provider order: Groq → Mistral → Gemini → DeepSeek → HuggingFace
- Each provider response is validated against the expected JSON schema; invalid responses cause a fallback to the next provider
- All AI routes call this exclusively, never providers directly

### Profiler
- Location: lib/ai/profilerPrompt.ts
- Input: DatasetSchema
- Output: ProfilerOutput { analysisMap, chartSuggestions }
- Called by: /api/profile
- Fallback: if AI response unparseable, returns descriptive-only
  safe default so the app never crashes

### Interpreter
- Location: lib/ai/interpreterPrompt.ts
- Input: DatasetSchema, AnalysisResult
- Output: { summary, perAnalysis }
- Called by: /api/interpret
- Never recomputes — only explains provided numbers
- Fallback: generic summary returned if parse fails,
  so frontend never breaks

## PDF Export

### generatePDF
- Location: lib/pdf/generator.ts
- Runs: entirely client-side, nothing uploaded
- Input: PDFGenerationOptions { title, fileName, sections, includeTimestamp }
- Output: PDFGenerationResult { success, fileName?, error? }
- How sections work: each section has an elementId — the function
  screenshots that DOM element using html2canvas and adds it
  as a page in the PDF
- Cover page is built programmatically with jsPDF, not screenshotted

### usePDFExport (React hook)
- Location: lib/pdf/usePDFExport.ts
- Returns: { exportPDF, isGenerating, error }
- Usage:
  const { exportPDF, isGenerating } = usePDFExport()
  await exportPDF({
    title: 'Titanic Dataset Analysis',
    fileName: 'statlab-report.pdf',
    includeTimestamp: true,
    sections: [
      { elementId: 'descriptive-results', title: 'Descriptive Statistics' },
      { elementId: 'charts-panel', title: 'Charts & Visualisations' },
      { elementId: 'ai-interpretation', title: 'AI Interpretation' }
    ]
  })

Frontend note: every results section the user wants in the PDF
must have an id attribute matching a PDFSection.elementId.
Example: <div id="descriptive-results">...</div>

## Endpoints

### POST /api/profile
**Purpose:** Smart Analyse — AI selects analyses and charts
**Auth:** None
**Content-Type:** application/json

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| schema | DatasetSchema | Yes | From parseCSV output |

**Success response:**
{
  "success": true,
  "output": {
    "analysisMap": {
      "modelType": "logistic",
      "dependentVariable": "survived",
      "predictors": ["pclass", "sex", "age"],
      "correlationPairs": [["age", "fare"]],
      "hypothesisTests": [],
      "descriptiveColumns": ["age", "fare"]
    },
    "chartSuggestions": [
      { "chartType": "scatter", "x": "age", "y": "fare",
        "title": "Age vs Fare", "reason": "Both continuous" }
    ]
  }
}

**Smart Analyse full sequence:**
1. Parse CSV client-side → get schema
2. POST schema → /api/profile → get analysisMap + chartSuggestions
3. POST file + analysisMap → /api/analyse → get computed results
4. POST schema + results → /api/interpret → get AI text
5. Render charts + interpretation together

### POST /api/interpret
**Purpose:** AI plain-English interpretation of results
**Auth:** None
**Content-Type:** application/json

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| schema | DatasetSchema | Yes | Dataset schema |
| result | AnalysisResult | Yes | Output from /api/analyse |

**Success response:**
{
  "success": true,
  "summary": "string",
  "perAnalysis": [
    { "type": "string", "subject": "string", "interpretation": "string" }
  ],
  "provider": "groq|mistral|gemini|huggingface|null",
  "fallbackUsed": false
}

**Critical note for frontend:**
This route NEVER returns success: false due to AI failure.
If all providers are down it returns success: true with a
generic summary. Build your UI assuming success is always true
on 200 responses from this route.

**Full three-step sequence (pin this):**
Step 1 → POST /api/profile    (schema → analysisMap + charts)
Step 2 → POST /api/analyse    (file + analysisMap → results)
Step 3 → POST /api/interpret  (schema + results → text)
Render → charts from step 1 + numbers from step 2 + text from step 3

### POST /api/memory/ask
**Purpose:** Retrieval-before-answer — embeds the question, ranks workspace knowledge (findings, KPIs, glossary, datasets), then generates a grounded AI answer citing the retrieved sources.
**Auth:** Session (cookie `statlab_session`)
**Content-Type:** application/json

**Request:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| question | string | Yes | Natural-language question about the workspace |

**Success response:**
{
  "success": true,
  "question": "What drives revenue?",
  "answer": "string | null",
  "grounded": false,
  "sources": [{ "title": "string", "kind": "finding|kpi|glossary" }],
  "context": { "findings": [], "glossary": [], "kpis": [], "datasets": [] }
}

**Notes:**
- Empty relevant memory short-circuits to a canned response — no LLM call.
- If the AI chain fails, `answer` is null but the retrieved `context` is still returned so the client can show evidence.
- The interpreter route (`/api/interpret`) runs the same retrieval internally so every interpretation builds on past workspace knowledge.

### POST /api/analyse
**Purpose:** Core computation endpoint  
**Auth:** None  
**Content-Type:** multipart/form-data  

**Request fields:**
- file (File, required) — CSV file
- analyses (JSON string, required) — AnalysisRequest object
- strategies (JSON string, optional) — MissingValueStrategyMap.
  Auto-applied per column type if omitted.

**Success response shape:**
{
  "success": true,
  "result": { descriptive, inferential, predictive, chartSuggestions },
  "missingValueReport": { totalMissing, byColumn, requiresAttention },
  "schema": { fileName, rowCount, columnCount, columns, sampleRows }
}

**Error response shape:**
{ "success": false, "error": "message" }

**Frontend call example:**
const form = new FormData()
form.append('file', csvFile)
form.append('analyses', JSON.stringify(analysisRequest))
const res = await fetch('/api/analyse', { method: 'POST', body: form })
const { result, missingValueReport, schema } = await res.json()

### POST /api/visualize
**Purpose:** Visualization Intelligence Engine Proxy
**Auth:** Session (cookie `statlab_session`)
**Content-Type:** multipart/form-data

**Request fields:**
- file (File, required) — CSV file
- correlations / chunk_size / nbins / top_frequency / verify / cache (optional)

**Success response:**
Returns a `VisualizationResponse` JSON body (same structure as FastAPI `/visualize` response below).

## Python Backend (FastAPI, port 8000)

The Python service also exposes a streaming dataset profiler built on the
master-spec performance engine. Both `/analyse` and `/profile` now attach an
`execution` block describing the execution plan (strategy, chunk size, ordered
stages, memory/runtime estimates).

### POST /profile
**Purpose:** Full-population streaming profile — descriptive stats, percentiles,
histograms, frequency tables, cardinalities, row duplicates, and optional
pairwise correlations for **every row** of the dataset in near-constant memory.
**Auth:** None  
**Content-Type:** multipart/form-data

**Request fields:**
- file (File, required) — CSV/TSV
- correlations (JSON string, optional) — e.g. `[["age","score"],["income","score"]]`
- chunk_size (int, optional) — override the adaptive chunk size
- nbins (int, optional) — histogram bins (default 20)
- top_frequency (int, optional) — frequency-table depth (default 10)
- verify (string, optional) — `"true"` runs the verification agent and attaches a
  `verification` report (default `"false"`; bypasses the cache)
- cache (string, optional) — `"false"` disables the in-process result cache
  (default `"true"`)

**Two-pass streaming architecture** (memory proportional to one chunk, not the file):
1. Pass 1 — type inference (sniff), moments (mean/variance/std/min/max),
   t-digest percentiles, frequency counts (skipped above ~500 cardinality),
   HLL cardinality, row-duplicate hashing, pairwise correlations, sample rows.
2. Pass 2 — exact skewness/kurtosis (two-pass central moments), equal-width
   histograms, IQR outlier counts.

**Reproducibility & verification:** every profile carries a `manifest` (sha256
`fileHash`, `engineVersion`, strategy, chunk size, passes, elapsed, options) so
results can be reproduced/audited. Identical requests are served from an
in-process LRU cache (keyed by file hash + options) — cache hits skip the sniff
pass entirely (`cacheHit: true`). With `verify=true` a verification agent
cross-checks the engine three ways: exactness of the streaming accumulators
against raw numpy on the first chunk, a full in-memory pandas recomputation for
files ≤ 200k rows, a determinism run (two profiles, byte-identical JSON), plus
structural consistency checks. Skew/kurt are compared to the pandas reference
with a 2%-relative tolerance because both carry float64 cancellation noise on
high-magnitude data; streaming moments are otherwise exact.

**Success response shape:**
{
  "success": true,
  "execution": {
    "strategy": "streaming" | "in_memory" | "hybrid",
    "rowCount": 100000, "chunkSize": 500000,
    "estimatedMemoryBytes": 18240000, "estimatedRuntimeSeconds": 5.0,
    "stages": [ { "name": "sniff", "mode": "streaming", "cacheable": true, "cost": "low" } ],
    "notes": [ "..." ]
  },
  "manifest": {
    "fileHash": "0755fa37...", "engineVersion": "streaming-1.0.0",
    "strategy": "streaming", "rowCount": 100000, "columnCount": 6,
    "chunkSize": 500000, "passes": 2, "elapsedSeconds": 1.8,
    "options": { "nbins": 20, "topFrequency": 10, "correlations": [...] }
  },
  "verification": null | {
    "passed": true, "engineVersion": "streaming-1.0.0",
    "exactness": [ { "column": "age", "rowsChecked": 100000, "meanDelta": 0.0, "varianceDelta": 0.0, "meanExact": true, "varianceExact": true, "minExact": true, "maxExact": true } ],
    "exactnessOk": true,
    "consistency": [], "consistencyOk": true,
    "determinism": true,
    "fullCrossCheck": { "columnsChecked": 5, "issues": [], "passed": true, "mode": "full_in_memory" } | null,
    "notes": [ "..." ]
  },
  "cacheHit": false,
  "fileName": "x.csv", "rowCount": 100000, "columnCount": 6,
  "columns": [
    {
      "name": "age", "type": "continuous",
      "count": 95000, "nullCount": 5000, "nullPercentage": 5.0,
      "cardinality": 62, "mean": 48.55, "median": 48.64, "stdDev": 17.7,
      "min": 18, "max": 79, "range": 61, "iqr": 31.5,
      "skewness": -0.001, "kurtosis": -1.2, "outlierCount": 0,
      "quantiles": { "q5": 25.0, "q25": 34.0, "q50": 48.6, "q75": 65.5, "q95": 75.0 },
      "histogram": { "bins": [...], "counts": [...], "n": 95000, "nbins": 20 }
    }
  ],
  "sampleRows": [ { "age": 34, "region": "north" } ],
  "duplicateRowCount": 0, "duplicateCountCapped": false, "totalMissing": 5000,
  "correlations": [ { "columnA": "age", "columnB": "score", "r": -0.0018, "n": 95000, "method": "pearson" } ]
}

**Exactness contract** (see `backend/stats/streaming.py`): mean/variance/std/
min/max/skewness/kurtosis are exact on the full population; percentiles
(t-digest, `delta=0.005`) and cardinality (HLL, ~1.6% error) are approximate by
design; histograms are exact; frequency/duplicate counters degrade to
approximate only past their memory caps (`capped: true`).

**Error response shape:**
{ "detail": "message" }

### POST /visualize
**Purpose:** Visualization Intelligence Engine (VIE) Dashboard Generator
**Auth:** None
**Content-Type:** multipart/form-data

**Request fields:**
- file (File, required) — CSV/TSV
- correlations (JSON string, optional) — e.g. `[["age","score"],["income","score"]]`
- chunk_size (int, optional) — override chunk size
- nbins (int, optional) — histogram bins (default 20)
- top_frequency (int, optional) — frequency table depth (default 10)
- verify (string, optional) — `"true"` runs the verification check on all generated specs
- cache (string, optional) — `"false"` disables caching of the underlying profile (default `"true"`)

**VIE Execution Pipeline (Deterministic & Rule-Based):**
1. **Metadata Profiling**: Triggers the two-pass streaming profile to capture data types, missingness, cardinality, moments, histograms, and correlations.
2. **Feature & Pattern Detection**: Evaluates skewness, outliers, normality (histogram + Q-Q plot requirements), multicollinearity, trend, and seasonality.
3. **Intent Inference**: Automatically identifies analytical intentions (Compare categories, Trend over time, Distribution, Relationship, Composition, Data quality) based on column statistics.
4. **Chart Scoring & Selection**: Evaluates all candidate charts against intent and column constraints.
5. **ECharts Spec Generation**: Converts data and stats into raw JSON options compatible with Apache ECharts.
6. **Chart Verification**: Validates generated ECharts options against category limit rules, presence of axis labels, and non-emptiness. Rejecting anomalous charts.

**Success response shape:**
```json
{
  "success": true,
  "engine": "vie-1.0.0",
  "fileName": "x.csv",
  "rowCount": 100000,
  "columnCount": 6,
  "detectedPatterns": [
    { "name": "strongly_right_skewed", "column": "income", "description": "Column 'income' is strongly right-skewed (skewness: 2.1)" }
  ],
  "intents": [
    { "id": "distribution", "label": "Distribution", "description": "Distribution of continuous columns", "confidence": 1.0, "evidence": ["income is continuous"] }
  ],
  "sections": [
    {
      "id": "distribution_shape",
      "title": "Distribution & shape",
      "description": "Probability distributions, skewness, and outliers",
      "charts": [
        {
          "id": "hist_income",
          "section": "distribution_shape",
          "intent": "distribution",
          "title": "Distribution of income",
          "chartType": "histogram",
          "recommendation": {
            "chartType": "histogram",
            "title": "Histogram",
            "intent": "distribution",
            "confidence": 1.0,
            "reason": "Single continuous column 'income' with right skewness.",
            "advantages": ["Displays details of density distributions", "Easy to identify skewness/outliers"],
            "limitations": ["Visual display depends heavily on bin count"],
            "alternatives": [
              { "chartType": "boxplot", "title": "Box Plot", "confidence": 0.85, "reason": "Better for showing outlier boundaries" }
            ]
          },
          "spec": {
            "title": { "text": "Distribution of income" },
            "xAxis": { "type": "category", "data": [10.0, 20.0, 30.0] },
            "yAxis": { "type": "value" },
            "series": [
              { "type": "bar", "data": [15, 30, 10] }
            ]
          },
          "verification": {
            "passed": true,
            "checks": [
              { "name": "non_empty", "ok": true, "message": "Series data is not empty" }
            ],
            "notes": []
          }
        }
      ]
    }
  ],
  "note": null,
  "error": null
}
```

### POST /jobs/profile · POST /jobs/analyse · GET /jobs/{id} · GET /jobs

**Purpose:** Background execution for long-running work. Render Free has a
single small worker, so jobs run on a one-worker thread pool and the HTTP
endpoints stay responsive. The frontend submits a job (same multipart fields as
`/profile` / `/analyse`) and polls `GET /jobs/{jobId}` for progress.

**Submit — `POST /jobs/profile`** (multipart: `file`, optional `correlations`,
`chunk_size`, `nbins`, `top_frequency`, `verify`, `cache`):
{
  "jobId": "efbcd1ebbb7a", "kind": "profile",
  "status": "running", "progress": 0.0, "stage": "starting",
  "createdAt": 1754..., "startedAt": 1754..., "finishedAt": null,
  "result": null, "error": null
}

**Poll — `GET /jobs/{jobId}`:**
- `status`: `queued` | `running` | `succeeded` | `failed`
- `progress` (0–1) and `stage` update as the worker moves through the planner's
  stages (e.g. `sniffing` → `pass 1: …` → `pass 2: …` → `done`).
- `result` is present **only** on `succeeded` — the identical `StreamProfileResponse`
  / `AnalyseResponse` payload from the synchronous endpoints.
- `error` is populated on `failed`.

`GET /jobs` lists recent jobs (status/progress only, newest last). Finished
jobs are dropped after 1 hour. `404` for unknown ids. `ProfileCache` is shared
with the synchronous `/profile`, so a job can complete instantly on a cache hit.

### POST /api/stream-profile (Next.js proxy)

**Purpose:** browser-safe proxy to the Python `/profile` endpoint. Mirrors the
`/api/analyse` pattern (server-side fetch to `PYTHON_BACKEND_URL`, CSV
validation, timeout → 502/504 mapping). Request fields: `file` (required),
plus optional `correlations`, `chunk_size`, `nbins`, `top_frequency`,
`verify`, `cache`. The response passes the Python payload through verbatim
(`StreamProfileResponse` in `lib/types.ts`). The analyse page renders it via
`components/StreamProfilePanel.tsx`, which shows the column stats, the
reproducibility manifest, the verification report, and the `cacheHit` badge.

### POST /api/stream-profile/jobs (Next.js proxy)

**Purpose:** submit a profile as a background job on the Python worker. Same
multipart fields as `/api/stream-profile` (file required; `verify`, `cache`,
etc. optional). Returns the `ProfileJobResponse` (`jobId`, `status`, `progress`,
`stage`) immediately — the request never blocks on the computation. 30s submit
timeout, 502 when the backend is down.

### GET /api/stream-profile/jobs/[jobId] (Next.js proxy)

**Purpose:** poll a submitted profile job. Returns the current
`ProfileJobResponse`; on `succeeded` the `result` field carries the full
`StreamProfileResponse` (manifest, verification, `cacheHit`). The fetch uses
`cache: 'no-store'` so poll responses always reflect the latest backend state
(Next's default fetch cache would otherwise freeze the first snapshot for the
dev session). 404 for unknown ids, 502 when the backend is down. The panel
polls this route every ~700ms and renders a progress bar from `progress`/
`stage`.