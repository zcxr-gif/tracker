// Share snapshot store.
//
// The app POSTs a compact flight snapshot here when the user taps "Share".
// We persist it in Netlify Blobs keyed by the flight's own flightId, so the
// share link can stay short — just /share/<flightId> — while the Open Graph
// function (share.js) still has a full snapshot to render a correct, instant
// unfurl card, even after the flight has landed.
//
// Keying by flightId (rather than a random id) is deliberate: the flightId is
// already in the share URL, so if this write ever races or fails, share.js
// falls back to a live lookup and the app still opens the flight (live or
// replay) from the flightId in the path. Nothing dead-ends.
//
// The client fires this fire-and-forget (keepalive) so it never blocks the
// native share sheet's user gesture.

const STORE_NAME = 'flight-shares';
const MAX_BODY_BYTES = 8 * 1024; // snapshots are tiny; reject anything abusive

// Only persist the fields the OG card / in-app open actually use. This both
// caps the stored size and stops a client from stuffing arbitrary data in.
const ALLOWED_KEYS = ['v', 'id', 'sv', 'ts', 'cs', 'dp', 'ar', 'un', 'ac', 'lv', 'rg', 'img', 'al', 'gs', 'lat', 'lon'];

function sanitize(snap) {
    const out = {};
    for (const k of ALLOWED_KEYS) {
        if (snap[k] !== undefined && snap[k] !== null) out[k] = snap[k];
    }
    return out;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: { 'cache-control': 'no-store' }, body: 'Method Not Allowed' };
    }

    const raw = event.body || '';
    if (raw.length > MAX_BODY_BYTES) {
        return { statusCode: 413, headers: { 'cache-control': 'no-store' }, body: 'Payload too large' };
    }

    let snap;
    try {
        snap = JSON.parse(raw);
    } catch (_) {
        return { statusCode: 400, headers: { 'cache-control': 'no-store' }, body: 'Bad JSON' };
    }

    const flightId = snap && typeof snap.id === 'string' ? snap.id.trim() : '';
    if (!flightId) {
        return { statusCode: 400, headers: { 'cache-control': 'no-store' }, body: 'Missing flight id' };
    }

    try {
        const { getStore } = require('@netlify/blobs');
        const store = getStore(STORE_NAME);
        const record = sanitize(snap);
        record.createdAt = Date.now();
        await store.setJSON(flightId, record);
    } catch (err) {
        // Non-fatal for the user: the link still works via live lookup + the
        // flightId in the path. Surface a 200 so the fire-and-forget client
        // doesn't log noise, but note the miss server-side.
        console.warn('share-create: blob write failed', err && err.message);
        return {
            statusCode: 200,
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
            body: JSON.stringify({ ok: false, stored: false })
        };
    }

    return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        body: JSON.stringify({ ok: true, stored: true, id: flightId })
    };
};
