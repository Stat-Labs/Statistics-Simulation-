/**
 * Storage abstraction layer.
 *
 * StatLab never talks to a storage vendor directly — it always goes through
 * this interface. Cloudinary is the current implementation; Amazon S3 (or any
 * S3-compatible store) is a drop-in adapter change via `STORAGE_PROVIDER`.
 *
 * ```
 * lib/storage/
 *   types.ts      ← this file (the contract)
 *   cloudinary.ts ← provider #1
 *   index.ts      ← factory: getStorage()
 * ```
 */
export type StorageProvider = 'cloudinary' | 's3' | 'local'

export type ResourceType = 'raw' | 'image' | 'video' | 'auto'

export interface UploadOptions {
  /** Namespace prefix, e.g. `u/{userId}` or `o/{orgId}`. */
  folder: string
  /** Stable public id (without extension). Auto-generated when omitted. */
  publicId?: string
  /** Usually `raw` for CSV/Excel/JSON artifacts. */
  resourceType?: ResourceType
  /** Original file name for retention. */
  originalFilename?: string
  contentType?: string
}

export interface StoredFile {
  /** Vendor identifier used to retrieve or delete the object. */
  key: string
  /** Permanent URL. */
  url: string
  bytes: number
  provider: StorageProvider
}

export interface StorageAdapter {
  readonly provider: StorageProvider
  upload(buffer: Buffer, options: UploadOptions): Promise<StoredFile>
  /** Resolve a stable public URL for a stored key. */
  getUrl(key: string): Promise<string>
  /** Read back the exact bytes for a stored key (used to merge chunks). */
  read(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  isConfigured(): boolean
}
