/**
 * Service worker.
 *
 * The static map — the shell, the basemap tiles, the campus geometry, the
 * fonts — is cached so the map opens without a network. Live rows are
 * deliberately never cached: a stale footprint is worse than no footprint, and
 * a cached location is a location stored, which this app does not do.
 *
 * Tiles are cached on first sight rather than precached: the whole set is under
 * a megabyte, but there is no reason to spend a new visitor's data on zoom
 * levels they may never reach.
 */
const VERSION = 'grounds-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Anything that carries live data goes to the network and is never stored.
  if (url.pathname.startsWith('/rest/v1') || url.pathname.startsWith('/realtime') || url.pathname.startsWith('/auth/v1')) {
    return;
  }

  // Navigations: network first, so a deployed change is picked up, with the
  // cached shell as the offline answer.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(VERSION).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Build assets and fonts are content-hashed or stable: cache first.
  if (url.origin === self.location.origin || url.host.endsWith('gstatic.com') || url.host.endsWith('googleapis.com')) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((response) => {
          if (response.ok && response.type !== 'opaque') {
            const copy = response.clone();
            void caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});
