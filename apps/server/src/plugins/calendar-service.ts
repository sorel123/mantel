/**
 * One `RealCalendar` serves both calendar plugins (Google and iCloud). Each plugin hands its
 * values here; the service rebuilds the provider when they change and swaps it behind the
 * live proxy that routes hold.
 */
import type { Hono } from 'hono';
import type { DeviceAuth } from '../auth.js';
import { HttpError } from '../errors.js';
import { log } from '../log.js';
import { loadCalendarEnv } from '../providers/real/calendar/env.js';
import { RealCalendar } from '../providers/real/calendar/index.js';
import { mountCalendarSetup } from '../providers/real/calendar/setup.js';
import type { CalendarProvider, ProviderContext } from '../providers/types.js';
import { live, type Live } from './live.js';

const notReady = () => Promise.reject(new HttpError('internal', 'calendar provider is starting'));

const placeholder: CalendarProvider = {
  events: notReady,
  quickAdd: notReady,
  updateEvent: notReady,
  deleteEvent: notReady,
  countdowns: notReady,
  meals: notReady,
  calendars: async () => [],
};

export interface CalendarServiceOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export class CalendarService {
  readonly live: Live<CalendarProvider> = live(placeholder);
  private instance: RealCalendar | null = null;
  private google: Record<string, string | undefined> = {};
  private icloud: Record<string, string | undefined> = {};
  private ical: Record<string, string | undefined> = {};
  private builtFrom = '';
  private ctx: ProviderContext | null = null;

  constructor(private readonly opts: CalendarServiceOptions = {}) {}

  attach(ctx: ProviderContext) {
    this.ctx = ctx;
  }

  /** The current provider, as a `RealCalendar` (null until a plugin applied). */
  current(): RealCalendar | null {
    return this.instance;
  }

  /** The provider as routes see it: always the current instance. */
  proxy(): RealCalendar {
    return this.live.proxy as RealCalendar;
  }

  setGoogle(values: Record<string, string | undefined>) {
    this.google = values;
    this.rebuild();
  }

  setIcloud(values: Record<string, string | undefined>) {
    this.icloud = values;
    this.rebuild();
  }

  setIcal(values: Record<string, string | undefined>) {
    this.ical = values;
    this.rebuild();
  }

  private envRecord(): NodeJS.ProcessEnv {
    const base = this.opts.env ?? process.env;
    const pass = [
      'GOOGLE_REDIRECT_URI',
      'CALENDAR_PUSH_POLL_SECONDS',
      'CALENDAR_PAST_DAYS',
      'CALENDAR_FUTURE_DAYS',
    ];
    const out: NodeJS.ProcessEnv = {};
    for (const k of pass) if (base[k]) out[k] = base[k];
    for (const [k, v] of Object.entries({ ...this.google, ...this.icloud, ...this.ical }))
      if (v) out[k] = v;
    return out;
  }

  private rebuild() {
    if (!this.ctx) return;
    const envRecord = this.envRecord();
    const key = JSON.stringify(envRecord);
    if (this.instance && key === this.builtFrom) return;
    this.builtFrom = key;
    this.instance?.stop();
    this.instance = new RealCalendar(this.ctx, {
      env: loadCalendarEnv(envRecord),
      ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
    });
    this.live.set(this.instance);
    log.debug('calendar: provider rebuilt');
  }

  /** The setup page and OAuth callbacks, bound to whatever instance is current. */
  mount(api: Hono, auth: DeviceAuth) {
    if (!this.ctx) throw new Error('calendar service not attached');
    mountCalendarSetup(api, auth, this.proxy(), this.ctx);
  }

  stop() {
    this.instance?.stop();
  }
}
