import { NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'

export function ok(data: Record<string, unknown> = {}, init?: ResponseInit): NextResponse {
  return NextResponse.json({ success: true, ...data }, init)
}

export function fail(
  message: string,
  status = 400,
  code?: string,
): NextResponse {
  return NextResponse.json(
    { success: false, error: message, ...(code ? { code } : {}) },
    { status },
  )
}

/**
 * CSRF defence for state-changing routes. Same-origin browsers send an `Origin`
 * header that matches either the request's own host or the configured public
 * URL. Cross-site form posts are rejected.
 */
export function isTrustedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true // non-browser clients (curl, tests)
  const originHost = safeHost(origin)
  const requestHost = request.headers.get('host')
  const configuredHost = safeHost(config.app.publicUrl)
  if (requestHost && originHost === requestHost.toLowerCase()) return true
  if (configuredHost && originHost === configuredHost.toLowerCase()) return true
  return false
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

export function parseJsonBody(
  request: NextRequest,
): Promise<unknown> {
  return request.json().catch(() => null)
}

/** Extract a readable message from a zod v4 error (`issues`), with fallbacks. */
export function firstZodError(error: {
  issues?: Array<{ message?: string }>
  message?: string
} | null | undefined): string {
  return error?.issues?.[0]?.message ?? error?.message ?? 'Invalid input'
}
