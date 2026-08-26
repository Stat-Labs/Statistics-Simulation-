'use client'

import type { FilePreview } from '@/lib/preview/analyze'

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

/**
 * Shows everything we learned about the file on the client, before uploading:
 * encoding, delimiter, row/column estimates, compression savings, missing
 * values, duplicates, and numeric summaries. The UI should feel instant.
 */
export function PreviewPanel({ preview }: { preview: FilePreview }) {
  const savingsPct = preview.compression ? (preview.compression.savings * 100).toFixed(0) : null
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">Instant file analysis</span>
        <span className="text-[11px] text-emerald-400 font-mono">
          {preview.columnCount} cols · ~{preview.estimatedRowCount.toLocaleString()} rows
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* File metadata */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Meta label="Size" value={fmtBytes(preview.sizeBytes)} />
          <Meta label="Encoding" value={preview.encoding} />
          <Meta label="Delimiter" value={preview.delimiter} />
          <Meta label="Format" value={preview.mimeType.split('/').pop()?.toUpperCase() ?? 'FILE'} />
        </div>

        {/* Compression */}
        {preview.compression && (
          <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-3.5 py-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-zinc-400">
                <span className="text-zinc-500 line-through">{fmtBytes(preview.compression.originalBytes)}</span>
                {' → '}
                <span className="text-emerald-300 font-semibold">{fmtBytes(preview.compression.compressedBytes)}</span>
                <span className="ml-2 text-zinc-500">
                  ({preview.compression.method}, saves {savingsPct}%)
                </span>
              </div>
              <div className="text-[11px] text-zinc-500">
                ~{(preview.compression.compressedBytes / (5 * 1024 * 1024)).toFixed(1)}s upload at 5 MB/s
              </div>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${(1 - preview.compression.savings) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Missing + duplicates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Missing values</div>
            {preview.missingByColumn.length === 0 ? (
              <p className="text-xs text-zinc-600">No columns detected.</p>
            ) : (
              <ul className="space-y-1.5">
                {preview.missingByColumn
                  .filter((m) => m.count > 0)
                  .slice(0, 5)
                  .map((m) => (
                    <li key={m.column} className="text-xs flex items-center justify-between gap-2">
                      <span className="font-mono text-zinc-300 truncate">{m.column}</span>
                      <span className={m.percentage > 20 ? 'text-amber-400' : 'text-zinc-500'}>
                        {m.count.toLocaleString()} · {m.percentage.toFixed(0)}%
                      </span>
                    </li>
                  ))}
                {preview.missingByColumn.every((m) => m.count === 0) && (
                  <li className="text-xs text-emerald-400">No missing values detected.</li>
                )}
              </ul>
            )}
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Duplicates</div>
            <div className="text-2xl font-bold text-zinc-100">
              {preview.duplicateEstimate.rows.toLocaleString()}
              <span className="text-sm text-zinc-500 font-normal ml-1.5">
                ({fmtPct(preview.duplicateEstimate.ratio)} of sample)
              </span>
            </div>
          </div>
        </div>

        {/* Numeric summaries */}
        {preview.numericSummaries.length > 0 && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Numeric summaries</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-zinc-500 text-[10px] uppercase tracking-wider">
                    <th className="text-left font-medium py-1 pr-3">Column</th>
                    <th className="text-right font-medium py-1 pr-3">Min</th>
                    <th className="text-right font-medium py-1 pr-3">Mean</th>
                    <th className="text-right font-medium py-1 pr-3">Median</th>
                    <th className="text-right font-medium py-1">Max</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-zinc-300">
                  {preview.numericSummaries.slice(0, 6).map((s) => (
                    <tr key={s.column} className="border-t border-zinc-800/60">
                      <td className="py-1.5 pr-3 text-zinc-200">{s.column}</td>
                      <td className="text-right py-1.5 pr-3">{fmtNum(s.min)}</td>
                      <td className="text-right py-1.5 pr-3">{fmtNum(s.mean)}</td>
                      <td className="text-right py-1.5 pr-3">{fmtNum(s.median)}</td>
                      <td className="text-right py-1.5">{fmtNum(s.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Column chips */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Columns</div>
          <div className="flex flex-wrap gap-1.5">
            {preview.columns.map((col) => (
              <span
                key={col.name}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-300"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${col.type === 'continuous' ? 'bg-emerald-400' : col.type === 'datetime' ? 'bg-sky-400' : col.type === 'binary' ? 'bg-amber-400' : 'bg-indigo-400'}`} />
                <span className="text-zinc-100 font-medium">{col.name}</span>
                <span className="text-zinc-500 text-[10px] lowercase">{col.type}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">{label}</div>
      <div className="mt-0.5 text-xs font-medium text-zinc-200 truncate">{value}</div>
    </div>
  )
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
}
