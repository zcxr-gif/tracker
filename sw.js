/**
 * InFlight service worker.
 *
 * Same-origin images and fonts — stale-while-revalidate. Repeat visits paint
 * from cache immediately while a fresh copy is fetched in the background, so
 * a replaced asset is picked up on the following load.
 *
 * Map tiles are left alone. This worker used to cache every api.mapbox.com
 * request cache-first, keyed on the full URL — but Mapbox puts a per-session
 * `sku` token (and the access token) on every tile URL, so a later visit
 * almost never matched, while every tile still paid for a cache lookup, a
 * write and a scan of up to 1,200 entries to trim. Mapbox GL keeps its own
 * tile cache ('mapbox-tiles'), keyed without those tokens, and the free map's
 * tiles are served with ordinary HTTP caching. Its old cache is deleted on
 * activation.
 *
 * Scripts and stylesheets are deliberately left to the browser's HTTP cache.
 * Serving those one version behind could pair a fresh index.html with stale
 * application code, and the skew is not worth the saving.
 */

const ASSET_CACHE = 'inflight-assets-v1';
const CURRENT_CACHES = [ASSET_CACHE];

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

    if (url.origin === self.location.origin && ASSET_EXTENSIONS.test(url.pathname)) {
        event.respondWith(handleAssetRequest(request));
    }
});

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
