import type { AppDeps } from '../app.js';
import type { Handle } from '../contract.js';
import { HttpError } from '../errors.js';

/**
 * v4 workstream L: sharing lists with Apple Reminders, Todoist and Home Assistant to-do lists.
 * The service lives on the lists provider (`providers.lists.sync`); the Mac helper pairs like a
 * display, so its check-in is an ordinary authenticated route.
 */
export function registerListSyncRoutes(handle: Handle, deps: AppDeps) {
  const sync = () => {
    const s = deps.providers.lists.sync;
    if (!s) throw new HttpError('not_implemented', 'list sharing is not available on this server');
    return s;
  };
  const reminders = () => {
    const r = sync().reminders;
    if (!r)
      throw new HttpError('not_implemented', 'Apple Reminders is not available on this server');
    return r;
  };

  handle('listSync', async () => ({ providers: sync().providerInfo(), links: sync().links() }));
  handle('listSyncRemote', async ({ params }) => {
    const id = params.provider;
    if (id !== 'reminders' && id !== 'todoist' && id !== 'ha-todo')
      throw new HttpError('bad_request', `no list service called ${id}`);
    return { lists: await sync().remoteLists(id) };
  });
  handle('listLink', async ({ params, body }) => ({
    link: await sync().linkList(params.id!, body.provider, body.remoteListId, body.remoteName),
  }));
  handle('listUnlink', async ({ params }) => {
    sync().unlink(params.id!);
    return { ok: true as const };
  });
  handle('listSyncNow', async ({ params }) => {
    const s = sync();
    const link = s.link(params.id!);
    if (!link) throw new HttpError('not_found', 'that list is not shared with anything');
    // Reminders syncs when the Mac helper next checks in (within seconds while it is awake).
    if (s.provider(link.provider)?.pollSeconds === null) return { link };
    return { link: await s.sync(params.id!) };
  });
  handle('remindersSync', async ({ body }) => reminders().checkIn(body));
  handle('remindersShortcut', async ({ body }) => reminders().shortcut(body.list, body.items));
}
