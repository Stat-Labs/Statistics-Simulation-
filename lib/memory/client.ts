import type { Column, DatasetSchema } from '@/lib/types'
import type { KpiPoint } from '@/lib/memory/types'

const TIME_TOKENS = ['date', 'time', 'year', 'month', 'day', 'week', 'quarter', 'datetime', 'timestamp', 'period']
const ID_TOKENS = ['id', 'code', 'key', 'uuid', 'hash']
const MONEY_TOKENS = ['revenue', 'sales', 'amount', 'price', 'cost', 'profit', 'income', 'payment', 'fee', 'budget', 'expense', 'spend', 'value']

export function isLikelyTimeColumn(col: Column): boolean {
  if (col.type === 'datetime') return true
  const name = col.name.toLowerCase().replace(/[_-]/g, ' ')
  return TIME_TOKENS.some((t) => new RegExp(`\\b${t}\\b`).test(name))
}

export function isLikelyNumericKpi(col: Column): boolean {
  if (col.type !== 'continuous') return false
  const name = col.name.toLowerCase().replace(/[_-]/g, ' ')
  if (ID_TOKENS.some((t) => new RegExp(`\\b${t}\\b`).test(name) || name.endsWith(t))) return false
  return true
}

export function formatPeriod(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Builds the timeline KPI series for a dataset. When a time column exists the
 * series is bucketed per calendar month (timeline memory: "compare this month
 * with previous months"); otherwise single summary points per numeric column.
 * Pure function — safe to run in the browser and to unit test.
 */
export function computeKpiSeries(schema: DatasetSchema): KpiPoint[] {
  const rows = schema.sampleRows ?? []
  const timeCol = schema.columns.find((c) => isLikelyTimeColumn(c))
  const numericCols = schema.columns.filter((c) => isLikelyNumericKpi(c))
  if (rows.length === 0 || numericCols.length === 0) return []

  const points: KpiPoint[] = []

  if (timeCol) {
    const buckets = new Map<string, { sums: Map<string, { sum: number; count: number }> }>()
    for (const row of rows) {
      const raw = row[timeCol.name]
      const ts = raw ? new Date(String(raw)).getTime() : NaN
      const period = Number.isFinite(ts) ? formatPeriod(ts) : null
      if (!period) continue
      let bucket = buckets.get(period)
      if (!bucket) {
        bucket = { sums: new Map() }
        buckets.set(period, bucket)
      }
      for (const col of numericCols) {
        const v = toNumber(row[col.name])
        if (v === null) continue
        const acc = bucket.sums.get(col.name) ?? { sum: 0, count: 0 }
        acc.sum += v
        acc.count += 1
        bucket.sums.set(col.name, acc)
      }
    }
    const periods = [...buckets.keys()].sort()
    for (const col of numericCols) {
      for (const period of periods) {
        const acc = buckets.get(period)!.sums.get(col.name)
        if (!acc || acc.count === 0) continue
        const mean = acc.sum / acc.count
        const isMoney = MONEY_TOKENS.some((t) => col.name.toLowerCase().includes(t))
        points.push({
          name: col.name,
          metricKey: col.name,
          valueText: mean.toLocaleString(undefined, { maximumFractionDigits: 2 }),
          valueNumber: mean,
          unit: isMoney ? 'amount' : null,
          periodKey: period,
          displayLabel: `Avg ${col.name} · ${period}`,
        })
      }
    }
  } else {
    for (const col of numericCols) {
      const values = rows.map((r) => toNumber(r[col.name])).filter((v): v is number => v !== null)
      if (values.length === 0) continue
      const mean = values.reduce((a, b) => a + b, 0) / values.length
      points.push({
        name: col.name,
        metricKey: col.name,
        valueText: mean.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        valueNumber: mean,
        unit: null,
        periodKey: null,
        displayLabel: `Avg ${col.name}`,
      })
    }
  }

  return points.slice(0, 120)
}
