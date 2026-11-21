import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhotosNextResponse, type PhotoSettings } from '@mantel/shared';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { PhotoCache } from './photos-cache.js';
import { exifTakenAt, parseExifDate } from './photos-exif.js';
import { readFolderPhoto, scanFolder } from './photos-folder.js';
import { ImmichClient } from './photos-immich.js';
import { PhotoMixer, type MixItem, type MixSource } from './photos-mixer.js';
import { fakeFetch, json, testContext } from './weather-testing.js';

let jpeg: Buffer;
let dated: Buffer;
beforeAll(async () => {
  jpeg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#3a7' } })
    .jpeg()
    .toBuffer();
  dated = await sharp(jpeg)
    .withExif({
      IFD0: { DateTime: '2020:01:01 00:00:00' },
      IFD2: { DateTimeOriginal: '2019:07:04 18:22:05' },
    })
    .jpeg()
    .toBuffer();
});

const tmp = () => mkdtempSync(join(tmpdir(), 'mantel-sources-'));

describe('EXIF dates', () => {
  it('reads DateTimeOriginal before DateTime', async () => {
    const meta = await sharp(dated).metadata();
    expect(exifTakenAt(meta.exif)).toBe('2019-07-04T18:22');
  });
  it('is null for photos without EXIF and for junk', async () => {
    expect(exifTakenAt((await sharp(jpeg).metadata()).exif)).toBeNull();
    expect(exifTakenAt(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(exifTakenAt(Buffer.from('Exif\0\0MM\0\x2a\0\0\0\x08\xff\xff'))).toBeNull();
  });
  it('rejects blank camera dates', () => {
    expect(parseExifDate('0000:00:00 00:00:00')).toBeNull();
    expect(parseExifDate('2001:02:03 04:05:06')).toBe('2001-02-03T04:05');
  });
});

describe('folder scanner', () => {
  it('finds photos in sub-folders, names albums after folders, skips hidden and HEIC', async () => {
    const root = tmp();
    mkdirSync(join(root, 'Camping 2022'));
    mkdirSync(join(root, '.thumbnails'));
    mkdirSync(join(root, '@eaDir'));
    writeFileSync(join(root, 'top.jpg'), jpeg);
    writeFileSync(join(root, 'Camping 2022', 'tent.JPG'), dated);
    writeFileSync(join(root, 'Camping 2022', 'phone.heic'), 'x');
    writeFileSync(join(root, '.thumbnails', 'small.jpg'), jpeg);
    writeFileSync(join(root, '@eaDir', 'syno.jpg'), jpeg);
    writeFileSync(join(root, 'notes.txt'), 'hello');
    const scan = await scanFolder(root);
    expect(scan.heic).toBe(1);
    expect(scan.photos.map((p) => p.remoteId).sort()).toEqual(['Camping 2022/tent.JPG', 'top.jpg']);
    expect(scan.photos.find((p) => p.remoteId === 'top.jpg')!.album).toBeUndefined();
    expect(scan.photos.find((p) => p.remoteId.startsWith('Camping'))!.album).toBe('Camping 2022');
    await expect(
      readFolderPhoto(root, { remoteId: '../../etc/passwd', version: '1' }),
    ).rejects.toThrow();
  });

  it('throws for a missing folder', async () => {
    await expect(scanFolder(join(tmp(), 'nope'))).rejects.toThrow();
  });

  it('caches folder photos with their EXIF date and drops deleted ones', async () => {
    const root = tmp();
    writeFileSync(join(root, 'a.jpg'), dated);
    writeFileSync(join(root, 'b.jpg'), jpeg);
    const ctx = testContext(new Date('2026-07-04T12:00:00Z'));
    const cache = new PhotoCache({
      ctx,
      prefix: 'folder',
      dir: tmp(),
      list: async () => (await scanFolder(root)).photos,
      read: (p) => readFolderPhoto(root, p),
    });
    await cache.refresh();
    expect(cache.items()).toHaveLength(2);
    const a = cache.items().find((p) => p.remoteId === 'a.jpg')!;
    expect(a.takenAt).toBe('2019-07-04T18:22');
    expect(a.id).toMatch(/^folder_[0-9a-f]{20}$/);
    expect((await cache.bytes(a.id))?.contentType).toBe('image/jpeg');
    expect(await cache.bytes('folder_../x')).toBeNull();
    // b.jpg removed: the cache forgets it and its file.
    const { rmSync } = await import('node:fs');
    rmSync(join(root, 'b.jpg'));
    await cache.refresh();
    expect(cache.items().map((p) => p.remoteId)).toEqual(['a.jpg']);
    expect(cache.status()).toMatchObject({ count: 1, error: null });
  });
});

const item = (id: string, takenAt: string | null = null): MixItem => ({
  id,
  width: 100,
  height: 70,
  dominant: '#112233',
  takenAt,
});

function source(id: MixSource['id'], items: MixItem[], enabled = true): MixSource {
  return {
    id,
    name: id,
    short: id,
    enabled: () => enabled,
    configured: () => true,
    items: () => items,
    bytes: async (x) =>
      items.some((i) => i.id === x)
        ? { contentType: 'image/jpeg', body: new Uint8Array([1]) }
        : null,
    status: () => ({ syncing: false, lastSync: null, error: null }),
  };
}

function mixer(
  sources: MixSource[],
  settings: Partial<PhotoSettings> = {},
  now = '2026-07-04T15:00:00Z',
) {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return new PhotoMixer({
    sources: () => sources,
    settings: () => ({ captions: true, onThisDay: true, weights: {}, ...settings }),
    timezone: () => 'America/Detroit',
    now: () => new Date(now),
    random,
  });
}

describe('source mixer', () => {
  it('shows every photo of a source before repeating', async () => {
    const m = mixer(
      [
        source(
          'immich',
          ['a', 'b', 'c', 'd'].map((x) => item(x)),
        ),
      ],
      { onThisDay: false },
    );
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) seen.push(...(await m.next(1)).photos.map((p) => p.id));
    expect(seen.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('mixes sources by weight, and leaves out off and disabled sources', async () => {
    const big = Array.from({ length: 100 }, (_, i) => item(`i${i}`));
    const small = Array.from({ length: 100 }, (_, i) => item(`f${i}`));
    const count = async (weights: PhotoSettings['weights']) => {
      const m = mixer([source('immich', big), source('photo-folder', small)], {
        weights,
        onThisDay: false,
      });
      let immich = 0;
      for (let i = 0; i < 50; i++)
        for (const p of (await m.next(4)).photos) if (p.id.startsWith('i')) immich++;
      return immich / 200;
    };
    expect(await count({})).toBeGreaterThan(0.35);
    expect(await count({})).toBeLessThan(0.65);
    expect(await count({ immich: 'more', 'photo-folder': 'less' })).toBeGreaterThan(0.7);
    expect(await count({ immich: 'off' })).toBe(0);
    const m = mixer([source('immich', big, false), source('photo-folder', small)]);
    expect((await m.next(10)).photos.every((p) => p.id.startsWith('f'))).toBe(true);
  });

  it('slips in On this day photos with a "years ago" caption', async () => {
    const photos = [
      ...Array.from({ length: 300 }, (_, i) => item(`x${i}`, '2024-03-02')),
      item('otd', '2021-07-04T09:10'),
      item('thisyear', '2026-07-04'),
    ];
    const m = mixer([source('immich', photos)]);
    const shown = [];
    for (let i = 0; i < 20; i++) shown.push(...(await m.next(3)).photos);
    const otd = shown.filter((p) => p.id === 'otd');
    expect(otd.length).toBeGreaterThan(8);
    expect(otd[0]!.caption).toMatchObject({ yearsAgo: 5, source: 'immich' });
    const sources = await m.sources();
    expect(sources[0]).toMatchObject({
      count: 302,
      onThisDay: 1,
      state: 'ready',
      weight: 'normal',
    });
  });

  it('uses the household time zone for "today"', async () => {
    // 02:00 UTC on 5 July is still 4 July in Detroit.
    const m = mixer([source('immich', [item('otd', '2020-07-04')])], {}, '2026-07-05T02:00:00Z');
    expect((await m.sources())[0]!.onThisDay).toBe(1);
  });

  it('omits captions when they are turned off, and routes bytes to the owning source', async () => {
    const m = mixer([source('immich', [item('a', '2020-01-01')]), source('photos', [item('b')])], {
      captions: false,
    });
    const { photos } = PhotosNextResponse.parse(await m.next(2));
    expect(photos.every((p) => p.caption === undefined)).toBe(true);
    expect(await m.bytes('b')).not.toBeNull();
    expect(await m.bytes('zzz')).toBeNull();
  });

  it('answers nothing when no source has photos', async () => {
    expect(await mixer([source('immich', [])]).next(5)).toEqual({ photos: [] });
  });
});

describe('Immich client', () => {
  const asset = (id: string, extra: object = {}) => ({
    id,
    type: 'IMAGE',
    checksum: `c-${id}`,
    localDateTime: '2019-07-04T18:22:05.000Z',
    exifInfo: { city: 'Traverse City', state: 'Michigan', country: 'USA' },
    ...extra,
  });
  const server = () =>
    fakeFetch(async (url, init) => {
      const headers = new Headers(init?.headers);
      if (headers.get('x-api-key') !== 'k') return json({ message: 'Invalid API key' }, 401);
      if (url.pathname === '/api/albums')
        return json([
          { id: 'al1', albumName: 'Family', assetCount: 2 },
          { id: 'al2', albumName: 'Work', assetCount: 9 },
        ]);
      if (url.pathname === '/api/search/metadata') {
        const body = JSON.parse(String(init?.body)) as {
          albumIds?: string[];
          isFavorite?: boolean;
          page: number;
        };
        if (body.albumIds?.[0] === 'al1')
          return json({
            assets: { items: [asset('f1'), asset('v1', { type: 'VIDEO' })], nextPage: null },
          });
        if (body.isFavorite)
          return json({
            assets: {
              items: [asset(`h${body.page}`)],
              nextPage: body.page < 2 ? String(body.page + 1) : null,
            },
          });
        return json({ assets: { items: [], nextPage: null } });
      }
      if (url.pathname === '/api/memories')
        return json([
          { type: 'on_this_day', data: { year: 2019 }, assets: [asset('m1'), asset('h1')] },
        ]);
      return undefined;
    });

  it('lists favourites across pages, adds memories once, and captions with the place', async () => {
    const client = new ImmichClient({
      url: 'http://immich.lan:2283/',
      apiKey: 'k',
      mode: 'favorites',
      albums: [],
      memories: true,
      limit: 100,
      fetch: server(),
    });
    const list = await client.list('2026-07-04');
    expect(list.map((p) => p.remoteId)).toEqual(['h1', 'h2', 'm1']);
    expect(list[0]).toMatchObject({
      album: 'Favourites',
      place: 'Traverse City, Michigan',
      takenAt: '2019-07-04T18:22',
      version: 'c-h1',
    });
  });

  it('reads chosen albums by name and leaves out videos', async () => {
    const client = new ImmichClient({
      url: 'http://immich.lan:2283/api',
      apiKey: 'k',
      mode: 'albums',
      albums: ['family', 'Nope'],
      memories: false,
      limit: 100,
      fetch: server(),
    });
    expect(await client.resolveAlbums()).toEqual({
      ids: [{ id: 'al1', name: 'Family' }],
      missing: ['Nope'],
    });
    expect((await client.list('2026-07-04')).map((p) => [p.remoteId, p.album])).toEqual([
      ['f1', 'Family'],
    ]);
  });

  it('says plainly when the key is wrong', async () => {
    const client = new ImmichClient({
      url: 'http://immich.lan:2283',
      apiKey: 'bad',
      mode: 'all',
      albums: [],
      memories: false,
      limit: 10,
      fetch: server(),
    });
    await expect(client.albums()).rejects.toThrow(/did not accept that API key/);
  });
});
