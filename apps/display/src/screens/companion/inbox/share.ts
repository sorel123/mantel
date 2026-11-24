/**
 * Share to Mantel from another app (v4 K), on Android and desktop Chrome: the installed app is a
 * Web Share Target (`share_target` in manifest.webmanifest). The share is a form POST to
 * `/app/share`, which the service worker (`/sw.js`) catches, keeps in a cache, and answers with a
 * redirect to `/app?shared=1#inbox`. Here the phone app picks the shared things up and sends them
 * to the inbox with its device key. iPhone has no web share target; it uses the Shortcut.
 */
import { patchItem } from '../../../features/inbox';
import { api } from '../../../lib/api';
import { sendFile } from './send';

export const SHARE_CACHE = 'mantel-share';

/** The service worker, registered for the share sheet even when notifications are off. */
export function registerShareWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
}

/** Send whatever was shared to the inbox; resolves to how many things were sent. */
export async function takeShared(): Promise<number> {
  const params = new URLSearchParams(location.search);
  if (params.get('shared') !== '1' || typeof caches === 'undefined') return 0;
  // Drop the flag at once so a reload does not send it twice.
  history.replaceState(null, '', `/app${location.hash || '#inbox'}`);
  const cache = await caches.open(SHARE_CACHE);
  const keys = await cache.keys();
  let n = 0;
  for (const req of keys) {
    const res = await cache.match(req);
    await cache.delete(req);
    if (!res) continue;
    const path = new URL(req.url).pathname;
    if (path.endsWith('/text')) {
      const { title, text, url } = (await res.json()) as {
        title?: string;
        text?: string;
        url?: string;
      };
      const words = [text, url].filter(Boolean).join('\n').trim();
      if (!words) continue;
      const { item } = await api.call('inboxCreate', {
        body: { text: words, source: 'share', ...(title ? { subject: title.slice(0, 300) } : {}) },
      });
      patchItem(item);
      n++;
    } else {
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('x-file-name') ?? 'shared');
      await sendFile(new File([blob], name, { type: blob.type }), 'share');
      n++;
    }
  }
  return n;
}
