/**
 * iCloud calendars over CalDAV with an app-specific password: principal and calendar-home
 * discovery, the calendar list with ctags, time-range queries and quick add.
 */
import { randomUUID } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { HttpError } from '../../../errors.js';
import { buildIcs, editIcs, expandIcs, icsUid, isRecurringIcs } from './ics.js';
import type { EditEvent, NewEvent, RawEvent, Source, SourceCalendar } from './types.js';

export interface CalDavOptions {
  url: string;
  username?: string;
  password?: string;
  fetch?: typeof fetch;
}

const NS =
  'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ic="http://apple.com/ns/ical/"';

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  parseTagValue: false,
  isArray: (name) => ['response', 'propstat', 'comp', 'privilege'].includes(name),
});

type Node = Record<string, unknown>;
const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
const textOf = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as Node)) return String((v as Node)['#text']);
  return undefined;
};

interface DavResponse {
  href: string;
  props: Node;
}

/** The 200 props of each `<response>` in a multistatus body. */
export function parseMultistatus(xml: string): DavResponse[] {
  const doc = parser.parse(xml) as Node;
  const ms = doc.multistatus as Node | undefined;
  return asArray(ms?.response as Node[] | undefined).map((r) => {
    const props: Node = {};
    for (const ps of asArray(r.propstat as Node[] | undefined)) {
      if (!/ 200 /.test(textOf(ps.status) ?? ' 200 ')) continue;
      Object.assign(props, ps.prop as Node);
    }
    return { href: textOf(r.href) ?? '', props };
  });
}

const hrefIn = (v: unknown) => textOf((v as Node | undefined)?.href);

export class CalDavSource implements Source {
  readonly kind = 'icloud' as const;
  private readonly fetch: typeof fetch;
  private home: string | null = null;

  constructor(private readonly opts: CalDavOptions) {
    this.fetch = opts.fetch ?? fetch;
  }

  ready(): boolean {
    return Boolean(this.opts.username && this.opts.password);
  }

  private async dav(
    method: string,
    url: string,
    body: string,
    depth: '0' | '1',
    extra: Record<string, string> = {},
  ) {
    const auth = Buffer.from(`${this.opts.username}:${this.opts.password}`).toString('base64');
    const res = await this.fetch(url, {
      method,
      headers: {
        authorization: `Basic ${auth}`,
        depth,
        'content-type': 'application/xml; charset=utf-8',
        ...extra,
      },
      body,
      redirect: 'follow',
    });
    const text = await res.text();
    if (res.status === 401)
      throw new HttpError(
        'upstream_error',
        'iCloud rejected the Apple ID or app-specific password',
      );
    if (!res.ok && res.status !== 207)
      throw new HttpError(
        'upstream_error',
        `iCloud ${method} ${res.status}: ${text.slice(0, 200)}`,
      );
    return { url: res.url || url, text };
  }

  /** principal, then calendar-home-set. Cached for the life of the process. */
  private async calendarHome(): Promise<string> {
    if (this.home) return this.home;
    const root = this.opts.url;
    const p = await this.dav(
      'PROPFIND',
      root,
      `<?xml version="1.0"?><d:propfind ${NS}><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
      '0',
    );
    const principalHref = hrefIn(parseMultistatus(p.text)[0]?.props['current-user-principal']);
    if (!principalHref) throw new HttpError('upstream_error', 'iCloud did not return a principal');
    const principal = new URL(principalHref, p.url).toString();
    const h = await this.dav(
      'PROPFIND',
      principal,
      `<?xml version="1.0"?><d:propfind ${NS}><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
      '0',
    );
    const homeHref = hrefIn(parseMultistatus(h.text)[0]?.props['calendar-home-set']);
    if (!homeHref) throw new HttpError('upstream_error', 'iCloud did not return a calendar home');
    this.home = new URL(homeHref, h.url).toString();
    return this.home;
  }

  async calendars(): Promise<SourceCalendar[]> {
    const home = await this.calendarHome();
    const res = await this.dav(
      'PROPFIND',
      home,
      `<?xml version="1.0"?><d:propfind ${NS}><d:prop>
        <d:resourcetype/><d:displayname/><cs:getctag/><ic:calendar-color/>
        <c:supported-calendar-component-set/><d:current-user-privilege-set/>
      </d:prop></d:propfind>`,
      '1',
    );
    const out: SourceCalendar[] = [];
    for (const r of parseMultistatus(res.text)) {
      const type = r.props.resourcetype;
      if (!type || typeof type !== 'object' || !('calendar' in type)) continue;
      const comps = asArray(
        (r.props['supported-calendar-component-set'] as Node | undefined)?.comp as
          Node[] | undefined,
      );
      if (comps.length && !comps.some((c) => c['@name'] === 'VEVENT')) continue;
      const privs = asArray(
        (r.props['current-user-privilege-set'] as Node | undefined)?.privilege as
          Node[] | undefined,
      );
      const canWrite =
        !privs.length ||
        privs.some(
          (p) => typeof p === 'object' && ('write' in p || 'all' in p || 'write-content' in p),
        );
      const url = new URL(r.href, res.url).toString();
      const path = new URL(url).pathname;
      out.push({
        id: `icloud:${path}`,
        source: 'icloud',
        name: textOf(r.props.displayname) ?? 'iCloud',
        color: textOf(r.props['calendar-color']) ?? '#3F7BD9',
        readOnly: !canWrite,
        selected: true,
        ref: url,
        ...(textOf(r.props.getctag) ? { ctag: textOf(r.props.getctag)! } : {}),
      });
    }
    return out;
  }

  async events(cal: SourceCalendar, from: Date, to: Date): Promise<RawEvent[]> {
    const stamp = (d: Date) =>
      d
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
    const res = await this.dav(
      'REPORT',
      cal.ref,
      `<?xml version="1.0"?><c:calendar-query ${NS}>
        <d:prop><d:getetag/><c:calendar-data/></d:prop>
        <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
          <c:time-range start="${stamp(from)}" end="${stamp(to)}"/>
        </c:comp-filter></c:comp-filter></c:filter>
      </c:calendar-query>`,
      '1',
    );
    const out: RawEvent[] = [];
    for (const r of parseMultistatus(res.text)) {
      const ics = textOf(r.props['calendar-data']);
      if (!ics) continue;
      try {
        out.push(...expandIcs(ics, cal.id, from, to));
      } catch {
        // One malformed resource should not hide the rest of the calendar.
      }
    }
    return out;
  }

  async create(cal: SourceCalendar, ev: NewEvent): Promise<RawEvent> {
    const uid = `${randomUUID()}@mantel`;
    const ics = buildIcs(uid, ev);
    const url = new URL(
      `${encodeURIComponent(uid)}.ics`,
      cal.ref.endsWith('/') ? cal.ref : `${cal.ref}/`,
    ).toString();
    const auth = Buffer.from(`${this.opts.username}:${this.opts.password}`).toString('base64');
    const res = await this.fetch(url, {
      method: 'PUT',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'text/calendar; charset=utf-8',
        'if-none-match': '*',
      },
      body: ics,
    });
    if (!res.ok) throw new HttpError('upstream_error', `iCloud PUT ${res.status}`);
    const [raw] = expandIcs(
      ics,
      cal.id,
      new Date(ev.start.getTime() - 1),
      new Date(ev.end.getTime() + 864e5),
    );
    if (!raw) throw new HttpError('internal', 'could not read back the new event');
    return raw;
  }

  /** The resource holding the event with this occurrence key: its address, etag and text. */
  private async resource(cal: SourceCalendar, key: string) {
    const uid = icsUid(key).replace(/[<&>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const res = await this.dav(
      'REPORT',
      cal.ref,
      `<?xml version="1.0"?><c:calendar-query ${NS}>
        <d:prop><d:getetag/><c:calendar-data/></d:prop>
        <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
          <c:prop-filter name="UID"><c:text-match collation="i;octet">${uid}</c:text-match></c:prop-filter>
        </c:comp-filter></c:comp-filter></c:filter>
      </c:calendar-query>`,
      '1',
    );
    const r = parseMultistatus(res.text).find((x) => textOf(x.props['calendar-data']));
    if (!r) throw new HttpError('not_found', 'that event is no longer in iCloud');
    return {
      url: new URL(r.href, res.url).toString(),
      etag: textOf(r.props.getetag),
      ics: textOf(r.props['calendar-data'])!,
    };
  }

  private async write(method: 'PUT' | 'DELETE', url: string, etag?: string, body?: string) {
    const auth = Buffer.from(`${this.opts.username}:${this.opts.password}`).toString('base64');
    const res = await this.fetch(url, {
      method,
      headers: {
        authorization: `Basic ${auth}`,
        ...(etag ? { 'if-match': etag } : {}),
        ...(body ? { 'content-type': 'text/calendar; charset=utf-8' } : {}),
      },
      ...(body ? { body } : {}),
    });
    if (res.status === 412)
      throw new HttpError('upstream_error', 'the event changed in iCloud; try again');
    if (!res.ok && !(method === 'DELETE' && res.status === 404))
      throw new HttpError('upstream_error', `iCloud ${method} ${res.status}`);
  }

  async update(cal: SourceCalendar, key: string, ev: EditEvent): Promise<RawEvent> {
    const r = await this.resource(cal, key);
    if (isRecurringIcs(r.ics)) throw repeating();
    const ics = editIcs(r.ics, ev);
    await this.write('PUT', r.url, r.etag, ics);
    const [raw] = expandIcs(
      ics,
      cal.id,
      new Date(ev.start.getTime() - 1),
      new Date(ev.end.getTime() + 864e5),
    );
    if (!raw) throw new HttpError('internal', 'could not read back the event');
    return raw;
  }

  async remove(cal: SourceCalendar, key: string): Promise<void> {
    const r = await this.resource(cal, key);
    if (isRecurringIcs(r.ics)) throw repeating();
    await this.write('DELETE', r.url, r.etag);
  }
}

const repeating = () =>
  new HttpError(
    'bad_request',
    'This is a repeating iCloud event. Change it in the Calendar app on a phone or Mac.',
  );
