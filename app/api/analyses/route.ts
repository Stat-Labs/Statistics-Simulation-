import { NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { analyses, datasets } from '@/db/schema'
import { and, eq, isNull, desc } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { getStorage } from '@/lib/storage'
import { jsonify } from '@/db/table'
import { writeAuditLog } from '@/lib/db/services'
import { ok, fail, isTrustedOrigin } from '@/lib/api/helpers'

export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const { searchParams } = request.nextUrl
  const scope = searchParams.get('scope')
  const db = await getDb()

  const conditions = scope === 'org' && session.org
    ? [eq(analyses.ownerId, session.user.id), eq(analyses.orgId, session.org.id)]
    : [eq(analyses.ownerId, session.user.id), isNull(analyses.orgId)]

  const rows = await db
    .select({
      id: analyses.id,
      name: analyses.name,
      summary: analyses.summary,
      providerUsed: analyses.providerUsed,
      modelType: analyses.modelType,
      rowCount: analyses.rowCount,
      datasetId: analyses.datasetId,
      createdAt: analyses.createdAt,
      datasetName: datasets.name,
    })
    .from(analyses)
    .leftJoin(datasets, eq(datasets.id, analyses.datasetId))
    .where(and(...conditions))
    .orderBy(desc(analyses.createdAt))
    .limit(100)

  return ok({ analyses: rows })
}

/**
 * Persists a completed analysis to memory.
 *
 * Multipart form:
 *   datasetId  : string
 *   name       : string
 *   schema     : JSON string of DatasetSchema
 *   summary    : string (AI executive summary, optional)
 *   providerUsed, modelType, rowCount : optional strings/numbers
 *   result     : file part — the full AnalysisResult JSON (stored as an object)
 */
export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const formData = await request.formData()
  const datasetId = (formData.get('datasetId') as string) ?? ''
  const name = (formData.get('name') as string)?.trim() || 'Analysis'
  const schemaRaw = formData.get('schema') as string | null
  const summary = (formData.get('summary') as string)?.trim() || null
  const providerUsed = (formData.get('providerUsed') as string) || null
  const modelType = (formData.get('modelType') as string) || null
  const resultFile = formData.get('result')

  if (!datasetId) return fail('datasetId is required', 400)
  if (!resultFile || !(resultFile instanceof File)) return fail('result JSON is required', 400)

  const db = await getDb()

  // Dataset must belong to the user (or their org).
  const datasetRows = datasetId
    ? await db
        .select()
        .from(datasets)
        .where(eq(datasets.id, datasetId))
        .limit(1)
    : []
  if (datasetRows.length === 0) {
    return fail('Dataset not found', 404)
  }
  const dataset = datasetRows[0]
  const canUse = dataset.ownerId === session.user.id
  if (!canUse) return fail('You do not have access to this dataset', 403)

  let schemaObj: Record<string, unknown> | null = null
  if (schemaRaw) {
    try {
      schemaObj = JSON.parse(schemaRaw)
    } catch {
      // Non-fatal — schema is metadata.
    }
  }

  const analysisId = crypto.randomUUID()
  const now = Date.now()
  const rowCount = typeof schemaObj?.rowCount === 'number' ? schemaObj.rowCount : dataset.rowCount ?? null

  const stored = await getStorage().upload(Buffer.from(await resultFile.arrayBuffer()), {
    folder: `u/${session.user.id}`,
    publicId: `analyses/${analysisId}`,
    resourceType: 'raw',
    originalFilename: `${analysisId}.json`,
    contentType: 'application/json',
  })

  await db.insert(analyses).values({
    id: analysisId,
    projectId: dataset.projectId,
    datasetId: dataset.id,
    ownerId: session.user.id,
    orgId: dataset.orgId,
    name,
    status: 'saved',
    storageProvider: stored.provider,
    storageKey: stored.key,
    storageUrl: stored.url,
    schemaJson: jsonify(schemaObj),
    summary,
    providerUsed,
    modelType,
    rowCount,
    createdAt: now,
  })

  await writeAuditLog({
    orgId: dataset.orgId,
    userId: session.user.id,
    action: 'analysis.saved',
    resourceType: 'analysis',
    resourceId: analysisId,
    meta: { datasetId, name },
    ip: request.headers.get('x-forwarded-for'),
  })

  return ok({
    analysis: {
      id: analysisId,
      name,
      rowCount,
      createdAt: now,
    },
  })
}
