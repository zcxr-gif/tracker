// sw.js
const CACHE_NAME = 'mapbox-tiles-cache-v1';
const PRE_CACHE_RESOURCES = [
    '/',
    '/index.html',
    '/flight.js',
    '/airports.json',
    '/runways.json'
];

const MAPBOX_DOMAINS = [
    'api.mapbox.com',
    'tiles.mapbox.com'
];

self.addEventListener('install', (event) => {
    // Force the SW to take over immediately
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRE_CACHE_RESOURCES);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = event.request.url;
    const isMapboxRequest = MAPBOX_DOMAINS.some(domain => url.includes(domain));

    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((response) => {
                // Return cached version, but also fetch and update cache in background
                const fetchPromise = fetch(event.request).then((networkResponse) => {
                    if (networkResponse.ok) {
                        cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                });
                return response || fetchPromise;
            });
        })
    );
});