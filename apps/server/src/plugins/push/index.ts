/** Routes for Web Push (v3 C). The service turns server events into phone notifications. */
import type { CalendarEvent } from '@mantel/shared';
import type { AppDeps } from '../../app.js';
import type { Handle } from '../../contract.js';
import { HttpError, notFound } from '../../errors.js';
import { PushService } from './service.js';

export { PushService } from './service.js';

export function registerPushRoutes(
  handle: Handle,
  deps: AppDeps,
  todaysEvents: () => Promise<CalendarEvent[]>,
): PushService {
  const { auth, hub, settings, config, providers, secrets, db } = deps;
  const push = new PushService({
    db,
    secrets,
    now: () => new Date(),
    people: () => settings.get().people,
    deviceName: (id) => auth.list(null).find((d) => d.id === id)?.name ?? 'A phone',
    active: (id) => config.MOCK || auth.list(null).some((d) => d.id === id && !d.revokedAt),
    mock: config.MOCK,
  });
  const loadChores = () => providers.lists.chores();
  void push.primeChores(loadChores);
  hub.onEvent((e) => push.handleEvent(e, loadChores));
  if (!config.MOCK)
    push.startLeaveBy(() => providers.weather.commute(todaysEvents).then((r) => r.leaveBy));

  const need = (deviceId: string | null) => {
    if (!deviceId) throw new HttpError('unauthorized', 'missing or invalid device key');
    return deviceId;
  };

  handle('pushConfig', async () => ({ publicKey: push.vapid().publicKey }));
  handle('pushSubscriptions', async ({ deviceId }) => ({ subscriptions: push.list(deviceId) }));
  handle('pushSubscribe', async ({ body, deviceId }) => ({
    subscription: push.subscribe(need(deviceId), body),
  }));
  handle('pushPatch', async ({ params, body, deviceId }) => {
    const subscription = push.patch(params.id!, body, deviceId);
    if (!subscription) throw notFound(`subscription ${params.id}`);
    return { subscription };
  });
  handle('pushDelete', async ({ params }) => {
    if (!push.delete(params.id!)) throw notFound(`subscription ${params.id}`);
    return { ok: true as const };
  });
  handle('pushTest', async ({ params }) => push.test(params.id!));
  return push;
}
