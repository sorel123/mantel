import { DEVICE_KEY_HEADER, type PhotoRef } from '@mantel/shared';
import { api } from '../../lib/api';

export interface LoadedPhoto {
  photo: PhotoRef;
  /** An object URL for the bytes; hand it back with `release` when the slide is gone. */
  src: string;
}

export interface PhotoFeedOptions {
  /** Ask the server for the next `n` photos. */
  list?: (n: number) => Promise<PhotoRef[]>;
  /** Fetch one photo's bytes. */
  bytes?: (photo: PhotoRef) => Promise<Blob>;
  /** Wait until the image can paint without a flash. */
  decode?: (src: string) => Promise<void>;
  batch?: number;
}

/** The photo route needs the device-key header, which `<img src>` cannot send, so bytes come through fetch. */
async function fetchBytes(photo: PhotoRef): Promise<Blob> {
  const key = api.deviceKey;
  const res = await fetch(photo.url, { headers: key ? { [DEVICE_KEY_HEADER]: key } : {} });
  if (!res.ok) throw new Error(`photo ${photo.id}: ${res.status}`);
  return res.blob();
}

function decodeImage(src: string): Promise<void> {
  const img = new Image();
  img.src = src;
  return img.decode().catch(() => undefined);
}

/**
 * The ambient slideshow's supply: lists photos from the server in batches and keeps the next
 * one downloaded and decoded, so a slide is always ready when the timer fires.
 */
export class PhotoFeed {
  private refs: PhotoRef[] = [];
  private ahead: Promise<LoadedPhoto | null> | null = null;
  private readonly list: (n: number) => Promise<PhotoRef[]>;
  private readonly bytes: (photo: PhotoRef) => Promise<Blob>;
  private readonly decode: (src: string) => Promise<void>;
  private readonly batch: number;

  constructor(opts: PhotoFeedOptions = {}) {
    this.list =
      opts.list ?? ((n) => api.call('photosNext', { query: { n } }).then((r) => r.photos));
    this.bytes = opts.bytes ?? fetchBytes;
    this.decode = opts.decode ?? decodeImage;
    this.batch = opts.batch ?? 8;
  }

  /** The next photo, ready to show, or null when the album is empty or unreachable. Preloads the one after. */
  async next(): Promise<LoadedPhoto | null> {
    const current = await (this.ahead ?? this.load());
    this.ahead = current ? this.load() : null;
    return current;
  }

  release(src: string) {
    URL.revokeObjectURL(src);
  }

  /** Drop the preloaded photo (the slideshow is closing). */
  dispose() {
    void this.ahead?.then((p) => p && this.release(p.src));
    this.ahead = null;
  }

  private async load(): Promise<LoadedPhoto | null> {
    // A photo can vanish between listing and fetching (removed from the album); try a few.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!this.refs.length) this.refs = await this.list(this.batch).catch(() => []);
      const photo = this.refs.shift();
      if (!photo) return null;
      try {
        const src = URL.createObjectURL(await this.bytes(photo));
        await this.decode(src);
        return { photo, src };
      } catch {
        continue;
      }
    }
    return null;
  }
}
