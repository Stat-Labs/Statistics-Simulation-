import { describe, it, expect } from 'vitest'
import { detectDelimiter, detectEncoding, analyzeFile } from '@/lib/preview/analyze'
import * as XLSX from 'xlsx'
import { zipSync } from 'fflate'

function csvFile(name: string, text: string, opts?: { mime?: string }): File {
  return new File([text], name, { type: opts?.mime ?? 'text/csv' })
}

describe('client dataset preview', () => {
  it('detects comma, tab, semicolon, and pipe delimiters', () => {
    expect(detectDelimiter('a,b,c')).toBe('Comma')
    expect(detectDelimiter('a\tb\tc')).toBe('TSV')
    expect(detectDelimiter('a;b;c')).toBe('Semicolon')
    expect(detectDelimiter('a|b|c')).toBe('Pipe')
  })

  it('detects UTF-8 BOM and UTF-16 encodings', () => {
    const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62]).buffer
    expect(detectEncoding(utf8Bom)).toBe('UTF-8 (BOM)')
    const utf16le = new Uint8Array([0xff, 0xfe, 0x61, 0x00]).buffer
    expect(detectEncoding(utf16le)).toBe('UTF-16 LE')
  })

  it('analyzes a CSV with columns, types, duplicates, and missing values', async () => {
    const file = csvFile('sales.csv', [
      'region,revenue,units,date',
      'North,1000,10,2024-01-01',
      'South,2500,20,2024-01-02',
      'East,1420,15,2024-01-03',
      'North,3300,10,2024-01-04',
      'West,,30,2024-01-05',
      'North,1900,12,2024-01-06',
      'North,3300,10,2024-01-04',
      '',
    ].join('\n'))
    const preview = await analyzeFile(file)

    expect(preview.fileName).toBe('sales.csv')
    expect(preview.delimiter).toBe('Comma')
    expect(preview.estimatedRowCount).toBe(8)
    expect(preview.columnCount).toBe(4)
    expect(preview.columnNames).toEqual(['region', 'revenue', 'units', 'date'])

    const revenue = preview.columns.find((c) => c.name === 'revenue')
    expect(revenue?.type).toBe('ordinal')
    expect(revenue?.min).toBe(1000)
    expect(revenue?.max).toBe(3300)

    const region = preview.columns.find((c) => c.name === 'region')
    expect(region?.type).toBe('categorical')
    expect(region?.uniqueValues).toEqual(['North', 'South', 'East', 'West'])

    const units = preview.columns.find((c) => c.name === 'units')
    expect(units?.type).toBe('ordinal')

    // One row is an exact duplicate of another.
    expect(preview.duplicateEstimate.rows).toBe(1)
    // One missing value in `revenue`.
    const missingRevenue = preview.missingByColumn.find((m) => m.column === 'revenue')
    expect(missingRevenue?.count).toBe(1)

    // Gzip compression estimate (skipped when CompressionStream is unavailable).
    if (preview.compression) {
      expect(preview.compression.originalBytes).toBeGreaterThan(0)
      expect(preview.compression.savings).toBeGreaterThanOrEqual(0)
    }
  })

  it('detects binary and datetime column types', async () => {
    const file = csvFile('flags.csv', 'flag,created\ntrue,2024-06-01\nfalse,2024-06-02\ntrue,2024-06-03\nfalse,2024-06-04')
    const preview = await analyzeFile(file)
    const flag = preview.columns.find((c) => c.name === 'flag')
    const created = preview.columns.find((c) => c.name === 'created')
    expect(flag?.type).toBe('binary')
    expect(created?.type).toBe('datetime')
  })

  it('classifies wide numeric columns as continuous', async () => {
    const values = Array.from({ length: 20 }, (_, i) => `row${i},${i * 3.5}`).join('\n')
    const preview = await analyzeFile(csvFile('wide.csv', `id,value\n${values}\n`))
    expect(preview.columns.find((c) => c.name === 'value')?.type).toBe('continuous')
  })

  it('parses a JSON array of objects', async () => {
    const file = new File([JSON.stringify([{ a: 1, b: 'x' }, { a: 2, b: 'y' }, { a: 5, b: 'z' }])], 'data.json', {
      type: 'application/json',
    })
    const preview = await analyzeFile(file)
    expect(preview.columnCount).toBe(2)
    expect(preview.estimatedRowCount).toBe(3)
    expect(preview.columns.find((c) => c.name === 'a')?.type).toBe('ordinal')
    expect(preview.columns.find((c) => c.name === 'b')?.type).toBe('categorical')
  })

  it('reads the first supported file inside a ZIP', async () => {
    const zip = zipSync({
      'nested/sales.csv': new TextEncoder().encode('city,sales\nNYC,100\nLAX,200'),
    })
    const file = new File([zip], 'archive.zip', { type: 'application/zip' })
    const preview = await analyzeFile(file)
    expect(preview.delimiter).toBe('Comma')
    expect(preview.estimatedRowCount).toBe(2)
    expect(preview.columnNames).toEqual(['city', 'sales'])
  })

  it('parses an Excel workbook (xlsx)', async () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['metric', 'value'],
        ['alpha', 1],
        ['beta', 2],
        ['gamma', 3],
      ]),
      'Sheet1',
    )
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    const file = new File([buf], 'book.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const preview = await analyzeFile(file)
    expect(preview.estimatedRowCount).toBe(3)
    expect(preview.columns.find((c) => c.name === 'metric')?.type).toBe('categorical')
    expect(preview.columns.find((c) => c.name === 'value')?.type).toBe('ordinal')
  })
})
