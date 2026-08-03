import { NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { analyses, datasets } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { parseJson } from '@/db/table'
import { ok, fail } from '@/lib/api/helpers'

/**
 * Loads a stored analysis for restore, including its full result JSON from
 * object storage. Used by `/analyse?id=<analysisId>` to reconstruct a session.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const db = await getDb()
  const rows = await db
    .select()
    .from(analyses)
    .where(eq(analyses.id, params.id))
    .limit(1)

  if (rows.length === 0) return fail('Analysis not found', 404)
  const analysis = rows[0]

  const isOwner = analysis.ownerId === session.user.id
  const isMember = analysis.orgId !== null && Boolean(session.orgs.find((o) => o.id === analysis.orgId))
  if (!isOwner && !isMember) return fail('You do not have access to this analysis', 403)

  const datasetRows = analysis.datasetId
    ? await db.select().from(datasets).where(eq(datasets.id, analysis.datasetId)).limit(1)
    : []
  const dataset = datasetRows[0] ?? null

  let result: unknown = null
  try {
    const res = await fetch(analysis.storageUrl)
    if (res.ok) {
      result = await res.json()
    }
  } catch {
    // Stored result may be temporarily unreachable.
  }

  return ok({
    analysis: {
      id: analysis.id,
      name: analysis.name,
      createdAt: analysis.createdAt,
      summary: analysis.summary,
      providerUsed: analysis.providerUsed,
      modelType: analysis.modelType,
      rowCount: analysis.rowCount,
      schema: parseJson(analysis.schemaJson),
      result,
      dataset: dataset
        ? {
            id: dataset.id,
            name: dataset.name,
            fileName: dataset.fileName,
            rowCount: dataset.rowCount,
          }
        : null,
    },
  })
}
