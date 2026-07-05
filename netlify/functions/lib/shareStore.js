// Durable storage for flight share snapshots (Netlify Blobs).
//
// Why: share links used to resolve *only* against the live ACARS feed, so a
// link died the moment the flight ended (or the REST feed lagged). Now a
// snapshot of the flight is persisted the moment it is shared — and refreshed
// every time the share page resolves it live — so /share/<id> can always
// render a rich preview and a proper "flight completed" page, forever.
//
// Every helper here fails soft: if Blobs is unavailable for any reason the
// share flow degrades to the old live-lookup behaviour instead of erroring.

const { connectLambda, getStore } = require('@netlify/blobs');

const STORE_NAME = 'flight-shares';

// Infinite Flight flight IDs are UUID-ish; be permissive but bounded.
const FLIGHT_ID_RE = /^[A-Za-z0-9_-]{6,80}$/;

function isValidFlightId(id) {
    return typeof id === 'string' && FLIGHT_ID_RE.test(id);
}

// Returns a Blobs store bound to this invocation, or null if Blobs isn't
// available (e.g. local dev without the CLI, or the feature being disabled).
function getShareStore(event) {
    try {
        connectLambda(event);
        return getStore(STORE_NAME);
    } catch (err) {
        console.warn('shareStore: blobs unavailable —', err && err.message);
        return null;
    }
}

async function readSnapshot(store, flightId) {
    if (!store || !isValidFlightId(flightId)) return null;
    try {
        const snap = await store.get(flightId, { type: 'json' });
        return (snap && typeof snap === 'object' && snap.flightId === flightId) ? snap : null;
    } catch (err) {
        console.warn('shareStore: read failed —', err && err.message);
        return null;
    }
}

async function writeSnapshot(store, snapshot) {
    if (!store || !snapshot || !isValidFlightId(snapshot.flightId)) return false;
    try {
        await store.setJSON(snapshot.flightId, snapshot);
        return true;
    } catch (err) {
        console.warn('shareStore: write failed —', err && err.message);
        return false;
    }
}

// --- Sanitizers -------------------------------------------------------------
// Snapshots derive from live-feed data, but every field is still
// type-checked and clipped. All of this is public live-feed data — the risk
// is malformed/oversized junk, not secrets.

function cleanStr(value, max) {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (!v) return null;
    return v.length > max ? v.slice(0, max) : v;
}

function cleanNum(value) {
    return (typeof value === 'number' && Number.isFinite(value)) ? value : null;
}

function cleanUrl(value) {
    const v = cleanStr(value, 500);
    if (!v || !/^https?:\/\//i.test(v)) return null;
    return v;
}

function sanitizePosition(pos) {
    if (!pos || typeof pos !== 'object') return null;
    const lat = cleanNum(pos.lat ?? pos.latitude);
    const lon = cleanNum(pos.lon ?? pos.longitude);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return {
        lat,
        lon,
        alt_ft: cleanNum(pos.alt_ft ?? pos.altitude) ?? 0,
        gs_kt: cleanNum(pos.gs_kt ?? pos.groundSpeed) ?? 0,
        vs_fpm: cleanNum(pos.vs_fpm) ?? 0,
        heading_deg: cleanNum(pos.heading_deg ?? pos.heading) ?? 0
    };
}

// Normalizes either a raw ACARS flight object or a client-built payload into
// the one flight shape the share page and the app handoff both consume.
function sanitizeFlight(raw, flightId) {
    if (!raw || typeof raw !== 'object') return null;
    const ac = (raw.aircraft && typeof raw.aircraft === 'object') ? raw.aircraft : {};
    const aircraftName = cleanStr(ac.aircraftName, 120) || cleanStr(raw.aircraftName, 120);
    const liveryName = cleanStr(ac.liveryName, 120) || cleanStr(raw.liveryName, 120);
    const registration = cleanStr(ac.registration, 40) || cleanStr(raw.registration, 40);
    return {
        flightId,
        callsign: cleanStr(raw.callsign, 60),
        username: cleanStr(raw.username, 80),
        virtualOrgName: cleanStr(raw.virtualOrgName, 120),
        departureIcao: cleanStr(raw.departureIcao || raw.origin, 8),
        arrivalIcao: cleanStr(raw.arrivalIcao || raw.destination, 8),
        aircraftName,
        liveryName,
        registration,
        userId: cleanStr(raw.userId, 80),
        isStaff: !!raw.isStaff,
        isVAMember: !!raw.isVAMember,
        pilotState: cleanNum(raw.pilotState),
        position: sanitizePosition(raw.position),
        aircraft: { aircraftName, liveryName, registration }
    };
}

// Builds a complete, storage-ready snapshot. Returns null if the input is
// unusable (bad flightId or no flight body).
function buildSnapshot({ flightId, serverName, flight, communityImageUrl, lastSeenLiveAt }) {
    if (!isValidFlightId(flightId)) return null;
    const cleanFlight = sanitizeFlight(flight, flightId);
    if (!cleanFlight) return null;
    return {
        v: 1,
        flightId,
        serverName: cleanStr(serverName, 60) || '',
        capturedAt: Date.now(),
        lastSeenLiveAt: cleanNum(lastSeenLiveAt) || Date.now(),
        communityImageUrl: cleanUrl(communityImageUrl),
        flight: cleanFlight
    };
}

module.exports = {
    STORE_NAME,
    isValidFlightId,
    getShareStore,
    readSnapshot,
    writeSnapshot,
    buildSnapshot
};
