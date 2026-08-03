import { describe, it, expect } from 'vitest'
import type { StorageAdapter, UploadOptions, StoredFile } from '@/lib/storage/types'

/**
 * In-memory adapter that implements the exact `StorageAdapter` contract.
 * Used to verify the interface semantics the whole app depends on, without
 * requiring Cloudinary credentials. A real provider (e.g. S3) must satisfy the
 * same behaviour to be a drop-in replacement.
 */
class MemoryAdapter implements StorageAdapter {
  readonly provider = 'cloudinary' as const
  private blobs = new Map<string, Buffer>()

  isConfigured(): boolean {
    return true
  }

  async upload(buffer: Buffer, options: UploadOptions): Promise<StoredFile> {
    const folder = String(options.folder).replace(/^\/+|\/+$/g, '')
    const publicId = options.publicId ?? crypto.randomUUID()
    const key = options.publicId ? `${folder}/${publicId}` : `${folder}/${publicId}`
    this.blobs.set(key, buffer)
    return {
      key,
      url: `https://mem/${key}`,
      bytes: buffer.byteLength,
      provider: 'cloudinary',
    }
  }

  async getUrl(key: string): Promise<string> {
    if (!this.blobs.has(key)) throw new Error('not found')
    return `https://mem/${key}`
  }

  async read(key: string): Promise<Buffer> {
    const buf = this.blobs.get(key)
    if (!buf) throw new Error('not found')
    return buf
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key)
  }
}

describe('storage adapter contract', () => {
  const adapter = new MemoryAdapter()

  it('upload returns a resolvable stored file', async () => {
    const stored = await adapter.upload(Buffer.from('a,b\n1,2\n'), {
      folder: 'u/test-user',
      publicId: 'datasets/abc',
      resourceType: 'raw',
    })
    expect(stored.key).toBe('u/test-user/datasets/abc')
    expect(stored.bytes).toBe(8)
    expect(adapter.isConfigured()).toBe(true)
    await expect(adapter.getUrl(stored.key)).resolves.toBe(stored.url)
  })

  it('delete removes the object', async () => {
    const stored = await adapter.upload(Buffer.from('x'), { folder: 'u/user', publicId: 'drop' })
    await adapter.delete(stored.key)
    await expect(adapter.getUrl(stored.key)).rejects.toThrow()
  })

  it('trims surrounding slashes from the folder namespace', async () => {
    const stored = await adapter.upload(Buffer.from('y'), {
      folder: '/u/user/',
      publicId: 'f',
    })
    expect(stored.key).toMatch(/^u\/user\//)
  })
})
