/** iCal link plugin: read-only feeds (Google's secret address, any .ics), synced through the shared calendar service. */
import type { TestResult } from '@mantel/shared';
import { FeedSource, feedUrl, feedUrls } from '../../providers/real/calendar/feed.js';
import type { ProviderContext } from '../../providers/types.js';
import type { CalendarService } from '../calendar-service.js';
import { humanError } from '../registry.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

const KEYS = ['url1', 'url2', 'url3', 'url4'] as const;
const linksIn = (secrets: Record<string, string>) => KEYS.map((k) => secrets[k]);

export function icalPlugin(service: CalendarService, doFetch?: typeof fetch): Plugin {
  return {
    manifest,
    start(ctx: ProviderContext) {
      service.attach(ctx);
    },
    stop() {},
    apply(_config, secrets) {
      const urls = feedUrls(linksIn(secrets));
      service.setIcal({ ICAL_URLS: urls.length ? urls.join(' ') : undefined });
    },
    async test(_config, secrets): Promise<TestResult> {
      const raw = linksIn(secrets)
        .flatMap((v) => (v ?? '').split(/[\s,]+/))
        .filter((v) => v.trim());
      if (raw.length === 0) return { ok: false, message: 'Paste a calendar link first.' };
      for (const r of raw) {
        try {
          feedUrl(r);
        } catch {
          return {
            ok: false,
            message: `“${r.slice(0, 40)}…” is not a link. It should start with https:// or webcal://.`,
          };
        }
      }
      if (raw.some((r) => /calendar\.google\.com\/calendar\/embed/.test(r)))
        return {
          ok: false,
          message:
            'That is the embed link. Use Secret address in iCal format, which ends in basic.ics.',
        };
      const source = new FeedSource({
        urls: feedUrls(raw),
        ...(doFetch ? { fetch: doFetch } : {}),
      });
      try {
        const cals = await source.calendars();
        const names = cals.map((c) => c.name).join(', ');
        const missing = feedUrls(raw).length - cals.length;
        return {
          ok: missing === 0,
          message:
            missing === 0
              ? `Read ${cals.length} calendar${cals.length === 1 ? '' : 's'}: ${names}.`
              : `Read ${names}, but ${missing} link${missing === 1 ? '' : 's'} did not answer.`,
        };
      } catch (err) {
        return { ok: false, message: humanError(err) };
      }
    },
    status(): PluginStatusFields {
      const c = service.current();
      if (!c) return { state: 'not_set_up', summary: 'Starting', lastOkAt: null, lastError: null };
      const s = c.sourceStatus('ical');
      if (!s.configured)
        return {
          state: 'not_set_up',
          summary: 'Paste a Google secret iCal address or any .ics link',
          lastOkAt: null,
          lastError: null,
        };
      const cals = c.sourceCalendars().filter((x) => x.source === 'ical');
      return {
        state: s.error && !s.lastSync ? 'error' : 'connected',
        summary:
          cals.length > 0
            ? `${cals.map((x) => x.name).join(', ')} (read-only)`
            : 'Links saved; waiting for the first sync',
        lastOkAt: s.lastSync,
        lastError: s.error ? humanError(new Error(s.error)) : null,
      };
    },
  };
}
