'use client'

import { CHUNK_SIZE } from './shared'

export type UploadStage =
  | 'hashing'
  | 'uploading'
  | 'verifying'
  | 'completed'
  | 'cancelled'
  | 'error'

export interface UploadProgress {
  stage: UploadStage
  bytesUploaded: number
  totalBytes: number
  chunkIndex: number
  totalChunks: number
  percent: number
  error?: string
}

export interface UploadResult {
  datasetId: string
  deduplicated: boolean
}

export interface ResumeInfo {
  uploadId: string
  receivedChunks: number[]
  totalChunks: number
}

export function sha256Hex(data: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest('SHA-256', data).then((digest) => {
    const bytes = new Uint8Array(digest)
    let hex = ''
    for (const b of bytes) hex += b.toString(16).padStart(2, '0')
    return hex
  })
}

/**
 * Client-side chunked uploader.
 *
 * Slices the file into ~2 MB chunks, uploads each independently (so retries
 * only resend failed chunks), supports pause/resume/cancel, and completes the
 * upload once every chunk is stored. Each chunk carries its own SHA-256 in the
 * start request and the server verifies the merged file checksum.
 */
export class ChunkedUploader {
  private file: File
  private chunkSize: number
  private uploadId: string | null = null
  private totalChunks = 0
  private received = new Set<number>()
  private aborted = false
  private pausedFlag = false
  private resumeWaiters: (() => void)[] = []
  private retries = 3
  private resumeInfo: ResumeInfo | null

  constructor(file: File, chunkSize = CHUNK_SIZE, resume: ResumeInfo | null = null) {
    this.file = file
    this.chunkSize = chunkSize
    this.totalChunks = Math.max(1, Math.ceil(file.size / chunkSize))
    this.resumeInfo = resume
  }

  get sessionId(): string | null {
    return this.uploadId
  }

  pause() {
    this.pausedFlag = true
  }

  resume() {
    this.pausedFlag = false
    this.resumeWaiters.forEach((w) => w())
    this.resumeWaiters = []
  }

  cancel() {
    this.aborted = true
    this.resume()
  }

  /**
   * Aborts locally and asks the server to discard the partial upload
   * (chunks + upload row). Fire-and-forget on the network side.
   */
  async cancelRemote(): Promise<void> {
    this.cancel()
    if (!this.uploadId) return
    try {
      await fetch(`/api/uploads/${this.uploadId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
    } catch {
      // Local abort is enough — the server cleans up abandoned sessions lazily.
    }
  }

  get isPaused() {
    return this.pausedFlag
  }

  private async waitIfPaused() {
    while (this.pausedFlag && !this.aborted) {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve))
    }
    if (this.aborted) throw new Error('Upload cancelled')
  }

  async run(onProgress: (p: UploadProgress) => void): Promise<UploadResult> {
    try {
      // Resuming an existing session skips hashing + the start request entirely.
      if (this.resumeInfo) {
        this.uploadId = this.resumeInfo.uploadId
        this.totalChunks = this.resumeInfo.totalChunks || this.totalChunks
        this.received = new Set<number>(this.resumeInfo.receivedChunks ?? [])
      } else {
        // 1. Hash the full file (used for server-side dedupe + integrity check).
        onProgress({
          stage: 'hashing',
          bytesUploaded: 0,
          totalBytes: this.file.size,
          chunkIndex: 0,
          totalChunks: this.totalChunks,
          percent: 0,
        })
        const fileSha = await sha256Hex(await this.file.arrayBuffer())
        await this.waitIfPaused()

        // 2. Start the upload session.
        const startRes = await fetch('/api/uploads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: this.file.name,
            sizeBytes: this.file.size,
            sha256: fileSha,
            fileType: this.file.type || undefined,
            chunkSize: this.chunkSize,
          }),
          credentials: 'same-origin',
        })
        const startData = await startRes.json()
        if (!startData?.success) throw new Error(startData?.error ?? 'Could not start upload')
        this.uploadId = startData.upload.id
        this.totalChunks = startData.upload.totalChunks
        if (startData.upload.receivedChunks) {
          this.received = new Set<number>(startData.upload.receivedChunks)
        }
      }

      // 3. Upload each chunk (resume skips already-received chunks).
      onProgress({
        stage: 'uploading',
        bytesUploaded: this.received.size * this.chunkSize,
        totalBytes: this.file.size,
        chunkIndex: this.received.size,
        totalChunks: this.totalChunks,
        percent: this.file.size ? (this.received.size * this.chunkSize) / this.file.size : 0,
      })

      let bytesUploaded = this.received.size * this.chunkSize
      for (let i = 0; i < this.totalChunks; i++) {
        if (this.received.has(i)) continue
        await this.waitIfPaused()
        const start = i * this.chunkSize
        const chunk = this.file.slice(start, Math.min(start + this.chunkSize, this.file.size))
        await this.uploadChunk(i, chunk, onProgress)
        bytesUploaded += chunk.size
        this.received.add(i)
        onProgress({
          stage: 'uploading',
          bytesUploaded,
          totalBytes: this.file.size,
          chunkIndex: i,
          totalChunks: this.totalChunks,
          percent: this.file.size ? bytesUploaded / this.file.size : 0,
        })
      }

      // 4. Verify + merge server-side.
      onProgress({
        stage: 'verifying',
        bytesUploaded: this.file.size,
        totalBytes: this.file.size,
        chunkIndex: this.totalChunks,
        totalChunks: this.totalChunks,
        percent: 1,
      })
      const completeForm = new FormData()
      const completeRes = await fetch(`/api/uploads/${this.uploadId}/complete`, {
        method: 'POST',
        body: completeForm,
        credentials: 'same-origin',
      })
      const completeData = await completeRes.json()
      if (!completeRes.ok || !completeData?.success) {
        throw new Error(completeData?.error ?? 'Could not finalize upload')
      }

      onProgress({
        stage: 'completed',
        bytesUploaded: this.file.size,
        totalBytes: this.file.size,
        chunkIndex: this.totalChunks,
        totalChunks: this.totalChunks,
        percent: 1,
      })

      return {
        datasetId: completeData.dataset.id,
        deduplicated: Boolean(completeData.dataset.deduplicated),
      }
    } catch (err) {
      if (this.aborted) {
        onProgress({
          stage: 'cancelled',
          bytesUploaded: 0,
          totalBytes: this.file.size,
          chunkIndex: 0,
          totalChunks: this.totalChunks,
          percent: 0,
        })
        throw new Error('Upload cancelled')
      }
      const msg = err instanceof Error ? err.message : 'Upload failed'
      onProgress({
        stage: 'error',
        bytesUploaded: 0,
        totalBytes: this.file.size,
        chunkIndex: 0,
        totalChunks: this.totalChunks,
        percent: 0,
        error: msg,
      })
      throw err
    }
  }

  private async uploadChunk(
    index: number,
    chunk: Blob,
    onProgress: (p: UploadProgress) => void,
  ) {
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      await this.waitIfPaused()
      try {
        const form = new FormData()
        form.append('index', String(index))
        form.append('data', chunk, `chunk-${index}`)
        const res = await fetch(`/api/uploads/${this.uploadId}/chunks`, {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
        })
        const data = await res.json()
        if (!res.ok || !data?.success) {
          throw new Error(data?.error ?? `Chunk ${index} failed`)
        }
        return
      } catch (err) {
        if (this.aborted) throw err
        const msg = err instanceof Error ? err.message : 'Chunk failed'
        onProgress({
          stage: 'uploading',
          bytesUploaded: 0,
          totalBytes: this.file.size,
          chunkIndex: index,
          totalChunks: this.totalChunks,
          percent: 0,
          error: attempt < this.retries ? undefined : msg,
        })
        if (attempt < this.retries) {
          await new Promise((r) => setTimeout(r, 400 * attempt))
        }
      }
    }
    throw new Error(`Chunk ${index} failed after ${this.retries} attempts`)
  }
}
