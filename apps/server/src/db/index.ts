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
