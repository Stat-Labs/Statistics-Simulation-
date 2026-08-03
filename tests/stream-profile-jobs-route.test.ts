import { describe, it, expect, beforeEach, vi } from 'vitest'

const loadJobsRoute = () => import('../app/api/stream-profile/jobs/route')
const loadJobPollRoute = () => import('../app/api/stream-profile/jobs/[id]/route')

const makeJobsRequest = async (name = 'data.csv') => {
  const { NextRequest } = await import('next/server')
  const file = new File(['a,b\n1,2\n'], name, { type: 'text/csv' })
  const form = new FormData()
  form.append('file', file)
  form.append('verify', 'true')
  return new NextRequest('http://localhost/api/stream-profile/jobs', {
    method: 'POST',
    body: form,
  })
}

const jobResponse = {
  jobId: 'job-abc',
  kind: 'profile',
  status: 'queued',
  progress: 0,
  stage: 'queued',
  message: null,
  createdAt: 1710000000000,
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
}

describe('POST /api/stream-profile/jobs', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('submits a profile job and returns the job descriptor', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(jobResponse),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadJobsRoute()
    const res = await POST(await makeJobsRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.jobId).toBe('job-abc')
    expect(body.status).toBe('queued')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/jobs/profile')
    expect(init.method).toBe('POST')
    const forwarded = init.body as FormData
    expect(forwarded.get('verify')).toBe('true')
  })

  it('returns 502 when the Python backend is not running', async () => {
    const err = new Error('fetch failed')
    ;(err as { cause?: unknown }).cause = { code: 'ECONNREFUSED' }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err))

    const { POST } = await loadJobsRoute()
    const res = await POST(await makeJobsRequest())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/not running/i)
  })

  it('propagates backend error details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ detail: 'internal error' }),
      }),
    )

    const { POST } = await loadJobsRoute()
    const res = await POST(await makeJobsRequest())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('internal error')
  })
})

describe('GET /api/stream-profile/jobs/[id]', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('polls a job and returns its current status', async () => {
    const running = {
      ...jobResponse,
      status: 'running',
      progress: 0.5,
      stage: 'pass 2',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(running),
      }),
    )

    const { GET } = await loadJobPollRoute()
    const { NextRequest } = await import('next/server')
    const req = new NextRequest('http://localhost/api/stream-profile/jobs/job-abc')
    const res = await GET(req, { params: { id: 'job-abc' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('running')
    expect(body.progress).toBe(0.5)
    expect(body.stage).toBe('pass 2')
  })

  it('maps a missing job to 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ detail: 'job not found' }),
      }),
    )

    const { GET } = await loadJobPollRoute()
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/api/stream-profile/jobs/nope'), {
      params: { id: 'nope' },
    })
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })

  it('returns 502 when the Python backend is not running', async () => {
    const err = new Error('fetch failed')
    ;(err as { cause?: unknown }).cause = { code: 'ECONNREFUSED' }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err))

    const { GET } = await loadJobPollRoute()
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/api/stream-profile/jobs/job-abc'), {
      params: { id: 'job-abc' },
    })
    expect(res.status).toBe(502)
  })
})
