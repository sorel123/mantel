/**
 * Routes for v4 D: the activity log, the digest and its test button, the digest status for
 * Settings, and (mock mode) the push outbox the smoke test reads.
 */
import type { Settings } from '@mantel/shared';
import type { AppDeps } from '../../app.js';
import type { Handle } from '../../contract.js';
import { HttpError } from '../../errors.js';
import { dateInZone } from '../../providers/real/weather-time.js';
import { ActivityLog } from '../activity/log.js';
import { writerFor } from '../activity/writer.js';
import { shiftDate, wallTime } from '../import/zone.js';
import type { NoteStore } from '../notes/store.js';
import type { PushService } from '../push/service.js';
import { attachDigestService } from './plugin.js';
import { DigestService, type DigestServiceOptions } from './service.js';

export { DigestService } from './service.js';
export { digestPlugin } from './plugin.js';

export function registerDigestRoutes(
  handle: Handle,
  deps: AppDeps,
  o: { push: PushService; notes: NoteStore; meals: DigestServiceOptions['meals'] },
) {
  const { db, auth, hub, settings, config, providers, registry } = deps;
  const tz = () => settings.get().timezone;

  const digest = new DigestService({
    db,
    now: () => new Date(),
    settings: () => settings.get() as Settings,
    providers,
    meals: o.meals,
    push: o.push,
    registry,
    mock: config.MOCK,
  });
  attachDigestService(db, digest);

  const writer = writerFor(auth);
  const activity = new ActivityLog({
    db,
    now: () => new Date(),
    timeZone: tz,
    people: () => settings.get().people,
    emit: (e) => hub.broadcast(e),
    writer: () => writer.recent(),
    device: (id) => {
      const d = auth.list(null).find((x) => x.id === id);
      return d ? { name: d.name, personId: o.push.personOfDevice(id) } : null;
    },
    sources: {
      lists: () => providers.lists.lists().then((r) => r.lists),
      chores: () => providers.lists.chores().then((r) => r.chores),
      events: async () => {
        const today = dateInZone(new Date(), tz());
        const [events, calendars] = await Promise.all([
          providers.calendar
            .events(
              wallTime(shiftDate(today, -1), '00:00', tz()),
              wallTime(shiftDate(today, 62), '00:00', tz()),
            )
            .then((r) => r.events),
          providers.calendar.calendars(),
        ]);
        return { events, calendars };
      },
      meals: async () => {
        const today = dateInZone(new Date(), tz());
        const [a, b] = await Promise.all([
          o.meals.todayMeals(wallTime(today, '12:00', tz())),
          o.meals.todayMeals(wallTime(shiftDate(today, 7), '12:00', tz())),
        ]);
        return [...a.meals, ...b.meals].filter((m) => m.date >= today) as never;
      },
      notes: () => o.notes.list(),
    },
  });
  void activity.prime().catch(() => undefined);
  hub.onEvent((e) => {
    activity.handleEvent(e);
    if (e.type === 'calendar.changed') digest.calendarChanged();
    if (
      e.type === 'calendar.changed' ||
      e.type === 'chores.changed' ||
      e.type === 'weather.updated'
    )
      // The wall card follows the day; a short delay lets a burst of changes settle.
      setTimeout(
        () => hub.broadcast({ type: 'plugin.changed', payload: { id: 'digest' } }),
        1500,
      ).unref?.();
  });
  if (!config.MOCK || process.env.MANTEL_DIGEST_SCHEDULE === '1') digest.start();

  handle('activity', async ({ query }) => ({
    entries: activity.list(query.since, query.limit ?? 50),
    now: new Date().toISOString(),
  }));

  const personFor = (personId: string | undefined, deviceId: string | null) => {
    const people = settings.get().people;
    const id = personId ?? (deviceId ? o.push.personOfDevice(deviceId) : null) ?? people[0]?.id;
    if (id && !people.some((p) => p.id === id))
      throw new HttpError('bad_request', `nobody called ${id} in Settings, People`);
    return id ?? null;
  };

  handle('digest', async ({ query, deviceId }) => {
    const personId = query.personId ?? (deviceId ? o.push.personOfDevice(deviceId) : null);
    return { digest: await digest.build(query.kind ?? 'morning', personId ?? null) };
  });

  handle('digestTest', async ({ body, deviceId }) => {
    const personId = personFor(body.personId, deviceId);
    if (!personId) throw new HttpError('bad_request', 'Add a person in Settings, People first.');
    const name = settings.get().people.find((p) => p.id === personId)?.name ?? 'them';
    const r = await digest.send(body.kind, personId, { alsoDeviceId: deviceId, test: true });
    return {
      ok: r.sent > 0,
      message:
        r.sent > 0
          ? `Sent to ${r.sent} phone${r.sent === 1 ? '' : 's'}. It should arrive in a few seconds.`
          : `No phone takes ${name}'s digest yet. On ${name}'s phone open the Mantel app, tap the bell, turn notifications on and choose ${name}.`,
      sent: r.sent,
      url: r.url,
      digest: r.digest,
    };
  });

  handle('digestStatus', async () => digest.status());

  handle('pushOutbox', async () => ({
    messages: config.MOCK
      ? o.push.outbox.slice(-50).map((m) => ({
          subscriptionId: m.subscriptionId,
          at: m.at,
          kind: m.message.kind,
          title: m.message.title,
          body: m.message.body,
          url: m.message.url,
        }))
      : [],
  }));

  return { digest, activity, close: () => (digest.stop(), activity.stop()) };
}
