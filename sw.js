const VERSION = '0.2.0';
const CACHE = `piano-trainer-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './js/detect.js',
  './js/storage.js',
  './js/songs.js',
  './js/settings.js',
  './sw.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/fft.js',
  './vendor/pitchy.js',
  './vendor/tonejs-midi.js',
  './vendor/opensheetmusicdisplay.min.js',
  './vendor/vexflow.js',
  './vendor/tone.js',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the HTTP cache so a new VERSION never stores stale files.
  const reqs = ASSETS.map((u) => new Request(u, { cache: 'reload' }));
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(reqs)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache first, network fallback. ignoreSearch so '?v=' style URLs still hit.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
