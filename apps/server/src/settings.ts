import { Settings } from '@mantel/shared';
import { settings as defaultSettings } from '@mantel/shared/fixtures';
import { kvGet, kvSet, type Db } from './db/index.js';

const KEY = 'settings';

/** Settings live in SQLite; the fixture values are the defaults for a fresh install. */
export class SettingsStore {
  private cached: Settings;

  constructor(private readonly db: Db) {
    const stored = kvGet<unknown>(db, KEY);
    const parsed = Settings.safeParse(stored);
    this.cached = parsed.success ? parsed.data : defaultSettings();
  }

  get(): Settings {
    return this.cached;
  }

  put(next: Settings): Settings {
    this.cached = Settings.parse(next);
    kvSet(this.db, KEY, this.cached);
    return this.cached;
  }
}
