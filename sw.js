const CACHE_NAME = 'mapbox-tiles-cache-v1';
const MAPBOX_URLS = [
    'api.mapbox.com',
    'tiles.mapbox.com'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Only cache Mapbox tile/style requests
    const isMapboxRequest = MAPBOX_URLS.some(domain => url.includes(domain));

    if (isMapboxRequest) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((response) => {
                    // Return cached tile or fetch and then cache
                    return response || fetch(event.request).then((networkResponse) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                });
            })
        );
    }
});