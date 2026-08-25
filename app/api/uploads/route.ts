import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/db/client'
import { uploads } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { ok, fail, isTrustedOrigin, parseJsonBody, firstZodError } from '@/lib/api/helpers'
import { CHUNK_SIZE, MAX_UPLOAD_BYTES, safeParseChunks } from '@/lib/upload/shared'

const startSchema = z.object({
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 must be a 64-char hex digest'),
  fileType: z.string().max(100).optional(),
  chunkSize: z.number().int().positive().max(16 * 1024 * 1024).optional(),
})

/** POST /api/uploads — start a chunked upload session. */
export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const raw = await parseJsonBody(request)
  const parsed = startSchema.safeParse(raw)
  if (!parsed.success) return fail(firstZodError(parsed.error), 400)

  const { fileName, sizeBytes, sha256, fileType } = parsed.data
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return fail(`File exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit`, 400)
  }

  const chunkSize = parsed.data.chunkSize ?? CHUNK_SIZE
  const totalChunks = Math.max(1, Math.ceil(sizeBytes / chunkSize))
  const id = crypto.randomUUID()
  const now = Date.now()

  const db = await getDb()
  await db.insert(uploads).values({
    id,
    ownerId: session.user.id,
    orgId: session.org?.id ?? null,
    fileName,
    fileSizeBytes: sizeBytes,
    fileSha256: sha256,
    fileType: fileType ?? null,
    chunkSize,
    totalChunks,
    receivedChunks: '[]',
    status: 'uploading',
    createdAt: now,
    updatedAt: now,
  })

  return ok({ upload: { id, chunkSize, totalChunks, status: 'uploading' } })
}

/** GET /api/uploads — in-progress uploads (resume on refresh). */
export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const db = await getDb()
  const rows = await db
    .select()
    .from(uploads)
    .where(eq(uploads.ownerId, session.user.id))
    .orderBy(desc(uploads.createdAt))
    .limit(10)

  return ok({
    uploads: rows
      .filter((r) => r.status === 'uploading' || r.status === 'pending')
      .map((r) => ({
        id: r.id,
        fileName: r.fileName,
        fileSizeBytes: r.fileSizeBytes,
        chunkSize: r.chunkSize,
        totalChunks: r.totalChunks,
        receivedChunks: safeParseChunks(r.receivedChunks),
        status: r.status,
      })),
  })
}
