'use client'

import type { MemoryProgress, PipelineStatus } from '@/lib/useStatLab'

export interface Stage {
  key: string
  label: string
  sub?: string
}

const PIPELINE_STAGES: Stage[] = [
  { key: 'parsing', label: 'Parsing' },
  { key: 'profiling', label: 'AI Profiling' },
  { key: 'analysing', label: 'Statistics' },
  { key: 'interpreting', label: 'Interpreting' },
  { key: 'done', label: 'Complete' },
]

const MEMORY_STAGES: Stage[] = [
  { key: 'dataset', label: 'Dataset', sub: 'chunked upload' },
  { key: 'analysis', label: 'Analysis', sub: 'storing result' },
  { key: 'knowledge', label: 'Knowledge', sub: 'extraction' },
]

const STAGE_INDEX: Record<string, number> = {
  idle: -1,
  parsing: 0,
  profiling: 1,
  analysing: 2,
  interpreting: 3,
  done: 4,
  error: 4,
}

function Step({ label, sub, state }: { label: string; sub?: string; state: 'done' | 'active' | 'pending' }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold border ${
          state === 'done'
            ? 'bg-emerald-500 border-emerald-500 text-zinc-950'
            : state === 'active'
              ? 'bg-emerald-950 border-emerald-500 text-emerald-300 animate-pulse'
              : 'bg-zinc-900 border-zinc-700 text-zinc-600'
        }`}
      >
        {state === 'done' ? '✓' : state === 'active' ? '…' : '·'}
      </div>
      <div className="min-w-0 leading-tight">
        <div className={`text-xs font-medium truncate ${state === 'done' ? 'text-zinc-200' : state === 'active' ? 'text-emerald-300' : 'text-zinc-600'}`}>
          {label}
        </div>
        {sub && <div className="text-[10px] text-zinc-600 truncate">{sub}</div>}
      </div>
    </div>
  )
}

/**
 * Two-row stepper: the analysis pipeline (profiling → statistics → interpret)
 * plus the memory stages that run in the background (dataset → analysis →
 * knowledge extraction).
 */
export function ProgressStages({ pipelineStatus, memoryProgress }: { pipelineStatus: PipelineStatus; memoryProgress: MemoryProgress | null }) {
  const activeIdx = STAGE_INDEX[pipelineStatus] ?? -1
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-3">Analysis pipeline</div>
        <div className="grid grid-cols-5 gap-2">
          {PIPELINE_STAGES.map((s, i) => (
            <Step
              key={s.key}
              label={s.label}
              state={i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending'}
            />
          ))}
        </div>
      </div>

      {memoryProgress && (
        <div className="pt-3 border-t border-zinc-800">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-3">
            Saving to workspace memory
            {memoryProgress.percent !== undefined && (
              <span className="ml-2 text-emerald-400 font-mono">{Math.round(memoryProgress.percent * 100)}%</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MEMORY_STAGES.map((s, i) => {
              const currentIdx = MEMORY_STAGES.findIndex((m) => m.key === memoryProgress.stage)
              const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending'
              return <Step key={s.key} label={s.label} sub={s.sub} state={state} />
            })}
          </div>
          {memoryProgress.error && (
            <p className="mt-2 text-xs text-amber-400">Memory: {memoryProgress.error}</p>
          )}
        </div>
      )}
    </div>
  )
}
