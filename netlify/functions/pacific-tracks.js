// File: netlify/functions/pacific-tracks.js
//
// The Pacific Organized Track System (PACOTS) for the oceanic tracks layer.
// Infinite Flight's live API only carries the North Atlantic tracks (which
// the ACARS backend relays at /api/live/tracks), so the Pacific set comes from
// the real-world source: the Track Definition Messages Oakland Oceanic (KZAK)
// and Fukuoka (RJJJ) publish through the NOTAM system, read here from the
// FAA's public NOTAM Search. Browsers can't call it directly (no CORS), hence
// the proxy — same shape as sigmets.js.
//
// The FAA's firewall refuses Netlify's servers outright (HTTP 403 whatever the
// request looks like), and its API keys are only issued to a few kinds of
// organisation. So the tracks are read first from Flight Plan Database's
// public API (api.flightplandatabase.com/nav/PACOTS: no key needed for light
// use), which republishes the same TDMs already decoded to lat/lon. Its
// anonymous rate limit is per IP and low, so the answer is also cached in
// Netlify's shared CDN cache, keeping upstream calls to a few an hour for
// the whole site. When it has nothing, the FAA's older DINS query page
// (www.notams.faa.gov — a different server from NOTAM Search, and the PACOTS
// source Little Navmap's track download was built on) is read next, then
// the other FAA sources.
//
// Optional: PACOTS_SOURCE_URL — any URL returning plain text containing TDMs.
// When set it is read first, so the feed can be switched without a deploy.
//
// Optional: FAA_CLIENT_ID / FAA_CLIENT_SECRET — keys for the FAA's official
// NOTAM API (free, from api.faa.gov). When set, each centre is read from it
// first; NOTAM Search is the fallback. NOTAM Search sits behind a firewall
// that answers 403 to anything that doesn't look like its own web page, so
// those requests carry a browser's headers and the session cookie the search
// page hands out — and if the firewall starts refusing the host's IP range
// anyway, the API keys are the way round it.
//
// Answers { ok, tracks: [{ name, validFrom, validTo, route, points }], sources }
// where points are [lon, lat]. An empty list is a normal answer (the source
// had nothing, or was unreachable); the map simply draws no Pacific tracks.

const fetch = require('node-fetch');
const { parseTdms, currentTracks } = require('./lib/tdm');

const FAA_ORIGIN = 'https://notams.aim.faa.gov';
const FAA_PAGE_URL = `${FAA_ORIGIN}/notamSearch/nsapp.html`;
const FAA_SEARCH = `${FAA_ORIGIN}/notamSearch/search`;
const FAA_API = 'https://external-api.faa.gov/notamapi/v1/notams';
const FPD_PACOTS = 'https://api.flightplandatabase.com/nav/PACOTS';
const DINS_URL = 'https://www.notams.faa.gov/dinsQueryWeb/queryRetrievalMapAction.do'
    + '?retrieveLocId=KZAK%20RJJJ%20PAZA&actionType=notamRetrievalByICAOs&submit=NOTAMs';
const CENTRES = ['KZAK', 'RJJJ'];
const PAGE = 30;
const MAX_PAGES = 12;
const CACHE_MS = 15 * 60 * 1000;
const UA = 'inflight-tracker/1.0 (+netlify-function; pacific tracks)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

let cache = null; // { at, body }

const isTdm = (t) => /TDM\s+TRK/.test(t || '');

/** The cookies NOTAM Search sets on its page, as a Cookie header. */
async function faaSession() {
    const res = await fetch(FAA_PAGE_URL, {
        headers: {
            'User-Agent': BROWSER_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 12000,
    });
    const set = (res.headers.raw && res.headers.raw()['set-cookie']) || [];
    return set.map(c => c.split(';')[0]).join('; ');
}

async function faaMessages(centre, cookie) {
    const texts = [];
    for (let page = 0; page < MAX_PAGES; page++) {
        const body = new URLSearchParams({
            searchType: '0',
            designatorsForLocation: centre,
            offset: String(page * PAGE),
            notamsOnly: 'false',
            sortColumns: '5 false',
            sortDirection: 'true',
        });
        const res = await fetch(FAA_SEARCH, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': BROWSER_UA,
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'en-US,en;q=0.9',
                'Origin': FAA_ORIGIN,
                'Referer': FAA_PAGE_URL,
                'X-Requested-With': 'XMLHttpRequest',
                ...(cookie ? { 'Cookie': cookie } : {}),
            },
            body,
            timeout: 12000,
        });
        if (!res.ok) throw new Error(`FAA NOTAM search ${centre} -> HTTP ${res.status}`);
        const data = await res.json();
        const list = Array.isArray(data && data.notamList) ? data.notamList : [];
        for (const n of list) {
            const t = n.icaoMessage || n.traditionalMessage || n.traditionalMessageFrom4thWord || '';
            if (isTdm(t)) texts.push(t);
        }
        const total = Number(data && data.totalNotamCount) || 0;
        if (!list.length || (page + 1) * PAGE >= total) break;
    }
    return texts;
}

async function faaApiMessages(centre, id, secret) {
    const texts = [];
    for (let page = 1; page <= 10; page++) {
        const url = `${FAA_API}?icaoLocation=${centre}&pageSize=1000&pageNum=${page}`;
        const res = await fetch(url, {
            headers: { 'client_id': id, 'client_secret': secret, 'Accept': 'application/json', 'User-Agent': UA },
            timeout: 12000,
        });
        if (!res.ok) throw new Error(`FAA NOTAM API ${centre} -> HTTP ${res.status}`);
        const data = await res.json();
        const items = Array.isArray(data && data.items) ? data.items : [];
        for (const item of items) {
            const core = (item && item.properties && item.properties.coreNOTAMData) || {};
            const icao = (core.notamTranslation || []).find(t => t && t.type === 'ICAO');
            const t = (icao && icao.formattedText) || (core.notam && core.notam.text) || '';
            if (isTdm(t)) texts.push(t);
        }
        if (!items.length || page >= (Number(data.totalPages) || 1)) break;
    }
    return texts;
}

const round4 = (n) => Math.round(n * 1e4) / 1e4;
const isoOrEmpty = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : ''; };

/**
 * Flight Plan Database's decoded tracks, in this function's track shape:
 * [{ ident, validFrom, validTo, route: { nodes: [{ ident, lat, lon }] } }].
 * A response in any other shape is reported (with its top-level keys) rather
 * than silently read as "no tracks".
 */
async function fpdTracks() {
    const res = await fetch(FPD_PACOTS, { headers: { 'Accept': 'application/json', 'User-Agent': UA }, timeout: 12000 });
    if (!res.ok) throw new Error(`Flight Plan Database -> HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.tracks) ? data.tracks : null);
    if (!list) throw new Error(`Flight Plan Database: unexpected response (keys: ${Object.keys(data || {}).join(', ') || typeof data})`);
    const tracks = list.map((t) => {
        const nodes = (t && t.route && Array.isArray(t.route.nodes) ? t.route.nodes : (t && t.nodes)) || [];
        const points = nodes
            .map(n => [Number(n && n.lon), Number(n && n.lat)])
            .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
            .map(([lon, lat]) => [round4(lon), round4(lat)]);
        return {
            name: String((t && (t.ident || t.name)) || '').trim(),
            messageId: '',
            validFrom: isoOrEmpty(t && t.validFrom),
            validTo: isoOrEmpty(t && t.validTo),
            route: nodes.map(n => n && n.ident).filter(Boolean).join(' '),
            points,
        };
    }).filter(t => t.name && t.points.length >= 2);
    if (list.length && !tracks.length) {
        throw new Error(`Flight Plan Database: ${list.length} tracks but none readable (keys: ${Object.keys(list[0] || {}).join(', ')})`);
    }
    return tracks;
}

/** Every NOTAM on the DINS report page for KZAK/RJJJ/PAZA, as plain text. */
async function dinsText() {
    const res = await fetch(DINS_URL, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
        timeout: 15000,
    });
    if (!res.ok) throw new Error(`FAA DINS -> HTTP ${res.status}`);
    return (await res.text())
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

async function overrideMessages(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 12000 });
    if (!res.ok) throw new Error(`PACOTS_SOURCE_URL -> HTTP ${res.status}`);
    return [await res.text()];
}

async function collect() {
    const texts = [];
    const sources = [];
    const override = process.env.PACOTS_SOURCE_URL;
    if (override) {
        try { texts.push(...await overrideMessages(override)); sources.push({ source: 'override', ok: true }); }
        catch (err) { sources.push({ source: 'override', ok: false, error: err.message }); }
    }
    let decoded = [];
    try {
        decoded = await fpdTracks();
        sources.push({ source: 'flightplandatabase', ok: true, tracks: decoded.length });
    } catch (err) {
        console.warn('pacific-tracks:', err.message);
        sources.push({ source: 'flightplandatabase', ok: false, error: err.message });
    }
    if (decoded.length) {
        const tracks = currentTracks([...decoded, ...parseTdms(texts.join('\n'))]);
        return { ok: true, tracks, sources, fetchedAt: new Date().toISOString() };
    }
    try {
        const text = await dinsText();
        const found = parseTdms(text).length;
        texts.push(text);
        sources.push({ source: 'faa-dins', ok: true, tracks: found });
        if (found) {
            const tracks = currentTracks(parseTdms(texts.join('\n')));
            return { ok: true, tracks, sources, fetchedAt: new Date().toISOString() };
        }
    } catch (err) {
        console.warn('pacific-tracks:', err.message);
        sources.push({ source: 'faa-dins', ok: false, error: err.message });
    }
    const { FAA_CLIENT_ID: id, FAA_CLIENT_SECRET: secret } = process.env;
    let cookie = null; // one NOTAM Search session, opened only if needed
    await Promise.all(CENTRES.map(async (centre) => {
        if (id && secret) {
            try {
                const found = await faaApiMessages(centre, id, secret);
                texts.push(...found);
                sources.push({ source: `faa-api:${centre}`, ok: true, messages: found.length });
                return;
            } catch (err) {
                console.warn('pacific-tracks:', err.message);
                sources.push({ source: `faa-api:${centre}`, ok: false, error: err.message });
            }
        }
        try {
            if (cookie === null) cookie = faaSession().catch(() => '');
            const found = await faaMessages(centre, await cookie);
            texts.push(...found);
            sources.push({ source: `faa:${centre}`, ok: true, messages: found.length });
        } catch (err) {
            console.warn('pacific-tracks:', err.message);
            sources.push({ source: `faa:${centre}`, ok: false, error: err.message });
        }
    }));
    const tracks = currentTracks(parseTdms(texts.join('\n')));
    return { ok: true, tracks, sources, fetchedAt: new Date().toISOString() };
}

// An answer with no tracks (every source failed, or had nothing) is retried
// after a minute rather than held for the full 15, here and in the CDN and
// browser caches — otherwise one refused request blanks the map for a while.
const EMPTY_CACHE_MS = 60 * 1000;

exports.handler = async () => {
    const ttl = cache && cache.body.tracks.length ? CACHE_MS : EMPTY_CACHE_MS;
    if (!cache || Date.now() - cache.at > ttl) {
        const body = await collect();
        // An empty fetch doesn't replace a good answer from the last 12 hours
        // (the source hiccuped); older than that, the tracks have expired and
        // an empty map is the honest answer.
        const keepOld = !body.tracks.length && cache && cache.body.tracks.length
            && Date.now() - Date.parse(cache.body.fetchedAt) < 12 * 60 * 60 * 1000;
        cache = { at: Date.now(), body: keepOld ? { ...cache.body, sources: body.sources } : body };
    }
    const maxAge = (cache.body.tracks.length ? CACHE_MS : EMPTY_CACHE_MS) / 1000;
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': `public, max-age=${maxAge}`,
            // Shared across every visitor, so the upstream rate limit is
            // spent once per refresh for the whole site, not per person.
            'Netlify-CDN-Cache-Control': `public, s-maxage=${maxAge}, durable`,
        },
        body: JSON.stringify(cache.body),
    };
};
