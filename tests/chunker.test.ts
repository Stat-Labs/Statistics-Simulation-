import { describe, it, expect, vi, afterEach } from 'vitest'
import { ChunkedUploader } from '@/lib/upload/chunker'

type Call = { method: string; url: string }

function makeFetchMock() {
  const calls: Call[] = []
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url })
    let payload: Record<string, unknown>
    if (method === 'POST' && url === '/api/uploads') {
      payload = { success: true, upload: { id: 'up-1', totalChunks: 1, receivedChunks: [] } }
    } else if (method === 'POST' && url.endsWith('/chunks')) {
      payload = { success: true }
    } else if (method === 'POST' && url.endsWith('/complete')) {
      payload = { success: true, dataset: { id: 'ds-1', deduplicated: false } }
    } else if (method === 'DELETE') {
      payload = { success: true }
    } else {
      payload = { success: false, error: 'unexpected request' }
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { calls, fetchImpl }
}

function tinyFile(): File {
  return new File(['a,b\n1,2\n'], 'data.csv', { type: 'text/csv' })
}

describe('ChunkedUploader', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts a new session and completes it', async () => {
    const { calls, fetchImpl } = makeFetchMock()
    vi.stubGlobal('fetch', fetchImpl)

    const uploader = new ChunkedUploader(tinyFile())
    const result = await uploader.run(() => {})

    expect(result.datasetId).toBe('ds-1')
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/uploads')).toBe(true)
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/chunks'))).toBe(true)
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/complete'))).toBe(true)
  })

  it('resumes an existing session and skips the start request', async () => {
    const { calls, fetchImpl } = makeFetchMock()
    vi.stubGlobal('fetch', fetchImpl)

    // All chunks already received → straight to verification/complete.
    const uploader = new ChunkedUploader(tinyFile(), 2 * 1024 * 1024, {
      uploadId: 'up-1',
      receivedChunks: [0],
      totalChunks: 1,
    })
    const result = await uploader.run(() => {})

    expect(result.datasetId).toBe('ds-1')
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/uploads')).toBe(false)
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/complete'))).toBe(true)
  })

  it('cancelRemote aborts the run and notifies the server', async () => {
    const { calls, fetchImpl } = makeFetchMock()
    vi.stubGlobal('fetch', fetchImpl)

    // One missing chunk + paused at selection point so run() blocks at waitIfPaused.
    const uploader = new ChunkedUploader(tinyFile(), 2 * 1024 * 1024, {
      uploadId: 'up-1',
      receivedChunks: [],
      totalChunks: 1,
    })
    uploader.pause()
    const runPromise = uploader.run(() => {})
    await new Promise((r) => setTimeout(r, 20))
    await uploader.cancelRemote()

    await expect(runPromise).rejects.toThrow('Upload cancelled')
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/uploads/up-1')).toBe(true)
  })
})
