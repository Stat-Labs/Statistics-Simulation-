import { NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { organizationMembers } from '@/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { acceptInviteSchema } from '@/lib/auth/schemas'
import { ensureDefaultProject, writeAuditLog } from '@/lib/db/services'
import { ok, fail, isTrustedOrigin, parseJsonBody, firstZodError } from '@/lib/api/helpers'

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const raw = await parseJsonBody(request)
  const parsed = acceptInviteSchema.safeParse(raw)
  if (!parsed.success) {
    return fail(firstZodError(parsed.error), 400)
  }
  const { token } = parsed.data

  const db = await getDb()
  const rows = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.inviteToken, token), isNull(organizationMembers.userId)))
    .limit(1)

  if (rows.length === 0) {
    return fail('Invite not found or already accepted', 404)
  }
  const invite = rows[0]
  if (invite.invitedEmail && invite.invitedEmail.toLowerCase() !== session.user.email.toLowerCase()) {
    return fail('This invite was sent to a different email address', 403)
  }
  if (invite.invitedAt && invite.invitedAt < Date.now() - 7 * 86_400_000) {
    return fail('This invite has expired', 410)
  }

  await db
    .update(organizationMembers)
    .set({
      userId: session.user.id,
      status: 'active',
      inviteToken: null,
      joinedAt: Date.now(),
    })
    .where(eq(organizationMembers.id, invite.id))

  await ensureDefaultProject(session.user.id, invite.orgId)

  await writeAuditLog({
    orgId: invite.orgId,
    userId: session.user.id,
    action: 'member.joined',
    resourceType: 'organization_member',
    resourceId: invite.id,
    ip: request.headers.get('x-forwarded-for'),
  })

  return ok({ orgId: invite.orgId })
}
