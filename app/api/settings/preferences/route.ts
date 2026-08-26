import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import { getDb } from '@/db/client'
import { userPreferences } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { ok, fail, parseJsonBody, firstZodError } from '@/lib/api/helpers'

export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  try {
    const db = await getDb()
    const rows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, session.user.id))

    const prefs: Record<string, string> = {}
    for (const row of rows) {
      prefs[row.key] = row.value
    }

    return ok({ preferences: prefs })
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Database error', 500)
  }
}

const postSchema = z.object({
  key: z.string().min(1).max(200),
  value: z.string().max(10000),
})

export async function POST(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  try {
    const raw = await parseJsonBody(request)
    const parsed = postSchema.safeParse(raw)
    if (!parsed.success) {
      return fail(firstZodError(parsed.error), 400)
    }
    const { key, value } = parsed.data

    const db = await getDb()
    const existing = await db
      .select()
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, session.user.id),
          eq(userPreferences.key, key)
        )
      )
      .limit(1)

    if (existing.length > 0) {
      await db
        .update(userPreferences)
        .set({ value, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(userPreferences.id, existing[0].id))
    } else {
      const id = Math.random().toString(36).slice(2)
      await db.insert(userPreferences).values({
        id,
        userId: session.user.id,
        orgId: session.org?.id ?? null,
        key,
        value,
        updatedAt: Math.floor(Date.now() / 1000),
      })
    }

    return ok({ success: true })
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Database error', 500)
  }
}
