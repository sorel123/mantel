/**
 * Google Calendar plugin: OAuth client from Settings, Connect through the authorize-url and
 * callback routes, sync through the shared calendar service.
 */
import type { IntegrationConfig, TestResult } from '@mantel/shared';
import { HttpError } from '../../errors.js';
import type { ProviderContext } from '../../providers/types.js';
import type { CalendarService } from '../calendar-service.js';
import { humanError } from '../registry.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export function googlePlugin(service: CalendarService): Plugin {
  const cal = () => {
    const c = service.current();
    if (!c) throw new HttpError('internal', 'calendar provider is starting');
    return c;
  };

  return {
    manifest,
    start(ctx: ProviderContext) {
      service.attach(ctx);
    },
    stop() {
      service.stop();
    },
    apply(config, secrets) {
      service.setGoogle({
        GOOGLE_CLIENT_ID: str(config.clientId),
        GOOGLE_CLIENT_SECRET: secrets.clientSecret,
        CALENDAR_POLL_SECONDS: str(config.pollSeconds),
      });
    },
    computed(): IntegrationConfig {
      const c = service.current();
      return c ? { redirectUri: c.redirect.uri } : {};
    },
    async test(config, secrets): Promise<TestResult> {
      const c = cal();
      if (c.googleAuth.connected()) {
        try {
          const list = await c.google.calendars();
          return {
            ok: true,
            message: `Connected as ${c.googleAuth.tokens()?.account ?? 'Google'}: ${list.length} calendar${list.length === 1 ? '' : 's'} found.`,
          };
        } catch (err) {
          return { ok: false, message: humanError(err) };
        }
      }
      if (!config.clientId || !secrets.clientSecret)
        return { ok: false, message: 'Enter the client ID and client secret first.' };
      if (!/\.apps\.googleusercontent\.com$/.test(String(config.clientId)))
        return {
          ok: false,
          message:
            'That does not look like a Google client ID; it should end in .apps.googleusercontent.com.',
        };
      return { ok: true, message: 'Client saved. Press Connect to sign in with Google.' };
    },
    status(): PluginStatusFields {
      const c = service.current();
      if (!c) return { state: 'not_set_up', summary: 'Starting', lastOkAt: null, lastError: null };
      const s = c.sourceStatus('google');
      const tokens = c.googleAuth.tokens();
      if (!s.configured)
        return {
          state: 'not_set_up',
          summary: 'Add a Google Cloud client to connect',
          lastOkAt: null,
          lastError: null,
        };
      if (tokens?.revoked)
        return {
          state: 'error',
          summary: 'Google signed Mantel out. Press Connect to sign in again.',
          lastOkAt: s.lastSync,
          lastError:
            'The refresh token was revoked, usually because the Google app is still in Testing mode.',
        };
      if (!s.connected)
        return {
          state: 'not_set_up',
          summary: 'Client saved. Press Connect to sign in with Google.',
          lastOkAt: null,
          lastError: null,
        };
      const count = c.sourceCalendars().filter((x) => x.source === 'google').length;
      return {
        state: s.error && !s.lastSync ? 'error' : 'connected',
        summary: `Connected as ${tokens?.account ?? 'Google'}, ${count} calendar${count === 1 ? '' : 's'}`,
        lastOkAt: s.lastSync,
        lastError: s.error ? humanError(new Error(s.error)) : null,
      };
    },
    authorizeUrl() {
      const c = cal();
      return {
        url: c.googleAuth.authUrl(),
        redirectUri: c.redirect.uri,
        pasteBack: c.redirect.pasteBack,
      };
    },
    async callback(url: string) {
      const c = cal();
      let parsed: URL;
      try {
        parsed = new URL(url.trim());
      } catch {
        throw new HttpError('bad_request', 'Paste the whole address from the browser bar.');
      }
      const code = parsed.searchParams.get('code');
      const state = parsed.searchParams.get('state');
      if (!code || !state)
        throw new HttpError('bad_request', 'That address has no sign-in code in it.');
      await c.googleAuth.finish(code, state);
      c.start();
      await c.sync();
    },
  };
}

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));
