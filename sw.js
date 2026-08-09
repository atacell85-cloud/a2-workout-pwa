const CACHE_VERSION = 'a2-workout-v3-2026-08-09';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './storage.js',
  './data/programs.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && new URL(event.request.url).origin === location.origin) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
