import { describe, expect, it } from 'vitest';
import { describe as describeFeed, FeedSource, feedUrl, feedUrls } from './feed.js';

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'X-WR-CALNAME:Leo',
  'X-APPLE-CALENDAR-COLOR:#ff9500ff',
  'BEGIN:VEVENT',
  'UID:soccer-1',
  'DTSTART:20261102T230000Z',
  'DTEND:20261103T000000Z',
  'SUMMARY:Leo soccer',
  'LOCATION:Lakeside Park\\, 12 Shore Rd',
  'RRULE:FREQ=WEEKLY;COUNT=3',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const GOOGLE = 'https://calendar.google.com/calendar/ical/jay%40gmail.com/private-abc123/basic.ics';

describe('calendar links', () => {
  it('turns webcal into https and drops junk and repeats', () => {
    expect(feedUrl('webcal://p01-calendars.icloud.com/x.ics')).toBe(
      'https://p01-calendars.icloud.com/x.ics',
    );
    expect(() => feedUrl('ftp://x')).toThrow();
    expect(feedUrls([GOOGLE, `${GOOGLE}\nnot a link`, undefined, ''])).toEqual([GOOGLE]);
  });

  it('names a feed from X-WR-CALNAME, or from the Google link', () => {
    const cal = describeFeed(GOOGLE, ICS);
    expect(cal).toMatchObject({ source: 'ical', name: 'Leo', color: '#ff9500', readOnly: true });
    expect(cal.id).toMatch(/^ical:[0-9a-f]{16}$/);
    expect(describeFeed(GOOGLE, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR').name).toBe('jay@gmail.com');
  });

  it('fetches once per sync and expands recurrences with locations', async () => {
    let fetches = 0;
    const fake: typeof fetch = async () => {
      fetches++;
      return new Response(ICS, { headers: { 'content-type': 'text/calendar' } });
    };
    const src = new FeedSource({ urls: [GOOGLE], fetch: fake });
    expect(src.ready()).toBe(true);
    const [cal] = await src.calendars();
    const events = await src.events(
      cal!,
      new Date('2026-11-01T00:00:00Z'),
      new Date('2026-12-01T00:00:00Z'),
    );
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      title: 'Leo soccer',
      location: 'Lakeside Park, 12 Shore Rd',
    });
    expect(fetches).toBe(1);
    await expect(src.create()).rejects.toThrow(/read-only/);
  });

  it('explains a reset link and a web page', async () => {
    const gone = new FeedSource({
      urls: [GOOGLE],
      fetch: async () => new Response('', { status: 404 }),
    });
    await expect(gone.calendars()).rejects.toThrow(/reset the secret address/);
    const page = new FeedSource({
      urls: [GOOGLE],
      fetch: async () => new Response('<!doctype html><html>'),
    });
    await expect(page.calendars()).rejects.toThrow(/not a calendar/);
  });
});
