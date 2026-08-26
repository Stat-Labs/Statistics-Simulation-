import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/db/client'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth/session'
import { ALL_PROVIDER_IDS } from '@/lib/ai/providers'
import { ok, fail, isTrustedOrigin, parseJsonBody, firstZodError } from '@/lib/api/helpers'

const schema = z.object({
  provider: z.enum(ALL_PROVIDER_IDS),
})

export async function PUT(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const raw = await parseJsonBody(request)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return fail(firstZodError(parsed.error), 400)
  }

  const db = await getDb()
  await db
    .update(users)
    .set({ preferredAiProvider: parsed.data.provider, updatedAt: Date.now() })
    .where(eq(users.id, session.user.id))

  return ok({ preferred: parsed.data.provider })
}
