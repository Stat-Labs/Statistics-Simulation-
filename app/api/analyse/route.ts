import { NextRequest, NextResponse } from 'next/server'
import { parseCSV, applyMissingValueStrategy } from '@/lib/stats/parser'
import { computeAllDescriptive } from '@/lib/stats/descriptive'
import { computeInferential } from '@/lib/stats/inferential'
import { runPredictive } from '@/lib/stats/predictive'
import { toErrorResponse } from '@/lib/utils/errors'
import { validateCSVFile, validateAnalysisRequest } from '@/lib/utils/validation'
import type {
  AnalyseRequestBody,
  AnalyseResponseBody,
  AnalysisResult,
  MissingValueStrategyMap,
  ChartSuggestion,
  Column,
} from '@/lib/types'

/**
 * POST /api/analyse
 *
 * Accepts a CSV file and analysis request. Parses the dataset,
 * handles missing values, runs all requested statistical
 * computations, and returns structured results.
 *
 * @body multipart/form-data
 *   file: CSV file (required)
 *   analyses: JSON string of AnalysisRequest (required)
 *   strategies: JSON string of MissingValueStrategyMap (optional)
 *     If omitted, missing values are handled automatically using
 *     suggested strategies per column type.
 *
 * @returns AnalyseResponseBody + missingValueReport + schema
 *
 * @example
 * const form = new FormData()
 * form.append('file', csvFile)
 * form.append('analyses', JSON.stringify(analysisRequest))
 * const res = await fetch('/api/analyse', { method: 'POST', body: form })
 * const { result, missingValueReport } = await res.json()
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    const fileEntry = formData.get('file')
    const file = fileEntry instanceof File ? fileEntry : null
    const fileError = validateCSVFile(file)
    if (fileError) {
      return Response.json({ success: false, error: fileError }, { status: 400 })
    }
    const csvFile: File = file as File

    const analysesRaw = formData.get('analyses')
    if (!analysesRaw || typeof analysesRaw !== 'string') {
      return Response.json({ success: false, error: 'Invalid analyses format' }, { status: 400 })
    }
    const analysesError = validateAnalysisRequest(analysesRaw)
    if (analysesError) {
      return Response.json({ success: false, error: analysesError }, { status: 400 })
    }
    const analyses: AnalyseRequestBody['analyses'] = JSON.parse(analysesRaw)

    let strategies: MissingValueStrategyMap | undefined
    try {
      const strategiesRaw = formData.get('strategies')
      if (strategiesRaw && typeof strategiesRaw === 'string') {
        strategies = JSON.parse(strategiesRaw)
      }
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid strategies format' } as AnalyseResponseBody,
        { status: 400 }
      )
    }

    const buffer = Buffer.from(await csvFile.arrayBuffer())
    const { schema, data, missingValueReport } = await parseCSV(buffer, csvFile.name)

    if (!strategies) {
      strategies = {}
      for (const [colName, colReport] of Object.entries(missingValueReport.byColumn)) {
        strategies[colName] = colReport.suggestedStrategy
      }
    }

    const cleanedData = applyMissingValueStrategy(data, schema.columns, strategies)

    const descriptive = analyses.descriptive
      ? computeAllDescriptive(cleanedData, schema.columns, analyses.descriptive.columns)
      : undefined

    const inferential = analyses.inferential
      ? computeInferential(cleanedData, schema.columns, analyses.inferential)
      : undefined

    const predictive = analyses.predictive
      ? runPredictive(cleanedData, schema.columns, analyses.predictive)
      : undefined

    const chartSuggestions = generateChartSuggestions(schema.columns, analyses, descriptive, inferential, predictive)

    return NextResponse.json({
      success: true,
      result: {
        descriptive,
        inferential,
        predictive,
        chartSuggestions,
      },
      missingValueReport,
      schema,
    })
  } catch (err) {
    return Response.json(toErrorResponse(err), { status: 500 })
  }
}

function generateChartSuggestions(
  columns: Column[],
  analyses: AnalyseRequestBody['analyses'],
  descriptive: AnalysisResult['descriptive'],
  inferential: AnalysisResult['inferential'],
  predictive: AnalysisResult['predictive'],
): ChartSuggestion[] {
  const suggestions: ChartSuggestion[] = []

  if (analyses.mode === 'manual') {
    if (analyses.descriptive) {
      const continuousCols = analyses.descriptive.columns.filter(colName => {
        const col = columns.find(c => c.name === colName)
        return col?.type === 'continuous'
      })
      for (const col of continuousCols) {
        suggestions.push({
          chartType: 'histogram',
          title: `Distribution of ${col}`,
          reason: 'Descriptive analysis of continuous variable',
          column: col,
        })
      }
    }

    if (analyses.inferential?.correlationPairs) {
      for (const [a, b] of analyses.inferential.correlationPairs) {
        suggestions.push({
          chartType: 'scatter',
          title: `${a} vs ${b}`,
          reason: 'Correlation analysis',
          x: a,
          y: b,
        })
      }
    }

    if (analyses.inferential?.regression) {
      const { dependent, predictors } = analyses.inferential.regression
      for (const p of predictors) {
        suggestions.push({
          chartType: 'scatter',
          title: `Regression: ${dependent} vs ${p}`,
          reason: 'Regression analysis with trendline',
          x: p,
          y: dependent,
        })
      }
    }

    if (analyses.predictive) {
      const { modelType } = analyses.predictive
      if (modelType === 'logistic' || (!modelType && predictive?.modelType === 'logistic')) {
        suggestions.push({
          chartType: 'confusion_matrix',
          title: 'Confusion Matrix',
          reason: 'Logistic regression classification results',
        })
      }
      if (modelType === 'timeseries') {
        suggestions.push({
          chartType: 'line',
          title: 'Time Series Forecast',
          reason: 'Time series regression with forecast',
          x: 'date',
          y: analyses.predictive.dependent,
        })
      }
    }
  }

  return suggestions
}
