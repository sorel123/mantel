/**
 * Leave-by plugin: a Google Routes key for live traffic, else OpenRouteService or OSRM with
 * none (workstream H adds the keyless routing in `providers/real/commute.ts`).
 */
import type { TestResult } from '@mantel/shared';
import { ROUTES_URL, commuteStatus } from '../../providers/real/commute.js';
import { loadWs4Env } from '../../providers/real/weather-env.js';
import type { ProviderContext } from '../../providers/types.js';
import { humanError } from '../registry.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import type { WeatherService } from '../weather-service.js';
import { manifest } from './manifest.js';

export function routesPlugin(service: WeatherService, doFetch?: typeof fetch): Plugin {
  const fetcher = doFetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let ctx: ProviderContext | null = null;
  let summary = commuteStatus(loadWs4Env({})).summary;
  return {
    manifest,
    start(c) {
      ctx = c;
      service.attach(c);
    },
    stop() {},
    apply(config, secrets) {
      const values = {
        GOOGLE_ROUTES_API_KEY: secrets.googleKey,
        OPENROUTESERVICE_API_KEY: secrets.openRouteServiceKey,
        OSRM_BASE_URL: config.osrmUrl === undefined ? undefined : String(config.osrmUrl),
      };
      try {
        summary = commuteStatus(loadWs4Env(values)).summary;
      } catch (err) {
        summary = humanError(err);
      }
      service.set('routes', values);
    },
    async test(_config, secrets): Promise<TestResult> {
      if (!secrets.googleKey) {
        return {
          ok: true,
          message: secrets.openRouteServiceKey
            ? 'OpenRouteService key saved; drive times without live traffic.'
            : 'No key: drive times come from OpenStreetMap routing without live traffic.',
        };
      }
      if (!ctx) return { ok: false, message: 'Starting up; try again in a moment.' };
      const s = ctx.settings();
      const origin = { latitude: s.location.latitude, longitude: s.location.longitude };
      const dest = s.destinations[0];
      try {
        const res = await fetcher(ROUTES_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': secrets.googleKey,
            'x-goog-fieldmask': 'routes.duration',
          },
          body: JSON.stringify({
            origin: { location: { latLng: origin } },
            destination: dest
              ? { address: dest.address }
              : {
                  location: {
                    latLng: { latitude: origin.latitude + 0.02, longitude: origin.longitude },
                  },
                },
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE',
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 403)
          return {
            ok: false,
            message: 'Google refused the key. Enable the Routes API for it in the Cloud console.',
          };
        if (!res.ok) throw new Error(`Google Routes answered ${res.status}`);
        return {
          ok: true,
          message: dest
            ? `Google Routes answered with a drive time to ${dest.name}. Live traffic is on.`
            : 'Google Routes answered. Live traffic is on.',
        };
      } catch (err) {
        return { ok: false, message: humanError(err) };
      }
    },
    status(): PluginStatusFields {
      return { state: 'connected', summary, lastOkAt: null, lastError: null };
    },
  };
}
