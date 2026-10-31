/**
 * Read-only calendars from iCal links: Google Calendar's "Secret address in iCal format",
 * an Outlook "published" link, a school or sports-team feed. No account and no Cloud
 * console; the link is fetched on the sync interval and expanded like a CalDAV resource.
 */
import { createHash } from 'node:crypto';
import ICAL from 'ical.js';
import { HttpError } from '../../../errors.js';
import { expandIcs } from './ics.js';
import type { RawEvent, Source, SourceCalendar } from './types.js';

export interface FeedOptions {
  urls: string[];
  fetch?: typeof fetch;
}

/** Feed colours when the feed names none, in the order links were added. */
const COLORS = ['#3a7bd5', '#c2410c', '#15803d', '#7c3aed', '#be185d', '#0f766e'];

/** `webcal://…` → `https://…`; anything that is not http(s) is refused. */
export function feedUrl(raw: string): string {
  const s = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  const u = new URL(s);
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    throw new HttpError('bad_request', 'A calendar link starts with https:// or webcal://');
  return u.toString();
}

/** Split what was pasted (one per box, or several on separate lines) into links. */
export function feedUrls(values: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of values)
    for (const part of (v ?? '').split(/[\s,]+/))
      if (part.trim()) {
        try {
          const u = feedUrl(part);
          if (!out.includes(u)) out.push(u);
        } catch {
          // A malformed link is reported by Test; it never stops the others from syncing.
        }
      }
  return out;
}

const idFor = (url: string) =>
  `ical:${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;

/** Google's secret links look like …/calendar/ical/<calendar id>/private-<key>/basic.ics. */
function nameFromUrl(url: string): string {
  const m = url.match(/calendar\/ical\/([^/]+)\//);
  if (m) {
    const id = decodeURIComponent(m[1]!);
    if (id.includes('#holiday')) return 'Holidays';
    return id.endsWith('@gmail.com') ? id : 'Google calendar';
  }
  return new URL(url).hostname.replace(/^www\./, '');
}

export class FeedSource implements Source {
  readonly kind = 'ical' as const;
  private readonly fetch: typeof fetch;
  /** Text fetched by `calendars()`, reused by `events()` in the same sync. */
  private cache = new Map<string, { at: number; text: string }>();

  constructor(private readonly opts: FeedOptions) {
    this.fetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  ready(): boolean {
    return this.opts.urls.length > 0;
  }

  private async text(url: string, maxAgeMs = 60_000): Promise<string> {
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.text;
    const res = await this.fetch(url, {
      headers: { accept: 'text/calendar, */*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404 || res.status === 403 || res.status === 401)
      throw new HttpError(
        'upstream_error',
        `the calendar link answered ${res.status}. If you reset the secret address, paste the new one`,
      );
    if (!res.ok) throw new HttpError('upstream_error', `the calendar link answered ${res.status}`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000)))
      throw new HttpError(
        'upstream_error',
        'that link is a web page, not a calendar. Use the iCal (.ics) address',
      );
    this.cache.set(url, { at: Date.now(), text });
    return text;
  }

  /** One calendar per link, named and coloured from the feed when it says. */
  async calendars(): Promise<SourceCalendar[]> {
    const out: SourceCalendar[] = [];
    let firstError: unknown = null;
    for (const [i, url] of this.opts.urls.entries()) {
      try {
        out.push(describe(url, await this.text(url, 0), i));
      } catch (err) {
        firstError ??= err;
      }
    }
    if (out.length === 0 && firstError) throw firstError;
    return out;
  }

  async events(cal: SourceCalendar, from: Date, to: Date): Promise<RawEvent[]> {
    return expandIcs(await this.text(cal.ref), cal.id, from, to);
  }

  create(): Promise<RawEvent> {
    return Promise.reject(new HttpError('forbidden', 'calendar links are read-only'));
  }
}

/** The calendar a feed describes: X-WR-CALNAME and an Apple or RFC 7986 colour. */
export function describe(url: string, ics: string, index = 0): SourceCalendar {
  let name: string | undefined;
  let color: string | undefined;
  try {
    const root = new ICAL.Component(ICAL.parse(ics));
    const v = (k: string) => {
      const x = root.getFirstPropertyValue(k);
      return typeof x === 'string' && x.trim() ? x.trim() : undefined;
    };
    name = v('x-wr-calname') ?? v('name');
    const c = v('x-apple-calendar-color') ?? v('color');
    if (c && /^#[0-9a-f]{6}/i.test(c)) color = c.slice(0, 7);
  } catch {
    // Parsing errors surface from events(); the name falls back to the link.
  }
  return {
    id: idFor(url),
    source: 'ical',
    name: name ?? nameFromUrl(url),
    color: color ?? COLORS[index % COLORS.length]!,
    readOnly: true,
    selected: true,
    ref: url,
  };
}
