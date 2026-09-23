// File: netlify/functions/lib/tdm.js
//
// Parses Pacific Organized Track System (PACOTS) Track Definition Messages.
//
// Oakland Oceanic (KZAK) and Fukuoka (RJJJ) publish the day's Pacific tracks
// as TDMs, carried in the NOTAM system. One message per track:
//
//   (TDM TRK A 230923050001
//   2309231000 2309232100
//   OMOTO 3957N15000E 4127N16000E 4232N17000E 4302N18000E 4245N17000W
//   4152N16000W 4029N15000W ...
//   RTS/RJAA NRT OTR5 OMOTO
//   ...
//   RMK/0)
//
// i.e. TDM TRK <ident> <message id>, a validity window (YYMMDDHHMM from / to),
// the route as fixes and lat/long points, then RTS/ (connecting routes) and
// RMK/ (remarks) sections. Only the route line is drawn; named fixes are kept
// in the route text but only coordinates can be placed on the map without a
// fix database, and those are the oceanic crossing itself.

const COORD = /^(\d{2})(\d{2})?([NS])(\d{3})(\d{2})?([EW])$/;

function toDate(yymmddhhmm) {
    const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(yymmddhhmm || '');
    if (!m) return null;
    return new Date(Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5])).toISOString();
}

/** A PACOTS coordinate token → [lon, lat], or null for a named fix. */
function coordOf(token) {
    const m = COORD.exec(token);
    if (!m) return null;
    let lat = +m[1] + (m[2] ? +m[2] / 60 : 0);
    let lon = +m[4] + (m[5] ? +m[5] / 60 : 0);
    if (m[3] === 'S') lat = -lat;
    if (m[6] === 'W') lon = -lon;
    if (lat > 90 || lon > 180 || lon < -180) return null;
    return [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4];
}

/**
 * Every track definition in a block of text (several NOTAMs concatenated is
 * fine). Returns [{ name, messageId, validFrom, validTo, route, points }].
 */
function parseTdms(text) {
    const out = [];
    const src = String(text || '').replace(/\r/g, '');
    const re = /TDM\s+TRK\s+([A-Z0-9]{1,3})\s+(\d{8,14})\s+(\d{10})\s+(\d{10})\s+([\s\S]*?)(?=\bRTS\/|\bRMK\/|\bTDM\s+TRK\b|\)|$)/g;
    let m;
    while ((m = re.exec(src))) {
        const route = m[5].replace(/\s+/g, ' ').trim();
        const tokens = route.split(' ').filter(Boolean);
        const points = tokens.map(coordOf).filter(Boolean);
        if (points.length < 2) continue;
        out.push({
            name: m[1],
            messageId: m[2],
            validFrom: toDate(m[3]),
            validTo: toDate(m[4]),
            route,
            points,
        });
    }
    return out;
}

/**
 * One definition per track: the one valid now, else the next to start, else
 * the most recently ended — newest message winning ties.
 */
function currentTracks(tracks, now = Date.now()) {
    const byName = new Map();
    const rank = (t) => {
        const from = Date.parse(t.validFrom), to = Date.parse(t.validTo);
        if (from <= now && now <= to) return 0;
        if (from > now) return 1;
        return 2;
    };
    for (const t of tracks) {
        const prev = byName.get(t.name);
        if (!prev) { byName.set(t.name, t); continue; }
        const a = rank(t), b = rank(prev);
        if (a < b || (a === b && t.messageId > prev.messageId)) byName.set(t.name, t);
    }
    return [...byName.values()].sort((x, y) => x.name.localeCompare(y.name, 'en', { numeric: true }));
}

module.exports = { parseTdms, currentTracks, coordOf };
