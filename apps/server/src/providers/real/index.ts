/**
 * Real integrations. Each workstream replaces its stub with a real implementation in its own
 * file here (`calendar.ts`, `home.ts`, ...) and wires it in below.
 */
import { notImplemented } from '../../errors.js';
import type { ProviderContext, Providers } from '../types.js';
import { realLists } from './lists.js';
import { realPhotos } from './photos.js';
import { realWeather } from './weather.js';
import { loadWs4Env } from './weather-env.js';

const stub = <T extends object>(name: string): T =>
  new Proxy({} as T, {
    get: (_, method) => () => Promise.reject(notImplemented(`${name}.${String(method)}`)),
  });

export function realProviders(ctx: ProviderContext): Providers {
  const ws4 = loadWs4Env();
  return {
    calendar: stub('calendar'),
    weather: realWeather(ctx, { env: ws4 }),
    photos: realPhotos(ctx, { env: ws4 }),
    home: stub('home'),
    lists: realLists(ctx),
  };
}
