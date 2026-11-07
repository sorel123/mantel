/** Routes for wall notes (v3 C): post from a phone or the wall, show on Today and Ambient. */
import { DEVICE_KEY_HEADER } from '@mantel/shared';
import type { AppDeps } from '../../app.js';
import type { Handle } from '../../contract.js';
import { HttpError, notFound } from '../../errors.js';
import type { PushService } from '../push/service.js';
import { NoteStore } from './store.js';

export { NoteStore } from './store.js';

export function registerNotesRoutes(handle: Handle, deps: AppDeps, push: PushService): NoteStore {
  const { db, auth, hub, settings, config } = deps;
  const store = new NoteStore(
    db,
    () => new Date(),
    () => settings.get().timezone,
  );
  if (config.MOCK && !config.MOCK_EMPTY) store.seed();
  const changed = () => hub.broadcast({ type: 'notes.changed', payload: {} });

  handle('notes', async () => ({ notes: store.list() }));
  handle('noteCreate', async ({ body, deviceId }) => {
    const from = deviceId ? (auth.list(deviceId).find((d) => d.current)?.name ?? null) : null;
    const note = store.create(body, from);
    changed();
    const who = settings.get().people.find((p) => p.id === note.personId)?.name;
    void push.notify(
      'note',
      {
        title: who ? `A note from ${who}` : 'A new note on the wall',
        body: note.text || 'A drawing',
        url: '/app#note',
        tag: `note-${note.id}`,
      },
      { exceptDeviceId: deviceId },
    );
    return { note };
  });
  handle('noteDelete', async ({ params }) => {
    if (!store.delete(params.id!)) throw notFound(`note ${params.id}`);
    changed();
    return { ok: true as const };
  });
  handle('noteImage', async ({ c, params, query }) => {
    if (!auth.verify(c.req.header(DEVICE_KEY_HEADER) ?? query.key))
      throw new HttpError('unauthorized', 'missing or invalid device key');
    const png = store.image(params.id!);
    if (!png) throw notFound(`drawing ${params.id}`);
    return new Response(new Uint8Array(png), {
      headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' },
    });
  });
  return store;
}
