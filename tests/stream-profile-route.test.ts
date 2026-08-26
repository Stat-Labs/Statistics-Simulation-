import { describe, it, expect, beforeEach, vi } from 'vitest'

// Route handlers must be imported lazily so the global fetch stub is in place
// before the module-scope default backend URL is resolved (it isn't, but
// keeping the pattern consistent avoids surprises if PYTHON_BACKEND_URL is set).
const loadRoute = () => import('../app/api/stream-profile/route')

const makeCSVRequest = async (name = 'data.csv') => {
  const { NextRequest } = await import('next/server')
  const file = new File(['a,b\n1,2\n3,4\n'], name, {
    type: name.toLowerCase().endsWith('.csv') ? 'text/csv' : '',
  })
  const form = new FormData()
  form.append('file', file)
  form.append('nbins', '10')
  form.append('top_frequency', '5')
  return new NextRequest('http://localhost/api/stream-profile', {
    method: 'POST',
    body: form,
  })
}

describe('POST /api/stream-profile proxy', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects requests with no file', async () => {
    const { POST } = await loadRoute()
    const { NextRequest } = await import('next/server')
    const empty = new NextRequest('http://localhost/api/stream-profile', {
      method: 'POST',
      body: new FormData(),
    })
    const res = await POST(empty)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/no file/i)
  })

  it('rejects non-CSV files', async () => {
    const { POST } = await loadRoute()
    const req = await makeCSVRequest('notes.txt')
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/must be a CSV or Excel/i)
  })

  it('forwards a valid profile request to the Python backend', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, fileName: 'data.csv', rowCount: 2 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await loadRoute()
    const res = await POST(await makeCSVRequest())

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.rowCount).toBe(2)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:8000/profile')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('returns 502 when the Python backend is not running', async () => {
    const err = new Error('fetch failed')
    ;(err as { cause?: unknown }).cause = { code: 'ECONNREFUSED' }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err))

    const { POST } = await loadRoute()
    const res = await POST(await makeCSVRequest())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/not running/i)
  })

  it('propagates backend error details with status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => JSON.stringify({ detail: 'chunk_size must be positive' }),
      }),
    )

    const { POST } = await loadRoute()
    const res = await POST(await makeCSVRequest())
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('chunk_size must be positive')
  })
})
