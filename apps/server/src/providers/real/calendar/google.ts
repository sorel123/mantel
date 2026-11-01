/**
 * Google Calendar over its REST API with plain `fetch`: OAuth (authorisation code with a
 * refresh token), calendar list, events with recurrences expanded by Google, quick add,
 * and push channels.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { addDays, fromIsoDate, toLocalIso } from '@mantel/shared';
import { HttpError } from '../../../errors.js';
import { log } from '../../../log.js';
import type { CalendarStore } from './store.js';
import type { EditEvent, NewEvent, RawEvent, Source, SourceCalendar } from './types.js';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const PEOPLE_PROP = 'mantelPeople';

export interface GoogleTokens {
  refreshToken: string;
  accessToken?: string;
  /** ms since epoch */
  expiresAt?: number;
  scope?: string;
  connectedAt: string;
  /** The primary calendar id, which is the account's email address. */
  account?: string;
  /** Set when Google refused the refresh token; the setup page asks to reconnect. */
  revoked?: boolean;
}

export interface GoogleOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  fetch?: typeof fetch;
  now?: () => number;
}

interface PendingState {
  state: string;
  expires: number;
}

export class GoogleAuth {
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private pending: PendingState[] = [];
  private refreshing: Promise<string> | null = null;

  constructor(
    private readonly store: CalendarStore,
    readonly opts: GoogleOptions,
  ) {
    this.fetch = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  configured(): boolean {
    return Boolean(this.opts.clientId && this.opts.clientSecret);
  }

  tokens(): GoogleTokens | undefined {
    return this.store.get<GoogleTokens>('google.tokens');
  }

  connected(): boolean {
    const t = this.tokens();
    return this.configured() && Boolean(t?.refreshToken) && !t?.revoked;
  }

  /** The consent URL. `state` is single-use and lives ten minutes. */
  authUrl(): string {
    if (!this.configured())
      throw new HttpError('bad_request', 'set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first');
    const state = randomBytes(18).toString('base64url');
    const t = this.now();
    this.pending = [...this.pending.filter((p) => p.expires > t), { state, expires: t + 600_000 }];
    const q = new URLSearchParams({
      client_id: this.opts.clientId!,
      redirect_uri: this.opts.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      // Always ask, so Google always returns a refresh token.
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${AUTH_URL}?${q}`;
  }

  /** Exchange the code from the redirect for tokens. */
  async finish(code: string, state: string): Promise<GoogleTokens> {
    const t = this.now();
    const match = this.pending.find((p) => p.state === state && p.expires > t);
    if (!match) throw new HttpError('bad_request', 'sign-in expired or already used; start again');
    this.pending = this.pending.filter((p) => p !== match);
    const body = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.opts.redirectUri,
    });
    if (!body.refresh_token)
      throw new HttpError(
        'upstream_error',
        'Google returned no refresh token; remove Mantel at myaccount.google.com/permissions and try again',
      );
    const tokens: GoogleTokens = {
      refreshToken: body.refresh_token,
      accessToken: body.access_token,
      expiresAt: t + (body.expires_in ?? 3600) * 1000,
      scope: body.scope,
      connectedAt: new Date(t).toISOString(),
    };
    this.store.set('google.tokens', tokens);
    return tokens;
  }

  disconnect(): void {
    this.store.set('google.tokens', null);
  }

  setAccount(account: string): void {
    const t = this.tokens();
    if (t && t.account !== account) this.store.set('google.tokens', { ...t, account });
  }

  /** A valid access token, refreshed when it is within a minute of expiring. */
  async accessToken(): Promise<string> {
    const t = this.tokens();
    if (!t?.refreshToken || t.revoked)
      throw new HttpError('upstream_error', 'Google is not connected');
    if (t.accessToken && (t.expiresAt ?? 0) - 60_000 > this.now()) return t.accessToken;
    this.refreshing ??= this.refresh(t).finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async refresh(t: GoogleTokens): Promise<string> {
    try {
      const body = await this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: t.refreshToken,
      });
      this.store.set('google.tokens', {
        ...t,
        accessToken: body.access_token,
        expiresAt: this.now() + (body.expires_in ?? 3600) * 1000,
        ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
      });
      return body.access_token;
    } catch (err) {
      if (err instanceof HttpError && /invalid_grant/.test(err.message)) {
        log.warn(
          'Google refused the refresh token; reconnect in Settings › Calendars (/settings#calendars)',
        );
        this.store.set('google.tokens', { ...t, revoked: true });
      }
      throw err;
    }
  }

  private async tokenRequest(params: Record<string, string>) {
    const res = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.opts.clientId ?? '',
        client_secret: this.opts.clientSecret ?? '',
        ...params,
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError('upstream_error', `Google token ${res.status}: ${text}`);
    return JSON.parse(text) as {
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
      scope?: string;
    };
  }
}

/* ---- API shapes (only the fields we read) ---- */

interface GCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
  primary?: boolean;
  selected?: boolean;
  deleted?: boolean;
}

interface GTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start?: GTime;
  end?: GTime;
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  extendedProperties?: { private?: Record<string, string> };
}

export interface PushChannel {
  calendarId: string;
  channelId: string;
  resourceId: string;
  token: string;
  /** ms since epoch */
  expiration: number;
}

/** Map one Google event to a raw occurrence, or null to skip it. */
export function fromGoogle(calendarId: string, e: GEvent): RawEvent | null {
  if (e.status === 'cancelled' || !e.start || !e.end) return null;
  if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;
  const allDay = Boolean(e.start.date);
  let start: string;
  let end: string;
  if (allDay) {
    const s = fromIsoDate(e.start.date!);
    const en = e.end.date ? fromIsoDate(e.end.date) : addDays(s, 1);
    start = toLocalIso(s);
    end = toLocalIso(en > s ? en : addDays(s, 1));
  } else {
    if (!e.start.dateTime || !e.end.dateTime) return null;
    start = toLocalIso(new Date(e.start.dateTime));
    end = toLocalIso(new Date(e.end.dateTime));
  }
  const people = e.extendedProperties?.private?.[PEOPLE_PROP];
  return {
    uid: e.id,
    calendarId,
    title: e.summary?.trim() || '(No title)',
    start,
    end,
    allDay,
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(people ? { personIds: people.split(',').filter(Boolean) } : {}),
  };
}

const dateOnly = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export class GoogleSource implements Source {
  readonly kind = 'google' as const;
  private readonly fetch: typeof fetch;

  constructor(readonly auth: GoogleAuth) {
    this.fetch = auth.opts.fetch ?? fetch;
  }

  ready(): boolean {
    return this.auth.connected();
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.auth.accessToken();
    const res = await this.fetch(path.startsWith('http') ? path : `${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    const text = await res.text();
    if (!res.ok)
      throw new HttpError('upstream_error', `Google ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async calendars(): Promise<SourceCalendar[]> {
    const out: SourceCalendar[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ maxResults: '250', ...(pageToken ? { pageToken } : {}) });
      const page = await this.call<{ items?: GCalendarListEntry[]; nextPageToken?: string }>(
        `/users/me/calendarList?${q}`,
      );
      for (const c of page.items ?? []) {
        if (c.deleted || c.accessRole === 'freeBusyReader') continue;
        if (c.primary) this.auth.setAccount(c.id);
        out.push({
          id: `google:${c.id}`,
          source: 'google',
          name: c.summaryOverride || c.summary || c.id,
          color: c.backgroundColor ?? '#246B5B',
          readOnly: c.accessRole !== 'owner' && c.accessRole !== 'writer',
          selected: Boolean(c.selected ?? c.primary),
          ...(c.primary ? { primary: true } : {}),
          ref: c.id,
        });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  async events(cal: SourceCalendar, from: Date, to: Date): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({
        singleEvents: 'true',
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        maxResults: '2500',
        ...(pageToken ? { pageToken } : {}),
      });
      const page = await this.call<{ items?: GEvent[]; nextPageToken?: string }>(
        `/calendars/${encodeURIComponent(cal.ref)}/events?${q}`,
      );
      for (const e of page.items ?? []) {
        const raw = fromGoogle(cal.id, e);
        if (raw) out.push(raw);
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  async create(cal: SourceCalendar, ev: NewEvent): Promise<RawEvent> {
    const time = (d: Date): GTime =>
      ev.allDay ? { date: dateOnly(d) } : { dateTime: d.toISOString() };
    const body = {
      summary: ev.title,
      start: time(ev.start),
      end: time(ev.end),
      ...(ev.personIds.length
        ? { extendedProperties: { private: { [PEOPLE_PROP]: ev.personIds.join(',') } } }
        : {}),
    };
    const created = await this.call<GEvent>(`/calendars/${encodeURIComponent(cal.ref)}/events`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const raw = fromGoogle(cal.id, created);
    if (!raw) throw new HttpError('upstream_error', 'Google did not return the new event');
    return raw;
  }

  async update(cal: SourceCalendar, uid: string, ev: EditEvent): Promise<RawEvent> {
    // Switching between all-day and timed needs the other field cleared explicitly.
    const time = (d: Date) =>
      ev.allDay ? { date: dateOnly(d), dateTime: null } : { dateTime: d.toISOString(), date: null };
    const body = {
      summary: ev.title,
      start: time(ev.start),
      end: time(ev.end),
      ...(ev.location !== undefined ? { location: ev.location.trim() } : {}),
      ...(ev.personIds !== undefined
        ? { extendedProperties: { private: { [PEOPLE_PROP]: ev.personIds.join(',') } } }
        : {}),
    };
    const updated = await this.call<GEvent>(
      `/calendars/${encodeURIComponent(cal.ref)}/events/${encodeURIComponent(uid)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    );
    const raw = fromGoogle(cal.id, updated);
    if (!raw) throw new HttpError('upstream_error', 'Google did not return the event');
    return raw;
  }

  async remove(cal: SourceCalendar, uid: string): Promise<void> {
    try {
      await this.call(
        `/calendars/${encodeURIComponent(cal.ref)}/events/${encodeURIComponent(uid)}`,
        { method: 'DELETE' },
      );
    } catch (err) {
      // Already gone upstream: that is what was asked for.
      if (!(err instanceof HttpError && / (404|410):/.test(err.message))) throw err;
    }
  }

  /** Ask Google to POST to `address` when the calendar changes. */
  async watch(cal: SourceCalendar, address: string): Promise<PushChannel> {
    const channelId = randomUUID();
    const token = randomBytes(18).toString('base64url');
    const res = await this.call<{ resourceId: string; expiration?: string }>(
      `/calendars/${encodeURIComponent(cal.ref)}/events/watch`,
      {
        method: 'POST',
        body: JSON.stringify({ id: channelId, type: 'web_hook', address, token }),
      },
    );
    return {
      calendarId: cal.id,
      channelId,
      resourceId: res.resourceId,
      token,
      expiration: Number(res.expiration ?? Date.now() + 7 * 864e5),
    };
  }

  async stop(channel: PushChannel): Promise<void> {
    await this.call('/channels/stop', {
      method: 'POST',
      body: JSON.stringify({ id: channel.channelId, resourceId: channel.resourceId }),
    }).catch((err: unknown) => log.debug('google: channel stop failed', { err: String(err) }));
  }
}
