import { describe, it, expect, beforeEach, vi } from 'vitest'

const loadRoute = () => import('../app/api/visualize/route')

const makeVisualizeRequest = async (name = 'data.csv') => {
  const { NextRequest } = await import('next/server')
  const file = new File(['a,b\n1,2\n3,4\n'], name, { type: 'text/csv' })
  const form = new FormData()
  form.append('file', file)
  return new NextRequest('http://localhost/api/visualize', {
    method: 'POST',
    body: form,
  })
}

describe('POST /api/visualize proxy', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects requests with no file', async () => {
    const { POST } = await loadRoute()
    const { NextRequest } = await import('next/server')
    const empty = new NextRequest('http://localhost/api/visualize', {
      method: 'POST',
      body: new FormData(),
    })
    const res = await POST(empty)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no file/i)
  })

  it('forwards a valid request to the FastAPI /visualize endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          engine: 'vie-1.0.0',
          fileName: 'data.csv',
          rowCount: 2,
          columnCount: 2,
          detectedPatterns: [],
          intents: [],
          sections: [],
        }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(await makeVisualizeRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.engine).toBe('vie-1.0.0')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/visualize')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('returns 502 when the Python backend is not running', async () => {
    const err = new Error('fetch failed')
    ;(err as { cause?: unknown }).cause = { code: 'ECONNREFUSED' }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err))

    const { POST } = await loadRoute()
    const res = await POST(await makeVisualizeRequest())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/not running/i)
  })

  it('propagates backend error details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({ detail: 'bad correlations' }),
      }),
    )

    const { POST } = await loadRoute()
    const res = await POST(await makeVisualizeRequest())
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('bad correlations')
  })
})
