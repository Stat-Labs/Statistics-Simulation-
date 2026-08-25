import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { retrieveMemory, type Scope } from '@/lib/memory/store'
import { ok, fail, isTrustedOrigin, parseJsonBody } from '@/lib/api/helpers'

/**
 * POST /api/memory/query
 *
 * RAG retrieval: embeds the question, ranks stored knowledge, and returns the
 * assembled context (findings, glossary, KPIs, dataset metadata) that a future
 * AI conversation should use before generating an answer.
 */
export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) return fail('Blocked cross-origin request', 403)
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const raw = await parseJsonBody(request)
  const question = String((raw as { question?: string })?.question ?? '').trim()
  if (!question) return fail('question is required', 400)

  const scope: Scope = session.org
    ? { ownerId: session.user.id, orgId: session.org.id }
    : { ownerId: session.user.id, orgId: null }

  const context = await retrieveMemory(scope, question)
  return ok({ question, context })
}
