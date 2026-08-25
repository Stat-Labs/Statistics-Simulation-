import { NextRequest, NextResponse } from 'next/server'
import { toErrorResponse } from '@/lib/utils/errors'

const PYTHON_BACKEND = process.env.PYTHON_BACKEND_URL ?? 'http://127.0.0.1:8000'

/**
 * GET /api/stream-profile/jobs/{jobId}
 *
 * Polls the FastAPI background worker for a profile job's status, progress,
 * stage, and (on success) the full StreamProfileResponse result.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const jobId = params.id
  if (!jobId) {
    return Response.json({ success: false, error: 'Missing job id' }, { status: 400 })
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(`${PYTHON_BACKEND}/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeout)

    if (res.status === 404) {
      return Response.json({ success: false, error: 'Job not found' }, { status: 404 })
    }
    if (!res.ok) {
      return Response.json(
        { success: false, error: `Python backend error (${res.status})` },
        { status: res.status },
      )
    }

    const text = await res.text()
    const data = JSON.parse(text)
    return NextResponse.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('fetch failed') || msg.includes('ECONNREFUSED') || msg.includes('connect')) {
      return Response.json(
        { success: false, error: 'Python backend is not running. Start it with: npm run dev:backend' },
        { status: 502 },
      )
    }
    return Response.json(toErrorResponse(err), { status: 500 })
  }
}
