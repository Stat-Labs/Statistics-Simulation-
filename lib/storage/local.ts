import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { config } from '@/lib/config'
import type { StorageAdapter, StoredFile, UploadOptions } from './types'

const SCHEME = 'local://'

function resolveKey(key: string): string {
  // Keys are namespaced paths like `u/{userId}/datasets/{id}` or `chunks/{uploadId}/{i}`.
  return path.join(config.storage.localDir, ...key.split('/'))
}

function toKey(folder: string, publicId: string): string {
  return `${folder.replace(/^\/+|\/+$/g, '')}/${publicId}`
}

/**
 * Local-filesystem adapter — the zero-config dev story.
 *
 * Enables the full chunked upload + memory pipeline without Cloudinary/S3
 * credentials: `STORAGE_PROVIDER=local`. It implements the exact
 * `StorageAdapter` contract, so swapping to Cloudinary (or S3) in production is
 * purely an environment change.
 */
export const localAdapter: StorageAdapter = {
  provider: 'local' as const,

  isConfigured() {
    return true
  },

  async upload(buffer: Buffer, options: UploadOptions): Promise<StoredFile> {
    const folder = String(options.folder).replace(/^\/+|\/+$/g, '')
    const publicId = options.publicId ?? crypto.randomUUID()
    const key = toKey(folder, publicId)
    const filePath = resolveKey(key)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, buffer)
    return {
      key,
      url: `${SCHEME}${key}`,
      bytes: buffer.byteLength,
      provider: 'local',
    }
  },

  async getUrl(key: string): Promise<string> {
    return `${SCHEME}${key}`
  },

  async read(key: string): Promise<Buffer> {
    try {
      return await readFile(resolveKey(key))
    } catch {
      throw new Error(`Failed to read local object: ${key}`)
    }
  },

  async delete(key: string): Promise<void> {
    try {
      await unlink(resolveKey(key))
    } catch {
      // Best-effort — a missing file is already deleted.
    }
  },
}
