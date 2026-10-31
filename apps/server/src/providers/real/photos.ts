/**
 * Real photos from a public iCloud Shared Album. Every hour the album is re-read; new photos
 * are downloaded, turned upright, cropped to the panel's shape (attention-weighted, so faces
 * stay in frame), sized for a 2x screen and stored as JPEG under `DATA_DIR/photos`, with
 * their dominant colour. `next()` plays them in shuffled order, newly added photos first.
 */
import { mkdirSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PANEL, type PanelSize, type Photo } from '@mantel/shared';
import sharp from 'sharp';
import { kvGet, kvSet } from '../../db/index.js';
import { log } from '../../log.js';
import type { PhotoProvider, ProviderContext } from '../types.js';
import { IcloudAlbum, type AlbumPhoto } from './photos-icloud.js';
import type { Ws4Env } from './weather-env.js';

export const PHOTO_REFRESH_MS = 60 * 60_000;
const KV_KEY = 'ws4.photos';
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

interface IndexedPhoto extends Photo {
  /** The derivative the stored file was made from; a new checksum means the photo was edited. */
  checksum: string;
  takenAt: string;
}

interface PhotoIndex {
  token: string;
  items: IndexedPhoto[];
}

export interface PhotosOptions {
  env: Ws4Env;
  fetch?: typeof fetch;
  /** Where the processed JPEGs live. Defaults to `DATA_DIR/photos`. */
  dir?: string;
  panel?: PanelSize;
}

/** Crop to the panel's aspect, size for up to 2x the panel (never upscaling past the source), and find the dominant colour. */
export async function renderPhoto(
  input: Uint8Array,
  panel: PanelSize = DEFAULT_PANEL,
): Promise<{ jpeg: Buffer; width: number; height: number; dominant: string }> {
  const meta = await sharp(input).metadata();
  const rotated = (meta.orientation ?? 1) >= 5;
  const sw = (rotated ? meta.height : meta.width) ?? panel.width;
  const sh = (rotated ? meta.width : meta.height) ?? panel.height;
  const cropWidth = Math.min(sw, (sh * panel.width) / panel.height);
  const scale = Math.max(0.25, Math.min(2, cropWidth / panel.width));
  const width = Math.round(panel.width * scale);
  const height = Math.round(panel.height * scale);
  const jpeg = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize(width, height, { fit: 'cover', position: sharp.strategy.attention })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true })
    .toBuffer();
  const { dominant } = await sharp(jpeg).resize(64, 64, { fit: 'fill' }).stats();
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return {
    jpeg,
    width,
    height,
    dominant: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`,
  };
}

function shuffle<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export function realPhotos(
  ctx: ProviderContext,
  opts: PhotosOptions,
): PhotoProvider & {
  /** Re-read the album now. Resolves when every new photo is processed. */
  refresh(): Promise<void>;
  /** Stop the hourly refresh (the plugin registry calls this before a rebuild). */
  stop(): void;
  /** True when an album link was given and understood. */
  readonly configured: boolean;
} {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const panel = opts.panel ?? DEFAULT_PANEL;
  const dir =
    opts.dir ??
    (ctx.config.DATA_DIR === ':memory:'
      ? join(tmpdir(), 'mantel-photos')
      : join(ctx.config.DATA_DIR, 'photos'));
  const url = opts.env.ICLOUD_SHARED_ALBUM_URL;

  let album: IcloudAlbum | null = null;
  if (url) {
    try {
      album = new IcloudAlbum(url, doFetch);
    } catch (err) {
      log.error(`photos: ${String(err)}`);
    }
  }

  const stored = kvGet<PhotoIndex>(ctx.db, KV_KEY);
  const index: PhotoIndex =
    stored && album && stored.token === album.token
      ? stored
      : { token: album?.token ?? '', items: [] };
  let queue: string[] = [];
  let inflight: Promise<void> | null = null;
  let lastRefresh = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const fileFor = (id: string) => join(dir, `${id}.jpg`);
  const save = () => kvSet(ctx.db, KV_KEY, index);

  async function process(photo: AlbumPhoto, src: string): Promise<IndexedPhoto> {
    const res = await doFetch(src, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`download answered ${res.status}`);
    const out = await renderPhoto(new Uint8Array(await res.arrayBuffer()), panel);
    await writeFile(fileFor(photo.guid), out.jpeg);
    return {
      id: photo.guid,
      width: out.width,
      height: out.height,
      dominant: out.dominant,
      checksum: photo.checksum,
      takenAt: photo.takenAt,
    };
  }

  async function refresh(): Promise<void> {
    if (!album) return;
    mkdirSync(dir, { recursive: true });
    const listed = (await album.photos()).filter((p) => SAFE_ID.test(p.guid));
    const wanted = listed.slice(0, opts.env.PHOTO_LIMIT);
    const wantedIds = new Set(wanted.map((p) => p.guid));

    const removed = index.items.filter((p) => !wantedIds.has(p.id));
    if (removed.length) {
      index.items = index.items.filter((p) => wantedIds.has(p.id));
      queue = queue.filter((id) => wantedIds.has(id));
      await Promise.all(removed.map((p) => rm(fileFor(p.id), { force: true })));
      save();
    }

    const known = new Map(index.items.map((p) => [p.id, p.checksum]));
    const todo = wanted.filter((p) => known.get(p.guid) !== p.checksum);
    if (todo.length) {
      log.info(`photos: processing ${todo.length} new photo(s)`);
      const urls = await album.assetUrls(todo.map((p) => p.guid));
      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const photo = todo[next++]!;
          const src = urls.get(photo.checksum);
          if (!src) continue;
          try {
            const item = await process(photo, src);
            index.items = [...index.items.filter((p) => p.id !== item.id), item];
            // Freshly shared photos go to the front so they show up on the wall soon.
            queue = [item.id, ...queue.filter((id) => id !== item.id)];
            save();
          } catch (err) {
            log.warn(`photos: skipped ${photo.guid}`, { err: String(err) });
          }
        }
      };
      await Promise.all([worker(), worker()]);
    }
    lastRefresh = ctx.now().getTime();
    ctx.markSynced('photos');
  }

  function refreshOnce(): Promise<void> {
    inflight ??= refresh()
      .catch((err: unknown) => log.warn('photos: album refresh failed', { err: String(err) }))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  function ensureRunning() {
    if (!album) return;
    if (!timer) {
      timer = setInterval(() => void refreshOnce(), PHOTO_REFRESH_MS);
      timer.unref?.();
    }
    if (ctx.now().getTime() - lastRefresh >= PHOTO_REFRESH_MS) void refreshOnce();
  }

  return {
    refresh: refreshOnce,
    configured: album !== null,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async next(n) {
      ensureRunning();
      const byId = new Map(index.items.map((p) => [p.id, p]));
      const out: Photo[] = [];
      const count = Math.min(n, byId.size);
      while (out.length < count) {
        if (!queue.length) queue = shuffle([...byId.keys()]);
        const id = queue.shift()!;
        const p = byId.get(id);
        if (p && !out.some((o) => o.id === id)) out.push(p);
      }
      return {
        photos: out.map(({ id, width, height, dominant }) => ({
          id,
          width,
          height,
          dominant,
          url: `/api/photos/${id}`,
        })),
      };
    },
    async bytes(id) {
      if (!SAFE_ID.test(id) || !index.items.some((p) => p.id === id)) return null;
      try {
        return { contentType: 'image/jpeg', body: new Uint8Array(await readFile(fileFor(id))) };
      } catch {
        return null;
      }
    },
  };
}
