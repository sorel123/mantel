/**
 * The shared half of every downloaded photo source (Immich, Google Photos, the photo folder).
 * A source says what photos it has (`list`) and how to read one (`read`); the cache downloads
 * the new and changed ones, renders them for the panel with `renderPhoto` (upright, cropped
 * around faces, sized for a 2x screen), reads the EXIF date when the source did not give one,
 * stores the JPEG under `DATA_DIR/photos/<source>/` and keeps an index in kv. Photos the
 * source no longer lists are deleted. The mixer reads `items()` and `bytes()`.
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PANEL, type PanelSize } from '@mantel/shared';
import sharp from 'sharp';
import { kvGet, kvSet } from '../../db/index.js';
import { log } from '../../log.js';
import type { PhotoBytes, ProviderContext } from '../types.js';
import { exifTakenAt } from './photos-exif.js';
import { renderPhoto } from './photos.js';

/** One photo as a source lists it. */
export interface RemotePhoto {
  /** The source's own id (an Immich asset id, a file path). Any string. */
  remoteId: string;
  /** Changes when the photo changes (a checksum, a file's size and mtime). */
  version: string;
  /** Local wall time `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`; undefined to read it from EXIF. */
  takenAt?: string | null;
  album?: string;
  place?: string;
}

/** One photo ready to show. `id` is safe for a URL and unique across sources. */
export interface CachedPhoto {
  id: string;
  remoteId: string;
  version: string;
  width: number;
  height: number;
  dominant: string;
  takenAt: string | null;
  album?: string;
  place?: string;
}

export interface PhotoCacheOptions {
  ctx: ProviderContext;
  /** Short and URL-safe: `immich`, `gphotos`, `folder`. Prefixes every id and names the folder. */
  prefix: string;
  /** What the source has now, newest first; the cache keeps the first `limit`. */
  list: () => Promise<RemotePhoto[]>;
  /** The original bytes of one photo. */
  read: (photo: RemotePhoto) => Promise<Uint8Array>;
  limit?: number;
  refreshMs?: number;
  /** Defaults to `DATA_DIR/photos/<prefix>`. */
  dir?: string;
  panel?: PanelSize;
  /** Downloads at once. */
  concurrency?: number;
}

interface Index {
  items: CachedPhoto[];
}

export interface PhotoCacheStatus {
  count: number;
  syncing: boolean;
  lastSync: string | null;
  error: string | null;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export class PhotoCache {
  private index: Index;
  private readonly dir: string;
  private readonly key: string;
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSync: string | null = null;
  private error: string | null = null;
  private stopped = false;

  constructor(private readonly o: PhotoCacheOptions) {
    const { ctx } = o;
    this.dir =
      o.dir ??
      (ctx.config.DATA_DIR === ':memory:'
        ? join(tmpdir(), 'mantel-photos', o.prefix)
        : join(ctx.config.DATA_DIR, 'photos', o.prefix));
    this.key = `photos.${o.prefix}`;
    this.index = kvGet<Index>(ctx.db, this.key) ?? { items: [] };
  }

  /** The id a remote photo is stored under: the prefix and a hash of its remote id. */
  idFor(remoteId: string): string {
    return `${this.o.prefix}_${createHash('sha1').update(remoteId).digest('hex').slice(0, 20)}`;
  }

  items(): readonly CachedPhoto[] {
    return this.index.items;
  }

  status(): PhotoCacheStatus {
    return {
      count: this.index.items.length,
      syncing: this.inflight !== null,
      lastSync: this.lastSync,
      error: this.error,
    };
  }

  /** Begin the refresh loop: now, then every `refreshMs`. */
  start() {
    this.stopped = false;
    void this.refresh();
    const every = this.o.refreshMs ?? 60 * 60_000;
    this.timer ??= setInterval(() => void this.refresh(), every);
    this.timer.unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Re-read the source now; resolves when every new photo is stored. One refresh at a time. */
  refresh(): Promise<void> {
    this.inflight ??= this.run()
      .then(() => {
        this.error = null;
        this.lastSync = this.o.ctx.now().toISOString();
        this.o.ctx.markSynced('photos');
      })
      .catch((err: unknown) => {
        this.error = err instanceof Error ? err.message : String(err);
        log.warn(`photos(${this.o.prefix}): refresh failed`, { err: this.error });
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** Delete every stored photo and the index (a source was disconnected). */
  async clear(): Promise<number> {
    const n = this.index.items.length;
    this.index = { items: [] };
    this.save();
    await rm(this.dir, { recursive: true, force: true });
    return n;
  }

  /** Add photos without listing the source (Google's picker hands them over once). */
  async add(
    photos: RemotePhoto[],
    onSaved?: (n: number) => void,
    read?: (photo: RemotePhoto) => Promise<Uint8Array>,
  ): Promise<number> {
    mkdirSync(this.dir, { recursive: true });
    let saved = 0;
    await this.process(photos, () => onSaved?.(++saved), read);
    return saved;
  }

  async bytes(id: string): Promise<PhotoBytes | null> {
    if (!SAFE_ID.test(id) || !this.index.items.some((p) => p.id === id)) return null;
    try {
      return {
        contentType: 'image/jpeg',
        body: new Uint8Array(await readFile(join(this.dir, `${id}.jpg`))),
      };
    } catch {
      return null;
    }
  }

  private save() {
    kvSet(this.o.ctx.db, this.key, this.index);
  }

  private async run() {
    const listed = (await this.o.list()).slice(0, this.o.limit ?? 2000);
    if (this.stopped) return;
    mkdirSync(this.dir, { recursive: true });
    const wanted = new Map(listed.map((p) => [this.idFor(p.remoteId), p]));

    const gone = this.index.items.filter((p) => !wanted.has(p.id));
    if (gone.length) {
      this.index.items = this.index.items.filter((p) => wanted.has(p.id));
      this.save();
      await Promise.all(gone.map((p) => rm(join(this.dir, `${p.id}.jpg`), { force: true })));
    }

    // Captions can change without the photo changing (an album renamed); update in place.
    const byId = new Map(this.index.items.map((p) => [p.id, p]));
    let touched = false;
    for (const [id, remote] of wanted) {
      const have = byId.get(id);
      if (!have || have.version !== remote.version) continue;
      if (have.album !== remote.album || have.place !== remote.place) {
        Object.assign(have, { album: remote.album, place: remote.place });
        touched = true;
      }
    }
    if (touched) this.save();

    const todo = listed.filter((p) => byId.get(this.idFor(p.remoteId))?.version !== p.version);
    if (todo.length) {
      log.info(`photos(${this.o.prefix}): processing ${todo.length} new photo(s)`);
      await this.process(todo);
    }
  }

  private async process(
    todo: RemotePhoto[],
    onSaved?: () => void,
    read: (photo: RemotePhoto) => Promise<Uint8Array> = this.o.read,
  ) {
    const panel = this.o.panel ?? DEFAULT_PANEL;
    let next = 0;
    const worker = async () => {
      while (next < todo.length && !this.stopped) {
        const remote = todo[next++]!;
        try {
          const original = await read(remote);
          const out = await renderPhoto(original, panel);
          let takenAt = remote.takenAt ?? null;
          if (remote.takenAt === undefined) {
            const meta = await sharp(original, { failOn: 'none' }).metadata();
            takenAt = exifTakenAt(meta.exif);
          }
          const id = this.idFor(remote.remoteId);
          await writeFile(join(this.dir, `${id}.jpg`), out.jpeg);
          const item: CachedPhoto = {
            id,
            remoteId: remote.remoteId,
            version: remote.version,
            width: out.width,
            height: out.height,
            dominant: out.dominant,
            takenAt,
            ...(remote.album ? { album: remote.album } : {}),
            ...(remote.place ? { place: remote.place } : {}),
          };
          this.index.items = [item, ...this.index.items.filter((p) => p.id !== id)];
          this.save();
          onSaved?.();
        } catch (err) {
          log.warn(`photos(${this.o.prefix}): skipped one`, { err: String(err) });
        }
      }
    };
    await Promise.all(Array.from({ length: this.o.concurrency ?? 2 }, worker));
  }
}
