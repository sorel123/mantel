/**
 * Home Assistant plugin: URL and token from Settings; the provider (WebSocket client plus the
 * allow-list) is rebuilt when they change and stopped when the plugin is turned off.
 */
import type { TestResult } from '@mantel/shared';
import { z } from 'zod';
import { HttpError, notImplemented } from '../../errors.js';
import { loadHaEnv } from '../../providers/real/home-config.js';
import { realHome, type RealHome } from '../../providers/real/home.js';
import type { HomeProvider, ProviderContext } from '../../providers/types.js';
import { live, type Live } from '../live.js';
import { humanError } from '../registry.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

const ConfigJson = z.object({
  version: z.string().optional(),
  location_name: z.string().optional(),
});

const offline = (why: string): HomeProvider => {
  const off = () => Promise.reject(notImplemented(why));
  return {
    state: off,
    call: off,
    announce: off,
    cameraSnapshot: off,
    cameraStream: off,
    media: off,
    mediaCall: off,
    mediaArtwork: off,
  };
};

export interface HomeAssistantPluginOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export function homeAssistantPlugin(opts: HomeAssistantPluginOptions = {}): Plugin & {
  live: Live<HomeProvider>;
} {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const liveHome = live<HomeProvider>(offline('Home Assistant (starting)'));
  let ctx: ProviderContext | null = null;
  let instance: RealHome | null = null;
  let builtFrom = '';
  let configured = false;
  let currentUrl = '';
  let lastError: string | null = null;

  return {
    manifest,
    live: liveHome,
    start(c) {
      ctx = c;
    },
    stop() {
      instance?.stop();
      instance = null;
    },
    apply(config, secrets) {
      if (!ctx) return;
      const url = config.url ? String(config.url) : undefined;
      const token = secrets.token;
      const key = JSON.stringify([url, token, config.streamMaxSeconds]);
      if (instance && key === builtFrom) return;
      builtFrom = key;
      instance?.stop();
      instance = null;
      configured = Boolean(url && token);
      currentUrl = url ?? '';
      if (!configured) {
        liveHome.set(offline('Home Assistant (add the address and a token in Settings)'));
        return;
      }
      const base = opts.env ?? process.env;
      try {
        instance = realHome(
          ctx,
          loadHaEnv({
            HA_URL: url,
            HA_TOKEN: token,
            HA_ALLOWLIST: base.HA_ALLOWLIST,
            HA_STREAM_MAX_SECONDS:
              config.streamMaxSeconds === undefined ? undefined : String(config.streamMaxSeconds),
          }),
        );
        instance.client?.on('down', (reason) => {
          lastError = `Lost the connection to Home Assistant: ${reason}`;
        });
        instance.client?.on('ready', () => {
          lastError = null;
        });
        liveHome.set(instance);
      } catch (err) {
        lastError = humanError(err);
        liveHome.set(offline('Home Assistant (settings are not valid)'));
      }
    },
    async test(config, secrets): Promise<TestResult> {
      if (!config.url || !secrets.token)
        return {
          ok: false,
          message: 'Enter the Home Assistant address and a long-lived token first.',
        };
      let base: string;
      try {
        base = new URL(String(config.url)).origin;
      } catch {
        return { ok: false, message: 'The address must start with http:// or https://.' };
      }
      try {
        const res = await doFetch(`${base}/api/config`, {
          headers: { authorization: `Bearer ${secrets.token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        });
        if (res.status === 401)
          return {
            ok: false,
            message:
              'Home Assistant refused the token. Create a new long-lived token and paste the whole thing.',
          };
        if (!res.ok) throw new HttpError('upstream_error', `Home Assistant answered ${res.status}`);
        const info = ConfigJson.parse(await res.json());
        return {
          ok: true,
          message: `Connected to ${info.location_name ?? 'Home Assistant'}${info.version ? ` (Home Assistant ${info.version})` : ''}.`,
        };
      } catch (err) {
        return { ok: false, message: humanError(err) };
      }
    },
    status(): PluginStatusFields {
      if (!configured)
        return {
          state: 'not_set_up',
          summary: 'Add the Home Assistant address and a token',
          lastOkAt: null,
          lastError: null,
        };
      const client = instance?.client;
      if (client?.connected) {
        return {
          state: 'connected',
          summary: `Connected to ${currentUrl}`,
          lastOkAt: new Date().toISOString(),
          lastError: null,
        };
      }
      return {
        state: client?.hasStates ? 'connected' : 'error',
        summary: client?.hasStates
          ? 'Reconnecting to Home Assistant'
          : (lastError ?? 'Not connected yet. Press Test to check the address and token.'),
        lastOkAt: null,
        lastError,
      };
    },
  };
}
