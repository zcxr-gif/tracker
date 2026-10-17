/**
 * atcSummary.js
 *
 * A pilot's record as an Infinite Flight controller — their RateMyATC stars
 * and kudos — for the pilot cards in the flight windows. A pilot who also
 * controls wears it on their card: "★ 4.7 ATC".
 *
 * Looked up by Infinite Flight user id when the window has one (the same id
 * kudos and ratings are filed against), else by name. Public, anon-callable
 * functions only (Inflight-IOS: supabase/migrations/2026101*_atc_*.sql), so it
 * works signed out and inside the same-origin flight window iframes.
 */

const SUPABASE_URL = 'https://lcgaoiqwwpyqndaucyzu.supabase.co';
// The public anon key (the same one flight.js and pilotProfiles.js ship).
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxjZ2FvaXF3d3B5cW5kYXVjeXp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNjkyOTksImV4cCI6MjA4NzY0NTI5OX0.9TO21knXR_P9E80pea7gUOu-gTjb17sCGk7BYgRRe3U';

// A rating moves slowly and a flight window re-renders every tick.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // 'id:<id>' | 'name:<lower name>' -> { at, value, promise? }

function rpc(name, body) {
    return fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body || {}),
    }).then(r => (r.ok ? r.json() : null));
}

function shape(ratingAvg, ratingCount, kudos, username) {
    const count = Number(ratingCount) || 0;
    const k = Number(kudos) || 0;
    if (!count && !k) return null;
    return { ratingAvg: count ? Number(ratingAvg) : null, ratingCount: count, kudos: k, username: username || null };
}

async function fetchById(id) {
    const [r, k] = await Promise.all([
        rpc('atc_rating_counts', { p_controller_if_ids: [id] }),
        rpc('atc_commendation_counts', { p_controller_if_ids: [id] }),
    ]);
    const rr = Array.isArray(r) ? r[0] : null;
    const kk = Array.isArray(k) ? k[0] : null;
    return shape(rr?.rating_avg, rr?.rating_count, kk?.total, null);
}

async function fetchByName(name) {
    const hits = await rpc('atc_controller_search', { p_query: name, p_limit: 3 });
    const hit = Array.isArray(hits) && hits.find(h => String(h.username || '').toLowerCase() === name);
    return hit ? shape(hit.rating_avg, hit.rating_count, hit.kudos, hit.username) : null;
}

/** Synchronous cache read: a summary, null (not a controller), or undefined (unknown yet). */
export function peekAtcSummary({ userId, username } = {}) {
    const key = keyFor(userId, username);
    const hit = key && cache.get(key);
    if (!hit || hit.promise || Date.now() - hit.at > TTL_MS) return undefined;
    return hit.value;
}

/** Resolves to { ratingAvg, ratingCount, kudos } or null. Never rejects. */
export function atcSummary({ userId, username } = {}) {
    const key = keyFor(userId, username);
    if (!key) return Promise.resolve(null);
    const hit = cache.get(key);
    if (hit && hit.promise) return hit.promise;
    if (hit && Date.now() - hit.at <= TTL_MS) return Promise.resolve(hit.value);

    const promise = (key.startsWith('id:') ? fetchById(key.slice(3)) : fetchByName(key.slice(5)))
        .catch(() => null)
        .then(value => { cache.set(key, { at: Date.now(), value }); return value; });
    cache.set(key, { at: 0, value: null, promise });
    return promise;
}

function keyFor(userId, username) {
    const id = String(userId || '').trim();
    if (/^[A-Za-z0-9-]{8,64}$/.test(id)) return 'id:' + id;
    const name = String(username || '').trim().toLowerCase();
    if (name.length >= 2 && !/^(n\/a|unknown|pilot|---)$/.test(name)) return 'name:' + name;
    return null;
}

/** The chip's words: stars when rated, else kudos. */
export function atcChipText(s) {
    if (!s) return '';
    return s.ratingCount ? `★ ${s.ratingAvg.toFixed(1)} ATC` : `👍 ${s.kudos} ATC`;
}

/** The chip's tooltip. */
export function atcChipTitle(s) {
    if (!s) return '';
    const parts = [];
    if (s.ratingCount) parts.push(`Rated ${s.ratingAvg.toFixed(1)}★ by ${s.ratingCount} pilot${s.ratingCount === 1 ? '' : 's'} as a controller`);
    if (s.kudos) parts.push(`${s.kudos} kudos`);
    return `RateMyATC: ${parts.join(' · ')}`;
}
