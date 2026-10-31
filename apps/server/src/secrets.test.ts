import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb } from './db/index.js';
import { SecretStore, loadOrCreateKey, open, seal } from './secrets.js';

const dir = mkdtempSync(join(tmpdir(), 'mantel-secrets-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('secrets', () => {
  it('seals and opens with the same key only', () => {
    const key = loadOrCreateKey(':memory:');
    const sealed = seal(key, 'hunter2');
    expect(sealed.data).not.toContain('hunter2');
    expect(open(key, sealed)).toBe('hunter2');
    expect(() => open(loadOrCreateKey(':memory:'), sealed)).toThrow();
  });

  it('creates secret.key once, owner-only, and reads it back', () => {
    const a = loadOrCreateKey(dir);
    const b = loadOrCreateKey(dir);
    expect(a.equals(b)).toBe(true);
    expect(a.length).toBe(32);
    if (process.platform !== 'win32')
      expect(statSync(join(dir, 'secret.key')).mode & 0o777).toBe(0o600);
  });

  it('stores per integration and reports keys without decrypting', () => {
    const db = openDb(':memory:');
    const store = new SecretStore(db, loadOrCreateKey(':memory:'));
    store.set('google', 'clientSecret', 'abc');
    store.set('homeassistant', 'token', 'tok');
    store.set('homeassistant', 'other', 'x');
    expect(store.get('google', 'clientSecret')).toBe('abc');
    expect(store.get('google', 'nope')).toBeUndefined();
    expect(store.keys('homeassistant').sort()).toEqual(['other', 'token']);
    expect(store.all('homeassistant')).toEqual({ token: 'tok', other: 'x' });
    store.set('google', 'clientSecret', 'def');
    expect(store.get('google', 'clientSecret')).toBe('def');
    store.delete('google', 'clientSecret');
    expect(store.get('google', 'clientSecret')).toBeUndefined();
  });

  it('survives a restart with the same key file', () => {
    const file = join(dir, 'mantel-db');
    const db1 = openDb(file);
    new SecretStore(db1, loadOrCreateKey(dir)).set('icloud', 'appPassword', 'pw');
    const db2 = openDb(file);
    expect(new SecretStore(db2, loadOrCreateKey(dir)).get('icloud', 'appPassword')).toBe('pw');
  });
});
