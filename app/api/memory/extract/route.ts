import { NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { analyses, datasets } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { getStorage } from '@/lib/storage'
import { deleteRawDataset } from '@/lib/datasets/service'
import { storeKnowledge, type Scope } from '@/lib/memory/store'
import { buildFindings, buildGlossary } from '@/lib/memory/knowledge'
import { parseJson } from '@/db/table'
import { ok, fail, isTrustedOrigin, parseJsonBody } from '@/lib/api/helpers'
import { config } from '@/lib/config'
import type { KpiPoint, KnowledgeFinding } from '@/lib/memory/types'
import type { AnalysisResult, DatasetSchema, ModelTrainingReport } from '@/lib/types'

interface StoredAnalysisPayload {
  result?: AnalysisResult
  interpret?: { summary?: string; perAnalysis?: { type?: string; subject?: string; interpretation?: string }[] }
  relationshipSuggestions?: { dependent: string; predictors: string[]; modelType?: string; reason?: string }[]
  modelTrainingReport?: unknown
}

/**
 * POST /api/memory/extract
 *
 * Runs knowledge extraction on a stored analysis and persists findings,
 * glossary, KPIs + embeddings to the workspace knowledge base. This is the step
 * that makes StatLab learn from every analysis. Optional body: { kpis: KpiPoint[] }.
 */
export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const raw = await parseJsonBody(request)
  const analysisId = (raw as { analysisId?: string })?.analysisId
  if (!analysisId) return fail('analysisId is required', 400)

  const db = await getDb()
  const rows = await db.select().from(analyses).where(eq(analyses.id, analysisId)).limit(1)
  if (rows.length === 0) return fail('Analysis not found', 404)
  const analysis = rows[0]

  const isOwner = analysis.ownerId === session.user.id
  const isMember = analysis.orgId !== null && Boolean(session.orgs.find((o) => o.id === analysis.orgId))
  if (!isOwner && !isMember) return fail('You do not have access to this analysis', 403)

  const scope: Scope = { ownerId: analysis.ownerId, orgId: analysis.orgId ?? null }

  // Load the full result payload from object storage. Prefer the storage
  // adapter (works for any provider incl. the local dev one); fall back to the
  // stored URL for legacy rows.
  let payload: StoredAnalysisPayload = {}
  try {
    if (analysis.storageKey) {
      const buffer = await getStorage().read(analysis.storageKey)
      payload = JSON.parse(buffer.toString('utf8')) as StoredAnalysisPayload
    }
  } catch {
    try {
      const res = await fetch(analysis.storageUrl)
      if (res.ok) payload = (await res.json()) as StoredAnalysisPayload
    } catch {
      // Extraction proceeds with whatever is available.
    }
  }

  const schema = parseJson<DatasetSchema>(analysis.schemaJson)
  const result = payload.result ?? { chartSuggestions: [] }

  const findings = buildFindings({
    schema: schema ?? { fileName: analysis.name, rowCount: 0, columnCount: 0, columns: [], sampleRows: [] },
    result,
    interpret: payload.interpret ?? null,
    modelTrainingReport: (payload.modelTrainingReport ?? null) as ModelTrainingReport | null,
    relationshipSuggestions: payload.relationshipSuggestions ?? [],
  })
  const glossary = schema ? buildGlossary(schema) : []

  const kpis = (raw as { kpis?: KpiPoint[] })?.kpis ?? deriveKpis(findings, result)

  const summaryText = payload.interpret?.summary ?? analysis.summary ?? ''

  const ctx = { userId: session.user.id, orgId: analysis.orgId ?? null }
  const counts = await storeKnowledge(scope, {
    datasetId: analysis.datasetId ?? null,
    analysisId: analysis.id,
    extract: { findings, glossary, kpis },
    summaryText,
    ctx,
  })

  // Mark analysis status + dataset status.
  if (analysis.datasetId) {
    await db
      .update(datasets)
      .set({ analysisStatus: 'extracted' })
      .where(eq(datasets.id, analysis.datasetId))
  }

  // Free-tier retention: delete the raw dataset once knowledge is extracted.
  let retainedRaw = true
  if (!config.retention.retainRawDatasets && analysis.datasetId) {
    retainedRaw = !(await deleteRawDataset(analysis.datasetId, analysis.ownerId))
  }

  return ok({
    extracted: counts,
    retainedRaw,
    memory: {
      findings: findings.length,
      glossary: glossary.length,
      kpis: kpis.length,
    },
  })
}

/** If the client didn't provide KPI series, derive simple per-column stats. */
function deriveKpis(findings: KnowledgeFinding[], result: AnalysisResult): KpiPoint[] {
  const kpis: KpiPoint[] = []
  for (const d of result.descriptive ?? []) {
    if (d.column && d.mean !== undefined) {
      kpis.push({
        name: d.column,
        metricKey: d.column,
        valueText: formatNumber(d.mean),
        valueNumber: d.mean,
        unit: null,
        periodKey: null,
        displayLabel: `Mean ${d.column}`,
      })
    }
  }
  return kpis.slice(0, 12)
}

function formatNumber(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'
}
