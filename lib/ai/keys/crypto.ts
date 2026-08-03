import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

/**
 * AES-256-GCM encryption for user/org AI keys (BYOK).
 *
 * Keys are never stored in plaintext. A master key (`ENCRYPTION_MASTER_KEY`,
 * base64 32 bytes) encrypts each provider key with a fresh random IV + auth tag.
 *
 * Generate one with:
 *   openssl rand -base64 32
 */
const ENCODED_PREFIX = 'v1:'

function getMasterKey(): Buffer {
  const encoded = process.env.ENCRYPTION_MASTER_KEY
  if (encoded) {
    const fromB64 = Buffer.from(encoded, 'base64')
    if (fromB64.length === 32) return fromB64
    if (/^[0-9a-fA-F]{64}$/.test(encoded)) return Buffer.from(encoded, 'hex')
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_MASTER_KEY is required in production (base64, 32 bytes).')
  }
  // Deterministic dev-only fallback so `npm run dev` works out of the box.
  return createHash('sha256').update('statlab-dev-master-key').digest()
}

export function encryptSecret(plaintext: string): string {
  const key = getMasterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENCODED_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptSecret(payload: string): string {
  if (!payload.startsWith(ENCODED_PREFIX)) {
    throw new Error('Unsupported encrypted payload format')
  }
  const key = getMasterKey()
  const [, ivB64, tagB64, cipherB64] = payload.split(':')
  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  const encrypted = Buffer.from(cipherB64, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

/** Last 4 characters of a key — enough to recognise it, never enough to use it. */
export function keyHint(plaintext: string): string {
  const clean = plaintext.trim()
  return clean.length > 4 ? clean.slice(-4) : clean
}
