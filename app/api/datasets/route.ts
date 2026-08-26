import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { getDb } from '@/db/client'
import { datasets } from '@/db/schema'
import { and, eq, isNull, desc } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { createDataset } from '@/lib/datasets/service'
import { ok, fail, isTrustedOrigin } from '@/lib/api/helpers'
import { validateCSVFile } from '@/lib/utils/validation'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const { searchParams } = request.nextUrl
  const scope = searchParams.get('scope') // 'personal' | 'org'
  const db = await getDb()

  const conditions = scope === 'org' && session.org
    ? [eq(datasets.ownerId, session.user.id), eq(datasets.orgId, session.org.id)]
    : [eq(datasets.ownerId, session.user.id), isNull(datasets.orgId)]

  const rows = await db
    .select({
      id: datasets.id,
      name: datasets.name,
      fileName: datasets.fileName,
      sizeBytes: datasets.sizeBytes,
      rowCount: datasets.rowCount,
      storageUrl: datasets.storageUrl,
      version: datasets.version,
      createdAt: datasets.createdAt,
    })
    .from(datasets)
    .where(and(...conditions))
    .orderBy(desc(datasets.createdAt))
    .limit(100)

  return ok({ datasets: rows })
}

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const formData = await request.formData()
  const fileEntry = formData.get('file')
  const file = fileEntry instanceof File ? fileEntry : null
  const fileError = validateCSVFile(file)
  if (fileError) return fail(fileError, 400)
  if (file && file.size > MAX_UPLOAD_BYTES) {
    return fail('File exceeds 50MB limit', 400)
  }
  if (!file) return fail('No file provided', 400)

  const name = (formData.get('name') as string)?.trim() || file.name
  const orgScope = formData.get('org') === 'true' && Boolean(session.org)

  const buffer = Buffer.from(await file.arrayBuffer())
  const sha256 = createHash('sha256').update(buffer).digest('hex')

  let rowCount: number | null = null
  let schema: unknown = null
  try {
    const schemaRaw = formData.get('schema') as string | null
    if (schemaRaw) {
      schema = JSON.parse(schemaRaw)
      const parsed = schema as { rowCount?: unknown }
      rowCount = typeof parsed?.rowCount === 'number' ? parsed.rowCount : null
    }
  } catch {
    // Non-fatal.
  }

  const created = await createDataset({
    ownerId: session.user.id,
    orgId: orgScope ? session.org!.id : null,
    name,
    fileName: file.name,
    buffer,
    mimeType: file.type || 'text/csv',
    sha256,
    rowCount,
    schema,
  })

  return ok({
    dataset: {
      id: created.id,
      name: created.name,
      fileName: created.fileName,
      rowCount: created.rowCount,
      sizeBytes: created.sizeBytes,
      version: created.version,
      storageUrl: created.storageUrl,
      deduplicated: created.deduplicated,
    },
  })
}
