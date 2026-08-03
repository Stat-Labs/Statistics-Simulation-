import { NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { users } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { verifyPassword } from '@/lib/auth/password'
import { loginSchema } from '@/lib/auth/schemas'
import { signSessionToken } from '@/lib/auth/jwt'
import { createSessionRow, setSessionCookie, type SessionOrg } from '@/lib/auth/session'
import { ok, fail, isTrustedOrigin, parseJsonBody, firstZodError } from '@/lib/api/helpers'
import { rateLimit, getRateLimitIdentifier } from '@/lib/utils/rateLimit'

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  if (!rateLimit(`login:${getRateLimitIdentifier(request)}`, 10, 60_000).allowed) {
    return fail('Too many sign-in attempts. Try again shortly.', 429)
  }

  const raw = await parseJsonBody(request)
  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return fail(firstZodError(parsed.error), 400)
  }

  const { email, password } = parsed.data
  const db = await getDb()

  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1)

  if (rows.length === 0 || rows[0].status !== 'active') {
    return fail('Invalid email or password.', 401)
  }
  const user = rows[0]

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    return fail('Invalid email or password.', 401)
  }

  await db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id))

  const sessionId = await createSessionRow(user.id, request)
  const token = await signSessionToken(user.id, sessionId)

  const orgs: SessionOrg[] = []
  const response = ok({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      accountType: user.accountType,
    },
    orgs,
    org: null,
  })
  setSessionCookie(response, token)
  return response
}
