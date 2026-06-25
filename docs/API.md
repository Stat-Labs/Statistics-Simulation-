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