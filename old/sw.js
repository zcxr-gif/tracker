/**
 * InFlight service worker.
 *
 * Two caches, two strategies:
 *
 *  • Mapbox tiles / glyphs / sprites — cache-first. They are immutable and
 *    expensive, so a hit avoids the network entirely. The cache is bounded
 *    and trimmed in FIFO order; previously it grew without limit until the
 *    browser evicted the whole origin's storage.
 *
 *  • Same-origin images and fonts — stale-while-revalidate. Repeat visits
 *    paint from cache immediately while a fresh copy is fetched in the
 *    background, so a replaced asset is picked up on the following load.
 *
 * Scripts and stylesheets are deliberately left to the browser's HTTP cache.
 * Serving those one version behind could pair a fresh index.html with stale
 * application code, and the skew is not worth the saving.
 *
 * Deliberately NOT cached: the Mapbox telemetry/events endpoints and anything
 * that isn't a GET. `cache.put()` rejects on a non-GET request, so the old
 * blanket handler produced an unhandled rejection on every telemetry POST.
 */

const TILE_CACHE = 'mapbox-tiles-cache-v2';
const ASSET_CACHE = 'inflight-assets-v1';
const CURRENT_CACHES = [TILE_CACHE, ASSET_CACHE];

const MAPBOX_HOSTS = ['api.mapbox.com', 'tiles.mapbox.com'];

// Tiles are small but numerous. Bounded so the cache can't grow until the
// browser evicts the origin's storage wholesale.
const TILE_CACHE_MAX_ENTRIES = 1200;
const TILE_CACHE_TRIM_TO = 1000;

// Same-origin media worth keeping — this app ships several hundred KB of
// screenshots, liveries and banners that never change between deploys.
// Large JSON databases (airports.json, runways.json) are excluded on purpose:
// they would dominate the quota on their own and the HTTP cache handles them.
const ASSET_EXTENSIONS = /\.(?:woff2?|ttf|otf|png|jpe?g|webp|gif|svg|ico)$/i;

self.addEventListener('install', () => {
    // 1. Immediate activation
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // Drop caches from previous versions so an old tile schema or asset
        // set doesn't linger and consume quota forever.
        const names = await caches.keys();
        await Promise.all(
            names
                .filter(name => !CURRENT_CACHES.includes(name) &&
                    (name.startsWith('mapbox-tiles-cache') || name.startsWith('inflight-assets')))
                .map(name => caches.delete(name))
        );
        // 2. Take control of the page immediately without a reload
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // cache.put() throws on anything but GET, and there is nothing to gain
    // from caching a mutation anyway.
    if (request.method !== 'GET') return;

    let url;
    try {
        url = new URL(request.url);
    } catch (_) {
        return;
    }

    if (MAPBOX_HOSTS.includes(url.host)) {
        // Telemetry must always hit the network — caching it serves stale
        // sessions back and distorts usage reporting.
        if (url.pathname.startsWith('/events/')) return;
        event.respondWith(handleMapboxRequest(request));
        return;
    }

    if (url.origin === self.location.origin && ASSET_EXTENSIONS.test(url.pathname)) {
        event.respondWith(handleAssetRequest(request));
    }
});

/**
 * Cache-first for map tiles, with a bounded cache.
 */
async function handleMapboxRequest(request) {
    const cache = await caches.open(TILE_CACHE);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
        return cachedResponse;
    }

    try {
        const networkResponse = await fetch(request);

        // Only cache valid, successful responses.
        if (networkResponse.ok) {
            // Don't make the caller wait on the write or the trim.
            cache.put(request, networkResponse.clone())
                .then(() => trimCache(cache, TILE_CACHE_MAX_ENTRIES, TILE_CACHE_TRIM_TO))
                .catch(() => { /* quota or storage error — serving still worked */ });
        }

        return networkResponse;
    } catch (error) {
        // Fallback for network failure if not in cache
        return new Response('Network error', { status: 408 });
    }
}

/**
 * Stale-while-revalidate for same-origin static assets: serve the cached copy
 * at once (if any) and refresh it in the background for the next load.
 */
async function handleAssetRequest(request) {
    const cache = await caches.open(ASSET_CACHE);
    const cachedResponse = await cache.match(request);

    const networkFetch = fetch(request)
        .then(networkResponse => {
            if (networkResponse.ok) {
                cache.put(request, networkResponse.clone()).catch(() => {});
            }
            return networkResponse;
        })
        .catch(() => null);

    if (cachedResponse) return cachedResponse;

    const networkResponse = await networkFetch;
    return networkResponse || new Response('Network error', { status: 408 });
}

/**
 * Keeps a cache bounded. `cache.keys()` returns entries in insertion order, so
 * dropping from the front evicts the oldest first.
 */
async function trimCache(cache, maxEntries, trimTo) {
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;

    const excess = keys.length - trimTo;
    for (let i = 0; i < excess; i++) {
        await cache.delete(keys[i]);
    }
}
