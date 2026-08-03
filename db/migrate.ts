/**
 * Applies the active driver's migrations.
 *
 * Run with: `npm run db:migrate`
 * (auto-runs before `npm run dev` via the `predev` script.)
 */
async function main() {
  const driver = process.env.DB_DRIVER ?? (process.env.DATABASE_URL ? 'pg' : 'sqlite')

  if (driver === 'pg') {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required for Postgres migrations')
    const postgres = (await import('postgres')).default
    const { drizzle } = await import('drizzle-orm/postgres-js')
    const { migrate } = await import('drizzle-orm/postgres-js/migrator')
    const client = postgres(url, { max: 1, prepare: false })
    await migrate(drizzle(client), { migrationsFolder: 'db/migrations/pg' })
    await client.end()
  } else {
    const { default: Database } = await import('better-sqlite3')
    const { drizzle } = await import('drizzle-orm/better-sqlite3')
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
    const path = await import('node:path')
    const fs = await import('node:fs')
    const dir = path.join(process.cwd(), 'db')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const sqlite = new Database(path.join(dir, 'statlab.sqlite'))
    await migrate(drizzle(sqlite), { migrationsFolder: 'db/migrations/sqlite' })
    sqlite.close()
  }

  console.log(`[db] migrations applied (${driver})`)
}

main().catch((err) => {
  console.error('[db] migration failed:', err)
  process.exit(1)
})
