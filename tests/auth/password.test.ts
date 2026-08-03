import { describe, it, expect } from 'vitest'

const { hashPassword, verifyPassword } = await import('@/lib/auth/password')

describe('password hashing', () => {
  it('hashes and verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).not.toBe('correct horse battery staple')
    expect(hash).toMatch(/^\$2[aby]\$/)
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('right-password')
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false)
  })

  it('produces distinct hashes for the same password (salting)', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
    await expect(verifyPassword('same-password', a)).resolves.toBe(true)
    await expect(verifyPassword('same-password', b)).resolves.toBe(true)
  })
})
