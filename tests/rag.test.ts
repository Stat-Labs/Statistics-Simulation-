import { describe, it, expect } from 'vitest'
import {
  buildMemoryQuery,
  buildRagSystemPrompt,
  buildRagUserPrompt,
  hasRetrievedContext,
  parseRagAnswer,
} from '@/lib/ai/rag'
import { buildMemoryContextSection } from '@/lib/ai/interpreterPrompt'
import type { DatasetSchema, AnalysisResult } from '@/lib/types'
import type { RetrievedContext } from '@/lib/memory/types'

const schema: DatasetSchema = {
  fileName: 'sales.csv',
  rowCount: 1200,
  columnCount: 2,
  columns: [
    { name: 'revenue', type: 'continuous', uniqueValues: [], sampleValues: [] },
    { name: 'region', type: 'categorical', uniqueValues: [], sampleValues: [] },
  ],
  sampleRows: [],
}

const result: AnalysisResult = {
  chartSuggestions: [],
  predictive: {
    modelType: 'multiple',
    regressionResult: {
      modelType: 'multiple',
      dependent: 'revenue',
      predictors: ['region'],
      coefficients: [1],
      intercept: 0,
      rSquared: 0.72,
      predictions: [1, 2],
    },
  },
}

const context: RetrievedContext = {
  findings: [
    {
      id: 'f1',
      title: 'Revenue correlates with region (strong positive)',
      body: 'Region explains most revenue variance.',
      category: 'relationship',
      severity: 'medium',
      score: 0.91,
      createdAt: 1,
    },
  ],
  glossary: [{ term: 'revenue', definition: 'Monetary value earned' }],
  kpis: [
    {
      name: 'revenue',
      metricKey: 'revenue',
      valueText: '42,000',
      valueNumber: 42000,
      unit: 'amount',
      displayLabel: 'Mean revenue',
    },
  ],
  datasets: [{ id: 'd1', name: 'sales.csv', rowCount: 1200, createdAt: 1 }],
}

describe('RAG orchestrator (retrieval-before-answer)', () => {
  it('builds a retrieval query from the schema + model target', () => {
    const q = buildMemoryQuery(schema, result)
    expect(q).toContain('sales.csv')
    expect(q).toContain('revenue')
    expect(q).toContain('region')
    expect(q).toContain('multiple model')
    expect(q).toContain('target: revenue')
  })

  it('builds a query without model details when none exist', () => {
    const q = buildMemoryQuery(schema, { chartSuggestions: [] })
    expect(q).toContain('sales.csv')
    expect(q).not.toContain('model')
  })

  it('detects whether retrieval produced any context', () => {
    const empty: RetrievedContext = { findings: [], glossary: [], kpis: [], datasets: [] }
    expect(hasRetrievedContext(empty)).toBe(false)
    expect(hasRetrievedContext(context)).toBe(true)
  })

  it('renders an empty memory section for no retrieved knowledge', () => {
    const empty: RetrievedContext = { findings: [], glossary: [], kpis: [], datasets: [] }
    expect(buildMemoryContextSection(empty)).toBe('')
  })

  it('formats findings, KPIs and glossary into the memory section', () => {
    const section = buildMemoryContextSection(context)
    expect(section).toContain('WORKSPACE MEMORY')
    expect(section).toContain('Revenue correlates with region')
    expect(section).toContain('Mean revenue = 42,000')
    expect(section).toContain('revenue: Monetary value earned')
  })

  it('builds a grounded-answering system prompt', () => {
    const prompt = buildRagSystemPrompt()
    expect(prompt).toContain('NEVER fabricate')
    expect(prompt).toContain('grounded')
    expect(prompt).toContain('valid JSON')
  })

  it('renders the user prompt with retrieved knowledge + question', () => {
    const prompt = buildRagUserPrompt('What drives revenue?', context)
    expect(prompt).toContain('What drives revenue?')
    expect(prompt).toContain('Revenue correlates with region')
    expect(prompt).toContain('Mean revenue = 42,000')
    expect(prompt).toContain('sales.csv (1,200 rows)')
  })

  it('renders "(no retrieved knowledge)" for an empty context', () => {
    const empty: RetrievedContext = { findings: [], glossary: [], kpis: [], datasets: [] }
    expect(buildRagUserPrompt('anything', empty)).toContain('(no retrieved knowledge)')
  })

  it('parses a valid grounded answer', () => {
    const raw = JSON.stringify({
      answer: 'Region drives revenue (r≈0.9).',
      grounded: true,
      sources: [{ title: 'Revenue correlates with region', kind: 'finding' }],
    })
    const parsed = parseRagAnswer(raw)
    expect(parsed.answer).toBe('Region drives revenue (r≈0.9).')
    expect(parsed.grounded).toBe(true)
    expect(parsed.sources).toHaveLength(1)
    expect(parsed.sources[0].kind).toBe('finding')
  })

  it('strips code fences before parsing', () => {
    const raw = '```json\n{"answer":"ok","grounded":false,"sources":[]}\n```'
    const parsed = parseRagAnswer(raw)
    expect(parsed.answer).toBe('ok')
    expect(parsed.grounded).toBe(false)
  })

  it('returns an empty result for unparseable output', () => {
    const parsed = parseRagAnswer('not json at all')
    expect(parsed.answer).toBe('')
    expect(parsed.grounded).toBe(false)
    expect(parsed.sources).toEqual([])
  })

  it('filters out invalid source kinds', () => {
    const raw = JSON.stringify({
      answer: 'a',
      grounded: true,
      sources: [
        { title: 'ok', kind: 'finding' },
        { title: 'bad', kind: 'recipe' },
        'not-an-object',
      ],
    })
    const parsed = parseRagAnswer(raw)
    expect(parsed.sources).toHaveLength(1)
    expect(parsed.sources[0].title).toBe('ok')
  })
})
