const CACHE = 'koran-sync-v1';

const STATIC = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Amiri:wght@400;700&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap'
];

// Installation — statische Dateien cachen
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

// Aktivierung — alte Caches löschen
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — Cache-first für statische Dateien, Network-first für API
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API-Anfragen immer aus dem Netz (kein Cache)
  if (
    url.hostname.includes('quran.com') ||
    url.hostname.includes('alquran.cloud') ||
    url.hostname.includes('qurancdn.com') ||
    url.hostname.includes('quranenc.com')
  ) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Alles andere: Cache-first mit Netz-Fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        // Erfolgreiche Antworten cachen
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached || new Response('', { status: 503 }));
    })
  );
});
