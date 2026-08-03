'use client'

import { useState } from 'react'
import type { VisualizationResponse, VizChart, VizSection } from '@/lib/types'
import { EChart } from '@/components/visualize/EChart'

function Badge({ tone, children }: { tone: 'emerald' | 'zinc' | 'amber' | 'violet' | 'red'; children: React.ReactNode }) {
  const map = {
    emerald: 'bg-emerald-900/40 text-emerald-400 border-emerald-800/60',
    zinc: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    amber: 'bg-amber-900/40 text-amber-400 border-amber-800/60',
    violet: 'bg-violet-900/40 text-violet-400 border-violet-800/60',
    red: 'bg-red-900/40 text-red-400 border-red-800/60',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-mono font-medium ${map[tone]}`}>
      {children}
    </span>
  )
}

function ChartCard({ chart }: { chart: VizChart }) {
  const [open, setOpen] = useState(false)
  const rec = chart.recommendation
  const verified = chart.verification.passed
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-zinc-800 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-200 truncate">{chart.title}</div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <Badge tone="zinc">{chart.chartType}</Badge>
            <Badge tone={verified ? 'emerald' : 'red'}>
              {verified ? 'verified' : 'flag'}
            </Badge>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`font-mono text-lg font-bold ${verified ? 'text-emerald-400' : 'text-zinc-500'}`}>
            {Math.round(rec.confidence * 100)}%
          </div>
          <div className="text-[10px] text-zinc-600">confidence</div>
        </div>
      </div>

      <div className="px-2 py-2">
        <EChart option={chart.spec} height={300} />
      </div>

      <div className="px-4 py-3 border-t border-zinc-800 space-y-2">
        <p className="text-xs text-zinc-400 leading-relaxed">{rec.reason}</p>

        <button
          onClick={() => setOpen(!open)}
          className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
        >
          {open ? 'Hide details' : 'Why this chart? Advantages, limitations & alternatives'}
        </button>

        {open && (
          <div className="space-y-4 pt-2 border-t border-zinc-800/60">
            {chart.explanation ? (
              <div className="space-y-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">AI Explanation</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-zinc-950/40 p-3 rounded-lg border border-zinc-800">
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Why this chart?</div>
                    <p className="text-xs text-zinc-300 leading-relaxed">{chart.explanation.whyThisChart}</p>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">What it shows</div>
                    <p className="text-xs text-zinc-300 leading-relaxed">{chart.explanation.whatItShows}</p>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">How to interpret</div>
                    <p className="text-xs text-zinc-300 leading-relaxed">{chart.explanation.howToInterpret}</p>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Limitations</div>
                    <p className="text-xs text-zinc-400 leading-relaxed">{chart.explanation.limitations}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-zinc-950/20 rounded-lg border border-zinc-800/40 text-center">
                <span className="text-[10px] text-zinc-500">No AI explanation available. Connect an AI provider to enable.</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {rec.advantages.length > 0 && (
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Statistical Advantages</div>
                  <ul className="space-y-1">
                    {rec.advantages.map((a) => (
                      <li key={a} className="text-[11px] text-zinc-400 flex gap-1.5 leading-relaxed">
                        <span className="text-emerald-500">+</span>{a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {rec.limitations.length > 0 && (
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Statistical Limitations</div>
                  <ul className="space-y-1">
                    {rec.limitations.map((l) => (
                      <li key={l} className="text-[11px] text-zinc-400 flex gap-1.5 leading-relaxed">
                        <span className="text-amber-500">–</span>{l}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {rec.alternatives.length > 0 && (
              <div className="pt-2 border-t border-zinc-800/40">
                <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">Statistical Alternatives</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {rec.alternatives.map((alt) => (
                    <div key={`${alt.chartType}-${alt.title}`} className="flex items-center justify-between gap-2 text-[11px] bg-zinc-950/30 px-2 py-1 rounded border border-zinc-800/50">
                      <span className="text-zinc-300 truncate">{alt.title}</span>
                      <span className="font-mono text-zinc-500">{Math.round(alt.confidence * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Boolean(chart.spec.note) && (
              <p className="text-[11px] text-zinc-500 italic pt-1">{String(chart.spec.note)}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ section }: { section: VizSection }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-sm font-semibold text-zinc-300">{section.title}</h2>
        {section.description && <span className="text-xs text-zinc-600">{section.description}</span>}
        <span className="ml-auto text-xs text-zinc-600 font-mono">{section.charts.length} chart{section.charts.length === 1 ? '' : 's'}</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {section.charts.map((chart) => (
          <ChartCard key={chart.id} chart={chart} />
        ))}
      </div>
    </section>
  )
}

export function VizDashboard({ data }: { data: VisualizationResponse }) {
  const topIntent = data.intents[0]
  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-semibold text-zinc-200">{data.fileName}</div>
            <div className="text-xs text-zinc-600 font-mono">
              {data.rowCount.toLocaleString()} rows · {data.columnCount} columns
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="violet">VIE {data.engine}</Badge>
            {topIntent && (
              <span className="text-xs text-zinc-400">
                focus: <span className="text-emerald-400 font-medium">{topIntent.label}</span>
              </span>
            )}
          </div>
        </div>

        {data.intents.length > 0 && (
          <div className="px-5 py-3 border-b border-zinc-800 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Detected analysis intents</div>
            <div className="flex flex-wrap gap-2">
              {data.intents.map((i) => (
                <span key={i.id} className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                  i.id === topIntent?.id
                    ? 'border-emerald-600/40 bg-emerald-900/30 text-emerald-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                }`}>
                  <span>{i.label}</span>
                  <span className="font-mono text-[10px] opacity-70">{Math.round(i.confidence * 100)}%</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {data.detectedPatterns.length > 0 && (
          <div className="px-5 py-3 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Detected statistical patterns</div>
            <div className="flex flex-wrap gap-1.5">
              {data.detectedPatterns.map((p, idx) => (
                <span key={`${p.name}-${idx}`} title={p.description} className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-400">
                  <span className="text-emerald-400 font-mono">{p.name}</span>
                  {p.column && <span className="text-zinc-600">· {p.column}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {data.note && (
        <p className="text-xs text-amber-400/80">{data.note}</p>
      )}

      {data.sections.map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </div>
  )
}
