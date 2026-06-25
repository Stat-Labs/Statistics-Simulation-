# StatLab TypeScript Types

> All types are defined in lib/types.ts.
> Import in any file with: import type { TypeName } from '@/lib/types'
> Never redefine these types locally anywhere in the project.

## Column & Dataset

- `Column` — name, type (continuous | categorical | ordinal | datetime | binary), uniqueValues, min, max, sampleValues, nullCount
- `DatasetSchema` — fileName, rowCount, columnCount, columns, sampleRows
- `Row` — Record<string, string | number | null>

## Analysis Request

- `AnalysisRequest` — mode (smart | manual), descriptive, inferential, predictive

## Model Types

- `ModelType` — linear | polynomial | logistic | multiple | timeseries | randomforest

## Results

- `DescriptiveResult` — column, mean, median, mode, stdDev, variance, min, max, range, iqr, skewness, kurtosis, count, nullCount, frequencyTable, note
- `CorrelationResult` — columnA, columnB, r, method (pearson | spearman), interpretation
- `RegressionResult` — modelType, dependent, predictors, coefficients, intercept, rSquared, adjustedRSquared, mse, rmse, accuracy, predictions, residuals, featureImportance, note
  - forecast field only populated for timeseries model
  - featureImportance only populated for randomforest model
  - accuracy only populated for logistic model
  - rSquared omitted for logistic model
- `HypothesisResult` — testType (t-test | chi-square | anova), statistic, pValue, significant, confidenceLevel, columns
- `InferentialResult` — correlations, hypothesisTests, regression
- `PredictiveResult` — modelType, regressionResult, forecast
- `AnalysisResult` — descriptive, inferential, predictive, chartSuggestions

## Charts

- `ChartType` — scatter | line | bar | histogram | heatmap | boxplot | pie | confusion_matrix | roc_curve
- `ChartSuggestion` — chartType, title, reason, x, y, column, series

## API Request / Response Bodies

- `AnalyseRequestBody` — schema, data, analyses
- `AnalyseResponseBody` — success, result, error
- `ProfileRequestBody` — schema
- `ProfileResponseBody` — success, output, error
- `InterpretRequestBody` — schema, result
- `InterpretResponseBody` — success, summary, perAnalysis, error

## AI Provider

- `AIProvider` — groq | mistral | gemini | deepseek | huggingface
- `AIResponse` — content, provider, fallbackUsed

## AI Profiler Output

- `ProfilerOutput` — analysisMap (modelType, dependentVariable, predictors, correlationPairs, hypothesisTests, descriptiveColumns), chartSuggestions

## Missing Value Handling

- `MissingValueStrategy` — Strategy to apply for filling or removing missing data. Options:
  - `"mean"` — replace with column mean (continuous only)
  - `"median"` — replace with column median
  - `"mode"` — replace with most frequent value
  - `"drop_rows"` — remove any row with a missing value in this column
  - `"drop_column"` — remove the entire column from all rows
  - `"zero"` — replace missing with 0
  - `"forward_fill"` — replace with previous row's value
  - `"backward_fill"` — replace with next row's value
- `MissingValueStrategyMap` — `Record<string, MissingValueStrategy>` mapping column names to strategies
- `MissingValueReport` — totalMissing, byColumn (count, percentage, suggestedStrategy), requiresAttention
- `ParsedDataset` — schema, data, missingValueReport