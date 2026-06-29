'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ScatterChart, Scatter, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { usePDFExport } from '@/lib/pdf'
import { useStatLab } from '@/components/StatLabProvider'
import type { AnalysisSession } from '@/lib/useStatLab'
import type { ChartSuggestion, DescriptiveResult, CorrelationResult, HypothesisResult } from '@/lib/types'

const ACCENT = ['#34d399', '#818cf8', '#f472b6', '#fb923c', '#38bdf8', '#a78bfa']

export default function AnalysePage() {
  const router = useRouter()
  const { currentSession, history, loadSession } = useStatLab()
  const { exportPDF, isGenerating } = usePDFExport()
  const [activeSession, setActiveSession] = useState<AnalysisSession | null>(currentSession)

  useEffect(() => {
    if (!currentSession && history.length === 0) {
      router.push('/')
    } else if (!activeSession && currentSession) {
      setActiveSession(currentSession)
    } else if (!activeSession && history.length > 0) {
      setActiveSession(history[0])
    }
  }, [currentSession, history, activeSession, router])

  if (!activeSession) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const { result, chartSuggestions, interpret, schema, fileName, timestamp } = activeSession
  const descriptive: DescriptiveResult[] = result.descriptive ?? []
  const correlations: CorrelationResult[] = result.inferential?.correlations ?? []
  const hypothesisTests: HypothesisResult[] = result.inferential?.hypothesisTests ?? []
  const predictive = result.predictive
  const alignmentHasPredictive = !!(predictive?.modelType || predictive?.regressionResult)

  const handleExport = () => exportPDF({
    title: `${fileName} — Analysis Report`,
    fileName: `statlab-${fileName.replace('.csv', '')}.pdf`,
    includeTimestamp: true,
    sections: [
      ...(interpret.summary ? [{ elementId: 'ai-summary', title: 'AI Summary' }] : []),
      { elementId: 'descriptive-stats', title: 'Descriptive Statistics' },
      ...(chartSuggestions.length > 0 ? [{ elementId: 'charts-panel', title: 'Charts & Visualisations' }] : []),
      ...((correlations.length > 0 || hypothesisTests.length > 0) ? [{ elementId: 'inferential-panel', title: 'Inferential Analysis' }] : []),
      ...(alignmentHasPredictive ? [{ elementId: 'predictive-panel', title: 'Predictive Model' }] : []),
      ...(interpret.perAnalysis.length > 0 ? [{ elementId: 'ai-interpretation', title: 'AI Interpretation' }] : []),
    ],
  })

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 sticky top-0 z-30 bg-zinc-950/90 backdrop-blur-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/')} className="text-zinc-500 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="w-6 h-6 rounded bg-emerald-500 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-zinc-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l5-5 4 4 5-6 4 3" />
            </svg>
          </div>
          <span className="font-semibold tracking-tight">StatLab</span>
          <span className="hidden sm:block text-zinc-600">/</span>
          <span className="hidden sm:block text-zinc-400 text-sm font-mono truncate max-w-xs">{fileName}</span>
        </div>
        <button
          onClick={handleExport}
          disabled={isGenerating}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-all shadow-sm"
        >
          {isGenerating ? (
            <span className="w-3.5 h-3.5 border border-zinc-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
          Export PDF
        </button>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 space-y-8">

        {/* AI Summary */}
        {interpret.summary && (
          <section id="ai-summary" className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-xs text-zinc-500 uppercase tracking-widest font-medium">AI Summary</span>
              {interpret.provider && (
                <span className="ml-auto text-xs text-zinc-600 font-mono">via {interpret.provider}</span>
              )}
            </div>
            <p className="text-zinc-200 leading-relaxed">{interpret.summary}</p>
          </section>
        )}

        {/* Bento Grid Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Descriptive Stats */}
          <div id="descriptive-stats" className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
              <span className="text-sm font-semibold">Descriptive Statistics</span>
              <span className="text-xs text-zinc-500 font-mono">{descriptive.length} columns</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    {['Column', 'Mean', 'Median', 'Std Dev', 'Min', 'Max', 'Skewness'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs text-zinc-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {descriptive.map((row, i) => (
                    <tr key={row.column} className={`border-b border-zinc-800/50 ${i % 2 === 0 ? '' : 'bg-zinc-900/30'}`}>
                      <td className="px-4 py-3 font-mono text-xs text-emerald-400">{row.column}</td>
                      <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{fmt(row.mean)}</td>
                      <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{fmt(row.median)}</td>
                      <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{fmt(row.stdDev)}</td>
                      <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{fmt(row.min)}</td>
                      <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{fmt(row.max)}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        <SkewnessChip value={row.skewness} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {descriptive.length === 0 && (
                <p className="px-5 py-8 text-zinc-600 text-sm text-center">No descriptive results.</p>
              )}
            </div>
          </div>

          {/* Dataset Info */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
            <span className="text-sm font-semibold">Dataset</span>
            <div className="space-y-3">
              <InfoRow label="File" value={schema.fileName} mono />
              <InfoRow label="Rows" value={schema.rowCount?.toLocaleString() ?? '—'} mono />
              <InfoRow label="Columns" value={String(schema.columnCount)} mono />
              <InfoRow label="Analysed" value={new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} />
            </div>
            <div className="pt-3 border-t border-zinc-800 space-y-1.5">
              {schema.columns.map(col => (
                <div key={col.name} className="flex items-center gap-2 text-xs">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${col.type === 'continuous' ? 'bg-emerald-400' : 'bg-violet-400'}`} />
                  <span className="font-mono text-zinc-300 truncate">{col.name}</span>
                  <span className="ml-auto text-zinc-600">{col.type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Charts */}
        {chartSuggestions.length > 0 && (
          <section id="charts-panel" className="space-y-4">
            <SectionHeader title="Charts & Visualisations" count={chartSuggestions.length} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {chartSuggestions.map((s, i) => (
                <ChartCard key={`${s.title}-${i}`} suggestion={s} activeSession={activeSession} index={i} />
              ))}
            </div>
          </section>
        )}

        {/* Inferential */}
        {(correlations.length > 0 || hypothesisTests.length > 0) && (
          <section id="inferential-panel" className="space-y-4">
            <SectionHeader title="Inferential Analysis" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {correlations.length > 0 && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                  <div className="px-5 py-4 border-b border-zinc-800">
                    <span className="text-sm font-semibold">Correlations</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800">
                        {['Pair', 'r', 'Method', 'Interpretation'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs text-zinc-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {correlations.map((c, i) => (
                        <tr key={`${c.columnA}-${c.columnB}-${i}`} className="border-b border-zinc-800/50">
                          <td className="px-4 py-3 font-mono text-xs text-zinc-300">{c.columnA} / {c.columnB}</td>
                          <td className="px-4 py-3 font-mono text-xs">
                            <span className={Math.abs(c.r) > 0.5 ? 'text-emerald-400' : 'text-zinc-400'}>
                              {c.r?.toFixed(3)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-zinc-500 capitalize">{c.method}</td>
                          <td className="px-4 py-3 text-xs text-zinc-400">{c.interpretation}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {hypothesisTests.length > 0 && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                  <div className="px-5 py-4 border-b border-zinc-800">
                    <span className="text-sm font-semibold">Hypothesis Tests</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800">
                        {['Test', 'Statistic', 'p-value', 'Significant'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs text-zinc-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {hypothesisTests.map((t, i) => (
                        <tr key={`${t.testType}-${i}`} className="border-b border-zinc-800/50">
                          <td className="px-4 py-3 text-xs text-zinc-300 capitalize">{t.testType}</td>
                          <td className="px-4 py-3 font-mono text-xs text-zinc-400">{t.statistic?.toFixed(4)}</td>
                          <td className="px-4 py-3 font-mono text-xs text-zinc-400">{t.pValue?.toFixed(4)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              t.significant ? 'bg-emerald-900/40 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
                            }`}>
                              {t.significant ? 'Yes' : 'No'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Predictive */}
        {alignmentHasPredictive && (
          <section id="predictive-panel">
            <SectionHeader title="Predictive Model" />
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="Model" value={predictive.modelType ?? predictive.regressionResult?.modelType ?? '—'} />
              <StatCard label="R²" value={fmt(predictive.regressionResult?.rSquared)} accent />
              <StatCard label="RMSE" value={fmt(predictive.regressionResult?.rmse)} />
              {predictive.regressionResult?.accuracy != null && (
                <StatCard label="Accuracy" value={`${(predictive.regressionResult.accuracy * 100).toFixed(1)}%`} accent />
              )}
            </div>

            {predictive.regressionResult?.featureImportance && (
              <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <p className="text-xs text-zinc-500 uppercase tracking-widest mb-4">Feature Importance</p>
                <div className="space-y-2">
                  {Object.entries(predictive.regressionResult.featureImportance).map(([feat, imp]) => (
                    <div key={feat} className="flex items-center gap-3">
                      <span className="text-xs font-mono text-zinc-400 w-28 truncate">{feat}</span>
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${Math.min(100, (imp as number) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-zinc-500">{((imp as number) * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* AI Interpretation */}
        {interpret.perAnalysis.length > 0 && (
          <section id="ai-interpretation" className="space-y-4">
            <SectionHeader title="AI Interpretation" count={interpret.perAnalysis.length} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {interpret.perAnalysis.map((item, i) => (
                <div key={`${item.subject}-${i}`} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${typeColor(item.type)}`}>
                      {item.type}
                    </span>
                    <span className="text-xs font-mono text-zinc-400">{item.subject}</span>
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed">{item.interpretation}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* History */}
        {history.length > 0 && (
          <section className="space-y-4 pt-4 border-t border-zinc-800">
            <SectionHeader title="Past Analyses" count={history.length} />
            <div className="space-y-2">
              {history.map(session => (
                <button
                  key={session.id}
                  onClick={() => {
                    loadSession(session)
                    setActiveSession(session)
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                  className={`w-full rounded-xl border text-left px-5 py-4 flex items-center gap-4 transition-colors ${
                    activeSession.id === session.id
                      ? 'border-emerald-700 bg-emerald-950/20'
                      : 'border-zinc-800 bg-zinc-900/30 hover:border-zinc-600'
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6M7 9l3-3 3 3 4-4" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-200 truncate">{session.fileName}</p>
                    <p className="text-xs text-zinc-500">
                      {session.schema?.columnCount ?? 0} columns · {new Date(session.timestamp).toLocaleString()}
                    </p>
                  </div>
                  {activeSession.id === session.id && (
                    <span className="text-xs text-emerald-400 font-medium flex-shrink-0">Viewing</span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chart card — maps chartType to Recharts component with explicit data tracking
// ---------------------------------------------------------------------------

function ChartCard({ suggestion, activeSession, index }: { suggestion: ChartSuggestion; activeSession: AnalysisSession; index: number }) {
  const color = ACCENT[index % ACCENT.length]
  const descriptive: DescriptiveResult[] = activeSession.result.descriptive ?? []
  const targetColumnName = suggestion.column || suggestion.x
  const targetMetrics = descriptive.find(d => d.column === targetColumnName)

  const { chartType, title, x, y } = suggestion

  // Formulate data structure depending on chart targets 
  const processedData = (() => {
    if ((chartType === 'bar' || chartType === 'pie' || chartType === 'line') && targetMetrics?.frequencyTable) {
      return Object.entries(targetMetrics.frequencyTable).map(([key, count]) => ({
        name: key,
        value: Number(count),
        mean: targetMetrics.mean ?? 0
      }))
    }

    if (chartType === 'scatter') {
      const preds = activeSession.result.predictive?.regressionResult?.predictions
      if (preds && Array.isArray(preds)) {
        return preds.slice(0, 80).map((pred: any, i: number) => {
          const row = activeSession.schema.sampleRows?.[i]
          return {
            x: row && x ? (Number(row[x]) || i) : i,
            y: Number(pred) || 0,
          }
        })
      }
    }

    // Comprehensive safe fallback to parse dataset values out of sample records
    return (activeSession.schema.sampleRows ?? []).slice(0, 15).map((row, idx) => ({
      name: `Row ${idx + 1}`,
      x: x && row[x] ? Number(row[x]) : idx,
      y: y && row[y] ? Number(row[y]) : (targetMetrics?.mean ?? 0),
      value: targetColumnName && row[targetColumnName] ? Number(row[targetColumnName]) : 0,
      mean: targetMetrics?.mean ?? 0
    }))
  })()

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800">
        <p className="text-sm font-semibold">{title}</p>
        {suggestion.reason && <p className="text-xs text-zinc-500 mt-0.5">{suggestion.reason}</p>}
      </div>
      <div className="p-4 h-56">
        <ResponsiveContainer width="100%" height="100%" debounce={1}>
          {chartType === 'scatter' ? (
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="x" name={x} tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis dataKey="y" name={y || 'Predicted Value'} tick={{ fontSize: 10, fill: '#71717a' }} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', fontSize: 12 }} />
              <Scatter data={processedData} fill={color} fillOpacity={0.8} />
            </ScatterChart>
          ) : chartType === 'line' ? (
            <LineChart data={processedData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', fontSize: 12 }} />
              <Line type="monotone" dataKey={targetMetrics?.frequencyTable ? "value" : "value"} stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          ) : chartType === 'pie' ? (
            <PieChart>
              <Pie data={processedData.slice(0, 6)} dataKey="value" nameKey="name" outerRadius={80} strokeWidth={0}>
                {processedData.slice(0, 6).map((_, i) => (
                  <Cell key={`cell-${i}`} fill={ACCENT[i % ACCENT.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', fontSize: 12 }} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }} />
            </PieChart>
          ) : (
            <BarChart data={processedData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
              <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', fontSize: 12 }} />
              <Bar dataKey={targetMetrics?.frequencyTable ? "value" : "value"} fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(v: number | null | undefined) {
  if (v == null || isNaN(v)) return '—'
  return Math.abs(v) >= 1000
    ? v.toLocaleString(undefined, { maximumFractionDigits: 1 })
    : v.toFixed(3)
}

function SkewnessChip({ value }: { value?: number | null }) {
  if (value == null || isNaN(value)) return <span className="text-zinc-600">—</span>
  const abs = Math.abs(value)
  const label = abs < 0.5 ? 'symmetric' : abs < 1 ? 'moderate' : 'skewed'
  const color = abs < 0.5 ? 'text-emerald-400' : abs < 1 ? 'text-amber-400' : 'text-red-400'
  return <span className={`${color}`}>{value.toFixed(2)} <span className="text-zinc-600">({label})</span></span>
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-xs text-zinc-300 text-right truncate max-w-[60%] ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-sm font-semibold text-zinc-300">{title}</h2>
      {count != null && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 font-mono">{count}</span>
      )}
      <div className="flex-1 h-px bg-zinc-800" />
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-zinc-900/50 p-5 shadow-sm">
      <p className="text-xs text-zinc-400 uppercase tracking-widest mb-1.5">{label}</p>
      <p className={`text-2xl font-bold font-mono tracking-tight ${accent ? 'text-emerald-600' : 'text-white'}`}>{value}</p>
    </div>
  )
}

function typeColor(type: string) {
  const map: Record<string, string> = {
    descriptive: 'bg-emerald-900/40 text-emerald-400',
    inferential: 'bg-violet-900/40 text-violet-400',
    predictive: 'bg-indigo-900/40 text-indigo-400',
    correlation: 'bg-pink-900/40 text-pink-400',
    regression: 'bg-amber-900/40 text-amber-400',
  }
  return map[type.toLowerCase()] ?? 'bg-zinc-800 text-zinc-400'
}