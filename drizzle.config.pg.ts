import { defineConfig } from 'drizzle-kit'

process.env.DB_DRIVER = 'pg'
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/statslab'

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: './db/migrations/pg',
  dbCredentials: { url: process.env.DATABASE_URL },
  strict: true,
  verbose: true,
})
