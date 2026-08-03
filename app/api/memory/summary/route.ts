import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getMemorySummary, type Scope } from '@/lib/memory/store'
import { ok, fail } from '@/lib/api/helpers'

/** GET /api/memory/summary?scope=personal|org — dashboard knowledge overview. */
export async function GET(request: NextRequest) {
  const session = await getSession(request)
  if (!session) return fail('Not authenticated', 401)

  const { searchParams } = request.nextUrl
  const scope: Scope = searchParams.get('scope') === 'org' && session.org
    ? { ownerId: session.user.id, orgId: session.org.id }
    : { ownerId: session.user.id, orgId: null }

  const summary = await getMemorySummary(scope)
  return ok({ memory: summary })
}
