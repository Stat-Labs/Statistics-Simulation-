export type FindingCategory =
  | 'insight'
  | 'relationship'
  | 'anomaly'
  | 'risk'
  | 'recommendation'
  | 'trend'
  | 'significance'
  | 'model'

export type Severity = 'low' | 'medium' | 'high'

export interface KnowledgeFinding {
  category: FindingCategory
  title: string
  body: string
  confidence: number
  severity: Severity
  evidence?: Record<string, unknown> | null
  impact?: string | null
  financialImpact?: string | null
  kpiKey?: string | null
}

export interface GlossaryEntry {
  term: string
  definition: string
  confidence: number
  source: 'auto' | 'ai' | 'user'
}

export interface KpiPoint {
  name: string
  metricKey: string
  valueText: string
  valueNumber: number | null
  unit?: string | null
  periodKey?: string | null
  displayLabel?: string | null
}

/** Everything the knowledge extractor produces for one analysed dataset. */
export interface KnowledgeExtract {
  findings: KnowledgeFinding[]
  glossary: GlossaryEntry[]
  kpis: KpiPoint[]
}

/** RAG retrieval result — the assembled context for future conversations. */
export interface RetrievedContext {
  findings: {
    id: string
    title: string
    body: string
    category: string
    severity: string
    score: number
    createdAt: number
  }[]
  glossary: { term: string; definition: string }[]
  kpis: KpiPoint[]
  datasets: { id: string; name: string; rowCount: number | null; createdAt: number }[]
}
