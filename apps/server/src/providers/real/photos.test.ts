import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhotosNextResponse } from '@mantel/shared';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { albumHost, albumPhotos, albumToken } from './photos-icloud.js';
import { realPhotos, renderPhoto } from './photos.js';
import { loadWs4Env } from './weather-env.js';
import { fakeFetch, json, testContext } from './weather-testing.js';

const PANEL = { width: 1180, height: 820 };
const TOKEN = 'B0aGWZuqDGKPPjx';

let landscape: Buffer;
let portrait: Buffer;
beforeAll(async () => {
  // A warm orange frame with a blue block, so the dominant colour is predictable.
  landscape = await sharp({
    create: { width: 2048, height: 1536, channels: 3, background: '#d2691e' },
  })
    .composite([
      {
        input: await sharp({
          create: { width: 300, height: 300, channels: 3, background: '#1e3cd2' },
        })
          .png()
          .toBuffer(),
        left: 100,
        top: 100,
      },
    ])
    .jpeg()
    .toBuffer();
  portrait = await sharp({
    create: { width: 1536, height: 2048, channels: 3, background: '#2e8b57' },
  })
    .jpeg()
    .toBuffer();
});

describe('iCloud shared album', () => {
  it('reads the token and partition from a share link', () => {
    expect(albumToken(`https://www.icloud.com/sharedalbum/#${TOKEN}`)).toBe(TOKEN);
    expect(albumToken(`https://www.icloud.com/sharedalbum/en-us/#${TOKEN};CAEW`)).toBe(TOKEN);
    expect(() => albumToken('https://example.com/nope')).toThrow();
    // "0a" in base 62 is 36 (digits, then A-Z, then a-z); "A" tokens use one digit.
    expect(albumHost('B0aGWZuqDGKPPjx')).toBe('p36-sharedstreams.icloud.com');
    expect(albumHost('A7GWZuqDGKPPjx')).toBe('p07-sharedstreams.icloud.com');
  });

  it('picks the largest still derivative and skips videos, newest first', () => {
    const photos = albumPhotos({
      photos: [
        {
          photoGuid: 'OLD',
          dateCreated: '2026-01-01T00:00:00Z',
          derivatives: {
            '342': { checksum: 'small', width: 342, height: 256 },
            '2048': { checksum: 'big', width: 2048, height: 1536 },
          },
        },
        {
          photoGuid: 'VID',
          mediaAssetType: 'video',
          derivatives: { PosterFrame: { checksum: 'pf', width: 1280, height: 720 } },
        },
        {
          photoGuid: 'NEW',
          dateCreated: '2026-10-01T00:00:00Z',
          derivatives: { '2049': { checksum: 'tall', width: 1536, height: 2048 } },
        },
      ],
    });
    expect(photos.map((p) => [p.guid, p.checksum])).toEqual([
      ['NEW', 'tall'],
      ['OLD', 'big'],
    ]);
  });
});

describe('renderPhoto', () => {
  it('crops to the panel shape at up to 2x and finds the dominant colour', async () => {
    const out = await renderPhoto(landscape, PANEL);
    // 2048 wide source: crop is 2048 x 1423, so 1.74x the panel rather than an upscale to 2x.
    expect(out.width).toBe(2048);
    expect(out.height).toBe(1423);
    const meta = await sharp(out.jpeg).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([2048, 1423, 'jpeg']);
    expect(out.dominant).toMatch(/^#[0-9a-f]{6}$/);
    const [r, , b] = [1, 3, 5].map((i) => parseInt(out.dominant.slice(i, i + 2), 16)) as number[];
    expect(r!).toBeGreaterThan(b!);
  });

  it('fills the panel from a portrait photo', async () => {
    const out = await renderPhoto(portrait, PANEL);
    expect(out.width / out.height).toBeCloseTo(PANEL.width / PANEL.height, 2);
    expect(out.width).toBe(1536);
  });
});

describe('real photos provider', () => {
  function album(guids: string[]) {
    const stream = {
      photos: guids.map((g, i) => ({
        photoGuid: g,
        dateCreated: `2026-10-0${i + 1}T00:00:00Z`,
        derivatives: { '2048': { checksum: `ck-${g}`, width: '2048', height: '1536' } },
      })),
    };
    return fakeFetch(
      // The token's partition is wrong on purpose: iCloud answers 330 with the real host.
      (url) =>
        url.host === 'p36-sharedstreams.icloud.com'
          ? json({ 'X-Apple-MMe-Host': 'p42-sharedstreams.icloud.com' }, 330)
          : undefined,
      (url) =>
        url.host === 'p42-sharedstreams.icloud.com' && url.pathname.endsWith('/webstream')
          ? json(stream)
          : undefined,
      (url, init) => {
        if (!url.pathname.endsWith('/webasseturls')) return undefined;
        const { photoGuids } = JSON.parse(String(init?.body)) as { photoGuids: string[] };
        return json({
          items: Object.fromEntries(
            photoGuids.map((g) => [
              `ck-${g}`,
              { url_location: 'cvws.icloud-content.com', url_path: `/S/${g}.jpg` },
            ]),
          ),
        });
      },
      (url) =>
        url.host === 'cvws.icloud-content.com'
          ? new Response(new Uint8Array(landscape), { headers: { 'content-type': 'image/jpeg' } })
          : undefined,
    );
  }

  const setup = (fetch: ReturnType<typeof album>, ctx = testContext(new Date())) =>
    realPhotos(ctx, {
      env: loadWs4Env({ ICLOUD_SHARED_ALBUM_URL: `https://www.icloud.com/sharedalbum/#${TOKEN}` }),
      fetch,
      dir: mkdtempSync(join(tmpdir(), 'mantel-photos-test-')),
      panel: PANEL,
    });

  it('indexes the album, processes photos and serves them', async () => {
    const ctx = testContext(new Date());
    const provider = setup(album(['AAA', 'BBB', 'CCC']), ctx);
    await provider.refresh();
    const next = PhotosNextResponse.parse(await provider.next(5));
    expect(next.photos.map((p) => p.id).sort()).toEqual(['AAA', 'BBB', 'CCC']);
    expect(next.photos[0]).toMatchObject({ width: 2048, height: 1423 });
    expect(next.photos[0]!.url).toBe(`/api/photos/${next.photos[0]!.id}`);
    const bytes = await provider.bytes('AAA');
    expect(bytes?.contentType).toBe('image/jpeg');
    expect((await sharp(bytes!.body as Uint8Array).metadata()).width).toBe(2048);
    expect(await provider.bytes('../../etc/passwd')).toBeNull();
    expect(await provider.bytes('ZZZ')).toBeNull();
    expect(ctx.markSynced).toHaveBeenCalledWith('photos');
  });

  it('cycles through every photo before repeating', async () => {
    const provider = setup(album(['A1', 'B2', 'C3', 'D4']));
    await provider.refresh();
    const seen = [];
    for (let i = 0; i < 4; i++) seen.push(...(await provider.next(1)).photos.map((p) => p.id));
    expect(seen.sort()).toEqual(['A1', 'B2', 'C3', 'D4']);
  });

  it('drops photos removed from the album', async () => {
    const ctx = testContext(new Date());
    const dir = mkdtempSync(join(tmpdir(), 'mantel-photos-test-'));
    const env = loadWs4Env({ ICLOUD_SHARED_ALBUM_URL: TOKEN });
    const first = realPhotos(ctx, { env, fetch: album(['KEEP', 'GONE']), dir, panel: PANEL });
    await first.refresh();
    expect(await first.bytes('GONE')).not.toBeNull();
    // A restart with a new album listing reuses the stored index and only drops what left.
    const fetch = album(['KEEP']);
    const second = realPhotos(ctx, { env, fetch, dir, panel: PANEL });
    await second.refresh();
    expect(await second.bytes('GONE')).toBeNull();
    expect((await second.next(5)).photos.map((p) => p.id)).toEqual(['KEEP']);
    expect(fetch.mock.calls.some(([u]) => String(u).includes('cvws'))).toBe(false);
  });

  it('serves nothing when no album is configured', async () => {
    const provider = realPhotos(testContext(new Date()), { env: loadWs4Env({}) });
    expect(await provider.next(3)).toEqual({ photos: [] });
    expect(await provider.bytes('AAA')).toBeNull();
  });
});
