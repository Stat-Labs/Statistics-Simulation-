import { getDb } from '@/db/client'
import { datasets } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getStorage } from '@/lib/storage'
import { ensureDefaultProject, writeAuditLog } from '@/lib/db/services'
import type { StorageProvider } from '@/lib/storage/types'

export interface CreateDatasetInput {
  ownerId: string
  orgId: string | null
  name: string
  fileName: string
  buffer: Buffer
  mimeType?: string
  sha256: string
  rowCount?: number | null
  schema?: unknown | null
}

export interface CreatedDataset {
  id: string
  name: string
  fileName: string
  rowCount: number | null
  sizeBytes: number
  version: number
  storageUrl: string
  deduplicated: boolean
}

/**
 * Single place that turns a raw file (from a one-shot upload OR a merged
 * chunked upload) into a persisted dataset row + object storage entry.
 * Dedupes identical content per owner via SHA-256.
 */
export async function createDataset(input: CreateDatasetInput): Promise<CreatedDataset> {
  const db = await getDb()
  const now = Date.now()

  // Deduplicate identical content per owner.
  const existing = await db
    .select()
    .from(datasets)
    .where(and(eq(datasets.ownerId, input.ownerId), eq(datasets.sha256, input.sha256)))
    .limit(1)
  if (existing.length > 0) {
    return {
      id: existing[0].id,
      name: existing[0].name,
      fileName: existing[0].fileName,
      rowCount: existing[0].rowCount,
      sizeBytes: existing[0].sizeBytes,
      version: existing[0].version,
      storageUrl: existing[0].storageUrl,
      deduplicated: true,
    }
  }

  const projectId = await ensureDefaultProject(input.ownerId, input.orgId)
  const datasetId = crypto.randomUUID()

  const stored = await getStorage().upload(input.buffer, {
    folder: `u/${input.ownerId}`,
    publicId: `datasets/${datasetId}`,
    resourceType: 'raw',
    originalFilename: input.fileName,
    contentType: input.mimeType || 'text/csv',
  })

  await db.insert(datasets).values({
    id: datasetId,
    projectId,
    ownerId: input.ownerId,
    orgId: input.orgId,
    name: input.name,
    fileName: input.fileName,
    sizeBytes: input.buffer.byteLength,
    mimeType: input.mimeType || null,
    storageProvider: stored.provider as StorageProvider,
    storageKey: stored.key,
    storageUrl: stored.url,
    rowCount: input.rowCount ?? null,
    columnCount: null,
    schemaJson: input.schema ? JSON.stringify(input.schema) : null,
    sha256: input.sha256,
    version: 1,
    processingStatus: 'stored',
    analysisStatus: 'none',
    lastAccessedAt: now,
    createdAt: now,
  })

  await writeAuditLog({
    orgId: input.orgId,
    userId: input.ownerId,
    action: 'dataset.uploaded',
    resourceType: 'dataset',
    resourceId: datasetId,
    meta: { name: input.name, bytes: input.buffer.byteLength },
  })

  return {
    id: datasetId,
    name: input.name,
    fileName: input.fileName,
    rowCount: input.rowCount ?? null,
    sizeBytes: input.buffer.byteLength,
    version: 1,
    storageUrl: stored.url,
    deduplicated: false,
  }
}

/**
 * Free-tier retention: after a dataset has been analysed and its knowledge
 * extracted, the raw file can be removed while metadata + knowledge remain.
 * Controlled by `RETAIN_RAW_DATASETS` (default: false → delete).
 */
export async function deleteRawDataset(datasetId: string, ownerId: string): Promise<boolean> {
  try {
    const db = await getDb()
    const rows = await db
      .select()
      .from(datasets)
      .where(and(eq(datasets.id, datasetId), eq(datasets.ownerId, ownerId)))
      .limit(1)
    if (rows.length === 0 || rows[0].rawDeletedAt) return false
    const ds = rows[0]
    await getStorage().delete(ds.storageKey)
    await db
      .update(datasets)
      .set({ rawDeletedAt: Date.now(), processingStatus: 'archived' })
      .where(eq(datasets.id, datasetId))
    return true
  } catch {
    return false
  }
}
