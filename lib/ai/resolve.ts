import { config } from '@/lib/config'
import { getDb } from '@/db/client'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { providers, PLATFORM_PROVIDER_ORDER } from './providers'
import { getUserKey, getOrgKey } from './keys/repository'
import type { AIProviderId, AIResponse } from './providers/types'

export interface AIContext {
  userId?: string
  orgId?: string | null
  preferredProvider?: AIProviderId
}

export type KeySourceKind = 'user' | 'org' | 'platform'

export interface KeySource {
  provider: AIProviderId
  apiKey: string
  source: KeySourceKind
}

function platformKey(provider: AIProviderId): string | undefined {
  switch (provider) {
    case 'groq':
      return config.ai.groqApiKey
    case 'mistral':
      return config.ai.mistralApiKey
    case 'openai':
      return config.ai.openaiApiKey
    case 'anthropic':
      return config.ai.anthropicApiKey
  }
}

/**
 * Builds the ordered key chain for a request:
 *
 *   1. the user's own BYOK key for a provider, if set
 *   2. the active org's BYOK key, if set
 *   3. the platform default key, if configured
 *
 * Providers are tried in the user's preferred order (falling back to
 * Groq → Mistral → OpenAI → Claude).
 */
export async function resolveKeyChain(ctx: AIContext): Promise<KeySource[]> {
  const chain: KeySource[] = []
  const seen = new Set<string>()

  const push = (provider: AIProviderId, apiKey: string, source: KeySourceKind) => {
    if (!apiKey || !apiKey.trim()) return
    const id = `${provider}:${source}`
    if (seen.has(id)) return
    seen.add(id)
    chain.push({ provider, apiKey: apiKey.trim(), source })
  }

  const preferred = ctx.preferredProvider
  const order = preferred
    ? [preferred, ...PLATFORM_PROVIDER_ORDER.filter((p) => p !== preferred)]
    : PLATFORM_PROVIDER_ORDER

  for (const provider of order) {
    if (ctx.userId) {
      const userKey = await getUserKey(ctx.userId, provider)
      if (userKey) {
        push(provider, userKey, 'user')
        continue
      }
    }
    if (ctx.orgId) {
      const orgKey = await getOrgKey(ctx.orgId, provider)
      if (orgKey) {
        push(provider, orgKey, 'org')
        continue
      }
    }
    const pKey = platformKey(provider)
    if (pKey) push(provider, pKey, 'platform')
  }
  return chain
}

/**
 * Calls the AI chain for a given context. Each provider is tried in order until
 * one returns content that passes the optional validator. Throws when no
 * provider succeeds (callers implement graceful fallbacks).
 */
export async function callAIForUser(
  ctx: AIContext,
  systemPrompt: string,
  userPrompt: string,
  validator?: (content: string) => boolean,
): Promise<AIResponse> {
  const chain = await resolveKeyChain(ctx)
  if (chain.length === 0) {
    throw new Error(
      'No AI providers configured. Add a platform key or bring your own OpenAI / Claude key in Settings.',
    )
  }

  const preferred = ctx.preferredProvider ?? 'groq'
  for (const source of chain) {
    try {
      const provider = providers[source.provider]
      const content = await provider.call({
        systemPrompt,
        userPrompt,
        apiKey: source.apiKey,
      })
      if (validator && !validator(content)) {
        console.warn(
          `[StatLab AI] ${source.provider} (${source.source}) returned invalid/unparseable response. Trying next...`,
        )
        continue
      }
      return {
        content,
        provider: source.provider,
        fallbackUsed: source.provider !== preferred || source.source !== 'platform',
      }
    } catch (error) {
      console.warn(
        `[StatLab AI] ${source.provider} (${source.source}) failed: ${(error as Error).message}. Trying next...`,
      )
    }
  }

  throw new Error('All AI providers failed. Check API keys and rate limits.')
}

export async function getPreferredProvider(
  userId?: string,
): Promise<AIProviderId | undefined> {
  if (!userId) return undefined
  try {
    const db = await getDb()
    const rows = await db
      .select({ preferredAiProvider: users.preferredAiProvider })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (rows.length > 0) return rows[0].preferredAiProvider as AIProviderId
  } catch {
    // DB unavailable — fall back to platform default chain.
  }
  return undefined
}
