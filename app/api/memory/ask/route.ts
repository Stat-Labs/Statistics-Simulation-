import { NextRequest } from 'next/server'
import { rateLimit, getRateLimitIdentifier } from '@/lib/utils/rateLimit'
import { getSession } from '@/lib/auth/session'
import { getPreferredProvider } from '@/lib/ai/resolve'
import { answerFromMemory } from '@/lib/ai/rag'
import type { Scope } from '@/lib/memory/store'
import { ok, fail, isTrustedOrigin, parseJsonBody } from '@/lib/api/helpers'

/**
 * POST /api/memory/ask
 *
 * Retrieval-before-answer: embeds the question, ranks workspace knowledge
 * (findings, KPIs, glossary, datasets), then generates a grounded AI answer
 * citing the retrieved sources. Empty context short-circuits to a canned
 * response (no LLM call). If the LLM chain fails, the retrieved context is
 * still returned so the client can show evidence without an answer.
 */
export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)

  const { allowed } = rateLimit(`ask:${getRateLimitIdentifier(request)}`, 30, 60_000)
  if (!allowed) return fail('Too many questions. Wait a moment.', 429)

  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const raw = await parseJsonBody(request)
  const question = String((raw as { question?: string })?.question ?? '').trim()
  if (!question) return fail('question is required', 400)

  const scope: Scope = session.org
    ? { ownerId: session.user.id, orgId: session.org.id }
    : { ownerId: session.user.id, orgId: null }

  const preferredProvider = await getPreferredProvider(session.user.id)
  const ctx = {
    userId: session.user.id,
    orgId: session.org?.id ?? null,
    preferredProvider,
  }

  const result = await answerFromMemory(scope, question, ctx)
  return ok({
    question,
    answer: result.answer,
    grounded: result.grounded,
    sources: result.sources,
    context: result.context,
  })
}
