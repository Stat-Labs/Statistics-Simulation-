/**
 * Minimal HS256 JWT implementation on top of the platform WebCrypto API
 * (`crypto.subtle`). Runs in both the Edge Runtime (middleware) and Node.js
 * (API routes), so we avoid jose's WebAPI bundle which pulls in
 * Edge-incompatible primitives like DecompressionStream.
 */

export interface SessionJWT {
  sub: string // userId
  sid: string // sessionId (jti)
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 60 // 60 days
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Edge-safe signing secret resolution (no node:crypto — runs in middleware).
 * Production requires AUTH_SECRET; dev uses a fixed fallback so `npm run dev`
 * works out of the box.
 */
function getSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (secret) {
    if (secret.length < 32) {
      throw new Error('AUTH_SECRET must be at least 32 characters.')
    }
    return secret
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production (at least 32 characters).')
  }
  return 'statlab-dev-auth-secret-change-me-00000000000000'
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64UrlJson(obj: unknown): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(obj)))
}

async function hmacSign(data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, data as BufferSource)
  return new Uint8Array(sig)
}

export async function signSessionToken(userId: string, sessionId: string): Promise<string> {
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' })
  const now = Math.floor(Date.now() / 1000)
  const payload = base64UrlJson({ sub: userId, jti: sessionId, iat: now, exp: now + SESSION_TTL_SECONDS })
  const signingInput = `${header}.${payload}`
  const signature = bytesToBase64Url(await hmacSign(encoder.encode(signingInput)))
  return `${signingInput}.${signature}`
}

/** Lightweight signature/expiry check — used by middleware (edge-safe). */
export async function verifySessionToken(
  token: string,
): Promise<{ userId: string; sessionId: string; exp: number } | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureB64] = parts
    const signingInput = `${headerB64}.${payloadB64}`

    // Recompute the signature and compare in constant time.
    const expected = await hmacSign(encoder.encode(signingInput))
    const received = base64UrlToBytes(signatureB64)
    if (expected.length !== received.length) return null
    let diff = 0
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ received[i]
    if (diff !== 0) return null

    const header = JSON.parse(decoder.decode(base64UrlToBytes(headerB64))) as { alg?: string }
    if (header.alg !== 'HS256') return null

    const payload = JSON.parse(decoder.decode(base64UrlToBytes(payloadB64))) as {
      sub?: string
      jti?: string
      exp?: number
    }
    if (!payload.sub || !payload.jti) return null
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null

    return { userId: payload.sub, sessionId: payload.jti, exp: payload.exp }
  } catch {
    return null
  }
}
