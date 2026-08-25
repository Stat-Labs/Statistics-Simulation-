'use client'

import { useRef, useState } from 'react'
import { AppShell } from '@/components/app/AppShell'
import { VizDashboard } from '@/components/visualize/VizDashboard'
import type { VisualizationResponse } from '@/lib/types'

type ViewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; data: VisualizationResponse }
  | { status: 'error'; error: string }

export default function VisualizePage() {
  const [file, setFile] = useState<File | null>(null)
  const [prompt, setPrompt] = useState('')
  const [view, setView] = useState<ViewState>({ status: 'idle' })
  const inputRef = useRef<HTMLInputElement>(null)

  const run = async () => {
    if (!file) return
    setView({ status: 'loading' })
    try {
      const form = new FormData()
      form.append('file', file)
      if (prompt.trim()) {
        form.append('prompt', prompt)
      }
      const res = await fetch('/api/visualize', { method: 'POST', body: form })
      const data = (await res.json()) as VisualizationResponse & { error?: string }
      if (!res.ok || data.success === false) {
        setView({ status: 'error', error: data.error ?? `Visualization failed (${res.status})` })
        return
      }
      setView({ status: 'done', data })
    } catch (err) {
      setView({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return (
    <AppShell active="visualize">
      <div className="max-w-6xl mx-auto px-4 lg:px-8 py-8 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">Visualization Intelligence</h1>
            <p className="text-sm text-zinc-500">
              Statistically correct charts chosen deterministically — the AI explains, it never decides.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => inputRef.current?.click()}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-emerald-600/50 hover:text-emerald-300 transition-colors"
              >
                {file ? file.name : 'Choose dataset'}
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="prompt-input" className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Custom Focus Prompt (Optional)</label>
              <textarea
                id="prompt-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., Focus on comparing salary across departments, show age distributions, or prefer boxplots"
                className="w-full h-16 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-700 resize-none"
              />
            </div>

            <button
              onClick={run}
              disabled={!file || view.status === 'loading'}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {view.status === 'loading' && (
                <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {view.status === 'loading' ? 'Generating…' : 'Generate dashboard'}
            </button>
          </div>
          <p className="mt-3 text-[11px] text-zinc-600">
            The backend streams a full-population profile, detects statistical patterns and intents,
            scores every candidate chart, emits a verified Apache ECharts spec, and assembles the dashboard.
          </p>
        </div>

        {view.status === 'error' && (
          <p className="text-sm text-red-400">{view.error}</p>
        )}

        {view.status === 'done' && <VizDashboard data={view.data} />}
      </div>
    </AppShell>
  )
}
