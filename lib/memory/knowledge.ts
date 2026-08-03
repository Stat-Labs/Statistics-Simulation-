import type { AnalysisResult, Column, DatasetSchema, ModelTrainingReport } from '@/lib/types'
import type { GlossaryEntry, KnowledgeFinding } from './types'

export interface InterpretPart {
  type?: string
  subject?: string
  interpretation?: string
}

export interface KnowledgeInputs {
  schema: DatasetSchema
  result: AnalysisResult
  interpret?: { summary?: string; perAnalysis?: InterpretPart[] } | null
  modelTrainingReport?: ModelTrainingReport | null
  relationshipSuggestions?: { dependent: string; predictors: string[]; modelType?: string; reason?: string }[]
}

function severityFromText(text: string): 'low' | 'medium' | 'high' {
  const lower = text.toLowerCase()
  if (/(risk|concern|danger|warning|decline|drop|loss|critical|severe|significant threat)/.test(lower)) {
    return 'high'
  }
  if (/(notable|opportunity|improve|watch|attention|moderate|gap|issue)/.test(lower)) {
    return 'medium'
  }
  return 'low'
}

function round(n: number | undefined, digits = 3): number | null {
  if (n === undefined || n === null || Number.isNaN(n)) return null
  return Number(n.toFixed(digits))
}

/**
 * Turns one analysed dataset + AI interpretation into structured, storable
 * knowledge (findings). Pure function — no I/O — so it is unit-testable and
 * runs identically wherever it is invoked.
 */
export function buildFindings(inputs: KnowledgeInputs): KnowledgeFinding[] {
  const findings: KnowledgeFinding[] = []
  const { schema, result, interpret, modelTrainingReport, relationshipSuggestions } = inputs

  // --- AI interpretation ---
  if (interpret?.summary && interpret.summary.trim()) {
    findings.push({
      category: 'insight',
      title: `Executive summary — ${schema.fileName}`,
      body: interpret.summary.trim(),
      confidence: 0.7,
      severity: severityFromText(interpret.summary),
    })
  }
  for (const part of interpret?.perAnalysis ?? []) {
    const text = part.interpretation ?? ''
    if (!text.trim()) continue
    findings.push({
      category: 'insight',
      title: `${part.subject ?? part.type ?? 'Finding'} — ${schema.fileName}`,
      body: text.trim(),
      confidence: 0.65,
      severity: severityFromText(text),
    })
  }

  // --- Correlations ---
  for (const c of result.inferential?.correlations ?? []) {
    const r = c.r
    if (Math.abs(r) >= 0.5) {
      findings.push({
        category: 'relationship',
        title: `${c.columnA} correlates with ${c.columnB} (${c.interpretation})`,
        body: `${c.interpretation} relationship with r = ${round(r)} (${c.method} method).`,
        confidence: Math.min(0.95, Math.abs(r) + 0.2),
        severity: Math.abs(r) >= 0.7 ? 'high' : 'medium',
        evidence: { columnA: c.columnA, columnB: c.columnB, r, method: c.method },
        kpiKey: c.columnB,
      })
    }
  }

  // --- Regression model ---
  const reg = result.inferential?.regression ?? result.predictive?.regressionResult
  if (reg) {
    const parts = [
      `${reg.modelType} regression on "${reg.dependent}"`,
      reg.rSquared !== undefined ? `explains ~${(reg.rSquared * 100).toFixed(1)}% of variance (R² = ${round(reg.rSquared)})` : '',
      reg.rmse !== undefined ? `RMSE ${round(reg.rmse)}` : '',
      reg.accuracy !== undefined ? `accuracy ${round(reg.accuracy)}` : '',
    ].filter(Boolean)
    findings.push({
      category: 'model',
      title: `Model — ${reg.dependent} (${reg.modelType})`,
      body: parts.join('. ') + '.',
      confidence: reg.rSquared !== undefined ? Math.min(0.9, 0.4 + reg.rSquared) : 0.6,
      severity: (reg.rSquared ?? 0) >= 0.6 ? 'medium' : 'low',
      evidence: { dependent: reg.dependent, predictors: reg.predictors, rSquared: reg.rSquared, rmse: reg.rmse },
      kpiKey: reg.dependent,
    })
  }

  // --- Hypothesis tests ---
  for (const h of result.inferential?.hypothesisTests ?? []) {
    if (h.significant) {
      findings.push({
        category: 'significance',
        title: `Statistically significant: ${h.columns.join(', ')} (${h.testType})`,
        body: `p = ${h.pValue.toExponential(2)}, ${h.testType} on ${h.columns.join(', ')}.`,
        confidence: 0.8,
        severity: 'medium',
        evidence: { testType: h.testType, pValue: h.pValue, statistic: h.statistic, columns: h.columns },
      })
    }
  }

  // --- Outliers (anomalies) ---
  for (const d of result.descriptive ?? []) {
    if ((d.outlierCount ?? 0) > 0) {
      findings.push({
        category: 'anomaly',
        title: `${d.outlierCount} outlier${d.outlierCount === 1 ? '' : 's'} in "${d.column}"`,
        body: `Column "${d.column}" contains ${d.outlierCount} outlier(s) that may skew averages and models.`,
        confidence: 0.7,
        severity: 'medium',
        evidence: { column: d.column, outlierCount: d.outlierCount, mean: d.mean, median: d.median },
        kpiKey: d.column,
      })
    }
  }

  // --- Forecast / time series trend ---
  const forecast = result.predictive?.forecast
  if (forecast && forecast.length >= 2) {
    const first = forecast[0].predicted
    const last = forecast[forecast.length - 1].predicted
    const delta = last - first
    const direction = delta > 0 ? 'upward' : delta < 0 ? 'downward' : 'flat'
    findings.push({
      category: 'trend',
      title: `Forecast points ${direction}`,
      body: `Predicted values move ${direction} across the forecast horizon (from ${first.toLocaleString()} to ${last.toLocaleString()}).`,
      confidence: 0.6,
      severity: Math.abs(delta) / (Math.abs(first) || 1) > 0.2 ? 'medium' : 'low',
      evidence: { first, last, delta },
      kpiKey: result.predictive?.regressionResult?.dependent ?? null,
    })
  }

  // --- Model training business insights ---
  for (const insight of modelTrainingReport?.businessTranslation?.insights ?? []) {
    findings.push({
      category: 'insight',
      title: `ML insight — ${insight.type ?? 'model'}`,
      body: insight.text ?? '',
      confidence: 0.75,
      severity: severityFromText(insight.text ?? ''),
    })
  }
  for (const rec of modelTrainingReport?.recommendations ?? []) {
    findings.push({
      category: 'recommendation',
      title: `Recommendation (${rec.priority}) — ${rec.category ?? 'action'}`,
      body: `${rec.action ?? ''}${rec.rationale ? ` (${rec.rationale})` : ''}`.trim(),
      confidence: 0.7,
      severity: rec.priority === 'high' ? 'high' : rec.priority === 'medium' ? 'medium' : 'low',
      evidence: { category: rec.category, priority: rec.priority },
    })
  }

  // --- Primary relationship suggested by the profiler ---
  for (const rel of relationshipSuggestions ?? []) {
    if (rel.dependent && rel.predictors?.length) {
      findings.push({
        category: 'relationship',
        title: `Primary relationship: ${rel.dependent} ~ ${rel.predictors.join(' + ')}`,
        body: rel.reason ?? `${rel.dependent} is modelled using ${rel.predictors.length} predictor(s).`,
        confidence: 0.6,
        severity: 'low',
        kpiKey: rel.dependent,
      })
    }
  }

  // Cap the number of stored findings so one dataset can't flood memory.
  return findings.slice(0, 60)
}

const IDENTIFIER_TOKENS = ['id', 'ident', 'identifier', 'code', 'key', 'uuid', 'no', 'number']
const MONEY_TOKENS = ['revenue', 'sales', 'amount', 'price', 'cost', 'profit', 'income', 'payment', 'fee', 'salary', 'budget', 'expense', 'spend']
const TIME_TOKENS = ['date', 'time', 'year', 'month', 'day', 'week', 'quarter', 'hour', 'datetime', 'timestamp', 'period']
const LABEL_TOKENS = ['name', 'label', 'title', 'desc', 'description', 'note', 'comment', 'text', 'category', 'type', 'status']

function nameTokens(name: string): string[] {
  return String(name)
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function definitionFor(col: Column): { definition: string; confidence: number } {
  const tokens = nameTokens(col.name)
  const typeLabel: Record<string, string> = {
    continuous: 'continuous numeric measurement',
    ordinal: 'ordered categorical value',
    categorical: 'categorical grouping',
    binary: 'binary indicator (0/1 or true/false)',
    datetime: 'point in time',
  }
  const hasTime = tokens.some((tok) => TIME_TOKENS.includes(tok))
  const hasId = tokens.some((tok) => IDENTIFIER_TOKENS.includes(tok) && tok !== 'number') || col.name.toLowerCase().endsWith('_id') || col.name.toLowerCase().endsWith('.id')
  const hasMoney = tokens.some((tok) => MONEY_TOKENS.includes(tok))
  const hasLabel = tokens.some((tok) => LABEL_TOKENS.includes(tok))

  if (hasTime && col.type === 'datetime') {
    return { definition: `Temporal value used as a time/period marker`, confidence: 0.7 }
  }
  if (hasTime && col.type !== 'datetime') {
    return { definition: `Likely a time-related period marker`, confidence: 0.55 }
  }
  if (hasId) {
    return { definition: `Unique identifier or code for a record/entity`, confidence: 0.7 }
  }
  if (hasMoney) {
    return { definition: `Monetary value (revenue/price/cost) — a key business metric`, confidence: 0.7 }
  }
  if (hasLabel) {
    return { definition: `Descriptive label or grouping value`, confidence: 0.55 }
  }
  return { definition: `${typeLabel[col.type] ?? 'dataset'} variable`, confidence: 0.5 }
}

/**
 * Auto-generates a business glossary from the dataset schema. Heuristic-based
 * so it works offline; definitions improve future analyses and feed retrieval.
 */
export function buildGlossary(schema: DatasetSchema): GlossaryEntry[] {
  const entries: GlossaryEntry[] = []
  const seen = new Set<string>()
  for (const col of schema.columns ?? []) {
    const term = col.name
    if (seen.has(term.toLowerCase())) continue
    seen.add(term.toLowerCase())
    const { definition, confidence } = definitionFor(col)
    entries.push({ term, definition, confidence, source: 'auto' })
  }
  return entries
}
