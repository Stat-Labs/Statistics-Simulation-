import type { AIProviderId, AIResponse } from '@/lib/ai/providers/types'
import { callAIForUser } from '@/lib/ai/resolve'

/**
 * Legacy platform-only entry point.
 *
 * Kept for backward compatibility with code that doesn't carry a user context.
 * New code should prefer `callAIForUser({ userId, orgId, ... }, ...)` from
 * `lib/ai/resolve.ts` so BYOK keys are honoured.
 */
export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  validator?: (content: string) => boolean,
  preferredProvider?: AIProviderId,
): Promise<AIResponse> {
  return callAIForUser(
    { preferredProvider },
    systemPrompt,
    userPrompt,
    validator,
  )
}
