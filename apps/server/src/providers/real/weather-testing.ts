/** Test helpers for the WS4 providers: a provider context and a fetch that answers by URL. */
import { settings as defaultSettings } from '@mantel/shared/fixtures';
import type { Settings } from '@mantel/shared';
import { vi } from 'vitest';
import { loadConfig } from '../../config.js';
import { openDb } from '../../db/index.js';
import type { ProviderContext } from '../types.js';

export function testContext(now: Date, patch: Partial<Settings> = {}) {
  let clock = now;
  const s = { ...defaultSettings(), ...patch };
  const ctx: ProviderContext & { setNow(d: Date): void } = {
    config: loadConfig({ DATA_DIR: ':memory:' }),
    db: openDb(':memory:'),
    emit: vi.fn(),
    now: () => clock,
    markSynced: vi.fn(),
    settings: () => s,
    setNow: (d) => {
      clock = d;
    },
  };
  return ctx;
}

type Route = (url: URL, init: RequestInit | undefined) => Response | Promise<Response> | undefined;

/** A fetch stub: the first route that returns a Response answers; anything else is a 404. */
export function fakeFetch(...routes: Route[]) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    );
    for (const r of routes) {
      const res = await r(url, init);
      if (res) return res;
    }
    return new Response('not found', { status: 404 });
  });
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
