/**
 * Apple Reminders (v4 L): the plugin gives it a card, a switch and a status; the work is in
 * `RemindersBridge`, which the Mac helper's check-in route drives.
 */
import type { ListSyncService } from '../../providers/real/lists-sync.js';
import { linkStatus } from '../ha-todo/index.js';
import type { Plugin } from '../types.js';
import type { RemindersBridge } from './bridge.js';
import { manifest } from './manifest.js';

export { manifest };
export { RemindersBridge } from './bridge.js';

export function remindersPlugin(sync: ListSyncService, bridge: RemindersBridge): Plugin {
  const provider = bridge.provider();
  return {
    manifest,
    start(ctx) {
      bridge.enabled = () => ctx.integration?.('reminders').enabled ?? true;
      sync.register(provider);
    },
    stop() {
      sync.unregister('reminders');
    },
    apply() {},
    async test() {
      const r = provider.readiness();
      return { ok: r.ready, message: r.summary };
    },
    status() {
      return linkStatus(sync, 'reminders', provider.readiness(), !bridge.helper());
    },
  };
}
