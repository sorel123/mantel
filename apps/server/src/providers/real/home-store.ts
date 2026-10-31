/**
 * Where the Home Assistant setup lives: the allow-list and the connection, both in SQLite's
 * `kv` table so they can be changed from the settings page and take effect at once.
 *
 * A `home.yaml` named by `HA_ALLOWLIST` is imported once, the first time a database has no
 * allow-list, so an install that used the file keeps working. After that the file is only an
 * import/export format. `HA_URL` and `HA_TOKEN` stay as fallbacks until a URL and token are
 * saved in Settings.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HomeConfig } from '@mantel/shared';
import { kvGet, kvSet, type Db } from '../../db/index.js';
import { log } from '../../log.js';
import { EMPTY_CONFIG, normalizeHomeConfig, parseHomeConfig, type HaEnv } from './home-config.js';

const CONFIG_KEY = 'home.config';
const CONNECTION_KEY = 'home.connection';

export class HomeConfigStore {
  private current: HomeConfig;

  constructor(
    private readonly db: Db,
    opts: { importFrom?: string; fallback?: HomeConfig } = {},
    private readonly onChange: (config: HomeConfig) => void = () => {},
  ) {
    const stored = kvGet<unknown>(db, CONFIG_KEY);
    if (stored !== undefined) {
      try {
        this.current = normalizeHomeConfig(stored);
      } catch (err) {
        log.error(`home: stored allow-list is unreadable, starting empty (${String(err)})`);
        this.current = EMPTY_CONFIG;
      }
      return;
    }
    this.current = opts.fallback ?? EMPTY_CONFIG;
    if (opts.importFrom) {
      const path = resolve(opts.importFrom);
      if (existsSync(path)) {
        try {
          this.current = parseHomeConfig(readFileSync(path, 'utf8'));
          kvSet(db, CONFIG_KEY, this.current);
          log.info(
            `home: imported the allow-list from ${path} (${this.current.areas.length} areas). It now lives in the database; edit it on the Settings page.`,
          );
        } catch (err) {
          log.error(`home: ${err instanceof Error ? err.message : String(err)}; starting empty`);
        }
      }
    }
  }

  get(): HomeConfig {
    return this.current;
  }

  /** Replace the allow-list. Returns the normalized config; listeners hear about it. */
  put(raw: unknown): HomeConfig {
    this.current = normalizeHomeConfig(raw);
    kvSet(this.db, CONFIG_KEY, this.current);
    log.info(
      `home: allow-list saved (${this.current.areas.length} areas, ${this.current.scenes.length} scenes)`,
    );
    this.onChange(this.current);
    return this.current;
  }

  importYaml(text: string): HomeConfig {
    return this.put(parseHomeConfig(text));
  }
}

export interface HomeConnection {
  enabled: boolean;
  url: string;
  token: string;
  source: 'settings' | 'env' | 'none';
}

interface StoredConnection {
  enabled?: boolean;
  url?: string;
  token?: string;
}

export class HomeConnectionStore {
  private stored: StoredConnection;

  constructor(
    private readonly db: Db,
    private readonly env: Pick<HaEnv, 'HA_URL' | 'HA_TOKEN'>,
  ) {
    this.stored = kvGet<StoredConnection>(db, CONNECTION_KEY) ?? {};
  }

  get(): HomeConnection {
    const saved = !!(this.stored.url || this.stored.token);
    const url = this.stored.url || this.env.HA_URL || '';
    const token = this.stored.token || this.env.HA_TOKEN || '';
    return {
      // Off only when someone turned it off; a fresh install with HA env is on.
      enabled: this.stored.enabled ?? true,
      url,
      token,
      source: saved ? 'settings' : url || token ? 'env' : 'none',
    };
  }

  patch(p: { enabled?: boolean; url?: string; token?: string }): HomeConnection {
    const next: StoredConnection = { ...this.stored };
    if (p.enabled !== undefined) next.enabled = p.enabled;
    if (p.url !== undefined) next.url = p.url.replace(/\/+$/, '');
    // An empty token clears the saved one (falling back to the environment, if any).
    if (p.token !== undefined) next.token = p.token;
    if (!next.url) delete next.url;
    if (!next.token) delete next.token;
    this.stored = next;
    kvSet(this.db, CONNECTION_KEY, next);
    return this.get();
  }
}
