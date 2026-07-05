// POST /.netlify/functions/share-create
//
// Called by the app the moment a user shares a flight. Persists a sanitized
// snapshot of the flight to Netlify Blobs so /share/<id> keeps working —
// with a full rich preview — even after the flight ends or the live REST
// feed lags. The share page also refreshes this snapshot on every live hit,
// so this endpoint is an accelerator, not a hard dependency: if the call
// fails, the share link still works exactly as before.
//
// CORS is wide open on purpose: the iOS/Android Capacitor builds run from
// capacitor://localhost and everything in the payload is public feed data.

const { getShareStore, buildSnapshot, isValidFlightId } = require('./lib/shareStore');

const MAX_BODY_BYTES = 24 * 1024;

const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400'
};

function json(statusCode, body) {
    return {
        statusCode,
        headers: {
            ...CORS_HEADERS,
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
        },
        body: JSON.stringify(body)
    };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return json(405, { ok: false, error: 'method_not_allowed' });
    }

    const rawBody = event.body || '';
    if (rawBody.length > MAX_BODY_BYTES) {
        return json(413, { ok: false, error: 'payload_too_large' });
    }

    let payload;
    try {
        payload = JSON.parse(event.isBase64Encoded ? Buffer.from(rawBody, 'base64').toString('utf8') : rawBody);
    } catch (_) {
        return json(400, { ok: false, error: 'invalid_json' });
    }

    const flightId = payload && payload.flightId;
    if (!isValidFlightId(flightId)) {
        return json(400, { ok: false, error: 'invalid_flight_id' });
    }

    const snapshot = buildSnapshot({
        flightId,
        serverName: payload.serverName,
        flight: payload.flight,
        communityImageUrl: payload.communityImageUrl
    });
    if (!snapshot) {
        return json(400, { ok: false, error: 'invalid_snapshot' });
    }

    const store = getShareStore(event);
    if (!store) {
        // Blobs unavailable — the link still works via live lookup, so report
        // success=false but don't fail the client's share flow.
        return json(200, { ok: false, error: 'storage_unavailable' });
    }

    try {
        await store.setJSON(flightId, snapshot);
    } catch (err) {
        console.warn('share-create: write failed —', err && err.message);
        return json(200, { ok: false, error: 'storage_write_failed' });
    }

    return json(200, { ok: true, flightId });
};
