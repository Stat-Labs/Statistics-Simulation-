import { NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { users, organizationMembers } from '@/db/schema'
import { sql } from 'drizzle-orm'
import { hashPassword } from '@/lib/auth/password'
import { registerSchema } from '@/lib/auth/schemas'
import { signSessionToken } from '@/lib/auth/jwt'
import { createSessionRow, setSessionCookie } from '@/lib/auth/session'
import { createOrganization, ensureDefaultProject, writeAuditLog } from '@/lib/db/services'
import { ok, fail, isTrustedOrigin, parseJsonBody, firstZodError } from '@/lib/api/helpers'
import { rateLimit, getRateLimitIdentifier } from '@/lib/utils/rateLimit'

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  if (!rateLimit(`register:${getRateLimitIdentifier(request)}`, 10, 60_000).allowed) {
    return fail('Too many sign-up attempts. Try again shortly.', 429)
  }

  const raw = await parseJsonBody(request)
  const parsed = registerSchema.safeParse(raw)
  if (!parsed.success) {
    return fail(firstZodError(parsed.error), 400)
  }

  const { email, password, name, accountType, orgName } = parsed.data
  const db = await getDb()

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1)
  if (existing.length > 0) {
    return fail('An account with this email already exists. Try signing in.', 409)
  }

  const userId = crypto.randomUUID()
  const now = Date.now()
  const passwordHash = await hashPassword(password)

  await db.insert(users).values({
    id: userId,
    email,
    passwordHash,
    name: name.trim(),
    accountType,
    status: 'active',
    preferredAiProvider: 'groq',
    createdAt: now,
    updatedAt: now,
  })

  let orgId: string | null = null
  let org: { id: string; name: string; slug: string; plan: string; role: string } | null = null

  if (accountType === 'enterprise') {
    const created = await createOrganization(orgName ?? name, userId)
    orgId = created.id
    await db.insert(organizationMembers).values({
      id: crypto.randomUUID(),
      orgId: created.id,
      userId,
      role: 'owner',
      status: 'active',
      joinedAt: now,
      createdAt: now,
    })
    org = {
      id: created.id,
      name: (orgName ?? name).trim(),
      slug: created.slug,
      plan: 'free',
      role: 'owner',
    }
    await writeAuditLog({
      orgId: created.id,
      userId,
      action: 'org.created',
      resourceType: 'organization',
      resourceId: created.id,
      ip: request.headers.get('x-forwarded-for'),
    })
  }

  await ensureDefaultProject(userId, orgId)

  const sessionId = await createSessionRow(userId, request)
  const token = await signSessionToken(userId, sessionId)

  const response = ok({
    user: { id: userId, email, name, accountType },
    org,
  })
  setSessionCookie(response, token)
  return response
}
