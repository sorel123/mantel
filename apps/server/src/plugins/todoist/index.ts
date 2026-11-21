/**
 * Todoist (v4 L): link Mantel lists to Todoist projects through the list-sync framework.
 * The token lives in the secrets store; changing it takes effect on the next round.
 */
import { gated, type ListSyncService } from '../../providers/real/lists-sync.js';
import { linkStatus } from '../ha-todo/index.js';
import { humanError } from '../registry.js';
import type { Plugin } from '../types.js';
import { manifest } from './manifest.js';
import { todoistClient, todoistProvider } from './provider.js';

export { manifest };
export { todoistProvider, todoistClient, TODOIST_SYNC_URL } from './provider.js';

export function todoistPlugin(sync: ListSyncService, doFetch?: typeof fetch): Plugin {
  let token: string | null = null;
  let enabled = () => true;
  const provider = gated(
    todoistProvider(() => token, doFetch),
    () => enabled(),
  );
  return {
    manifest,
    start(ctx) {
      enabled = () => ctx.integration?.('todoist').enabled ?? true;
      sync.register(provider);
    },
    stop() {
      sync.unregister('todoist');
    },
    apply(_config, secrets) {
      token = secrets.token?.trim() || null;
    },
    async test(_config, secrets) {
      const t = secrets.token?.trim();
      if (!t) return { ok: false, message: 'Paste your Todoist API token first.' };
      try {
        const { projects = [] } = await todoistClient(t, doFetch).read('projects');
        return {
          ok: true,
          message: `Todoist answered: ${projects.length} project${projects.length === 1 ? '' : 's'}.`,
        };
      } catch (err) {
        return { ok: false, message: humanError(err) };
      }
    },
    status() {
      return linkStatus(sync, 'todoist', provider.readiness(), !token);
    },
  };
}
