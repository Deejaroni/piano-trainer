const VERSION = '0.0.2';
const CACHE = `piano-trainer-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './app.js',
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
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
