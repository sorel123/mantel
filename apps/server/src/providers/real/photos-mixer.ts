/**
 * One slideshow from every photo source (v4 S). Each source hands over the photos it has
 * ready; the mixer picks the next few by per-source weight, slips in "On this day" photos
 * (taken on today's date in an earlier year) about one slide in three, never repeats a photo
 * until its source has shown them all, and attaches the caption the display draws.
 *
 * Weighting: a source's share is `sqrt(count) * factor`, factor from Settings (off 0, less
 * 0.5, normal 1, more 2). The square root keeps a 40-photo Google pick from drowning under a
 * 5,000-photo Immich library while still giving the bigger library more turns.
 */
import {
  PHOTO_WEIGHT_FACTOR,
  type PhotoCaption,
  type PhotoRef,
  type PhotoSettings,
  type PhotoSourceId,
  type PhotoSourceInfo,
  type PhotoWeight,
} from '@mantel/shared';
import type { PhotoBytes, PhotoProvider } from '../types.js';
import { dateInZone } from './weather-time.js';

export interface MixItem {
  id: string;
  width: number;
  height: number;
  dominant: string;
  /** Local wall time `YYYY-MM-DD...`, when known. */
  takenAt: string | null;
  album?: string;
  place?: string;
}

export interface MixSource {
  id: PhotoSourceId;
  /** Shown in Settings: "Immich", "Photo folder". */
  name: string;
  /** Short name in a caption: "iCloud". */
  short: string;
  /** False when the plugin is off; its photos are left out. */
  enabled(): boolean;
  /** False when nothing is set up (the source is listed in Settings as "not set up"). */
  configured(): boolean;
  items(): readonly MixItem[];
  bytes(id: string): Promise<PhotoBytes | null>;
  /** Kick a refresh if the source is stale (called when the display asks for photos). */
  touch?(): void;
  status(): { syncing: boolean; lastSync: string | null; error: string | null };
}

export interface MixerOptions {
  sources: () => MixSource[];
  settings: () => PhotoSettings;
  timezone: () => string;
  now: () => Date;
  random?: () => number;
}

/** Share of slides given to "On this day" photos when there are any. */
export const ON_THIS_DAY_SHARE = 1 / 3;

/** `MM-DD` of a local date string. */
const monthDay = (s: string) => s.slice(5, 10);

export class PhotoMixer implements PhotoProvider {
  /** Per source, the ids not yet shown this round. */
  private queues = new Map<string, string[]>();
  private otdQueue: string[] = [];
  private otdDay = '';
  private readonly random: () => number;

  constructor(private readonly o: MixerOptions) {
    this.random = o.random ?? Math.random;
  }

  private weight(id: PhotoSourceId): PhotoWeight {
    return this.o.settings().weights[id] ?? 'normal';
  }

  private today(): string {
    return dateInZone(this.o.now(), this.o.timezone());
  }

  /** Photos taken on today's month and day in an earlier year. */
  private isOnThisDay(item: MixItem, today: string): boolean {
    return (
      !!item.takenAt &&
      item.takenAt.length >= 10 &&
      monthDay(item.takenAt) === monthDay(today) &&
      item.takenAt.slice(0, 4) < today.slice(0, 4)
    );
  }

  private shuffle<T>(items: T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  async next(n: number): Promise<{ photos: PhotoRef[] }> {
    const settings = this.o.settings();
    const today = this.today();
    const active = this.o
      .sources()
      .filter((s) => s.enabled())
      .map((s) => {
        s.touch?.();
        return { source: s, items: s.items(), factor: PHOTO_WEIGHT_FACTOR[this.weight(s.id)] };
      })
      .filter((s) => s.items.length > 0 && s.factor > 0);
    if (!active.length) return { photos: [] };

    const byId = new Map<string, { item: MixItem; source: MixSource }>();
    for (const s of active)
      for (const item of s.items) byId.set(item.id, { item, source: s.source });

    const otdIds = settings.onThisDay
      ? [...byId.values()].filter((e) => this.isOnThisDay(e.item, today)).map((e) => e.item.id)
      : [];
    if (this.otdDay !== today) {
      this.otdDay = today;
      this.otdQueue = [];
    }

    const total = Math.min(n, byId.size);
    const out: PhotoRef[] = [];
    const used = new Set<string>();
    let guard = 0;
    while (out.length < total && guard++ < total * 20) {
      let picked: string | undefined;
      let fromOtd = false;
      if (otdIds.length && this.random() < ON_THIS_DAY_SHARE) {
        if (!this.otdQueue.length) this.otdQueue = this.shuffle(otdIds);
        picked = this.otdQueue.shift();
        fromOtd = true;
      } else {
        const weights = active.map((s) => Math.sqrt(s.items.length) * s.factor);
        const sum = weights.reduce((a, b) => a + b, 0);
        let r = this.random() * sum;
        let chosen = active[active.length - 1]!;
        for (let i = 0; i < active.length; i++) {
          r -= weights[i]!;
          if (r < 0) {
            chosen = active[i]!;
            break;
          }
        }
        let queue = (this.queues.get(chosen.source.id) ?? []).filter((id) => byId.has(id));
        if (!queue.length) queue = this.shuffle(chosen.items.map((i) => i.id));
        picked = queue.shift();
        this.queues.set(chosen.source.id, queue);
      }
      if (!picked || used.has(picked)) continue;
      const entry = byId.get(picked);
      if (!entry) continue;
      used.add(picked);
      out.push(this.ref(entry.item, entry.source, settings, fromOtd ? today : null));
    }
    return { photos: out };
  }

  private ref(
    item: MixItem,
    source: MixSource,
    settings: PhotoSettings,
    otdToday: string | null,
  ): PhotoRef {
    const base: PhotoRef = {
      id: item.id,
      width: item.width,
      height: item.height,
      dominant: item.dominant,
      url: `/api/photos/${item.id}`,
    };
    if (!settings.captions) return base;
    const caption: PhotoCaption = { source: source.short };
    if (item.album) caption.album = item.album;
    if (item.place) caption.place = item.place;
    if (item.takenAt) caption.takenAt = item.takenAt;
    if (otdToday && item.takenAt) {
      const years = Number(otdToday.slice(0, 4)) - Number(item.takenAt.slice(0, 4));
      if (years > 0) caption.yearsAgo = years;
    }
    return { ...base, caption };
  }

  async bytes(id: string): Promise<PhotoBytes | null> {
    for (const s of this.o.sources()) {
      if (!s.items().some((i) => i.id === id)) continue;
      return s.bytes(id);
    }
    return null;
  }

  async sources(): Promise<PhotoSourceInfo[]> {
    const today = this.today();
    return this.o.sources().map((s) => {
      const items = s.items();
      const st = s.status();
      const state: PhotoSourceInfo['state'] = !s.enabled()
        ? 'disabled'
        : !s.configured()
          ? 'not_set_up'
          : st.syncing
            ? 'syncing'
            : st.error && !items.length
              ? 'error'
              : 'ready';
      return {
        id: s.id,
        name: s.name,
        count: items.length,
        onThisDay: items.filter((i) => this.isOnThisDay(i, today)).length,
        weight: this.weight(s.id),
        state,
        lastSync: st.lastSync,
        error: st.error,
      };
    });
  }
}
