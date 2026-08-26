import { schema } from './schema'
import { detectDriver, type DbDriver } from './driver'

/**
 * Shared database client.
 *
 * Production (Vercel/Render) uses Postgres via `postgres-js`; local dev falls
 * back to SQLite (`db/statlab.sqlite`) so `npm run dev` needs no infrastructure.
 *
 * The client is cached per-process to reuse connections across requests. On
 * serverless runtimes a module-level singleton is the standard pattern.
 */
type AnyDb = ReturnType<typeof import('drizzle-orm/postgres-js').drizzle>

let cachedDb: AnyDb | null = null
let cachedDriver: DbDriver | null = null

export function getDriver(): DbDriver {
  if (!cachedDriver) cachedDriver = detectDriver()
  return cachedDriver
}

export async function getDb(): Promise<AnyDb> {
  if (cachedDb) return cachedDb

  const driver = getDriver()

  if (driver === 'pg') {
    const url = process.env.DATABASE_URL
    if (!url) {
      throw new Error(
        'DATABASE_URL is required for the Postgres driver. Set DB_DRIVER=sqlite for local development.',
      )
    }
    const postgres = (await import('postgres')).default
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const needsSsl = url.includes('sslmode=require') || url.includes('ssl=true') ||
      /neon|supabase|render|railway|fly\.io|elephantsql|croxy/i.test(url)
    const client = postgres(url, {
      max: 5,
      prepare: false,
      connect_timeout: 15,
      ssl: needsSsl ? 'require' : undefined,
    })
    cachedDb = drizzle(client, { schema }) as unknown as AnyDb
    return cachedDb
  }

  const { default: Database } = await import('better-sqlite3')
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const path = await import('node:path')
  const fs = await import('node:fs')
  const dir = path.join(process.cwd(), 'db')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const sqlite = new Database(path.join(dir, 'statlab.sqlite'))
  sqlite.pragma('journal_mode = WAL')
  cachedDb = drizzle(sqlite, { schema }) as unknown as AnyDb
  return cachedDb
}

/** Best-effort close for tests / long-running processes. */
export async function closeDb(): Promise<void> {
  cachedDb = null
  cachedDriver = null
}
