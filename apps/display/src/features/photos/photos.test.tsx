import type { PhotoRef } from '@mantel/shared';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoFeed } from './feed';
import { PhotoSlideshow } from './PhotoSlideshow';

const ref = (id: string): PhotoRef => ({
  id,
  width: 1180,
  height: 820,
  dominant: '#C96B5C',
  url: `/api/photos/${id}`,
});

let urls = 0;
beforeEach(() => {
  urls = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => `blob:${urls++}`),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function feed(ids: string[], opts: { missing?: string[] } = {}) {
  let cursor = 0;
  const list = vi.fn(async (n: number) =>
    Array.from({ length: Math.min(n, ids.length) }, () => ref(ids[cursor++ % ids.length]!)),
  );
  const bytes = vi.fn(async (p: PhotoRef) => {
    if (opts.missing?.includes(p.id)) throw new Error('404');
    return new Blob([p.id]);
  });
  return {
    feed: new PhotoFeed({ list, bytes, decode: async () => undefined, batch: 2 }),
    list,
    bytes,
  };
}

describe('PhotoFeed', () => {
  it('hands out photos in order and keeps the next one loaded', async () => {
    const { feed: f, bytes, list } = feed(['a', 'b', 'c']);
    expect((await f.next())?.photo.id).toBe('a');
    // 'b' is already downloading.
    expect(bytes).toHaveBeenCalledTimes(2);
    expect((await f.next())?.photo.id).toBe('b');
    expect((await f.next())?.photo.id).toBe('c');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('skips photos that fail to download', async () => {
    const { feed: f } = feed(['a', 'gone', 'c'], { missing: ['gone'] });
    expect((await f.next())?.photo.id).toBe('a');
    expect((await f.next())?.photo.id).toBe('c');
  });

  it('answers null for an empty album', async () => {
    const { feed: f } = feed([]);
    expect(await f.next()).toBeNull();
  });
});

describe('PhotoSlideshow', () => {
  it('cross-dissolves to the next photo on each interval and releases old ones', async () => {
    vi.useFakeTimers();
    const { feed: f } = feed(['a', 'b', 'c', 'd']);
    const seen: Array<string | undefined> = [];
    const { container, unmount } = render(
      <PhotoSlideshow feed={f} intervalMs={9000} onPhoto={(p) => seen.push(p?.id)} />,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    const slides = () => [...container.querySelectorAll('.ph-slide')];
    expect(slides()).toHaveLength(1);
    expect(seen).toEqual(['a']);

    await act(() => vi.advanceTimersByTimeAsync(9000));
    // Outgoing photo stays underneath while the new one fades in on top.
    expect(slides().map((s) => s.querySelector('img')!.getAttribute('src'))).toEqual([
      'blob:0',
      'blob:1',
    ]);
    expect((slides()[1] as HTMLElement).style.backgroundColor).toBe('rgb(201, 107, 92)');

    await act(() => vi.advanceTimersByTimeAsync(9000));
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(slides()).toHaveLength(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:0');

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:2');
  });

  it('waits a minute and asks again when there are no photos', async () => {
    vi.useFakeTimers();
    const { feed: f, list } = feed([]);
    render(<PhotoSlideshow feed={f} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(list).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(59_000));
    expect(list).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(list).toHaveBeenCalledTimes(2);
  });
});
