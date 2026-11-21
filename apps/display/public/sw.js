/* global self, caches */
/*
 * Mantel's service worker: shows Web Push notifications and opens the companion when one is
 * tapped. It caches nothing; the companion is always live from the server (a stale list is
 * worse than a short wait). Registered by the companion app when notifications are turned on.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Mantel', body: '', url: '/app', tag: undefined, kind: 'note' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    data.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag || data.kind,
      renotify: !!data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/maskable-192.png',
      data: { url: data.url || '/app' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(
    (event.notification.data && event.notification.data.url) || '/app',
    self.location.origin,
  ).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => 'focus' in c);
      if (open) {
        open.navigate(url);
        return open.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});

/*
 * Share to Mantel (v4 K). On Android and desktop Chrome the installed phone app is a share
 * target: another app's Share posts a form to /app/share. Keep what was shared in a cache and
 * open the phone app, which sends it to the inbox with its device key (this worker has none).
 * Every other request goes to the network untouched.
 */
const SHARE_CACHE = 'mantel-share';
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/app/share') return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const cache = await caches.open(SHARE_CACHE);
        const stamp = Date.now();
        let i = 0;
        for (const file of form.getAll('file')) {
          if (typeof file === 'string' || !file.size) continue;
          await cache.put(
            `/app/share/${stamp}-${i++}/file`,
            new Response(file, {
              headers: {
                'content-type': file.type || 'application/octet-stream',
                'x-file-name': encodeURIComponent(file.name || 'shared'),
              },
            }),
          );
        }
        const text = {
          title: form.get('title') || '',
          text: form.get('text') || '',
          url: form.get('url') || '',
        };
        if (text.text || text.url)
          await cache.put(
            `/app/share/${stamp}-text/text`,
            new Response(JSON.stringify(text), { headers: { 'content-type': 'application/json' } }),
          );
      } catch {
        /* nothing usable was shared; the app opens anyway */
      }
      return Response.redirect('/app?shared=1#inbox', 303);
    })(),
  );
});
