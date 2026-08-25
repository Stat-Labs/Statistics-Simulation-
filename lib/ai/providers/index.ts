import type { AIProvider, AIProviderId } from './types'
import { groqProvider } from './groq'
import { mistralProvider } from './mistral'
import { openaiProvider } from './openai'
import { anthropicProvider } from './anthropic'

export const providers: Record<AIProviderId, AIProvider> = {
  groq: groqProvider,
  mistral: mistralProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
}

/** Default platform key chain (used when a user/org hasn't provided their own). */
export const PLATFORM_PROVIDER_ORDER: AIProviderId[] = ['groq', 'mistral', 'openai', 'anthropic']

export const ALL_PROVIDER_IDS = PLATFORM_PROVIDER_ORDER

export function getProvider(id: AIProviderId): AIProvider {
  return providers[id]
}
