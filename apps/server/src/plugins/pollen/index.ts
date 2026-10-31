/** Pollen plugin: Open-Meteo where it has pollen (Europe), the Google Pollen API with a key elsewhere. */
import type { TestResult } from '@mantel/shared';
import { googlePollenUrl } from '../../providers/real/weather-extras.js';
import { integrationValues, type ProviderContext } from '../../providers/types.js';
import { humanError } from '../registry.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import type { WeatherService } from '../weather-service.js';
import { manifest } from './manifest.js';

export function pollenPlugin(service: WeatherService, doFetch?: typeof fetch): Plugin {
  const fetcher = doFetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let ctx: ProviderContext | null = null;
  let hasKey = false;
  return {
    manifest,
    start(c) {
      ctx = c;
      service.attach(c);
    },
    stop() {},
    apply(_config, secrets) {
      hasKey = Boolean(secrets.googleKey);
      service.set('pollen', { GOOGLE_POLLEN_API_KEY: secrets.googleKey });
    },
    async test(_config, secrets): Promise<TestResult> {
      const key =
        secrets.googleKey ?? (ctx ? integrationValues(ctx, 'routes').secrets.googleKey : undefined);
      if (!key)
        return {
          ok: true,
          message:
            'No key: pollen comes from Open-Meteo where it has data (Europe). Add a Google key for other regions.',
        };
      if (!ctx) return { ok: false, message: 'Starting up; try again in a moment.' };
      const { latitude, longitude } = ctx.settings().location;
      try {
        const res = await fetcher(googlePollenUrl(latitude, longitude, key), {
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 403)
          return {
            ok: false,
            message: 'Google refused the key. Enable the Pollen API for it in the Cloud console.',
          };
        if (!res.ok) throw new Error(`Google Pollen answered ${res.status}`);
        return { ok: true, message: 'Google Pollen answered for your location.' };
      } catch (err) {
        return { ok: false, message: humanError(err) };
      }
    },
    status(): PluginStatusFields {
      const routesKey = ctx ? integrationValues(ctx, 'routes').secrets.googleKey : undefined;
      return {
        state: 'connected',
        summary: hasKey
          ? 'Google Pollen API'
          : routesKey
            ? 'Google Pollen API, using the Leave-by key'
            : 'Open-Meteo pollen where available (Europe)',
        lastOkAt: null,
        lastError: null,
      };
    },
  };
}
