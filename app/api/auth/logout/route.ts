import { NextRequest } from 'next/server'
import { getSession, revokeSession, clearSessionCookie } from '@/lib/auth/session'
import { ok } from '@/lib/api/helpers'

export async function POST(request: NextRequest) {
  const session = await getSession(request)
  if (session) {
    await revokeSession(session.sessionId)
  }
  const response = ok()
  return clearSessionCookie(response)
}
