// Cobalt service worker: PUSH NOTIFICATIONS ONLY (no asset caching).
//
// Caching was intentionally removed: the old shell cache kept serving stale app code
// during active development (a hard reload doesn't clear a service worker), which
// caused "my fix didn't show up" over and over. This SW now does exactly one job —
// relay closed-app push notifications — and NEVER intercepts fetches, so the browser
// always loads the freshest files straight from the network/host.
//
// On activate it PURGES every cache a previous (caching) version left behind, so an
// existing stale install heals itself the moment this version takes over.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k)))) // wipe ALL old caches
      .then(() => self.clients.claim())
  );
});

// --- Push (closed-app reminders from the Cloud Function via FCM) ---------------
// The function sends a DATA message ({ data: { title, body } }); we show it here so
// we control the icon + click target.
self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON push — ignore */
  }
  const data = d.data || d.notification || d;
  const title = data.title || 'Cobalt';
  const body = data.body || '';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/#tasks' },
    })
  );
});

// Clicking the notification focuses an open Cobalt window (Tasks tab), or opens one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/#tasks';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// NOTE: deliberately NO 'fetch' handler. Without one the browser bypasses the service
// worker for every request → you always get fresh files, never a cached stale copy.
