// sw.js — lets the app install and work offline.
// Network first: every visit tries GitHub Pages for the newest files, so each
// merged change shows up. The cached copy is used only when there's no network.
// All paths are relative, because the site lives at /<repository>/, not at the root.

const CACHE = 'age-capstruct-v1';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'capstruct.js',
  'manifest.webmanifest',
  'data/assumptions.csv',
  'data/banker_schedule.csv',
  'data/cdss.csv',
  'data/ebit_scenarios.csv',
  'data/example_firms.csv',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Only this site's own GET requests. The app makes no requests to other websites.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
