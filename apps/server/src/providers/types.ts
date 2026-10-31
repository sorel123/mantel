/**
 * Provider interfaces: one per integration. Routes call these and never talk to an upstream
 * service directly. `MOCK=1` wires the fixture-backed implementations in `mock/`; otherwise
 * the real ones in `real/` (stubs until each workstream fills them in).
 *
 * Ownership: calendar (WS2), home + media (WS3), weather + commute + photos (WS4),
 * lists + chores (WS5). Settings and devices belong to the scaffold and WS6.
 */
import type { BodyOf, ResponseOf, Settings, WsEventInput } from '@mantel/shared';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';

export interface ProviderContext {
  config: Config;
  db: Db;
  /** Push an event to every connected display. */
  emit: (event: WsEventInput) => void;
  now: () => Date;
  /** Record a successful sync for `/api/health`. */
  markSynced: (source: string) => void;
  settings: () => Settings;
}

export interface CalendarProvider {
  events(from: Date, to: Date): Promise<ResponseOf<'calendar'>>;
  quickAdd(req: BodyOf<'calendarQuick'>): Promise<ResponseOf<'calendarQuick'>>;
  countdowns(): Promise<ResponseOf<'countdowns'>>;
  meals(week?: Date): Promise<ResponseOf<'meals'>>;
  calendars(): Promise<ResponseOf<'bootstrap'>['calendars']>;
}

export interface WeatherProvider {
  weather(): Promise<ResponseOf<'weather'>>;
  commute(): Promise<ResponseOf<'commute'>>;
}

export interface PhotoBytes {
  contentType: string;
  body: Uint8Array | string;
}

export interface PhotoProvider {
  next(n: number): Promise<ResponseOf<'photosNext'>>;
  /** null when the id is unknown. */
  bytes(id: string): Promise<PhotoBytes | null>;
}

/** Image bytes or a live stream (MJPEG) for camera and artwork routes. */
export interface HomeBytes {
  contentType: string;
  body: Uint8Array | string | ReadableStream<Uint8Array>;
}

export interface HomeProvider {
  state(): Promise<ResponseOf<'homeState'>>;
  call(req: BodyOf<'homeCall'>): Promise<ResponseOf<'homeCall'>>;
  announce(req: BodyOf<'homeAnnounce'>): Promise<ResponseOf<'homeAnnounce'>>;
  /** null when the camera is not allowed or unknown. */
  cameraSnapshot(entityId: string): Promise<HomeBytes | null>;
  /** Live view; `signal` aborts when the display closes it. null when not allowed. */
  cameraStream(entityId: string, signal: AbortSignal): Promise<HomeBytes | null>;
  media(): Promise<ResponseOf<'media'>>;
  mediaCall(req: BodyOf<'mediaCall'>): Promise<ResponseOf<'mediaCall'>>;
  /** null when the player has no artwork right now. */
  mediaArtwork(playerId: string): Promise<HomeBytes | null>;
}

export interface ListsProvider {
  lists(): Promise<ResponseOf<'lists'>>;
  addItem(listId: string, req: BodyOf<'listAddItem'>): Promise<ResponseOf<'listAddItem'>>;
  patchItem(itemId: string, req: BodyOf<'itemPatch'>): Promise<ResponseOf<'itemPatch'>>;
  deleteItem(itemId: string): Promise<ResponseOf<'itemDelete'>>;
  chores(): Promise<ResponseOf<'chores'>>;
  choreDone(choreId: string, personId?: string): Promise<ResponseOf<'choreDone'>>;
}

export interface Providers {
  calendar: CalendarProvider;
  weather: WeatherProvider;
  photos: PhotoProvider;
  home: HomeProvider;
  lists: ListsProvider;
}
