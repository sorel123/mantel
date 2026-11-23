/**
 * The digest as a plugin (v4 D): the "Today at a glance" card for the custom Today layout and a
 * good-morning line on Ambient, drawn by the display from blocks like trash day and the timers.
 * The routes in `index.ts` build the `DigestService`; the plugin finds it through the database
 * both share, so the plugin can be made in `localPlugins()` before the routes exist.
 */
import type { Db } from '../../db/index.js';
import type { ProviderContext } from '../../providers/types.js';
import type { Plugin } from '../types.js';
import { manifest } from './manifest.js';
import type { DigestService } from './service.js';

const services = new WeakMap<Db, DigestService>();

export function attachDigestService(db: Db, service: DigestService) {
  services.set(db, service);
}

export function digestPlugin(): Plugin {
  let ctx: ProviderContext | null = null;
  const service = () => (ctx ? services.get(ctx.db) : undefined);
  return {
    manifest,
    start(c) {
      ctx = c;
    },
    stop() {},
    apply() {},
    async test() {
      const s = service()?.status();
      const phones = s?.people.reduce((n, p) => n + p.phones, 0) ?? 0;
      return {
        ok: true,
        message: phones
          ? `Ready: ${phones} phone${phones === 1 ? '' : 's'} take the digest.`
          : 'Ready. No phone takes the digest yet: turn notifications on in the phone app.',
      };
    },
    status() {
      const people = ctx?.settings().people.length ?? 0;
      return {
        state: 'connected',
        summary: `Morning digest for ${people} ${people === 1 ? 'person' : 'people'}`,
        lastOkAt: null,
        lastError: null,
      };
    },
    async blocks(name) {
      const s = service();
      if (!s) return name === 'card' || name === 'ambient' ? null : undefined;
      return s.blocks(name);
    },
  };
}
