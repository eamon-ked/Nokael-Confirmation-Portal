// Push-only service worker for the business client portal (coc.nokael.com/portal/).
// It does no caching and has no fetch handler, so it never changes how pages
// load. It shows notifications sent by the push-dispatch Edge Function and
// opens (or focuses) the portal when one is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Nokael', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      icon: '/portal/icons/icon-192.png',
      badge: '/portal/icons/icon-192.png',
      data: { url: data.url || '/portal/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/portal/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(target));
      if (open) return open.focus();
      return self.clients.openWindow(target);
    })()
  );
});
