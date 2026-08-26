import { describe, it, expect } from 'vitest'
import { computeKpiSeries, isLikelyNumericKpi, isLikelyTimeColumn } from '@/lib/memory/client'
import type { Column, DatasetSchema } from '@/lib/types'

function col(name: string, type: Column['type']): Column {
  return { name, type, uniqueValues: [], sampleValues: [] }
}

function schema(cols: Column[], rows: Record<string, string>[]): DatasetSchema {
  return {
    fileName: 'test.csv',
    rowCount: rows.length,
    columnCount: cols.length,
    columns: cols,
    sampleRows: rows,
  }
}

describe('workspace KPI timeline (computeKpiSeries)', () => {
  it('buckets numeric values per calendar month when a time column exists', () => {
    const s = schema(
      [col('date', 'datetime'), col('revenue', 'continuous')],
      [
        { date: '2024-01-05', revenue: '100' },
        { date: '2024-01-15', revenue: '200' },
        { date: '2024-02-02', revenue: '300' },
      ],
    )
    const kpis = computeKpiSeries(s)
    expect(kpis).toHaveLength(2)
    expect(kpis.map((k) => k.periodKey)).toEqual(['2024-01', '2024-02'])
    expect(kpis[0].valueNumber).toBe(150)
    expect(kpis[0].valueText).toBe('150')
    expect(kpis[0].displayLabel).toBe('Avg revenue · 2024-01')
    // Money-token columns get a unit hint.
    expect(kpis[0].unit).toBe('amount')
  })

  it('produces a single summary point per numeric column without a time column', () => {
    const s = schema([col('sales', 'continuous')], [{ sales: '10' }, { sales: '30' }])
    const kpis = computeKpiSeries(s)
    expect(kpis).toHaveLength(1)
    expect(kpis[0].valueNumber).toBe(20)
    expect(kpis[0].periodKey).toBeNull()
  })

  it('excludes identifier columns and non-numeric columns from KPIs', () => {
    const s = schema(
      [col('order_id', 'continuous'), col('customer', 'categorical')],
      [{ order_id: '1', customer: 'acme' }],
    )
    expect(isLikelyNumericKpi(col('order_id', 'continuous'))).toBe(false)
    expect(isLikelyNumericKpi(col('sales_qty', 'continuous'))).toBe(true)
    expect(computeKpiSeries(s)).toEqual([])
  })

  it('treats datetime columns and time-token names as time columns', () => {
    expect(isLikelyTimeColumn(col('created_at', 'datetime'))).toBe(true)
    expect(isLikelyTimeColumn(col('signup_date', 'categorical'))).toBe(true)
    expect(isLikelyTimeColumn(col('revenue', 'continuous'))).toBe(false)
  })
})
