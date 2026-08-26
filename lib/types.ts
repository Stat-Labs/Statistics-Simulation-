export interface Column {
  name: string
  type: "continuous" | "categorical" | "ordinal" | "datetime" | "binary"
  coded?: boolean
  codeNote?: string
  codeUncertain?: boolean
  labels?: Record<string, string>
  uniqueValues?: string[] | number[]
  min?: number
  max?: number
  mean?: number
  median?: number
  sampleValues?: unknown[]
  nullCount?: number
}

export interface DatasetSchema {
  fileName: string
  rowCount: number
  columnCount: number
  columns: Column[]
  sampleRows: Record<string, unknown>[]
  fullData?: Record<string, unknown>[]
  duplicateRowCount?: number
}

export type Row = Record<string, string | number | null>

export interface AnalysisRequest {
  mode: "smart" | "manual"
  descriptive?: {
    columns: string[]
    measures: ("central" | "spread" | "distribution")[]
  }
  inferential?: {
    correlationPairs?: [string, string][]
    hypothesisTests?: {
      type: "t-test" | "chi-square" | "anova"
      columns: string[]
    }[]
    regression?: {
      dependent: string
      predictors: string[]
    }
  }
  predictive?: {
    dependent: string
    predictors: string[]
    modelType?: ModelType
  }
  modelTraining?: {
    enabled?: boolean
    problemType?: string
    models?: string[]
    tuningMethod?: string
    tuningIterations?: number
    cvFolds?: number
    testSize?: number
    valSize?: number
  }
}

export type ModelType =
  | "linear"
  | "polynomial"
  | "logistic"
  | "multiple"
  | "timeseries"
  | "randomforest"

export interface DescriptiveResult {
  column: string
  mean?: number
  median?: number
  mode?: number | string
  stdDev?: number
  variance?: number
  min?: number
  max?: number
  range?: number
  iqr?: number
  skewness?: number
  kurtosis?: number
  count: number
  nullCount: number
  outlierCount?: number
  frequencyTable?: Record<string, number>
  note?: string
}

export interface TestMetrics {
  rSquared?: number
  rmse?: number
  accuracy?: number
  precision?: number
  recall?: number
  f1?: number
  aucRoc?: number
  sampleSize: number
}

export interface CorrelationResult {
  columnA: string
  columnB: string
  r: number
  method: "pearson" | "spearman"
  interpretation:
    | "strong positive"
    | "moderate positive"
    | "weak"
    | "moderate negative"
    | "strong negative"
}

export interface RegressionResult {
  modelType: ModelType
  dependent: string
  predictors: string[]
  coefficients: number[]
  intercept: number
  rSquared?: number
  adjustedRSquared?: number
  note?: string
  mse?: number
  rmse?: number
  accuracy?: number
  predictions: number[]
  residuals?: number[]
  testPredictions?: number[]
  testMetrics?: TestMetrics
  vif?: { predictor: string; value: number }[]
  featureImportance?: {
    feature: string
    importance: number
  }[]
}

export interface HypothesisResult {
  testType: "t-test" | "chi-square" | "anova"
  statistic: number
  pValue: number
  significant: boolean
  confidenceLevel: number
  columns: string[]
}

export interface InferentialResult {
  correlations?: CorrelationResult[]
  hypothesisTests?: HypothesisResult[]
  regression?: RegressionResult
}

export interface PredictiveResult {
  modelType: ModelType
  regressionResult: RegressionResult
  forecast?: {
    label: string
    predicted: number
    lower: number
    upper: number
  }[]
}

export interface AnalysisResult {
  descriptive?: DescriptiveResult[]
  inferential?: InferentialResult
  predictive?: PredictiveResult
  chartSuggestions: ChartSuggestion[]
}

export type ChartType =
  | "scatter"
  | "line"
  | "bar"
  | "histogram"
  | "heatmap"
  | "boxplot"
  | "pie"
  | "confusion_matrix"
  | "roc_curve"

export interface ChartSuggestion {
  chartType: ChartType
  title: string
  reason: string
  x?: string
  y?: string
  column?: string
  series?: string[]
}

export interface AnalyseRequestBody {
  schema: DatasetSchema
  data: Row[]
  analyses: AnalysisRequest
}

export interface AnalyseResponseBody {
  success: boolean
  result?: AnalysisResult
  modelTrainingReport?: ModelTrainingReport
  error?: string
}

export interface ModelTrainingReport {
  problemType?: string
  split?: { train: number; val: number; test: number; testSize: number; valSize: number }
  baselines?: Record<string, unknown>
  models?: Record<string, unknown>
  bestModel?: { model: string; score: number }
  explainability?: {
    methods?: Record<string, unknown>
    consensusRanking?: { feature: string; averageRank: number; consensusRank: number }[]
    summary?: string
  }
  businessTranslation?: {
    insights?: { type: string; text: string }[]
    confidence?: string
    summary?: string
  }
  featureInsights?: {
    topFeatures?: { feature: string; percentage: number; level: string; description: string }[]
    summary?: string
  }
  recommendations?: { category: string; priority: string; action: string; rationale: string }[]
  charts?: Record<string, unknown>
}

export interface ProfileRequestBody {
  schema: DatasetSchema
}

export interface ProfileResponseBody {
  success: boolean
  output?: ProfilerOutput
  error?: string
}

export interface InterpretRequestBody {
  schema: DatasetSchema
  result: AnalysisResult
  modelTrainingReport?: ModelTrainingReport
}

export interface InterpretResponseBody {
  success: boolean
  summary?: string
  perAnalysis?: {
    type: string
    interpretation: string
  }[]
  error?: string
}

export type AIProvider = "groq" | "mistral" | "gemini" | "huggingface" | "deepseek"

export interface AIResponse {
  content: string
  provider: AIProvider
  fallbackUsed: boolean
}

export interface RelationshipSuggestion {
  dependent: string
  predictors: string[]
  modelType: ModelType
  reason: string
}

export interface ProfilerOutput {
  analysisMap: {
    modelType: ModelType
    dependentVariable: string | null
    predictors: string[]
    correlationPairs: [string, string][]
    hypothesisTests: {
      type: "t-test" | "chi-square" | "anova"
      columns: string[]
    }[]
    descriptiveColumns: string[]
  }
  chartSuggestions: ChartSuggestion[]
  relationshipSuggestions: RelationshipSuggestion[]
}

export type MissingValueStrategy =
  | "mean"
  | "median"
  | "mode"
  | "drop_rows"
  | "drop_column"
  | "zero"
  | "forward_fill"
  | "backward_fill"

export type MissingValueStrategyMap = Record<string, MissingValueStrategy>

export interface MissingValueReport {
  totalMissing: number
  byColumn: {
    [columnName: string]: {
      count: number
      percentage: number
      suggestedStrategy: MissingValueStrategy
    }
  }
  requiresAttention: boolean
}

export interface ParsedDataset {
  schema: DatasetSchema
  data: Row[]
  missingValueReport: MissingValueReport
}

export interface PDFSection {
  elementId: string
  title: string
}

export interface PDFGenerationOptions {
  title: string
  fileName: string
  sections: PDFSection[]
  includeTimestamp: boolean
}

export interface PDFGenerationResult {
  success: boolean
  fileName?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Python streaming profile (/api/stream-profile proxy → FastAPI /profile)
// ---------------------------------------------------------------------------

export interface ExecutionStage {
  name: string
  mode: "streaming" | "in_memory" | "hybrid"
  cacheable: boolean
  cost: "low" | "medium" | "high"
}

export interface ExecutionInfo {
  strategy: "streaming" | "in_memory" | "hybrid"
  rowCount?: number
  columnCount?: number
  chunkSize?: number
  fileSizeBytes?: number
  availableMemoryBytes?: number
  estimatedMemoryBytes?: number
  estimatedRuntimeSeconds?: number
  stages: ExecutionStage[]
  notes: string[]
}

export interface ProfileColumn {
  name: string
  type: "continuous" | "categorical" | "ordinal" | "datetime" | "binary"
  coded?: boolean | null
  codeNote?: string | null
  codeUncertain?: boolean | null
  count: number
  nullCount: number
  nullPercentage: number
  suggestedStrategy: string
  cardinality?: number
  cardinalityCapped?: boolean
  sampleValues?: unknown[]
  mean?: number
  median?: number
  mode?: unknown
  stdDev?: number
  variance?: number
  min?: number
  max?: number
  range?: number
  iqr?: number
  skewness?: number
  kurtosis?: number
  outlierCount?: number
  quantiles?: Record<string, number>
  histogram?: {
    bins: number[]
    counts: number[]
    n: number
    nbins: number
  }
  frequencyTable?: Record<string, number>
  frequencyCapped?: boolean
}

export interface ReproducibilityManifest {
  fileHash: string
  engineVersion: string
  strategy: string
  rowCount: number
  columnCount: number
  chunkSize: number
  passes: number
  elapsedSeconds: number
  options: Record<string, unknown>
}

export interface VerificationReport {
  passed: boolean
  engineVersion: string
  exactness: {
    column: string
    rowsChecked: number
    meanDelta: number
    varianceDelta: number
    meanExact: boolean
    varianceExact: boolean
    minExact: boolean
    maxExact: boolean
  }[]
  exactnessOk: boolean
  consistency: string[]
  consistencyOk: boolean
  determinism: boolean
  fullCrossCheck: {
    columnsChecked: number
    issues: string[]
    passed: boolean
    mode: string
  } | null
  notes: string[]
}

export interface StreamProfileResponse {
  success: boolean
  execution?: ExecutionInfo
  fileName: string
  rowCount: number
  columnCount: number
  columns: ProfileColumn[]
  sampleRows: Record<string, unknown>[]
  duplicateRowCount?: number | null
  duplicateCountCapped: boolean
  totalMissing: number
  correlations?: {
    columnA: string
    columnB: string
    r: number
    n: number
    method: string
  }[]
  manifest?: ReproducibilityManifest
  verification?: VerificationReport | null
  cacheHit?: boolean
  error?: string
}

export interface ProfileJobResponse {
  jobId: string
  kind: "profile" | "analyse"
  status: "queued" | "running" | "succeeded" | "failed"
  progress: number
  stage: string
  message?: string | null
  createdAt: number
  startedAt?: number | null
  finishedAt?: number | null
  result?: StreamProfileResponse | null
  error?: string | null
}

// ---------------------------------------------------------------------------
// Visualization Intelligence Engine (VIE) — deterministic chart dashboard
// ---------------------------------------------------------------------------

export interface ChartAlternative {
  chartType: string
  title: string
  confidence: number
  reason: string
}

export interface ChartRecommendation {
  chartType: string
  title: string
  intent: string
  confidence: number
  reason: string
  advantages: string[]
  limitations: string[]
  alternatives: ChartAlternative[]
}

export interface VerificationCheck {
  name: string
  ok: boolean
  message: string
}

export interface ChartVerification {
  passed: boolean
  checks: VerificationCheck[]
  notes: string[]
}

export interface DetectedPattern {
  name: string
  column?: string | null
  description: string
  signal?: number | null
}

export interface VizIntent {
  id: string
  label: string
  description: string
  confidence: number
  evidence: string[]
}

export interface ChartExplanation {
  whyThisChart: string
  whatItShows: string
  howToInterpret: string
  limitations: string
}

export interface VizChart {
  id: string
  section: string
  intent: string
  title: string
  chartType: string
  recommendation: ChartRecommendation
  spec: Record<string, unknown>
  verification: ChartVerification
  explanation?: ChartExplanation
}

export interface VizSection {
  id: string
  title: string
  description: string
  charts: VizChart[]
}

export interface VisualizationResponse {
  success: boolean
  engine: string
  fileName: string
  rowCount: number
  columnCount: number
  detectedPatterns: DetectedPattern[]
  intents: VizIntent[]
  sections: VizSection[]
  note?: string | null
  error?: string | null
}