import { NextRequest, NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '@/db/client'
import { sessions, users, organizationMembers, organizations } from '@/db/schema'
import { verifySessionToken } from './jwt'
import { SESSION_COOKIE, SESSION_DURATION_MS } from './constants'

export interface SessionUser {
  id: string
  email: string
  name: string
  accountType: 'personal' | 'enterprise'
  avatarUrl: string | null
  preferredAiProvider: string
}

export interface SessionOrg {
  id: string
  name: string
  slug: string
  plan: string
  role: 'owner' | 'admin' | 'member' | 'viewer'
}

export interface SessionContext {
  sessionId: string
  user: SessionUser
  orgs: SessionOrg[]
  /** Active org for BYOK / project scoping (first active membership). */
  org: SessionOrg | null
}

export function getSessionToken(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE)?.value ?? null
}

export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 60,
  })
  return response
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}

/** Insert a session row and return its id (used as the JWT jti). */
export async function createSessionRow(
  userId: string,
  request: NextRequest,
): Promise<string> {
  const db = await getDb()
  const sessionId = crypto.randomUUID()
  const now = Date.now()
  await db.insert(sessions).values({
    id: sessionId,
    userId,
    ip: getClientIp(request),
    userAgent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
    expiresAt: now + SESSION_DURATION_MS,
    lastSeenAt: now,
    createdAt: now,
  })
  return sessionId
}

export async function revokeSession(sessionId: string): Promise<void> {
  const db = await getDb()
  await db
    .update(sessions)
    .set({ revokedAt: Date.now() })
    .where(eq(sessions.id, sessionId))
}

/**
 * Full session resolution: verifies the JWT, then validates the DB session row
 * (not revoked / not expired) and loads the user + org memberships.
 */
export async function getSession(request: NextRequest): Promise<SessionContext | null> {
  const token = getSessionToken(request)
  if (!token) return null
  const claims = await verifySessionToken(token)
  if (!claims) return null

  const db = await getDb()

  const sessionRows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, claims.sessionId), eq(sessions.userId, claims.userId)))
    .limit(1)
  if (sessionRows.length === 0) return null
  const session = sessionRows[0]
  if (session.revokedAt !== null) return null
  if (session.expiresAt < Date.now()) return null

  const userRows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, claims.userId), eq(users.status, 'active')))
    .limit(1)
  if (userRows.length === 0) return null
  const user = userRows[0]

  const membershipRows = await db
    .select({
      orgId: organizationMembers.orgId,
      role: organizationMembers.role,
      orgName: organizations.name,
      orgSlug: organizations.slug,
      orgPlan: organizations.plan,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(
      and(
        eq(organizationMembers.userId, user.id),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .orderBy(sql`${organizationMembers.createdAt} asc`)

  const orgs: SessionOrg[] = membershipRows.map((m) => ({
    id: m.orgId,
    name: m.orgName,
    slug: m.orgSlug,
    plan: m.orgPlan,
    role: m.role as SessionOrg['role'],
  }))

  // Throttled last-seen touch.
  if (Date.now() - session.lastSeenAt > 60_000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: Date.now() })
      .where(eq(sessions.id, session.id))
  }

  return {
    sessionId: session.id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      accountType: (user.accountType as 'personal' | 'enterprise') ?? 'personal',
      avatarUrl: user.avatarUrl,
      preferredAiProvider: user.preferredAiProvider,
    },
    orgs,
    org: orgs[0] ?? null,
  }
}

/** Convenience for public routes that want auth when present (never throws). */
export async function optionalSession(request: NextRequest): Promise<SessionContext | null> {
  try {
    return await getSession(request)
  } catch {
    return null
  }
}

export function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? null
}
