/**
 * A small Home Assistant client: one WebSocket for auth, state, registries, events and
 * service calls (reconnecting with backoff, with a ping heartbeat), plus authenticated REST
 * fetches for camera images and media artwork.
 *
 * https://developers.home-assistant.io/docs/api/websocket
 */
import WebSocket from 'ws';
import { log } from '../../log.js';

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface HaArea {
  area_id: string;
  name: string;
}
export interface HaEntityEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
  platform: string;
  hidden_by: string | null;
  disabled_by: string | null;
  entity_category: string | null;
}
export interface HaDevice {
  id: string;
  area_id: string | null;
}

export interface HaRegistry {
  areas: HaArea[];
  entities: HaEntityEntry[];
  devices: HaDevice[];
}

export interface HaClientEvents {
  /** Connected, authenticated and caches loaded. `previous` is the cache before a reconnect. */
  ready: (previous: Map<string, HaState>) => void;
  state: (entityId: string, next: HaState | null, prev: HaState | null) => void;
  down: (reason: string) => void;
}

export class HaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HaError';
  }
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

const COMMAND_TIMEOUT_MS = 10_000;
const PING_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

export interface HaClientOptions {
  url: string;
  token: string;
  /** Overridable for tests. */
  pingMs?: number;
  minBackoffMs?: number;
  commandTimeoutMs?: number;
}

export class HaClient {
  readonly states = new Map<string, HaState>();
  registry: HaRegistry = { areas: [], entities: [], devices: [] };
  /** Temperature unit from HA's unit system, e.g. `°F`. */
  temperatureUnit = '°C';
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners: { [K in keyof HaClientEvents]: Set<HaClientEvents[K]> } = {
    ready: new Set(),
    state: new Set(),
    down: new Set(),
  };
  private stateSub: number | null = null;
  private retry = 0;
  private retryTimer: NodeJS.Timeout | undefined;
  private pingTimer: NodeJS.Timeout | undefined;
  private stopped = true;
  private everReady = false;
  private _connected = false;
  private readonly base: string;

  constructor(private readonly opts: HaClientOptions) {
    this.base = opts.url.replace(/\/+$/, '');
  }

  get connected() {
    return this._connected;
  }

  /** True once states have loaded at least once (the cache may be stale while reconnecting). */
  get hasStates() {
    return this.everReady;
  }

  on<K extends keyof HaClientEvents>(event: K, fn: HaClientEvents[K]): () => void {
    this.listeners[event].add(fn);
    return () => this.listeners[event].delete(fn);
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.ws?.removeAllListeners();
    // Terminating a socket that is still connecting emits 'error'; with no listener left
    // that would be an uncaught exception.
    this.ws?.on('error', () => {});
    this.ws?.terminate();
    this.ws = null;
    this._connected = false;
    this.failPending(new HaError('not_connected', 'Home Assistant client stopped'));
  }

  /** Call a service on one entity. Rejects with the HA error message on failure. */
  async callService(
    domain: string,
    service: string,
    entityId: string | string[] | null,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.command({
      type: 'call_service',
      domain,
      service,
      service_data: data,
      ...(entityId ? { target: { entity_id: entityId } } : {}),
    });
  }

  /** Resolve with the entity's next state, or its current one after `ms`. */
  waitForChange(entityId: string, ms: number): Promise<HaState | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        off();
        resolve(this.states.get(entityId) ?? null);
      }, ms);
      const off = this.on('state', (id, next) => {
        if (id !== entityId) return;
        clearTimeout(timer);
        off();
        resolve(next);
      });
    });
  }

  /**
   * GET a Home Assistant path with the token. Absolute URLs (some integrations point artwork at
   * a CDN) are fetched as they are, and the token is only sent to Home Assistant itself.
   */
  async fetch(path: string, signal?: AbortSignal): Promise<Response> {
    const url = /^https?:\/\//.test(path) ? path : `${this.base}${path}`;
    const ours = url.startsWith(`${this.base}/`);
    const res = await fetch(url, {
      headers: ours ? { authorization: `Bearer ${this.opts.token}` } : {},
      signal,
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new HaError(`http_${res.status}`, `Home Assistant answered ${res.status} for ${path}`);
    }
    return res;
  }

  /* ---------- connection ---------- */

  private connect() {
    const wsUrl = `${this.base.replace(/^http/, 'ws')}/api/websocket`;
    const ws = new WebSocket(wsUrl, { handshakeTimeout: 10_000 });
    this.ws = ws;
    let authed = false;

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: this.opts.token }));
      } else if (msg.type === 'auth_ok') {
        authed = true;
        void this.onAuthed();
      } else if (msg.type === 'auth_invalid') {
        log.error(`home: Home Assistant rejected the token (${String(msg.message ?? '')})`);
        ws.close();
      } else if (authed) {
        this.onMessage(msg);
      }
    });
    ws.on('error', (err) => log.debug('home: socket error', { err: String(err) }));
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      const was = this._connected;
      this._connected = false;
      this.stateSub = null;
      clearInterval(this.pingTimer);
      this.failPending(new HaError('not_connected', 'Home Assistant connection closed'));
      if (was) {
        log.warn('home: lost connection to Home Assistant; reconnecting');
        this.emit('down', 'closed');
      }
      if (this.stopped) return;
      const min = this.opts.minBackoffMs ?? 1000;
      const delay = Math.min(MAX_BACKOFF_MS, min * 2 ** this.retry++);
      this.retryTimer = setTimeout(() => this.connect(), delay);
      this.retryTimer.unref();
    });
  }

  private async onAuthed() {
    try {
      // Subscribe before fetching states so no change falls in the gap. Events for the
      // subscription carry the id of the command that made it, which is the next id.
      this.stateSub = this.nextId;
      await this.command({ type: 'subscribe_events', event_type: 'state_changed' });
      const [states, config, areas, entities, devices] = await Promise.all([
        this.command<HaState[]>({ type: 'get_states' }),
        this.command<{ unit_system?: { temperature?: string } }>({ type: 'get_config' }),
        this.command<HaArea[]>({ type: 'config/area_registry/list' }).catch(() => []),
        this.command<HaEntityEntry[]>({ type: 'config/entity_registry/list' }).catch(() => []),
        this.command<HaDevice[]>({ type: 'config/device_registry/list' }).catch(() => []),
      ]);
      const previous = new Map(this.states);
      this.states.clear();
      for (const s of states) this.states.set(s.entity_id, s);
      this.registry = { areas, entities, devices };
      this.temperatureUnit = config.unit_system?.temperature ?? this.temperatureUnit;
      this.retry = 0;
      this._connected = true;
      this.everReady = true;
      this.startPing();
      log.info(`home: connected to Home Assistant (${states.length} entities)`);
      this.emit('ready', previous);
    } catch (err) {
      log.warn('home: setup after auth failed; reconnecting', { err: String(err) });
      this.ws?.close();
    }
  }

  private onMessage(msg: Record<string, unknown>) {
    const id = typeof msg.id === 'number' ? msg.id : -1;
    if (msg.type === 'event' && id === this.stateSub) {
      const event = msg.event as {
        data?: { entity_id?: string; new_state?: HaState | null; old_state?: HaState | null };
      };
      const data = event?.data;
      if (!data?.entity_id) return;
      const prev = this.states.get(data.entity_id) ?? data.old_state ?? null;
      const next = data.new_state ?? null;
      if (next) this.states.set(data.entity_id, next);
      else this.states.delete(data.entity_id);
      this.emit('state', data.entity_id, next, prev);
      return;
    }
    const p = this.pending.get(id);
    if (!p) return;
    if (msg.type === 'pong' || (msg.type === 'result' && msg.success)) {
      this.settle(id);
      p.resolve(msg.result);
    } else if (msg.type === 'result') {
      const e = (msg.error ?? {}) as { code?: string; message?: string };
      this.settle(id);
      p.reject(new HaError(e.code ?? 'unknown_error', e.message ?? 'Home Assistant error'));
    }
  }

  private startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      this.command({ type: 'ping' }).catch(() => {
        log.warn('home: Home Assistant stopped answering pings; reconnecting');
        this.ws?.terminate();
      });
    }, this.opts.pingMs ?? PING_MS);
    this.pingTimer.unref();
  }

  private command<T = unknown>(payload: Record<string, unknown>): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN)
      return Promise.reject(new HaError('not_connected', 'Home Assistant is not connected'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HaError('timeout', `Home Assistant did not answer ${String(payload.type)}`));
      }, this.opts.commandTimeoutMs ?? COMMAND_TIMEOUT_MS);
      timer.unref();
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ id, ...payload }));
    });
  }

  private settle(id: number) {
    const p = this.pending.get(id);
    if (p) clearTimeout(p.timer);
    this.pending.delete(id);
  }

  private failPending(err: Error) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  private emit<K extends keyof HaClientEvents>(event: K, ...args: Parameters<HaClientEvents[K]>) {
    for (const fn of this.listeners[event]) {
      try {
        (fn as (...a: Parameters<HaClientEvents[K]>) => void)(...args);
      } catch (err) {
        log.error(`home: ${event} listener failed`, {
          err: err instanceof Error ? err.stack : String(err),
        });
      }
    }
  }
}
