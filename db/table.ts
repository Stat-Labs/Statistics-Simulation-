/**
 * Dialect-agnostic table builder.
 *
 * The schema in `db/schema.ts` is written once against a portable column subset
 * (text / integer / real + JSON via text columns). At import time we pick the
 * correct creator based on the active driver, so the same file describes both
 * the Postgres (production) and SQLite (local dev) databases.
 *
 * TYPES are always the Postgres dialect so the schema and every query remain
 * fully typed. RUNTIME switches to the SQLite builders when running locally
 * without a Postgres server — both dialects share the column subset we use.
 */
import * as pg from 'drizzle-orm/pg-core'
import * as sqlite from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { detectDriver } from './driver'

const driver = detectDriver()
const isPg = driver === 'pg'

export const table = (isPg ? pg.pgTable : sqlite.sqliteTable) as unknown as typeof pg.pgTable
export const text = (isPg ? pg.text : sqlite.text) as unknown as typeof pg.text
export const integer = (isPg ? pg.integer : sqlite.integer) as unknown as typeof pg.integer
export const real = (isPg ? pg.real : sqlite.real) as unknown as typeof pg.real
export const index = (isPg ? pg.index : sqlite.index) as unknown as typeof pg.index
export const uniqueIndex = (isPg ? pg.uniqueIndex : sqlite.uniqueIndex) as unknown as typeof pg.uniqueIndex

export type AnyColumn = pg.AnyPgColumn

/**
 * JSON columns are plain TEXT in both dialects; we encode/decode explicitly so
 * the storage format is identical on Postgres and SQLite. These helpers are the
 * only place that touches the encoding.
 */
export function jsonify(v: unknown): string | null {
  if (v === null || v === undefined) return null
  try {
    return JSON.stringify(v)
  } catch {
    return null
  }
}

/** Like `jsonify` but never returns null — for `NOT NULL` JSON columns. */
export function jsonifyRequired(v: unknown): string {
  const s = jsonify(v)
  return s ?? 'null'
}

export function parseJson<T>(v: string | null | undefined): T | null {
  if (!v) return null
  try {
    return JSON.parse(v) as T
  } catch {
    return null
  }
}
