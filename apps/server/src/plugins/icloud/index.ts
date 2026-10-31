/** iCloud Calendar plugin: Apple ID and app-specific password, synced through the shared calendar service. */
import type { TestResult } from '@mantel/shared';
import { CalDavSource } from '../../providers/real/calendar/caldav.js';
import type { ProviderContext } from '../../providers/types.js';
import type { CalendarService } from '../calendar-service.js';
import { humanError } from '../registry.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export function icloudPlugin(service: CalendarService, doFetch?: typeof fetch): Plugin {
  return {
    manifest,
    start(ctx: ProviderContext) {
      service.attach(ctx);
    },
    stop() {},
    apply(config, secrets) {
      service.setIcloud({
        ICLOUD_USERNAME: config.username === undefined ? undefined : String(config.username),
        ICLOUD_APP_PASSWORD: secrets.appPassword,
        ICLOUD_CALDAV_URL: config.caldavUrl === undefined ? undefined : String(config.caldavUrl),
      });
    },
    async test(config, secrets): Promise<TestResult> {
      if (!config.username || !secrets.appPassword)
        return {
          ok: false,
          message: 'Enter the Apple ID email and an app-specific password first.',
        };
      const source = new CalDavSource({
        url: String(config.caldavUrl ?? 'https://caldav.icloud.com/'),
        username: String(config.username),
        password: secrets.appPassword,
        ...(doFetch ? { fetch: doFetch } : {}),
      });
      try {
        const list = await source.calendars();
        return {
          ok: true,
          message: `Signed in: ${list.length} calendar${list.length === 1 ? '' : 's'} found.`,
        };
      } catch (err) {
        const text = humanError(err);
        return {
          ok: false,
          message: /refused the credentials/.test(text)
            ? 'Apple refused the sign-in. Use an app-specific password, not the Apple ID password.'
            : text,
        };
      }
    },
    status(): PluginStatusFields {
      const c = service.current();
      if (!c) return { state: 'not_set_up', summary: 'Starting', lastOkAt: null, lastError: null };
      const s = c.sourceStatus('icloud');
      if (!s.configured)
        return {
          state: 'not_set_up',
          summary: 'Add an Apple ID to see iCloud calendars',
          lastOkAt: null,
          lastError: null,
        };
      const count = c.sourceCalendars().filter((x) => x.source === 'icloud').length;
      return {
        state: s.error && !s.lastSync ? 'error' : 'connected',
        summary: `${c.env.ICLOUD_USERNAME}, ${count} calendar${count === 1 ? '' : 's'}`,
        lastOkAt: s.lastSync,
        lastError: s.error ? humanError(new Error(s.error)) : null,
      };
    },
  };
}
