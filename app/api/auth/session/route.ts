import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { ok } from '@/lib/api/helpers'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session) {
      return ok({ user: null, orgs: [], org: null })
    }
    return ok({
      user: session.user,
      orgs: session.orgs,
      org: session.org,
    })
  } catch {
    // DB unavailable or misconfigured — treat as unauthenticated
    return ok({ user: null, orgs: [], org: null })
  }
}
