import { defineConfig } from 'drizzle-kit'

process.env.DB_DRIVER = 'sqlite'

export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema.ts',
  out: './db/migrations/sqlite',
  dbCredentials: { url: './db/statlab.sqlite' },
  strict: true,
  verbose: true,
})
