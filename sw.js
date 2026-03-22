// ── Iqraa Koran Service Worker ────────────────────────────────────
const VERSION      = 'iqraa-v2';
const SHELL_CACHE  = VERSION + '-shell';
const API_CACHE    = VERSION + '-api';
const AUDIO_CACHE  = VERSION + '-audio';

// App-Shell: alles was zum Starten nötig ist
const SHELL_URLS = [
    './',
    './index.html',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Amiri+Quran&family=Amiri:wght@400;700&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap',
];

// ── Install: App-Shell vorabladen ─────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE).then(cache =>
            Promise.allSettled(
                SHELL_URLS.map(url =>
                    cache.add(url).catch(e => console.warn('Shell cache miss:', url, e))
                )
            )
        ).then(() => self.skipWaiting())
    );
});

// ── Activate: alte Caches löschen ────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k.startsWith('iqraa-') && k !== SHELL_CACHE && k !== API_CACHE && k !== AUDIO_CACHE)
                    .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch: Strategie je nach Anfrage-Typ ─────────────────────────
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // 1. Audio-Dateien → Cache first, dann Network (große Dateien)
    if (url.hostname.includes('audio') || url.pathname.match(/\.(mp3|ogg|m4a)$/i)) {
        event.respondWith(cacheFirst(event.request, AUDIO_CACHE));
        return;
    }

    // 2. API-Anfragen (quran.com, jsdelivr) → Network first, Fallback Cache
    if (
        url.hostname.includes('quran.com') ||
        url.hostname.includes('jsdelivr.net') ||
        url.hostname.includes('alquran.cloud')
    ) {
        event.respondWith(networkFirst(event.request, API_CACHE));
        return;
    }

    // 3. Google Fonts → Cache first
    if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
        event.respondWith(cacheFirst(event.request, SHELL_CACHE));
        return;
    }

    // 4. App-Shell → Cache first
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
});

// ── Cache-First: Cache → Network → Cache speichern ───────────────
async function cacheFirst(request, cacheName) {
    const cache    = await caches.open(cacheName);
    const cached   = await cache.match(request);
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (e) {
        return new Response('Offline – kein Cache verfügbar.', { status: 503 });
    }
}

// ── Network-First: Network → Cache speichern → Fallback Cache ────
async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
    } catch (e) {
        const cached = await cache.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'Offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// ── Nachricht vom App: bestimmte Sure vorabladen ──────────────────
self.addEventListener('message', async event => {
    if (event.data?.type === 'PRECACHE_SURAH') {
        const { surahId, reciterId, audioUrl } = event.data;
        const apiCache   = await caches.open(API_CACHE);
        const audioCache = await caches.open(AUDIO_CACHE);

        // API-Anfragen cachen
        const apiUrls = [
            `https://api.quran.com/api/v4/chapter_recitations/${reciterId}/${surahId}?segments=true`,
            `https://api.quran.com/api/v4/verses/by_chapter/${surahId}?words=true&word_fields=text_uthmani,audio_url&per_page=50&page=1`,
            `https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/deu-asfbubenheimand/${surahId}.json`,
        ];
        await Promise.allSettled(apiUrls.map(u =>
            fetch(u).then(r => r.ok && apiCache.put(u, r)).catch(() => {})
        ));

        // Audio cachen
        if (audioUrl) {
            fetch(audioUrl)
                .then(r => r.ok && audioCache.put(audioUrl, r))
                .catch(() => {});
        }

        event.source?.postMessage({ type: 'PRECACHE_DONE', surahId });
    }

    if (event.data?.type === 'CLEAR_CACHE') {
        await Promise.all([SHELL_CACHE, API_CACHE, AUDIO_CACHE].map(c => caches.delete(c)));
        event.source?.postMessage({ type: 'CACHE_CLEARED' });
    }
});
