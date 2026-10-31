import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Tables are created here with plain SQL, idempotently. A workstream that needs a table adds
 * it to `schema.ts` and appends its `CREATE TABLE IF NOT EXISTS` to this list.
 */
const migrations = [
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // WS5: lists and chores
  `CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    remote_id TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS list_items (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL,
    person_id TEXT,
    sort INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    remote_id TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS list_items_list ON list_items (list_id, sort)`,
  `CREATE TABLE IF NOT EXISTS chores (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    person_id TEXT NOT NULL,
    cadence TEXT NOT NULL,
    stars INTEGER NOT NULL,
    target INTEGER NOT NULL,
    sort INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    archived_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS chore_completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chore_id TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL,
    day TEXT NOT NULL,
    at TEXT NOT NULL,
    stars INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS chore_completions_day ON chore_completions (day)`,
];

export function openDb(dataDir: string): Db {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    mkdirSync(dataDir, { recursive: true });
    file = join(dataDir, 'mantel.db');
  }
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  for (const sql of migrations) sqlite.exec(sql);
  return drizzle(sqlite, { schema });
}

export function kvGet<T>(db: Db, key: string): T | undefined {
  const row = db.select().from(schema.kv).where(eq(schema.kv.key, key)).get();
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function kvSet(db: Db, key: string, value: unknown): void {
  const row = { key, value: JSON.stringify(value), updatedAt: new Date().toISOString() };
  db.insert(schema.kv)
    .values(row)
    .onConflictDoUpdate({
      target: schema.kv.key,
      set: { value: row.value, updatedAt: row.updatedAt },
    })
    .run();
}

export { schema };
