/**
 * Notifications on the phone: a service worker (`/sw.js`) receives Web Push and shows it. The
 * browser only offers push in a secure context (https, or http://localhost), so on a plain-http
 * LAN address `reason` says what to do instead of showing a switch that cannot work.
 */
import type { PushEventKind, PushSubscriptionInfo } from '@mantel/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';

export type PushSupport =
  { ok: true } | { ok: false; reason: 'insecure' | 'unsupported' | 'not-installed' | 'denied' };

const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent);
const isStandalone = () =>
  (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' };
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    // iOS offers push only to an app added to the home screen.
    return { ok: false, reason: isIos() && !isStandalone() ? 'not-installed' : 'unsupported' };
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
  return { ok: true };
}

export const SUPPORT_TEXT: Record<Exclude<PushSupport, { ok: true }>['reason'], string> = {
  insecure:
    'Notifications need a secure address. Open Mantel over https, or on the computer running it at http://localhost.',
  'not-installed':
    'On an iPhone, add Mantel to the home screen first (Share, then Add to Home Screen), then open it from there.',
  unsupported: 'This browser cannot show notifications from a web app.',
  denied:
    'Notifications are blocked for this site. Allow them in the browser settings, then come back.',
};

function toKey(base64Url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function worker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}

export const DEFAULT_EVENTS: PushEventKind[] = ['doorbell', 'chores', 'leaveBy', 'reward'];

export function usePush() {
  const support = pushSupport();
  const [mine, setMine] = useState<PushSubscriptionInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { subscriptions } = await api.call('pushSubscriptions');
      let current = subscriptions.find((s) => s.current) ?? null;
      // The server's row for this device may belong to a subscription the browser dropped.
      if (current && support.ok) {
        const reg = await navigator.serviceWorker.getRegistration('/');
        const sub = await reg?.pushManager.getSubscription();
        if (!sub) current = null;
      }
      setMine(current);
    } catch {
      setMine(null);
    }
  }, [support.ok]);
  useEffect(() => void load(), [load]);

  const enable = async (
    events: PushEventKind[] = DEFAULT_EVENTS,
    personId: string | null = null,
  ) => {
    if (!support.ok) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError('Notifications were not allowed.');
        return;
      }
      const { publicKey } = await api.call('pushConfig');
      const reg = await worker();
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toKey(publicKey) as BufferSource,
        }));
      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
        throw new Error('the browser gave no push address');
      const { subscription } = await api.call('pushSubscribe', {
        body: {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          events,
          personId,
        },
      });
      setMine(subscription);
    } catch (err) {
      setError(
        `Could not turn notifications on: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      if (mine) await api.call('pushDelete', { params: { id: mine.id } }).catch(() => undefined);
      const reg = await navigator.serviceWorker.getRegistration('/');
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
      setMine(null);
    } finally {
      setBusy(false);
    }
  };

  const update = async (patch: { events?: PushEventKind[]; personId?: string | null }) => {
    if (!mine) return;
    const { subscription } = await api.call('pushPatch', { params: { id: mine.id }, body: patch });
    setMine(subscription);
  };

  const test = async () => {
    if (!mine) return { ok: false, message: 'Turn notifications on first.' };
    return api.call('pushTest', { params: { id: mine.id } });
  };

  return { support, mine, busy, error, enable, disable, update, test, reload: load };
}
