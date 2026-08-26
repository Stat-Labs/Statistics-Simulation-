import { NextRequest } from 'next/server'
import { getDb } from '@/db/client'
import { organizationMembers, users } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { ok, fail } from '@/lib/api/helpers'

export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)
  if (!session.org) return fail('You are not in an organization', 404)

  const db = await getDb()
  const rows = await db
    .select({
      id: organizationMembers.id,
      role: organizationMembers.role,
      status: organizationMembers.status,
      invitedEmail: organizationMembers.invitedEmail,
      joinedAt: organizationMembers.joinedAt,
      invitedAt: organizationMembers.invitedAt,
      userId: organizationMembers.userId,
      name: users.name,
      email: users.email,
    })
    .from(organizationMembers)
    .leftJoin(users, sql`${users.id} = ${organizationMembers.userId}`)
    .where(eq(organizationMembers.orgId, session.org.id))
    .orderBy(sql`${organizationMembers.createdAt} asc`)

  const members = rows
    .filter((r) => r.status === 'active')
    .map((r) => ({
      id: r.id,
      role: r.role,
      name: r.name ?? r.invitedEmail,
      email: r.email ?? r.invitedEmail,
      joinedAt: r.joinedAt,
    }))
  const invites = rows
    .filter((r) => r.status === 'invited')
    .map((r) => ({
      id: r.id,
      role: r.role,
      email: r.invitedEmail,
      invitedAt: r.invitedAt,
    }))

  return ok({ members, invites })
}
