import { config } from '@/lib/config'
import type { StorageAdapter, StorageProvider, StoredFile, UploadOptions } from './types'

interface CloudinaryUploadResult {
  public_id: string
  secure_url?: string
  url?: string
}

interface CloudinaryV2 {
  config: (opts: Record<string, unknown>) => void
  url: (id: string, opts?: Record<string, unknown>) => string
  uploader: {
    upload_stream: (
      opts: Record<string, unknown>,
      cb: (error: unknown, result?: CloudinaryUploadResult) => void,
    ) => NodeJS.WritableStream
    destroy: (
      id: string,
      opts: Record<string, unknown>,
      cb: (error: unknown) => void,
    ) => void
  }
}

let cachedCloudinary: CloudinaryV2 | null = null

async function getV2(): Promise<CloudinaryV2> {
  if (!cachedCloudinary) {
    const mod = await import('cloudinary')
    cachedCloudinary = mod.v2 as CloudinaryV2
    cachedCloudinary.config({
      cloud_name: config.storage.cloudinaryCloudName,
      api_key: config.storage.cloudinaryApiKey,
      api_secret: config.storage.cloudinaryApiSecret,
      secure: true,
    })
  }
  return cachedCloudinary
}

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    config.storage.cloudinaryCloudName &&
      config.storage.cloudinaryApiKey &&
      config.storage.cloudinaryApiSecret,
  )
}

/**
 * Cloudinary adapter.
 *
 * All artifacts are stored under a namespaced folder (per user / org / dataset),
 * as `raw` resources so CSV/Excel/JSON round-trip byte-for-byte.
 *
 * Switching to S3 later = implement the same `StorageAdapter` contract and set
 * `STORAGE_PROVIDER=s3` — no call-site changes.
 */
export const cloudinaryAdapter: StorageAdapter = {
  provider: 'cloudinary' as StorageProvider,

  isConfigured() {
    return isCloudinaryConfigured()
  },

  async upload(buffer, options: UploadOptions): Promise<StoredFile> {
    if (!isCloudinaryConfigured()) {
      throw new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET.')
    }
    const cloudinary = await getV2()

    const folder = String(options.folder).replace(/^\/+|\/+$/g, '')
    const publicId = options.publicId
      ? `${folder}/${options.publicId}`
      : `${folder}/${crypto.randomUUID()}`

    const uploaded = await new Promise<CloudinaryUploadResult>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: options.resourceType ?? 'raw',
          folder: '',
          use_filename: false,
          unique_filename: false,
          overwrite: false,
          ...(options.contentType ? { resource_type: options.resourceType ?? 'raw' } : {}),
        },
        (error, result) => (error ? reject(error) : resolve(result!)),
      )
      stream.end(buffer)
    })

    return {
      key: uploaded.public_id,
      url: uploaded.secure_url ?? uploaded.url ?? '',
      bytes: buffer.byteLength,
      provider: 'cloudinary',
    }
  },

  async getUrl(key: string): Promise<string> {
    if (!key) return ''
    // Cloudinary URLs are deterministic from the public id (secure, auto format
    // for raw keeps original extension). If the app already stored a URL we
    // prefer it, but the public_id is always enough to rebuild one.
    const cloudinary = await getV2()
    return cloudinary.url(key, { secure: true, sign_url: false })
  },

  async read(key: string): Promise<Buffer> {
    if (!key) throw new Error('Missing storage key')
    const url = await this.getUrl(key)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to read stored object (${res.status})`)
    return Buffer.from(await res.arrayBuffer())
  },

  async delete(key: string): Promise<void> {
    if (!key || !isCloudinaryConfigured()) return
    const cloudinary = await getV2()
    await new Promise<void>((resolve) => {
      cloudinary.uploader.destroy(key, { resource_type: 'raw' }, () => resolve())
    })
  },
}
