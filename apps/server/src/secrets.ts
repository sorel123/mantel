/**
 * Integration secrets (OAuth client secrets, tokens, API keys, passwords) encrypted at rest
 * with AES-256-GCM. The key is generated on first run into `DATA_DIR/secret.key` (mode 0600)
 * and never leaves the machine; losing the file means re-entering the secrets. With
 * `DATA_DIR=:memory:` the key lives only in this process.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, like } from 'drizzle-orm';
import { schema, type Db } from './db/index.js';
import { log } from './log.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_FILE = 'secret.key';

/** Load the 32-byte key from `dataDir`, creating it on first run. */
export function loadOrCreateKey(dataDir: string): Buffer {
  if (dataDir === ':memory:') return randomBytes(32);
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, KEY_FILE);
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
    if (key.length !== 32) throw new Error(`${file} is not a 64-character hex key`);
    return key;
  }
  const key = randomBytes(32);
  writeFileSync(file, `${key.toString('hex')}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows has no POSIX modes; the file is still inside the data folder.
  }
  log.info(`secrets: created ${file}; back it up with the data folder`);
  return key;
}

export interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

export function seal(key: Buffer, plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function open(key: Buffer, sealed: Sealed): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Key-value store of secrets in the `secrets` table, keyed `<integrationId>.<field>`. */
export class SecretStore {
  constructor(
    private readonly db: Db,
    private readonly key: Buffer,
  ) {}

  static open(db: Db, dataDir: string): SecretStore {
    return new SecretStore(db, loadOrCreateKey(dataDir));
  }

  get(id: string, field: string): string | undefined {
    const row = this.db
      .select()
      .from(schema.secrets)
      .where(eq(schema.secrets.key, `${id}.${field}`))
      .get();
    if (!row) return undefined;
    try {
      return open(this.key, row);
    } catch (err) {
      log.error(`secrets: cannot decrypt ${id}.${field}; was secret.key replaced?`, {
        err: String(err),
      });
      return undefined;
    }
  }

  set(id: string, field: string, value: string): void {
    const row = {
      key: `${id}.${field}`,
      ...seal(this.key, value),
      updatedAt: new Date().toISOString(),
    };
    this.db
      .insert(schema.secrets)
      .values(row)
      .onConflictDoUpdate({
        target: schema.secrets.key,
        set: { iv: row.iv, tag: row.tag, data: row.data, updatedAt: row.updatedAt },
      })
      .run();
  }

  delete(id: string, field: string): void {
    this.db
      .delete(schema.secrets)
      .where(eq(schema.secrets.key, `${id}.${field}`))
      .run();
  }

  /** Every secret of one integration, decrypted. */
  all(id: string): Record<string, string> {
    const rows = this.db
      .select()
      .from(schema.secrets)
      .where(like(schema.secrets.key, `${id}.%`))
      .all();
    const out: Record<string, string> = {};
    for (const row of rows) {
      try {
        out[row.key.slice(id.length + 1)] = open(this.key, row);
      } catch {
        // Reported by get(); skip here.
      }
    }
    return out;
  }

  /** Field names that have a value, without decrypting. */
  keys(id: string): string[] {
    return this.db
      .select({ key: schema.secrets.key })
      .from(schema.secrets)
      .where(like(schema.secrets.key, `${id}.%`))
      .all()
      .map((r) => r.key.slice(id.length + 1));
  }
}
