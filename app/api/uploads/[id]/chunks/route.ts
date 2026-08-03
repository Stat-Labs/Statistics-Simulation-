import { NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { uploads } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { getStorage } from '@/lib/storage'
import { ok, fail, isTrustedOrigin } from '@/lib/api/helpers'
import { safeParseChunks } from '@/lib/upload/shared'

/**
 * POST /api/uploads/[id]/chunks
 *
 * Stores one 2 MB chunk under object storage. Each request is idempotent: a
 * chunk already received is skipped, so retries only re-upload the failed ones.
 *
 * Multipart: index (0-based), data (binary part)
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
  if (upload.status !== 'uploading' && upload.status !== 'pending') {
    return fail('Upload is no longer accepting chunks', 409)
  }

  const formData = await request.formData()
  const indexRaw = formData.get('index')
  const data = formData.get('data')
  if (!(data instanceof File)) return fail('Chunk data is required', 400)
  const index = Number(indexRaw)
  if (!Number.isInteger(index) || index < 0 || index >= upload.totalChunks) {
    return fail('Invalid chunk index', 400)
  }

  const received = safeParseChunks(upload.receivedChunks)
  if (received.includes(index)) {
    return ok({ chunk: index, received: received.length, skipped: true })
  }

  // Chunk size guard: every chunk must be <= chunkSize (only the last may be smaller).
  if (data.size > upload.chunkSize) return fail('Chunk exceeds chunk size limit', 413)
  const expectedLast = upload.fileSizeBytes - upload.chunkSize * (upload.totalChunks - 1)
  const expectedSize = index === upload.totalChunks - 1 ? expectedLast : upload.chunkSize
  if (data.size !== expectedSize) {
    return fail(`Chunk ${index} has size ${data.size}, expected ${expectedSize}`, 400)
  }

  const buffer = Buffer.from(await data.arrayBuffer())
  await getStorage().upload(buffer, {
    folder: `chunks/${upload.id}`,
    publicId: String(index),
    resourceType: 'raw',
    originalFilename: `chunk-${index}`,
  })

  const next = [...received, index].sort((a, b) => a - b)
  const status = next.length >= upload.totalChunks ? 'complete_pending' : 'uploading'
  await db
    .update(uploads)
    .set({ receivedChunks: JSON.stringify(next), status, updatedAt: Date.now() })
    .where(eq(uploads.id, upload.id))

  return ok({ chunk: index, received: next.length, total: upload.totalChunks, status })
}
