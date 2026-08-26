import { NextRequest, NextResponse } from 'next/server'
import { validateCSVFile } from '@/lib/utils/validation'
import { toErrorResponse } from '@/lib/utils/errors'

const PYTHON_BACKEND = process.env.PYTHON_BACKEND_URL ?? 'http://127.0.0.1:8000'

/**
 * POST /api/stream-profile/jobs
 *
 * Submits a streaming profile to the FastAPI background worker and returns the
 * JobResponse immediately. Poll GET /api/stream-profile/jobs/{jobId} for
 * progress and the final result (manifest/verification/cacheHit included).
 *
 * @body multipart/form-data
 *   file: CSV file (required)
 *   correlations / chunk_size / nbins / top_frequency / verify / cache (optional)
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    const fileEntry = formData.get('file')
    const file = fileEntry instanceof File ? fileEntry : null
    const fileError = validateCSVFile(file)
    if (fileError) {
      return Response.json({ success: false, error: fileError }, { status: 400 })
    }

    const fileBytes = await (file as File).arrayBuffer()
    const fileBlob = new Blob([fileBytes], { type: 'text/csv' })

    const proxyForm = new FormData()
    proxyForm.append('file', fileBlob, (file as File).name)

    for (const key of ['correlations', 'chunk_size', 'nbins', 'top_frequency', 'verify', 'cache']) {
      const raw = formData.get(key)
      if (raw && typeof raw === 'string') {
        proxyForm.append(key, raw)
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const res = await fetch(`${PYTHON_BACKEND}/jobs/profile`, {
      method: 'POST',
      body: proxyForm,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      let errDetail = `Python backend error (${res.status})`
      try {
        const errJSON = JSON.parse(errText)
        errDetail = errJSON.detail ?? errDetail
      } catch {
        errDetail = errText.slice(0, 200) || errDetail
      }
      return Response.json({ success: false, error: errDetail }, { status: res.status })
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
    if (msg.includes('aborted')) {
      return Response.json({ success: false, error: 'Job submission timed out.' }, { status: 504 })
    }
    return Response.json(toErrorResponse(err), { status: 500 })
  }
}
