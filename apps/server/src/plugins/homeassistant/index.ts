/**
 * Home Assistant plugin: URL and token from Settings (the token in the encrypted secret store);
 * the provider (WebSocket client plus the allow-list) is rebuilt when they change and stopped
 * when the plugin is turned off. The allow-list store is made once here and shared across
 * rebuilds, so the Settings page can edit rooms before a token is ever entered.
 */
import type { TestResult } from '@mantel/shared';
import { loadHaEnv } from '../../providers/real/home-config.js';
import { testHaConnection } from '../../providers/real/home-discover.js';
import { HomeConfigStore } from '../../providers/real/home-store.js';
import { realHome, type RealHome } from '../../providers/real/home.js';
import type { HomeProvider, ProviderContext } from '../../providers/types.js';
import { live, type Live } from '../live.js';
import { humanError } from '../registry.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export interface HomeAssistantPluginOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export function homeAssistantPlugin(opts: HomeAssistantPluginOptions = {}): Plugin & {
  live: Live<HomeProvider>;
} {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const liveHome = live<HomeProvider>({} as HomeProvider);
  let ctx: ProviderContext | null = null;
  let store: HomeConfigStore | null = null;
  let instance: RealHome | null = null;
  let builtFrom = '';
  let configured = false;
  let currentUrl = '';
  let lastError: string | null = null;

  const build = (env: ReturnType<typeof loadHaEnv>) => {
    if (!ctx || !store) return;
    instance?.stop();
    instance = realHome(ctx, env, { store });
    instance.client?.on('down', (reason) => {
      lastError = `Lost the connection to Home Assistant: ${reason}`;
    });
    instance.client?.on('ready', () => {
      lastError = null;
    });
    liveHome.set(instance);
  };

  return {
    manifest,
    live: liveHome,
    start(c) {
      ctx = c;
      const base = opts.env ?? process.env;
      // A changed allow-list can add or drop whole cards, so displays reload to pick it up.
      store = new HomeConfigStore(c.db, { importFrom: base.HA_ALLOWLIST }, () =>
        c.emit({ type: 'display.reload', payload: {} }),
      );
      // Unconfigured (or turned off) the provider still serves the setup routes.
      build(loadHaEnv({ HA_ALLOWLIST: base.HA_ALLOWLIST }));
    },
    stop() {
      instance?.stop();
      instance = null;
    },
    apply(config, secrets) {
      if (!ctx) return;
      const url = config.url ? String(config.url).replace(/\/+$/, '') : undefined;
      const token = secrets.token;
      const key = JSON.stringify([url, token, config.streamMaxSeconds]);
      if (instance && key === builtFrom) return;
      builtFrom = key;
      configured = Boolean(url && token);
      currentUrl = url ?? '';
      lastError = null;
      const base = opts.env ?? process.env;
      try {
        build(
          loadHaEnv({
            HA_URL: url,
            HA_TOKEN: token,
            HA_ALLOWLIST: base.HA_ALLOWLIST,
            HA_STREAM_MAX_SECONDS:
              config.streamMaxSeconds === undefined ? undefined : String(config.streamMaxSeconds),
          }),
        );
      } catch (err) {
        lastError = humanError(err);
        build(loadHaEnv({ HA_ALLOWLIST: base.HA_ALLOWLIST }));
      }
    },
    async test(config, secrets): Promise<TestResult> {
      const r = await testHaConnection(
        config.url ? String(config.url) : '',
        secrets.token ?? '',
        doFetch,
      );
      return { ok: r.ok, message: r.message };
    },
    status(): PluginStatusFields {
      if (!configured)
        return {
          state: 'not_set_up',
          summary: 'Add the Home Assistant address and a token',
          lastOkAt: null,
          lastError,
        };
      const client = instance?.client;
      if (client?.connected) {
        return {
          state: 'connected',
          summary: `Connected to ${currentUrl}`,
          lastOkAt: client.lastOkAt ?? new Date().toISOString(),
          lastError: null,
        };
      }
      const why = client?.lastError ?? lastError;
      return {
        state: client?.hasStates ? 'connected' : 'error',
        summary: client?.hasStates
          ? 'Reconnecting to Home Assistant'
          : (why ?? 'Not connected yet. Press Test to check the address and token.'),
        lastOkAt: client?.lastOkAt ?? null,
        lastError: why,
      };
    },
  };
}
