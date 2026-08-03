import { NextRequest, NextResponse } from 'next/server'
import { verifySessionToken } from '@/lib/auth/jwt'
import { SESSION_COOKIE } from '@/lib/auth/constants'

const PROTECTED_PAGES = ['/upload', '/analyse', '/dashboard', '/settings', '/visualize']
const PROTECTED_API = [
  '/api/datasets',
  '/api/analyses',
  '/api/settings',
  '/api/analyse',
  '/api/profile',
  '/api/interpret',
  '/api/detect-codes',
  '/api/auth/invite',
  '/api/auth/logout',
  '/api/uploads',
  '/api/memory',
  '/api/visualize',
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get(SESSION_COOKIE)?.value ?? null
  const isApi = pathname.startsWith('/api/')
  const needsAuth =
    (isApi && PROTECTED_API.some((p) => pathname === p || pathname.startsWith(`${p}/`))) ||
    (!isApi && PROTECTED_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`)))

  if (!needsAuth) return NextResponse.next()

  const valid = token ? await verifySessionToken(token) : null

  if (valid) return NextResponse.next()

  if (isApi) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    '/upload/:path*',
    '/analyse/:path*',
    '/dashboard/:path*',
    '/settings/:path*',
    '/visualize/:path*',
    '/api/datasets/:path*',
    '/api/analyses/:path*',
    '/api/settings/:path*',
    '/api/analyse/:path*',
    '/api/profile/:path*',
    '/api/interpret/:path*',
    '/api/detect-codes/:path*',
    '/api/auth/invite/:path*',
    '/api/auth/logout/:path*',
    '/api/uploads/:path*',
    '/api/memory/:path*',
    '/api/visualize/:path*',
  ],
}
