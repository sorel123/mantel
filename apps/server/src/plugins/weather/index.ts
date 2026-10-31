/** Weather plugin: Open-Meteo plus weather.gov alerts, no key. Shares the provider with pollen and routes. */
import type { TestResult } from '@mantel/shared';
import { forecastUrl } from '../../providers/real/weather-openmeteo.js';
import type { ProviderContext } from '../../providers/types.js';
import { humanError } from '../registry.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import type { WeatherService } from '../weather-service.js';
import { manifest } from './manifest.js';

export function weatherPlugin(service: WeatherService, doFetch?: typeof fetch): Plugin {
  const fetcher = doFetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let ctx: ProviderContext | null = null;
  return {
    manifest,
    start(c) {
      ctx = c;
      service.attach(c);
    },
    stop() {
      service.stop();
    },
    apply(config) {
      service.set('weather', {
        NWS_CONTACT: config.nwsContact === undefined ? undefined : String(config.nwsContact),
      });
    },
    async test(): Promise<TestResult> {
      if (!ctx) return { ok: false, message: 'Starting up; try again in a moment.' };
      const s = ctx.settings();
      try {
        const res = await fetcher(
          forecastUrl({
            latitude: s.location.latitude,
            longitude: s.location.longitude,
            timeZone: s.timezone,
            units: s.units,
          }),
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
        const json = (await res.json()) as { current?: { temperature_2m?: number } };
        const temp = json.current?.temperature_2m;
        return {
          ok: true,
          message: `Open-Meteo answered for ${s.location.name || 'home'}${temp !== undefined ? `: ${Math.round(temp)}° right now` : ''}.`,
        };
      } catch (err) {
        return { ok: false, message: humanError(err) };
      }
    },
    status(): PluginStatusFields {
      return {
        state: 'connected',
        summary: 'Open-Meteo and weather.gov, no key needed',
        lastOkAt: null,
        lastError: null,
      };
    },
  };
}
