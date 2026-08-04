/**
 * searchEngine.js
 *
 * Categorized global search over four live datasets:
 *   - Live flights  (from currentMapFeatures via window.getLiveFlightData)
 *   - Pilots        (deduped usernames of currently-connected flights)
 *   - Airports      (from airportsData; indexed once, refreshed on change)
 *   - Airlines      (derived dynamically from active liveryName values)
 *
 * Pure logic — no DOM. Consumers pass a query string and get back
 *   { flights: [...], users: [...], airports: [...], airlines: [...] }
 * with each list pre-ranked and capped.
 */

const PER_CATEGORY_CAP = 5;

// Field delimiter for the airport prefilter haystack. NUL can never
// appear in a user query, so a match in the joined string cannot span a
// field boundary - it means some individual field really does match.
const SEP = '\u0000';

const norm = (s) => (s == null ? '' : String(s)).toLowerCase().trim();
const upper = (s) => (s == null ? '' : String(s)).toUpperCase();

// Word separators, matching the [\s\-/] the ranker used to split on. ASCII is
// handled by code so the hot loop stays branch-cheap; the regex fallback only
// runs for non-ASCII (NBSP and friends), which is exact but effectively never
// reached.
const SEPARATOR_RE = /[\s\-/]/;
function isSeparator(code) {
    if (code === 32 || code === 9 || code === 10 || code === 11 ||
        code === 12 || code === 13 || code === 45 /* - */ || code === 47 /* / */) return true;
    return code > 127 && SEPARATOR_RE.test(String.fromCharCode(code));
}

// Whether the needle itself spans a word boundary. The original ranker tested
// word prefixes with h.split(/[\s\-/]+/).some(w => w.startsWith(n)); no split
// word can contain a separator, so a needle containing one could never earn
// the word-prefix rank. That behaviour is preserved here — dropping it would
// silently re-order results for multi-word queries like "delta air".
// Memoised on the needle, which is constant for a whole search.
let _sepNeedle = null;
let _sepNeedleHas = false;
function needleHasSeparator(n) {
    if (n !== _sepNeedle) {
        _sepNeedle = n;
        _sepNeedleHas = false;
        for (let i = 0; i < n.length; i++) {
            if (isSeparator(n.charCodeAt(i))) { _sepNeedleHas = true; break; }
        }
    }
    return _sepNeedleHas;
}

/**
 * Rank a pre-normalised haystack against a pre-normalised needle.
 * Lower is better: exact, then whole-string prefix, then word prefix, then
 * substring (penalised by how deep the match sits).
 *
 * Both arguments must already be lowercase and trimmed. Normalising inside
 * the ranker meant re-lowercasing the same ~330,000 airport fields on every
 * keystroke; the airport index now stores its fields pre-normalised and the
 * query is normalised once per search.
 */
function rankNormalized(h, n) {
    if (!h || !n) return Infinity;
    if (h === n) return 0;
    if (h.startsWith(n)) return 1;

    // Walk the occurrences looking for one that begins a word. This replaces
    // a regex split that allocated an array of words per field per airport.
    let idx = h.indexOf(n);
    if (idx < 0) return Infinity;
    const first = idx;
    if (!needleHasSeparator(n)) {
        while (idx > 0) {
            if (isSeparator(h.charCodeAt(idx - 1))) return 2;
            idx = h.indexOf(n, idx + 1);
            if (idx < 0) break;
        }
    }
    return 3 + Math.min(first / 50, 1);
}

// Rank: lower is better. Exact prefix wins, then word-prefix, then substring.
function rankMatch(haystack, needle) {
    return rankNormalized(norm(haystack), norm(needle));
}

// `fields` must already be normalised; `needle` too.
function bestRankNormalized(fields, needle) {
    let best = Infinity;
    for (let i = 0; i < fields.length; i++) {
        const r = rankNormalized(fields[i], needle);
        if (r < best) best = r;
        if (best === 0) break;
    }
    return best;
}

function bestRank(fields, needle) {
    const n = norm(needle);
    let best = Infinity;
    for (const f of fields) {
        const r = rankNormalized(norm(f), n);
        if (r < best) best = r;
        if (best === 0) break;
    }
    return best;
}

// A real ICAO location indicator, matching the core-tier test in
// tools/build-data.js.
const ICAO_KEY_RE = /^[A-Z]{4}$/;

let _airportIndex = null;
let _airportIndexSize = 0;

function buildAirportIndex(airportsData) {
    if (!airportsData) return [];
    const keys = Object.keys(airportsData);
    if (_airportIndex && _airportIndexSize === keys.length) return _airportIndex;

    const out = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
        const icao = keys[i];
        const a = airportsData[icao];
        if (!a) continue;
        const icaoU = icao.toUpperCase();
        const iataU = (a.iata || '').toUpperCase();
        const name = a.name || '';
        const country = a.country || '';
        const fields = [
            icaoU.toLowerCase(),
            iataU.toLowerCase(),
            name.toLowerCase().trim(),
            country.toLowerCase().trim(),
        ];
        out[i] = {
            icao: icaoU,
            iata: iataU,
            name,
            country,
            lat: a.lat,
            lon: a.lon,
            // Size class 0-4 from tools/build-data.js; 0 when the database
            // predates it, which leaves the ranking tie-break inert.
            size: a.s || 0,
            // Whether the key is a real ICAO location indicator, as opposed to
            // a US local identifier or another supplementary-tier key. Computed
            // with the index rather than per comparison inside the sort.
            isIcao: ICAO_KEY_RE.test(icaoU),
            // Pre-normalised match fields. Built once with the index rather
            // than re-derived for all ~83,000 airports on every keystroke.
            _m: fields,
            // All four fields joined by NUL for a single-scan prefilter. A
            // query can never contain NUL, so a match can't span a field
            // boundary: _hay contains the needle exactly when some field does.
            // One indexOf rejects the ~99.9% of airports that can't match,
            // instead of four plus the ranking work.
            _hay: fields.join(SEP),
        };
    }
    _airportIndex = out.filter(Boolean);
    _airportIndexSize = keys.length;
    return _airportIndex;
}

// The aircraft blob is only parsed when the flat mirrors are missing. Live
// features carry aircraftName/liveryName/registration as top-level properties,
// so the common path avoids a JSON.parse per flight per keystroke.
function aircraftFields(p) {
    let acName = p.aircraftName;
    let livName = p.liveryName;
    let reg = p.registration;
    if (acName == null || livName == null) {
        let acData = p.aircraft;
        if (typeof acData === 'string') {
            try { acData = JSON.parse(acData); } catch { acData = null; }
        }
        acData = acData || {};
        if (acName == null) acName = acData.aircraftName;
        if (livName == null) livName = acData.liveryName;
        if (reg == null) reg = acData.registration;
    }
    return { acName: acName || '', livName: livName || '', reg: reg || '' };
}

function searchFlights(query, flights, airportsData) {
    const results = [];
    const n = norm(query);
    for (const f of flights) {
        const p = f.properties || {};
        const { acName, livName, reg } = aircraftFields(p);
        const callsign = p.callsign || '';
        const username = p.username || '';

        const r = bestRankNormalized(
            [norm(callsign), norm(username), norm(reg), norm(acName), norm(livName)], n);
        if (r !== Infinity) {
            // Join airport display names so the UI can show "Tokyo HND — Toronto YYZ"
            // style route banners without holding its own copy of airportsData.
            const dep = upper(p.departureIcao || '');
            const arr = upper(p.arrivalIcao || '');
            const depName = (dep && airportsData?.[dep]?.name) || '';
            const arrName = (arr && airportsData?.[arr]?.name) || '';
            results.push({ rank: r, feature: f, callsign, username, livName, acName, depName, arrName });
        }
    }
    results.sort((a, b) => a.rank - b.rank);
    return results.slice(0, PER_CATEGORY_CAP);
}

// Pilots: dedupe usernames across live flights so one entry per connected user.
// Each result carries the user's current flight feature for the live-status row.
function searchUsers(query, flights) {
    const byUser = new Map();
    const n = norm(query);
    for (const f of flights) {
        const p = f.properties || {};
        const username = (p.username || '').trim();
        if (!username) continue;
        const key = username.toLowerCase();
        if (key === 'anonymous') continue;

        const r = rankNormalized(key, n);
        if (r === Infinity) continue;

        const existing = byUser.get(key);
        if (!existing || r < existing.rank) {
            byUser.set(key, { rank: r, username, userId: p.userId || null, feature: f });
        }
    }
    const results = [...byUser.values()];
    results.sort((a, b) => a.rank - b.rank || a.username.length - b.username.length);
    return results.slice(0, PER_CATEGORY_CAP);
}

// Airports are matched by ICAO, IATA, name, and country.
function searchAirports(query, airportIndex) {
    const results = [];
    const n = norm(query);
    for (let i = 0; i < airportIndex.length; i++) {
        const a = airportIndex[i];
        // Single-scan rejection before any ranking work (see _hay above).
        if (a._hay.indexOf(n) < 0) continue;
        const r = bestRankNormalized(a._m, n);
        if (r !== Infinity) results.push({ rank: r, airport: a });
    }
    // Tie-breaker: real ICAO codes first, then the bigger airport, then name
    // length, then the code itself.
    //
    // The ICAO test used to be `icao.length` ascending, described as favouring
    // real 4-letter codes — but it did the opposite. Real indicators are
    // exactly 4 characters, and the database holds 1,762 three-character local
    // identifiers, so every one of those sorted ahead of all 19,008 real
    // airports on any tie: "paris" led with 7M6 Paris Municipal over Orly, and
    // "dubai" with DCG Dubai Creek SPB over OMDB. Length can't express the
    // intent anyway — of the 38,081 four-character keys only 19,008 are real
    // ICAO, the rest being alphanumeric locals like K65S. Testing the shape of
    // the key does what the comment always claimed.
    //
    // Size then orders fields of the same kind, so "london" leads with Heathrow
    // rather than whichever "London ..." airfield happened to tie.
    //
    // The final step matters: sort is stable, so without it a fully tied group
    // came back in whatever order the airport file happened to list them. The
    // database now loads as two tiers, and the supplementary one arrives after
    // first paint, so insertion order is no longer fixed — results would
    // otherwise shuffle when it lands.
    results.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        if (a.airport.isIcao !== b.airport.isIcao) return a.airport.isIcao ? -1 : 1;
        if (a.airport.size !== b.airport.size) return b.airport.size - a.airport.size;
        const na = a.airport.name.length, nb = b.airport.name.length;
        if (na !== nb) return na - nb;
        return a.airport.icao < b.airport.icao ? -1 : a.airport.icao > b.airport.icao ? 1 : 0;
    });
    return results.slice(0, PER_CATEGORY_CAP);
}

/* ── Routes ──────────────────────────────────────────────────────────────
 *
 * "EGLL-KJFK" is the one query shape the box could not answer. Ranking it as
 * two separate airport hits is the wrong answer to a question that was clearly
 * about the pair: how far is it, and who is on it right now.
 *
 * A route query is two airport codes with something between them — a dash, a
 * slash, an arrow, the word "to", or just a space. Either code may be IATA, so
 * "LHR JFK" works as well as "EGLL EGKK". Anything else falls through and the
 * query is searched normally, so this can only ever add a section.
 */

const ROUTE_CODE_RE = /^[A-Z0-9]{3,4}$/;
const EARTH_R_NM = 3440.065;

// How many live flights on the route the section lists. Higher than the other
// categories: a route section that stops at five is hiding the answer on a
// busy pairing, and these rows are the whole point of the section.
const ROUTE_FLIGHT_CAP = 6;

function greatCircleNm(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Split a query into an ordered code pair, or null when it isn't one.
 * Separators collapse to a single space first, so every spelling of the same
 * route lands on the same two tokens.
 */
export function parseRoutePair(query) {
    const cleaned = String(query || '')
        .trim()
        .replace(/[-–—>/→»]+/g, ' ')
        .replace(/\bto\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
    if (!cleaned) return null;

    const parts = cleaned.split(' ');
    if (parts.length !== 2) return null;
    if (!ROUTE_CODE_RE.test(parts[0]) || !ROUTE_CODE_RE.test(parts[1])) return null;
    if (parts[0] === parts[1]) return null;
    return parts;
}

/**
 * Resolve a code to one airport. An exact key wins outright; otherwise the
 * code is treated as IATA, preferring a real ICAO indicator and then the
 * larger field, so "LHR" cannot resolve to a heliport that shares the code.
 */
function resolveAirport(code, airportsData, airportIndex) {
    const direct = airportsData[code];
    if (direct && direct.lat != null) {
        return {
            icao: code,
            iata: (direct.iata || '').toUpperCase(),
            name: direct.name || '',
            lat: direct.lat,
            lon: direct.lon,
        };
    }
    if (code.length !== 3) return null;

    let best = null;
    for (let i = 0; i < airportIndex.length; i++) {
        const a = airportIndex[i];
        if (a.iata !== code || a.lat == null) continue;
        if (!best
            || (a.isIcao && !best.isIcao)
            || (a.isIcao === best.isIcao && a.size > best.size)) {
            best = a;
        }
    }
    return best ? { icao: best.icao, iata: best.iata, name: best.name, lat: best.lat, lon: best.lon } : null;
}

/**
 * The route a query names, with the traffic on it right now.
 * Returns an empty list when the query is not a pair or either end is unknown —
 * an unrecognised code is not an error, it just means this is an ordinary
 * search after all.
 */
function searchRoutes(query, flights, airportsData, airportIndex) {
    const pair = parseRoutePair(query);
    if (!pair) return [];

    const dep = resolveAirport(pair[0], airportsData, airportIndex);
    const arr = resolveAirport(pair[1], airportsData, airportIndex);
    if (!dep || !arr || dep.icao === arr.icao) return [];

    const onRoute = [];
    let reverse = 0;
    for (const f of flights) {
        const p = f.properties || {};
        const d = upper(p.departureIcao || '');
        const a = upper(p.arrivalIcao || '');
        if (d === arr.icao && a === dep.icao) { reverse++; continue; }
        if (d !== dep.icao || a !== arr.icao) continue;

        // Distance still to run, decorated onto the entry rather than computed
        // inside the comparator — a sort would otherwise re-derive it O(n log n)
        // times per keystroke. A feature with no usable position sorts last
        // instead of poisoning the order with a NaN.
        const c = f.geometry && f.geometry.coordinates;
        const lat = c ? Number(c[1]) : NaN;
        const lon = c ? Number(c[0]) : NaN;
        const toGo = (Number.isFinite(lat) && Number.isFinite(lon))
            ? greatCircleNm(lat, lon, arr.lat, arr.lon)
            : Infinity;
        onRoute.push({ feature: f, toGoNm: toGo });
    }

    // Furthest along first — on a busy pairing the flight about to land is
    // more interesting than the one still at the gate.
    onRoute.sort((x, y) => x.toGoNm - y.toGoNm);

    return [{
        dep,
        arr,
        distanceNm: greatCircleNm(dep.lat, dep.lon, arr.lat, arr.lon),
        total: onRoute.length,
        reverse,
        flights: onRoute.slice(0, ROUTE_FLIGHT_CAP),
    }];
}

function searchAirlines(query, flights) {
    // Build a count map over active liveries.
    const tally = new Map();
    for (const f of flights) {
        const p = f.properties || {};
        const liv = p.liveryName != null ? p.liveryName : aircraftFields(p).livName;
        if (!liv) continue;
        const key = String(liv).trim();
        if (!key || key.toLowerCase() === 'generic') continue;
        tally.set(key, (tally.get(key) || 0) + 1);
    }

    const results = [];
    const n = norm(query);
    for (const [name, count] of tally) {
        const r = rankNormalized(norm(name), n);
        if (r !== Infinity) results.push({ rank: r, name, count });
    }
    // Tie-breaker: higher active fleet count first.
    results.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return b.count - a.count;
    });
    return results.slice(0, PER_CATEGORY_CAP);
}

/**
 * Run a categorized search.
 * @param {string} query
 * @param {Object} ctx
 * @param {Object} ctx.airportsData - keyed by ICAO
 * @param {Array}  ctx.flights      - GeoJSON features from currentMapFeatures
 * @returns {{routes: Array, flights: Array, users: Array, airports: Array, airlines: Array, query: string}}
 */
export function runSearch(query, ctx) {
    const q = (query || '').trim();
    if (q.length < 2) return { routes: [], flights: [], users: [], airports: [], airlines: [], query: q };

    const airportsData = ctx.airportsData || {};
    const airportIndex = buildAirportIndex(airportsData);
    const flights = ctx.flights || [];

    return {
        query: q,
        routes: searchRoutes(q, flights, airportsData, airportIndex),
        flights: searchFlights(q, flights, airportsData),
        users: searchUsers(q, flights),
        airports: searchAirports(q, airportIndex),
        airlines: searchAirlines(q, flights),
    };
}

export function invalidateAirportIndex() {
    _airportIndex = null;
    _airportIndexSize = 0;
}

// Expose globally for non-module callers (flight.js uses window.* glue).
if (typeof window !== 'undefined') {
    window.GlobalSearchEngine = { runSearch, invalidateAirportIndex };
}
