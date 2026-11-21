/**
 * Home Assistant to-do lists (v4 L): links Mantel lists to `todo.*` entities over the Home
 * Assistant connection. Nothing to configure here; the plugin's switch turns the sharing on.
 */
import { gated, type ListSyncService } from '../../providers/real/lists-sync.js';
import type { Plugin } from '../types.js';
import { manifest } from './manifest.js';
import { haTodoProvider, type TodoClient } from './provider.js';

export { manifest };
export { haTodoProvider, type TodoClient } from './provider.js';

export function haTodoPlugin(sync: ListSyncService, client: () => TodoClient | null): Plugin {
  let enabled = () => true;
  const provider = gated(haTodoProvider(client), () => enabled());
  return {
    manifest,
    start(ctx) {
      enabled = () => ctx.integration?.('ha-todo').enabled ?? true;
      sync.register(provider);
    },
    stop() {
      sync.unregister('ha-todo');
    },
    apply() {},
    async test() {
      const r = provider.readiness();
      return { ok: r.ready, message: r.summary };
    },
    status() {
      return linkStatus(sync, 'ha-todo', provider.readiness());
    },
  };
}

/** A sync plugin's status for Integrations and Health: readiness, then how its links are doing. */
export function linkStatus(
  sync: ListSyncService,
  id: 'ha-todo' | 'todoist' | 'reminders',
  ready: { ready: boolean; summary: string },
  notSetUp = false,
) {
  const links = sync.links().filter((l) => l.provider === id);
  const failing = links.find((l) => l.state === 'error');
  const last =
    links
      .map((l) => l.lastSyncAt)
      .filter((t): t is string => !!t)
      .sort()
      .at(-1) ?? null;
  if (notSetUp || (!ready.ready && links.length === 0))
    return {
      state: 'not_set_up' as const,
      summary: ready.summary,
      lastOkAt: last,
      lastError: null,
    };
  if (failing)
    return {
      state: 'error' as const,
      summary: failing.summary,
      lastOkAt: last,
      lastError: failing.lastError,
    };
  const shared = links.length
    ? ` · ${links.length} list${links.length === 1 ? '' : 's'} shared`
    : ' · no lists shared yet';
  return {
    state: ready.ready ? ('connected' as const) : ('error' as const),
    summary: ready.ready ? `${ready.summary}${shared}` : ready.summary,
    lastOkAt: last,
    lastError: ready.ready ? null : ready.summary,
  };
}
