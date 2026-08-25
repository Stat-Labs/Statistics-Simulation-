import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/session'
import {
  saveUserKey,
  saveOrgKey,
  deleteUserKey,
  listUserKeys,
} from '@/lib/ai/keys/repository'
import { getDb } from '@/db/client'
import { orgAiKeys } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { providers, ALL_PROVIDER_IDS, PLATFORM_PROVIDER_ORDER } from '@/lib/ai/providers'
import { ok, fail, isTrustedOrigin, parseJsonBody, firstZodError } from '@/lib/api/helpers'
import { config } from '@/lib/config'

function platformHas(id: string): boolean {
  switch (id) {
    case 'groq': return Boolean(config.ai.groqApiKey)
    case 'mistral': return Boolean(config.ai.mistralApiKey)
    case 'openai': return Boolean(config.ai.openaiApiKey)
    case 'anthropic': return Boolean(config.ai.anthropicApiKey)
    default: return false
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const userKeys = await listUserKeys(session.user.id)

  const db = await getDb()
  const orgKeyRows = session.org
    ? await db.select().from(orgAiKeys).where(eq(orgAiKeys.orgId, session.org.id))
    : []

  const list = ALL_PROVIDER_IDS.map((id) => {
    const provider = providers[id]
    const userKey = userKeys.find((k) => k.provider === id)
    const orgKey = orgKeyRows.find((r) => r.provider === id)
    return {
      id,
      label: provider.label,
      defaultModel: provider.defaultModel,
      platformConfigured: platformHas(id),
      hasUserKey: Boolean(userKey),
      userHint: userKey?.hint ?? null,
      hasOrgKey: Boolean(orgKey),
      orgHint: orgKey?.keyHint ?? null,
    }
  })

  return ok({
    providers: list,
    preferred: session.user.preferredAiProvider,
    order: PLATFORM_PROVIDER_ORDER,
  })
}

const putSchema = z.object({
  provider: z.enum(ALL_PROVIDER_IDS),
  apiKey: z.string().min(8, 'API key looks too short').max(500),
  scope: z.enum(['user', 'org']).default('user'),
})

export async function PUT(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const raw = await parseJsonBody(request)
  const parsed = putSchema.safeParse(raw)
  if (!parsed.success) {
    return fail(firstZodError(parsed.error), 400)
  }
  const { provider, apiKey, scope } = parsed.data

  if (scope === 'org') {
    if (!session.org) return fail('You are not in an organization', 403)
    if (session.org.role !== 'owner' && session.org.role !== 'admin') {
      return fail('Only owners and admins can manage organization keys', 403)
    }
    const stored = await saveOrgKey(session.org.id, provider, apiKey, session.user.id)
    return ok({ scope: 'org', provider, hint: stored.hint })
  }

  const stored = await saveUserKey(session.user.id, provider, apiKey)
  return ok({ scope: 'user', provider, hint: stored.hint })
}

const deleteSchema = z.object({
  provider: z.enum(ALL_PROVIDER_IDS),
  scope: z.enum(['user', 'org']).default('user'),
})

export async function DELETE(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const raw = await parseJsonBody(request)
  const parsed = deleteSchema.safeParse(raw)
  if (!parsed.success) {
    return fail(firstZodError(parsed.error), 400)
  }
  const { provider, scope } = parsed.data

  if (scope === 'org') {
    if (!session.org) return fail('You are not in an organization', 403)
    if (session.org.role !== 'owner' && session.org.role !== 'admin') {
      return fail('Only owners and admins can manage organization keys', 403)
    }
    const db = await getDb()
    await db
      .delete(orgAiKeys)
      .where(and(eq(orgAiKeys.orgId, session.org.id), eq(orgAiKeys.provider, provider)))
    return ok({ scope: 'org', provider, deleted: true })
  }

  await deleteUserKey(session.user.id, provider)
  return ok({ scope: 'user', provider, deleted: true })
}
