/**
 * Reader for a public iCloud Shared Album ("Public Website" turned on in the album's
 * settings). The album page is backed by two unauthenticated endpoints:
 *
 *   POST https://pNN-sharedstreams.icloud.com/<token>/sharedstreams/webstream
 *     {"streamCtag":null} -> the album's photos and their size derivatives
 *   POST .../webasseturls  {"photoGuids":[...]} -> short-lived download URLs per derivative
 *
 * NN comes from the token; if it is wrong the server answers 330 with the right host.
 */
import { z } from 'zod';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** The album token from a share link (`https://www.icloud.com/sharedalbum/#B0aGWZuqDGKPPjx`) or a bare token. */
export function albumToken(urlOrToken: string): string {
  const raw = urlOrToken.includes('#') ? urlOrToken.slice(urlOrToken.indexOf('#') + 1) : urlOrToken;
  const token = raw.split(';')[0]!.trim();
  if (!/^[A-Za-z0-9]{8,}$/.test(token))
    throw new Error('ICLOUD_SHARED_ALBUM_URL does not look like a shared album link');
  return token;
}

/** The shared-streams host for a token: `p` + server partition, from the token's leading base-62 digits. */
export function albumHost(token: string): string {
  const b62 = (s: string) => [...s].reduce((n, ch) => n * 62 + BASE62.indexOf(ch), 0);
  const partition = token[0] === 'A' ? b62(token.slice(1, 2)) : b62(token.slice(1, 3));
  return `p${String(partition).padStart(2, '0')}-sharedstreams.icloud.com`;
}

const Derivative = z.object({
  checksum: z.string(),
  width: z.coerce.number().optional(),
  height: z.coerce.number().optional(),
  fileSize: z.coerce.number().optional(),
});

export const WebstreamJson = z.object({
  streamName: z.string().optional(),
  photos: z.array(
    z.object({
      photoGuid: z.string(),
      dateCreated: z.string().optional(),
      batchDateCreated: z.string().optional(),
      caption: z.string().optional(),
      mediaAssetType: z.string().optional(),
      derivatives: z.record(z.string(), Derivative),
    }),
  ),
});
export type WebstreamJson = z.infer<typeof WebstreamJson>;

export const AssetUrlsJson = z.object({
  items: z.record(
    z.string(),
    z.object({ url_location: z.string(), url_path: z.string(), url_expiry: z.string().optional() }),
  ),
});

export interface AlbumPhoto {
  guid: string;
  /** ISO time the photo was taken or added, for newest-first ordering. */
  takenAt: string;
  caption?: string;
  /** The largest still derivative. */
  checksum: string;
  width: number;
  height: number;
}

/** Still photos (videos skipped) with their largest derivative, newest first. */
export function albumPhotos(json: WebstreamJson): AlbumPhoto[] {
  const out: AlbumPhoto[] = [];
  for (const p of json.photos) {
    if (p.mediaAssetType === 'video') continue;
    let best: z.infer<typeof Derivative> | undefined;
    for (const [name, d] of Object.entries(p.derivatives)) {
      if (name === 'PosterFrame' || !d.width || !d.height) continue;
      if (!best || d.width * d.height > best.width! * best.height!) best = d;
    }
    if (!best) continue;
    out.push({
      guid: p.photoGuid,
      takenAt: p.dateCreated ?? p.batchDateCreated ?? new Date(0).toISOString(),
      caption: p.caption || undefined,
      checksum: best.checksum,
      width: best.width!,
      height: best.height!,
    });
  }
  return out.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

export class IcloudAlbum {
  readonly token: string;
  private host: string;

  constructor(
    urlOrToken: string,
    private readonly doFetch: typeof fetch,
  ) {
    this.token = albumToken(urlOrToken);
    this.host = albumHost(this.token);
  }

  private async post(endpoint: string, body: unknown, redirects = 2): Promise<unknown> {
    const res = await this.doFetch(`https://${this.host}/${this.token}/sharedstreams/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'https://www.icloud.com' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 330 && redirects > 0) {
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const host = json?.['X-Apple-MMe-Host'] ?? res.headers.get('x-apple-mme-host');
      if (typeof host !== 'string' || !/^[a-z0-9.-]+\.icloud\.com$/.test(host))
        throw new Error('iCloud redirected without a usable host');
      this.host = host;
      return this.post(endpoint, body, redirects - 1);
    }
    if (!res.ok) throw new Error(`iCloud ${endpoint} answered ${res.status}`);
    return res.json();
  }

  async photos(): Promise<AlbumPhoto[]> {
    return albumPhotos(WebstreamJson.parse(await this.post('webstream', { streamCtag: null })));
  }

  /** Download URLs by checksum. They expire after a few hours, so fetch them just before use. */
  async assetUrls(guids: string[]): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    for (let i = 0; i < guids.length; i += 25) {
      const json = AssetUrlsJson.parse(
        await this.post('webasseturls', { photoGuids: guids.slice(i, i + 25) }),
      );
      for (const [checksum, item] of Object.entries(json.items))
        urls.set(checksum, `https://${item.url_location}${item.url_path}`);
    }
    return urls;
  }
}
