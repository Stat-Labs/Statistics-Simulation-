import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { unzipSync } from 'fflate'
import type { Column, DatasetSchema } from '@/lib/types'

export interface MissingSummary {
  column: string
  count: number
  percentage: number
}

export interface NumericSummary {
  column: string
  min: number
  max: number
  mean: number
  median: number
}

export interface CompressionEstimate {
  originalBytes: number
  compressedBytes: number
  savings: number // 0..1
  method: string
}

export interface FilePreview {
  fileName: string
  sizeBytes: number
  mimeType: string
  encoding: string
  delimiter: string
  estimatedRowCount: number
  columnCount: number
  columnNames: string[]
  columns: Column[]
  sampleRows: Record<string, unknown>[]
  missingByColumn: MissingSummary[]
  duplicateEstimate: { rows: number; ratio: number }
  numericSummaries: NumericSummary[]
  compression: CompressionEstimate | null
}

const MAX_PREVIEW_ROWS = 2000

export function detectEncoding(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer).slice(0, 4)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'UTF-8 (BOM)'
  }
  if (bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'UTF-16 LE'
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'UTF-16 BE'
  }
  return 'UTF-8'
}

export function detectDelimiter(firstLine: string): string {
  const counts: Record<string, number> = { ',': 0, '\t': 0, ';': 0, '|': 0 }
  for (const c of firstLine) {
    if (c in counts) counts[c] += 1
  }
  let best = ','
  let bestCount = 0
  for (const [delim, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = delim
      bestCount = count
    }
  }
  return best === '\t' ? 'TSV' : best === ';' ? 'Semicolon' : best === '|' ? 'Pipe' : 'Comma'
}

function detectType(values: unknown[]): Column['type'] {
  const nonEmpty = values.filter((v) => v !== '' && v !== null && v !== undefined)
  if (nonEmpty.length === 0) return 'categorical'
  const asStrings = nonEmpty.map((v) => String(v).trim().toLowerCase())
  const unique = new Set(asStrings)
  const BOOL_TOKENS = new Set(['0', '1', 'true', 'false', 'yes', 'no'])
  const boolLike = unique.size === 2 && asStrings.every((s) => BOOL_TOKENS.has(s))
  const numeric = asStrings.every((s) => s !== '' && Number.isFinite(Number(s)))
  if (numeric && !boolLike) {
    if (unique.size <= 15) return 'ordinal'
    return 'continuous'
  }
  const dateLike = asStrings.every((s) => !Number.isNaN(new Date(s).getTime()))
  if (dateLike && !numeric) return 'datetime'
  if (boolLike) return 'binary'
  if (unique.size === 2) return 'binary'
  return 'categorical'
}

function buildColumns(rows: Record<string, unknown>[]): Column[] {
  const fields = rows.length > 0 ? Object.keys(rows[0]) : []
  return fields.map((name) => {
    const values = rows.map((r) => r[name])
    const nonEmpty = values.filter((v) => v !== '' && v !== null && v !== undefined)
    const unique = [...new Set(nonEmpty.map((v) => String(v)))]
    const nums = nonEmpty.map(Number).filter(Number.isFinite)
    const col: Column = {
      name,
      type: detectType(nonEmpty),
      uniqueValues: unique.slice(0, 50),
      sampleValues: values.slice(0, 5),
      nullCount: values.filter((v) => v === '' || v === null || v === undefined).length,
    }
    if (nums.length > 0) {
      col.min = Math.min(...nums)
      col.max = Math.max(...nums)
      col.mean = nums.reduce((a, b) => a + b, 0) / nums.length
      const sorted = [...nums].sort((a, b) => a - b)
      col.median = sorted[Math.floor(sorted.length / 2)]
    }
    return col
  })
}

function summarize(rows: Record<string, unknown>[]): {
  columns: Column[]
  missingByColumn: MissingSummary[]
  duplicateEstimate: { rows: number; ratio: number }
  numericSummaries: NumericSummary[]
} {
  const columns = buildColumns(rows)
  const missingByColumn: MissingSummary[] = columns.map((c) => {
    const count = c.nullCount ?? 0
    return { column: c.name, count, percentage: rows.length ? (count / rows.length) * 100 : 0 }
  })
  const seen = new Set<string>()
  let dupes = 0
  for (const r of rows) {
    const key = JSON.stringify(r)
    if (seen.has(key)) dupes++
    else seen.add(key)
  }
  const numericSummaries: NumericSummary[] = columns
    .filter((c) => c.type === 'continuous')
    .map((c) => ({
      column: c.name,
      min: c.min ?? 0,
      max: c.max ?? 0,
      mean: c.mean ?? 0,
      median: c.median ?? 0,
    }))
  return {
    columns,
    missingByColumn,
    duplicateEstimate: { rows: dupes, ratio: rows.length ? dupes / rows.length : 0 },
    numericSummaries,
  }
}

async function gzipSize(buffer: ArrayBuffer): Promise<number | null> {
  try {
    const stream = new CompressionStream('gzip')
    const writer = stream.writable.getWriter()
    void writer.write(new Uint8Array(buffer))
    await writer.close()
    const compressed = await new Response(stream.readable).arrayBuffer()
    return compressed.byteLength
  } catch {
    return null
  }
}

function parseTextRows(text: string, delimiter: string): { rows: Record<string, unknown>[]; rowCount: number } {
  const slice = text.length > 2_000_000 ? text.slice(0, 2_000_000) : text
  const result = Papa.parse<Record<string, string>>(slice, {
    header: true,
    skipEmptyLines: true,
    delimiter: delimiter === 'TSV' ? '\t' : delimiter === 'Semicolon' ? ';' : delimiter === 'Pipe' ? '|' : ',',
    preview: MAX_PREVIEW_ROWS,
    transformHeader: (h) => h.trim(),
  })
  const rows = (result.data as Record<string, unknown>[]).filter((r) => Object.keys(r).length > 0)
  const newlines = (text.match(/\n/g) ?? []).length
  return { rows, rowCount: newlines }
}

function rowsFromExcel(data: ArrayBuffer | Uint8Array): { rows: Record<string, unknown>[]; rowCount: number } {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const workbook = XLSX.read(bytes, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' })
  return { rows: json.slice(0, MAX_PREVIEW_ROWS), rowCount: json.length }
}

function rowsFromJson(text: string): { rows: Record<string, unknown>[]; rowCount: number } {
  const value = JSON.parse(text) as unknown
  const asRecord = (v: unknown): Record<string, unknown> | null =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
  let arr: unknown[] = []
  if (Array.isArray(value)) {
    arr = value
  } else {
    const rec = asRecord(value)
    const data = rec?.data
    const results = rec?.results
    if (Array.isArray(data)) arr = data
    else if (Array.isArray(results)) arr = results
  }
  const rows = arr.filter((r) => r && typeof r === 'object').slice(0, MAX_PREVIEW_ROWS) as Record<string, unknown>[]
  return { rows, rowCount: arr.length }
}

/**
 * Runs entirely in the browser, immediately after file selection. Returns a
 * rich preview (rows, columns, types, missing values, duplicates, numerics,
 * encoding, delimiter, compression estimate) before anything is uploaded.
 */
export async function analyzeFile(file: File): Promise<FilePreview> {
  const buffer = await file.arrayBuffer()
  const encoding = detectEncoding(buffer)
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

  let rows: Record<string, unknown>[] = []
  let rowCount = 0
  let delimiter = ''

  if (ext === 'zip') {
    const inflated = unzipSafe(buffer)
    const entryName = Object.keys(inflated)[0]
    const inner = inflated[entryName]
    const innerName = entryName.split('/').pop() ?? 'inner.csv'
    const innerExt = innerName.split('.').pop()?.toLowerCase() ?? 'csv'
    if (innerExt === 'xlsx' || innerExt === 'xls') {
      const parsed = rowsFromExcel(inner)
      rows = parsed.rows
      rowCount = parsed.rowCount
    } else {
      const text = new TextDecoder().decode(inner)
      delimiter = detectDelimiter(text.slice(0, 500))
      const parsed = parseTextRows(text, delimiter)
      rows = parsed.rows
      rowCount = parsed.rowCount
    }
  } else if (ext === 'xlsx' || ext === 'xls') {
    const parsed = rowsFromExcel(buffer)
    rows = parsed.rows
    rowCount = parsed.rowCount
  } else if (ext === 'json') {
    try {
      const text = new TextDecoder().decode(buffer)
      const parsed = rowsFromJson(text)
      rows = parsed.rows
      rowCount = parsed.rowCount
    } catch {
      rows = []
    }
  } else {
    const text = new TextDecoder().decode(buffer)
    delimiter = detectDelimiter(text.slice(0, 500))
    const parsed = parseTextRows(text, delimiter)
    rows = parsed.rows
    rowCount = parsed.rowCount
  }

  const summary = summarize(rows)
  const columns = summary.columns
  const columnCount = columns.length

  // Compression estimate (gzip) for the raw bytes.
  let compression: CompressionEstimate | null = null
  const compressedBytes = await gzipSize(buffer)
  if (compressedBytes !== null) {
    compression = {
      originalBytes: buffer.byteLength,
      compressedBytes,
      savings: buffer.byteLength ? 1 - compressedBytes / buffer.byteLength : 0,
      method: 'gzip',
    }
  }

  const schema: DatasetSchema = {
    fileName: file.name,
    rowCount: rowCount || rows.length,
    columnCount,
    columns,
    sampleRows: rows.slice(0, 20),
    duplicateRowCount: summary.duplicateEstimate.rows,
  }

  return {
    fileName: file.name,
    sizeBytes: file.size,
    mimeType: file.type || 'application/octet-stream',
    encoding,
    delimiter,
    estimatedRowCount: rowCount || rows.length,
    columnCount,
    columnNames: columns.map((c) => c.name),
    columns,
    sampleRows: schema.sampleRows,
    missingByColumn: summary.missingByColumn,
    duplicateEstimate: summary.duplicateEstimate,
    numericSummaries: summary.numericSummaries,
    compression,
  }
}

function unzipSafe(buffer: ArrayBuffer): Record<string, Uint8Array> {
  const MAX_TOTAL = 100 * 1024 * 1024
  const MAX_FILES = 100
  const out: Record<string, Uint8Array> = {}
  const files = unzipSync(new Uint8Array(buffer))
  const names = Object.keys(files).filter((n) => !n.endsWith('/'))
  if (names.length === 0) throw new Error('ZIP contains no files')
  if (names.length > MAX_FILES) throw new Error('ZIP contains too many files')
  let total = 0
  for (const name of names) {
    const data = files[name]
    total += data.byteLength
    if (total > MAX_TOTAL) throw new Error('ZIP uncompressed size exceeds safety limit')
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    if (['csv', 'tsv', 'txt', 'json', 'xlsx', 'xls'].includes(ext)) {
      out[name] = data
      break // preview the first supported file only
    }
  }
  if (Object.keys(out).length === 0) throw new Error('ZIP contains no supported dataset files')
  return out
}
