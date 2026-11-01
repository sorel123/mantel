/**
 * Provider interfaces: one per integration. Routes call these and never talk to an upstream
 * service directly. `MOCK=1` wires the fixture-backed implementations in `mock/`; otherwise
 * the real ones in `real/` (stubs until each workstream fills them in).
 *
 * Ownership: calendar (WS2), home + media (WS3), weather + commute + photos (WS4),
 * lists + chores (WS5). Settings and devices belong to the scaffold and WS6.
 */
import type {
  BodyOf,
  CalendarEvent,
  HomeConfig,
  HomeConnectionStatus,
  HomeDiscovery,
  IntegrationConfig,
  IntegrationId,
  ResponseOf,
  Settings,
  ValueSource,
  WsEventInput,
} from '@mantel/shared';
import type { Hono } from 'hono';
import type { DeviceAuth } from '../auth.js';
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
  /**
   * Live values of an integration from the plugin registry (saved in Settings, else from the
   * environment): on/off, non-secret config and secrets by field key. Providers that need a
   * key (quips, routes) read it through `integrationValues(ctx, id)` instead of `process.env`.
   * Optional so hand-built test contexts keep compiling.
   */
  integration?: (id: IntegrationId) => IntegrationValues;
}

export interface IntegrationValues {
  enabled: boolean;
  config: IntegrationConfig;
  secrets: Record<string, string>;
  /** Where each field came from (`store` or `env`); absent when no registry is attached. */
  sources?: Record<string, ValueSource>;
}

/** An integration's live values, or "enabled with nothing set" when no registry is attached. */
export function integrationValues(ctx: ProviderContext, id: IntegrationId): IntegrationValues {
  return ctx.integration?.(id) ?? { enabled: true, config: {}, secrets: {} };
}

/** A provider that holds timers or sockets; the plugin registry calls `stop` before replacing it. */
export interface Stoppable {
  stop(): void;
}

export interface CalendarProvider {
  events(from: Date, to: Date): Promise<ResponseOf<'calendar'>>;
  quickAdd(req: BodyOf<'calendarQuick'>): Promise<ResponseOf<'calendarQuick'>>;
  countdowns(): Promise<ResponseOf<'countdowns'>>;
  meals(week?: Date): Promise<ResponseOf<'meals'>>;
  calendars(): Promise<ResponseOf<'bootstrap'>['calendars']>;
  /** Extra routes outside the contract: the calendar setup page and Google's OAuth and push callbacks. */
  mount?(api: Hono, auth: DeviceAuth): void;
}

export interface WeatherProvider {
  weather(): Promise<ResponseOf<'weather'>>;
  /** The same snapshot for another place (saved places and the sheet's search). */
  place(query: { lat: number; lon: number; name?: string }): Promise<ResponseOf<'weatherPlace'>>;
  search(q: string): Promise<ResponseOf<'weatherSearch'>>;
  /** Today's quip; `events` loads the day's calendar when a line is written by Claude. */
  quip(events: () => Promise<CalendarEvent[]>): Promise<ResponseOf<'weatherQuip'>>;
  /** Leave-by times for saved destinations, and (when `events` is given) for today's events that have an address. */
  commute(events?: () => Promise<CalendarEvent[]>): Promise<ResponseOf<'commute'>>;
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

/** The settings page's side of Home Assistant: connection, discovery and the stored allow-list. */
/**
 * The setup side of the Home provider. The address and token themselves belong to the plugin
 * registry (`PUT /api/integrations/homeassistant`, which rebuilds the provider); this is what
 * the Settings page reads and the allow-list it edits.
 */
export interface HomeSetup {
  connection(): HomeConnectionStatus;
  /** Resolve once the client is connected or has failed, or after `ms`. */
  ready(ms: number): Promise<void>;
  discover(): Promise<HomeDiscovery>;
  config(): HomeConfig;
  putConfig(config: unknown): HomeConfig;
  importYaml(text: string): HomeConfig;
  exportYaml(): string;
  /** False when Home Assistant is turned off in settings; `/home/*` then answers `disabled`. */
  enabled(): boolean;
}

export interface HomeProvider {
  setup: HomeSetup;
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
  createList(req: BodyOf<'listCreate'>): Promise<ResponseOf<'listCreate'>>;
  deleteList(listId: string): Promise<ResponseOf<'listDelete'>>;
  patchList(listId: string, req: BodyOf<'listPatch'>): Promise<ResponseOf<'listPatch'>>;
  reorderLists(req: BodyOf<'listsReorder'>): Promise<ResponseOf<'listsReorder'>>;
  chores(): Promise<ResponseOf<'chores'>>;
  choreDone(choreId: string, personId?: string): Promise<ResponseOf<'choreDone'>>;
  choreUndo(choreId: string): Promise<ResponseOf<'choreUndo'>>;
  createChore(req: BodyOf<'choreCreate'>): Promise<ResponseOf<'choreCreate'>>;
  deleteChore(choreId: string): Promise<ResponseOf<'choreDelete'>>;
}

export interface Providers {
  calendar: CalendarProvider;
  weather: WeatherProvider;
  photos: PhotoProvider;
  home: HomeProvider;
  lists: ListsProvider;
}
