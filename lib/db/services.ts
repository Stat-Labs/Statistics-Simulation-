import { getDb } from '@/db/client'
import { projects, organizations, auditLogs } from '@/db/schema'
import { jsonify } from '@/db/table'
import { sql } from 'drizzle-orm'

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.slice(0, 48) || 'org'
}

async function uniqueSlug(base: string): Promise<string> {
  const db = await getDb()
  const candidate = slugify(base)
  const existing = await db
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(sql`${organizations.slug} = ${candidate}`)
    .limit(1)
  if (existing.length === 0) return candidate
  // Append a short suffix until unique.
  for (let i = 0; i < 5; i++) {
    const suffixed = `${candidate}-${Math.random().toString(36).slice(2, 7)}`
    const clash = await db
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(sql`${organizations.slug} = ${suffixed}`)
      .limit(1)
    if (clash.length === 0) return suffixed
  }
  return `${candidate}-${Date.now().toString(36)}`
}

/** Every user gets at least one project (personal workspace). */
export async function ensureDefaultProject(
  userId: string,
  orgId: string | null,
): Promise<string> {
  const db = await getDb()
  const existing = orgId
    ? await db
        .select({ id: projects.id })
        .from(projects)
        .where(sql`${projects.ownerId} = ${userId} AND ${projects.orgId} = ${orgId}`)
        .limit(1)
    : await db
        .select({ id: projects.id })
        .from(projects)
        .where(sql`${projects.ownerId} = ${userId} AND ${projects.orgId} IS NULL`)
        .limit(1)
  if (existing.length > 0) return existing[0].id

  const id = crypto.randomUUID()
  const now = Date.now()
  await db.insert(projects).values({
    id,
    orgId,
    ownerId: userId,
    name: 'My Workspace',
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function createOrganization(
  name: string,
  ownerId: string,
): Promise<{ id: string; slug: string }> {
  const db = await getDb()
  const slug = await uniqueSlug(name)
  const id = crypto.randomUUID()
  const now = Date.now()
  await db.insert(organizations).values({
    id,
    name: name.trim(),
    slug,
    plan: 'free',
    ownerId,
    createdAt: now,
    updatedAt: now,
  })
  return { id, slug }
}

export async function writeAuditLog(entry: {
  orgId?: string | null
  userId?: string | null
  action: string
  resourceType?: string
  resourceId?: string
  meta?: Record<string, unknown> | null
  ip?: string | null
}): Promise<void> {
  try {
    const db = await getDb()
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      orgId: entry.orgId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      meta: jsonify(entry.meta),
      ip: entry.ip ?? null,
      createdAt: Date.now(),
    })
  } catch {
    // Audit logging must never break the primary flow.
  }
}
