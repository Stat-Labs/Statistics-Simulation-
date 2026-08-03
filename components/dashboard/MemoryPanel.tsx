'use client'

import { useCallback, useEffect, useState } from 'react'

export type MemoryScope = 'personal' | 'org'

interface FindingRow {
  id: string
  category: string
  title: string
  body: string
  confidence: number
  severity: string
  createdAt: number
}

interface KpiRow {
  name: string
  metricKey: string
  valueText: string
  valueNumber: number | null
  unit?: string | null
  periodKey?: string | null
  displayLabel?: string | null
  createdAt: number
}

interface GlossaryRow {
  term: string
  definition: string
}

interface MemorySummary {
  findings: FindingRow[]
  kpis: KpiRow[]
  glossary: GlossaryRow[]
  counts: { findings: number; kpis: number; glossary: number; datasets: number }
}

interface RetrievedFinding {
  id: string
  title: string
  body: string
  category: string
  severity: string
  score: number
  createdAt: number
}

interface RetrievedResult {
  findings: RetrievedFinding[]
  glossary: GlossaryRow[]
  kpis: KpiRow[]
  datasets: { id: string; name: string; rowCount: number | null; createdAt: number }[]
}

interface RagSource {
  title: string
  kind: 'finding' | 'kpi' | 'glossary'
}

interface AskResult {
  answer: string | null
  grounded: boolean
  sources: RagSource[]
  context: RetrievedResult
}

function severityColor(severity: string): string {
  if (severity === 'high') return 'bg-red-900/40 text-red-400'
  if (severity === 'medium') return 'bg-amber-900/40 text-amber-400'
  return 'bg-emerald-900/40 text-emerald-400'
}

function categoryColor(category: string): string {
  const map: Record<string, string> = {
    insight: 'bg-emerald-900/40 text-emerald-400',
    relationship: 'bg-violet-900/40 text-violet-400',
    anomaly: 'bg-red-900/40 text-red-400',
    risk: 'bg-amber-900/40 text-amber-400',
    recommendation: 'bg-sky-900/40 text-sky-400',
    trend: 'bg-indigo-900/40 text-indigo-400',
    significance: 'bg-pink-900/40 text-pink-400',
    model: 'bg-zinc-800 text-zinc-400',
  }
  return map[category] ?? 'bg-zinc-800 text-zinc-400'
}

/**
 * The knowledge base view: recent findings, KPIs, glossary + a RAG
 * "ask your workspace" box that retrieves relevant context from memory before
 * any AI answer is generated.
 */
export function MemoryPanel({ scope }: { scope: MemoryScope }) {
  const [summary, setSummary] = useState<MemorySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [result, setResult] = useState<AskResult | null>(null)
  const [askError, setAskError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/memory/summary?scope=${scope}`, { credentials: 'same-origin' })
      const data = await res.json()
      if (data?.success) setSummary(data.memory)
    } catch {
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    void load()
  }, [load])

  const ask = useCallback(async () => {
    const q = question.trim()
    if (!q || asking) return
    setAsking(true)
    setAskError(null)
    try {
      const res = await fetch('/api/memory/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
        credentials: 'same-origin',
      })
      const data = await res.json()
      if (!res.ok || !data?.success) {
        setAskError(data?.error ?? 'Could not query workspace memory.')
        setResult(null)
        return
      }
      setResult({
        answer: data.answer ?? null,
        grounded: data.grounded === true,
        sources: data.sources ?? [],
        context: data.context,
      })
    } catch {
      setAskError('Network error. Try again.')
    } finally {
      setAsking(false)
    }
  }, [question, asking])

  const counts = summary?.counts

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Workspace memory</h2>
        <span className="text-[11px] text-zinc-500">knowledge extracted from every analysis</span>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-zinc-800/60 border-b border-zinc-800">
          <CountCell label="Findings" value={counts?.findings} loading={loading} />
          <CountCell label="KPIs" value={counts?.kpis} loading={loading} />
          <CountCell label="Glossary terms" value={counts?.glossary} loading={loading} />
          <CountCell label="Datasets" value={counts?.datasets} loading={loading} />
        </div>

        <div className="p-5 space-y-6">
          {/* Ask your workspace */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Ask your workspace
            </label>
            <div className="mt-2 flex flex-col sm:flex-row gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void ask()}
                placeholder="e.g. What do we know about revenue trends or customer churn?"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-900/40"
              />
              <button
                onClick={() => void ask()}
                disabled={asking || !question.trim()}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 text-zinc-950 text-sm font-semibold transition-colors"
              >
                {asking ? 'Asking…' : 'Ask'}
              </button>
            </div>
            {askError && <p className="mt-2 text-xs text-red-500">{askError}</p>}
          </div>

          {result && (
            <div className="space-y-4">
              {result.answer && (
                <div className={`rounded-lg border px-4 py-3 ${result.grounded ? 'border-emerald-800/60 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-950/40'}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Answer</span>
                    {result.grounded && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400">
                        grounded in memory
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-100 leading-relaxed">{result.answer}</p>
                  {result.sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {result.sources.map((s, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-500">
                          <span className="text-emerald-400">{s.kind}</span>
                          <span className="max-w-[220px] truncate">{s.title}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {result.answer === null && (
                <p className="text-xs text-zinc-500">
                  Answer generation is unavailable (no AI key configured or provider down) — showing the retrieved knowledge below instead.
                </p>
              )}

              {result.context.findings.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-500 mb-2">
                    Relevant findings ({result.context.findings.length})
                  </p>
                  <ul className="space-y-2">
                    {result.context.findings.map((f) => (
                      <li key={f.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3.5 py-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-zinc-100">{f.title}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${categoryColor(f.category)}`}>
                            {f.category}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${severityColor(f.severity)}`}>
                            {f.severity}
                          </span>
                          {f.score > 0 && (
                            <span className="text-[10px] font-mono text-emerald-400 ml-auto">
                              {Math.round(f.score * 100)}% match
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-zinc-400 leading-relaxed">{f.body}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.context.kpis.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-500 mb-2">KPIs</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.context.kpis.slice(0, 12).map((k, i) => (
                      <span key={`${k.metricKey}-${i}`} className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-zinc-950 border border-zinc-800 text-xs">
                        <span className="font-mono text-emerald-300">{k.valueText}</span>
                        <span className="text-zinc-500">{k.displayLabel ?? k.name}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {result.context.glossary.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-500 mb-2">Glossary</p>
                  <ul className="space-y-1.5">
                    {result.context.glossary.slice(0, 6).map((g) => (
                      <li key={g.term} className="text-xs">
                        <span className="font-mono font-semibold text-zinc-200">{g.term}</span>
                        <span className="text-zinc-500"> — {g.definition}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.context.findings.length === 0 && result.context.kpis.length === 0 && result.context.glossary.length === 0 && (
                <p className="text-xs text-zinc-600">
                  No relevant knowledge found yet — run an analysis and StatLab will remember it here.
                </p>
              )}
            </div>
          )}

          {/* Knowledge base contents */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
                Recent findings
              </p>
              {loading ? (
                <div className="h-20 rounded-lg bg-zinc-950/40 animate-pulse" />
              ) : !summary || summary.findings.length === 0 ? (
                <p className="text-xs text-zinc-600">No findings yet.</p>
              ) : (
                <ul className="space-y-2">
                  {summary.findings.slice(0, 4).map((f) => (
                    <li key={f.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3.5 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-200">{f.title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${categoryColor(f.category)} ml-auto`}>
                          {f.category}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500 leading-relaxed line-clamp-2">{f.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
                  Tracked KPIs
                </p>
                {loading ? (
                  <div className="h-10 rounded-lg bg-zinc-950/40 animate-pulse" />
                ) : !summary || summary.kpis.length === 0 ? (
                  <p className="text-xs text-zinc-600">No KPIs yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {summary.kpis.slice(0, 10).map((k, i) => (
                      <span key={`${k.metricKey}-${i}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-950 border border-zinc-800 text-xs">
                        <span className="font-mono text-emerald-300">{k.valueText}</span>
                        <span className="text-zinc-500">{k.periodKey ?? k.name}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">
                  Glossary
                </p>
                {loading ? (
                  <div className="h-10 rounded-lg bg-zinc-950/40 animate-pulse" />
                ) : !summary || summary.glossary.length === 0 ? (
                  <p className="text-xs text-zinc-600">No glossary terms yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {summary.glossary.slice(0, 5).map((g) => (
                      <li key={g.term} className="text-xs">
                        <span className="font-mono font-semibold text-zinc-200">{g.term}</span>
                        <span className="text-zinc-500"> — {g.definition}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function CountCell({ label, value, loading }: { label: string; value?: number; loading: boolean }) {
  return (
    <div className="px-5 py-4">
      <div className="text-2xl font-bold text-emerald-400">{loading ? '…' : value ?? 0}</div>
      <div className="text-[11px] text-zinc-500 mt-0.5">{label}</div>
    </div>
  )
}
