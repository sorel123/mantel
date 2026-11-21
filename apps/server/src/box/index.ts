/**
 * Mantel OS box features: first-boot setup (network, role, touch), the "Mantel setup" Wi-Fi
 * hotspot for phone setup, and the screen backlight. On only when the server runs as the
 * Mantel OS box (`MANTEL_BOX=1`, set by the snap there; `MANTEL_BOX=fake` fakes the network
 * for development).
 *
 * Routes, outside the display contract like the calendar setup routes:
 *
 *   GET  /api/box/state   role, touch, network status, setup addresses (hotspot password only
 *                         to the box's own screen)
 *   GET  /api/box/wifi    networks in range (?rescan=1 to look again)
 *   POST /api/box/wifi    { ssid, password? } join a network
 *   POST /api/box/role    { role: 'server' | 'screen', serverUrl?, touch }
 *
 * Changes are allowed from the box's own screen (loopback), from anyone until the role is
 * chosen (a new box has nothing to protect yet), and afterwards with a paired display's key
 * or the admin PIN (`x-mantel-pin`).
 */
import { randomInt } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConnInfo } from '@hono/node-server/conninfo';
import { DEVICE_KEY_HEADER, minutesInZone, scheduleStateAt } from '@mantel/shared';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { DeviceAuth } from '../auth.js';
import { kvGet, kvSet, type Db } from '../db/index.js';
import { log } from '../log.js';
import type { SettingsStore } from '../settings.js';
import { type BoxNetwork, type NetworkStatus, type WifiNetwork } from './network.js';

export const HOTSPOT_SSID = 'Mantel setup';
/** How long a new box waits for a network before it opens the setup hotspot. */
const OFFLINE_GRACE_MS = 60_000;
/** A set-up box that lost its Wi-Fi (router restarting) waits longer, */
const OFFLINE_GRACE_SET_UP_MS = 5 * 60_000;
/** and closes the hotspot again after this long so NetworkManager retries the saved network. */
const HOTSPOT_MAX_SET_UP_MS = 10 * 60_000;
const CHECK_MS = 15_000;
const JOIN_WAIT_MS = 45_000;

export type BoxRole = 'server' | 'screen';

interface Stored {
  role: BoxRole | null;
  serverUrl: string | null;
  touch: boolean;
  /** The last setup step (touch) was answered. */
  done: boolean;
}

export interface BoxState extends Stored {
  box: true;
  port: number;
  network: NetworkStatus;
  hotspot: { ssid: string; password: string | null; url: string } | null;
  /** Where a phone on the same network opens setup. */
  setupUrl: string | null;
  joining: string | null;
  lastError: string | null;
}

const KEY = 'box.state';

export class BoxService {
  private networks: WifiNetwork[] = [];
  private hotspotPassword: string | null = null;
  private offlineSince: number | null = null;
  private hotspotSince: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private joining: string | null = null;
  private lastError: string | null = null;
  private lastBrightness = -1;

  constructor(
    private readonly opts: {
      db: Db;
      auth: DeviceAuth;
      settings: SettingsStore;
      network: BoxNetwork;
      port: number;
      /** Folder holding the screen's backlight (`/sys/class/backlight`). */
      backlightDir?: string;
      now?: () => number;
    },
  ) {}

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  stored(): Stored {
    const s = kvGet<Partial<Stored>>(this.opts.db, KEY);
    return {
      role: s?.role ?? null,
      serverUrl: s?.serverUrl ?? null,
      touch: s?.touch ?? true,
      done: s?.done ?? false,
    };
  }

  private save(patch: Partial<Stored>) {
    kvSet(this.opts.db, KEY, { ...this.stored(), ...patch });
  }

  async state(local: boolean): Promise<BoxState> {
    const network = await this.opts.network.status();
    const port = this.opts.port;
    return {
      box: true,
      port,
      ...this.stored(),
      network,
      hotspot: network.hotspot
        ? {
            ssid: HOTSPOT_SSID,
            password: local ? this.hotspotPassword : null,
            url: `http://10.42.0.1:${port}/box`,
          }
        : null,
      setupUrl: network.address ? `http://${network.address}:${port}/box` : null,
      joining: this.joining,
      lastError: this.lastError,
    };
  }

  async scan(rescan: boolean): Promise<WifiNetwork[]> {
    const status = await this.opts.network.status();
    // The radio cannot look around while it is the hotspot: show what it saw before.
    if (!status.hotspot && (rescan || this.networks.length === 0)) {
      try {
        this.networks = await this.opts.network.scan();
      } catch (err) {
        log.warn('box: Wi-Fi scan failed', { err: String(err) });
      }
    }
    return this.networks;
  }

  /** Starts joining and returns at once: a phone on the hotspot loses it as the box switches. */
  join(ssid: string, password: string | null): void {
    this.joining = ssid;
    this.lastError = null;
    void (async () => {
      try {
        await new Promise((r) => setTimeout(r, 500));
        await this.opts.network.connect(ssid, password);
        const until = this.now() + JOIN_WAIT_MS;
        let s = await this.opts.network.status();
        while (!(s.online && s.ssid === ssid) && this.now() < until) {
          await new Promise((r) => setTimeout(r, 1500));
          s = await this.opts.network.status();
        }
        if (!(s.online && s.ssid === ssid)) throw new Error('timed out');
        log.info(`box: joined Wi-Fi "${ssid}"`);
        this.hotspotPassword = null;
      } catch (err) {
        log.warn(`box: could not join "${ssid}"`, { err: String(err) });
        this.lastError = `Could not join "${ssid}". Check the password and try again.`;
        this.offlineSince = 0; // reopen the hotspot on the next check
      } finally {
        this.joining = null;
      }
    })();
  }

  async setRole(input: {
    role: BoxRole;
    serverUrl?: string | null;
    touch?: boolean;
    done?: boolean;
  }) {
    let serverUrl: string | null = null;
    if (input.role === 'screen') {
      serverUrl = normaliseServerUrl(input.serverUrl ?? '');
      if (!serverUrl)
        throw new BoxError('Enter the address of your Mantel, like http://192.168.1.20:8787');
      const ok = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(6000) })
        .then(
          async (r) =>
            r.ok && ((await r.json().catch(() => null)) as { ok?: unknown } | null)?.ok === true,
        )
        .catch(() => false);
      if (!ok)
        throw new BoxError(
          `No Mantel answered at ${serverUrl}. Check the address and that it is on.`,
        );
    }
    const prev = this.stored();
    this.save({
      role: input.role,
      serverUrl,
      touch: input.touch ?? prev.touch,
      done: input.done ?? prev.done,
    });
    log.info(`box: role set to ${input.role}${serverUrl ? ` (${serverUrl})` : ''}`);
    return this.stored();
  }

  /** Opens the setup hotspot when the box has had no network for a minute; closes it once online. */
  async tick(): Promise<void> {
    if (this.joining) return;
    const s = await this.opts.network.status();
    if (!s.available) return this.backlight();
    const setUp = this.stored().role !== null;
    if (s.online) {
      this.offlineSince = null;
      this.lastError = null;
      if (s.hotspot) await this.closeHotspot();
    } else if (s.hotspot) {
      if (setUp && this.hotspotSince && this.now() - this.hotspotSince >= HOTSPOT_MAX_SET_UP_MS) {
        log.info('box: closing the setup hotspot to retry the saved Wi-Fi');
        await this.closeHotspot();
        this.offlineSince = this.now();
      }
    } else {
      this.offlineSince ??= this.now();
      const grace = setUp ? OFFLINE_GRACE_SET_UP_MS : OFFLINE_GRACE_MS;
      if (s.hasWifi && this.now() - this.offlineSince >= grace) await this.openHotspot();
    }
    this.backlight();
  }

  private async openHotspot() {
    await this.scan(true); // remember what is in range before the radio becomes the hotspot
    this.hotspotPassword = String(randomInt(10_000_000, 100_000_000));
    try {
      await this.opts.network.startHotspot(HOTSPOT_SSID, this.hotspotPassword);
      this.hotspotSince = this.now();
      log.info(`box: no network; opened the "${HOTSPOT_SSID}" Wi-Fi for phone setup`);
    } catch (err) {
      log.warn('box: could not open the setup hotspot', { err: String(err) });
    }
  }

  private async closeHotspot() {
    await this.opts.network.stopHotspot();
    this.hotspotSince = null;
  }

  /** Mirrors the schedule's brightness to the screen's backlight, when it has one. */
  backlight(): void {
    const dir = this.opts.backlightDir;
    if (!dir || this.stored().role !== 'server') return;
    try {
      const dev = readdirSync(dir)[0];
      if (!dev) return;
      const s = this.opts.settings.get();
      const { brightness } = scheduleStateAt(
        s.schedule,
        minutesInZone(new Date(this.now()), s.timezone),
      );
      if (brightness === this.lastBrightness) return;
      const max = Number(readFileSync(join(dir, dev, 'max_brightness'), 'utf8'));
      // Never fully dark from the backlight alone: "off" is drawn black by the display.
      const level = Math.max(1, Math.round((max * Math.max(brightness, 5)) / 100));
      writeFileSync(join(dir, dev, 'brightness'), String(level));
      this.lastBrightness = brightness;
    } catch {
      /* no backlight (a TV or monitor), or no permission: the display's dimmer does it */
    }
  }

  start() {
    const run = () =>
      void this.tick().catch((err) => log.warn('box: check failed', { err: String(err) }));
    run();
    this.timer = setInterval(run, CHECK_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** May this request change the box? */
  allowed(c: Context): boolean {
    if (isLoopback(c)) return true;
    if (this.stored().role === null) return true;
    if (this.opts.auth.verify(c.req.header(DEVICE_KEY_HEADER))) return true;
    const pin = c.req.header('x-mantel-pin');
    return !!pin && this.opts.auth.verifyPin(pin);
  }

  mount(api: Hono) {
    api.get('/box/state', async (c) => c.json(await this.state(isLoopback(c))));
    api.get('/box/wifi', async (c) =>
      c.json({ networks: await this.scan(c.req.query('rescan') === '1') }),
    );
    api.post('/box/wifi', async (c) => {
      if (!this.allowed(c)) return forbidden(c);
      const body = (await c.req.json().catch(() => null)) as {
        ssid?: unknown;
        password?: unknown;
      } | null;
      const ssid = typeof body?.ssid === 'string' ? body.ssid.trim() : '';
      const password = typeof body?.password === 'string' && body.password ? body.password : null;
      if (!ssid || ssid.length > 32) return bad(c, 'Pick a network');
      if (password && (password.length < 8 || password.length > 63))
        return bad(c, 'Wi-Fi passwords are 8 to 63 characters');
      this.join(ssid, password);
      return c.json({ ok: true, joining: ssid });
    });
    api.post('/box/role', async (c) => {
      if (!this.allowed(c)) return forbidden(c);
      const body = (await c.req.json().catch(() => null)) as {
        role?: unknown;
        serverUrl?: unknown;
        touch?: unknown;
        done?: unknown;
      } | null;
      const role = body?.role;
      if (role !== 'server' && role !== 'screen') return bad(c, 'role must be server or screen');
      try {
        const stored = await this.setRole({
          role,
          serverUrl: typeof body?.serverUrl === 'string' ? body.serverUrl : null,
          ...(typeof body?.touch === 'boolean' ? { touch: body.touch } : {}),
          ...(body?.done === true ? { done: true } : {}),
        });
        return c.json({ ok: true, ...stored });
      } catch (err) {
        if (err instanceof BoxError) return bad(c, err.message);
        throw err;
      }
    });
  }

  /**
   * Page requests on the box: until setup is finished the box opens `/box`; a screen-only box's own screen
   * goes on to the Mantel it shows. Other devices (and `/box`, `/settings`, `/app`) are untouched.
   */
  pages(): MiddlewareHandler {
    return async (c, next) => {
      const path = c.req.path;
      if (c.req.method !== 'GET' || path.startsWith('/api') || path.includes('.')) return next();
      if (/^\/(box|settings|setup|app|add|demo)(\/|$)/.test(path)) return next();
      const s = this.stored();
      if (s.role === null || !s.done) return c.redirect('/box', 302);
      if (s.role === 'screen' && s.serverUrl && isLoopback(c))
        return c.redirect(`${s.serverUrl}/?box=1${s.touch ? '' : '&glance=1'}`, 302);
      return next();
    };
  }
}

class BoxError extends Error {}

function bad(c: Context, message: string) {
  return c.json({ error: { code: 'bad_request', message } }, 400);
}
function forbidden(c: Context) {
  return c.json(
    {
      error: { code: 'forbidden', message: 'Use the admin PIN, or change this on the box itself' },
    },
    403,
  );
}

export function isLoopback(c: Context): boolean {
  let peer = '';
  try {
    peer = getConnInfo(c).remote.address ?? '';
  } catch {
    return false;
  }
  const proxied = ['x-forwarded-for', 'x-real-ip', 'forwarded'].some((h) => c.req.header(h));
  return !proxied && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer);
}

/** `192.168.1.20` → `http://192.168.1.20:8787`; null when it is not an address. */
export function normaliseServerUrl(input: string): string | null {
  let s = input.trim().replace(/\/+$/, '');
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    if (!u.hostname || u.username || u.password) return null;
    if (!u.port && u.protocol === 'http:') u.port = '8787';
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}
