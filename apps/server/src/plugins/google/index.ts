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
import { googleManifest } from './manifest.js';
import { sharedGoogleClient, type SharedClient } from './shared-client.js';

export function googlePlugin(
  service: CalendarService,
  shared: SharedClient | null = sharedGoogleClient(),
): Plugin {
  const manifest = googleManifest(Boolean(shared));
  /** The household's own client when both halves are set, else Mantel's shared one. */
  const own = (config: IntegrationConfig, secrets: Record<string, string | undefined>) =>
    Boolean(config.clientId && secrets.clientSecret);
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
      const useShared = !own(config, secrets) && shared;
      service.setGoogle({
        GOOGLE_CLIENT_ID: useShared ? shared.clientId : str(config.clientId),
        GOOGLE_CLIENT_SECRET: useShared ? shared.clientSecret : secrets.clientSecret,
        GOOGLE_LOOPBACK: useShared ? '1' : undefined,
        CALENDAR_POLL_SECONDS: str(config.pollSeconds),
      });
    },
    computed(): IntegrationConfig {
      const c = service.current();
      // The redirect only matters for a household's own client; the shared one needs none.
      return c && !c.redirect.uri.startsWith('http://127.0.0.1:')
        ? { redirectUri: c.redirect.uri }
        : {};
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
      if (!own(config, secrets)) {
        if (shared) return { ok: true, message: 'Ready. Press Connect to sign in with Google.' };
        return { ok: false, message: 'Enter the client ID and client secret first.' };
      }
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
          summary: shared
            ? 'Press Connect to sign in with Google'
            : 'Add a Google Cloud client to connect',
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
          summary: shared
            ? 'Press Connect to sign in with Google.'
            : 'Client saved. Press Connect to sign in with Google.',
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
