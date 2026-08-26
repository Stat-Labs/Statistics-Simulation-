import { NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { organizationMembers } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { inviteSchema } from '@/lib/auth/schemas'
import { writeAuditLog } from '@/lib/db/services'
import { ok, fail, isTrustedOrigin, parseJsonBody, firstZodError } from '@/lib/api/helpers'
import { config } from '@/lib/config'

const INVITE_LINK_TTL_DAYS = 7

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)
  if (!session.org) return fail('You are not a member of an organization', 403)

  const role = session.org.role
  if (role !== 'owner' && role !== 'admin') {
    return fail('Only owners and admins can invite members', 403)
  }

  const raw = await parseJsonBody(request)
  const parsed = inviteSchema.safeParse(raw)
  if (!parsed.success) {
    return fail(firstZodError(parsed.error), 400)
  }
  const { email, role: invitedRole } = parsed.data
  if (email === session.user.email) {
    return fail('You cannot invite yourself', 400)
  }

  const db = await getDb()

  // Reject if the email already has a pending invite for this org.
  const existing = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.orgId, session.org.id),
        eq(organizationMembers.invitedEmail, email),
      ),
    )
    .limit(1)
  if (existing.length > 0) {
    return fail('This person is already a member or has a pending invite', 409)
  }

  const token = crypto.randomUUID()
  const now = Date.now()
  await db.insert(organizationMembers).values({
    id: crypto.randomUUID(),
    orgId: session.org.id,
    userId: null,
    role: invitedRole,
    status: 'invited',
    invitedEmail: email,
    inviteToken: token,
    invitedAt: now,
    createdAt: now,
  })

  await writeAuditLog({
    orgId: session.org.id,
    userId: session.user.id,
    action: 'member.invited',
    resourceType: 'organization_member',
    meta: { email, role: invitedRole },
    ip: request.headers.get('x-forwarded-for'),
  })

  const base = config.app.publicUrl.replace(/\/$/, '')
  return ok({
    invite: {
      email,
      role: invitedRole,
      expiresAt: now + INVITE_LINK_TTL_DAYS * 86_400_000,
    },
    inviteUrl: `${base}/accept-invite?token=${token}`,
  })
}
