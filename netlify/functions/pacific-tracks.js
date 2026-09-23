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
// Optional: PACOTS_SOURCE_URL — any URL returning plain text containing TDMs.
// When set it is read first, so the feed can be switched without a deploy.
//
// Answers { ok, tracks: [{ name, validFrom, validTo, route, points }], sources }
// where points are [lon, lat]. An empty list is a normal answer (the source
// had nothing, or was unreachable); the map simply draws no Pacific tracks.

const fetch = require('node-fetch');
const { parseTdms, currentTracks } = require('./lib/tdm');

const FAA_SEARCH = 'https://notams.aim.faa.gov/notamSearch/search';
const CENTRES = ['KZAK', 'RJJJ'];
const PAGE = 30;
const MAX_PAGES = 12;
const CACHE_MS = 15 * 60 * 1000;
const UA = 'inflight-tracker/1.0 (+netlify-function; pacific tracks)';

let cache = null; // { at, body }

async function faaMessages(centre) {
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
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
            body,
            timeout: 12000,
        });
        if (!res.ok) throw new Error(`FAA NOTAM search ${centre} -> HTTP ${res.status}`);
        const data = await res.json();
        const list = Array.isArray(data && data.notamList) ? data.notamList : [];
        for (const n of list) {
            const t = n.icaoMessage || n.traditionalMessage || n.traditionalMessageFrom4thWord || '';
            if (/TDM\s+TRK/.test(t)) texts.push(t);
        }
        const total = Number(data && data.totalNotamCount) || 0;
        if (!list.length || (page + 1) * PAGE >= total) break;
    }
    return texts;
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
    await Promise.all(CENTRES.map(async (centre) => {
        try {
            const found = await faaMessages(centre);
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

exports.handler = async () => {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
        const body = await collect();
        // An empty fetch doesn't replace a good answer from the last 12 hours
        // (the source hiccuped); older than that, the tracks have expired and
        // an empty map is the honest answer.
        const keepOld = !body.tracks.length && cache && cache.body.tracks.length
            && Date.now() - Date.parse(cache.body.fetchedAt) < 12 * 60 * 60 * 1000;
        cache = { at: Date.now(), body: keepOld ? { ...cache.body, sources: body.sources } : body };
    }
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=900',
        },
        body: JSON.stringify(cache.body),
    };
};
