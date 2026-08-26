import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { getDb } from '@/db/client'
import { uploads } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { getStorage } from '@/lib/storage'
import { createDataset } from '@/lib/datasets/service'
import { ok, fail, isTrustedOrigin } from '@/lib/api/helpers'
import { safeParseChunks } from '@/lib/upload/shared'

/**
 * POST /api/uploads/[id]/complete
 *
 * Merges all stored chunks, verifies the full-file SHA-256, persists the
 * dataset via the shared dataset service, then cleans up chunk objects and the
 * upload row. Multipart: optional `schema` (JSON) for column/row metadata.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const db = await getDb()
  const rows = await db.select().from(uploads).where(eq(uploads.id, params.id)).limit(1)
  if (rows.length === 0) return fail('Upload not found', 404)
  const upload = rows[0]
  if (upload.ownerId !== session.user.id) return fail('You do not have access to this upload', 403)
  if (upload.status === 'completed') return fail('Upload already completed', 409)

  const received = safeParseChunks(upload.receivedChunks)
  const allPresent = received.length >= upload.totalChunks
  if (!allPresent) {
    return fail(
      `Cannot complete: ${received.length}/${upload.totalChunks} chunks received`,
      409,
    )
  }

  const storage = getStorage()

  // Merge chunks in order.
  const parts: Buffer[] = []
  for (let i = 0; i < upload.totalChunks; i++) {
    parts.push(await storage.read(`chunks/${upload.id}/${i}`))
  }
  const merged = Buffer.concat(parts)

  // Verify full-file checksum.
  const sha256 = createHash('sha256').update(merged).digest('hex')
  if (sha256 !== upload.fileSha256) {
    await db
      .update(uploads)
      .set({ status: 'failed', updatedAt: Date.now() })
      .where(eq(uploads.id, upload.id))
    return fail('Checksum mismatch — file was corrupted during upload', 400)
  }

  let rowCount: number | null = null
  let schema: unknown = null
  try {
    const formData = await request.formData()
    const schemaRaw = formData.get('schema') as string | null
    if (schemaRaw) {
      schema = JSON.parse(schemaRaw)
      const parsed = schema as { rowCount?: unknown }
      rowCount = typeof parsed?.rowCount === 'number' ? parsed.rowCount : null
    }
  } catch {
    // Non-fatal — row count remains null.
  }

  const created = await createDataset({
    ownerId: session.user.id,
    orgId: upload.orgId,
    name: upload.fileName.replace(/\.[^.]+$/, ''),
    fileName: upload.fileName,
    buffer: merged,
    mimeType: upload.fileType ?? 'text/csv',
    sha256,
    rowCount,
    schema,
  })

  await db
    .update(uploads)
    .set({ status: 'completed', completedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(uploads.id, upload.id))

  // Clean up chunk objects (best-effort, non-blocking).
  void (async () => {
    try {
      for (let i = 0; i < upload.totalChunks; i++) {
        await storage.delete(`chunks/${upload.id}/${i}`)
      }
      await db.delete(uploads).where(eq(uploads.id, upload.id))
    } catch {
      // Chunk cleanup must never fail the response.
    }
  })()

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
