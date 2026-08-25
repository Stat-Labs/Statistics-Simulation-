# StatLab Frontend Guide

## Tools you will use

| What | Library | Why |
|------|---------|-----|
| Charts | **Recharts** (`recharts`) | All chart types: scatter, line, bar, histogram, heatmap, boxplot, pie |
| Interactive Charts | **Apache ECharts** (`echarts`) | Used for the Visualization Intelligence Engine dashboard (automatically rendered from backend specs) |
| Client-side CSV parsing | **Papa Parse** (`papaparse`) | Extract column names + sample rows for schema, then send raw CSV to backend |
| PDF export | **jsPDF + html2canvas** (`lib/pdf/usePDFExport.ts`) | Built-in React hook — just pass DOM element IDs |
| Styling | **Tailwind CSS** | Already configured |
| HTTP | **fetch** (native) | No axios needed — 3 simple POST calls |

Install Papa Parse: `npm install papaparse`

## Pages

| Route | What it does |
|-------|-------------|
| `/` | CSV upload + mode selection (Smart / Manual) |
| `/analyse` | Shows results: charts, stats tables, AI text, PDF export |
| `/visualize` | Visualization Intelligence dashboard page — upload dataset, render ECharts charts |

## The 3 API calls (in order)

### 1. POST /api/profile  (AI decides what to run)

```
Request:  { schema: DatasetSchema }
Response: { success: true, output: { analysisMap, chartSuggestions } }
```

Call this when the user clicks **Smart Analyse**.

Map the `analysisMap` into an `AnalysisRequest` like this:

```ts
const analyses = {
  mode: 'smart',
  descriptive: { columns: output.analysisMap.descriptiveColumns, measures: ['central', 'spread', 'distribution'] },
  inferential: {
    correlationPairs: output.analysisMap.correlationPairs,
    hypothesisTests: output.analysisMap.hypothesisTests,
    regression: output.analysisMap.dependentVariable ? {
      dependent: output.analysisMap.dependentVariable,
      predictors: output.analysisMap.predictors,
    } : undefined,
  },
  predictive: output.analysisMap.dependentVariable ? {
    dependent: output.analysisMap.dependentVariable,
    predictors: output.analysisMap.predictors,
    modelType: output.analysisMap.modelType,
  } : undefined,
}
```

Save `chartSuggestions` — those tell you what charts to render later.

### 2. POST /api/analyse  (pure math computation)

```
Request:  multipart/form-data
          file: CSV file
          analyses: JSON.stringify(AnalysisRequest)
Response: { success: true, result: { descriptive, inferential, predictive, chartSuggestions }, schema, missingValueReport }
```

```ts
const form = new FormData()
form.append('file', csvFile)
form.append('analyses', JSON.stringify(analysisRequest))
const res = await fetch('/api/analyse', { method: 'POST', body: form })
const { result, schema } = await res.json()
```

### 3. POST /api/interpret  (AI explains the numbers)

```
Request:  { schema: DatasetSchema, result: AnalysisResult }
Response: { success: true, summary: string, perAnalysis: [...], provider: string, fallbackUsed: boolean }
```

```ts
const res = await fetch('/api/interpret', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ schema, result })
})
const { summary, perAnalysis } = await res.json()
```

**Important**: This route always returns `success: true` even if AI fails (returns a generic summary). Never shows an error state.

## What to render

| Data source | Render as |
|-------------|-----------|
| `chartSuggestions` (from profile or analyse) | Recharts components — map `chartType` field to `<ScatterChart>`, `<BarChart>`, `<LineChart>`, etc. |
| `result.descriptive` | Table — one row per column with mean, median, stdDev, min, max, skewness |
| `result.inferential.correlations` | Table or heatmap — columnA, columnB, r, interpretation |
| `result.inferential.hypothesisTests` | Table — test type, statistic, p-value, significant flag |
| `result.predictive` | Model info card — modelType, R², accuracy, coefficients, forecast |
| `summary` (from interpret) | Prose block at the top |
| `perAnalysis` (from interpret) | Prose cards — each has a type, subject, and interpretation |

## PDF export

Already built — use the React hook:

```tsx
import { usePDFExport } from '@/lib/pdf'

function ResultsPage() {
  const { exportPDF, isGenerating } = usePDFExport()

  return (
    <div>
      <div id="descriptive-stats">{/* your table */}</div>
      <div id="charts">{/* your charts */}</div>
      <div id="ai-interpretation">{/* your AI text */}</div>
      <button onClick={() => exportPDF({
        title: 'Analysis Report',
        fileName: 'report.pdf',
        includeTimestamp: true,
        sections: [
          { elementId: 'descriptive-stats', title: 'Descriptive Statistics' },
          { elementId: 'charts', title: 'Charts' },
          { elementId: 'ai-interpretation', title: 'AI Interpretation' },
        ]
      })} disabled={isGenerating}>
        {isGenerating ? 'Generating...' : 'Export PDF'}
      </button>
    </div>
  )
}
```

Every section you want in the PDF must have an `id` attribute matching a section's `elementId`.

## Type imports

All types are in `@/lib/types`:

```ts
import type { DatasetSchema, AnalysisRequest, AnalysisResult,
  ChartSuggestion, DescriptiveResult, CorrelationResult,
  HypothesisResult, PredictiveResult, ProfilerOutput } from '@/lib/types'
```

## Manual mode

For Manual mode, skip `/api/profile` and build the `AnalysisRequest` directly from user form inputs.

```ts
const analyses = {
  mode: 'manual',
  descriptive: { columns: ['age', 'score'], measures: ['central', 'spread'] },
  inferential: { correlationPairs: [['age', 'score']] },
  predictive: { dependent: 'score', predictors: ['age'], modelType: 'linear' },
}
```

Then go straight to `/api/analyse` with the raw CSV.

## Full flow summary

```
Smart:      Upload CSV → parse with PapaParse → POST /api/profile → map to AnalysisRequest → POST /api/analyse → POST /api/interpret → render all
Manual:     Upload CSV → build AnalysisRequest from form → POST /api/analyse → (skip interpret if no AI key) → render
Visualize:  Upload CSV → POST /api/visualize → receive VisualizationResponse → render sections via VizDashboard using EChart components
```

## Visualization Intelligence Engine (VIE) Flow

The `/visualize` page utilizes the deterministic, explainable Visualization Intelligence Engine (VIE) located in the Python backend. The frontend does not decide or infer chart configuration; it acts as a renderer of backend-generated ECharts configurations.

1. **Upload Dataset**: The user picks a CSV or Excel file on the `/visualize` page.
2. **Retrieve Specifications**: The frontend performs a `POST` request to `/api/visualize` with the file.
3. **Parse Dashboard response**: The response is a `VisualizationResponse` object which includes:
   - Metadata (`fileName`, `rowCount`, `columnCount`)
   - Statistical patterns (`detectedPatterns`)
   - Inferred user intents (`intents`)
   - Structured sections (`sections`) containing charts (`VizChart`)
4. **Render Dashboard**:
   - The `/visualize` page renders the header and metadata statistics.
   - It iterates over `sections` and renders a `VizDashboard` component.
   - For each chart, it renders an `EChart` wrapper component.
   - Each chart displays its confidence score, advantages, limitations, and alternatives when expanded.
   - If a chart's verification fails, a warning badge is shown.

