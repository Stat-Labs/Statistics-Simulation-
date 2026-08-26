import { describe, it, expect } from 'vitest'

const { encryptSecret, decryptSecret, keyHint } = await import('@/lib/ai/keys/crypto')

describe('AI key encryption (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const secret = 'sk-ant-api03-verylongfakekey-for-testing'
    const stored = encryptSecret(secret)
    expect(stored).toMatch(/^v1:/)
    expect(stored).not.toContain(secret)
    expect(decryptSecret(stored)).toBe(secret)
  })

  it('uses a fresh IV per encryption (ciphertext differs)', () => {
    const secret = 'sk-abcdef123456'
    const a = encryptSecret(secret)
    const b = encryptSecret(secret)
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe(secret)
    expect(decryptSecret(b)).toBe(secret)
  })

  it('rejects a tampered payload', () => {
    const stored = encryptSecret('super-secret')
    const tampered = stored.slice(0, -4) + 'AAAA'
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('rejects unsupported formats', () => {
    expect(() => decryptSecret('plaintext-key')).toThrow()
  })

  it('returns the last 4 characters as a hint', () => {
    expect(keyHint('  sk-abc1234xyz  ')).toBe('4xyz')
    expect(keyHint('ab')).toBe('ab')
    expect(keyHint('')).toBe('')
  })
})
