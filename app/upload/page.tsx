'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useStatLab } from '@/components/StatLabProvider'
import { useAuth } from '@/components/AuthProvider'
import { Logo } from '@/components/ui/Logo'
import { analyzeFile, type FilePreview } from '@/lib/preview/analyze'
import { ChunkedUploader, type UploadProgress } from '@/lib/upload/chunker'
import { CHUNK_SIZE } from '@/lib/upload/shared'
import { PreviewPanel } from '@/components/upload/PreviewPanel'
import { ProgressStages } from '@/components/upload/ProgressStages'
import type { DatasetSchema, AnalysisRequest, Column } from '@/lib/types'

const PIPELINE_LABELS = {
  idle: '',
  parsing: 'Parsing file…',
  profiling: 'AI is profiling your dataset…',
  analysing: 'Running statistical computations…',
  interpreting: 'Generating AI interpretation…',
  done: 'Done',
  error: 'Error',
}

type UploadStatus = 'idle' | 'hashing' | 'uploading' | 'verifying' | 'paused' | 'done' | 'error' | 'cancelled'

interface UploadUiState {
  status: UploadStatus
  percent: number
  bytesUploaded: number
  totalBytes: number
  error?: string
  deduplicated?: boolean
}

interface InProgressUpload {
  id: string
  fileName: string
  fileSizeBytes: number
  totalChunks: number
  receivedChunks: number[]
}

export default function UploadPage() {
  const router = useRouter()
  const { user, logout } = useAuth()

  const {
    file, setFile,
    schema, setSchema,
    mode, setMode,
    setManualRequest,
    pipelineStatus, pipelineError,
    setPipelineStatus, setPipelineError,
    memoryProgress,
    setUploadedDatasetId,
    submit,
  } = useStatLab()

  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [parsing, setParsing] = useState(false)
  const [uploadState, setUploadState] = useState<UploadUiState>({ status: 'idle', percent: 0, bytesUploaded: 0, totalBytes: 0 })
  const [inProgressUploads, setInProgressUploads] = useState<InProgressUpload[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const uploaderRef = useRef<ChunkedUploader | null>(null)
  const uploadSeqRef = useRef(0)

  // Resume support: restore any in-progress uploads from a previous page visit.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/uploads', { credentials: 'same-origin' })
        const data = await res.json()
        if (data?.success) setInProgressUploads(data.uploads ?? [])
      } catch {
        // Non-fatal.
      }
    })()
  }, [])

  const startUpload = useCallback(async (f: File) => {
    const seq = ++uploadSeqRef.current
    // Resume an interrupted session for the same file if one exists.
    const match = inProgressUploads.find(
      (u) => u.fileName === f.name && Math.abs(u.fileSizeBytes - f.size) < 1024,
    )
    const resumeInfo = match
      ? { uploadId: match.id, receivedChunks: match.receivedChunks, totalChunks: match.totalChunks }
      : null

    setUploadedDatasetId(null)
    setUploadState({ status: 'hashing', percent: 0, bytesUploaded: 0, totalBytes: f.size })

    const uploader = new ChunkedUploader(f, CHUNK_SIZE, resumeInfo)
    uploaderRef.current = uploader
    try {
      const result = await uploader.run((p: UploadProgress) => {
        if (seq !== uploadSeqRef.current) return
        setUploadState({
          status: p.stage === 'completed' ? 'done' : p.stage === 'verifying' ? 'verifying' : p.stage,
          percent: p.percent,
          bytesUploaded: p.bytesUploaded,
          totalBytes: p.totalBytes,
          error: p.error,
        })
      })
      if (seq !== uploadSeqRef.current) return
      setUploadedDatasetId(result.datasetId)
      setUploadState({
        status: 'done',
        percent: 1,
        bytesUploaded: f.size,
        totalBytes: f.size,
        deduplicated: result.deduplicated,
      })
      uploaderRef.current = null
    } catch (err) {
      if (seq !== uploadSeqRef.current) return
      const isCancelled = err instanceof Error && err.message === 'Upload cancelled'
      setUploadState({
        status: isCancelled ? 'cancelled' : 'error',
        percent: 0,
        bytesUploaded: 0,
        totalBytes: f.size,
        error: isCancelled ? undefined : err instanceof Error ? err.message : 'Upload failed',
      })
      uploaderRef.current = null
    }
  }, [inProgressUploads, setUploadedDatasetId])

  const togglePause = useCallback(() => {
    const u = uploaderRef.current
    if (!u) return
    if (u.isPaused) {
      u.resume()
      setUploadState((s) => ({ ...s, status: 'uploading', error: undefined }))
    } else {
      u.pause()
      setUploadState((s) => ({ ...s, status: 'paused' }))
    }
  }, [])

  const cancelUpload = useCallback(async () => {
    const u = uploaderRef.current
    uploaderRef.current = null
    uploadSeqRef.current++ // invalidate the in-flight upload's state updates
    if (u) await u.cancelRemote()
    setUploadedDatasetId(null)
    setUploadState({ status: 'idle', percent: 0, bytesUploaded: 0, totalBytes: 0 })
  }, [setUploadedDatasetId])

  const parseFile = useCallback(async (f: File) => {
    setFile(f)
    setParsing(true)
    // Re-upload: discard any upload in progress for the previous file.
    const prev = uploaderRef.current
    uploaderRef.current = null
    uploadSeqRef.current++
    if (prev) void prev.cancelRemote()
    setUploadedDatasetId(null)
    setUploadState({ status: 'idle', percent: 0, bytesUploaded: 0, totalBytes: 0 })
    try {
      // Client-side instant analysis: encoding, delimiter, columns, missing
      // values, duplicates, numeric summaries, compression estimate.
      const p = await analyzeFile(f)
      setPreview(p)
      setSchema({
        fileName: p.fileName,
        rowCount: p.estimatedRowCount,
        columnCount: p.columnCount,
        columns: p.columns,
        sampleRows: p.sampleRows,
        duplicateRowCount: Math.round(p.duplicateEstimate.ratio * p.estimatedRowCount),
      })
      // Store the dataset through the chunked pipeline while the user configures.
      void startUpload(f)
    } catch (err) {
      setPreview(null)
      setSchema(null)
      setPipelineError(err instanceof Error ? err.message : 'Could not read this file.')
      setPipelineStatus('error')
    } finally {
      setParsing(false)
    }
  }, [setFile, setSchema, setPipelineError, setPipelineStatus, setUploadedDatasetId, startUpload])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) parseFile(f)
  }, [parseFile])

  const handleSubmit = useCallback(async () => {
    const session = await submit()
    if (session) {
      router.push('/analyse')
    }
  }, [submit, router])

  const isRunning = ['parsing', 'profiling', 'analysing', 'interpreting'].includes(pipelineStatus)

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 selection:bg-emerald-500/20 antialiased">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between bg-zinc-900/80 backdrop-blur-md sticky top-0 z-50 shadow-sm">
        <Link href="/" aria-label="StatLab home">
          <Logo subtitle="New analysis" />
        </Link>
        <div className="flex items-center gap-2.5">
          <Link
            href="/dashboard"
            className="hidden sm:inline-flex px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            Dashboard
          </Link>
          {user && (
            <div className="flex items-center gap-2">
              <span className="hidden md:inline-flex items-center gap-2 text-xs text-zinc-400">
                <span className="w-6 h-6 rounded-full bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 flex items-center justify-center text-[11px] font-bold uppercase">
                  {user.name.slice(0, 1)}
                </span>
                {user.name.split(' ')[0]}
              </span>
              <button
                onClick={() => logout()}
                className="px-3 py-2 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16 space-y-12">
        <div className="space-y-2.5">
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Upload a dataset.{' '}
            <span className="text-emerald-400 font-semibold">Get instant insights.</span>
          </h1>
          <p className="text-zinc-400 text-sm max-w-lg leading-relaxed">
            Drop a CSV or Excel file, choose your analysis mode, and StatLab will compute
            descriptive stats, correlations, regressions, and AI interpretations — and save them
            to your workspace memory.
          </p>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`relative cursor-pointer rounded-xl border border-dashed transition-all p-12 flex flex-col items-center gap-3 text-center
            ${dragging ? 'border-emerald-500 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-900/50 hover:border-emerald-500/50 hover:bg-zinc-900 shadow-sm'}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,.json,.xlsx,.xls,.zip"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void parseFile(f)
            }}
          />
          <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-emerald-400 shadow-sm">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          {parsing ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <div className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              Analyzing file…
            </div>
          ) : file ? (
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-emerald-400">{file.name}</p>
              <p className="text-xs text-zinc-500">
                {preview?.columnCount ?? 0} columns · ~{(preview?.estimatedRowCount ?? 0).toLocaleString()} rows · click to replace
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-zinc-200">Drop your dataset here</p>
              <p className="text-xs text-zinc-500">CSV · TSV · Excel · JSON · ZIP — or click to browse</p>
            </div>
          )}
        </div>

        {preview && (
          <PreviewPanel preview={preview} />
        )}

        {preview && uploadState.status !== 'idle' && (
          <UploadProgressCard
            state={uploadState}
            onPause={togglePause}
            onCancel={cancelUpload}
            onRetry={() => file && startUpload(file)}
          />
        )}

        {preview && (
          <div className="space-y-3">
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">Analysis Mode</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(['smart', 'manual'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    mode === m
                      ? 'border-emerald-500 bg-zinc-900 ring-1 ring-emerald-500 shadow-sm'
                      : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
                      mode === m ? 'border-emerald-500' : 'border-zinc-700'
                    }`}>
                      {mode === m && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${mode === m ? 'text-emerald-400' : 'text-zinc-100'}`}>{m === 'smart' ? 'Smart Analyse' : 'Manual Mode'}</p>
                      <p className="text-xs text-zinc-400 mt-0.5 leading-normal">
                        {m === 'smart'
                          ? 'AI selects optimal analyses and charts automatically.'
                          : 'Configure columns, tests, and metrics manually.'}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {schema && mode === 'manual' && (
          <ManualConfig key={schema.fileName} schema={schema} onChange={setManualRequest} />
        )}

        {(isRunning || memoryProgress) && (
          <ProgressStages pipelineStatus={pipelineStatus} memoryProgress={memoryProgress} />
        )}

        {pipelineStatus === 'error' && pipelineError && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3">
            <p className="text-xs font-medium text-red-600">{pipelineError}</p>
          </div>
        )}

        {schema && (
          <button
            onClick={handleSubmit}
            disabled={isRunning || !file}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-20 text-zinc-950 text-sm font-semibold transition-all shadow-md active:scale-[0.995]"
          >
            {isRunning ? PIPELINE_LABELS[pipelineStatus] : mode === 'smart' ? 'Run Smart Analysis' : 'Run Analysis'}
          </button>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upload progress card — shows the chunked pipeline storing the dataset while
// the user configures the analysis. Supports pause/resume/cancel and reports
// deduplication (identical file already in the workspace).
// ---------------------------------------------------------------------------
function UploadProgressCard({
  state,
  onPause,
  onCancel,
  onRetry,
}: {
  state: UploadUiState
  onPause: () => void
  onCancel: () => void
  onRetry: () => void
}) {
  if (state.status === 'done') {
    return (
      <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 px-4 py-3 flex items-center gap-3">
        <span className="w-5 h-5 rounded-full bg-emerald-500 text-zinc-950 flex items-center justify-center">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <div className="text-xs">
          <span className="font-semibold text-emerald-300">Stored to workspace storage.</span>
          {state.deduplicated && (
            <span className="ml-2 text-zinc-400">This exact file was already uploaded — reusing it.</span>
          )}
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 flex items-center gap-3">
        <div className="flex-1 text-xs text-red-400">
          Upload failed: {state.error ?? 'Unknown error'}
        </div>
        <button onClick={onRetry} className="text-xs font-semibold text-red-300 hover:text-red-200">
          Retry
        </button>
        <button onClick={onCancel} className="text-xs text-zinc-400 hover:text-zinc-200">
          Cancel
        </button>
      </div>
    )
  }

  const active = state.status === 'hashing' || state.status === 'uploading' || state.status === 'verifying'
  const pct = Math.round(state.percent * 100)
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3.5 space-y-2.5">
      <div className="flex items-center gap-3">
        {active && <div className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
        <div className="flex-1 text-xs font-medium text-zinc-300">
          {state.status === 'hashing' && 'Preparing upload…'}
          {state.status === 'uploading' && `Uploading… ${pct}%`}
          {state.status === 'verifying' && 'Verifying checksum…'}
          {state.status === 'paused' && 'Upload paused'}
        </div>
        {state.status === 'uploading' && state.totalBytes > 0 && (
          <span className="text-[11px] font-mono text-zinc-500">
            {fmtUploadBytes(state.bytesUploaded)} / {fmtUploadBytes(state.totalBytes)}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onPause}
            className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
          >
            {state.status === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={onCancel}
            className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-zinc-800 hover:bg-red-950/50 text-zinc-300 hover:text-red-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function fmtUploadBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// Manual Configuration Block Component
// ---------------------------------------------------------------------------
function ManualConfig({
  schema,
  onChange,
}: {
  schema: DatasetSchema
  onChange: (v: Partial<AnalysisRequest>) => void
}) {
  const cols = schema.columns
  const numericCols = cols.filter((c: Column) => c.type === 'continuous')

  const [descriptiveCols, setDescriptiveCols] = useState<string[]>([])
  const [corrA, setCorrA] = useState('')
  const [corrB, setCorrB] = useState('')
  const [corrPairs, setCorrPairs] = useState<[string, string][]>([])
  const [dependent, setDependent] = useState('')
  const [predictors, setPredictors] = useState<string[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [mtEnabled, setMtEnabled] = useState(false)
  const [mtMethod, setMtMethod] = useState('random')
  const [mtIterations, setMtIterations] = useState(15)
  const [mtFolds, setMtFolds] = useState(5)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    if (dependent && predictors.length >= 1) {
      const predTypes = predictors.map((p: string) => cols.find((c: Column) => c.name === p)?.type)
      const hasContinuous = predTypes.some(t => t === 'continuous')
      const hasCategorical = predTypes.some(t => t === 'categorical' || t === 'binary')
      if (hasContinuous && hasCategorical) {
        showToast('Mixed column types for prediction — categorical predictors will be one-hot encoded.')
      }
    }
  }, [dependent, predictors, cols])

  useEffect(() => {
    onChange({
      mode: 'manual',
      descriptive: descriptiveCols.length > 0 ? {
        columns: descriptiveCols,
        measures: ['central', 'spread', 'distribution'],
      } : undefined,
      inferential: corrPairs.length > 0 || dependent ? {
        correlationPairs: corrPairs,
        regression: dependent ? { dependent, predictors } : undefined,
      } : undefined,
      predictive: dependent ? {
        dependent,
        predictors,
      } : undefined,
      modelTraining: mtEnabled ? {
        enabled: true,
        tuningMethod: mtMethod,
        tuningIterations: mtIterations,
        cvFolds: mtFolds,
      } : undefined,
    })
  }, [descriptiveCols, corrPairs, dependent, predictors, onChange, mtEnabled, mtMethod, mtIterations, mtFolds])

  const addPair = () => {
    if (corrA && corrB && corrA !== corrB) {
      const pairExists = corrPairs.some(p => (p[0] === corrA && p[1] === corrB) || (p[0] === corrB && p[1] === corrA))
      if (!pairExists) setCorrPairs(prev => [...prev, [corrA, corrB]])
      setCorrA('')
      setCorrB('')
    }
  }

  return (
    <div className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 shadow-sm relative">
      {toast && (
        <div className="absolute top-3 right-3 left-3 z-10 rounded-lg bg-amber-950/90 border border-amber-800/50 px-4 py-2.5 text-xs text-amber-400 shadow-lg animate-in fade-in slide-in-from-top-1">
          {toast}
        </div>
      )}
      <p className="text-xs font-semibold text-zinc-300">Manual Configuration</p>

      <div className="space-y-1.5">
        <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Descriptive Columns</label>
        <div className="flex flex-wrap gap-1.5">
          {cols.map((col: Column) => {
            const isSelected = descriptiveCols.includes(col.name)
            return (
              <button
                key={col.name}
                type="button"
                onClick={() => setDescriptiveCols(p => isSelected ? p.filter(c => c !== col.name) : [...p, col.name])}
                className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors border ${
                  isSelected
                    ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                {col.name}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Correlation Pairs</label>
        <div className="flex gap-2">
          <select value={corrA} onChange={e => setCorrA(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-700">
            <option value="">Column A</option>
            {numericCols.map((c: Column) => <option key={c.name} value={c.name} className="bg-zinc-900">{c.name}</option>)}
          </select>
          <select value={corrB} onChange={e => setCorrB(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-700">
            <option value="">Column B</option>
            {numericCols.map((c: Column) => <option key={c.name} value={c.name} className="bg-zinc-900">{c.name}</option>)}
          </select>
          <button type="button" onClick={addPair} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs text-zinc-950 font-semibold transition-colors shadow-sm">Add</button>
        </div>
        {corrPairs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {corrPairs.map((pair, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-mono">
                {pair[0]} ↔ {pair[1]}
                <button type="button" onClick={() => setCorrPairs(p => p.filter((_, j) => j !== i))} className="ml-1 text-zinc-500 hover:text-zinc-200">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Regression Target</label>
        <select value={dependent} onChange={e => { setDependent(e.target.value); setPredictors([]) }} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-700">
          <option value="">None</option>
          {cols.map((c: Column) => <option key={c.name} value={c.name} className="bg-zinc-900">{c.name}</option>)}
        </select>
        {dependent && (
          <div className="mt-2.5 space-y-1.5">
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Predictors</p>
            <div className="flex flex-wrap gap-1.5">
              {cols.filter((c: Column) => c.name !== dependent).map((col: Column) => {
                const isPred = predictors.includes(col.name)
                return (
                  <button
                    key={col.name}
                    type="button"
                    onClick={() => setPredictors(p => isPred ? p.filter(c => c !== col.name) : [...p, col.name])}
                    className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors border ${
                      isPred
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    }`}
                  >
                    {col.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {dependent && predictors.length > 0 && (
        <div className="space-y-3 pt-3 border-t border-zinc-800">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">ML Model Training</label>
              <p className="text-[11px] text-zinc-500 mt-0.5">Train, tune &amp; compare multiple algorithms</p>
            </div>
            <button
              type="button"
              onClick={() => setMtEnabled(p => !p)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                mtEnabled ? 'bg-emerald-600' : 'bg-zinc-700'
              }`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                mtEnabled ? 'translate-x-5' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {mtEnabled && (
            <div className="grid grid-cols-3 gap-3 pl-1">
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Tuning</label>
                <select value={mtMethod} onChange={e => setMtMethod(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-700">
                  <option value="none">None</option>
                  <option value="random">Random Search</option>
                  <option value="grid">Grid Search</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Iterations</label>
                <input type="number" value={mtIterations} min={1} max={50}
                  onChange={e => setMtIterations(Number(e.target.value) || 15)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-700" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">CV Folds</label>
                <input type="number" value={mtFolds} min={2} max={10}
                  onChange={e => setMtFolds(Number(e.target.value) || 5)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-zinc-700" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
