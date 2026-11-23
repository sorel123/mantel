/**
 * Who changed something: the WebSocket events that announce a change do not say which device
 * made it, so a small middleware remembers the device of the last request that wrote anything.
 * The activity log credits a change to that device when the event follows within a few seconds.
 */
import { DEVICE_KEY_HEADER } from '@mantel/shared';
import type { MiddlewareHandler } from 'hono';
import type { DeviceAuth } from '../../auth.js';

/** A change this long after a write is still credited to the device that wrote. */
export const WRITER_WINDOW_MS = 6_000;

export class WriterTracker {
  private last: { deviceId: string; at: number } | null = null;

  constructor(
    private readonly auth: Pick<DeviceAuth, 'verify'>,
    private readonly now: () => number = Date.now,
  ) {}

  readonly middleware: MiddlewareHandler = async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const deviceId = this.auth.verify(c.req.header(DEVICE_KEY_HEADER));
      if (deviceId) this.last = { deviceId, at: this.now() };
    }
    await next();
  };

  /** Record a write by hand (tests). */
  wrote(deviceId: string) {
    this.last = { deviceId, at: this.now() };
  }

  /** The device that wrote within the window, or null. */
  recent(windowMs = WRITER_WINDOW_MS): string | null {
    if (!this.last || this.now() - this.last.at > windowMs) return null;
    return this.last.deviceId;
  }
}

const trackers = new WeakMap<object, WriterTracker>();

/** One tracker per app (keyed by its `DeviceAuth`), so `app.ts` and the log share it. */
export function writerFor(auth: Pick<DeviceAuth, 'verify'>): WriterTracker {
  let t = trackers.get(auth);
  if (!t) {
    t = new WriterTracker(auth);
    trackers.set(auth, t);
  }
  return t;
}
