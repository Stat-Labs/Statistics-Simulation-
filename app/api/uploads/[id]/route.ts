import { NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { uploads } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { getStorage } from '@/lib/storage'
import { ok, fail } from '@/lib/api/helpers'
import { safeParseChunks } from '@/lib/upload/shared'

/** GET /api/uploads/[id] — resume/status. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession(_request)
  if (!session) return fail('Not authenticated', 401)

  const db = await getDb()
  const rows = await db.select().from(uploads).where(eq(uploads.id, params.id)).limit(1)
  if (rows.length === 0) return fail('Upload not found', 404)
  const upload = rows[0]
  if (upload.ownerId !== session.user.id) return fail('You do not have access to this upload', 403)

  return ok({
    upload: {
      id: upload.id,
      fileName: upload.fileName,
      fileSizeBytes: upload.fileSizeBytes,
      chunkSize: upload.chunkSize,
      totalChunks: upload.totalChunks,
      receivedChunks: safeParseChunks(upload.receivedChunks),
      status: upload.status,
    },
  })
}

/** DELETE /api/uploads/[id] — cancel, remove partial chunks. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession(_request)
  if (!session) return fail('Not authenticated', 401)

  const db = await getDb()
  const rows = await db.select().from(uploads).where(eq(uploads.id, params.id)).limit(1)
  if (rows.length === 0) return fail('Upload not found', 404)
  const upload = rows[0]
  if (upload.ownerId !== session.user.id) return fail('You do not have access to this upload', 403)

  await db
    .update(uploads)
    .set({ status: 'cancelled', updatedAt: Date.now() })
    .where(eq(uploads.id, upload.id))

  // Best-effort chunk cleanup.
  void (async () => {
    try {
      const storage = getStorage()
      for (let i = 0; i < upload.totalChunks; i++) {
        await storage.delete(`chunks/${upload.id}/${i}`)
      }
      await db.delete(uploads).where(eq(uploads.id, upload.id))
    } catch {
      // Best-effort.
    }
  })()

  return ok({ cancelled: true })
}
