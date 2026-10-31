/**
 * Where the Home Assistant allow-list lives: SQLite's `kv` table, so it can be changed from
 * the settings page and take effect at once. (The address and token are the plugin registry's:
 * `integration.homeassistant` config and the encrypted secret store.)
 *
 * A `home.yaml` named by `HA_ALLOWLIST` is imported once, the first time a database has no
 * allow-list, so an install that used the file keeps working. After that the file is only an
 * import/export format.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HomeConfig } from '@mantel/shared';
import { kvGet, kvSet, type Db } from '../../db/index.js';
import { log } from '../../log.js';
import { EMPTY_CONFIG, normalizeHomeConfig, parseHomeConfig } from './home-config.js';

const CONFIG_KEY = 'home.config';

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
