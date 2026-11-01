import Database from 'better-sqlite3'
import { CamelCasePlugin, Kysely, SqliteDialect } from 'kysely'
import type { DB } from './schema'

// SQL files bundled into the main process at build time.
const MIGRATIONS = import.meta.glob<string>('./migrations/*.sql', { query: '?raw', import: 'default', eager: true })

let instance: { db: Kysely<DB>; raw: Database.Database } | null = null

/** Open (or create) the local database and bring it up to date. */
export function openDatabase(file: string) {
  const raw = new Database(file)
  raw.pragma('journal_mode = WAL')
  raw.pragma('busy_timeout = 5000')
  migrate(raw)
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: raw }), plugins: [new CamelCasePlugin()] })
  instance = { db, raw }
  return instance
}

export function db(): Kysely<DB> {
  if (!instance) throw new Error('Database not opened')
  return instance.db
}

export function rawDb(): Database.Database {
  if (!instance) throw new Error('Database not opened')
  return instance.raw
}

export async function closeDatabase(): Promise<void> {
  await instance?.db.destroy()
  instance = null
}

function migrate(raw: Database.Database): void {
  raw.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set(raw.prepare('SELECT name FROM _migrations').pluck().all() as string[])
  const pending = Object.entries(MIGRATIONS)
    .map(([path, sql]) => ({ name: path.split('/').pop()!, sql }))
    .filter((m) => !applied.has(m.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const m of pending) {
    raw.transaction(() => {
      raw.exec(m.sql)
      raw.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(m.name, new Date().toISOString())
    })()
  }
}
