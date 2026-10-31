import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Paired displays. Only the SHA-256 of each key is stored. */
export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at'),
  revokedAt: text('revoked_at'),
  /** JSON `DeviceOverrides` (look, defaultScreen, fit, scale), or null. */
  overrides: text('overrides'),
});

/** Encrypted integration secrets (AES-256-GCM), keyed `<integrationId>.<field>`. */
export const secrets = sqliteTable('secrets', {
  key: text('key').primaryKey(),
  iv: text('iv').notNull(),
  tag: text('tag').notNull(),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Small JSON values: settings, sync cursors, tokens. */
export const kv = sqliteTable('kv', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/* ---- WS5: lists and chores (the built-in store) ---- */

export const lists = sqliteTable('lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sort: integer('sort').notNull(),
  createdAt: text('created_at').notNull(),
  /** Id of the list in a synced source (Reminders, later); null for local-only lists. */
  remoteId: text('remote_id'),
});

export const listItems = sqliteTable('list_items', {
  id: text('id').primaryKey(),
  listId: text('list_id')
    .notNull()
    .references(() => lists.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull(),
  personId: text('person_id'),
  sort: integer('sort').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
  remoteId: text('remote_id'),
});

export const chores = sqliteTable('chores', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  personId: text('person_id').notNull(),
  cadence: text('cadence', { enum: ['daily', 'weekly'] }).notNull(),
  stars: integer('stars').notNull(),
  target: integer('target').notNull(),
  sort: integer('sort').notNull(),
  createdAt: text('created_at').notNull(),
  /** Set when a chore is retired; its completions keep counting toward this week's stars. */
  archivedAt: text('archived_at'),
});

/** One row per tap on the chore chart. Stars are copied so changing a chore never rewrites history. */
export const choreCompletions = sqliteTable('chore_completions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  choreId: text('chore_id')
    .notNull()
    .references(() => chores.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull(),
  /** Local calendar date of the completion, `YYYY-MM-DD`. */
  day: text('day').notNull(),
  at: text('at').notNull(),
  stars: integer('stars').notNull(),
});
