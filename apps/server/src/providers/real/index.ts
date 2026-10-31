/**
 * Real integrations. Each workstream replaces its stub with a real implementation in its own
 * file here (`calendar.ts`, `home.ts`, ...) and wires it in below.
 */
import { notImplemented } from '../../errors.js';
import type { ProviderContext, Providers } from '../types.js';

const stub = <T extends object>(name: string): T =>
  new Proxy({} as T, {
    get: (_, method) => () => Promise.reject(notImplemented(`${name}.${String(method)}`)),
  });

export function realProviders(_ctx: ProviderContext): Providers {
  return {
    calendar: stub('calendar'),
    weather: stub('weather'),
    photos: stub('photos'),
    home: stub('home'),
    lists: stub('lists'),
  };
}
