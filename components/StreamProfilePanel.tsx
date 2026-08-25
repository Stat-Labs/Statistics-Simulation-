'use client'

import { useState } from 'react'
import type {
  StreamProfileResponse,
  ReproducibilityManifest,
  VerificationReport,
  ProfileJobResponse,
} from '@/lib/types'

type ProfileState = {
  status: 'idle' | 'loading' | 'done' | 'error'
  data?: StreamProfileResponse
  error?: string
  jobId?: string
  progress?: number
  stage?: string
}

const POLL_INTERVAL_MS = 700
const MAX_POLLS = 900 // ~10 minutes before giving up

/**
 * Runs the Python streaming profiler on the uploaded file and renders the
 * full-population profile plus the reproducibility manifest, the verification
 * report (when enabled), and the cache-hit status. Long profiles run on the
 * backend worker: this panel submits a job and polls it for progress.
 */
export function StreamProfilePanel({ file }: { file: File | null }) {
  const [state, setState] = useState<ProfileState>({ status: 'idle' })
  const [verify, setVerify] = useState(false)

  const runProfile = async () => {
    if (!file) return
    setState({ status: 'loading', progress: 0, stage: 'queued' })
    try {
      const form = new FormData()
      form.append('file', file)
      if (verify) form.append('verify', 'true')

      const submitRes = await fetch('/api/stream-profile/jobs', { method: 'POST', body: form })
      const job = (await submitRes.json()) as ProfileJobResponse & { success?: boolean; error?: string }
      if (!submitRes.ok || !job.jobId) {
        setState({ status: 'error', error: job.error ?? `Job submission failed (${submitRes.status})` })
        return
      }

      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
        const pollRes = await fetch(`/api/stream-profile/jobs/${job.jobId}`)
        const poll = (await pollRes.json()) as ProfileJobResponse & { success?: boolean; error?: string }
        if (!pollRes.ok) {
          setState({ status: 'error', error: poll.error ?? `Poll failed (${pollRes.status})` })
          return
        }
        setState({
          status: 'loading',
          jobId: job.jobId,
          progress: poll.progress ?? 0,
          stage: poll.stage,
        })
        if (poll.status === 'succeeded') {
          if (poll.result && poll.result.success === false) {
            setState({ status: 'error', error: poll.result.error ?? 'Profile failed' })
          } else if (poll.result) {
            setState({ status: 'done', data: poll.result })
          } else {
            setState({ status: 'error', error: 'Profile finished without a result' })
          }
          return
        }
        if (poll.status === 'failed') {
          setState({ status: 'error', error: poll.error ?? 'Profile job failed' })
          return
        }
      }
      setState({ status: 'error', error: 'Profile timed out. Try a smaller dataset.' })
    } catch (err) {
      setState({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return (
    <section id="streaming-profile" className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Dataset Profile</span>
          <span className="text-xs text-zinc-600 font-mono">full population · streaming</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
            <input
              type="checkbox"
              checked={verify}
              onChange={e => setVerify(e.target.checked)}
              className="accent-emerald-500"
            />
            Verify
          </label>
          <button
            onClick={runProfile}
            disabled={!file || state.status === 'loading'}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {state.status === 'loading' && (
              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {state.status === 'loading' ? 'Profiling…' : 'Run profile'}
          </button>
        </div>
      </div>

      {!file && (
        <p className="px-5 py-6 text-xs text-zinc-600 text-center">
          Re-upload the dataset to profile it.
        </p>
      )}

      {state.status === 'loading' && (
        <div className="px-5 py-6 space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Profiling {file?.name} on the background worker…</span>
            <span className="font-mono text-emerald-500">{Math.round((state.progress ?? 0) * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${Math.round((state.progress ?? 0) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-zinc-600 font-mono truncate">{state.stage || 'queued'}</p>
        </div>
      )}

      {state.status === 'error' && (
        <p className="px-5 py-6 text-xs text-red-400 text-center">{state.error}</p>
      )}

      {state.status === 'done' && state.data && (
        <ProfileResults
          profile={state.data}
          manifest={state.data.manifest}
          verification={state.data.verification}
        />
      )}
    </section>
  )
}

function ProfileResults({
  profile,
  manifest,
  verification,
}: {
  profile: StreamProfileResponse
  manifest?: ReproducibilityManifest
  verification?: VerificationReport | null
}) {
  const numericCols = profile.columns.filter(c => c.mean != null)
  const catCols = profile.columns.filter(c => c.mean == null)
  const totalNullPct = profile.rowCount > 0
    ? (profile.totalMissing / profile.rowCount) * 100
    : 0

  return (
    <div>
      {/* Summary stat strip */}
      <div className="px-5 pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Rows" value={profile.rowCount.toLocaleString()} />
        <MiniStat label="Columns" value={String(profile.columnCount)} />
        <MiniStat label="Missing" value={`${profile.totalMissing.toLocaleString()} (${totalNullPct.toFixed(1)}%)`} />
        <MiniStat
          label="Duplicates"
          value={profile.duplicateRowCount == null ? '—' : profile.duplicateRowCount.toLocaleString()}
        />
      </div>

      {/* Badges */}
      <div className="px-5 pt-3 flex flex-wrap items-center gap-2">
        {profile.cacheHit === true && (
          <Badge tone="emerald">served from cache</Badge>
        )}
        {profile.cacheHit === false && (
          <Badge tone="zinc">computed fresh</Badge>
        )}
        {verification && (
          verification.passed
            ? <Badge tone="emerald">verification passed</Badge>
            : <Badge tone="red">verification flagged issues</Badge>
        )}
        {profile.duplicateCountCapped && <Badge tone="amber">duplicate count capped</Badge>}
        {profile.execution?.strategy && <Badge tone="violet">strategy: {profile.execution.strategy}</Badge>}
      </div>

      {/* Column table */}
      {profile.columns.length > 0 && (
        <div className="px-5 pt-4">
          <p className="text-xs text-zinc-500 font-medium mb-2">Columns</p>
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/60">
                  {['Column', 'Type', 'Count', 'Null %', 'Cardinality', 'Mean', 'Median', 'Std Dev', 'Skew', 'Outliers'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-[11px] text-zinc-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...numericCols, ...catCols].map((col, i) => (
                  <tr key={col.name} className={`border-b border-zinc-800/50 ${i % 2 === 0 ? '' : 'bg-zinc-900/30'}`}>
                    <td className="px-3 py-2 font-mono text-xs text-emerald-400 whitespace-nowrap">{col.name}</td>
                    <td className="px-3 py-2 text-xs text-zinc-400 capitalize">{col.type}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-300">{col.count.toLocaleString()}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-400">{col.nullPercentage.toFixed(1)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-400">
                      {col.cardinality?.toLocaleString() ?? '—'}
                      {col.cardinalityCapped ? ' +' : ''}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-300">{fmt(col.mean)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-300">{fmt(col.median)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-300">{fmt(col.stdDev)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-400">{fmt(col.skewness)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-400">{col.outlierCount?.toLocaleString() ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Correlations */}
      {profile.correlations && profile.correlations.length > 0 && (
        <div className="px-5 pt-4">
          <p className="text-xs text-zinc-500 font-medium mb-2">Correlations (full population)</p>
          <div className="flex flex-wrap gap-2">
            {profile.correlations.map(c => (
              <span
                key={`${c.columnA}~${c.columnB}`}
                className="text-xs font-mono px-2.5 py-1 rounded-full border border-zinc-800 bg-zinc-900/60 text-zinc-300"
              >
                {c.columnA}/{c.columnB} <span className={Math.abs(c.r) > 0.5 ? 'text-emerald-400' : 'text-zinc-400'}>{c.r.toFixed(3)}</span>
                <span className="text-zinc-600"> n={c.n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Manifest */}
      {manifest && (
        <div className="px-5 pt-4">
          <p className="text-xs text-zinc-500 font-medium mb-2">Reproducibility manifest</p>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 font-mono text-[11px] text-zinc-400 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
            <ManifestRow k="engine" v={manifest.engineVersion} />
            <ManifestRow k="strategy" v={manifest.strategy} />
            <ManifestRow k="chunk size" v={String(manifest.chunkSize)} />
            <ManifestRow k="passes" v={String(manifest.passes)} />
            <ManifestRow k="elapsed" v={`${manifest.elapsedSeconds}s`} />
            <ManifestRow k="sha256" v={`${manifest.fileHash.slice(0, 12)}…`} title={manifest.fileHash} />
          </div>
        </div>
      )}

      {/* Verification */}
      {verification && (
        <div className="px-5 pt-4 pb-5">
          <p className="text-xs text-zinc-500 font-medium mb-2">Verification</p>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2 text-xs">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <VStatus ok={verification.exactnessOk} label="exactness" detail={`${verification.exactness.length} columns`} />
              <VStatus ok={verification.consistencyOk} label="consistency" />
              <VStatus ok={verification.determinism} label="determinism" />
              {verification.fullCrossCheck && (
                <VStatus
                  ok={verification.fullCrossCheck.passed}
                  label="full cross-check"
                  detail={`${verification.fullCrossCheck.columnsChecked} columns vs pandas`}
                />
              )}
            </div>
            {verification.consistency.length > 0 && (
              <ul className="pl-4 list-disc text-red-400 text-[11px] space-y-0.5">
                {verification.consistency.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-zinc-600">{verification.notes.join(' ')}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <p className="text-[10px] text-zinc-500 uppercase tracking-widest">{label}</p>
      <p className="text-sm font-mono font-semibold text-zinc-200 mt-0.5">{value}</p>
    </div>
  )
}

function Badge({ tone, children }: { tone: 'emerald' | 'zinc' | 'amber' | 'red' | 'violet'; children: React.ReactNode }) {
  const map = {
    emerald: 'bg-emerald-900/40 text-emerald-400 border-emerald-800/60',
    zinc: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    amber: 'bg-amber-900/40 text-amber-400 border-amber-800/60',
    red: 'bg-red-900/40 text-red-400 border-red-800/60',
    violet: 'bg-violet-900/40 text-violet-400 border-violet-800/60',
  }
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${map[tone]}`}>{children}</span>
  )
}

function ManifestRow({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <span className="truncate" title={title}>
      <span className="text-zinc-600">{k}: </span>
      <span className="text-zinc-300">{v}</span>
    </span>
  )
}

function VStatus({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
      <span className="text-zinc-400">{label}</span>
      {detail && <span className="text-zinc-600">({detail})</span>}
    </span>
  )
}

function fmt(v: number | null | undefined) {
  if (v == null || isNaN(v)) return '—'
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 1 })
  if (Math.abs(v) >= 1) return v.toFixed(3)
  return v.toFixed(3)
}
