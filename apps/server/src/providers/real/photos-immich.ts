/**
 * Immich (v4 S): a household's self-hosted photo library. Reads with an API key
 * (`x-api-key`), using these endpoints, checked against the Immich API docs (v1.140):
 *
 *   GET  /api/albums                          albums, for picking by name (needs album.read)
 *   POST /api/search/metadata                 photos: favourites, an album, or everything,
 *                                             newest first, with EXIF (needs asset.read)
 *   GET  /api/memories?for=...&type=on_this_day   Immich's own "On this day" (memory.read)
 *   GET  /api/assets/:id/thumbnail?size=preview   a JPEG about 1440 px on the long side
 *
 * The preview is used rather than the original because originals are often HEIC, which the
 * server cannot decode, and the preview is already the right size for a wall.
 */
import { z } from 'zod';
import type { RemotePhoto } from './photos-cache.js';

export type ImmichMode = 'favorites' | 'albums' | 'all';

export interface ImmichOptions {
  url: string;
  apiKey: string;
  mode: ImmichMode;
  /** Album names (or ids), for `albums` mode. */
  albums: string[];
  memories: boolean;
  limit: number;
  fetch?: typeof fetch;
}

const Album = z.object({
  id: z.string(),
  albumName: z.string(),
  assetCount: z.number().optional(),
});
const Asset = z.object({
  id: z.string(),
  type: z.string().optional(),
  checksum: z.string().optional(),
  localDateTime: z.string().optional(),
  fileCreatedAt: z.string().optional(),
  exifInfo: z
    .object({
      city: z.string().nullish(),
      state: z.string().nullish(),
      country: z.string().nullish(),
    })
    .nullish(),
});
type Asset = z.infer<typeof Asset>;
const SearchResponse = z.object({
  assets: z.object({ items: z.array(Asset), nextPage: z.string().nullish() }),
});
const Memory = z.object({
  type: z.string().optional(),
  data: z.object({ year: z.number().optional() }).partial().optional(),
  assets: z.array(Asset).default([]),
});

export class ImmichError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** `https://photos.example.net/` or `http://192.168.1.5:2283/api` to the server root. */
export function immichBase(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/, '');
}

export class ImmichClient {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly o: ImmichOptions) {
    this.base = immichBase(o.url);
    this.doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}/api${path}`, {
        ...init,
        headers: {
          'x-api-key': this.o.apiKey,
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ImmichError(
        `Mantel could not reach Immich at ${this.base}. Check the address and that Immich is running.`,
      );
    }
    if (res.status === 401)
      throw new ImmichError(
        'Immich did not accept that API key. Make a new one and paste it again.',
        401,
      );
    if (res.status === 403)
      throw new ImmichError(
        'That API key is missing a permission. Give it album.read, asset.read, asset.view and memory.read, or All.',
        403,
      );
    if (!res.ok) throw new ImmichError(`Immich answered ${res.status} for ${path}.`, res.status);
    return res;
  }

  async albums(): Promise<z.infer<typeof Album>[]> {
    const res = await this.call('/albums');
    return z.array(Album).parse(await res.json());
  }

  /** Album ids for the configured names; names that match nothing are returned in `missing`. */
  async resolveAlbums(): Promise<{ ids: { id: string; name: string }[]; missing: string[] }> {
    const all = await this.albums();
    const ids: { id: string; name: string }[] = [];
    const missing: string[] = [];
    for (const want of this.o.albums) {
      const hit =
        all.find((a) => a.id === want) ??
        all.find((a) => a.albumName.trim().toLowerCase() === want.trim().toLowerCase());
      if (hit) ids.push({ id: hit.id, name: hit.albumName });
      else missing.push(want);
    }
    return { ids, missing };
  }

  private async search(filter: Record<string, unknown>, max: number): Promise<Asset[]> {
    const out: Asset[] = [];
    let page: number | null = 1;
    while (page && out.length < max) {
      const res = await this.call('/search/metadata', {
        method: 'POST',
        body: JSON.stringify({
          ...filter,
          type: 'IMAGE',
          withExif: true,
          order: 'desc',
          page,
          size: Math.min(250, max - out.length),
        }),
      });
      const body = SearchResponse.parse(await res.json());
      out.push(...body.assets.items);
      page = body.assets.nextPage ? Number(body.assets.nextPage) || null : null;
    }
    return out;
  }

  /** Immich's "On this day" photos for `day` (local `YYYY-MM-DD`). Empty when the server has no memories. */
  async memories(day: string): Promise<Asset[]> {
    try {
      const res = await this.call(
        `/memories?for=${encodeURIComponent(`${day}T12:00:00.000Z`)}&type=on_this_day`,
      );
      const list = z.array(Memory).parse(await res.json());
      return list.flatMap((m) => m.assets).filter((a) => !a.type || a.type === 'IMAGE');
    } catch (err) {
      // Older servers and keys without memory.read: carry on without them.
      if (err instanceof ImmichError && err.status !== undefined && err.status !== 401) return [];
      throw err;
    }
  }

  /** Every photo to show, newest first, with Immich's memories for `today` added. */
  async list(today: string): Promise<RemotePhoto[]> {
    const seen = new Set<string>();
    const out: RemotePhoto[] = [];
    const push = (assets: Asset[], album?: string) => {
      for (const a of assets) {
        if (seen.has(a.id) || (a.type && a.type !== 'IMAGE')) continue;
        seen.add(a.id);
        out.push(toRemote(a, album));
      }
    };
    if (this.o.mode === 'albums') {
      const { ids } = await this.resolveAlbums();
      for (const album of ids)
        push(await this.search({ albumIds: [album.id] }, this.o.limit - out.length), album.name);
    } else if (this.o.mode === 'favorites') {
      push(await this.search({ isFavorite: true }, this.o.limit), 'Favourites');
    } else {
      push(await this.search({}, this.o.limit));
    }
    if (this.o.memories) push(await this.memories(today));
    return out;
  }

  async preview(id: string): Promise<Uint8Array> {
    const res = await this.call(`/assets/${encodeURIComponent(id)}/thumbnail?size=preview`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

function toRemote(a: Asset, album?: string): RemotePhoto {
  const local = a.localDateTime ?? a.fileCreatedAt;
  const place = [a.exifInfo?.city, a.exifInfo?.state ?? a.exifInfo?.country]
    .filter(Boolean)
    .join(', ');
  return {
    remoteId: a.id,
    version: a.checksum ?? a.id,
    // localDateTime is the wall time where the photo was taken, written with a Z.
    takenAt: local && /^\d{4}-\d{2}-\d{2}/.test(local) ? local.slice(0, 16) : null,
    ...(album ? { album } : {}),
    ...(place ? { place } : {}),
  };
}
