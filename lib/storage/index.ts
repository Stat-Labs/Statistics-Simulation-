import { config } from '@/lib/config'
import type { StorageAdapter } from './types'
import { cloudinaryAdapter } from './cloudinary'
import { localAdapter } from './local'

/**
 * Storage factory. `STORAGE_PROVIDER=cloudinary` (default) in production;
 * `STORAGE_PROVIDER=local` for zero-config development. Add an S3 adapter
 * implementing `StorageAdapter` and register it here — zero changes anywhere
 * else in the app.
 */
const adapters: Record<string, StorageAdapter> = {
  cloudinary: cloudinaryAdapter,
  local: localAdapter,
}

let cached: StorageAdapter | null = null

export function getStorage(): StorageAdapter {
  if (cached) return cached
  const provider = config.storage.provider
  const adapter = adapters[provider]
  if (!adapter) {
    throw new Error(
      `Unknown STORAGE_PROVIDER "${provider}". Available: ${Object.keys(adapters).join(', ')}`,
    )
  }
  cached = adapter
  return adapter
}
