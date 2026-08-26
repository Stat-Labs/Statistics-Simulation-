export type DbDriver = 'pg' | 'sqlite'

/**
 * Resolves which database dialect to use at runtime.
 *
 * - Explicitly opt in with `DB_DRIVER=pg` or `DB_DRIVER=sqlite`.
 * - Otherwise: a `DATABASE_URL` set to a `postgres://` URL selects Postgres,
 *   and no `DATABASE_URL` falls back to local SQLite for frictionless dev.
 *
 * Production (Render) always sets `DATABASE_URL` → Postgres. Local `npm run dev`
 * works with zero infrastructure via the SQLite file at `db/statlab.sqlite`.
 */
export function detectDriver(): DbDriver {
  const url = process.env.DATABASE_URL ?? ''
  if (process.env.DB_DRIVER === 'pg') return 'pg'
  if (process.env.DB_DRIVER === 'sqlite') return 'sqlite'
  if (url.startsWith('sqlite')) return 'sqlite'
  if (url.length > 0) return 'pg'
  return 'sqlite'
}

export function isPg(): boolean {
  return detectDriver() === 'pg'
}
