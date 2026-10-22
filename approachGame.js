/**
 * approachGame.js — Approach, the endless radar ATC game (approach.html).
 *
 * The player works approach and tower at one real airport, built from the
 * same runways-core.json / airports-core.json the live map uses. Arrivals
 * spawn at the edge of a 40 nm scope and must be vectored onto an ILS;
 * departures wait at the runway and must be climbed out through an exit gate.
 * Traffic keeps coming, a little faster as the shift goes on.
 *
 * Geometry is a flat local plane in nautical miles centred on the airport
 * reference point: x east, y north, headings true.
 *
 * The rules follow FAA JO 7110.65 (Air Traffic Control) wherever the game
 * models them — radar and wake separation, final approach interception,
 * speed control, runway separation and phraseology. docs/APPROACH-ATC.md
 * lists each rule, its paragraph and how the game scores it.
 */

import { loadDem, terrainAt, renderRelief, buildMva, mvaAt, mvaArea, MVA_RING_NM, MVA_WEDGE, TerrainTiles } from './approachTerrain.js';
import { buildGround, nearestNode, route, withCrossings, pointAt, toSegment } from './approachGround.js';
import { drawIcon } from './approachIcons.js';
import { AirportLayoutManager } from './airportLayout.js';
import { aerowayFromOpenFreeMap, gatesFromBackend } from './approachTiles.js';

const $ = (s, el = document) => el.querySelector(s);

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

const SCOPE_NM = 40;        // airspace radius; leaving it ends a flight
const FIX_NM = 34;          // radius of the entry fixes and exit gates
const SEP_NM = 3;
const SEP_FT = 1000;
const TICK = 0.25;          // simulation step, seconds
const TURN_RATE = 3;        // deg/s, standard rate
const MAX_BANK = 25;        // deg: airliners turn at standard rate or 25° of bank, whichever is less
const ROLL_ACCEL = 1.2;     // deg/s per second: how fast a turn rate builds or eases (5-10 s to roll in)
const GS_FT_PER_NM = 318;   // 3° glideslope
const MIN_LANDING_RWY_FT = 4500;
const FAF_NM = 5;           // nominal final approach fix
const GATE_NM = FAF_NM + 1; // approach gate: 1 NM outside the FAF (7110.65 5-9-1)
const LAND_CLR_NM = 0.6;    // no landing clearance by here and the pilot goes around
const VIOLATION_PTS = 5;

/** Seconds between new aircraft (shrinking over the first ninety minutes), how many at once, and how many departures on the ground or queued. */
const TRAFFIC = {
    light:  { gap: 80, max: 8,  gnd: 4,  queue: 2 },
    normal: { gap: 50, max: 14, gnd: 6,  queue: 3 },
    busy:   { gap: 32, max: 20, gnd: 9,  queue: 4 },
    event:  { gap: 20, max: 28, gnd: 12, queue: 6 },
};

const FEATURED = ['KJFK', 'KLAX', 'KATL', 'KORD', 'KDFW', 'KDEN', 'KSFO', 'KSEA', 'KBOS', 'KMIA', 'KLAS', 'KEWR'];

const AIRLINES = [
    { icao: 'AAL', radio: 'American',   w: 10, types: ['B738', 'A321', 'A320', 'B772', 'B789'] },
    { icao: 'DAL', radio: 'Delta',      w: 10, types: ['A321', 'B739', 'A320', 'A339', 'B763', 'A359', 'B752'] },
    { icao: 'UAL', radio: 'United',     w: 10, types: ['B738', 'B739', 'A320', 'B772', 'B789', 'B38M', 'B753'] },
    { icao: 'SWA', radio: 'Southwest',  w: 8,  types: ['B737', 'B738', 'B38M'] },
    { icao: 'JBU', radio: 'JetBlue',    w: 4,  types: ['A320', 'A321', 'E190'] },
    { icao: 'ASA', radio: 'Alaska',     w: 4,  types: ['B739', 'B738', 'B38M'] },
    { icao: 'NKS', radio: 'Spirit',     w: 3,  types: ['A320', 'A321'] },
    { icao: 'FFT', radio: 'Frontier Flight', w: 3, types: ['A320', 'A321'] },
    { icao: 'SKW', radio: 'SkyWest',    w: 5,  types: ['CRJ9', 'E175', 'CRJ7'], regional: true },
    { icao: 'RPA', radio: 'Brickyard',  w: 3,  types: ['E175', 'E170'], regional: true },
    { icao: 'ENY', radio: 'Envoy',      w: 2,  types: ['E175', 'CRJ9'], regional: true },
    { icao: 'FDX', radio: 'FedEx',      w: 3,  types: ['B763', 'B77L', 'MD11'] },
    { icao: 'UPS', radio: 'UPS',        w: 2,  types: ['B763', 'B748', 'MD11'] },
    { icao: 'ACA', radio: 'Air Canada', w: 2,  types: ['A320', 'B38M', 'B789'] },
    { icao: 'BAW', radio: 'Speedbird',  w: 1,  types: ['B77W', 'A35K', 'B789'], intl: true },
    { icao: 'DLH', radio: 'Lufthansa',  w: 1,  types: ['B748', 'A359'], intl: true },
    { icao: 'AFR', radio: 'Air France', w: 1,  types: ['B77W', 'A359'], intl: true },
    { icao: 'UAE', radio: 'Emirates',   w: 1,  types: ['A388', 'B77W'], intl: true },
    { icao: 'JAL', radio: 'Japan Air',  w: 1,  types: ['B789', 'B77W'], intl: true },
];
const HEAVY = new Set(['B772', 'B77W', 'B77L', 'B789', 'B763', 'A339', 'A359', 'A35K', 'B748', 'A388', 'MD11']);

/** Light aircraft for pattern work and transitions. */
const PROPS = new Set(['C172', 'SR22', 'PA28', 'DA40', 'C208']);
const TYPE_WORD = { C172: 'Cessna', SR22: 'Cirrus', PA28: 'Piper', DA40: 'Diamond', C208: 'Caravan' };
const typeWord = a => TYPE_WORD[a.type] || (/^A3/.test(a.type) ? 'Airbus' : /^B7/.test(a.type) ? 'Boeing' : /^(E1|E7|CRJ)/.test(a.type) ? 'regional jet' : 'traffic');

function perf(type) {
    if (PROPS.has(type)) return { prop: true, heavy: false, wake: 'L', vapp: type === 'C208' ? 80 : 65, vr: 55, climb: 700, desc: 800 };
    const heavy = HEAVY.has(type);
    const regional = /^(CRJ|E1|E7)/.test(type);
    return {
        heavy,
        // Wake turbulence weight class: Super, Heavy, B757, Large.
        wake: type === 'A388' ? 'S' : heavy ? 'H' : /^B75/.test(type) ? 'B757' : 'L',
        vapp: heavy ? 150 : regional ? 130 : 140,
        vr: heavy ? 160 : regional ? 135 : 145,
        climb: heavy ? 2000 : 2600,
        desc: 2000,
    };
}

/**
 * Wake turbulence radar separation, leader -> follower, in NM (7110.65 5-5-4,
 * weight-class minima). Pairs not listed need only standard radar separation.
 */
const WAKE_NM = {
    S: { H: 6, B757: 7, L: 7 },
    H: { H: 4, B757: 5, L: 5 },
};
const wakeNm = (lead, follow) => (G && !G.rules.wake ? 0 : (WAKE_NM[lead.perf.wake] || {})[follow.perf.wake] || 0);

/*
 * Rule sets. "Real life" is FAA JO 7110.65 as modelled throughout. "Infinite
 * Flight" plays it the way IFATC controls on the Expert Server, and leaves
 * out what Infinite Flight doesn't have:
 *   - no wake turbulence (the sim doesn't model it), so no wake minima on
 *     final and no 2/3-minute departure intervals behind heavies;
 *   - 3 NM / 1,000 ft radar separation throughout, without the 2.5 NM
 *     reduced in-trail minimum;
 *   - no emergencies, no storm cells or deviation requests, and no forced
 *     go-arounds below ILS minimums (pilots decide in IF);
 *   - taxi clearances by runway or parking ("taxi to runway 27L"), not
 *     read-out routes: the route is the one dragged on the map.
 * Each switch is one line here, so a rule found to differ from the IFATC
 * manual is a one-line change.
 */
const RULESETS = {
    faa: { id: 'faa', name: 'Real life (FAA)', wake: true, reducedTrail: true, emergencies: true, storms: true, minimums: true, taxiVia: true },
    ifatc: { id: 'ifatc', name: 'Infinite Flight (IFATC)', wake: false, reducedTrail: false, emergencies: false, storms: false, minimums: false, taxiVia: false },
};
const WAKE_NAME = { S: 'super', H: 'heavy', B757: 'B757', L: 'large' };

/* ------------------------------------------------------------------ */
/* Small math                                                          */
/* ------------------------------------------------------------------ */

const D2R = Math.PI / 180;
const norm = h => ((h % 360) + 360) % 360;
/** Signed shortest turn from heading a to heading b, in (-180, 180]. */
const diff = (a, b) => { const d = norm(b - a); return d > 180 ? d - 360 : d; };
/** True bearing of the vector (dx east, dy north). */
const brg = (dx, dy) => norm(Math.atan2(dx, dy) / D2R);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const hdg3 = h => String(Math.round(norm(h)) || 360).padStart(3, '0');
const fmtAlt = ft => ft >= 18000 ? `flight level ${Math.round(ft / 100)}` : Math.round(ft).toLocaleString('en-US');
const alt3 = ft => String(Math.max(0, Math.round(ft / 100))).padStart(3, '0');
const rwyKey = id => String(id).toUpperCase().replace(/^0+/, '');
const PHONETIC = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike',
    'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu'];
const cardinal = b => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(norm(b) / 45) % 8];

function seeded(str) {
    let h = 2166136261;
    for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => {
        h += 0x6D2B79F5;
        let t = h;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function fixName(rng, used) {
    const C = 'BCDFGHJKLMNPRSTVWZ', V = 'AEIOU';
    for (;;) {
        let s = '';
        for (let i = 0; i < 5; i++) s += i % 2 ? V[Math.floor(rng() * V.length)] : C[Math.floor(rng() * C.length)];
        if (!used.has(s)) { used.add(s); return s; }
    }
}

/* ------------------------------------------------------------------ */
/* Storage (best scores, last airport) — per-viewer conveniences only  */
/* ------------------------------------------------------------------ */

const store = {
    get(k, d) { try { const v = localStorage.getItem('inflight.approach.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('inflight.approach.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/* ------------------------------------------------------------------ */
/* Airport data                                                        */
/* ------------------------------------------------------------------ */

let DATA = null;

function usableRunway(r) {
    return !r.closed
        && r.le_latitude_deg != null && r.le_longitude_deg != null
        && r.he_latitude_deg != null && r.he_longitude_deg != null
        && (r.length_ft || 0) >= MIN_LANDING_RWY_FT
        && !/grass|turf|water|dirt|gravel|sand|coral|soil/i.test(r.surface || '');
}

async function loadData() {
    const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
    const [airports, runways] = await Promise.all([get('/airports-core.json'), get('/runways-core.json')]);
    const playable = [];
    for (const icao in runways) {
        const ap = airports[icao];
        if (!ap) continue;
        const usable = runways[icao].filter(usableRunway);
        if (!usable.length) continue;
        playable.push({ icao, name: ap.name, iata: ap.iata || '', country: ap.country || '', s: ap.s || 0, lat: ap.lat, lon: ap.lon, runways: usable });
    }
    playable.sort((a, b) => b.s - a.s);
    DATA = { playable, byIcao: new Map(playable.map(p => [p.icao, p])) };
}

/** Lay the airport out on the local plane: runway ends, fixes, elevation. */
function buildWorld(p, nav) {
    const cosLat = Math.cos(p.lat * D2R);
    const proj = (lat, lon) => ({ x: (lon - p.lon) * 60 * cosLat, y: (lat - p.lat) * 60 });
    const ends = [];
    const elevs = [];
    p.runways.forEach((r, i) => {
        const a = proj(r.le_latitude_deg, r.le_longitude_deg);
        const b = proj(r.he_latitude_deg, r.he_longitude_deg);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.5) return;
        if (r.le_elevation_ft != null) elevs.push(r.le_elevation_ft);
        if (r.he_elevation_ft != null) elevs.push(r.he_elevation_ft);
        const width = (r.width_ft || 150) / 6076;
        const le = { id: String(r.le_ident), thr: a, far: b, course: brg(b.x - a.x, b.y - a.y), len, phys: i, width };
        const he = { id: String(r.he_ident), thr: b, far: a, course: brg(a.x - b.x, a.y - b.y), len, phys: i, width };
        le.opp = he; he.opp = le;
        ends.push(le, he);
    });
    const elev = elevs.length ? Math.round(elevs.reduce((s, v) => s + v, 0) / elevs.length) : 0;

    // Fixes are invented but stable per airport, so a regular learns them.
    const rng = seeded(p.icao);
    const used = new Set();
    const fixes = [];
    const base = rng() * 90;
    for (let k = 0; k < 4; k++) {
        const ab = norm(base + 45 + 90 * k), db = norm(base + 90 * k);
        fixes.push({ kind: 'arr', name: fixName(rng, used), bearing: ab, x: Math.sin(ab * D2R) * FIX_NM, y: Math.cos(ab * D2R) * FIX_NM });
        fixes.push({ kind: 'dep', name: fixName(rng, used), bearing: db, x: Math.sin(db * D2R) * FIX_NM, y: Math.cos(db * D2R) * FIX_NM });
    }
    // One approach fix 12 nm out on every runway end's centerline.
    for (const e of ends) {
        const c = e.course * D2R;
        e.appFix = { kind: 'app', name: fixName(rng, used), end: e, x: e.thr.x - Math.sin(c) * 12, y: e.thr.y - Math.cos(c) * 12 };
        fixes.push(e.appFix);
    }
    const minAlt = Math.ceil((elev + 1500) / 1000) * 1000;
    const real = nav ? realFixes(nav, ends, proj) : null;
    if (real) {
        fixes.length = 0;
        fixes.push(...real.fixes);
        for (const e of ends) if (e.appFix && !real.fixes.includes(e.appFix)) fixes.push(e.appFix);
    }
    return {
        icao: p.icao, name: p.name, elev, ends, fixes, minAlt, proj, lat: p.lat, lon: p.lon, nav: real ? nav : null,
        exitAlt: Math.max(9000, Math.ceil((elev + 6000) / 1000) * 1000),
    };
}

/* ------------------------------------------------------------------ */
/* Real waypoints and procedures (FAA CIFP/NASR via tools/build-nav.mjs) */
/* ------------------------------------------------------------------ */

async function loadNav(icao) {
    try {
        const r = await Promise.race([fetch(`/nav/${encodeURIComponent(icao)}.json`), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
        return r.ok ? await r.json() : null;
    } catch { return null; }
}

/**
 * The airport's real fixes in place of invented ones: arrival entry fixes
 * where each STAR enters the scope (with the STAR from there in), exit gates
 * where the SIDs end (with each runway's SID), each runway's ILS
 * intermediate fix as its approach fix (and the FAF's name), and the other
 * procedure fixes in range as waypoints. null when there's too little to use.
 */
function realFixes(nav, ends, proj) {
    const at = id => { const f = nav.fix[id]; return f ? { name: id, ...proj(f[0], f[1]) } : null; };
    const dist = f => Math.hypot(f.x, f.y);
    const legsOf = list => list.map(l => { const f = l[0] && at(l[0]); return { name: l[0], x: f?.x, y: f?.y, alt: l[1], desc: l[2], spd: l[3], pt: l[4], role: l[5] }; });
    const out = [], byName = new Map();
    const add = f => { if (!byName.has(f.name)) { byName.set(f.name, f); out.push(f); } return byName.get(f.name); };

    // STARs: each enroute transition (or the common route alone) as one path; enter at the first fix inside the scope.
    for (const st of nav.star) {
        const common = st.routes.filter(r => !r.t).flatMap(r => r.legs);
        const enroute = st.routes.filter(r => r.t && !/^RW/.test(r.t));
        const paths = enroute.length ? enroute.map(r => [...r.legs, ...common.filter((l, i) => i || l[0] !== r.legs[r.legs.length - 1]?.[0])]) : [common];
        for (const path of paths) {
            const legs = legsOf(path).filter(l => l.x != null);
            const k = legs.findIndex(l => dist(l) <= SCOPE_NM - 3);
            if (k < 0 || dist(legs[k]) < 14) continue;
            const f = add({ kind: 'arr', name: legs[k].name, x: legs[k].x, y: legs[k].y, bearing: brg(legs[k].x, legs[k].y), stars: [] });
            if (f.kind === 'arr' && !f.stars.some(s => s.id === st.id)) f.stars.push({ id: st.id, legs: legs.slice(k) });
        }
    }
    // SIDs: runway transition + common route + an enroute transition, ending at an exit gate.
    for (const sd of nav.sid) {
        const common = sd.routes.filter(r => !r.t).flatMap(r => r.legs);
        const rwyT = sd.routes.filter(r => /^RW/.test(r.t)), enroute = sd.routes.filter(r => r.t && !/^RW/.test(r.t));
        for (const en of enroute.length ? enroute : [{ t: '', legs: [] }]) {
            const tail = [...common, ...en.legs];
            const last = legsOf(tail).filter(l => l.x != null).pop();
            if (!last) continue;
            const b = brg(last.x, last.y), inside = dist(last) <= SCOPE_NM - 2;
            const gate = byName.get(last.name) || add({ kind: 'dep', name: last.name, bearing: b, ...(inside ? { x: last.x, y: last.y } : { x: Math.sin(b * D2R) * FIX_NM, y: Math.cos(b * D2R) * FIX_NM }), sids: [] });
            if (gate.kind !== 'dep') continue;
            for (const rt of rwyT) gate.sids.push({ id: sd.id, rwy: rt.t.slice(2), legs: legsOf([...rt.legs, ...tail]) });
            if (!rwyT.length) gate.sids.push({ id: sd.id, rwy: '', legs: legsOf(tail) });
        }
    }
    const arr = out.filter(f => f.kind === 'arr'), dep = out.filter(f => f.kind === 'dep');
    if (arr.length < 2 || dep.length < 2) return null;              // not enough real routing: keep the invented fixes
    // Approach fixes: the ILS (else LOC/RNAV) intermediate fix for each runway end, and its FAF.
    for (const e of ends) {
        const iap = ['ILS', 'LOC', 'RNAV'].map(t => nav.iap.find(a => a.rwy === e.id && (a.type || '').startsWith(t))).find(Boolean);
        if (!iap) continue;
        const main = iap.routes.find(r => !r.t)?.legs || [];
        const ifx = main.find(l => l[4] === 'IF' && nav.fix[l[0]]), faf = main.find(l => l[5] === 'F');
        const f = ifx && at(ifx[0]);
        if (f && dist(f) < 30) e.appFix = add({ kind: 'app', name: f.name, x: f.x, y: f.y, end: e });
        e.fafName = faf?.[0] || null; e.iapName = iap.name;
    }
    // Every other fix the procedures use, in range, as a waypoint (direct-to, holds, the map).
    for (const id of new Set([...nav.star, ...nav.sid, ...nav.iap].flatMap(p => p.routes.flatMap(r => r.legs.map(l => l[0]))))) {
        const f = id && !/^RW/.test(id) && at(id);
        if (f && dist(f) < SCOPE_NM - 1) add({ kind: 'wp', name: id, x: f.x, y: f.y, bearing: brg(f.x, f.y) });
    }
    return { fixes: out };
}

/**
 * Flying a published procedure ("descend via" a STAR, "climb via" a SID):
 * fix to fix, with the altitude and speed constraints. A heading, a direct
 * or an approach clearance ends it; an altitude ends only the vertical part.
 */
function viaStep(ac) {
    const v = ac.via;
    let leg = v.legs[v.i];
    while (leg && leg.x == null && leg.pt !== 'VA' && leg.pt !== 'CA') leg = v.legs[++v.i];
    if (!leg) {
        ac.via = null;
        if (v.kind === 'IAP') { joinFinal(ac, v.end, 'RNAV'); return; }
        if (v.kind === 'STAR' || v.kind === 'FPL') pilot(ac, `${ac.radio}, end of the ${v.kind === 'STAR' ? v.id + ' arrival' : 'filed route'}, request vectors.`);
        else if (ac.gate) ac.direct = ac.gate.x != null ? ac.gate : null;
        return;
    }
    if (leg.x == null) {
        // Climb on runway heading to an altitude, then on.
        ac.tHdg = ac.rwy ? ac.rwy.course : ac.hdg;
        if (ac.alt >= (leg.alt || 0) - 50) v.i++;
    } else {
        ac.tHdg = brg(leg.x - ac.x, leg.y - ac.y); ac.turn = null;
        if (leg.spd && ac.tSpd > leg.spd) ac.tSpd = leg.spd;
        if (Math.hypot(leg.x - ac.x, leg.y - ac.y) < 1) v.i++;
    }
    if (!v.vert) return;
    // Vertical: down (or up) to the next "at" / "at or below" constraint, never below an "at or above" before it.
    let target = null, floor = 0;
    for (let k = v.i; k < v.legs.length; k++) {
        const l = v.legs[k];
        if (l.alt == null) continue;
        if (l.desc === '+') { floor = Math.max(floor, l.alt); continue; }
        target = l.alt; break;
    }
    if (v.kind === 'SID') ac.tAlt = target != null ? Math.min(v.top, Math.max(target, floor)) : v.top;
    else if (target != null || floor) ac.tAlt = Math.max(target ?? floor, floor, G.world.minAlt);
}

/* ---- Map layers: waypoints on/dim/off, and which procedures are plotted ---- */

let layers = { wp: 'on', bright: 0.5, ...store.get('layers', {}) };

/** Every procedure at the airport as drawable paths: { key, type, id, label, rwy, paths: [[{ name, x, y, alt, desc }]] }. */
function procCatalog() {
    const W = G.world;
    if (W.procs) return W.procs;
    const nav = W.nav;
    W.procs = [];
    if (!nav) return W.procs;
    const pt = id => { const f = id && nav.fix[id]; return f ? W.proj(f[0], f[1]) : null; };
    const pathOf = legs => legs.map(l => { const q = pt(l[0]); return q && { name: l[0], ...q, alt: l[1], desc: l[2] }; }).filter(Boolean);
    const add = (type, p, label, rwy) => W.procs.push({ key: type + ':' + p.id, type, id: p.id, label, rwy, paths: p.routes.map(r => pathOf(r.legs)).filter(x => x.length > 1) });
    for (const p of nav.star) add('STAR', p, p.id, '');
    for (const p of nav.sid) add('SID', p, p.id, p.routes.filter(r => /^RW/.test(r.t)).map(r => r.t.slice(2)).join(' '));
    for (const p of nav.iap) add('IAP', p, p.name.replace(/\s*\([^)]*\)/g, '').replace(' RWY ', ' '), p.rwy);
    return W.procs;
}

/** The procedures that matter right now: STARs, SIDs off the departure runways, ILS/LOC for the landing ones. */
function autoProcs() {
    const dep = G.active.dep, arr = G.active.arr;
    const onDep = p => !p.rwy || dep.some(e => p.rwy.split(' ').some(r => r === e.id || r === e.id.replace(/[LRC]$/, '') + 'B' || r === e.id.replace(/[LRC]$/, '')));
    return new Set(procCatalog().filter(p => p.type === 'STAR' || (p.type === 'SID' && onDep(p)) || (p.type === 'IAP' && /^(ILS|LOC)/.test(p.label) && arr.some(e => e.id === p.rwy))).map(p => p.key));
}

const procSel = () => G.procSel || (G.procSel = { mode: 'auto', ids: [], ...store.get('procs.' + G.world.icao, {}) });
function procShown() {
    const sel = procSel();
    return sel.mode === 'auto' ? autoProcs() : new Set(sel.ids);
}

function drawProcedures() {
    const shown = procShown();
    if (!shown.size) return;
    const c = ctx, col = { STAR: COLORS.fixArr, SID: COLORS.fixDep, IAP: COLORS.fixApp };
    c.save();
    c.globalAlpha = layers.bright;
    c.font = '9px "JetBrains Mono", monospace';
    const labelled = new Set();
    for (const p of procCatalog()) {
        if (!shown.has(p.key)) continue;
        c.strokeStyle = c.fillStyle = col[p.type];
        c.lineWidth = p.type === 'IAP' ? 1.2 : 1;
        c.setLineDash(p.type === 'IAP' ? [] : [4, 4]);
        for (const path of p.paths) {
            c.beginPath();
            path.forEach((q, i) => { const [x, y] = toS(q.x, q.y); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
            c.stroke();
        }
        c.setLineDash([]);
        // The procedure's name at its start, and each fix's altitude constraint once zoomed in.
        const start = p.paths[0]?.[0];
        if (start) { const [x, y] = toS(start.x, start.y); c.font = '700 10px "JetBrains Mono", monospace'; c.fillText(p.label, x + 6, y - 6); c.font = '9px "JetBrains Mono", monospace'; }
        if (view.scale < 10) continue;
        for (const path of p.paths) for (const q of path) {
            const k = p.key + q.name;
            if (labelled.has(k) || /^RW/.test(q.name)) continue;
            labelled.add(k);
            const [x, y] = toS(q.x, q.y);
            c.beginPath(); c.arc(x, y, 1.8, 0, Math.PI * 2); c.fill();
            if (layers.wp === 'off') c.fillText(q.name, x + 5, y + 3);
            if (q.alt != null) c.fillText(`${q.alt}${q.desc === '+' ? '+' : q.desc === '-' ? '-' : ''}`, x + 5, y + 13);
        }
    }
    c.restore();
}

function renderLayers() {
    const el = $('#layers');
    if (!el || el.hidden || !G) return;
    const cat = procCatalog(), shown = procShown(), sel = procSel();
    const chips = type => cat.filter(p => p.type === type).map(p => `<button type="button" class="chip-btn${shown.has(p.key) ? ' on' : ''}" data-proc="${escapeHtml(p.key)}">${escapeHtml(p.label)}${p.rwy && p.type === 'SID' ? `<small>${escapeHtml(p.rwy)}</small>` : ''}</button>`).join('');
    const seg = (key, opts, val) => `<div class="seg" data-layer="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === val ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    el.innerHTML = `
        <div class="layers-h"><span>MAP LAYERS</span><button type="button" class="info-x" data-close aria-label="Close">✕</button></div>
        <div class="lrow"><span>Waypoints</span>${seg('wp', [['on', 'On'], ['dim', 'Dim'], ['off', 'Off']], layers.wp)}</div>
        ${cat.length ? `
        <div class="lrow"><span>Procedures</span><input type="range" id="l-bright" min="10" max="100" value="${Math.round(layers.bright * 100)}" aria-label="Procedure brightness"></div>
        <div class="lrow">${seg('pmode', [['auto', 'Runways in use'], ['all', 'All'], ['none', 'None']], sel.mode === 'auto' ? 'auto' : sel.ids.length === cat.length ? 'all' : sel.ids.length ? '' : 'none')}</div>
        <h4>Arrivals (STAR)</h4><div class="chips">${chips('STAR') || '<span class="none">None published</span>'}</div>
        <h4>Departures (SID)</h4><div class="chips">${chips('SID') || '<span class="none">None published</span>'}</div>
        <h4>Approaches</h4><div class="chips">${chips('IAP')}</div>
        <p class="note">FAA data, cycle ${escapeHtml(G.world.nav.cycle || '')}. Tap a procedure to plot it.</p>`
        : `<p class="note">Real procedures are plotted at US airports. Here the fixes are the game's own.</p>`}`;
}

function bindLayers() {
    const el = $('#layers');
    $('#layers-btn').onclick = () => { el.hidden = !el.hidden; $('#layers-btn').classList.toggle('on', !el.hidden); if (!el.hidden) { $('#settings').hidden = true; $('#settings-btn').classList.remove('on'); } renderLayers(); };
    el.addEventListener('click', e => {
        if (!G) return;
        if (e.target.closest('[data-close]')) { el.hidden = true; $('#layers-btn').classList.remove('on'); return; }
        const b = e.target.closest('button');
        if (!b) return;
        const sel = procSel(), seg = b.closest('[data-layer]');
        if (seg && seg.dataset.layer === 'wp') { layers.wp = b.dataset.v; store.set('layers', layers); }
        else if (seg && seg.dataset.layer === 'pmode') {
            const all = procCatalog().map(p => p.key);
            Object.assign(sel, b.dataset.v === 'auto' ? { mode: 'auto', ids: [] } : { mode: 'pick', ids: b.dataset.v === 'all' ? all : [] });
        } else if (b.dataset.proc) {
            const ids = new Set(procShown());
            if (ids.has(b.dataset.proc)) ids.delete(b.dataset.proc); else ids.add(b.dataset.proc);
            Object.assign(sel, { mode: 'pick', ids: [...ids] });
        } else return;
        store.set('procs.' + G.world.icao, { mode: sel.mode, ids: sel.ids });
        renderLayers();
    });
    el.addEventListener('input', e => {
        if (e.target.id !== 'l-bright') return;
        layers.bright = Number(e.target.value) / 100;
        store.set('layers', layers);
    });
}

/* ---- Approach types: ILS, localizer, RNAV (GPS) and visual ---- */

const APP_NAMES = { ILS: 'ILS', LOC: 'localizer', RNAV: 'RNAV (GPS)', VIS: 'visual' };
/** Infinite Flight says GPS (and has no localizer-only approach). */
const APP_NAME = new Proxy(APP_NAMES, { get: (o, k) => (k === 'RNAV' && G?.rules.id === 'ifatc' ? 'GPS' : o[k]) });
const APP_TAG = { ILS: 'ILS', LOC: 'LOC', RNAV: 'RNV', VIS: 'VIS' };

/** Good enough weather for a visual approach (7110.65 7-4-2: ceiling 1,000 ft or more, visibility 3 SM or more). */
const visualWx = () => !G.met || ((G.met.ceil == null || G.met.ceil >= 1000) && G.met.vis >= 3);

/** The published approach of a type for a runway end (real data), or null. */
function iapFor(e, type) {
    const list = G.world.nav?.iap || [];
    const want = type === 'RNAV' ? /^(RNAV|GPS)/ : type === 'LOC' ? /^LOC/ : /^ILS/;
    const fits = list.filter(a => a.rwy === e.id && want.test(a.type || ''));
    return fits.find(a => !/RNP/.test(a.type)) || fits[0] || null;
}
/** Whether a runway end has this kind of approach: from the data where there is some, otherwise assumed (visual always). */
const hasApproach = (e, type) => type === 'VIS' || !G.world.nav || !!iapFor(e, type);

/**
 * Flying an RNAV approach as published: from an initial or intermediate fix
 * within 25 miles, along the transition and the common route to the final
 * approach fix, then onto final. null when no fix is near enough (then it's
 * vectors to final, as for an ILS).
 */
function rnavRoute(ac, e) {
    const iap = iapFor(e, 'RNAV');
    if (!iap) return null;
    const nav = G.world.nav, pt = id => { const f = nav.fix[id]; return f ? G.world.proj(f[0], f[1]) : null; };
    const common = iap.routes.find(r => !r.t)?.legs || [];
    let best = null;
    for (const r of [...iap.routes.filter(r => r.t), { t: '', legs: [] }]) {
        const legs = [...r.legs, ...common.filter((l, i) => i || l[0] !== r.legs[r.legs.length - 1]?.[0])];
        const first = legs.find(l => pt(l[0]));
        const q = first && pt(first[0]);
        if (!q) continue;
        const d = Math.hypot(q.x - ac.x, q.y - ac.y);
        if (d < 25 && (!best || d < best.d)) best = { d, legs, name: iap.name };
    }
    if (!best) return null;
    const out = [];
    for (const l of best.legs) {
        const q = pt(l[0]);
        if (!q || /^RW/.test(l[0])) continue;
        out.push({ name: l[0], x: q.x, y: q.y, alt: l[1], desc: l[2], spd: l[3], pt: l[4], role: l[5] });
        if (l[5] === 'F') break;                       // to the final approach fix; final is flown as an approach from there
    }
    return out.length ? { legs: out, name: best.name } : null;
}

/** Onto the final approach course from wherever the aircraft is, as a pattern or a procedure ends there. */
function joinFinal(ac, e, type) {
    const g = finalGeom(ac, e);
    ac.appr = { end: e, type, loc: false, gs: false, est: false, along: g.along, xt: g.xt, spd: ac.spdHold?.sp ?? null, spdUntil: ac.spdHold?.until };
    ac.spdHold = null;
    ac.tHdg = norm(e.course - Math.sign(g.xt || 1) * Math.min(30, Math.max(10, Math.abs(g.xt) * 60)));
}

/** The pattern a visual approach flies from here: straight in when lined up, otherwise a base from its side. */
function visualPattern(ac, e) {
    const g = finalGeom(ac, e);
    const kind = g.along > 8 && Math.abs(g.xt) < g.along * Math.tan(25 * D2R) ? 'S' : g.xt > 0 ? 'BR' : 'BL';
    return { end: e, kind, type: 'VIS', pts: patternPoints(ac, kind, e) };
}

/**
 * The route an aircraft filed, as fixes:
 * - an arrival: its STAR (or its entry fix), then its runway's approach fix and the runway;
 * - a departure: its runway, its SID, then its exit.
 * text reads like a flight plan.
 */
function filedPlan(ac) {
    const pts = [], add = (name, x, y) => { if (name && x != null && !pts.some(p => p.name === name)) pts.push({ name, x, y }); };
    if (ac.kind === 'arr') {
        const e = ac.expect, af = e && G.world.fixes.find(f => f.kind === 'app' && f.end === e);
        if (ac.starLegs) for (const l of ac.starLegs) add(l.name, l.x, l.y);
        else if (ac.entry) add(ac.entry.name, ac.entry.x, ac.entry.y);
        if (af) add(af.name, af.x, af.y);
        if (e) add('RW' + e.id, e.thr.x, e.thr.y);
        return { pts, text: [ac.entry?.name, ac.star, af?.name, `${G.world.icao}${e ? '/' + e.id : ''}`].filter(Boolean).join(' ') };
    }
    const sid = ac.rwy && sidFor(ac.gate, ac.rwy);
    if (ac.rwy) add('RW' + ac.rwy.id, ac.rwy.thr.x, ac.rwy.thr.y);
    if (sid) for (const l of sid.legs) add(l.name, l.x, l.y);
    if (ac.gate) add(ac.gate.name, ac.gate.x, ac.gate.y);
    return { pts, text: `${G.world.icao}${ac.rwy ? '/' + ac.rwy.id : ''} ${sid ? sid.id : 'DCT'} ${ac.gate?.name || ''}`.trim() };
}

/** What's left of the filed route from where the aircraft is now. */
function filedAhead(ac) {
    const { pts } = filedPlan(ac);
    if (!pts.length) return [];
    let k = 0;
    pts.forEach((p, i) => { if (Math.hypot(p.x - ac.x, p.y - ac.y) < Math.hypot(pts[k].x - ac.x, pts[k].y - ac.y)) k = i; });
    // Already past the nearest fix (closer to the next one than it is to that fix): start from the next.
    if (k < pts.length - 1 && Math.hypot(pts[k + 1].x - ac.x, pts[k + 1].y - ac.y) < Math.hypot(pts[k + 1].x - pts[k].x, pts[k + 1].y - pts[k].y)) k++;
    return pts.slice(k);
}

/** The SID a departure from this runway flies to this gate, if any (runway transitions: RW31L, or RW31B for both). */
function sidFor(gate, rwy) {
    const list = gate?.sids || [];
    const base = rwy.id.replace(/[LRC]$/, '');
    const fits = [s => s.rwy === rwy.id, s => s.rwy === base + 'B' || s.rwy === base, s => !s.rwy];
    const rec = new Set(G?.atisCfg?.sids || []);
    for (const f of fits) { const r = list.find(s => f(s) && rec.has(s.id)); if (r) return r; }     // the one the ATIS recommends, when it serves this exit
    for (const f of fits) { const r = list.find(f); if (r) return r; }
    return null;
}

/* ---- ATIS: the runways, the approach in use, recommended procedures and remarks, broadcast as a lettered information ---- */

const ATIS_KEEP = ['apps', 'stars', 'sids', 'straight', 'remarks', 'notams'];
function atisDefault(icao) {
    const saved = store.get('atis.' + icao, {});
    if (typeof saved.app === 'string' && !saved.apps) saved.apps = [saved.app];          // from when the ATIS named one approach
    return { mode: 'auto', arr: [], dep: [], apps: ['ILS'], stars: [], sids: [], straight: 0, remarks: [], notams: [], ...Object.fromEntries(Object.entries(saved).filter(([k]) => ATIS_KEEP.includes(k))) };
}
/** The approach a runway gets under the ATIS: the first instrument approach it has of those in use, else the visual if that's in use, else the ILS. */
const appFor = (e, cfg = G.atisCfg) => cfg.apps.find(t => t !== 'VIS' && hasApproach(e, t)) || (cfg.apps.includes('VIS') ? 'VIS' : 'ILS');
const appWord = t => (t === 'VIS' ? 'visual' : APP_NAME[t]);
/** Wind along a runway: positive headwind, negative tailwind. */
const headwind = e => Math.round(G.wind.spd * Math.cos(diff(e.course, G.wind.dir) * D2R));
const zuluText = () => { const z = new Date(G.zulu0 + G.t * 1000); return String(z.getUTCHours()).padStart(2, '0') + String(z.getUTCMinutes()).padStart(2, '0') + 'Z'; };

/** The runways a manual ATIS names, or null when it doesn't name both. */
function activeFrom(cfg) {
    const ends = ids => ids.map(id => G.world.ends.find(e => e.id === id)).filter(Boolean);
    const arr = ends(cfg.arr), dep = ends(cfg.dep);
    return arr.length && dep.length ? { arr, dep, key: arr.map(e => e.id).join(' ') + '/' + dep.map(e => e.id).join(' ') } : null;
}

/** Infinite Flight's ATIS remarks and NOTAMs, with how each is read out. */
const REMARKS = [
    ['noInter', 'No intersection dept.', 'no intersection departures'],
    ['interOk', 'Intersection dept OK', 'intersection departures available'],
    ['noPattern', 'No pattern work', 'no pattern work'],
    ['flow', 'Flow control', 'flow control in effect'],
    ['longTaxi', 'Long taxi', 'expect long taxi times'],
    ['gateHold', 'Gate hold', 'gate hold procedures in effect'],
    ['rolling', 'Rolling dpt', 'rolling departures'],
    ['fpl', 'FPL required', 'flight plan required'],
    ['noLight', 'No light aircraft', 'no light aircraft'],
];
const NOTAMS = [
    ['event', 'Event', 'event in progress, expect delays'],
    ['size', 'Size restrictions', 'aircraft size restrictions in effect'],
    ['severe', 'Severe weather', 'severe weather in the area'],
    ['lowVis', 'Low visibility', 'low visibility procedures in effect'],
];
const STRAIGHT_STEPS = [0, 1000, 3000, 5000];
const hasRemark = k => !!G?.atisCfg.remarks.includes(k);

/** The weather as a METAR line, as the top of Infinite Flight's ATIS page shows it. */
function metarText() {
    const z = new Date(G.zulu0 + G.t * 1000), t = n => (n < 0 ? 'M' : '') + String(Math.abs(n)).padStart(2, '0');
    const m = G.met, sky = m.ceil == null ? 'SKC' : 'OVC' + String(Math.round(m.ceil / 100)).padStart(3, '0');
    return [G.world.icao, String(z.getUTCDate()).padStart(2, '0') + zuluText(), hdg3(G.wind.dir) + String(G.wind.spd).padStart(2, '0') + (m.gust ? 'G' + m.gust : '') + 'KT',
        (VIS[m.vis] || m.vis) + 'SM', m.wx, sky, t(G.temp) + '/' + t(G.dew), 'A' + G.altim].filter(Boolean).join(' ');
}

/** The ATIS as read out: a draft (cfg, the letter it will carry, its runways) or what's current. */
function atisText(cfg = G.atisCfg, letter = G.atis, act = G.active) {
    const list = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0];
    const L = PHONETIC[letter], ifr = G.rules.id === 'ifatc';
    const apps = cfg.apps.map(appWord), onlyIls = cfg.apps.length === 1 && cfg.apps[0] === 'ILS';
    const remarks = [...REMARKS.filter(r => cfg.remarks.includes(r[0])).map(r => r[2]), ...(cfg.straight ? [`straight out departures${ifr ? '' : ` to ${cfg.straight} feet`}`] : [])];
    const notams = NOTAMS.filter(n => cfg.notams.includes(n[0])).map(n => n[2]);
    const procs = (cfg.stars.length ? ` Arrivals expect the ${list(cfg.stars)} arrival.` : '') + (cfg.sids.length ? ` Departures expect the ${list(cfg.sids)} departure.` : '');
    if (ifr) {
        // Infinite Flight's own wording and order.
        const apt = (G.airport.name || G.world.icao).replace(/\s*\b(International|Intl|Regional|Municipal)?\s*Airport\b.*$/i, '').trim() || G.world.icao;
        return `${apt} airport, ATIS information ${L.toUpperCase()}, time ${zuluText().slice(0, 4)} ZULU, Wind ${hdg3(G.wind.dir)} at ${G.wind.spd}${G.met.gust ? ' gusting ' + G.met.gust : ''}, Visibility ${VIS[G.met.vis] || G.met.vis}, Temperature ${G.temp}, Dew Point ${G.dew}, Altimeter ${G.altim}.`
            + (remarks.length ? ` Remarks, ${remarks.join(', ')}.` : '')
            + ` Landing Runways ${list(act.arr.map(e => e.id))}, Departing Runways ${list(act.dep.map(e => e.id))}.`
            + (onlyIls ? '' : ` Expect ${list(apps)} approaches.`) + procs
            + (notams.length ? ` Notams, ${notams.join(', ')}.` : '')
            + ` Advise on initial contact, you have information ${L.toUpperCase()}.`;
    }
    return `${G.world.icao} information ${L}, ${zuluText()}. Wind ${hdg3(G.wind.dir)} at ${G.wind.spd}${G.met.gust ? ' gusting ' + G.met.gust : ''}${G.opts.weather ? ', ' + metText(G.met) : ''}, temperature ${G.temp}, dew point ${G.dew}, altimeter ${G.altim}. `
        + `${cap(list(apps))} approach${apps.length > 1 || act.arr.length > 1 ? 'es' : ''} in use, landing runway ${list(act.arr.map(e => e.id))}, departing runway ${list(act.dep.map(e => e.id))}.`
        + procs
        + (remarks.length ? ` Remarks: ${remarks.join(', ')}.` : '')
        + (notams.length ? ` NOTAMs: ${notams.join(', ')}.` : '')
        + ` Advise on initial contact you have information ${L}.`;
}

/** What's wrong with an ATIS before it goes out: tailwinds (IFATC 2.1.2) and runways without the approach in use. */
function atisWarnings(cfg) {
    const act = cfg.mode === 'manual' ? activeFrom(cfg) : computeActive(G.world, G.wind), out = [];
    if (!act) return ['Pick at least one landing and one departure runway.'];
    for (const e of new Set([...act.arr, ...act.dep])) if (headwind(e) < -10) out.push(`Runway ${e.id} has a ${-headwind(e)} kt tailwind.`);
    for (const e of act.arr) if (!cfg.apps.some(t => hasApproach(e, t))) out.push(`Runway ${e.id} has none of these approaches (ILS instead).`);
    if (cfg.apps.includes('VIS') && !visualWx()) out.push(`The weather is below visual minimums (${metText(G.met)}).`);
    return out;
}

/** Put a new information out: new letter, the runways it names, and everyone told. */
function broadcastAtis(cfg) {
    G.atisCfg = cfg;
    store.set('atis.' + G.world.icao, Object.fromEntries(ATIS_KEEP.map(k => [k, cfg[k]])));
    const prev = G.active.key;
    G.active = (cfg.mode === 'manual' && activeFrom(cfg)) || computeActive(G.world, G.wind);
    G.atis = (G.atis + 1) % 26;
    G.atisAt = G.t;
    sys(atisText(), 'good');
    if (G.active.key !== prev) runwayChange();
    renderLayers(); renderAtis();
}

let atisDraft = null;
/** Infinite Flight's ATIS page, over the scope: runways, remarks, NOTAMs (and the approach and procedures), then publish. */
function renderAtis() {
    const el = $('#atis');
    if (!el || el.hidden || !G) return;
    const d = atisDraft || (atisDraft = structuredClone(G.atisCfg)), nav = G.world.nav, ifr = G.rules.id === 'ifatc';
    const tile = (attrs, html, on, sub = '', cls = '') => `<button type="button" class="ia-t${on ? ' on' : ''}${cls ? ' ' + cls : ''}" ${attrs}><span>${html}</span>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</button>`;
    const act = d.mode === 'manual' ? activeFrom(d) : computeActive(G.world, G.wind);
    const ends = [...G.world.ends].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    const isOn = (k, e) => (d.mode === 'manual' ? d[k].includes(e.id) : act[k].includes(e));
    // Red for a tailwind, green for a headwind, as Infinite Flight colours them.
    const rwy = ends.map(e => { const h = headwind(e), cls = 'rw ' + (h < 0 ? 'tail' : 'head'), tip = `title="${h < 0 ? 'tailwind ' + -h : 'headwind ' + h} kt"`;
        return tile(`data-rw="dep" data-v="${e.id}" ${tip}`, `${e.id}<br>DEP`, isOn('dep', e), '', cls) + tile(`data-rw="arr" data-v="${e.id}" ${tip}`, `${e.id}<br>LDG`, isOn('arr', e), '', cls); }).join('');
    const rem = REMARKS.map(([k, l]) => tile(`data-rm="${k}"`, escapeHtml(l.toUpperCase()), d.remarks.includes(k))).join('')
        + tile('data-straight', 'STRAIGHT OUT DEPT', d.straight > 0, d.straight ? `to ${d.straight.toLocaleString('en-US')} ft` : '');
    const notams = NOTAMS.map(([k, l]) => tile(`data-nt="${k}"`, escapeHtml(l.toUpperCase()), d.notams.includes(k))).join('');
    const apps = [['ILS', 'ILS'], ...(ifr ? [] : [['LOC', 'LOC']]), ['RNAV', ifr ? 'GPS' : 'RNAV'], ['VIS', 'VISUAL']].map(([v, l]) => tile(`data-app="${v}"`, l, d.apps.includes(v), '', 'sm')).join('');
    // Only procedures traffic here can fly: arrivals that enter the scope far enough out, departures that reach an exit.
    const flown = (kind, key) => [...new Set(G.world.fixes.filter(f => f.kind === kind).flatMap(f => (f[key] || []).map(p => p.id)))].sort();
    const via = (kind, key, id) => G.world.fixes.filter(f => f.kind === kind && f[key]?.some(p => p.id === id)).map(f => f.name).join(' ');
    const stars = nav ? flown('arr', 'stars').map(id => tile(`data-proc="stars" data-v="${escapeHtml(id)}"`, escapeHtml(id), d.stars.includes(id), via('arr', 'stars', id), 'sm')).join('') : '';
    const sids = nav ? flown('dep', 'sids').map(id => tile(`data-proc="sids" data-v="${escapeHtml(id)}"`, escapeHtml(id), d.sids.includes(id), '', 'sm')).join('') : '';
    const warn = atisWarnings(d);
    const ago = Math.round((G.t - (G.atisAt ?? 0)) / 60);
    const next = (G.atis + 1) % 26;
    el.innerHTML = `
        <div class="ia-top"><span class="ia-metar">${escapeHtml(metarText())}</span><span>Updated ${ago < 1 ? 'just now' : ago === 1 ? 'a minute ago' : ago + ' minutes ago'} - Current Time: ${zuluText()}</span></div>
        <div class="ia-bar"><span>WIND: ${hdg3(G.wind.dir)}°(M) at ${G.wind.spd}${G.met.gust ? ' gusting ' + G.met.gust : ''}</span><span class="sp"></span>
            <span class="ia-lbl">ATIS INFORMATION</span><span class="ia-letter">${PHONETIC[next].toUpperCase()}</span>
            <button type="button" class="ia-pub" data-atis-go ${act ? '' : 'disabled'}>PUBLISH</button><button type="button" class="ia-x" data-close aria-label="Close">✕</button></div>
        <div class="ia-cols">
            <section class="ia-col ia-rwcol"><div class="ia-h">RUNWAYS <button type="button" class="ia-auto${d.mode === 'auto' ? ' on' : ''}" data-auto title="Pick the runways from the wind">BY WIND</button></div><div class="ia-grid ia-rws">${rwy}</div></section>
            <section class="ia-col"><div class="ia-h">REMARKS</div><div class="ia-grid">${rem}</div>
                ${warn.length ? `<p class="ia-warn">${warn.map(escapeHtml).join('<br>')}</p>` : ''}</section>
            <section class="ia-col"><div class="ia-h">NOTAMS</div><div class="ia-grid">${notams}</div>
                <div class="ia-h">APPROACHES</div><div class="ia-grid">${apps}</div>
                ${stars ? `<div class="ia-h">ARRIVALS</div><div class="ia-grid">${stars}</div>` : ''}
                ${sids ? `<div class="ia-h">DEPARTURES</div><div class="ia-grid">${sids}</div>` : ''}</section>
        </div>
        <div class="ia-text">${escapeHtml(act ? atisText(d, next, act) : 'Pick at least one landing and one departure runway.')}</div>`;
}

function openAtis(open) {
    const el = $('#atis');
    el.hidden = !open;
    $('#game').classList.toggle('atis-open', open);
    atisDraft = null;
    if (open) railView = 'ATIS'; else if (railView === 'ATIS') railView = null;
    renderAtis(); renderRail();
}

function bindAtis() {
    const el = $('#atis');
    el.addEventListener('click', e => {
        if (!G) return;
        if (e.target.closest('[data-close]')) { openAtis(false); return; }
        const b = e.target.closest('button');
        if (!b || !atisDraft) return;
        const d = atisDraft, toggle = (k, v) => { d[k] = d[k].includes(v) ? d[k].filter(x => x !== v) : [...d[k], v]; };
        if (b.hasAttribute('data-atis-go')) { broadcastAtis(d); atisDraft = null; renderAtis(); return; }
        if (b.hasAttribute('data-auto')) d.mode = d.mode === 'auto' ? 'manual' : 'auto';
        else if (b.dataset.rw) {
            // Touching a runway takes them off the wind, starting from what's in use.
            if (d.mode === 'auto') Object.assign(d, { mode: 'manual', arr: G.active.arr.map(e => e.id), dep: G.active.dep.map(e => e.id) });
            toggle(b.dataset.rw, b.dataset.v);
        } else if (b.dataset.rm) {
            toggle('remarks', b.dataset.rm);
            const other = { noInter: 'interOk', interOk: 'noInter' }[b.dataset.rm];
            if (other) d.remarks = d.remarks.filter(x => x !== other);
        } else if (b.hasAttribute('data-straight')) d.straight = STRAIGHT_STEPS[(STRAIGHT_STEPS.indexOf(d.straight) + 1) % STRAIGHT_STEPS.length];
        else if (b.dataset.nt) toggle('notams', b.dataset.nt);
        else if (b.dataset.app) { if (!(d.apps.length === 1 && d.apps[0] === b.dataset.app)) toggle('apps', b.dataset.app); }   // any number, never none
        else if (b.dataset.proc) toggle(b.dataset.proc, b.dataset.v);
        else return;
        renderAtis();
    });
}

/* ---- Frequencies down the left, as in Infinite Flight: the real ones (OurAirports), tap one to see its traffic ---- */

let freqData = null;
async function loadFreqs(icao) {
    try {
        if (!freqData) {
            const r = await Promise.race([fetch('/approach-freqs.json'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
            freqData = r.ok ? await r.json() : {};
        }
    } catch { freqData = {}; }
    return freqData[icao] || {};
}
const FAC_WORD = { APP: 'Approach', DEP: 'Departure', TWR: 'Tower', GND: 'Ground', ATIS: 'ATIS' };
/** The facility as pilots call it: "Kennedy Tower", "New York Approach", or the field's code and the position. */
const facName = k => G?.freqs?.[k]?.[1] || `${G.world.icao} ${FAC_WORD[k]}`;
const mhz = f => (Math.round(f * 1000) % 10 ? f.toFixed(3) : f.toFixed(2));
const freqLabel = k => { const f = G.freqs?.[k]; return k === 'ATIS' ? `${G.world.icao} ATIS${f ? ` (${mhz(f[0])})` : ''}` : `${facName(k)}${f ? ` (${mhz(f[0])})` : ''}`; };

let railView = null;                 // 'APP' | 'DEP' | 'TWR' | 'GND': the strip list shows only that frequency; 'ATIS': the ATIS page
let railHtml = '';
const onFreq = {
    APP: a => a.freq === 'APP' && (a.kind === 'arr' || !G.freqs?.DEP),
    DEP: a => a.freq === 'APP' && a.kind === 'dep',
    TWR: a => a.freq === 'TWR',
    GND: a => a.freq === 'GND',
};
function railRows() {
    const rows = ['STATUS'];
    if (G.ground) rows.push('GND');
    rows.push('TWR');
    if (!noRadar()) { rows.push('APP'); if (G.freqs?.DEP) rows.push('DEP'); }
    rows.push('ATIS', 'BCAST');
    return rows;
}
function renderRail() {
    const el = $('#freq-rail');
    if (!el || !G) return;
    const html = railRows().map(k => {
        if (k === 'STATUS') return `<button type="button" class="rail-i${hudMin ? '' : ' on'}" data-rail="STATUS">Status</button>`;
        if (k === 'ATIS') return `<button type="button" class="rail-i atis${railView === 'ATIS' ? ' on' : ''}" data-rail="ATIS">${escapeHtml(freqLabel('ATIS'))}</button>`;
        if (k === 'BCAST') return `<button type="button" class="rail-i${broadcastOpen ? ' on' : ''}" data-rail="BCAST">Broadcast</button>`;
        const pos = k === 'DEP' ? 'APP' : k, yours = G.positions.has(pos);
        const n = yours ? G.aircraft.filter(a => onFreq[k](a) && wantsYou(a)).length : 0;
        return `<button type="button" class="rail-i${railView === k ? ' on' : ''}${yours ? '' : ' sys'}" data-rail="${k}" title="${yours ? 'Your frequency' : 'The system is working this'}">${escapeHtml(freqLabel(k))}${n ? `<b>${n}</b>` : ''}</button>`;
    }).join('');
    if (html !== railHtml) { el.innerHTML = html; railHtml = html; }
}
function bindRail() {
    $('#freq-rail').addEventListener('click', e => {
        const b = e.target.closest('[data-rail]');
        if (!b || !G) return;
        const k = b.dataset.rail;
        if (k === 'ATIS') { openAtis(railView !== 'ATIS'); return; }
        if (k === 'BCAST') { const open = !broadcastOpen; select(null); broadcastOpen = open; menuKey = ''; renderCard(true); renderRail(); return; }
        if (k === 'STATUS') { hudMin = !hudMin; store.set('hudMin', hudMin); renderHud(); renderRail(); return; }
        if (railView === 'ATIS') { $('#atis').hidden = true; $('#game').classList.remove('atis-open'); }
        railView = railView === k ? null : k;
        renderStrips(); renderRail();
    });
}

/**
 * Active runways for a wind, the way a busy field runs them: one flow (the
 * best-into-wind runway and its parallels, no crossing runways at once).
 * The outermost parallel on each side lands and the ones inside it depart,
 * as at ATL, LAX or DEN; a lone runway (or one close pair) does both.
 * Under Infinite Flight rules every runway in the flow lands and departs
 * (IFATC 3.6.1: Radar uses ALL the runways).
 */
function computeActive(world, wind, allRunways = G?.rules.id === 'ifatc') {
    const head = e => Math.cos(diff(e.course, wind.dir) * D2R);
    const best = world.ends.reduce((b, e) => (head(e) > head(b) + 0.02 || (Math.abs(head(e) - head(b)) <= 0.02 && e.len > b.len) ? e : b));
    const family = world.ends.filter(e => Math.abs(diff(e.course, best.course)) < 10 && e.len >= 1.2);
    if (!family.includes(best)) family.push(best);
    // Order across the field, left to right looking along the flow.
    const c = best.course * D2R;
    const lateral = e => (e.thr.x - best.thr.x) * Math.cos(c) - (e.thr.y - best.thr.y) * Math.sin(c);
    family.sort((a, b) => lateral(a) - lateral(b));
    // Runways within 2,500 ft are one for spacing; count distinct lanes.
    const lanes = [];
    for (const e of family) { const l = lanes.find(l => l.some(o => sameRunwayish(o, e))); if (l) l.push(e); else lanes.push([e]); }
    let arr, dep;
    if (allRunways) {
        arr = [...family];
        dep = [...family];
    } else if (lanes.length >= 2) {
        // The outermost runway on each side lands; everything inside it departs.
        arr = [lanes[0][0], lanes[lanes.length - 1][lanes[lanes.length - 1].length - 1]];
        dep = family.filter(e => !arr.includes(e));
        if (!dep.length) dep = [...arr];
    } else {
        arr = [[...lanes[0]].sort((a, b) => b.len - a.len)[0]];
        dep = [...lanes[0]];
    }
    dep = dep.sort((a, b) => b.len - a.len).slice(0, allRunways ? undefined : 3);
    return { arr, dep, key: arr.map(e => e.id).join(' ') + '/' + dep.map(e => e.id).join(' ') };
}

/**
 * Distance in feet between the centerlines of two runway ends that point the
 * same way, or null when they aren't parallel (crossing or opposite).
 */
function parallelFt(a, b) {
    if (a === b) return 0;
    if (Math.abs(diff(a.course, b.course)) > 10) return null;
    const c = a.course * D2R;
    return Math.abs((b.thr.x - a.thr.x) * Math.cos(c) - (b.thr.y - a.thr.y) * Math.sin(c)) * 6076;
}
/** Same runway, or a parallel close enough (under 2,500 ft) to count as one for wake and in-trail rules. */
function sameRunwayish(a, b) {
    if (a.phys === b.phys) return true;
    const ft = parallelFt(a, b);
    return ft != null && ft < 2500;
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

let G = null;
let nextId = 1;

/** The three positions. Each aircraft is on exactly one frequency at a time. */
const FREQ_NAME = { APP: 'Approach', TWR: 'Tower', GND: 'Ground' };
const mine = ac => !!G && G.positions.has(ac.freq);

function newGame(airport, level, opts, nav) {
    const world = buildWorld(airport, nav);
    const wind = { dir: Math.round(rand(0, 36)) * 10 || 360, spd: Math.round(rand(5, opts.weather ? 22 : 18)) };
    G = {
        world, wind, level, opts, airport, rules: RULESETS[opts.rules] || RULESETS.faa,
        positions: new Set(opts.positions),
        ground: null, surfaceMap: null, aiT: 0, aiSlots: {}, lastDepAt: new Map(), groundConf: new Set(),
        dem: null, mva: null, relief: {},
        tiles: new TerrainTiles(airport.lat, airport.lon, world.elev),
        wx: [], met: null, nextCell: 0,
        active: computeActive(world, wind, opts.rules === 'ifatc'),
        aircraft: [],
        t: 0,
        score: 0,
        stats: { landed: 0, departed: 0, incidents: 0, goArounds: 0, violations: 0, lowAlt: 0, crashes: 0, turbulence: 0, parked: 0, incursions: 0 },
        conf: new Map(),
        occupied: new Map(),       // physical runway index -> sim time it is clear again
        depWake: new Map(),        // physical runway index -> last Super/Heavy takeoff { t, cs, wake }
        atis: Math.floor(rand(0, 26)),
        altim: Math.round(rand(2972, 3024)),
        nextSpawn: 45,
        nextWind: rand(900, 1500),
        speed: 1,
        selected: null,
        depRR: 0,
        floaters: [],
        zulu0: Date.now(),
        over: false,
    };
    G.met = makeMet();
    G.atisCfg = atisDefault(world.icao);
    G.temp = Math.round(rand(2, 29));
    G.dew = G.temp - (G.met.ceil != null && G.met.ceil < 1000 ? 1 : Math.round(rand(2, 10)));
    G.atisAt = 0;
    if (opts.weather && G.rules.storms) for (let i = 0; i < 4; i++) spawnCell(true);
}

function airborne(a) { return a.state === 'air'; }
function agl(a) { return a.alt - G.world.elev; }

/** A US civil registration for a light aircraft: N543AB, "November five four three alpha bravo". */
function makeGACallsign(types) {
    const used = new Set(G.aircraft.map(a => a.cs)), L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (let i = 0; i < 30; i++) {
        const num = String(Math.floor(rand(100, 999))), suf = L[Math.floor(Math.random() * L.length)] + L[Math.floor(Math.random() * L.length)];
        const cs = `N${num}${suf}`;
        if (used.has(cs)) continue;
        const spoken = 'November ' + num.split('').map(d => DIGIT_WORDS[d]).join(' ') + ' ' + suf.split('').map(c => PHONETIC[c.charCodeAt(0) - 65]).join(' ');
        return { cs, type: pick(types), radio: cs, spoken };
    }
    return null;
}

function makeCallsign() {
    const used = new Set(G.aircraft.map(a => a.cs));
    const total = AIRLINES.reduce((s, a) => s + a.w, 0);
    for (let tries = 0; tries < 50; tries++) {
        let r = Math.random() * total, al = AIRLINES[0];
        for (const a of AIRLINES) { r -= a.w; if (r <= 0) { al = a; break; } }
        const num = al.regional ? Math.floor(rand(3000, 6000)) : al.intl ? Math.floor(rand(1, 200)) : Math.floor(rand(1, 2999));
        const cs = al.icao + num;
        if (used.has(cs)) continue;
        const type = pick(al.types);
        const wake = perf(type).wake;
        // Heavy and super aircraft say so in every call.
        const suffix = wake === 'S' ? ' super' : wake === 'H' ? ' heavy' : '';
        const digits = String(num).split('').map(d => DIGIT_WORDS[d]).join(' ');
        return {
            cs, type,
            radio: `${al.radio} ${num}${suffix}`,
            spoken: `${al.radio} ${digits}${suffix}`,
        };
    }
    return null;
}

/** An arrival checking in at an entry fix, or (`dist`) already that far inbound from one. */
function spawnArrival(dist) {
    const id = makeCallsign();
    if (!id) return false;
    const rec = new Set(G.atisCfg.stars), filed = f => f.stars?.some(s => rec.has(s.id));
    const entries = G.world.fixes.filter(f => f.kind === 'arr').sort(() => Math.random() - 0.5);
    if (rec.size && Math.random() < 0.75) entries.sort((a, b) => filed(b) - filed(a));
    for (const f of entries) {
        const r = dist || SCOPE_NM - 0.5;
        const b = (f.bearing + (dist ? rand(-20, 20) : 0)) * D2R;
        const x = Math.sin(b) * r, y = Math.cos(b) * r;
        let alt = Math.round((G.world.elev + (dist ? clamp(dist * 280, 4000, 12000) : rand(8000, 12500))) / 1000) * 1000;
        if (terrainOn()) alt = Math.max(alt, Math.ceil((mvaAt(G.mva, x, y) + 1000) / 1000) * 1000);
        const crowded = G.aircraft.some(a => airborne(a) && Math.hypot(a.x - x, a.y - y) < 7 && Math.abs(a.alt - alt) < 1500);
        if (crowded) continue;
        const hdg = norm(brg(-x, -y) + rand(-12, 12));
        const spd = alt < 10000 ? 250 : 280;
        const ac = {
            id: nextId++, ...id, kind: 'arr', state: 'air', perf: perf(id.type), entry: f,
            x, y, alt, hdg, spd, tHdg: hdg, tAlt: alt, tSpd: spd, turn: null,
            trail: [], trailT: 0, born: G.t, expect: pick(G.active.arr), freq: 'APP',
        };
        // On a published arrival: fly it, descending via, from where it enters the scope.
        if (f.stars?.length && !dist) {
            const st = pick(f.stars.filter(s => rec.has(s.id)).length ? f.stars.filter(s => rec.has(s.id)) : f.stars);
            const first = st.legs.find(l => l.alt != null);
            if (first && first.desc !== '-') { ac.alt = Math.max(ac.alt, first.alt); ac.tAlt = ac.alt; }
            ac.via = { kind: 'STAR', id: st.id, legs: st.legs, i: 0, vert: true };
            ac.star = st.id;
            ac.starLegs = st.legs;
        }
        G.aircraft.push(ac);
        maybeEmergency(ac);
        if (noRadar()) {
            // No Approach: straight to Tower, inbound on the ILS when lined up with a final, otherwise for landing.
            const onIls = G.active.arr.find(e => { const g = finalGeom(ac, e); return g.along > 6 && Math.abs(g.xt) < g.along * Math.tan(25 * D2R); });
            if (onIls) ac.expect = onIls;
            Object.assign(ac, { freq: 'TWR', tAlt: Math.max(G.world.minAlt, Math.round((G.world.elev + 4000) / 1000) * 1000), tSpd: 230, tHdg: brg(-x, -y) });
            const dir = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(norm(brg(x, y)) / 45) % 8];
            pilot(ac, `${facName('TWR')}, ${ac.radio}, ${fmtAlt(alt)}, ${onIls ? `inbound on the ILS runway ${onIls.id}` : `inbound for landing, ${Math.round(r)} miles ${dir}`}, information ${PHONETIC[G.atis]}.`);
            return true;
        }
        // As in Infinite Flight: it checks in asking for an approach, from its flight plan, and you answer.
        const type = appFor(ac.expect);
        ac.request = { kind: type, end: ac.expect, say: `the ${appWord(type)}`, tag: APP_TAG[type], checkin: true };
        pilot(ac, `${facName('APP')}, ${ac.radio}, ${fmtAlt(ac.alt)}${ac.via ? `, descending via the ${ac.via.id} arrival` : ''}, information ${PHONETIC[G.atis]}, requesting ${ac.via ? '' : 'radar vectors for '}the ${appWord(type)} approach runway ${ac.expect.id}.`);
        return true;
    }
    return false;
}

/** The traffic already on frequency when the shift opens: arrivals spread inbound, departures at gates or the runway. */
function seedTraffic(n) {
    for (let i = 0, misses = 0; i < n && misses < 30; ) {
        const wantDep = Math.random() < 0.4;
        const ok = wantDep ? spawnDeparture() || spawnArrival(rand(12, SCOPE_NM - 1)) : spawnArrival(rand(12, SCOPE_NM - 1)) || spawnDeparture();
        if (ok) i++; else misses++;
    }
}

/* ------------------------------------------------------------------ */
/* Emergencies: rare, and the player can turn them off                 */
/* ------------------------------------------------------------------ */

const EMERG_RATE = 1 / 45;           // per flight
const EMERGENCIES = [
    { kind: 'engine', mayday: true, text: 'engine failure', spd: 210 },
    { kind: 'medical', mayday: false, text: 'medical emergency on board' },
    { kind: 'fuel', mayday: true, text: 'minimum fuel, declaring an emergency' },
    { kind: 'hydraulic', mayday: false, text: 'hydraulic failure', spd: 220 },
    { kind: 'smoke', mayday: true, text: 'smoke in the cabin' },
    { kind: 'bird', mayday: false, text: 'bird strike, possible engine damage', spd: 230 },
];

function maybeEmergency(ac) {
    if (G.opts.emerg && G.rules.emergencies && Math.random() < EMERG_RATE) ac.emergPending = pick(EMERGENCIES);
}

/** Declares when the moment is right: an arrival well out, a departure climbing out. */
function emergencyCheck() {
    for (const ac of G.aircraft) {
        const e = ac.emergPending;
        if (!e || ac.state !== 'air' || ac.gone) continue;
        const dist = Math.hypot(ac.x, ac.y);
        const ready = ac.kind === 'arr' ? G.t - ac.born > 45 && dist > 10 && !ac.appr?.loc : agl(ac) > 1500 && dist < 25;
        if (ready) declareEmergency(ac, e);
    }
}

function declareEmergency(ac, e) {
    ac.emergPending = null;
    ac.emerg = { ...e, t: G.t };
    const souls = Math.round(ac.perf.wake === 'H' || ac.perf.wake === 'S' ? rand(220, 380) : rand(90, 190));
    const call = e.mayday ? 'Mayday, mayday, mayday' : 'Pan-pan, pan-pan, pan-pan';
    if (ac.kind === 'dep') {
        // Back to land: from here on it's an arrival, to the nearest landing runway.
        ac.kind = 'arr'; ac.returning = true;
        ac.direct = null; ac.aiPlan = null;
        ac.expect = G.active.arr.slice().sort((a, b) => Math.hypot(a.thr.x - ac.x, a.thr.y - ac.y) - Math.hypot(b.thr.x - ac.x, b.thr.y - ac.y))[0];
        if (ac.freq === 'TWR') ac.freq = 'APP';
    }
    ac.holdAt = null; ac.orbit = null;
    if (ac.aiPlan) ac.aiPlan = null;
    if (e.spd) ac.tSpd = Math.min(ac.tSpd, e.spd);
    pilot(ac, `${call}, ${ac.radio}, ${e.text}, ${ac.returning ? 'request immediate return' : 'request priority handling'}, ${souls} souls on board.`);
    toast(`${ac.cs} ${e.mayday ? 'MAYDAY' : 'PAN-PAN'}: ${e.text}`, 'bad', 8000);
}

function nextDepRunway() {
    const dep = G.active.dep;
    return dep[(G.depRR++) % dep.length];
}

function freeStand() {
    const taken = new Set(G.aircraft.map(a => a.stand).filter(Boolean));
    const free = G.ground.gates.filter(g => !taken.has(g));
    return free.length ? pick(free) : null;
}

function spawnDeparture(patternWork) {
    const waiting = G.aircraft.filter(a => a.state === 'wait');
    let rwy = nextDepRunway();
    if (!G.ground && waiting.filter(a => a.rwy === rwy).length >= 3) return false;
    const stand = G.ground ? freeStand() : null;
    if (G.ground && (!stand || G.aircraft.filter(a => a.kind === 'dep' && a.state !== 'air').length >= TRAFFIC[G.level].gnd)) return false;
    // Pattern work: mostly light aircraft, now and then a jet doing circuits.
    const id = patternWork ? makeGACallsign(Math.random() < 0.7 ? [...PROPS] : ['A320', 'B738', 'E175', 'CRJ7']) : makeCallsign();
    if (!id) return false;
    const gates = G.world.fixes.filter(f => f.kind === 'dep'), recSid = new Set(G.atisCfg.sids);
    const onRec = gates.filter(g => g.sids?.some(s => recSid.has(s.id)));
    const gate = pick(onRec.length && Math.random() < 0.75 ? onRec : gates);
    const initial = Math.max(Math.ceil((G.world.elev + 4000) / 1000) * 1000, mvaCeilingWithin(10));
    const ac = {
        id: nextId++, ...id, kind: 'dep', state: 'wait', perf: perf(id.type), rwy, gate,
        x: rwy.thr.x, y: rwy.thr.y, alt: G.world.elev, hdg: rwy.course, spd: 0,
        tHdg: rwy.course, tAlt: initial, tSpd: 280, turn: null,
        trail: [], trailT: 0, born: G.t, remindAt: G.t + 240, freq: 'TWR', patternWork: !!patternWork,
    };
    if (stand) {
        // At the gate, nose in: pointing at the taxiway it will push back onto.
        const n = G.ground.nodes[stand.node];
        // IFATC 2.1.6: send aircraft to the closest runway in use.
        if (G.rules.id === 'ifatc') {
            const near = G.active.dep.map(e => ({ e, h: G.ground.holds.get(e) })).filter(x => x.h)
                .sort((a, b) => Math.hypot(G.ground.nodes[a.h.node].x - stand.x, G.ground.nodes[a.h.node].y - stand.y) - Math.hypot(G.ground.nodes[b.h.node].x - stand.x, G.ground.nodes[b.h.node].y - stand.y))[0];
            if (near) { ac.rwy = rwy = near.e; ac.tHdg = rwy.course; }
        }
        Object.assign(ac, { state: 'gate', stand, x: stand.x, y: stand.y, hdg: brg(stand.x - n.x, stand.y - n.y), freq: 'GND', readyAt: G.t + rand(5, 60), called: false });
        G.aircraft.push(ac);
        maybeEmergency(ac);
        return true;
    }
    G.aircraft.push(ac);
    maybeEmergency(ac);
    pilot(ac, `${facName('TWR')}, ${ac.radio}, holding short runway ${rwy.id}, information ${PHONETIC[G.atis]}, ready for departure${ac.patternWork ? ', remaining in the pattern' : ''}.`);
    return true;
}

/* ------------------------------------------------------------------ */
/* Radio                                                               */
/* ------------------------------------------------------------------ */

const DIGIT_WORDS = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'niner' };
let voiceOn = store.get('voice', false);

function logLine(kind, text) {
    const log = $('#log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'm-' + kind;
    if (G) {
        // Stamped with the shift's Zulu time, as the IFATC text log does.
        const z = new Date(G.zulu0 + G.t * 1000), p2 = n => String(n).padStart(2, '0');
        const ts = document.createElement('span');
        ts.className = 'ts';
        ts.textContent = `${p2(z.getUTCHours())}:${p2(z.getUTCMinutes())}:${p2(z.getUTCSeconds())} `;
        div.appendChild(ts);
    }
    div.appendChild(document.createTextNode(text));
    const who = G && G.aircraft.find(a => text.includes(a.radio) || text.includes(a.cs));
    if (who) { div.dataset.id = who.id; div.classList.add('tap'); }
    log.appendChild(div);
    while (log.children.length > 80) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
}
function atc(text, ai) { logLine(ai ? 'ai' : 'atc', text); }
function sys(text, tone) {
    // In Infinite Flight mode the FAA paragraph numbers mean nothing: drop them.
    if (G && G.rules.id === 'ifatc') text = text.replace(/\s*\((?:7110\.65|14 CFR)[^)]*\)/g, '');
    logLine(tone || 'sys', text);
}
function pilot(ac, text) {
    logLine('pilot', text);
    if (!voiceOn || !('speechSynthesis' in window)) return;
    let s = text.split(ac.radio).join(ac.spoken);
    s = s.replace(/heading (\d{3})/g, (_, d) => 'heading ' + d.split('').map(c => DIGIT_WORDS[c]).join(' '));
    s = s.replace(/runway (\d{1,2})([LRC]?)/g, (_, n, side) =>
        'runway ' + n.split('').map(c => DIGIT_WORDS[c]).join(' ') + (side ? ' ' + { L: 'left', R: 'right', C: 'center' }[side] : ''));
    try {
        if (speechSynthesis.pending) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(s);
        u.rate = 1.12;
        speechSynthesis.speak(u);
    } catch { /* no voice */ }
}

let toastTimer = 0;
function toast(text, tone, ms = 2600) {
    const el = $('#toast');
    el.textContent = text;
    el.className = 'toast show ' + (tone || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, ms);
}

function award(ac, pts, label) {
    G.score += pts;
    G.floaters.push({ x: ac.x, y: ac.y, text: (pts > 0 ? '+' : '') + pts + (label ? ' ' + label : ''), good: pts > 0, until: G.t + 3 });
}

/* ------------------------------------------------------------------ */
/* Clearances                                                          */
/* ------------------------------------------------------------------ */

/** Find a runway end by what the player typed ("4L", "04L", "22R"). */
function findEnd(s) {
    const k = rwyKey(s);
    return G.world.ends.find(e => rwyKey(e.id) === k) || null;
}

/** On-final geometry relative to a runway end: along (nm before threshold), xt (nm right of course). */
function finalGeom(ac, e) {
    const c = e.course * D2R;
    const dx = ac.x - e.thr.x, dy = ac.y - e.thr.y;
    return { along: -(dx * Math.sin(c) + dy * Math.cos(c)), xt: dx * Math.cos(c) - dy * Math.sin(c) };
}

/** The physical runway an aircraft is on right now, or -1. */
function onRunwayPhys(a) {
    if (a.state === 'roll' || a.state === 'rto' || a.state === 'luaw' || a.state === 'lineup') return a.rwy.phys;
    if (a.state === 'rollout') return a.landEnd.phys;
    if (a.state === 'taxi' && a.route) {
        if (a.purpose === 'exit') return a.landEnd.phys;
        for (const c of a.route.crossings) if (a.s > c.stopS + 0.005 && a.s < c.clearS) return c.phys;
    }
    return -1;
}

function runwayBusyUntil(phys) {
    let until = G.occupied.get(phys) || 0;
    if (G.aircraft.some(a => onRunwayPhys(a) === phys)) until = Math.max(until, G.t + 30);
    return until;
}

/** Why a departure may not start its takeoff roll yet (7110.65 3-9-6), or null. */
function runwayBlocker(ac) {
    const phys = ac.rwy.phys;
    const other = G.aircraft.find(a => a !== ac && onRunwayPhys(a) === phys
        // IFATC 3.1.2: a takeoff clearance may anticipate the departure ahead still rolling (checked again when this one rolls).
        && !(G.rules.id === 'ifatc' && !G.aiActing && a.state === 'roll'));
    if (other) return `${other.cs} is on the runway`;
    if ((G.occupied.get(phys) || 0) > G.t) return 'the previous aircraft has not cleared it';
    const x = crossingTraffic(ac.rwy);
    if (x) return x;
    return null;
}

/** Where each pair of runways crosses, by physical runway: [{ phys, at: {x, y} }]. */
function intersections(phys) {
    G.world.xing = G.world.xing || new Map();
    if (G.world.xing.has(phys)) return G.world.xing.get(phys);
    const mine = G.world.ends.find(e => e.phys === phys), out = [];
    for (const o of G.world.ends) {
        if (o.phys === phys || out.some(x => x.phys === o.phys)) continue;
        const t = crossAtSeg(mine.thr, mine.far, o.thr, o.far);
        if (t >= 0) out.push({ phys: o.phys, at: { x: mine.thr.x + (mine.far.x - mine.thr.x) * t, y: mine.thr.y + (mine.far.y - mine.thr.y) * t } });
    }
    G.world.xing.set(phys, out);
    return out;
}
function crossAtSeg(p1, p2, q1, q2) {
    const rx = p2.x - p1.x, ry = p2.y - p1.y, sx = q2.x - q1.x, sy = q2.y - q1.y, den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return -1;
    const t = ((q1.x - p1.x) * sy - (q1.y - p1.y) * sx) / den, u = ((q1.x - p1.x) * ry - (q1.y - p1.y) * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

/**
 * Traffic on a runway that crosses this one, not yet beyond the intersection
 * (IFATC 3.1.1 "Intersecting", 7110.65 3-9-8 / 3-10-4): rolling, rolling out,
 * or about to land. Returns why, or null.
 */
function crossingTraffic(end) {
    for (const x of intersections(end.phys)) {
        for (const o of G.aircraft) {
            const e = o.state === 'roll' || o.state === 'rto' ? o.rwy : o.state === 'rollout' ? o.landEnd : o.appr?.loc && o.appr.along < 1.5 && o.appr.end.phys === x.phys ? o.appr.end : null;
            if (!e || e.phys !== x.phys) continue;
            const c = e.course * D2R, along = p => (p.x - e.thr.x) * Math.sin(c) + (p.y - e.thr.y) * Math.cos(c);
            if (along(o) < along(x.at) + 0.05) return `${o.cs} on the crossing runway ${e.id} isn't past the intersection`;
        }
    }
    return null;
}

/** Where (NM from the threshold) a heading would join the localizer, and at what angle. */
function predictIntercept(ac, e, hdg) {
    const g = finalGeom(ac, e);
    const angle = Math.abs(diff(e.course, hdg));
    if (Math.abs(g.xt) < 0.15) return { along: g.along, angle };
    const ia = diff(e.course, hdg) * D2R, sin = Math.sin(ia);
    if (g.xt * sin >= 0 || Math.abs(sin) < 0.02) return null;    // not converging
    const run = Math.abs(g.xt / sin);
    return { along: g.along - Math.cos(ia) * run, angle };
}

function minSpeed(ac) {
    if (ac.perf.prop) return 70;
    // 7110.65 5-7-3. Turbojet arrivals: 250 at/above 10,000; 210 below; 170 within 20 flying miles of the threshold.
    if (ac.alt >= 10000) return 250;
    if (ac.kind === 'dep') return 230;
    return Math.hypot(ac.x, ac.y) < 20 ? 170 : 210;
}

/** A controller error: the clearance stands, the rule is named, and it costs points. */
function violation(ac, rule, text) {
    if (G.aiActing) return;
    G.stats.violations++;
    award(ac, -VIOLATION_PTS);
    sys(`${text} — ${G.rules.id === 'ifatc' && !rule.startsWith('IFATC') ? 'IFATC procedure' : rule}.`, 'bad');
}

function zuluAt(t) {
    const z = new Date(G.zulu0 + t * 1000);
    return String(z.getUTCHours()).padStart(2, '0') + String(z.getUTCMinutes()).padStart(2, '0');
}

const crossOwner = ac => (G.rules.id === 'ifatc' && ac.freq === 'GND' ? 'GND' : 'TWR');

/** A runway as it's named for a crossing: by the direction in use (IFATC 2.3.1), whichever end the aircraft is at. */
function crossName(cr) {
    const ends = G.world.ends.filter(e => e.phys === cr.phys);
    const used = ends.find(e => G.active.dep.includes(e) || G.active.arr.includes(e));
    return (used || ends.sort((a, b) => a.id.localeCompare(b.id))[0])?.id || cr.label;
}

/**
 * Why crossing this runway now isn't safe (IFATC 2.3.2), or null: a departure
 * rolling and not yet past the crossing point (or airborne and turning), or an
 * arrival over the threshold, not exiting before the crossing point or past it.
 */
function crossingUnsafe(ac, cr) {
    const at = pointAt(ac.route, cr.s);
    for (const o of G.aircraft) {
        if (o === ac) continue;
        const e = o.state === 'roll' ? o.rwy : o.state === 'rollout' || (o.state === 'taxi' && o.purpose === 'exit') ? o.landEnd : null;
        if (!e || e.phys !== cr.phys) continue;
        const c = e.course * D2R, along = p => (p.x - e.thr.x) * Math.sin(c) + (p.y - e.thr.y) * Math.cos(c);
        const crossAt = along(at), here = along(o);
        if (here > crossAt + 0.05) continue;                                         // past the crossing point
        if (o.state === 'roll') return `${o.cs} is rolling toward the crossing point`;
        if (o.exitAt && o.exitAt.along < crossAt - 0.05) continue;                   // turning off before it
        if (o.state === 'taxi') continue;
        return `${o.cs} has landed and is rolling toward the crossing point`;
    }
    return null;
}

/**
 * Apply one transmission to an aircraft. `c` may carry hdg/turn, alt, spd,
 * ils (runway end), direct (fix), holdFix (fix), orbit ('L'|'R'), luaw,
 * takeoff, land, goAround. Returns true when the pilot accepted it.
 */
function issue(ac, c) {
    if (!ac || ac.gone) return false;
    // Runway crossings are the tower's to give (real life) or Ground's, in coordination with Tower (IFATC 2.2.2).
    const owner = c.cross ? crossOwner(ac) : ac.freq;
    if (!c.ai && !G.positions.has(owner)) {
        sys(`${ac.cs} is on ${FREQ_NAME[owner]}, which the system is working.`);
        return false;
    }
    G.aiActing = !!c.ai;
    try { return issueCall(ac, c); } finally { G.aiActing = false; }
}

function issueCall(ac, c) {
    const parts = [], back = [];
    const onGround = ac.state !== 'air';
    const elev = G.world.elev;
    const wind = `wind ${hdg3(G.wind.dir)} at ${G.wind.spd}`;

    // ---- ground
    if (c.push) {
        if (ac.state !== 'gate' || ac.kind !== 'dep') { sys(`${ac.cs} isn't waiting at a gate.`); return false; }
        if (!G.aiActing && G.rules.id === 'ifatc') {
            const near = G.aircraft.find(o => o !== ac && (o.state === 'taxi' || o.state === 'push') && Math.hypot(o.x - ac.x, o.y - ac.y) < 0.07);
            if (near) violation(ac, 'IFATC 2.1.3', `${ac.cs} pushed back with ${near.cs} moving right behind: check the area is clear, or "hold position" / give way first`);
        }
        ac.state = 'push'; ac.pushLeft = 40;
        parts.push(c.expectRwy ? `pushback approved, expect runway ${ac.rwy.id}` : 'pushback approved'); back.push(c.expectRwy ? `pushing back, expect ${ac.rwy.id}` : 'pushing back');
    }
    if (c.taxi) {
        if (!taxiClearance(ac, c.taxi, parts, back)) return false;
    }
    if (c.tower) {
        if (ac.kind !== 'dep' || ac.freq !== 'GND' || !['taxi', 'wait'].includes(ac.state)) { sys(`${ac.cs} isn't taxiing out on Ground.`); return false; }
        if (ac.state === 'wait') {
            atc(`${ac.radio}, contact Tower.`, G.aiActing);
            pilot(ac, `Over to Tower, ${ac.radio}.`);
            toTower(ac);
            return true;
        }
        ac.toTower = true;
        parts.push('contact Tower when ready'); back.push('Tower when ready');
    }
    if (c.ground) {
        if (ac.kind !== 'arr' || ac.freq !== 'TWR' || !['clear', 'rollout', 'taxi'].includes(ac.state)) { sys(`${ac.cs} isn't rolling off the runway.`); return false; }
        if (ac.state === 'clear') {
            atc(`${ac.radio}, contact Ground.`, G.aiActing);
            pilot(ac, `Over to Ground, ${ac.radio}.`);
            toGround(ac);
            return true;
        }
        ac.toGround = true;
        parts.push('contact Ground when clear of the runway'); back.push('Ground when clear');
    }
    if (c.holdPos) {
        if (!['taxi', 'push'].includes(ac.state)) { sys(`${ac.cs} isn't moving on the ground.`); return false; }
        ac.holdPos = true; parts.push('hold position'); back.push('holding position');
    }
    if (c.cont) {
        if (!ac.holdPos) { sys(`${ac.cs} isn't holding.`); return false; }
        ac.holdPos = false; parts.push('continue taxi'); back.push('continuing');
    }
    if (c.cross) {
        // Anticipated crossings are encouraged (IFATC 2.3.3): the next runway on the route, once any before it is crossed.
        const r = ac.state === 'taxi' && ac.route;
        const cr = ac.crossReq || (r && r.crossings.find(x => !x.cleared));
        if (!cr) { sys(`${ac.cs} has no runway to cross.`); return false; }
        if (r && r.crossings.some(x => x.cleared && x !== cr && ac.s < x.clearS)) { sys(`${ac.cs} has to finish crossing the runway it's on first (IFATC 2.2.2).`); return false; }
        const why = r && !G.aiActing && crossingUnsafe(ac, cr);
        if (why) violation(ac, G.rules.id === 'ifatc' ? 'IFATC 2.3.2' : '7110.65 3-1-3', `${ac.cs} cleared to cross while ${why}`);
        cr.cleared = true; cr.asked = true; ac.crossReq = null;
        parts.push(`cross runway ${crossName(cr)}${c.expedite ? ', please expedite' : ''}`); back.push(`crossing ${crossName(cr)}`);
        if (c.expedite) ac.expediteUntil = G.t + 60;
    }
    if (c.giveWay) {
        const o = c.giveWay;
        if (o === ac || !isSurface(o)) { sys('Give way to an aircraft on the ground.'); return false; }
        ac.giveWay = { o, t: G.t, closest: Infinity };
        const rel = diff(ac.hdg, brg(o.x - ac.x, o.y - ac.y));
        const who = o.state === 'rollout' || o.purpose === 'exit' ? `aircraft exiting runway ${(o.landEnd || o.rwy).id}` : Math.abs(rel) < 35 ? 'aircraft ahead' : `aircraft on your ${rel < 0 ? 'left' : 'right'}`;
        parts.push(`give way to ${who}`); back.push(`giving way to the ${who.replace('aircraft ', '')}`);
    }
    if (c.prog || c.follow || c.discretion || c.expectProg) {
        if (!progressive(ac, c, parts, back)) return false;
    }

    // ---- things that stop the call before it is made
    if (c.hdg != null && onGround && !G.aiActing) { sys(`${ac.cs} is on the ground: headings are for airborne aircraft.`); delete c.hdg; delete c.turn; }
    if ((c.holdFix || c.orbit) && ac.emerg && !G.aiActing) { pilot(ac, `Unable, ${ac.radio}, we need to land as soon as possible.`); return false; }
    if ((c.luaw || c.takeoff) && ac.freq === 'GND') { sys(`${ac.cs} is still on Ground: have it contact Tower first.`); return false; }
    // IFATC 3.2.6: jets are ready at the runway, so Tower may clear one still taxiing up to it.
    const early = ac.state === 'taxi' && ac.purpose === 'runway' && ac.freq === 'TWR';
    if (c.luaw && ac.state !== 'wait' && !early) { sys(`${ac.cs} is not holding short.`); return false; }
    if (c.takeoff && ac.state !== 'wait' && ac.state !== 'luaw' && !early) { sys(`${ac.cs} is not at the runway.`); return false; }
    if (c.luaw && G.aircraft.some(a => a !== ac && a.state === 'luaw' && a.rwy.phys === ac.rwy.phys)) {
        sys(`Someone is already lined up on ${ac.rwy.id}.`); return false;
    }
    if (c.takeoff) {
        const why = runwayBlocker(ac);
        if (why) { sys(`Runway ${ac.rwy.id} is not clear: ${why} (7110.65 3-9-6).`, 'bad'); return false; }
    }
    if ((c.land || c.option) && !(ac.appr && ac.appr.loc) && !((ac.pattern || c.entry) && towerInbound(ac)) && !ac.circuit) { sys(`${ac.cs} isn't established on the final approach course yet.`); return false; }
    if ((c.holdFix || c.orbit || c.ils || c.direct) && onGround) { sys(`${ac.cs} is on the ground.`); return false; }
    if (c.ils && ac.kind !== 'arr') { sys(`${ac.cs} is a departure.`); return false; }
    if (c.spd != null && ac.appr && ac.appr.along < Math.max(FAF_NM, 5)) {
        sys('No speed adjustments inside the final approach fix or 5 miles from the runway (7110.65 5-7-1).');
        delete c.spd;
    }

    // ---- approach type (ILS unless said otherwise), and the published RNAV procedure from a nearby fix
    const appType = c.ils ? (c.appType || 'ILS') : null;
    if (c.ils && !hasApproach(c.ils, appType)) { sys(`Runway ${c.ils.id} has no ${APP_NAME[appType]} approach.`); return false; }
    if (c.ils && appType === 'RNAV' && c.hdg == null) {
        const r = rnavRoute(ac, c.ils);
        if (r) { c.rnavProc = { end: c.ils, ...r }; delete c.ils; }
    }
    if (c.visual) {
        if (ac.kind !== 'arr' || onGround) { sys(`${ac.cs} isn't an arrival.`); return false; }
        if (!visualWx()) { sys(`No visual approaches: the weather is below VFR (${metText(G.met)}).`); return false; }
        if (!fieldInSight(ac)) {
            atc(`${ac.radio}, report the airport in sight.`, G.aiActing);
            pilot(ac, `Negative contact, we'll report the field, ${ac.radio}.`);
            ac.reportField = true;
            return true;
        }
    }
    if (c.reportField) {
        atc(`${ac.radio}, report the airport in sight.`, G.aiActing);
        if (fieldInSight(ac)) { ac.fieldReported = true; pilot(ac, `Field in sight, ${ac.radio}.`); }
        else { pilot(ac, `Wilco, ${ac.radio}.`); ac.reportField = true; }
        return true;
    }
    if (c.unable) {
        if (!ac.request) { sys(`${ac.cs} hasn't asked for anything.`); return false; }
        atc(`${ac.radio}, unable ${ac.request.say}, expect ${appWord(appFor(ac.expect))} runway ${ac.expect.id}.`, G.aiActing);
        pilot(ac, `Roger, ${ac.radio}.`);
        ac.request = null;
        return true;
    }

    // IFATC 3.6.1: once Radar has handed an instrument arrival to Tower, keep runway changes to a minimum.
    const newEnd = c.ils || c.visual;
    if (newEnd && G.rules.id === 'ifatc' && !G.aiActing && ac.freq === 'TWR' && instrumentHandoff(ac) && newEnd !== ac.appr.end) sys(`IFATC 3.6.1: ${ac.cs} was handed over on the ${APP_NAME[ac.appr.type]} ${ac.appr.end.id}. Keep runway changes for instrument arrivals to a minimum.`, 'bad');

    let icpt = null;
    if (c.ils) {
        const willFly = c.hdg != null ? c.hdg : (ac.holdAt || ac.orbit || ac.direct) ? ac.hdg : ac.tHdg;
        icpt = predictIntercept(ac, c.ils, willFly);
        if (!icpt || icpt.along < FAF_NM) {
            atc(`${ac.radio}, cleared ${APP_NAME[appType]} runway ${c.ils.id} approach.`);
            pilot(ac, `Unable, on this heading we won't join the ${c.ils.id} final approach course outside the final approach fix, ${ac.radio}.`);
            return false;
        }
    }

    if (c.deviate) {
        const r = ac.wxReq;
        if (!r) { sys(`${ac.cs} hasn't asked to deviate.`); return false; }
        ac.tHdg = norm(ac.hdg + (r.dir === 'L' ? -r.deg : r.deg)); ac.turn = r.dir;
        ac.direct = null; ac.holdAt = null; ac.orbit = null;
        if (ac.appr) cancelApproach(ac);
        ac.wxReq = null; ac.wxDev = { t: G.t };
        const side = r.dir === 'L' ? 'left' : 'right';
        atc(`${ac.radio}, deviation ${r.deg} degrees ${side} approved, advise clear of weather.`);
        pilot(ac, `${r.deg} ${side}, will advise, ${ac.radio}.`);
        return true;
    }
    if (c.goAround) {
        if (!ac.appr) { sys(`${ac.cs} isn't on an approach.`); return false; }
        const e = ac.appr.end;
        atc(`${ac.radio}, go around${c.traffic ? `, make ${c.traffic === 'R' ? 'right' : 'left'} traffic runway ${e.id}` : ''}.`, G.aiActing);
        goAround(ac, null);
        // With a traffic direction: round the pattern for another go, staying with Tower.
        if (c.traffic) {
            ac.circuit = ac.circuit || { end: e, laps: 0, planned: 0, work: false };
            Object.assign(ac.circuit, { end: e, side: c.traffic === 'R' ? 1 : -1, leg: 'up' });
            Object.assign(ac, { freq: 'TWR', tAlt: circuitAlt(ac), pattern: null });
        }
        return true;
    }

    // ---- lateral
    if (c.hdg != null) {
        const h = norm(c.hdg) || 360;
        const d = diff(ac.hdg, h);
        const dir = c.turn || (Math.abs(d) < 3 ? null : d < 0 ? 'L' : 'R');
        ac.tHdg = h; ac.turn = c.turn || null; ac.holdAt = null; ac.orbit = null; ac.direct = null;
        if (ac.appr) cancelApproach(ac);
        if (onGround) {
            // Folded into the takeoff clearance below when one comes with it.
            if (!c.takeoff) { parts.push(`after departure fly heading ${hdg3(h)}`); back.push(`heading ${hdg3(h)} after departure`); }
        } else {
            const side = dir === 'L' ? 'left ' : dir === 'R' ? 'right ' : '';
            parts.push(`${side ? 'turn ' + side : 'fly '}heading ${hdg3(h)}`);
            back.push(`${side}heading ${hdg3(h)}`);
        }
    }
    if (c.direct) {
        ac.direct = c.direct; ac.holdAt = null; ac.orbit = null; ac.turn = null;
        if (ac.appr) cancelApproach(ac);
        parts.push(`proceed direct ${c.direct.name}`);
        back.push(`direct ${c.direct.name}`);
    }
    if (c.holdFix) {
        const f = c.holdFix;
        // No published holds here, so every hold is standard: right turns, inbound toward the field.
        const inbound = c.holdInbound != null ? c.holdInbound : f.kind === 'app' ? f.end.course : brg(-f.x, -f.y);
        ac.holdAt = { fix: f, inbound, phase: 'to', timer: 0 };
        ac.direct = null; ac.orbit = null; ac.turn = null;
        if (ac.appr) cancelApproach(ac);
        const efc = zuluAt(G.t + 600);
        parts.push(`hold ${cardinal(inbound + 180)} of ${f.name}, inbound course ${hdg3(inbound)}, right turns, expect further clearance ${efc}`);
        back.push(`hold ${cardinal(inbound + 180)} of ${f.name}, right turns, ${efc}`);
    }
    if (c.orbit) {
        ac.orbit = { dir: c.orbit, rem: 360 }; ac.holdAt = null;
        if (ac.appr) cancelApproach(ac);
        parts.push(G.rules.id === 'ifatc' ? 'make a 360 for spacing' : `make a ${c.orbit === 'L' ? 'left' : 'right'} three-sixty`);
        back.push(`${c.orbit === 'L' ? 'left' : 'right'} three-sixty`);
    }

    // ---- published procedures
    if (c.via) {
        const resume = ac.kind === 'arr' ? ac.viaSaved || ac.via : ac.viaSaved || ac.via;
        if (!resume) { sys(`${ac.cs} isn't on a published ${ac.kind === 'arr' ? 'arrival' : 'departure'}.`); return false; }
        ac.via = { ...resume, vert: true }; ac.viaSaved = null; ac.direct = null; ac.holdAt = null; ac.orbit = null;
        parts.push(ac.kind === 'arr' ? `descend via the ${resume.id} arrival` : `climb via the ${resume.id} departure`);
        back.push(ac.kind === 'arr' ? `descend via the ${resume.id}` : `climb via the ${resume.id}`);
    }
    if (ac.via && !c.via && (c.hdg != null || c.direct || c.holdFix || c.orbit || c.ils)) { ac.viaSaved = ac.via; ac.via = null; }
    if (ac.via && !c.via && c.alt != null) ac.via.vert = false;

    // ---- vertical
    if (c.alt != null || c.ils) {
        const a = clamp(Math.round((c.alt != null ? c.alt : ac.tAlt) / 1000) * 1000, G.world.minAlt, 24000);
        const ref = onGround ? elev : ac.alt;
        ac.tAlt = a;
        const mva = onGround ? 0 : mvaHere(ac);
        if (mva && a < mva) violation(ac, 'minimum vectoring altitude', `${fmtAlt(a)} is below the MVA where ${ac.cs} is (${fmtAlt(mva)})`);
        if (c.ils) {
            // 7110.65 5-9-4: "maintain <altitude> until established on the localizer".
            parts.push(`maintain ${fmtAlt(a)} until established on the ${appType === 'ILS' || appType === 'LOC' ? 'localizer' : 'final approach course'}`);
            back.push(`${fmtAlt(a)} until established`);
        } else {
            const verb = Math.abs(a - ref) < 50 ? 'maintain' : a > ref ? 'climb and maintain' : 'descend and maintain';
            parts.push(`${verb} ${fmtAlt(a)}`);
            back.push(`${verb.replace(' and maintain', '')} ${fmtAlt(a)}`);
        }
    }

    // ---- messages from the lists, standby
    if (c.msg) return sayMessage(ac, c.msg);
    if (c.standby) {
        atc(`${ac.radio}, ${c.standby === 'corr' ? 'correction, standby' : c.standby === 'disregard' ? 'disregard last message' : 'standby'}`, G.aiActing);
        ac.standbyUntil = G.t + 45;
        return true;
    }

    // ---- what to expect (IF: "expect vectors for the visual approach runway 2", or "expect …, continue as filed")
    if (c.expectApp) {
        if (ac.kind !== 'arr' || onGround) { sys(`${ac.cs} isn't an arrival.`); return false; }
        const { type, end } = c.expectApp;
        Object.assign(ac, { expect: end, expectType: type, request: null });
        parts.push(c.asFiled ? `expect the ${appWord(type)} approach runway ${end.id}` : `expect vectors for the ${appWord(type)} approach runway ${end.id}`);
        back.push(`expect the ${appWord(type)} ${end.id}`);
    }
    if (c.asFiled) {
        // Back onto (or carry on along) the route it filed: its STAR or SID, or out to its exit.
        if (!filedRoute(ac)) { sys(`${ac.cs} has no filed route to continue on.`); return false; }
        if (ac.viaSaved) { ac.via = { ...ac.viaSaved, vert: true }; ac.viaSaved = null; }
        else if (!ac.via && ac.kind === 'dep' && ac.gate?.x != null) ac.direct = ac.gate;
        else if (!ac.via) {
            // No published arrival to go back to: the fixes it filed, to its runway's approach fix, at the altitude it has.
            const legs = filedAhead(ac).filter(p => !/^RW/.test(p.name)).map(p => ({ name: p.name, x: p.x, y: p.y, alt: null }));
            if (legs.length) Object.assign(ac, { via: { kind: 'FPL', id: 'filed route', legs, i: 0, vert: false }, direct: null });
        }
        Object.assign(ac, { holdAt: null, orbit: null, request: null });
        parts.push('continue as filed'); back.push('continue as filed');
    }
    if (c.toTwr) {
        // IFATC 3.6.3: besides an approach, Radar can hand over an arrival on radar vectors or flight following, close in and in VMC, for a pattern entry.
        const vectors = !(ac.appr || ac.pattern) && radarVectorsOk(ac);
        if (ac.kind !== 'arr' || ac.freq !== 'APP' || !(ac.appr || ac.pattern || vectors)) {
            sys(G.rules.id === 'ifatc' && !visualWx() ? `${ac.cs} goes to Tower once it's cleared for an approach (no pattern entries below VMC).`
                : G.rules.id === 'ifatc' ? `${ac.cs} goes to Tower once it's cleared for an approach, or on vectors within 15 miles.` : `${ac.cs} goes to Tower once it's cleared for an approach.`);
            return false;
        }
        atc(`${ac.radio}, contact ${facName('TWR')}${G.freqs?.TWR ? ' on ' + mhz(G.freqs.TWR[0]) : ''}.`, G.aiActing);
        pilot(ac, `Over to Tower, ${ac.radio}.`);
        ac.freq = 'TWR';
        ac.handoff = vectors ? ac.vfrIn || 'RV' : ac.appr?.type || 'VIS';
        if (ac.appr) ac.appr.est = true;
        if (vectors) towerCheckInVfr(ac);
        return true;
    }
    if (c.intentions) {
        atc(`${ac.radio}, say intentions.`, G.aiActing);
        const r = ac.request;
        pilot(ac, r ? `${ac.radio}, we'd like ${r.say} approach runway ${r.end.id}.`
            : ac.kind === 'arr' ? `${ac.radio}, ${appWord(ac.expectType || appFor(ac.expect))} approach runway ${ac.expect.id}, full stop.`
            : `${ac.radio}, on course ${ac.gate.name}${ac.sid ? `, the ${ac.sid} departure` : ''}.`);
        return true;
    }
    if (c.missed != null) {
        if (ac.kind !== 'arr' || onGround) { sys(`${ac.cs} isn't an arrival.`); return false; }
        ac.missedAlt = c.missed;
        parts.push(`in case of missed approach, fly runway heading, climb and maintain ${fmtAlt(c.missed)}`);
        back.push(`missed approach runway heading, ${fmtAlt(c.missed)}`);
    }

    // ---- approach clearance
    if (c.rnavProc) {
        const r = c.rnavProc;
        ac.via = { kind: 'IAP', id: r.name, legs: r.legs, i: 0, vert: true, end: r.end };
        Object.assign(ac, { appr: null, holdAt: null, direct: null, orbit: null, turn: null, landClr: false, request: null, pattern: null, expect: r.end });
        parts.push(`cross ${r.legs[0].name}${r.legs[0].alt ? ` at or above ${fmtAlt(r.legs[0].alt)}` : ''}, cleared ${r.name.replace(' RWY ', ' runway ')} approach`);
        back.push(`cleared ${r.name.replace(' RWY ', ' runway ')}`);
    }
    if (c.visual) {
        ac.pattern = visualPattern(ac, c.visual);
        Object.assign(ac, { appr: null, holdAt: null, direct: null, orbit: null, turn: null, landClr: false, via: null, request: null, expect: c.visual, tAlt: Math.max(G.world.minAlt, patternAlt()), tSpd: Math.min(ac.tSpd, 210) });
        parts.push(`cleared visual approach runway ${c.visual.id}`);
        back.push(`cleared visual ${c.visual.id}`);
    }
    if (c.ils) {
        const e = c.ils;
        ac.appr = { end: e, type: appType, loc: false, gs: false, est: false, along: 99, xt: 0, spd: ac.spdHold?.sp ?? null, spdUntil: ac.spdHold?.until };
        ac.spdHold = null;
        ac.holdAt = null; ac.direct = null; ac.orbit = null; ac.turn = null; ac.landClr = false; ac.request = null;
        parts.push(`cleared ${APP_NAME[appType]} runway ${e.id} approach`);
        back.push(`cleared ${APP_TAG[appType]} ${e.id}`);
        // 7110.65 5-9-2: 30° max, 20° max within 2 NM of the approach gate.
        const nearGate = icpt.along < GATE_NM + 2;
        if (icpt.angle > 30.5) violation(ac, '7110.65 5-9-2', `${ac.cs} joins the localizer at ${Math.round(icpt.angle)}°; the limit is 30°`);
        else if (nearGate && icpt.angle > 20.5) violation(ac, '7110.65 5-9-2', `${ac.cs} joins at ${Math.round(icpt.angle)}° within 2 miles of the approach gate; the limit there is 20°`);
        // 7110.65 5-9-1: join at least 2 NM outside the approach gate.
        if (nearGate) violation(ac, '7110.65 5-9-1', `${ac.cs} joins final ${icpt.along.toFixed(1)} miles out; vector to join at least 2 miles outside the approach gate (${GATE_NM + 2} miles)`);
        // The glideslope is joined from below.
        const gsAt = elev + icpt.along * GS_FT_PER_NM;
        if (ac.tAlt > gsAt + 100) violation(ac, 'glideslope interception', `${fmtAlt(ac.tAlt)} is above the glideslope where ${ac.cs} joins (about ${fmtAlt(Math.round(gsAt / 100) * 100)}); it has to intercept from below`);
    }

    // ---- speed (an approach clearance cancels assigned speeds unless restated: 7110.65 5-7-1)
    if (c.slowest) {
        if (onGround) { sys(`${ac.cs} is on the ground.`); return false; }
        if (G.rules.id === 'ifatc' && !G.aiActing && ac.appr && ac.appr.along < 4) {
            sys(`IFATC 3.1.4: not within 4 miles of touchdown, ${ac.cs} is already at final approach speed. A go-around may be the only option left.`);
            pilot(ac, `Unable, already at final approach speed, ${ac.radio}.`);
            return false;
        }
        const sp = Math.max(minSpeed(ac), ac.alt < 10000 ? Math.min(210, ac.perf.vapp + 40) : 250);
        if (ac.appr) ac.appr.spd = sp; else ac.tSpd = sp;
        parts.push('maintain slowest practical speed'); back.push('slowest practical');
    }
    if (c.spdDisc) {
        if (ac.appr) Object.assign(ac.appr, { spd: null, spdUntil: undefined });
        ac.spdHold = null; ac.matchSpd = null; ac.tSpd = isProp(ac) ? 120 : ac.alt < 10000 ? 250 : 280;
        parts.push('speed at your discretion'); back.push('speed our discretion');
    }
    if (c.spdFollow) {
        const o = trafficAhead2(ac) || c.spdFollow;
        if (!o || o === true) { sys(`${ac.cs} has no aircraft ahead to follow.`); return false; }
        ac.matchSpd = o; parts.push('adjust speed to follow aircraft ahead'); back.push('adjusting speed');
    }
    if (c.spdPresent || c.spdBest) {
        const v = c.spdPresent ? Math.round(ac.spd / 10) * 10 : isProp(ac) ? 140 : ac.alt < 10000 ? 250 : 300;
        if (ac.appr) Object.assign(ac.appr, { spd: v, spdUntil: FAF_NM }); else ac.tSpd = v;
        ac.matchSpd = null;
        parts.push(c.spdPresent ? 'maintain present speed' : 'maintain best forward speed'); back.push(c.spdPresent ? 'present speed' : 'best forward');
    }
    if (c.spd != null) {
        let sp = clamp(Math.round(c.spd / 10) * 10, ac.perf.prop ? 60 : 130, 340);
        const min = minSpeed(ac);
        if (sp < min) { sys(`Minimum assignable speed for ${ac.cs} here is ${min} knots (7110.65 5-7-3).`); sp = min; }
        if (ac.alt < 10000 && sp > 250) { sys('250 knots maximum below 10,000 feet (14 CFR 91.117).'); sp = 250; }
        const verb = sp < ac.spd - 3 ? 'reduce speed to' : sp > ac.spd + 3 ? 'increase speed to' : 'maintain';
        const until = c.spdUntil || FAF_NM;
        if (ac.appr) {
            Object.assign(ac.appr, { spd: sp, spdUntil: until });
            parts.push(`maintain ${sp} knots until ${until} mile final`);
            back.push(`${sp} to ${until} mile final`);
        } else if (c.spdUntil) {
            // Before the approach clearance: kept when it's cleared, not cancelled by it.
            ac.tSpd = sp; ac.spdHold = { sp, until };
            parts.push(`maintain ${sp} knots until ${until} mile final`);
            back.push(`${sp} to ${until} mile final`);
        } else {
            ac.tSpd = sp;
            parts.push(`${verb} ${sp}${verb === 'maintain' ? ' knots' : ''}`);
            back.push(`${sp} knots`);
        }
    }

    // ---- Tower: inbounds with no radar (IFATC 3.3)
    if (c.entry || c.contInbound || c.seqLand) {
        // With radar (IFATC 3.6.3): a visual arrival gets a sequence when it isn't number 1, an ILS or GPS one only its clearance.
        const visualSeq = c.seqLand && !c.entry && !c.contInbound && ac.freq === 'TWR' && ac.appr?.type === 'VIS' && !ac.circuit;
        if (G.rules.id === 'ifatc' && ac.freq === 'TWR' && ac.state === 'air' && (instrumentHandoff(ac) || c.entry && ac.handoff === 'VIS' && !ac.circuit)) {
            sys(instrumentHandoff(ac) ? `IFATC 3.6.3: ${ac.cs} is on the ${APP_NAME[ac.appr.type]} from Radar. No pattern entry or sequence: just its landing clearance.`
                : `IFATC 3.6.3: ${ac.cs} is on a visual from Radar. No pattern entry: a sequence if it isn't number 1, then its landing clearance.`);
            return false;
        }
        if (!(towerInbound(ac) || ac.circuit || visualSeq) || ac.kind !== 'arr' || ac.state !== 'air' || ac.freq !== 'TWR' || ac.appr?.loc && c.entry) { sys(`${ac.cs} isn't an inbound for you to sequence.`); return false; }
        if (c.contInbound) { ac.contInbound = true; parts.push('continue inbound'); back.push('continuing inbound'); }
        if (c.entry) {
            const { kind, end } = c.entry;
            ac.via = null;
            if (kind === 'S') {
                ac.pattern = { end, kind, pts: patternPoints(ac, kind, end) };
                Object.assign(ac, { expect: end, appr: null, orbit: null, holdAt: null, direct: null, tAlt: patternAlt(), tSpd: Math.min(ac.tSpd, 210) });
            } else {
                // Downwind or base: join the circuit itself (IFATC 3.4), at pattern altitude.
                ac.pattern = null;
                ac.circuit = { end, side: kind.endsWith('L') ? -1 : 1, leg: kind[0] === 'D' ? 'joinDown' : 'joinBase', laps: 0, planned: 0, work: false };
                Object.assign(ac, { expect: end, appr: null, orbit: null, holdAt: null, direct: null, tAlt: circuitAlt(ac), tSpd: Math.min(ac.tSpd, isProp(ac) ? 110 : 210) });
            }
            parts.push(`enter ${PATTERN_SAY[kind]} runway ${end.id}`); back.push(`${PATTERN_SAY[kind]} ${end.id}`);
            // Not first: the sequence and the traffic to follow go with the entry.
            const ahead = trafficAhead2(ac);
            if (ahead && !c.seqLand) { if (ac.circuit) ac.circuit.behind = ahead; parts.push(`number ${landingNumber(ac)}, traffic to follow is on ${legOf(ahead)}`); }
        }
        if (c.seqLand) { const n = landingNumber(ac); parts.push(`number ${n}`); back.push(`number ${n}`); }
    }

    // ---- Tower: the traffic pattern (IFATC 3.4)
    if (c.seqBehind || c.cancelLand) {
        const o = c.seqBehind || trafficAhead2(ac), n = landingNumber(ac);
        if (ac.circuit && o) ac.circuit.behind = o;
        if (c.cancelLand) { ac.landClr = false; ac.optionClr = false; }
        const seq = o ? (G.rules.id === 'ifatc' ? `number ${n}, traffic to follow is on ${legOf(o)}` : `number ${n}, follow the ${typeWord(o)} on ${legOf(o)}`) : `number ${n}`;
        parts.push(c.cancelLand ? `cancel landing clearance, ${seq}` : seq); back.push(c.cancelLand ? `cancel landing clearance, number ${n}` : `number ${n}${o ? ', traffic in sight' : ''}`);
    }
    if (c.descPat) {
        if (ac.state !== 'air') { sys(`${ac.cs} is on the ground.`); return false; }
        ac.tAlt = circuitAlt(ac); parts.push('descend to pattern altitude'); back.push('descending to pattern altitude');
    }
    if (c.radarPattern) {
        // IFATC 3.6.2: pattern work stays with Tower. Only once it's been denied can the circuits still going be handed to Radar, as a radar pattern.
        if (!ac.circuit || ac.appr || ac.state !== 'air' || ac.freq !== 'TWR') { sys(`${ac.cs} isn't in the pattern.`); return false; }
        if (noRadar()) { sys('There is no radar controller to take it.'); return false; }
        if (!hasRemark('noPattern')) { sys('IFATC 3.6.2: pattern work stays with Tower. Hand it to Radar only once pattern work is denied (No pattern work on the ATIS).'); return false; }
        const e = ac.circuit.end;
        atc(`${ac.radio}, contact ${facName('APP')}${G.freqs?.APP ? ' on ' + mhz(G.freqs.APP[0]) : ''} for a radar pattern.`, G.aiActing);
        pilot(ac, `Over to Approach, ${ac.radio}.`);
        Object.assign(ac, { rpCircuit: ac.circuit, circuit: null, landClr: false, optionClr: false, freq: 'APP', handoff: null, expect: e, tSpd: Math.max(ac.tSpd, isProp(ac) ? 110 : 210),
            request: { kind: visualWx() ? 'VIS' : appFor(e), end: e, say: 'a radar pattern', tag: 'RP', radarPattern: true } });
        pilot(ac, `${facName('APP')}, ${ac.radio}, ${fmtAlt(Math.round(ac.alt / 100) * 100)}, request radar pattern runway ${e.id}.`);
        return true;
    }
    if (c.turnCross || c.extUp) {
        const k = ac.circuit;
        if (!k || k.leg !== 'up') { sys(`${ac.cs} isn't on upwind.`); return false; }
        if (c.turnCross) { k.leg = 'cross'; k.extUp = false; parts.push('turn crosswind'); back.push('turning crosswind'); }
        else { k.extUp = true; parts.push("extend upwind, I'll call your crosswind"); back.push('extending upwind'); }
    }
    if (c.extend || c.turnBase || c.short || c.traffic && ac.state === 'air' && !c.option && !c.goAround) {
        const k = ac.circuit;
        if (!k) { sys(`${ac.cs} isn't in the pattern.`); return false; }
        const g = finalGeom(ac, k.end);
        if (c.traffic) { k.side = c.traffic === 'R' ? 1 : -1; parts.push(`make ${c.traffic === 'R' ? 'right' : 'left'} traffic`); back.push(`${c.traffic === 'R' ? 'right' : 'left'} traffic`); }
        if (c.extend) { if (k.leg !== 'down') { sys(`${ac.cs} isn't on downwind.`); return false; } k.ext = true; parts.push("extend downwind, I'll call your base"); back.push('extending downwind'); }
        if (c.turnBase) {
            if (k.leg !== 'down' && k.leg !== 'joinDown') { sys(`${ac.cs} isn't on downwind.`); return false; }
            Object.assign(k, { ext: false, leg: 'base', baseAt: Math.max(g.along, isProp(ac) ? 0.8 : 1.5) });
            parts.push('turn base'); back.push('turning base');
        }
        if (c.short) { Object.assign(k, { short: true, ext: false }); parts.push('make short approach'); back.push('short approach'); }
    }
    if (c.transit) {
        const t = ac.transit;
        if (!t) { sys(`${ac.cs} isn't asking for a transition.`); return false; }
        if (c.transit === 'no') {
            t.ok = false;
            atc(`${ac.radio}, unable transition, remain clear of the airspace.`, G.aiActing);
            pilot(ac, `Remaining clear, ${ac.radio}.`);
            Object.assign(ac, { tHdg: norm(ac.hdg + 120), orbit: null });
            return true;
        }
        const alt = c.transit === 'ok' ? ac.tAlt : c.transit;
        // IFATC 3.4.3 and 3.4.4: inside Tower's airspace (5,000 ft above the field), and clear of the pattern.
        if (!G.aiActing && alt > G.world.elev + 5000) violation(ac, 'IFATC 3.4.3', `${fmtAlt(alt)} is above Tower's airspace (${fmtAlt(G.world.elev + 5000)})`);
        const pat = G.aircraft.filter(a => a.circuit && a.state === 'air');
        const top = pat.length ? Math.max(...pat.map(circuitAlt)) : null;
        if (!G.aiActing && top != null && alt < top + 500) violation(ac, 'IFATC 3.4.4', `${fmtAlt(alt)} leaves less than 500 ft above the pattern at ${fmtAlt(top)}`);
        Object.assign(t, { ok: true }); ac.tAlt = alt; ac.orbit = null; ac.tHdg = t.hdg;
        parts.push(`transition approved${c.transit === 'ok' ? '' : `, maintain ${fmtAlt(alt)}`}`); back.push(`transition approved${c.transit === 'ok' ? '' : ', ' + fmtAlt(alt)}`);
    }

    // ---- Tower: departures (IFATC 3.2)
    if (c.freqChange) {
        if (ac.kind !== 'dep' || ac.state !== 'air' || ac.freq !== 'TWR') { sys(`${ac.cs} isn't a departure still with you.`); return false; }
        if (!G.aiActing && pastRunwayEnd(ac) < 0.5) violation(ac, 'IFATC 3.2.11', `${ac.cs} was switched before half a mile past the runway end, a critical phase of flight`);
        atc(`${ac.radio}, frequency change approved.`, G.aiActing);
        pilot(ac, `Frequency change approved, good day, ${ac.radio}.`);
        departureCheckIn(ac);
        return true;
    }
    if (c.holdShort || c.seqNo) {
        if (ac.state !== 'wait') { sys(`${ac.cs} isn't holding short.`); return false; }
        const n = departureNumber(ac);
        ac.acked = true; ac.remindAt = G.t + 240;
        if (c.seqNo && n > 1) {
            atc(`${ac.radio}, number ${n} for departure.`, G.aiActing);
            pilot(ac, `Number ${n}, ${ac.radio}.`);
        } else {
            if (c.seqNo) sys('IFATC 3.2.2: number 1 for departure gets "hold short".');
            atc(`${ac.radio}, hold short runway ${ac.rwy.id}.`, G.aiActing);
            pilot(ac, `Holding short ${ac.rwy.id}, ${ac.radio}.`);
        }
        return true;
    }
    if (c.immediate) {
        c.takeoff = true;
        const close = G.aircraft.some(a => a.appr?.loc && a.appr.end.phys === ac.rwy.phys && a.appr.along <= 3);
        if (G.rules.id === 'ifatc' && !G.aiActing && !close) violation(ac, 'IFATC 3.2.7', `"Immediate take-off" is for an arrival close in on final; there's none for ${ac.rwy.id}`);
        ac.immediate = true;
    }

    // ---- runway
    if (c.backTaxi) {
        // Back taxi (IF): onto the runway and down it to the full-length end, then lined up.
        if (!['wait', 'taxi'].includes(ac.state) || ac.kind !== 'dep') { sys(`${ac.cs} isn't at the runway.`); return false; }
        ac.inter = null;
        if (c.expedite) ac.expediteUntil = G.t + 90;
        if (ac.state === 'taxi') ac.preClr = 'luaw'; else startLineup(ac, 'luaw');
        parts.push(`back taxi runway ${ac.rwy.id}${c.backTaxi === 'luaw' ? ', line up and wait' : ''}${c.expedite ? ', please expedite' : ''}`);
        back.push(`back taxi ${ac.rwy.id}${c.backTaxi === 'luaw' ? ', line up and wait' : ''}`);
    }
    if (c.exitRwy) {
        const x = c.exitRwy;
        if (ac.state !== 'rollout') { sys(`${ac.cs} isn't rolling out.`); return false; }
        // A turn-off on the side asked for (or any), far enough ahead to make.
        const e = ac.landEnd, run = -finalGeom(ac, e).along, cc = e.course * D2R, exits = (G.ground?.exits.get(e) || []);
        const sideOf = ex => { const n = G.ground.nodes[ex.node]; return (n.x - e.thr.x) * Math.cos(cc) - (n.y - e.thr.y) * Math.sin(cc) > 0 ? 'R' : 'L'; };
        const stop = (ac.spd / 3600) ** 2 * 3600 / (2 * (x.expedite ? 4.5 : 3)) ;
        const pickEx = exits.find(ex => ex.along > run + stop && (!x.side || sideOf(ex) === x.side));
        if (pickEx) ac.exitAt = pickEx; else if (x.side) sys(`No ${x.side === 'L' ? 'left' : 'right'} turn-off ahead for ${ac.cs}: it takes the next one.`);
        if (x.expedite) ac.expediteUntil = G.t + 60;
        const other = x.cross || x.holdShort ? G.world.ends.find(o => o.phys !== e.phys && Math.abs(diff(o.course, e.course)) < 20 && parallelFt(o, e) != null && parallelFt(o, e) < 6000) : null;
        const turn = x.side ? `when able turn ${x.side === 'L' ? 'left' : 'right'}` : 'exit runway when able';
        if (x.holdShort) { ac.toGround = false; ac.exitHold = true; parts.push(`${turn}, hold short runway ${other ? other.id : 'the parallel'}`); }
        else if (x.cross) { ac.toGround = true; ac.preCross = true; parts.push(`${turn}, cross runway ${other ? other.id : 'the parallel'} and contact ground`); }
        else { ac.toGround = true; parts.push(`${turn}, contact ground when off the runway${x.expedite ? ', please expedite' : ''}`); }
        back.push(x.side ? `${x.side === 'L' ? 'left' : 'right'} turn-off` : 'exiting when able');
    }
    if (c.cancelTO) {
        if (ac.state === 'lineup' && ac.lineupThen === 'roll') {
            ac.lineupThen = 'luaw';
            atc(`${ac.radio}, cancel takeoff clearance, line up and wait runway ${ac.rwy.id}.`, G.aiActing);
            pilot(ac, `Cancel takeoff clearance, line up and wait, ${ac.radio}.`);
            return true;
        }
        if (ac.state !== 'roll') { sys(`${ac.cs} isn't on its takeoff roll.`); return false; }
        atc(`${ac.radio}, cancel takeoff clearance, hold position.`, G.aiActing);
        // Too late above 100 kt (IFATC 3.1.3): it's going.
        if (ac.spd >= 100) { pilot(ac, `Unable, ${ac.radio}, too fast to stop.`); return false; }
        ac.state = 'rto';
        pilot(ac, `Rejecting takeoff, ${ac.radio}.`);
        return true;
    }
    if (c.luaw) {
        if (ac.state === 'taxi') ac.preClr = 'luaw'; else startLineup(ac, 'luaw');
        parts.push(G.rules.id === 'ifatc' ? `line up and wait runway ${ac.rwy.id}` : `runway ${ac.rwy.id}, line up and wait`);
        back.push(`line up and wait ${ac.rwy.id}`);
    }
    if (c.takeoff) {
        const w = departureWake(ac);
        if (w) violation(ac, '7110.65 3-9-6', `${ac.cs} rolled ${Math.round(w.since)} seconds after ${w.lead} (${WAKE_NAME[w.wake]}); the wake turbulence interval is ${w.need / 60} minutes`);
        if (ac.state === 'luaw') { ac.state = 'roll'; ac.hdg = ac.rwy.course; rollStarted(ac); }
        else if (ac.state === 'taxi') ac.preClr = 'roll';
        else startLineup(ac, 'roll');
        if (mine(ac)) award(ac, 3);
        const runwayHdg = Math.abs(diff(ac.tHdg, ac.rwy.course)) < 3;
        // Pattern work (IFATC 3.4): the traffic direction goes with the takeoff clearance; left unless told otherwise.
        if (ac.patternWork) ac.patternSide = c.traffic || ac.patternSide || 'L';
        const sidName = !ac.patternWork && !c.hdg && sidFor(ac.gate, ac.rwy)?.id;
        if (c.hdg != null) ac.hdgAssigned = true;
        ac.straightOut = c.rhUntil ? c.rhUntil - G.world.elev : c.hdg == null && G.atisCfg.straight ? G.atisCfg.straight : 0;
        let hdgPart = ac.patternWork ? `make ${ac.patternSide === 'R' ? 'right' : 'left'} traffic` : sidName ? `${sidName} departure` : runwayHdg ? 'fly runway heading' : `fly heading ${hdg3(ac.tHdg)}`;
        // In Infinite Flight the straight out is on the ATIS; in real life it's part of the clearance.
        if (ac.straightOut && G.rules.id !== 'ifatc') hdgPart = `fly runway heading until ${fmtAlt(Math.round((G.world.elev + ac.straightOut) / 100) * 100)}${sidName ? `, then the ${sidName} departure` : ''}`;
        const imm = ac.immediate ? 'immediate ' : '';
        if (G.rules.id === 'ifatc' && !ac.patternWork) {
            // Infinite Flight's own: "(wind), runway XX, cleared for takeoff. Fly runway heading until at or above X,XXXft."
            parts.push(`${wind}, runway ${ac.rwy.id}, cleared for ${imm}takeoff${c.rhUntil ? `. Fly runway heading until at or above ${fmtAlt(c.rhUntil)}ft` : ''}`);
        } else parts.push(`${wind}, runway ${ac.rwy.id}, ${c.rhUntil ? `fly runway heading until at or above ${fmtAlt(c.rhUntil)}` : hdgPart}, cleared for ${imm}takeoff`);
        back.push(`${ac.patternWork ? hdgPart : ac.straightOut && G.rules.id !== 'ifatc' ? hdgPart.replace(/^fly /, '') : sidName ? sidName + ' departure' : runwayHdg ? 'runway heading' : 'heading ' + hdg3(ac.tHdg)}, cleared for ${imm}takeoff ${ac.rwy.id}`);
    }
    if (c.option) {
        // Pattern work: the option (touch and go, stop and go, low approach or full stop) or a touch and go.
        ac.landClr = true; ac.optionClr = true;
        const le = (ac.appr || ac.circuit).end;
        if (c.traffic && ac.circuit) ac.circuit.side = c.traffic === 'R' ? 1 : -1;
        const tr = c.traffic ? `, make ${c.traffic === 'R' ? 'right' : 'left'} traffic` : '';
        parts.push(G.rules.id === 'ifatc' ? `number ${landingNumber(ac)}, runway ${le.id}, cleared for the option${tr}` : `${wind}, runway ${le.id}, cleared ${c.option === 'tg' ? 'touch and go' : 'for the option'}${tr}`);
        back.push(`cleared ${c.option === 'tg' ? 'touch and go' : 'for the option'} ${le.id}`);
    }
    if (c.land) {
        ac.landClr = true; ac.optionClr = false;
        const le = (ac.appr || ac.pattern || ac.circuit).end;
        // IFATC 3.6.3: an ILS or GPS arrival from Radar gets no sequence, only the clearance.
        parts.push(G.rules.id === 'ifatc' ? `${instrumentHandoff(ac) ? '' : `number ${landingNumber(ac)}, `}runway ${le.id}, cleared to land` : `${wind}, runway ${le.id}, cleared to land`);
        back.push(`cleared to land ${le.id}`);
    }

    if (!parts.length) return false;
    atc(`${ac.radio}, ${parts.join(', ')}.`, G.aiActing);
    pilot(ac, `${cap(back.join(', '))}, ${ac.radio}.`);
    return true;
}

/**
 * Where a taxi instruction goes: { kind: 'rwy', end } (a departure's holding
 * point), { kind: 'gate', gate }, or { kind: 'twy', node } (taxi there and
 * hold). `true` means the usual: a departure's runway, an arrival's gate.
 */
function defaultTaxiTarget(ac, want) {
    if (want && typeof want === 'object') return want;
    if (ac.kind === 'dep') {
        const e = typeof want === 'string' ? findEnd(want) : ac.rwy;
        return e ? { kind: 'rwy', end: e } : null;
    }
    if (typeof want === 'string') {
        const g = G.ground.gates.find(x => x.ref.toUpperCase() === want.toUpperCase());
        if (g) return { kind: 'gate', gate: g };
    }
    const stand = ac.stand || freeStand();
    return stand ? { kind: 'gate', gate: stand } : null;
}

/** The route for a taxi instruction, without giving it: { r, purpose, hold } or { err }. Also drives the drag preview. */
function planTaxi(ac, tgt) {
    const gr = G.ground;
    if (!gr) return { err: 'no taxiway map here' };
    if (!tgt) return { err: ac.kind === 'dep' ? 'no such runway' : 'every gate is taken' };
    const dep = ac.kind === 'dep';
    if (ac.state === 'gate') return { err: dep ? 'needs pushback first' : 'parked' };
    const ready = dep ? ['pushed', 'taxi', 'wait'].includes(ac.state) : ['clear', 'taxi'].includes(ac.state);
    if (!ready || ac.purpose === 'exit' && ac.state === 'taxi') return { err: 'not ready to taxi' };
    let goal, purpose;
    if (tgt.kind === 'rwy') {
        if (!dep) return { err: 'landed: taxi it to a gate' };
        const hold = gr.holds.get(tgt.end);
        if (!hold && !tgt.inter) return { err: `no holding point for ${tgt.end.id}` };
        goal = tgt.inter ? tgt.inter.node : hold.node; purpose = 'runway';
    } else if (tgt.kind === 'gate') {
        if (dep) return { err: 'departing: taxi it to a runway' };
        if (G.aircraft.some(a => a !== ac && a.stand === tgt.gate)) return { err: `gate ${tgt.gate.ref} is taken` };
        goal = tgt.gate.node; purpose = 'gate';
    } else { goal = tgt.node.id; purpose = 'point'; }
    const from = nearestNode(gr, ac);
    const r = from && route(gr, from.id, goal);
    if (!r) return { err: 'no taxi route there' };
    r.pts.unshift({ x: ac.x, y: ac.y });
    if (purpose === 'gate') r.pts.push({ x: tgt.gate.x, y: tgt.gate.y });
    withCrossings(gr, r);
    let hold = null;
    if (purpose === 'point') {
        // "Taxi via A, hold short of B": stop just short of the next taxiway at that point.
        const last = r.names[r.names.length - 1];
        const other = [...new Set(tgt.node.edges.map(e => e.name).filter(Boolean))].find(n => n !== last);
        hold = other ? `hold short of ${other}` : `hold on ${last || 'the taxiway'}`;
        if (other && r.len > 0.05) r.stopEarly = 0.02;
    }
    return { r, purpose, hold };
}

/** Route a ground aircraft and read the route out: to a runway, a gate, or a point on a taxiway. */
function taxiClearance(ac, want, parts, back) {
    if (!G.ground) { sys('There is no taxiway map for this airport.'); return false; }
    const tgt = defaultTaxiTarget(ac, want);
    const plan = planTaxi(ac, tgt);
    if (plan.err) { sys(`${ac.cs}: ${plan.err}.`); return false; }
    const { r, purpose, hold } = plan;
    if (purpose === 'runway') { ac.rwy = tgt.end; ac.inter = tgt.inter || null; }
    if (purpose === 'gate') ac.stand = tgt.gate;
    ac.heldAt = hold;
    const wasTower = ac.toTower;
    if (purpose === 'runway' && !G.aiActing && G.coord?.gateHold > G.t && ac.state === 'pushed') {
        G.score -= 3;
        coordSay('TWR', 'GND', `I asked you to hold them at the gate: ${ac.cs} is just going to wait at the runway.`);
    }
    startTaxi(ac, r, purpose);
    // IFATC 2.2.2: "Taxi to RWYXX, contact tower when ready" is the default, and jets are assumed ready at the runway.
    ac.toTower = purpose === 'runway' && (wasTower || G.rules.id === 'ifatc');
    ac.prog = false;
    const via = r.names.join(', ') || 'the taxiway';
    const hs = r.crossings.length ? `, hold short of runway ${crossName(r.crossings[0])}` : '';
    if (!G.rules.taxiVia) {
        // Infinite Flight: by runway or parking; the route is the one on the map.
        const where = purpose === 'runway' ? `runway ${ac.rwy.id}${ac.inter ? ' at ' + ac.inter.name : ''}` : purpose === 'gate' ? 'parking' : null;
        parts.push(where ? `taxi to ${where}${hs}${purpose === 'runway' ? ', contact tower when ready' : ', at your discretion'}` : `taxi as shown, ${hold}${hs}`);
        back.push(where ? `taxi to ${where}${hs}` : `${hold}${hs}`);
    } else if (purpose === 'runway') {
        parts.push(`runway ${ac.rwy.id}, taxi via ${via}${hs}`);
        back.push(`runway ${ac.rwy.id}, via ${via}${hs}`);
    } else if (purpose === 'gate') {
        parts.push(`taxi to gate ${ac.stand.ref} via ${via}${hs}`);
        back.push(`gate ${ac.stand.ref} via ${via}${hs}`);
    } else {
        parts.push(`taxi via ${via}${hs}, ${hold}`);
        back.push(`via ${via}${hs}, ${hold}`);
    }
    return true;
}

/** A departure at its holding point goes over to Tower and calls ready. */
function toTower(ac) {
    Object.assign(ac, { freq: 'TWR', toTower: false, remindAt: G.t + (G.rules.id === 'ifatc' ? 60 : 240), waitSince: ac.waitSince || G.t, acked: false });
    if (G.positions.has('GND')) award(ac, 3);
    pilot(ac, `${facName('TWR')}, ${ac.radio}, holding short runway ${ac.rwy.id}, ready for departure${ac.patternWork ? ', remaining in the pattern' : ''}.`);
}

/** An arrival clear of the runway goes over to Ground and asks for its gate. */
function toGround(ac) {
    Object.assign(ac, { freq: 'GND', toGround: false });
    ac.stand = ac.stand || freeStand();
    pilot(ac, `${facName('GND')}, ${ac.radio}, clear of ${ac.landEnd.id}${ac.exitTwy ? ' at ' + ac.exitTwy : ''}, taxi to ${ac.stand ? 'gate ' + ac.stand.ref : 'the ramp'}.`);
}

function startTaxi(ac, r, purpose) {
    ac.route = r; ac.s = 0; ac.purpose = purpose; ac.state = 'taxi'; ac.holdPos = false; ac.crossReq = null;
    ac.spd = Math.max(ac.spd, 0);
}

/** Onto the runway from the holding point, then line up and wait or roll. */
/* ---- No radar (IFATC 3.3): with Approach closed, Tower takes the inbounds ---- */

/** Approach closed (the start option "Inbounds: pattern entries"): arrivals call Tower and get a pattern entry (IFATC 3.3). */
const noRadar = () => !!G && G.opts.radar === 'none' && !G.positions.has('APP');
/**
 * An arrival Tower sequences itself, with a pattern entry: every inbound with no radar; with radar, the ones
 * Radar handed over on radar vectors or flight following (IFATC 3.6.3).
 */
const towerInbound = ac => ac.kind === 'arr' && ac.freq === 'TWR' && !ac.appr?.loc && !ac.circuit && !ac.transit && (noRadar() || ac.handoff === 'RV' || ac.handoff === 'FF');
/** Handed to Tower on an instrument approach (ILS, GPS): with radar, that's a landing clearance and nothing else (IFATC 3.6.3). */
const instrumentHandoff = ac => !noRadar() && !ac.circuit && !!ac.appr && ac.appr.type !== 'VIS' && !['VIS', 'RV', 'FF'].includes(ac.handoff);
const HANDOFF_SAY = { RV: 'radar vectors', FF: 'flight following' };
/** Radar can hand an arrival not on an approach to Tower (IFATC 3.6.3): Infinite Flight rules, VMC, within 15 miles. */
const radarVectorsOk = ac => G.rules.id === 'ifatc' && visualWx() && ac.state === 'air' && !ac.circuit && Math.hypot(ac.x, ac.y) < 15;

/** On Tower's frequency after a radar vectors or flight following handover: where it is, and what it's with you on. */
function towerCheckInVfr(ac) {
    const d = Math.hypot(ac.x, ac.y);
    Object.assign(ac, { request: null, holdAt: null, via: null, viaSaved: null, noEntryFlagged: false });
    pilot(ac, `${facName('TWR')}, ${ac.radio}, ${Math.max(1, Math.round(d))} miles ${compass(brg(ac.x, ac.y))}, ${fmtAlt(Math.round(ac.alt / 100) * 100)}, inbound for landing with you on ${HANDOFF_SAY[ac.handoff]}, information ${PHONETIC[G.atis]}.`);
}

/** A VFR light aircraft inbound to land, with radar (IFATC 3.6.3): it asks Approach for radar vectors or flight following, and Radar hands it to Tower. */
function spawnVfrInbound() {
    const id = makeGACallsign([...PROPS]);
    if (!id) return false;
    const b = rand(0, 360) * D2R, r = rand(20, SCOPE_NM - 1), x = Math.sin(b) * r, y = Math.cos(b) * r;
    if (G.aircraft.some(a => airborne(a) && Math.hypot(a.x - x, a.y - y) < 5)) return false;
    const hdg = brg(-x, -y), alt = Math.round((G.world.elev + rand(2500, 4500)) / 500) * 500, vfrIn = Math.random() < 0.5 ? 'RV' : 'FF';
    const ac = { id: nextId++, ...id, kind: 'arr', state: 'air', perf: perf(id.type), x, y, alt, hdg, spd: 120, tHdg: hdg, tAlt: alt, tSpd: 120, turn: null,
        trail: [], trailT: 0, born: G.t, freq: 'APP', expect: pick(G.active.arr), vfrIn, asked: true };
    G.aircraft.push(ac);
    pilot(ac, `${facName('APP')}, ${ac.radio}, ${Math.round(r)} miles ${compass(brg(x, y))}, ${fmtAlt(alt)}, VFR inbound for landing, information ${PHONETIC[G.atis]}, ${vfrIn === 'RV' ? 'request vectors to the field' : 'request flight following'}.`);
    return true;
}
const patternAlt = () => Math.max(G.world.minAlt, Math.round((G.world.elev + 2000) / 100) * 100);
const PATTERN_SAY = { S: 'straight in', DL: 'left downwind', DR: 'right downwind', BL: 'left base', BR: 'right base' };

/** The legs of a pattern entry, as points to fly through, ending on the centerline 6.5 miles out. */
function patternPoints(ac, kind, end) {
    const side = kind.endsWith('L') ? -1 : 1, P = (along, off) => ptOnFinal(end, along, off * side);
    const F = P(6.5, 0);
    if (kind === 'S') return finalGeom(ac, end).along > 13 ? [P(12, 0), F] : [F];
    if (kind[0] === 'B') return [P(8.5, 3), F];
    return [P(-end.len / 2, 3), P(8.5, 3), F];                  // downwind abeam midfield, base turn, final
}

/** Where an arrival is in Tower's landing order for its runway: by how far it still has to fly. */
function landingNumber(ac) {
    const endOf = a => a.appr?.end || a.pattern?.end || a.circuit?.end || a.expect;
    const left = a => a.appr?.loc ? a.appr.along
        : a.circuit ? circuitLeft(a)
        : a.pattern ? a.pattern.pts.reduce((t, p, i, arr) => t + Math.hypot(p.x - (i ? arr[i - 1].x : a.x), p.y - (i ? arr[i - 1].y : a.y)), 6.5)
        : Math.hypot(a.x, a.y) + 10;
    const e = endOf(ac);
    const q = G.aircraft.filter(a => a.kind === 'arr' && a.state === 'air' && a.freq === 'TWR' && !a.transit && !a.divert && endOf(a) && sameRunwayish(endOf(a), e)).sort((a, b) => left(a) - left(b));
    return q.indexOf(ac) + 1;
}

/* ---- Infinite Flight's message lists, word for word: Misc. messages, Deny entry and Broadcast ---- */

/** [key, menu label, what's sent (after the callsign), what the pilot does] — fx: expedite, divert, noPattern, flavour otherwise. */
const MISC_COMMON = [
    ['follow', 'Follow instructions (simple)', 'please follow instructions'],
    ['followRep', 'Follow instructions (report)', 'please follow instructions or you will be reported'],
    ['guide', 'Check user guide', 'please check the User Guide from the Home Screen for help using ATC instructions'],
    ['dup', 'Duplicate messages', 'please avoid sending duplicate messages'],
    ['stay', 'Stay on my frequency', 'stay on my frequency'],
    ['exp', 'Please expedite', 'please expedite', 'expedite'],
    ['busy', 'Freq busy, be patient', 'frequency is busy, please be patient'],
    ['cs', 'Change callsign', 'please change callsign or you will be reported'],
    ['large', 'Aircraft too large', 'aircraft is too large for this airport', 'divert'],
    ['divert', 'Unable, divert', 'airport is unable to accept arriving traffic. Please divert to a suitable airport', 'divert'],
    ['light', 'No light aircraft', 'no light aircraft accepted at this time. Please divert to a more appropriate airport', 'divert'],
    ['alert', 'Traffic alert', 'traffic alert, check surroundings immediately'],
    ['atis', 'Check ATIS', 'check ATIS frequency for Airfield information'],
    ['rwy', 'Check runway', 'please check runway assignment'],
];
const MISC_GND = [
    ['waitTaxi', 'Wait for clearance', 'please wait for clearance before taxiing!'],
    ['waitCross', 'Wait for clearance before crossing runway', 'please wait for clearance before crossing the runway!'],
    ['notRwy', 'Not cleared on runway', 'you were not cleared to enter the runway, please exit the runway.'],
    ['notTwy', 'Not a taxiway', 'this is not a taxiway'],
    ['grass', 'Taxi through grass', 'do not taxi through grass'],
    ['line', "Don't cut in line", 'please do not cut in line'],
    ['dist', 'Maintain safe distance', 'maintain safe distance with aircraft ahead please'],
    ['dupFreq', 'Duplicate frequency change', 'you were already instructed to change frequency'],
    ['sid', 'Amend FPL with SID', 'please amend flight plan to include ATC preferred Standard Instrument Departure'],
];
const MISC_TWR = [
    ['waitTO', 'Wait for clearance before takeoff', 'please wait for clearance before taking off!'],
    ['waitLdg', 'Wait for clearance before landing', 'please wait for clearance before landing!'],
    ['already', 'Already cleared to land', 'you were already cleared to land, avoid unnecessary reports'],
    ['exitRwy', 'Exit runway', 'you were not cleared to enter the runway, please exit the runway'],
    ['noPat', 'No pattern work', 'Tower is not accepting pattern work at this time', 'noPattern'],
    ['patFull', 'Pattern full', 'pattern is full, no pattern work accepted at this time', 'noPattern'],
    ['noInt', 'No intersection departures', 'no intersection departures allowed'],
    ['noMore', 'No more pattern work, land or divert', 'Tower is no longer accepting pattern work. Please land or divert', 'noPattern'],
    ['rwy2', 'Check runway (last one)', 'please double check runway assignment'],
];
const DENY_ENTRY = [
    ['full', 'Airport is full', 'due to heavy traffic, airport is not accepting incoming airplanes at this time', 'divert'],
    ['event', 'Event in progress', 'an event is in progress, please contact approach for sequencing', 'divert'],
];
/** Broadcasts, to everyone on frequency: "Attention all aircraft, …". */
const BROADCASTS = [
    ['closed', 'Facility is closed', pos => `${pos} frequency is now closed, good day!`],
    ['closing', 'Closing in 10 minutes', pos => `${pos} is closing in 10 minutes`],
    ['first', 'Request takeoff when 1st', () => 'please only request takeoff when first in line'],
    ['atis', 'Notify ATIS update', () => `ATIS information ${PHONETIC[G.atis]} is now current`],
    ['noPat', 'No pattern work', () => 'no Pattern Work accepted at this time'],
    ['delays', 'Expect delays', () => 'airport is busy, expect delays'],
    ['checkAtis', 'Check ATIS', () => 'check ATIS frequency for airport information'],
    ['fpl', 'Req. FPL before taxi', () => 'please file a flight plan before requesting taxi'],
    ['busy', 'Frequency busy', () => 'frequency is busy, transmit important messages'],
    ['change', 'Controller change', () => 'controller change is in progress, please standby'],
    ['rwyChange', 'Runway change', () => 'runway change is in progress'],
    ['restr', 'Notify airport restrictions', () => 'please check current airport restrictions. NOTAM will be enforced by reports'],
];
const MISC_REPLY = { exp: 'Expediting', divert: 'Diverting', alert: 'Looking', stay: 'Staying with you', busy: 'Standing by', atis: 'Checking ATIS', rwy: 'Checking', rwy2: 'Checking' };

/** A message from the lists: said, read back, and acted on where there's something to do. */
function sayMessage(ac, m) {
    const [k, , text, fx] = m;
    atc(`${ac.radio}, ${text}`, G.aiActing);
    if (fx === 'expedite') ac.expediteUntil = G.t + 90;
    if (fx === 'divert') {
        if (ac.state === 'air') {
            // Turns away and climbs out; leaves without counting against you.
            Object.assign(ac, { divert: true, appr: null, pattern: null, circuit: null, request: null, landClr: false, via: null, viaSaved: null, holdAt: null, orbit: null, direct: null,
                tHdg: brg(ac.x, ac.y), tAlt: Math.max(ac.tAlt, Math.round((G.world.elev + 4000) / 1000) * 1000) });
            pilot(ac, `Diverting, ${ac.radio}.`);
        } else { pilot(ac, `Roger, ${ac.radio}, we'll go elsewhere.`); ac.gone = true; }
        return true;
    }
    if (fx === 'noPattern') {
        if (ac.circuit) { ac.circuit.work = false; ac.optionClr = false; pilot(ac, `Full stop on this one, ${ac.radio}.`); return true; }
        if (ac.patternWork && ac.state !== 'air') { ac.patternWork = false; pilot(ac, `Roger, we'll depart, ${ac.radio}.`); return true; }
    }
    pilot(ac, `${MISC_REPLY[k] || 'Roger'}, ${ac.radio}.`);
    return true;
}

/* ---- The traffic pattern (IFATC 3.4): upwind, crosswind, downwind, base, final ---- */

const isProp = ac => !!ac.perf.prop;
/** Pattern altitude: 1,000 ft above the field for props, 1,500 for jets (IFATC 3.4.1). */
const circuitAlt = ac => Math.round((G.world.elev + (isProp(ac) ? 1000 : 1500)) / 100) * 100;
const LEG_SAY = { up: 'upwind', cross: 'crosswind', down: 'downwind', joinDown: 'downwind', base: 'base', joinBase: 'base', final: 'final' };
const LEG_TAG = { up: 'UPW', cross: 'XWD', down: 'DWN', joinDown: 'DWN', base: 'BASE', joinBase: 'BASE', final: 'FNL' };
/** The leg an aircraft is on, as a pilot would say it. */
const legOf = a => a.circuit ? LEG_SAY[a.appr ? 'final' : a.circuit.leg] : a.appr?.loc || a.pattern?.pts.length === 1 ? 'final' : a.pattern ? (a.pattern.kind[0] === 'B' ? 'base' : 'downwind') : 'final';

/** Just airborne on pattern work: into the circuit on the runway it left, left or right as cleared. */
function startCircuit(ac) {
    Object.assign(ac, {
        kind: 'arr', expect: ac.rwy, via: null, sid: null, freq: 'TWR', tAlt: circuitAlt(ac), tSpd: isProp(ac) ? 90 : 200,
        circuit: { end: ac.rwy, side: ac.patternSide === 'R' ? 1 : -1, leg: 'up', laps: 0, planned: 2 + Math.floor(Math.random() * 3), work: true },
    });
}

/** Where the legs are: downwind 1 NM out for props, 1.5 for jets; base 1.5 / 2.5 NM from the threshold (less on a short approach). */
function circuitGeom(ac) {
    const k = ac.circuit, e = k.end, prop = isProp(ac);
    return {
        off: (prop ? 1 : 1.5) * k.side,
        baseAt: k.baseAt ?? (k.short ? (prop ? 0.8 : 1.5) : (prop ? 1.5 : 2.5)),
        upEnd: -(e.len + (prop ? 0.5 : 1)),
        P: (along, off) => ptOnFinal(e, along, off),
    };
}

function circuitNav(ac) {
    const k = ac.circuit, g = circuitGeom(ac), e = k.end, prop = isProp(ac), fg = finalGeom(ac, e), alt = circuitAlt(ac);
    const go = p => { ac.tHdg = brg(p.x - ac.x, p.y - ac.y); ac.turn = null; ac.direct = null; ac.holdAt = null; };
    // Turns start a turn radius early, as a pilot leads them, so a jet doesn't circle a corner it can't make.
    const radius = ac.spd * (1 + ac.alt / 1000 * 0.02) / 3600 / (turnRate(ac) * D2R);
    const near = (p, r) => Math.hypot(p.x - ac.x, p.y - ac.y) < Math.max(r, radius * 0.9);
    if (k.leg === 'up') {
        const p = g.P(k.extUp ? Math.min(g.upEnd, fg.along - 1) : g.upEnd, 0);
        go(p); ac.tAlt = alt; ac.tSpd = prop ? 90 : 200;
        // Crosswind once past the runway end and within 300 ft of pattern altitude (unless extending upwind).
        if (!k.extUp && (near(p, 0.4) || fg.along < -e.len - 0.2 && ac.alt > alt - 300)) k.leg = 'cross';
    } else if (k.leg === 'cross' || k.leg === 'joinDown') {
        // Crosswind to the downwind; or joining it at 45° to midfield.
        const p = k.leg === 'cross' ? g.P(g.upEnd, g.off) : g.P(-e.len / 2, g.off);
        go(p); ac.tAlt = alt;
        if (near(p, 0.4)) k.leg = 'down';
    } else if (k.leg === 'joinBase') {
        const p = g.P(g.baseAt, g.off * 1.2);
        go(p); ac.tAlt = alt;
        if (near(p, 0.5)) k.leg = 'base';
    } else if (k.leg === 'down') {
        ac.tAlt = alt; ac.tSpd = prop ? 90 : 180;
        if (k.work && k.laps >= k.planned && !k.askedStop) { k.askedStop = true; k.work = false; pilot(ac, `${facName('TWR')}, ${ac.radio}, downwind runway ${e.id}, request full stop.`); }
        // Turn base at the base point, unless told to extend, or still behind the traffic to follow (or anyone close on final: see and avoid).
        const space = prop ? 1.2 : 2;
        const lead = k.behind && !k.behind.gone && k.behind.state === 'air' ? k.behind : null;
        const leadOk = !lead || (lead.appr && lead.appr.along < g.baseAt - space);
        const cut = G.aircraft.some(o => o !== ac && o.state === 'air' && o.appr && o.appr.end.phys === e.phys && o.appr.along > g.baseAt - space && o.appr.along < g.baseAt + 4);
        const wait = k.ext || !leadOk || cut;
        go(g.P(wait ? Math.max(g.baseAt, fg.along + 1) : g.baseAt, g.off));
        if (!wait && fg.along >= g.baseAt - 0.1) { k.leg = 'base'; k.baseAt = Math.max(g.baseAt, fg.along); }
        if (fg.along > 7 && !k.askedBase) { k.askedBase = true; pilot(ac, `Tower, ${ac.radio}, ${Math.round(fg.along)} miles on an extended downwind, request base.`); }
    }
    if (k.leg === 'base') {
        const bAt = circuitGeom(ac).baseAt;
        go(g.P(bAt, 0));
        ac.tAlt = Math.round(G.world.elev + bAt * GS_FT_PER_NM); ac.tSpd = prop ? 80 : 160;
        // Onto final, as on any approach: capture the centerline and come down the glidepath.
        if (Math.abs(fg.xt) < Math.max(Math.abs(g.off) * 0.45, radius * 0.9)) { k.leg = 'final'; joinFinal(ac, e, 'VIS'); }
    }
}

/** A touch and go: off the runway again, round the pattern for another (IFATC 3.4). */
function touchAndGo(ac, e) {
    G.stats.touchGo = (G.stats.touchGo || 0) + 1;
    if (mine(ac)) award(ac, 2);
    G.occupied.set(e.phys, G.t + 15);
    Object.assign(ac, { appr: null, landClr: false, optionClr: false, alt: G.world.elev + 30, hdg: e.course, tHdg: e.course, tAlt: circuitAlt(ac), vs: 0, rr: 0,
        spd: Math.max(ac.perf.vr + 5, ac.spd - 10), tSpd: isProp(ac) ? 90 : 200 });
    Object.assign(ac.circuit, { leg: 'up', laps: ac.circuit.laps + 1, behind: null, ext: false, short: false, baseAt: undefined, askedBase: false });
}

/** The aircraft just ahead in the landing order for the same runway, if any. */
function trafficAhead2(ac) {
    const n = landingNumber(ac);
    if (n < 2) return null;
    const e = ac.appr?.end || ac.pattern?.end || ac.circuit?.end || ac.expect;
    return G.aircraft.filter(a => a !== ac && a.kind === 'arr' && a.state === 'air' && a.freq === 'TWR' && !a.transit && !a.divert && sameRunwayish(a.appr?.end || a.pattern?.end || a.circuit?.end || a.expect || e, e))
        .find(a => landingNumber(a) === n - 1) || null;
}

/** How far an aircraft still has to fly to the threshold, for landing order. */
function circuitLeft(a) {
    const k = a.circuit, g = circuitGeom(a), e = k.end, fg = finalGeom(a, e), off = Math.abs(g.off);
    if (a.appr) return a.appr.along;
    if (k.leg === 'base') return Math.abs(fg.xt) + g.baseAt;
    if (k.leg === 'down') return Math.max(0, g.baseAt - fg.along) + off + g.baseAt;
    return e.len * 2 + off * 2 + g.baseAt + 2;
}

/* ---- Transitions through Tower's airspace (IFATC 3.4.2) ---- */

/** A VFR aircraft crossing the field's airspace, below 5,000 ft above it, which asks Tower first. */
function spawnTransit() {
    const id = makeGACallsign([...PROPS]);
    if (!id) return false;
    const b = rand(0, 360) * D2R, r = SCOPE_NM - 0.5, x = Math.sin(b) * r, y = Math.cos(b) * r;
    const hdg = norm(brg(-x, -y) + rand(-15, 15)), alt = Math.round((G.world.elev + rand(2000, 4500)) / 500) * 500;
    const ac = { id: nextId++, ...id, kind: 'arr', state: 'air', perf: perf(id.type), x, y, alt, hdg, spd: 110, tHdg: hdg, tAlt: alt, tSpd: 110, turn: null,
        trail: [], trailT: 0, born: G.t, freq: 'TWR', transit: { asked: false, ok: null, hdg, from: compass(brg(x, y)), to: compass(hdg) } };
    G.aircraft.push(ac);
    return true;
}
const compass = h => ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(norm(h) / 45) % 8];

function transitNav(ac) {
    const t = ac.transit, d = Math.hypot(ac.x, ac.y);
    if (!t.asked && d < 12) {
        t.asked = true;
        pilot(ac, `${facName('TWR')}, ${ac.radio}, ${Math.round(d)} miles ${t.from}, ${fmtAlt(ac.alt)}, request transition through your airspace ${t.to}bound.`);
    }
    // Not answered by 6 miles: it orbits outside rather than come in uncleared.
    if (t.ok === null && t.asked && d < 7 && !ac.orbit) ac.orbit = { dir: 'L', rem: 360 };
    if (t.ok === null && ac.orbit && ac.orbit.rem < 20) ac.orbit.rem = 360;
    // Gone once it's out the far side (or turned away).
    if (d > SCOPE_NM - 1 && Math.cos((ac.hdg - brg(ac.x, ac.y)) * D2R) > 0) ac.gone = true;
}

/** Flying a pattern entry, or inbound waiting for one (no entry by 8 miles: IFATC 3.3.2). */
function patternNav(ac) {
    if (ac.pattern) {
        const wp = ac.pattern.pts[0];
        ac.tHdg = brg(wp.x - ac.x, wp.y - ac.y); ac.turn = null; ac.orbit = null; ac.direct = null; ac.holdAt = null;
        if (Math.hypot(wp.x - ac.x, wp.y - ac.y) < 0.7) {
            ac.pattern.pts.shift();
            if (ac.pattern.pts.length === 1) ac.tSpd = Math.min(ac.tSpd, 180);
            if (!ac.pattern.pts.length) {
                // On the centerline: onto the approach, cutting in to capture, keeping any landing clearance.
                joinFinal(ac, ac.pattern.end, ac.pattern.type || 'VIS');
                ac.pattern = null;
            }
        }
        return;
    }
    const d = Math.hypot(ac.x, ac.y);
    if (d > 8) { if (!ac.orbit) { ac.tHdg = brg(-ac.x, -ac.y); ac.turn = null; } return; }
    if (!ac.noEntryFlagged) {
        ac.noEntryFlagged = true;
        violation(ac, HANDOFF_SAY[ac.handoff] ? 'IFATC 3.6.3' : 'IFATC 3.3.2', `${ac.cs} reached the pattern without a pattern entry`);
        pilot(ac, `Tower, ${ac.radio}, 8 miles out, request pattern entry, we'll orbit here.`);
    }
    if (!ac.orbit) ac.orbit = { dir: 'L', rem: 360 };
}

/** A departure checks in with Departure (Approach). */
function departureCheckIn(ac) {
    ac.freq = 'APP';
    if (noRadar()) return;                         // no Departure on: it's on its own navigation
    pilot(ac, `${facName('DEP')}, ${ac.radio}, ${fmtAlt(Math.round(Math.max(ac.alt, G.world.elev + 500) / 100) * 100)} climbing ${fmtAlt(ac.tAlt)}.`);
    atc(`${ac.radio}, ${facName('DEP')}, radar contact.`, !G.positions.has('APP'));
}

/** How far past the departure end of its runway an airborne departure is, in NM (negative: still over it). */
function pastRunwayEnd(ac) {
    const e = ac.rwy, c = e.course * D2R;
    return (ac.x - e.thr.x) * Math.sin(c) + (ac.y - e.thr.y) * Math.cos(c) - e.len;
}

/**
 * Departures still with Tower (Infinite Flight mode): the system's Tower hands
 * them off half a mile past the end; the player's has until 3 miles.
 */
function towerDepartures() {
    for (const ac of G.aircraft) {
        if (ac.kind !== 'dep' || ac.state !== 'air' || ac.freq !== 'TWR') continue;
        const past = pastRunwayEnd(ac);
        if (!G.positions.has('TWR')) { if (past >= 0.5) ai(ac, { freqChange: true }); }
        else if (past >= 3) {
            G.score -= 2;
            sys(`IFATC 3.2.11: ${ac.cs} should have been handed to Departure half a mile past the runway end.`, 'bad');
            atc(`${ac.radio}, frequency change approved.`, true);
            departureCheckIn(ac);
        }
    }
}

/** Departures holding short of a runway, in the order they got there (IFATC 3.2.2): a lined-up one counts as number 1. */
function departureNumber(ac) {
    const q = G.aircraft.filter(a => a.kind === 'dep' && a.state === 'wait' && a.freq === 'TWR' && a.rwy === ac.rwy).sort((a, b) => (a.waitSince || 0) - (b.waitSince || 0));
    const lined = G.aircraft.some(a => a !== ac && (a.state === 'luaw' || (a.state === 'lineup' && a.lineupThen === 'luaw')) && a.rwy.phys === ac.rwy.phys);
    return q.indexOf(ac) + 1 + (lined ? 1 : 0);
}

/**
 * A takeoff roll begins: IFATC 3.1.1 (in Infinite Flight mode) — the departure
 * ahead must be airborne, and an arrival ahead clear of the runway edge.
 * Anticipated clearances (3.1.2) are fine as long as this holds when it rolls.
 */
function rollStarted(ac) {
    if (G.rules.id !== 'ifatc' || !mine(ac)) return;
    const ahead = G.aircraft.find(o => o !== ac && onRunwayPhys(o) === ac.rwy.phys && o.state !== 'luaw' && o.state !== 'lineup');
    if (ahead) violation(ac, 'IFATC 3.1.1', ahead.state === 'roll' ? `${ac.cs} started its roll before ${ahead.cs} was airborne` : `${ac.cs} started its roll with ${ahead.cs} still on the runway`);
}

function startLineup(ac, then) {
    ac.lineupThen = then;
    if (!G.ground || !G.ground.holds.get(ac.rwy)) {
        Object.assign(ac, { x: ac.rwy.thr.x, y: ac.rwy.thr.y, hdg: ac.rwy.course });
        ac.state = then;
        if (then === 'roll') rollStarted(ac);
        return;
    }
    const hold = G.ground.holds.get(ac.rwy), c = ac.rwy.course * D2R, along = ac.inter ? ac.inter.along : hold.along;
    ac.lineupAt = { x: ac.rwy.thr.x + Math.sin(c) * along, y: ac.rwy.thr.y + Math.cos(c) * along };
    ac.state = 'lineup';
    ac.spd = ac.immediate ? 14 : 8;
}

/** A Super or Heavy left this runway (or a close parallel) too recently: 2 minutes, 3 behind a Super. */
function departureWake(ac) {
    if (!G.rules.wake) return null;
    for (const e of G.world.ends) {
        if (!sameRunwayish(e, ac.rwy) && e.phys !== ac.rwy.phys) continue;
        const w = G.depWake.get(e.phys);
        if (!w) continue;
        if (w.wake === 'S' && ac.perf.wake === 'S') continue;
        const need = w.wake === 'S' ? 180 : 120;
        const since = G.t - w.t;
        if (since < need) return { since, need, lead: w.cs, wake: w.wake };
    }
    return null;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function cancelApproach(ac) { ac.appr = null; }

function goAround(ac, reason, notYourFault) {
    ac.wentAround = reason || 'ordered';
    const e = ac.appr ? ac.appr.end : null;
    if (ac.freq === 'TWR') learnFromGoAround(e, reason);
    ac.appr = null; ac.direct = null; ac.holdAt = null; ac.orbit = null; ac.turn = null; ac.landClr = false;
    if (e) ac.tHdg = e.course;
    // Missed approach: runway heading, climbing clear of the terrain along it, back to Approach for another go.
    const ahead = e ? { x: ac.x + Math.sin(e.course * D2R) * 15, y: ac.y + Math.cos(e.course * D2R) * 15 } : ac;
    ac.tAlt = Math.max(G.world.minAlt, ac.missedAlt || Math.ceil((G.world.elev + 3000) / 1000) * 1000, mvaCeilingWithin(4), terrainOn() ? Math.ceil(maxMvaAlong(ac, ahead) / 1000) * 1000 : 0);
    // In the pattern it flies upwind and goes round again; no radar: it stays with Tower and needs a new pattern entry (IFATC 3.3).
    if (ac.circuit) { Object.assign(ac.circuit, { leg: 'up', behind: null, ext: false, short: false, baseAt: undefined }); ac.optionClr = false; ac.tAlt = circuitAlt(ac); ac.tSpd = isProp(ac) ? 90 : 200; ac.freq = 'TWR'; }
    else if (noRadar()) Object.assign(ac, { pattern: null, noEntryFlagged: false });
    else if (ac.freq === 'TWR' && HANDOFF_SAY[ac.handoff]) Object.assign(ac, { pattern: null, noEntryFlagged: true });
    else if (ac.freq === 'TWR') ac.freq = 'APP';
    if (!ac.circuit) ac.tSpd = 210;
    G.stats.goArounds++;
    if (!notYourFault && mine(ac)) award(ac, -3);
    pilot(ac, `${ac.radio}, going around${reason ? ', ' + reason : ''}.`);
    if (reason) toast(`${ac.cs} going around — ${reason}`, 'bad');
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Weather                                                             */
/* ------------------------------------------------------------------ */

/** Ceiling (ft above the field, null for none) and visibility (SM). Below CAT I minimums now and then. */
function makeMet() {
    if (!G.opts.weather) return { ceil: null, vis: 10, wx: '', gust: 0 };
    const r = Math.random();
    const ceil = r < 0.08 ? 100 : r < 0.35 ? Math.round(rand(3, 9)) * 100 : r < 0.75 ? Math.round(rand(10, 30)) * 100 : Math.round(rand(35, 60)) * 100;
    const vis = ceil <= 100 ? 0.25 : ceil < 1000 ? pick([1, 1.5, 2, 3]) : pick([3, 5, 7, 10]);
    const wx = ceil < 1000 ? pick(['-RA', 'RA', 'BR']) : G.wx.length ? 'VCTS' : '';
    return { ceil, vis, wx, gust: G.wind.spd >= 12 ? G.wind.spd + Math.round(rand(6, 12)) : 0 };
}
const below = m => m.ceil != null && (m.ceil < 200 || m.vis < 0.5);
const VIS = { 0.25: '1/4', 0.5: '1/2', 1.5: '1 1/2' };
const metText = m => `${m.ceil == null ? 'SKC' : 'OVC' + String(Math.round(m.ceil / 100)).padStart(3, '0')} ${VIS[m.vis] || m.vis}SM ${m.wx}`.trim();

/** A storm cell: a cluster of blobs drifting with the wind aloft, building then decaying. */
function spawnCell(anywhere) {
    const aloft = norm(G.wind.dir + rand(0, 40));                 // from
    const sp = rand(15, 30) / 3600;                                // NM/s
    let x, y;
    if (anywhere) { const b = rand(0, 360) * D2R, r = rand(8, 34); x = Math.sin(b) * r; y = Math.cos(b) * r; }
    else {
        const b = (aloft + rand(-50, 50)) * D2R;
        x = Math.sin(b) * (SCOPE_NM + 4); y = Math.cos(b) * (SCOPE_NM + 4);
    }
    const blobs = [];
    const size = rand(2.5, 5.5);
    for (let i = 0, k = Math.floor(rand(3, 6)); i < k; i++) blobs.push({ dx: rand(-1, 1) * size, dy: rand(-1, 1) * size, r: size * rand(0.6, 1.1) });
    G.wx.push({ id: nextId++, x, y, vx: -Math.sin(aloft * D2R) * sp, vy: -Math.cos(aloft * D2R) * sp, blobs,
        age: anywhere ? rand(0, 1500) : 0, life: rand(2400, 4200) });
}
const cellStrength = c => Math.max(0, Math.sin(Math.PI * c.age / c.life));

/** Precipitation level at a point: 0 none, 1 light, 2 moderate, 3 heavy/thunderstorm. */
function wxLevel(x, y) {
    let lvl = 0;
    for (const c of G.wx) {
        const k = cellStrength(c);
        if (k < 0.15) continue;
        for (const b of c.blobs) {
            const d = Math.hypot(x - c.x - b.dx, y - c.y - b.dy) / (b.r * k);
            const l = d < 0.4 ? 3 : d < 0.7 ? 2 : d < 1 ? 1 : 0;
            if (l > lvl) lvl = l;
            if (lvl === 3) return 3;
        }
    }
    return lvl;
}
const heavyAhead = (ac, hdg, from = 1, to = 8) => {
    for (let d = from; d <= to; d += 1) {
        if (wxLevel(ac.x + Math.sin(hdg * D2R) * d, ac.y + Math.cos(hdg * D2R) * d) === 3) return true;
    }
    return false;
};

function weather(dt) {
    for (const c of G.wx) { c.x += c.vx * dt; c.y += c.vy * dt; c.age += dt; }
    G.wx = G.wx.filter(c => c.age < c.life && Math.hypot(c.x, c.y) < SCOPE_NM + 12);
    if (G.t >= G.nextCell) {
        G.nextCell = G.t + rand(300, 700);
        if (G.wx.length < 6 && G.rules.storms) spawnCell(false);
    }
    // A spell below minimums never lasts long.
    if (below(G.met) && !G.metBelowUntil) G.metBelowUntil = G.t + rand(300, 480);
    if (G.metBelowUntil && G.t >= G.metBelowUntil) {
        G.metBelowUntil = 0;
        G.met = { ...G.met, ceil: Math.round(rand(3, 8)) * 100, vis: pick([1, 2, 3]) };
        G.atis = (G.atis + 1) % 26;
        sys(`Information ${PHONETIC[G.atis]}: ${metText(G.met)}, ceiling back above minimums.`, 'good');
    }
    // Pilots look ahead every couple of seconds.
    if ((G.wxT = (G.wxT || 0) + dt) < 2) return;
    G.wxT = 0;
    for (const ac of G.aircraft) {
        if (!airborne(ac)) continue;
        const lvl = wxLevel(ac.x, ac.y);
        if (lvl === 3) {
            ac.inCell = ac.inCell || new Set();
            const cell = G.wx.find(c => c.blobs.some(b => Math.hypot(ac.x - c.x - b.dx, ac.y - c.y - b.dy) < b.r));
            const key = cell ? cell.id : 0;
            if (!ac.inCell.has(key)) {
                ac.inCell.add(key);
                if (ac.appr?.loc && ac.appr.along < 8) { goAround(ac, 'windshear', true); continue; }
                G.stats.turbulence++;
                if (mine(ac)) award(ac, -5, 'TURB');
                pilot(ac, `${ac.radio}, we just took moderate to severe turbulence in that cell.`);
            }
        }
        if (ac.appr?.loc && ac.appr.along < 6) continue;
        const blocked = heavyAhead(ac, ac.hdg);
        if (ac.wxDev && wxLevel(ac.x, ac.y) < 2 && !heavyAhead(ac, ac.hdg, 1, 5) && G.t - ac.wxDev.t > 30) {
            ac.wxDev = null;
            pilot(ac, `${ac.radio}, clear of the weather.`);
        }
        if (!blocked) { if (ac.wxReq && G.t - ac.wxReq.t > 10) ac.wxReq = null; continue; }
        if (ac.wxDev) continue;
        if (!ac.wxReq) {
            const deg = 30;
            const leftOk = !heavyAhead(ac, ac.hdg - deg), rightOk = !heavyAhead(ac, ac.hdg + deg);
            const dir = leftOk && !rightOk ? 'L' : rightOk && !leftOk ? 'R' : Math.random() < 0.5 ? 'L' : 'R';
            ac.wxReq = { dir, deg, t: G.t };
            pilot(ac, `${facName('APP')}, ${ac.radio}, request ${deg} degrees ${dir === 'L' ? 'left' : 'right'} for weather.`);
        } else if (G.t - ac.wxReq.t > 45) {
            // No answer: the captain deviates anyway.
            const r = ac.wxReq;
            ac.tHdg = norm(ac.hdg + (r.dir === 'L' ? -r.deg : r.deg)); ac.turn = r.dir;
            ac.direct = null; ac.holdAt = null; ac.orbit = null;
            if (ac.appr) cancelApproach(ac);
            ac.wxReq = null; ac.wxDev = { t: G.t };
            if (mine(ac)) violation(ac, 'unanswered request', `${ac.cs} deviated for weather without a reply`);
            pilot(ac, `${ac.radio} is deviating ${r.dir === 'L' ? 'left' : 'right'} for weather.`);
        }
    }
}

/* ------------------------------------------------------------------ */
/* Terrain                                                             */
/* ------------------------------------------------------------------ */

const terrainOn = () => G.opts.terrain && !!G.mva;
/** The altitude a departure must reach before its exit gate. */
const exitAlt = ac => (ac.gate && ac.gate.exitAlt) || G.world.exitAlt;
const mvaHere = ac => terrainOn() ? mvaAt(G.mva, ac.x, ac.y) || G.world.minAlt : G.world.minAlt;
/** Highest MVA within r NM of the field, rounded up to a thousand feet. */
function mvaCeilingWithin(r) {
    if (!terrainOn()) return 0;
    let hi = 0;
    for (let y = -r; y <= r; y += 1) for (let x = -r; x <= r; x += 1) if (x * x + y * y <= r * r) hi = Math.max(hi, mvaAt(G.mva, x, y));
    return Math.ceil(hi / 1000) * 1000;
}

/** Minimum safe altitude warning and terrain impact. */
function terrainCheck() {
    if (!terrainOn()) return;
    for (const ac of G.aircraft) {
        if (!airborne(ac)) continue;
        const nearRunway = Math.hypot(ac.x, ac.y) < 3 && agl(ac) < 1500;
        if (!nearRunway && !ac.appr?.loc && ac.alt < terrainAt(G.dem, ac.x, ac.y) + 50) {
            ac.gone = true;
            G.stats.crashes++;
            if (window.approach) (G.crashLog = G.crashLog || []).push({ cs: ac.cs, kind: ac.kind, phase: ac.aiPlan?.phase, alt: Math.round(ac.alt), tAlt: ac.tAlt, ground: Math.round(terrainAt(G.dem, ac.x, ac.y)), mva: mvaAt(G.mva, ac.x, ac.y), x: +ac.x.toFixed(1), y: +ac.y.toFixed(1), hold: !!ac.holdAt, orbit: !!ac.orbit, appr: ac.appr ? ac.appr.end.id + (ac.appr.loc ? ' loc' : '') : null, ga: ac.wentAround, freq: ac.freq });
            G.score -= 100;
            sys(`${ac.cs} flew into terrain at ${Math.round(ac.alt).toLocaleString('en-US')} feet.`, 'bad');
            toast(`${ac.cs} — controlled flight into terrain`, 'bad');
            continue;
        }
        // Established on the approach, or climbing out, the procedure protects them.
        const climbing = ac.tAlt > ac.alt + 50 && (ac.kind === 'dep' || Math.hypot(ac.x, ac.y) < 6);
        const mva = mvaAt(G.mva, ac.x, ac.y);
        const low = !ac.appr?.loc && !climbing && mva && ac.alt < mva - 50;
        if (low && !ac.lowAlt && !mine(ac)) G.stats.sysLowAlt = (G.stats.sysLowAlt || 0) + 1;
        if (low && !ac.lowAlt && mine(ac)) {
            G.stats.lowAlt++;
            G.score -= 10;
            // 7110.65 2-1-6 safety alert phraseology.
            atc(`${ac.radio}, low altitude alert, check your altitude immediately. The MVA in your area is ${fmtAlt(mva)}.`);
            toast(`Low altitude alert — ${ac.cs}`, 'bad');
        }
        ac.lowAlt = !!low;
    }
}

/* ------------------------------------------------------------------ */
/* Ground movement                                                     */
/* ------------------------------------------------------------------ */

const TAXI_KT = 18, TURN_KT = 9, SPACING_NM = 0.045;   // ~85 m nose to tail
const isSurface = a => ['gate', 'push', 'pushed', 'taxi', 'wait', 'lineup', 'luaw', 'clear', 'rollout', 'rto'].includes(a.state);

/** The aircraft this one would run into if it kept going, if any. */
function trafficAhead(ac) {
    if (ac.ghostUntil > G.t) return null;
    const h = ac.hdg * D2R;
    for (const o of G.aircraft) {
        if (o === ac || !isSurface(o) || o.state === 'gate' || o.state === 'rollout') continue;
        const dx = o.x - ac.x, dy = o.y - ac.y, d = Math.hypot(dx, dy);
        if (d > SPACING_NM || d < 1e-6) continue;
        const ahead = (dx * Math.sin(h) + dy * Math.cos(h)) / d;      // cosine of the angle off the nose
        if (ahead > 0.8) return o;
    }
    return null;
}

/** Ground and runway-surface states. Returns true when it handled the aircraft this tick. */
function groundStep(ac, dt) {
    const gr = G.ground;
    switch (ac.state) {
    case 'gate':
        if (ac.kind === 'dep' && !ac.called && G.t >= ac.readyAt) {
            ac.called = true;
            pilot(ac, `${facName('GND')}, ${ac.radio}, gate ${ac.stand.ref}, information ${PHONETIC[G.atis]}, ready to push${ac.patternWork ? ', VFR pattern work' : ''}.`);
        }
        if (ac.kind === 'arr' && G.t >= ac.parkedUntil) ac.gone = true;
        return true;
    case 'push': {
        if (ac.holdPos || givingWay(ac)) return true;
        ac.pushLeft -= dt;
        // Back off the stand, tail first, toward the taxiway.
        const back = 0.035 / 40 * dt;
        ac.x -= Math.sin(ac.hdg * D2R) * back; ac.y -= Math.cos(ac.hdg * D2R) * back;
        if (ac.pushLeft <= 0) {
            ac.state = 'pushed';
            ac.hdg = norm(ac.hdg + 180);
            pilot(ac, `${ac.radio}, ready to taxi.`);
        }
        return true;
    }
    case 'clear':
        if (ac.freq === 'TWR' && G.t >= ac.remindAt) {
            ac.remindAt = G.t + 60;
            pilot(ac, `Tower, ${ac.radio}, clear of ${ac.landEnd.id}, request to taxi.`);
        }
        return true;
    case 'pushed':
        return true;
    case 'lineup': {
        const t = ac.lineupAt, d = Math.hypot(t.x - ac.x, t.y - ac.y), stepNm = (ac.immediate ? 14 : 8) / 3600 * dt;
        if (d <= stepNm) {
            Object.assign(ac, { x: t.x, y: t.y, hdg: ac.rwy.course, state: ac.lineupThen, spd: 0 });
            if (ac.state === 'roll') rollStarted(ac);
        } else {
            ac.hdg = brg(t.x - ac.x, t.y - ac.y);
            ac.x += (t.x - ac.x) / d * stepNm; ac.y += (t.y - ac.y) / d * stepNm;
        }
        return true;
    }
    case 'rollout': {
        const e = ac.landEnd;
        const run = -finalGeom(ac, e).along;                        // NM past the threshold
        const left = ac.exitAt.along - run;
        // Brake to turn-off speed by the exit (harder when told to expedite).
        const brake = ac.expediteUntil > G.t ? 4.5 : 3;
        const vmax = Math.sqrt(Math.max(0, 2 * (brake / 3600) * left)) * 3600 + 15;
        ac.spd = Math.max(15, Math.min(ac.spd - brake * dt, vmax));
        ac.x += Math.sin(e.course * D2R) * ac.spd / 3600 * dt;
        ac.y += Math.cos(e.course * D2R) * ac.spd / 3600 * dt;
        if (left <= 0.01) {
            const n = gr.nodes[ac.exitAt.node];
            const r = withCrossings(gr, { pts: [{ x: ac.x, y: ac.y }, { x: n.x, y: n.y }], names: [] });
            r.crossings = [];
            startTaxi(ac, r, 'exit');
        }
        return true;
    }
    case 'taxi':
        taxiStep(ac, dt);
        return true;
    }
    return false;
}

function taxiStep(ac, dt) {
    const r = ac.route;
    // Stop short of any runway not yet cleared to cross.
    // "…cross runway XX and contact ground" with the exit: the first crossing is already cleared.
    if (ac.preCross) { const first = r.crossings.find(c => !c.cleared); if (first) first.cleared = true; ac.preCross = false; }
    const cx = r.crossings.find(c => !c.cleared && c.stopS >= ac.s - 0.002);
    const end = r.len - (r.stopEarly || 0);
    let limit = cx ? Math.min(end, cx.stopS) : end;
    if (ac.holdPos || givingWay(ac)) limit = ac.s;
    const block = trafficAhead(ac);
    if (block) {
        limit = ac.s;
        // Two aircraft nose to nose wait a while, then one squeezes by.
        if (ac.blockedBy !== block) { ac.blockedBy = block; ac.blockedSince = G.t; }
        else if (G.t - ac.blockedSince > 25 && block.blockedBy === ac && ac.id < block.id) {
            ac.ghostUntil = G.t + 12;
            if (mine(ac)) { G.score -= 5; sys(`${ac.cs} and ${block.cs} were stuck nose to nose on the taxiway.`, 'bad'); }
        }
    } else ac.blockedBy = null;
    // Slow for turns.
    const here = pointAt(r, ac.s), i = here.i;
    let want = ac.expediteUntil > G.t ? TAXI_KT * 1.4 : TAXI_KT;
    if (i + 1 < r.pts.length && r.cum[i] - ac.s < 0.03) {
        const h1 = brg(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y), h2 = brg(r.pts[i + 1].x - r.pts[i].x, r.pts[i + 1].y - r.pts[i].y);
        if (Math.abs(diff(h1, h2)) > 30) want = TURN_KT;
    }
    const room = limit - ac.s;
    want = Math.min(want, Math.sqrt(Math.max(0, 2 * (2.5 / 3600) * room)) * 3600);
    ac.spd += clamp(want - ac.spd, -4 * dt, 2 * dt);
    if (ac.spd < 0.5 && room < 0.002) ac.spd = 0;
    ac.s = Math.min(limit > ac.s ? limit : ac.s, ac.s + ac.spd / 3600 * dt);
    const p = pointAt(r, ac.s);
    const a = r.pts[p.i - 1], b = r.pts[p.i];
    if (a && b && (b.x !== a.x || b.y !== a.y)) ac.hdg = brg(b.x - a.x, b.y - a.y);
    ac.x = p.x; ac.y = p.y;
    if (cx && !cx.asked && ac.s >= cx.stopS - 0.004) {
        cx.asked = true; ac.crossReq = cx;
        pilot(ac, `${G.world.icao} ${FREQ_NAME[crossOwner(ac)]}, ${ac.radio}, holding short of runway ${crossName(cx)}, request to cross.`);
    }
    if (G.rules.id === 'ifatc' && ac.purpose === 'runway' && ac.toTower && ac.freq === 'GND' && end - ac.s < 0.15 && !ac.crossReq) {
        ac.freq = 'TWR'; ac.toTower = false; ac.waitSince = G.t; ac.remindAt = G.t + 60;
        if (G.positions.has('GND')) award(ac, 3);
        pilot(ac, `${facName('TWR')}, ${ac.radio}, approaching runway ${ac.rwy.id}, ready for departure${ac.patternWork ? ', remaining in the pattern' : ''}.`);
    }
    if (ac.s >= end - 0.0005) arrive(ac);
}

/**
 * Giving way: stopped while the other aircraft is close and still coming,
 * free again once it's past (behind us or moving away) or gone.
 */
function givingWay(ac) {
    const g = ac.giveWay;
    if (!g) return false;
    const o = g.o, d = Math.hypot(o.x - ac.x, o.y - ac.y);
    const moving = (o.state === 'taxi' || o.state === 'push') && !o.holdPos;
    g.closest = Math.min(g.closest, d);
    const past = g.closest < 0.08 && d > g.closest + 0.03;
    if (o.gone || !isSurface(o) || past || G.t - g.t > 180 || (!moving && G.t - g.t > 20)) { ac.giveWay = null; return false; }
    return d < 0.2;
}

/* ---- Progressive taxi (IFATC 2.2.5): turn by turn, junction to junction ---- */

/** The route so far up to the next junction ahead (3+ ways), or to the node the aircraft is at. */
function toNextJunction(ac) {
    const gr = G.ground, r = ac.route;
    // Route points are node positions (plus the start, and a stand at the end): find the nodes by position.
    if (!gr.byPos) { gr.byPos = new Map(); for (const n of gr.nodes) gr.byPos.set(n.x.toFixed(6) + ',' + n.y.toFixed(6), n); }
    const nodeAt = p => gr.byPos.get(p.x.toFixed(6) + ',' + p.y.toFixed(6));
    if (ac.state === 'taxi' && r) {
        const i = pointAt(r, ac.s).i;
        let lastNode = null, lastK = -1;
        for (let k = i; k < r.pts.length; k++) {
            const n = nodeAt(r.pts[k]);
            if (!n) continue;
            lastNode = n; lastK = k;
            if (n.edges.length >= 3) break;
        }
        if (lastNode) {
            const pts = [{ x: ac.x, y: ac.y }, ...r.pts.slice(i, lastK + 1)];
            const a = pts[pts.length - 2] || ac, b = pts[pts.length - 1];
            return { pts, node: lastNode, hdg: Math.hypot(b.x - a.x, b.y - a.y) > 1e-4 ? brg(b.x - a.x, b.y - a.y) : ac.hdg };
        }
    }
    const n = nearestNode(gr, ac, false);
    return n && { pts: [{ x: ac.x, y: ac.y }, { x: n.x, y: n.y }], node: n, hdg: ac.hdg };
}

/** From a junction, the next leg: left, right, straight on, or back the way we came, then on to the next junction. */
function legFrom(node, hdg, turn) {
    const N = G.ground.nodes;
    const bearing = (a, b) => brg(b.x - a.x, b.y - a.y);
    const opts = node.edges.map(e => ({ e, ang: diff(hdg, bearing(node, N[e.to])) }));
    const want = { L: -90, R: 90, S: 0, 180: 180 }[turn];
    const ok = turn === 'L' ? o => o.ang < -25 && o.ang > -160 : turn === 'R' ? o => o.ang > 25 && o.ang < 160 : turn === 'S' ? o => Math.abs(o.ang) <= 35 : o => Math.abs(o.ang) >= 135;
    const pick = opts.filter(ok).sort((a, b) => Math.abs(Math.abs(a.ang) - Math.abs(want)) - Math.abs(Math.abs(b.ang) - Math.abs(want)))[0];
    if (!pick) return null;
    const ids = [], names = [pick.e.name].filter(Boolean);
    let prev = node, cur = N[pick.e.to];
    ids.push(cur.id);
    for (let guard = 0; guard < 500 && cur.edges.length === 2; guard++) {
        const nx = cur.edges.find(e => e.to !== prev.id);
        if (!nx) break;
        if (nx.name && names[names.length - 1] !== nx.name) names.push(nx.name);
        prev = cur; cur = N[nx.to];
        ids.push(cur.id);
    }
    return { ids, names };
}

const PROG_SAY = { L: 'turn left next taxiway', R: 'turn right next taxiway', S: 'continue straight ahead', 180: 'make 180' };

function progressive(ac, c, parts, back) {
    const gr = G.ground;
    if (!gr) { sys('There is no taxiway map for this airport.'); return false; }
    if (!['taxi', 'pushed', 'clear'].includes(ac.state) || ac.purpose === 'exit' && ac.state === 'taxi') { sys(`${ac.cs} isn't taxiing.`); return false; }
    if (c.expectProg) { ac.prog = true; parts.push('expect progressive taxi instructions'); back.push('expect progressive'); return true; }
    if (c.discretion) {
        ac.prog = false;
        const plan = planTaxi(ac, defaultTaxiTarget(ac, true));
        if (plan.err) { sys(`${ac.cs}: ${plan.err}.`); return false; }
        startTaxi(ac, plan.r, plan.purpose);
        if (plan.purpose === 'runway' && G.rules.id === 'ifatc') ac.toTower = true;
        parts.push('continue taxi at your discretion'); back.push('continuing at our discretion');
        return true;
    }
    let pts, ids, names;
    if (c.follow) {
        const o = c.follow;
        if (o === ac || o.state !== 'taxi' || !o.route) { sys(`${o.cs} isn't taxiing.`); return false; }
        const from = nearestNode(gr, ac, false), to = nearestNode(gr, o, false);
        const r = from && to && route(gr, from.id, to.id);
        if (!r) { sys(`No way to follow ${o.cs} from here.`); return false; }
        const rest = o.route.pts.slice(pointAt(o.route, o.s).i);
        pts = [{ x: ac.x, y: ac.y }, ...r.pts, ...rest]; names = [...r.names, ...(o.route.names || [])];
        ac.prog = true;
        startTaxi(ac, withCrossings(gr, { pts, names }), 'prog');
        parts.push(c.followAhead ? 'follow aircraft ahead' : `follow ${o.radio}`); back.push(c.followAhead ? 'following the aircraft ahead' : `following ${o.radio}`);
        return true;
    }
    // Turn at the next junction (or, for a 180, back the way we came from where we are).
    const j = c.prog === '180' ? { pts: [{ x: ac.x, y: ac.y }], node: nearestNode(gr, ac, false), hdg: ac.hdg } : toNextJunction(ac);
    const leg = j && j.node && legFrom(j.node, j.hdg, c.prog);
    if (!leg) { sys(`${ac.cs}: no taxiway that way at the next junction.`); return false; }
    pts = [...j.pts, ...(c.prog === '180' ? [{ x: j.node.x, y: j.node.y }] : []), ...leg.ids.map(id => ({ x: gr.nodes[id].x, y: gr.nodes[id].y }))];
    ac.prog = true;
    startTaxi(ac, withCrossings(gr, { pts, names: leg.names }), 'prog');
    parts.push(PROG_SAY[c.prog]); back.push(PROG_SAY[c.prog]);
    return true;
}

/** End of a taxi route. */
function arrive(ac) {
    ac.spd = 0; ac.route = null;
    if (ac.purpose === 'runway') {
        Object.assign(ac, { state: 'wait', hdg: brg(ac.rwy.thr.x - ac.x, ac.rwy.thr.y - ac.y), waitSince: ac.waitSince || G.t });
        if (ac.preClr) { const then = ac.preClr; ac.preClr = null; startLineup(ac, then); return; }
        // Told to contact Tower when ready (or the system works Ground): over it goes. Otherwise it waits on Ground.
        if (ac.freq !== 'GND' || ac.toTower || !G.positions.has('GND')) toTower(ac);
        else {
            ac.remindAt = G.t + 60;
            pilot(ac, `Ground, ${ac.radio}, holding short runway ${ac.rwy.id}.`);
        }
    } else if (ac.purpose === 'exit') {
        const where = nearestNode(G.ground, ac);
        ac.exitTwy = where && where.edges.find(e => e.name)?.name;
        ac.state = 'clear';
        ac.stand = ac.stand || freeStand();
        if (ac.freq !== 'TWR' || ac.toGround || !G.positions.has('TWR')) toGround(ac);
        else {
            ac.remindAt = G.t + 60;
            pilot(ac, `Tower, ${ac.radio}, clear of ${ac.landEnd.id}${ac.exitTwy ? ' at ' + ac.exitTwy : ''}.`);
        }
    } else if (ac.purpose === 'prog') {
        ac.state = ac.kind === 'dep' ? 'pushed' : 'clear';
        const twy = nearestNode(G.ground, ac, false)?.edges.find(e => e.name)?.name;
        pilot(ac, `${ac.radio}, holding${twy ? ' on ' + twy : ''}, request further instructions.`);
    } else if (ac.purpose === 'point') {
        ac.state = ac.kind === 'dep' ? 'pushed' : 'clear';
        pilot(ac, `${ac.radio}, ${(ac.heldAt || 'holding').replace(/^hold/, 'holding')}.`);
        ac.heldAt = null;
    } else if (ac.purpose === 'gate') {
        Object.assign(ac, { state: 'gate', parkedUntil: G.t + 25 });
        G.stats.parked++;
        if (G.positions.has('GND')) award(ac, 3);
    }
}

/** Ground conflicts the auto-stopping didn't prevent, and runway incursions. */
function surfaceCheck() {
    const moving = G.aircraft.filter(a => a.state === 'taxi' || a.state === 'push');
    const now = new Set();
    for (let i = 0; i < moving.length; i++) {
        for (let j = i + 1; j < moving.length; j++) {
            const a = moving[i], b = moving[j];
            if (Math.hypot(a.x - b.x, a.y - b.y) > 0.018) continue;
            const key = a.id + '-' + b.id;
            now.add(key);
            if (!G.groundConf.has(key) && (mine(a) || mine(b))) { G.score -= 10; sys(`Ground conflict: ${a.cs} and ${b.cs} are wingtip to wingtip.`, 'bad'); }
        }
    }
    G.groundConf = now;
    // Something crossing or lined up on a runway while another rolls or lands on it.
    for (const r of G.aircraft) {
        if (r.state !== 'roll' && r.state !== 'rollout') continue;
        const phys = onRunwayPhys(r);
        for (const o of G.aircraft) {
            if (o === r || o.incursion === r.id || onRunwayPhys(o) !== phys || o.state === 'roll') continue;
            if (r.state === 'roll' && (o.state === 'luaw' || o.state === 'lineup')) continue;
            if (Math.hypot(o.x - r.x, o.y - r.y) > 1.5) continue;
            o.incursion = r.id;
            G.stats.incursions++;
            if (G.positions.has('TWR')) { G.score -= 30; toast(`Runway incursion — ${o.cs} on the runway with ${r.cs}`, 'bad'); }
            sys(`Runway incursion: ${o.cs} is on the runway while ${r.cs} ${r.state === 'roll' ? 'takes off' : 'lands'}.`, 'bad');
        }
    }
}

/* ------------------------------------------------------------------ */
/* The system's controllers, for the positions the player isn't working */
/* ------------------------------------------------------------------ */

/**
 * The system's minimum safe altitude warning: anything it controls that will
 * be below the MVA within three minutes on its present heading climbs now,
 * whatever else was holding it down. Established approaches are protected
 * by the procedure and left alone.
 */
function aiTerrainNet() {
    if (!terrainOn()) return;
    for (const a of G.aircraft) {
        if (a.state !== 'air' || mine(a) || a.appr?.loc) continue;
        const reach = (a.spd / 3600) * 180;
        const ahead = { x: a.x + Math.sin(a.hdg * D2R) * reach, y: a.y + Math.cos(a.hdg * D2R) * reach };
        const need = Math.ceil(maxMvaAlong(a, ahead) / 500) * 500;
        if (Math.max(a.alt, a.tAlt) < need) {
            a.aiFloor = need; a.aiCeil = 0;
            if (a.holdAt) a.holdAt = null;
            ai(a, { alt: Math.min(need, 24000) });
        }
    }
}

/** Can the crew see the field? In visual conditions, within 20 miles and below 10,000 ft above it, roughly facing it. */
function fieldInSight(ac) {
    if (!visualWx() || ac.state !== 'air') return false;
    const d = Math.hypot(ac.x, ac.y);
    return d < 20 && agl(ac) < 10000 && (d < 6 || Math.abs(diff(ac.hdg, brg(-ac.x, -ac.y))) < 100);
}

/** Pilots asking for things: reports of the field in sight when asked, and now and then a visual or RNAV request. */
function pilotRequests() {
    for (const ac of G.aircraft) {
        if (ac.kind !== 'arr' || ac.state !== 'air' || ac.appr || ac.pattern || ac.divert || ac.transit || ac.circuit || ac.via?.kind === 'IAP' || ac.emerg) continue;
        if (ac.reportField && fieldInSight(ac)) { ac.reportField = false; ac.fieldReported = true; pilot(ac, `${ac.radio}, field in sight.`); }
        if (ac.request || ac.asked || ac.freq !== 'APP' || Math.hypot(ac.x, ac.y) > 18) continue;
        ac.asked = true;
        const e = G.active.arr.includes(ac.expect) ? ac.expect : G.active.arr[0];
        const ok = t => G.atisCfg.apps.includes(t), was = ac.expectType || appFor(e);
        if (was !== 'VIS' && fieldInSight(ac) && Math.random() < (ok('VIS') ? 0.4 : 0.15)) {
            ac.request = { kind: 'VIS', end: e, say: 'the visual', tag: 'VIS' };
            pilot(ac, `${ac.radio}, field in sight, request the visual runway ${e.id}.`);
        } else if (was !== 'RNAV' && hasApproach(e, 'RNAV') && G.world.nav && Math.random() < (ok('RNAV') ? 0.2 : 0.06)) {
            ac.request = { kind: 'RNAV', end: e, say: 'the ' + APP_NAME.RNAV, tag: 'RNV' };
            pilot(ac, `${ac.radio}, request the ${APP_NAME.RNAV} runway ${e.id} approach.`);
        }
    }
}

function aiControl() {
    if (G.opts.emerg) emergencyCheck();
    pilotRequests();
    if (G.rules.id === 'ifatc') towerDepartures();
    coordinate();
    if (!G.positions.has('APP')) { aiConflicts(); aiTerrainNet(); }
    for (const ac of G.aircraft) {
        if (ac.gone) continue;
        if (ac.crossReq && !G.positions.has(crossOwner(ac))) aiCross(ac);
        if (G.positions.has(ac.freq)) continue;
        if (ac.freq === 'APP') aiApproach(ac);
        else if (ac.freq === 'TWR') aiTower(ac);
        else if (ac.freq === 'GND') aiGround(ac);
    }
}

const ai = (ac, c) => issue(ac, { ...c, ai: true });

/* ------------------------------------------------------------------ */
/* Coordination: the system's controllers learn from the player        */
/* ------------------------------------------------------------------ */

/*
 * Where the system and the player share the airport, the system adapts to
 * how the player works instead of pushing traffic into them:
 *
 *   - System Approach feeding the player's Tower asks once how they want
 *     arrivals spaced (tight, gaps for departures, or gaps only when
 *     departures are waiting) and remembers the answer. Each arrival the
 *     player has to send around (runway occupied, no landing clearance)
 *     adds a mile in trail on that final; quiet stretches take it back off.
 *   - System Tower with the player on Approach asks for a gap when
 *     departures pile up, and thanks them when they give one.
 *   - System Tower with the player on Ground asks them to hold departures
 *     at the gate when the runway queue is full.
 */
let coordPref = store.get('coordTrail', null);     // 'tight' | 'gaps' | 'auto'

const coordState = () => (G.coord = G.coord || { extra: {}, asks: [], lastAsk: -1e9, learnedAt: 0 });
const feedsYourTower = () => G.positions.has('TWR') && !G.positions.has('APP');

/** Miles on top of the minimum the system's Approach leaves on a final the player's Tower works. */
function extraTrailNm(key) {
    if (!feedsYourTower()) return 0;
    const co = coordState(), pref = coordPref || 'auto';
    const waiting = G.aircraft.filter(a => (a.state === 'wait' || a.state === 'luaw') && a.rwy && seqKey(a.rwy) === key).length;
    // IFATC 3.6.1: Radar leaves 5 miles at busy times, room for a departure in between, and watches the queue itself.
    const ifatc = G.rules.id === 'ifatc';
    const gap = pref === 'gaps' || (pref === 'auto' && waiting >= (ifatc ? 1 : 2)) ? (ifatc ? 5 - SEP_NM : 3) : 0;
    return (co.extra[key] || 0) + gap;
}

function coordSay(from, to, text) { logLine('coord', `${FREQ_NAME[from]} → ${FREQ_NAME[to]}: ${text}`); }

/** A question from a system controller, answered with the buttons on the scope; `def` is taken if it times out. */
function ask(from, to, text, options, def = 0) {
    const co = coordState();
    if (co.asks.some(q => q.text === text)) return;
    co.asks.push({ from, to, text, options, def, until: G.t + 45 });
    co.lastAsk = G.t;
    coordSay(from, to, text);
    renderAsk();
}

function answer(i) {
    const co = coordState(), q = co.asks.shift();
    if (!q) return;
    const o = q.options[i] || q.options[q.def];
    logLine('atc', `${FREQ_NAME[q.to]}: ${o.label}.`);
    o.act && o.act();
    renderAsk();
}

function renderAsk() {
    const el = $('#coord');
    if (!el) return;
    const q = G && G.coord && G.coord.asks[0];
    el.hidden = !q;
    if (!q) return;
    el.innerHTML = `<div class="coord-h">${FREQ_NAME[q.from].toUpperCase()} → ${FREQ_NAME[q.to].toUpperCase()}</div>
        <div class="coord-t">${escapeHtml(q.text)}</div>
        <div class="coord-b">${q.options.map((o, i) => `<button class="btn${i === q.def ? ' primary' : ''}" data-ans="${i}">${escapeHtml(o.label)}</button>`).join('')}</div>`;
}

/** Learning: an arrival the player's Tower had to send around costs the system a mile in trail on that final. */
function learnFromGoAround(e, reason) {
    if (!feedsYourTower() || !e || !/occupied|landing clearance/.test(reason || '')) return;
    const co = coordState(), key = seqKey(e);
    co.extra[key] = Math.min(4, (co.extra[key] || 0) + 1);
    co.learnedAt = G.t;
    coordSay('APP', 'TWR', `Copy the go-around. I'll leave you another mile on ${e.id}: ${(SEP_NM + co.extra[key]).toFixed(0)} miles or more in trail from here on.`);
    if (co.extra[key] >= 2 && coordPref !== 'gaps' && !co.askedGaps) {
        co.askedGaps = true;
        ask('APP', 'TWR', `That's ${co.extra[key]} go-arounds on ${e.id}. Want a departure gap between every pair of arrivals?`, [
            { label: 'Yes, gaps every time', act: () => { coordPref = 'gaps'; store.set('coordTrail', coordPref); } },
            { label: 'No, I\'ll manage', act: () => {} },
        ], 0);
    }
}

function coordinate() {
    const co = coordState();
    // Questions nobody answered take their default.
    if (co.asks.length && G.t > co.asks[0].until) answer(co.asks[0].def);
    // A quiet ten minutes: the learned extra comes back off, half a mile at a time.
    if (G.t - co.learnedAt > 600) {
        co.learnedAt = G.t;
        for (const k in co.extra) co.extra[k] = Math.max(0, co.extra[k] - 0.5);
    }
    if (co.asks.length || G.t - co.lastAsk < 300 || G.t < 40) return;

    if (feedsYourTower() && !coordPref) {
        ask('APP', 'TWR', 'How do you want your arrivals on final?', [
            { label: 'Gaps when departures wait', act: () => { coordPref = 'auto'; store.set('coordTrail', coordPref); } },
            { label: 'Tight, 3 miles', act: () => { coordPref = 'tight'; store.set('coordTrail', coordPref); } },
            { label: 'Gaps every time', act: () => { coordPref = 'gaps'; store.set('coordTrail', coordPref); } },
        ], 0);
        return;
    }
    const queues = new Map();
    for (const a of G.aircraft) if (a.kind === 'dep' && a.rwy && (a.state === 'wait' || a.state === 'luaw' || a.state === 'taxi' && a.purpose === 'runway')) {
        const k = seqKey(a.rwy);
        queues.set(k, { e: a.rwy, n: (queues.get(k)?.n || 0) + 1, holding: (queues.get(k)?.holding || 0) + (a.state === 'wait' ? 1 : 0) });
    }
    // The player's Approach is feeding the system's Tower: ask for a gap when departures pile up.
    if (G.positions.has('APP') && !G.positions.has('TWR') && !co.gapAsk) {
        for (const [k, q] of queues) {
            if (q.holding < 3) continue;
            ask('TWR', 'APP', `I've got ${q.holding} departures holding for ${q.e.id}. Can you give me a ${G.rules.id === 'ifatc' ? 5 : 6}-mile gap on final?`, [
                { label: 'Will do', act: () => { co.gapAsk = { key: k, until: G.t + 360 }; } },
                { label: 'Unable', act: () => {} },
            ], 1);
            return;
        }
    }
    // The player's Ground is feeding the system's Tower: hold them at the gate when the queue is full.
    if (G.positions.has('GND') && !G.positions.has('TWR') && !(co.gateHold > G.t)) {
        for (const [, q] of queues) {
            if (q.n < 5) continue;
            ask('TWR', 'GND', `The queue for ${q.e.id} is ${q.n} deep. Can you hold departures at the gate for a few minutes?`, [
                { label: 'Will do', act: () => { co.gateHold = G.t + 180; co.gateHoldSaid = false; } },
                { label: 'Unable', act: () => {} },
            ], 0);
            return;
        }
    }
    if (co.gateHold && G.t > co.gateHold && !co.gateHoldSaid) { co.gateHoldSaid = true; coordSay('TWR', 'GND', 'Thanks. Go ahead and send them again.'); }
    if (co.gapAsk && G.t > co.gapAsk.until) { co.gapAsk = null; coordSay('TWR', 'APP', 'Never mind the gap, I\'ll work around it.'); }
}

function aiGround(ac) {
    if (ac.state === 'gate' && ac.kind === 'dep' && ac.called) ai(ac, { push: true });
    else if (ac.state === 'pushed' || ac.state === 'clear') ai(ac, { taxi: true, ...(ac.kind === 'dep' ? { tower: true } : {}) });
    else if (ac.state === 'wait' && ac.kind === 'dep') ai(ac, { tower: true });
}

function aiCross(ac) {
    const cr = ac.crossReq, phys = cr.phys;
    const busy = runwayBusyUntil(phys) > G.t
        || G.aircraft.some(a => a.appr?.loc && a.appr.end.phys === phys && a.appr.along < 4)
        || G.aircraft.some(a => (a.state === 'wait' || a.state === 'lineup') && a.rwy.phys === phys && a.lineupThen === 'roll');
    if (!busy) ai(ac, { cross: true });
}

function aiTower(ac) {
    if (ac.appr?.loc && !ac.landClr && ac.appr.along < 8) { ai(ac, { land: true }); return; }
    if (ac.kind === 'arr' && ac.state === 'clear') { ai(ac, { ground: true }); return; }
    // No radar: the system's Tower gives inbounds a straight-in to the runway they expect, at 15 miles.
    if (towerInbound(ac) && ac.state === 'air' && !ac.appr && !ac.pattern && Math.hypot(ac.x, ac.y) < 15) {
        const end = G.active.arr.includes(ac.expect) ? ac.expect : G.active.arr[0];
        ai(ac, { entry: { kind: 'S', end }, land: true });
        return;
    }
    if (ac.state !== 'wait' && ac.state !== 'luaw') return;
    const phys = ac.rwy.phys;
    const arriving = G.aircraft.some(a => a.appr?.loc && sameRunwayish(a.appr.end, ac.rwy) && a.appr.along < 4);
    // Spaced from the previous takeoff clearance (not liftoff), so two never roll together.
    G.lastClr = G.lastClr || new Map();
    const last = G.lastClr.get(phys) || -1e9;
    const anyLast = Math.max(-1e9, ...G.lastClr.values());
    if (runwayBlocker(ac) || arriving || departureWake(ac) || G.t - last <= 100 || G.t - anyLast <= 60) return;
    // Diverging departures (7110.65 5-8-3): turn 15°+ away from the other departure runways,
    // or alternate sides off a lone runway.
    const c = ac.rwy.course * D2R;
    const lat = e => (e.thr.x - ac.rwy.thr.x) * Math.cos(c) - (e.thr.y - ac.rwy.thr.y) * Math.sin(c);
    const others = G.active.dep.filter(e => e !== ac.rwy && parallelFt(e, ac.rwy) != null).map(lat);
    let side = others.length ? (others.reduce((t, v) => t + v, 0) > 0 ? -1 : 1) : 0;
    if (!side) { G.altSide = -(G.altSide || 1); side = G.altSide; }
    const hdg = Math.round(norm(ac.rwy.course + 20 * side) / 5) * 5 || 360;
    if (ai(ac, { takeoff: true, hdg })) {
        G.lastClr.set(phys, G.t);
        const gap = G.coord?.gapAsk;
        if (gap && gap.key === seqKey(ac.rwy)) { G.coord.gapAsk = null; award(ac, 5, 'gap'); coordSay('TWR', 'APP', `Thanks for the gap, ${ac.cs} is rolling.`); }
    }
}

/*
 * The system's approach controller. It works the way a TRACON final
 * controller does:
 *
 *   1. Plans each runway's final from the terrain: the intercept altitude is
 *      at least the highest MVA along the final, and the intercept point is
 *      far enough out that the glideslope there is above that altitude, so the
 *      aircraft joins it from below (and never inside the approach gate + 2).
 *   2. Schedules every arrival to the threshold, first come first served,
 *      spaced by radar or wake minima plus a buffer, across the active runways.
 *   3. Absorbs delay with speed when it's small and with a hold at the entry
 *      fix (stacked 1,000 ft apart above the MVA) when it isn't.
 *   4. Vectors to a base point 3 NM off the final for a 30° intercept, routing
 *      round storm cells, stepping down only as low as the MVAs on the rest of
 *      the route allow.
 *   5. Checks spacing behind the previous arrival before clearing the ILS;
 *      too tight and it's a 360 to make room.
 *   6. Looks two minutes ahead for conflicts among everything airborne and
 *      resolves its own aircraft's with altitude.
 * Departures climb on runway heading until they're above the arrivals and
 * the terrain toward their gate, then go direct.
 */
const AI_FINAL_KT = 150;           // ground speed used to turn miles on final into seconds
const AI_SPACING_BUFFER = 1.2;     // NM on top of the minimum: speeds differ on final
const BASE_OFFSET = 4;             // NM beside the final: clear of traffic abeam on it

/** Highest MVA along a straight path (or the field minimum when terrain is off). */
function maxMvaAlong(a, b) {
    if (!terrainOn()) return G.world.minAlt;
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d));
    let hi = G.world.minAlt;
    for (let i = 0; i <= n; i++) hi = Math.max(hi, mvaAt(G.mva, a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n));
    return hi;
}
/** Does a heavy cell lie on the straight path? */
function wxOnPath(a, b) {
    if (!G.wx.length) return false;
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d));
    for (let i = 1; i <= n; i++) if (wxLevel(a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n) === 3) return true;
    return false;
}
const ptOnFinal = (e, along, off = 0) => {
    const c = e.course * D2R;
    return { x: e.thr.x - Math.sin(c) * along + Math.cos(c) * off, y: e.thr.y - Math.cos(c) * along - Math.sin(c) * off };
};

/** The final for a runway end, planned from the terrain. Cached per runway per shift. */
function planFinal(e) {
    G.finals = G.finals || new Map();
    if (G.finals.has(e)) return G.finals.get(e);
    const elev = G.world.elev;
    // The intercept altitude clears every MVA from the FAF out to 25 NM, and 3 NM either side.
    let mva = G.world.minAlt;
    if (terrainOn()) for (let d = FAF_NM; d <= 25; d++) for (const off of [-3, 0, 3]) mva = Math.max(mva, mvaAt(G.mva, ptOnFinal(e, d, off).x, ptOnFinal(e, d, off).y) || 0);
    // Side-by-side finals are flown 1,000 ft apart (dependent parallels), so traffic
    // crossing one final to reach the other is never at the same height.
    const lanes = [];
    for (const o of G.active.arr) if (!lanes.some(l => sameRunwayish(l, o)) && (o === e || parallelFt(o, e) != null)) lanes.push(o);
    const c0 = e.course * D2R, lat = o => (o.thr.x - e.thr.x) * Math.cos(c0) - (o.thr.y - e.thr.y) * Math.sin(c0);
    lanes.sort((a, b) => lat(a) - lat(b));
    const stagger = Math.max(0, lanes.findIndex(o => sameRunwayish(o, e))) * 1000;
    let joinAlt = Math.max(Math.ceil((elev + 2500) / 500) * 500, mva) + stagger, icpt = 0, baseAlong = 0;
    // Join where the glideslope is above that altitude, at least 2 NM outside the gate; the base
    // points either side have MVAs of their own, so settle it in a couple of passes.
    for (let pass = 0; pass < 3; pass++) {
        icpt = Math.max(GATE_NM + 3, (joinAlt - elev) / GS_FT_PER_NM + 1.5);
        baseAlong = Math.min(SCOPE_NM - 6, icpt + BASE_OFFSET / Math.tan(30 * D2R));
        if (!terrainOn()) break;
        let atBase = 0;
        for (const side of [-1, 1]) { const p = ptOnFinal(e, baseAlong, BASE_OFFSET * side); atBase = Math.max(atBase, mvaAt(G.mva, p.x, p.y)); }
        if (atBase <= joinAlt) break;
        joinAlt = atBase;
    }
    const f = { e, joinAlt, icpt, baseAlong };
    G.finals.set(e, f);
    return f;
}
function basePoint(f, side) {
    return { name: `${f.e.id} base`, side, ...ptOnFinal(f.e, f.baseAlong, BASE_OFFSET * side) };
}

/** Runways that share a final for spacing: the same runway, or parallels under 2,500 ft. */
const seqKey = e => G.world.ends.filter(o => sameRunwayish(o, e)).map(o => o.id).sort().join('|');
function spacingSec(lead, follow) {
    const nm = Math.max(SEP_NM, wakeNm(lead, follow)) + AI_SPACING_BUFFER;
    return nm / AI_FINAL_KT * 3600;
}

/** Book a threshold time for an arrival: after everything already booked on that final, properly spaced. */
function bookSlot(ac, e, eta) {
    G.seq = G.seq || {};
    for (const k in G.seq) G.seq[k] = G.seq[k].filter(x => x.ac !== ac && !x.ac.gone && x.ac.state === 'air');
    const key = seqKey(e), q = (G.seq[key] = G.seq[key] || []);
    // An emergency goes first; the rest are re-spaced behind it on final.
    if (ac.emerg) { q.unshift({ ac, t: eta }); return { key, t: eta }; }
    let t = eta;
    const extra = extraTrailNm(key) / AI_FINAL_KT * 3600;
    for (const x of q) t = Math.max(t, x.t + spacingSec(x.ac, ac) + extra);
    q.push({ ac, t });
    return { key, t };
}

/** Seconds from a point to the threshold via the base point: 210 kt to base, 180 to the FAF, then Vapp. */
function timeToThreshold(from, P, f, ac) {
    const toBase = Math.hypot(P.x - from.x, P.y - from.y);
    const turnIn = BASE_OFFSET / Math.sin(30 * D2R);
    return toBase / (210 / 3600) + (turnIn + f.icpt - FAF_NM) / (180 / 3600) + FAF_NM / (ac.perf.vapp / 3600);
}

/** The base point for this aircraft: pushed further out when it needs the miles to get down. */
function basePointFor(ac, f, side) {
    let P = basePoint(f, side);
    const toLose = Math.max(0, ac.alt - f.joinAlt);
    const need = toLose / 1000 * 2.6 + 2;                // ~2.6 NM per 1,000 ft at 2,000 fpm and 230 kt
    const have = Math.hypot(P.x - ac.x, P.y - ac.y);
    if (need > have) {
        const along = Math.min(SCOPE_NM - 5, f.baseAlong + (need - have) * 0.7);
        P = { name: `${f.e.id} base`, side, ...ptOnFinal(f.e, along, BASE_OFFSET * side), along };
    }
    return P;
}

/** Pick the active arrival runway (and side) that can take this aircraft soonest without crossing another final. */
function bestRunway(ac) {
    let best = null;
    for (const e of G.active.arr) {
        const f = planFinal(e);
        const side = finalGeom(ac, e).xt > 0 ? 1 : -1;
        const P = basePointFor(ac, f, side);
        const eta = G.t + timeToThreshold(ac, P, f, ac);
        const q = ((G.seq && G.seq[seqKey(e)]) || []).filter(x => x.ac !== ac && !x.ac.gone);
        let t = eta;
        for (const x of q) t = Math.max(t, x.t + spacingSec(x.ac, ac));
        const inner = G.active.arr.some(o => !sameRunwayish(o, e) && parallelFt(o, e) != null && Math.abs(finalGeom(P, o).xt) < 4);
        // Never turn in across another final when there's any runway that avoids it; under Infinite Flight rules
        // the inside runways land too (IFATC 3.6.1), over the staggered finals, when they save a couple of minutes.
        const all = G.rules.id === 'ifatc';
        const score = t + (e === ac.expect ? -20 : 0) + (inner ? (all ? 150 : 900) : 0);
        if (!best || (!all && best.inner && !inner) || ((all || best.inner === inner) && score < best.score)) best = { e, f, side, P, eta, score, inner };
    }
    return best;
}

/** A holding fix on the field side of the arrival's entry fix, at an altitude clear of the terrain and the stack. */
function holdFor(ac) {
    const fix = ac.entry;
    let mva = G.world.minAlt;
    if (terrainOn()) for (let a = 0; a < 360; a += 30) for (const r of [0, 3, 6]) mva = Math.max(mva, mvaAt(G.mva, fix.x + Math.sin(a * D2R) * r, fix.y + Math.cos(a * D2R) * r) || 0);
    const base = Math.max(Math.ceil((G.world.elev + 6000) / 1000) * 1000, Math.ceil((mva + 1000) / 1000) * 1000);
    // Join the stack on top: above everyone already in it, so nobody climbs or descends through it.
    const stack = G.aircraft.filter(a => a !== ac && a.aiPlan?.phase === 'hold' && a.aiPlan.fix === fix).map(a => Math.max(a.tAlt, a.alt));
    let alt = Math.max(base, stack.length ? Math.ceil((Math.max(...stack) + 1000) / 1000) * 1000 : base);
    // At or below 14,000 the one-minute racetrack fits outside the fix, clear of every final.
    // Above it the legs are 1½ minutes and would leave the airspace, so it goes on the field side.
    const inbound = alt <= 14000 ? brg(-fix.x, -fix.y) : brg(fix.x, fix.y);
    return { fix, inbound, alt: Math.min(alt, 24000), base };
}

function aiApproach(ac) {
    if (ac.state !== 'air' || ac.pattern || ac.divert || ac.via?.kind === 'IAP') return;
    if (ac.request?.radarPattern) {
        // IFATC 3.6.2: a radar pattern is Radar's call, on its own workload, with Tower's in mind: a long departure line makes it likelier to take one.
        const load = G.aircraft.filter(a => a.freq === 'APP' && a.state === 'air').length;
        const depLine = G.aircraft.filter(a => a.kind === 'dep' && (a.state === 'wait' || a.state === 'luaw')).length;
        const e = ac.request.end;
        ac.request = null;
        if (load <= (depLine >= 3 ? 9 : 6)) {
            atc(`${ac.radio}, ${facName('APP')}, radar contact, radar pattern approved, expect vectors runway ${e.id}.`, true);
            pilot(ac, `Radar pattern, vectors ${e.id}, ${ac.radio}.`);
            coordSay('APP', 'TWR', `I'll take ${ac.cs} for a radar pattern.`);
            ac.rpCircuit = null;
        } else {
            atc(`${ac.radio}, unable radar pattern at this time, contact ${facName('TWR')} for a full stop.`, true);
            pilot(ac, `Back to Tower for a full stop, ${ac.radio}.`);
            coordSay('APP', 'TWR', `Too busy for a radar pattern with ${ac.cs}. It's back with you for a full stop.`);
            Object.assign(ac, { circuit: { ...ac.rpCircuit, work: false }, rpCircuit: null, freq: 'TWR', tAlt: circuitAlt(ac) });
            return;
        }
    }
    // Radar vectors or flight following to the field, then over to Tower close in, in VMC (IFATC 3.6.3).
    if (ac.vfrIn && !ac.appr && !ac.pattern) {
        if (!visualWx()) { ac.vfrIn = null; }
        else {
            if (!ac.radarContact) {
                ac.radarContact = true;
                const h = brg(-ac.x, -ac.y);
                if (ac.vfrIn === 'RV') ac.tHdg = h;
                atc(`${ac.radio}, ${facName('APP')}, radar contact${ac.vfrIn === 'RV' ? `, fly heading ${hdg3(h)}, vectors to the field` : ', maintain VFR'}.`, true);
                pilot(ac, `${ac.vfrIn === 'RV' ? `Heading ${hdg3(h)}` : 'Maintain VFR'}, ${ac.radio}.`);
            }
            if (Math.hypot(ac.x, ac.y) < 12) ai(ac, { toTwr: true });
            return;
        }
    }
    if (ac.request) {
        const r = ac.request;
        // A check-in: what to expect (continue as filed when it has a route). Then a visual in good weather close in; anything else, unable.
        if (r.checkin) ai(ac, { expectApp: { type: r.kind, end: r.end }, asFiled: !!ac.via });
        else if (r.kind === 'VIS' && visualWx() && Math.hypot(ac.x, ac.y) < 18) { ai(ac, { visual: r.end }); if (ac.aiPlan) ac.aiPlan.phase = 'final'; return; }
        else ai(ac, { unable: true });
    }
    if (ac.wxReq) {
        // Approve, with an altitude that clears the terrain on the new heading for the next five minutes.
        const h = norm(ac.hdg + (ac.wxReq.dir === 'L' ? -ac.wxReq.deg : ac.wxReq.deg)), reach = ac.spd / 3600 * 300;
        const need = Math.ceil(maxMvaAlong(ac, { x: ac.x + Math.sin(h * D2R) * reach, y: ac.y + Math.cos(h * D2R) * reach }) / 1000) * 1000;
        ai(ac, { deviate: true });
        if (need > ac.tAlt) ai(ac, { alt: Math.min(need, 24000) });
        return;
    }
    if (ac.kind === 'dep') { aiDeparture(ac); return; }
    const plan = ac.aiPlan || (ac.aiPlan = { phase: 'new' });
    if (plan.phase === 'final' && !ac.appr) plan.phase = 'new';          // went around or broke off
    if (ac.wxDev) { plan.resume = true; return; }                        // deviating: pick up again when clear
    if (plan.resume) { plan.resume = false; if (plan.phase === 'inbound') plan.phase = 'route'; }

    if (plan.phase === 'new') {
        const b = bestRunway(ac);
        const slot = bookSlot(ac, b.e, b.eta);
        Object.assign(plan, { e: b.e, f: b.f, side: b.side, P: b.P, slotKey: slot.key, slot: slot.t });
        ac.expect = b.e;
        // An emergency gets a short base, 2.5 miles off the final, when it's low enough to get down from there.
        if (ac.emerg && ac.alt - b.f.joinAlt < 4000) {
            const off = 2.5;
            plan.P = { name: `${b.e.id} base`, side: b.side, ...ptOnFinal(b.e, b.f.icpt + off / Math.tan(30 * D2R), off * b.side) };
        }
        if (slot.t - b.eta > 75 && ac.entry && Math.hypot(ac.entry.x - ac.x, ac.entry.y - ac.y) < 12) {
            const h = holdFor(ac);
            Object.assign(plan, { phase: 'hold', fix: h.fix, base: h.base });
            ai(ac, { holdFix: h.fix, holdInbound: h.inbound, alt: h.alt });
            return;
        }
        plan.phase = 'route';
    }

    if (plan.phase === 'hold') {
        // Stacks work bottom up: only the lowest leaves, and the rest step down behind it.
        const stack = G.aircraft.filter(a => a !== ac && a.aiPlan?.phase === 'hold' && a.aiPlan.fix === plan.fix);
        const below = stack.filter(a => a.tAlt < ac.tAlt);
        const level = Math.round(ac.tAlt / 1000) * 1000;
        if (below.length) {
            const next = level - 1000;
            if (next >= plan.base && !stack.some(a => Math.abs(Math.max(a.alt, a.tAlt) - next) < 900) && Math.abs(ac.alt - ac.tAlt) < 100) ai(ac, { alt: next });
            return;
        }
        if (level - 1000 >= plan.base && Math.abs(ac.alt - ac.tAlt) < 100 && G.t + 240 < plan.slot) ai(ac, { alt: level - 1000 });
        // Leave the hold the moment the remaining flight time matches the slot.
        const P = basePointFor(ac, plan.f, plan.side);
        if (G.t + timeToThreshold(ac, P, plan.f, ac) < plan.slot - 5) return;
        plan.P = P;
        plan.phase = 'route';
    }

    if (plan.phase === 'route') {
        // Round the weather: the other side's base point if that path is clear.
        const other = basePointFor(ac, plan.f, -plan.side);
        if (!ac.emerg && wxOnPath(ac, plan.P) && !wxOnPath(ac, other)) { plan.side = -plan.side; plan.P = other; }
        plan.phase = 'inbound';
        ai(ac, { direct: plan.P, alt: routeAlt(ac, plan), spd: 210 });
        return;
    }

    if (plan.phase === 'inbound') {
        // Step down as the terrain ahead allows, unless a conflict is holding us up.
        // While separating traffic (and for 30 s after) the conflict probe owns the altitude.
        if (!(ac.aiLockUntil > G.t)) {
            const floor = routeAlt(ac, plan);
            if (Math.abs(floor - ac.tAlt) >= 500) ai(ac, { alt: floor });
        }
        const dP = Math.hypot(plan.P.x - ac.x, plan.P.y - ac.y);
        if (!ac.direct && dP > 1.5) ai(ac, { direct: plan.P });
        // Meet the slot with speed: early slows, late speeds up, within the legal band.
        const late = G.t + timeToThreshold(ac, plan.P, plan.f, ac) * (210 / Math.max(160, ac.spd)) - plan.slot;
        const min = minSpeed(ac), max = ac.alt < 10000 ? 250 : 280;
        const spd = late < -25 ? Math.max(min, 180) : late > 25 ? max : 210;
        if (Math.abs(spd - ac.tSpd) >= 10 && dP > 4) ai(ac, { spd });
        if (dP < 1.5) {
            if (!ac.emerg && finalTooTight(ac, plan)) {
                // Extend: keep going away from the field until there's room behind the one ahead.
                plan.phase = 'extend';
                ai(ac, { hdg: Math.round(norm(plan.e.course + 180)), spd: Math.max(minSpeed(ac), 180) });
                return;
            }
            turnIn(ac, plan);
        }
        return;
    }

    if (plan.phase === 'extend') {
        const along = finalGeom(ac, plan.e).along;
        if (!finalTooTight(ac, plan)) turnIn(ac, plan);
        else if (along > SCOPE_NM - 6) { plan.phase = 'new'; }        // out of room: re-sequence
        return;
    }

    if (plan.phase === 'final' && ac.appr) aiFinalSpacing(ac);
}

/** Turn onto the final: 30° intercept, maintain the join altitude until established, cleared ILS. */
function turnIn(ac, plan) {
    const hdg = Math.round(norm(plan.e.course - 30 * plan.side));
    const pref = appFor(plan.e), type = pref === 'VIS' ? 'ILS' : pref;
    if (G.atisCfg.apps.includes('VIS') && visualWx() && fieldInSight(ac) && ai(ac, { visual: plan.e })) { plan.phase = 'final'; return; }
    if (ai(ac, { hdg, ils: plan.e, appType: type, alt: plan.f.joinAlt, spd: 180 })) plan.phase = 'final';
    else plan.phase = 'new';
}

/**
 * Would turning in now put us too close behind (or ahead of) someone on this
 * final? Compares distance to fly to the threshold, ours if we turned now
 * against each of theirs, with the radar or wake minimum plus the buffer.
 */
function finalTooTight(ac, plan) {
    const f = plan.f, e = plan.e;
    const toGo = a => {
        if (a.appr?.loc) return a.appr.along;
        const ee = a.appr ? a.appr.end : a.aiPlan.e, ff = planFinal(ee);
        const fa = finalGeom(a, ee);
        // Joining at 30°: the run to the course plus what's left of the final from there.
        return Math.abs(fa.xt) / Math.sin(30 * D2R) + Math.max(ff.icpt, fa.along - Math.abs(fa.xt) / Math.tan(30 * D2R));
    };
    const ours = toGo(ac);
    return G.aircraft.some(a => {
        if (a === ac || a.kind !== 'arr' || a.state !== 'air') return false;
        const theirs = a.appr ? a.appr.end : a.aiPlan?.phase === 'final' ? a.aiPlan.e : null;
        if (!theirs) return false;
        if (!sameRunwayish(theirs, e)) {
            // Dependent parallels (2,500–4,300 ft): 1.5 NM diagonal, plus the buffer.
            const ft = parallelFt(theirs, e);
            return ft != null && ft < 4300 && Math.abs(ours - toGo(a)) < 1.5 + AI_SPACING_BUFFER;
        }
        const lead = toGo(a) < ours;
        const need = Math.max(SEP_NM, lead ? wakeNm(a, ac) : wakeNm(ac, a)) + AI_SPACING_BUFFER;
        return Math.abs(ours - toGo(a)) < need;
    });
}

/** On final behind someone: slow down if the gap closes, break out before it's lost. */
function aiFinalSpacing(ac) {
    const ap = ac.appr;
    const along = ap.loc ? ap.along : Math.hypot(ptOnFinal(ap.end, planFinal(ap.end).icpt).x - ac.x, ptOnFinal(ap.end, planFinal(ap.end).icpt).y - ac.y) + planFinal(ap.end).icpt;
    let lead = null, gap = Infinity;
    for (const a of G.aircraft) {
        if (a === ac || a.state !== 'air' || !a.appr?.loc || !sameRunwayish(a.appr.end, ap.end)) continue;
        const g = along - a.appr.along;
        if (g > 0 && g < gap) { gap = g; lead = a; }
    }
    if (!lead) return;
    const need = Math.max(along < 10 && lead.appr.along < 10 ? 2.5 : SEP_NM, wakeNm(lead, ac));
    if (gap < need + 0.4 && along > FAF_NM + 0.5 && ap.spd !== minSpeed(ac)) ai(ac, { spd: minSpeed(ac) });
    if (gap < need - 0.1) {
        // Break out: climb straight ahead and come round again.
        goAround(ac, 'spacing on final', true);
        ac.aiPlan.phase = 'new';
    }
}

/** The lowest altitude on the way to the base point: the join altitude, or the MVAs still ahead. */
function routeAlt(ac, plan) {
    const ahead = Math.ceil(maxMvaAlong(ac, plan.P) / 500) * 500;
    return Math.max(plan.f.joinAlt, ahead, G.world.minAlt);
}

function aiDeparture(ac) {
    if (ac.via) return;                    // flying its SID
    if (!ac.aiClimb) {
        ac.aiClimb = true;
        const aboveFinals = Math.max(...G.active.arr.map(e => planFinal(e).joinAlt)) + 1000;
        ai(ac, { alt: Math.max(ac.tAlt, aboveFinals, Math.ceil((G.world.elev + 7000) / 1000) * 1000, Math.ceil(maxMvaAlong(ac, ac.gate) / 1000) * 1000), spd: 250 });
        return;
    }
    // Runway heading until above the arrivals and above the terrain toward the gate, then direct.
    const aboveFinals = Math.max(...G.active.arr.map(e => planFinal(e).joinAlt)) + 1000;
    if (!ac.aiConflict && !(ac.aiLockUntil > G.t)) {
        const want = ac.aiTurned ? Math.max(exitAlt(ac), Math.ceil(maxMvaAlong(ac, ac.gate) / 1000) * 1000) : Math.max(aboveFinals, Math.ceil(maxMvaAlong(ac, ac.gate) / 1000) * 1000, exitAlt(ac));
        if (ac.tAlt < want && want <= 24000) ai(ac, { alt: want });
    }
    if (!ac.aiTurned && ac.alt >= aboveFinals - 300 && agl(ac) >= (ac.straightOut || 0) - 100 && ac.alt >= maxMvaAlong(ac, ac.gate) - 500 && !(ac.aiCeil && ac.aiConflict)) {
        ac.aiTurned = true;
        ai(ac, { direct: ac.gate, alt: Math.max(exitAlt(ac), ac.tAlt), spd: 280 });
    } else if (ac.aiTurned && !ac.aiConflict && ac.tAlt < exitAlt(ac)) ai(ac, { alt: exitAlt(ac) });
}

/**
 * Conflict probe: straight-line positions over the next two minutes. Pairs
 * the sequence already spaces (arrivals bound for the same final, holds in
 * one stack) are left to it; for the rest, the system's lower-priority
 * aircraft is stopped at an altitude 1,000 ft clear of the other's whole
 * climb or descent, never below its MVA, until the conflict is gone. It
 * never moves anything the player works or anything established on an ILS.
 */
function aiConflicts() {
    const air = G.aircraft.filter(a => a.state === 'air');
    const fut = (a, t) => {
        const tas = a.spd * (1 + a.alt / 1000 * 0.02) / 3600;
        const vs = a.alt < a.tAlt ? 2000 / 60 : a.alt > a.tAlt ? -1800 / 60 : 0;
        const z = vs > 0 ? Math.min(a.tAlt, a.alt + vs * t) : vs < 0 ? Math.max(a.tAlt, a.alt + vs * t) : a.alt;
        const h = a.holdAt ? null : a.hdg;
        return h == null ? { x: a.x, y: a.y, z } : { x: a.x + Math.sin(h * D2R) * tas * t, y: a.y + Math.cos(h * D2R) * tas * t, z };
    };
    const movable = a => !mine(a) && a.freq === 'APP' && !a.appr && !a.pattern && a.aiPlan?.phase !== 'hold';
    const sameFlow = (a, b) => a.kind === 'arr' && b.kind === 'arr' && a.aiPlan?.e && b.aiPlan?.e && sameRunwayish(a.aiPlan.e, b.aiPlan.e)
        && (a.aiPlan.phase === 'final' || b.aiPlan.phase === 'final');
    const flagged = new Set();
    for (let i = 0; i < air.length; i++) {
        for (let j = i + 1; j < air.length; j++) {
            const a = air[i], b = air[j];
            if (a.appr?.loc && b.appr?.loc) continue;
            if (sameFlow(a, b) && a.appr && b.appr) continue;
            let hit = false;
            const need = Math.max(SEP_NM, wakeNm(a, b), wakeNm(b, a)) + 1.5;
            for (let t = 0; t <= 120; t += 10) {
                const pa = fut(a, t), pb = fut(b, t);
                if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < need && Math.abs(pa.z - pb.z) < 950) { hit = true; break; }
            }
            if (!hit) continue;
            const cand = [a, b].filter(movable);
            if (!cand.length) continue;
            let mover = cand[0];
            if (cand.length === 2) {
                if (a.kind !== b.kind) mover = a.kind === 'dep' ? a : b;
                else mover = (a.aiPlan?.slot || a.born) > (b.aiPlan?.slot || b.born) ? a : b;
            }
            const other = mover === a ? b : a;
            flagged.add(mover);
            const mva = Math.ceil(maxMvaAlong(mover, fut(mover, 240)) / 500) * 500;
            const hiO = Math.max(other.alt, other.tAlt), loO = Math.min(other.alt, other.tAlt);
            const above = Math.ceil((hiO + 1000) / 1000) * 1000, below = Math.floor((loO - 1000) / 1000) * 1000;
            // Stop where it is if that already works; else the nearer legal side.
            const here = Math.round(mover.alt / 1000) * 1000;
            let alt;
            if ((here >= above || here <= below) && here >= mva) alt = here;
            else alt = below >= mva && Math.abs(mover.alt - below) < Math.abs(mover.alt - above) ? below : Math.max(above, mva);
            if (alt > 24000) continue;
            if (alt > mover.alt) { mover.aiFloor = alt; mover.aiCeil = 0; } else { mover.aiCeil = alt; mover.aiFloor = 0; }
            mover.aiLockUntil = G.t + 30;
            if (Math.abs(mover.tAlt - alt) >= 500 || (alt % 1000 === 0 && mover.tAlt !== alt)) ai(mover, { alt });
        }
    }
    for (const a of air) { a.aiConflict = flagged.has(a); if (!a.aiConflict) { a.aiFloor = 0; a.aiCeil = 0; } }
}

function tick(dt) {
    G.t += dt;
    if ((G.aiT += dt) >= 2) { G.aiT = 0; aiControl(); }
    if (G.opts.weather) weather(dt);

    // Traffic. The gap shrinks over the first ninety minutes, then holds.
    if (G.t >= G.nextSpawn) {
        const cfg = TRAFFIC[G.level];
        const live = G.aircraft.length;
        let ok = false;
        if (live < cfg.max) {
            const waiting = G.aircraft.filter(a => a.state === 'wait').length;
            const wantDep = waiting < cfg.queue && Math.random() < 0.45;
            ok = wantDep ? spawnDeparture() || spawnArrival() : spawnArrival() || spawnDeparture();
        }
        const ramp = Math.max(0.55, 1 - (G.t / 5400) * 0.45);
        G.nextSpawn = G.t + (ok ? cfg.gap * ramp * rand(0.7, 1.3) : 8);
    }
    // Pattern work and transitions, for a Tower you're working: in VMC (3 SM), and not with "no pattern work" on the ATIS (IFATC 3.4.1).
    // With radar (Infinite Flight rules), VFR inbounds on radar vectors or flight following, for your Tower or your Approach (IFATC 3.6.3).
    if ((G.positions.has('TWR') || G.positions.has('APP')) && G.t >= (G.nextVfr ?? 30)) {
        G.nextVfr = G.t + rand(60, 140);
        const cap = { light: 1, normal: 2, busy: 3, event: 4 }[G.level];
        const inPattern = G.aircraft.filter(a => a.patternWork).length;
        if (G.positions.has('TWR') && G.opts.pattern && visualWx() && !hasRemark('noPattern') && inPattern < cap) spawnDeparture(true);
        else if (G.positions.has('TWR') && noRadar() && Math.random() < 0.5 && G.aircraft.filter(a => a.transit).length < 2) spawnTransit();
        else if (G.rules.id === 'ifatc' && !noRadar() && visualWx() && Math.random() < 0.4 && G.aircraft.filter(a => a.vfrIn && a.state === 'air').length < 2) spawnVfrInbound();
    }

    if (G.t >= G.nextWind) shiftWind();

    for (const ac of G.aircraft) {
        if (ac.state !== 'air' || ac.kind !== 'arr') continue;
        if (ac.divert) continue;
        if (ac.transit) transitNav(ac);
        else if (ac.circuit && !ac.appr) circuitNav(ac);
        else if (!ac.appr && (ac.pattern || towerInbound(ac))) patternNav(ac);
        else if (ac.vfrIn && ac.freq === 'APP' && !ac.appr && !ac.vfrOrbited && Math.hypot(ac.x, ac.y) < 6) {
            // Still with Approach this close in: it orbits once and asks to go to Tower.
            ac.vfrOrbited = true; ac.orbit = { dir: 'L', rem: 360 };
            pilot(ac, `${facName('APP')}, ${ac.radio}, ${Math.round(Math.hypot(ac.x, ac.y))} miles from the field, request frequency change to Tower, orbiting left.`);
        }
    }
    for (const ac of G.aircraft) step(ac, dt);
    G.aircraft = G.aircraft.filter(a => !a.gone);
    if (G.selected && G.selected.gone) select(null);
    separation();
    terrainCheck();
    if (G.pendingGround && !G.aircraft.some(a => a.state === 'rollout')) swapGround(G.pendingGround);
    if (G.ground) surfaceCheck();
    G.aircraft = G.aircraft.filter(a => !a.gone);
    if (G.selected && G.selected.gone) select(null);
    G.floaters = G.floaters.filter(f => f.until > G.t);
}

function shiftWind() {
    G.nextWind = G.t + rand(900, 1500);
    G.wind = { dir: norm(G.wind.dir + Math.round(rand(-7, 7)) * 10) || 360, spd: Math.round(rand(4, 20)) };
    const prev = G.active.key;
    if (G.atisCfg.mode === 'auto') G.active = computeActive(G.world, G.wind);
    G.atis = (G.atis + 1) % 26;
    G.altim = clamp(G.altim + Math.round(rand(-3, 3)), 2950, 3050);
    G.met = makeMet();
    renderAtis();
    const tail = G.atisCfg.mode === 'manual' && G.active.arr.find(e => headwind(e) < -10);
    if (tail) sys(`Runway ${tail.id} now has a ${-headwind(tail)} kt tailwind: time to change runways (ATIS).`, 'bad');
    if (G.active.key === prev) {
        sys(`Information ${PHONETIC[G.atis]} is current: wind ${hdg3(G.wind.dir)} at ${G.wind.spd}, altimeter ${G.altim}.`);
        return;
    }
    sys(`Information ${PHONETIC[G.atis]}: wind ${hdg3(G.wind.dir)} at ${G.wind.spd}, altimeter ${G.altim}. Runway change — landing ${G.active.arr.map(e => e.id).join(', ')}, departing ${G.active.dep.map(e => e.id).join(', ')}.`, 'good');
    runwayChange();
}

/** Everyone moved onto the runways now in use. */
function runwayChange() {
    toast(`Runway change: ${G.active.arr.map(e => e.id).join(' / ')}`, 'good');
    for (const ac of G.aircraft) {
        if ((noRadar() || HANDOFF_SAY[ac.handoff]) && ac.kind === 'arr' && ac.freq === 'TWR' && ac.state === 'air' && (ac.pattern || ac.landClr || ac.appr) && !G.active.arr.includes((ac.appr || ac.pattern || {}).end)) {
            Object.assign(ac, { pattern: null, appr: null, landClr: false, noEntryFlagged: false });
            pilot(ac, `Tower, ${ac.radio}, copy the runway change, request a new pattern entry.`);
            continue;
        }
        if (ac.kind !== 'dep' || G.active.dep.includes(ac.rwy)) continue;
        if (G.ground) {
            if (!['gate', 'push', 'pushed', 'taxi', 'wait'].includes(ac.state)) continue;
            ac.rwy = nextDepRunway(); ac.tHdg = ac.rwy.course;
            if (ac.state === 'taxi' || ac.state === 'wait') {
                Object.assign(ac, { state: 'pushed', route: null, freq: 'GND', spd: 0, crossReq: null });
                pilot(ac, `${facName('GND')}, ${ac.radio}, we'll need new taxi instructions for runway ${ac.rwy.id}.`);
            }
            continue;
        }
        if (ac.state !== 'wait') continue;
        ac.rwy = nextDepRunway();
        ac.x = ac.rwy.thr.x; ac.y = ac.rwy.thr.y; ac.hdg = ac.tHdg = ac.rwy.course;
    }
    renderCard(true);
}

function step(ac, dt) {
    const p = ac.perf, elev = G.world.elev;

    if (groundStep(ac, dt)) return;
    if (ac.state === 'wait' || ac.state === 'luaw') {
        if (G.t >= ac.remindAt) {
            ac.remindAt = G.t + 240;
            if (ac.freq === 'GND') { ac.remindAt = G.t + 60; pilot(ac, `Ground, ${ac.radio}, still holding short ${ac.rwy.id}, ready for Tower.`); }
            else pilot(ac, ac.state === 'luaw' ? `Tower, ${ac.radio}, lined up and waiting on ${ac.rwy.id}.` : `Tower, ${ac.radio}, still holding short ${ac.rwy.id}.`);
        }
        return;
    }
    if (ac.state === 'rto') {
        // Rejected takeoff: brake to a stop, then back to the holding point to go again.
        ac.spd = Math.max(0, ac.spd - 6 * dt);
        move(ac, dt);
        if (ac.spd <= 0) {
            const hold = G.ground && G.ground.holds.get(ac.rwy);
            const plan = hold && planTaxi(Object.assign(ac, { state: 'wait' }), { kind: 'rwy', end: ac.rwy });
            if (plan && !plan.err) { startTaxi(ac, plan.r, 'runway'); ac.toTower = true; }
            else Object.assign(ac, { state: 'wait', x: ac.rwy.thr.x, y: ac.rwy.thr.y, hdg: ac.rwy.course, remindAt: G.t + 120 });
            pilot(ac, `${ac.radio}, clear of the runway after the rejected takeoff, we'd like to try again.`);
        }
        return;
    }
    if (ac.state === 'roll') {
        ac.spd += (ac.immediate ? 4.2 : 3.5) * dt;
        move(ac, dt);
        if (ac.spd >= p.vr) {
            ac.state = 'air';
            ac.alt = elev + 20;
            // Clear of the runway once airborne and past ~6,000 ft (7110.65 3-9-6).
            G.occupied.set(ac.rwy.phys, G.t + 5);
            G.lastDepAt.set(ac.rwy.phys, G.t);
            if (p.wake === 'S' || p.wake === 'H') G.depWake.set(ac.rwy.phys, { t: G.t, cs: ac.cs, wake: p.wake });
            if (ac.patternWork) { startCircuit(ac); return; }
            // On a SID: climb via it, to the exit altitude (unless a heading was given with the takeoff clearance).
            const sid = sidFor(ac.gate, ac.rwy);
            if (sid && !ac.hdgAssigned) { ac.via = { kind: 'SID', id: sid.id, legs: sid.legs, i: 0, vert: true, top: ac.tAlt }; ac.sid = sid.id; }
            // IFATC 3.2.11: Tower keeps it until half a mile past the departure end, not right after rotation.
            if (G.rules.id === 'ifatc') ac.freq = 'TWR';
            else departureCheckIn(ac);
        }
        return;
    }

    // ---- lateral
    if (ac.appr) {
        if (!approachLateral(ac)) return;   // landed or went around this tick
    } else if (ac.holdAt) {
        holdingPattern(ac, dt);
    } else if (ac.direct) {
        const f = ac.direct;
        ac.tHdg = brg(f.x - ac.x, f.y - ac.y);
        if (Math.hypot(f.x - ac.x, f.y - ac.y) < 1) ac.direct = null;
    } else if (ac.via && !(ac.kind === 'dep' && agl(ac) < Math.max(400, ac.straightOut || 0))) {
        viaStep(ac);
    }
    const maxRate = turnRate(ac);
    if (ac.orbit) {
        const dir = ac.orbit.dir === 'L' ? -1 : 1;
        ac.rr = (ac.rr || 0) + clamp(dir * maxRate - (ac.rr || 0), -ROLL_ACCEL * dt, ROLL_ACCEL * dt);
        ac.hdg = norm(ac.hdg + ac.rr * dt);
        if ((ac.orbit.rem -= Math.abs(ac.rr * dt)) <= 0) ac.orbit = null;
    } else {
        // Departures fly runway heading until 400 ft (or the ATIS straight-out height).
        const target = ac.kind === 'dep' && agl(ac) < Math.max(400, ac.straightOut || 0) ? ac.rwy.course : ac.tHdg;
        let d = diff(ac.hdg, target);
        if (Math.abs(d) < 15 && target === ac.tHdg) ac.turn = null;     // a turn direction only matters until the heading is nearly there
        if (ac.turn === 'L' && d > 0) d -= 360;
        if (ac.turn === 'R' && d < 0) d += 360;
        // Rolling in and out: the turn rate builds and eases at the roll rate, and comes off as the heading comes up.
        const want = Math.sign(d) * Math.min(maxRate, Math.abs(d) * 0.6);
        ac.rr = (ac.rr || 0) + clamp(want - (ac.rr || 0), -ROLL_ACCEL * dt, ROLL_ACCEL * dt);
        if (Math.abs(d) < 0.3 && Math.abs(ac.rr) < 0.4) { ac.hdg = norm(target); ac.rr = 0; }
        else ac.hdg = norm(ac.hdg + ac.rr * dt);
    }

    // ---- vertical
    let tAlt = ac.tAlt;
    let rate = ac.alt < tAlt ? (ac.kind === 'dep' ? (ac.alt < 10000 ? p.climb : p.climb * 0.75) : 1800) : p.desc;
    let tSpd = ac.tSpd;
    if (ac.appr && ac.appr.loc) {
        const gsAlt = elev + Math.max(0, ac.appr.along) * GS_FT_PER_NM;
        if (ac.alt <= gsAlt + 100) ac.appr.gs = true;
        // Once established, down the glideslope; from above, at a normal rate to catch it.
        tAlt = Math.min(gsAlt, ac.alt);
        rate = ac.appr.gs ? 2200 : p.desc;
        // Stabilized by 1,000 ft above the field or go around.
        if (ac.appr.along < 1000 / GS_FT_PER_NM && ac.alt > gsAlt + 300) { goAround(ac, 'not stabilized'); return; }
    }
    if (ac.appr) {
        // The approach clearance cancelled assigned speeds; the crew flies its own profile unless one was restated.
        const al = ac.appr.along;
        if (al < FAF_NM) tSpd = p.vapp;
        else tSpd = al > 15 ? Math.min(ac.tSpd, 210) : al > 8 ? 180 : 160;
        // A speed to hold until a given mile final (a restated one, 7110.65 5-7-1), then its own profile.
        if (ac.appr.spd != null && al >= (ac.appr.spdUntil ?? FAF_NM)) tSpd = ac.appr.spd;
    }
    if (ac.holdAt) tSpd = Math.min(tSpd, ac.alt <= 6000 ? 200 : ac.alt <= 14000 ? 230 : 265);  // holding speeds
    // "Adjust speed to follow aircraft ahead": its speed, within this one's limits, until inside the final approach fix.
    if (ac.matchSpd) { if (ac.matchSpd.gone || ac.appr?.along < FAF_NM) ac.matchSpd = null; else tSpd = Math.max(minSpeed(ac), Math.round(ac.matchSpd.spd)); }
    if (ac.expediteUntil > G.t) rate *= 1.3;
    // The vertical speed builds and eases (about 500 fpm each second) and levels off smoothly, rather than jumping.
    const dAlt = tAlt - ac.alt;
    const wantVs = Math.sign(dAlt) * Math.min(rate, Math.abs(dAlt) * 4);
    ac.vs = (ac.vs || 0) + clamp(wantVs - (ac.vs || 0), -500 * dt, 500 * dt);
    if (Math.abs(dAlt) < 15 && Math.abs(ac.vs) < 150) { ac.alt = tAlt; ac.vs = 0; }
    else ac.alt += ac.vs / 60 * dt;

    // ---- speed: 250 below 10,000 (14 CFR 91.117)
    if (ac.alt < 10000 && tSpd > 250) tSpd = 250;
    // Jets speed up about 1.3 kt/s (less climbing), and slow about 0.8 kt/s level, 0.5 kt/s coming down; flaps out on final help.
    const ds = tSpd - ac.spd, descending = ac.vs < -300;
    const decel = ac.appr?.loc ? 1.0 : descending ? 0.5 : 0.8, accel = ac.vs > 300 ? 0.9 : 1.3;
    ac.spd += clamp(ds, -decel * dt, accel * dt);

    move(ac, dt);

    // ---- trail
    if ((ac.trailT += dt) >= 4) {
        ac.trailT = 0;
        ac.trail.push({ x: ac.x, y: ac.y });
        if (ac.trail.length > 7) ac.trail.shift();
    }

    // ---- leaving the scope
    const r = Math.hypot(ac.x, ac.y);
    if (r > SCOPE_NM) exitScope(ac);
}

/**
 * How fast an aircraft can turn: standard rate (3°/s) when slow, limited by
 * 25° of bank at speed. Rate = 1091 · tan(bank) / TAS, about 2°/s at
 * 250 knots indicated low down.
 */
function turnRate(ac) {
    const tas = ac.spd * (1 + ac.alt / 1000 * 0.02);
    return Math.min(TURN_RATE, 1091 * Math.tan(MAX_BANK * D2R) / Math.max(tas, 100));
}

/** A standard right-hand hold: direct to the fix, outbound one minute (1½ above 14,000), back inbound. */
function holdingPattern(ac, dt) {
    const h = ac.holdAt, f = h.fix;
    const leg = ac.alt <= 14000 ? 60 : 90;
    const out = norm(h.inbound + 180);
    if (h.phase === 'to' || h.phase === 'in') {
        ac.tHdg = brg(f.x - ac.x, f.y - ac.y); ac.turn = null;
        if (Math.hypot(f.x - ac.x, f.y - ac.y) < 0.6) { h.phase = 'turnOut'; ac.tHdg = out; ac.turn = 'R'; }
    } else if (h.phase === 'turnOut') {
        if (Math.abs(diff(ac.hdg, out)) < 1) { h.phase = 'out'; h.timer = leg; }
    } else if (h.phase === 'out') {
        ac.tHdg = out; ac.turn = null;
        if ((h.timer -= dt) <= 0) { h.phase = 'turnIn'; ac.tHdg = h.inbound; ac.turn = 'R'; }
    } else if (h.phase === 'turnIn') {
        if (Math.abs(diff(ac.hdg, h.inbound)) < 1) h.phase = 'in';
    }
}

function move(ac, dt) {
    const tas = ac.spd * (1 + Math.max(0, ac.alt) / 1000 * 0.02);
    const d = tas / 3600 * dt;
    ac.x += Math.sin(ac.hdg * D2R) * d;
    ac.y += Math.cos(ac.hdg * D2R) * d;
}

/** Localizer intercept and tracking. Returns false when the flight ended or broke off this tick. */
function approachLateral(ac) {
    const ap = ac.appr, e = ap.end, c = e.course;
    const g = finalGeom(ac, e);
    ap.along = g.along; ap.xt = g.xt;
    const elev = G.world.elev;

    if (!ap.loc) {
        const ia = diff(c, ac.hdg);
        const closing = g.xt * Math.sin(ia * D2R) < 0;
        const tas = ac.spd * (1 + ac.alt / 1000 * 0.02);
        const radius = tas / 3600 / (turnRate(ac) * D2R);
        // Turn anticipation, plus the couple of seconds it takes to roll into the turn.
        const lead = radius * (1 - Math.cos(Math.min(Math.abs(ia), 90) * D2R)) + tas / 3600 * 2 * Math.abs(Math.sin(ia * D2R)) + 0.1;
        if (Math.abs(g.xt) < 0.15 || (closing && Math.abs(g.xt) <= lead)) {
            ap.loc = true;
        } else if (g.along < FAF_NM) {
            ac.appr = null;
            pilot(ac, `${ac.radio}, we're through the ${e.id} localizer, request vectors.`);
            return true;
        } else {
            return true;   // keep the assigned heading until the intercept
        }
    }
    ac.tHdg = norm(c + clamp(-g.xt * 40, -30, 30));
    ac.turn = null;
    if (!ap.est && Math.abs(g.xt) < 0.2 && Math.abs(diff(ac.hdg, c)) < 10) {
        ap.est = true;
        if (ac.freq === 'APP') ac.handoff = ap.type;
        ac.freq = 'TWR';
        // Approach hands it to the tower; you are both, so the call comes straight to you.
        pilot(ac, `${facName('TWR')}, ${ac.radio}, ${Math.max(1, Math.round(g.along))} mile final runway ${e.id}.`);
    }

    // The runway has to be clear by the time we get there (7110.65 3-10-3).
    if (g.along < 1.2 && g.along > 0.15) {
        const eta = g.along / (ac.spd / 3600);
        if (runwayBusyUntil(e.phys) > G.t + eta) { goAround(ac, 'runway occupied'); return false; }
    }
    if (g.along <= LAND_CLR_NM && !ac.landClr) { goAround(ac, 'no landing clearance'); return false; }
    // Decision height, about 200 ft: no runway in sight below CAT I minimums.
    if (g.along <= 0.65 && below(G.met) && G.rules.minimums) { goAround(ac, 'minimums, no runway in sight', true); return false; }
    if (g.along <= 0.15) {
        if (ac.alt - elev > 300 || Math.abs(g.xt) > 0.3) { goAround(ac, 'not stabilized'); return false; }
        if (runwayBusyUntil(e.phys) > G.t) { goAround(ac, 'runway occupied'); return false; }
        if (crossingTraffic(e)) { goAround(ac, 'traffic on the crossing runway'); return false; }
        land(ac, e);
        return false;
    }
    return true;
}

function land(ac, e) {
    if (ac.circuit?.work && ac.optionClr) { touchAndGo(ac, e); return; }
    G.stats.landed++;
    if (ac.emerg) {
        // Safe on the ground. The trucks inspect the runway before anyone else uses it.
        G.occupied.set(e.phys, Math.max(G.occupied.get(e.phys) || 0, G.t + 120));
        if (G.positions.has('TWR') || G.positions.has('APP')) award(ac, 10, 'emergency');
        sys(`${ac.cs} is down safely on ${e.id}. Runway closed for two minutes while the fire crews check it.`, 'good');
        toast(`Runway ${e.id} closed: emergency vehicles`, 'bad', 6000);
        G.stats.emergencies = (G.stats.emergencies || 0) + 1;
    }
    const exits = G.ground && G.ground.exits.get(e);
    if (exits && exits.length) {
        // Roll out and turn off at the first exit past about 0.9 NM, or the last one.
        const ex = exits.find(x => x.along >= 0.9) || exits[exits.length - 1];
        Object.assign(ac, { state: 'rollout', landEnd: e, exitAt: ex, alt: G.world.elev, hdg: e.course, appr: null, spd: ac.spd - 10 });
    } else {
        ac.gone = true;
        G.occupied.set(e.phys, G.t + 35);
    }
    if (!(G.positions.has('TWR') || G.positions.has('APP'))) return;
    const comp = G.wind.spd * Math.cos(diff(e.course, G.wind.dir) * D2R);
    if (comp < -5) { award(ac, 5, 'tailwind'); sys(`${ac.cs} landed ${e.id} with a ${Math.round(-comp)} kt tailwind.`); }
    else { award(ac, 10); sys(`${ac.cs} landed runway ${e.id}.`, 'good'); }
}

function exitScope(ac) {
    ac.gone = true;
    if (ac.divert) return;                          // sent elsewhere: not yours any more
    if (!mine(ac)) {
        if (ac.kind === 'dep') G.stats.departed++;
        return;
    }
    if (ac.kind === 'dep') {
        const b = brg(ac.x, ac.y);
        const onGate = Math.abs(diff(b, ac.gate.bearing)) <= 20;
        G.stats.departed++;
        if (onGate && ac.alt >= exitAlt(ac) - 50) {
            award(ac, 10);
            atc(`${ac.radio}, contact Center, good day.`);
            pilot(ac, `Over to Center, ${ac.radio}.`);
        } else if (onGate) {
            award(ac, 5, 'low');
            sys(`${ac.cs} left via ${ac.gate.name} below ${fmtAlt(exitAlt(ac))}.`, 'bad');
        } else {
            award(ac, -10);
            sys(`${ac.cs} left the airspace away from ${ac.gate.name}.`, 'bad');
            toast(`${ac.cs} missed its exit gate`, 'bad');
        }
    } else {
        award(ac, -20);
        sys(`${ac.cs} left your airspace without landing.`, 'bad');
        toast(`${ac.cs} left the airspace`, 'bad');
    }
}

/** Within the tower's patch: inside 5 NM of the field and below 2,500 ft above it. */
const nearField = a => Math.hypot(a.x, a.y) < 5 && agl(a) < 2500;

/**
 * If one of the pair is "directly behind" the other for wake purposes — in
 * trail on the same final, or within 2,500 ft of the leader's track and
 * not more than 1,000 ft below it — return [leader, follower].
 */
function inTrail(a, b) {
    const ea = a.appr?.loc ? a.appr.end : null, eb = b.appr?.loc ? b.appr.end : null;
    if (ea && eb && sameRunwayish(ea, eb)) return a.appr.along < b.appr.along ? [a, b] : [b, a];
    for (const [lead, follow] of [[a, b], [b, a]]) {
        if (follow.alt > lead.alt + 100) continue;
        if (Math.abs(diff(lead.hdg, follow.hdg)) > 45) continue;
        const h = lead.hdg * D2R;
        const dx = follow.x - lead.x, dy = follow.y - lead.y;
        const along = dx * Math.sin(h) + dy * Math.cos(h);          // negative: behind the leader
        const lateral = Math.abs(dx * Math.cos(h) - dy * Math.sin(h));
        if (along < 0 && lateral < 2500 / 6076) return [lead, follow];
    }
    return null;
}

/** The separation this pair needs right now, in NM, with the reason; null when none applies. */
function requiredSep(a, b) {
    const ea = a.appr?.loc ? a.appr.end : null, eb = b.appr?.loc ? b.appr.end : null;
    if (ea && eb && !sameRunwayish(ea, eb)) {
        const ft = parallelFt(ea, eb);
        if (ft != null && ft >= 4300) return null;                                         // 7110.65 5-9-7 independent
        if (ft != null && ft >= 2500) return { nm: 1.5, why: 'dependent parallel approaches, 1.5 miles diagonal' }; // 5-9-6
    }
    // Arrival and departure close in at the field: the tower separates them visually.
    if (a.kind !== b.kind && nearField(a) && nearField(b)) return null;

    const trail = inTrail(a, b);
    const wake = trail ? wakeNm(trail[0], trail[1]) : 0;
    // 7110.65 5-8-3: successive departures, courses diverging 15° or more, 1 mile — not when wake applies.
    if (a.kind === 'dep' && b.kind === 'dep' && nearField(a) && nearField(b) && !wake
        && (sameRunwayish(a.rwy, b.rwy) || parallelFt(a.rwy, b.rwy) != null)
        && Math.abs(diff(a.hdg, b.hdg)) >= 15) return { nm: 1, why: 'diverging departures' };

    let nm = SEP_NM, why = 'radar separation';
    // 7110.65 5-5-4: 2.5 miles in trail on the same final inside 10 miles.
    if (G.rules.reducedTrail && ea && eb && sameRunwayish(ea, eb) && a.appr.along < 10 && b.appr.along < 10) { nm = 2.5; why = 'in trail on final'; }
    if (wake > nm) { nm = wake; why = `wake turbulence behind a ${WAKE_NAME[trail[0].perf.wake]}`; }
    return { nm, why };
}

function separation() {
    const air = G.aircraft.filter(airborne);
    for (const a of G.aircraft) a.conflict = false;
    const now = new Set();
    for (let i = 0; i < air.length; i++) {
        for (let j = i + 1; j < air.length; j++) {
            const a = air[i], b = air[j];
            const dz = Math.abs(a.alt - b.alt);
            // In trail on one glideslope the spacing is the miles, not the feet between them.
            const sameFinal = a.appr?.loc && b.appr?.loc && sameRunwayish(a.appr.end, b.appr.end);
            // No radar (IFATC 3.3): Tower separates its pattern traffic by sequence, not radar minima; only a real conflict counts.
            const visual = a.freq === 'TWR' && b.freq === 'TWR' && (noRadar() || a.circuit || b.circuit || a.transit || b.transit || a.patternWork || b.patternWork);
            if (!sameFinal && dz >= (visual ? 500 : SEP_FT - 25)) continue;              // 1,000 ft vertical (5-5-5)
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d >= 8) continue;
            const req = visual ? { nm: 1, why: 'pattern traffic (visual)' } : requiredSep(a, b);
            if (!req || d >= req.nm) continue;
            const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
            now.add(key);
            a.conflict = b.conflict = true;
            // The system's own traffic is the system's problem.
            if (!mine(a) && !mine(b)) {
                if (!G.conf.has('s' + key)) {
                    G.conf.set('s' + key, 1);
                    G.stats.sysLosses = (G.stats.sysLosses || 0) + 1;
                    // Kept for ?debug checks of the system's own controlling.
                    if (window.approach) (G.sysLossLog = G.sysLossLog || []).push({ a: a.cs, b: b.cs, pa: a.aiPlan?.phase || a.kind, pb: b.aiPlan?.phase || b.kind, la: a.appr?.loc, lb: b.appr?.loc, za: Math.round(a.alt), zb: Math.round(b.alt), d: +d.toFixed(2), req: req.nm, why: req.why, ea: a.appr?.end.id || a.aiPlan?.e?.id, eb: b.appr?.end.id || b.aiPlan?.e?.id });
                }
                now.add('s' + key);
                continue;
            }
            let c = G.conf.get(key);
            if (!c) {
                c = { t: G.t, last: G.t, near: false };
                G.conf.set(key, c);
                G.stats.incidents++;
                G.score -= 10;
                sys(`Separation lost: ${a.cs} and ${b.cs}, ${d.toFixed(1)} miles — ${req.why} needs ${req.nm} miles${sameFinal ? ' in trail' : ' or 1,000 feet'} (7110.65 5-5-4).`, 'bad');
                toast(`Separation lost — ${a.cs} / ${b.cs}`, 'bad');
            } else if (G.t - c.last >= 10) {
                c.last = G.t;
                G.score -= 2;
            }
            if (!c.near && d < 0.5 && dz < 500) {
                c.near = true;
                G.score -= 40;
                sys(`Near miss between ${a.cs} and ${b.cs}!`, 'bad');
                toast(`NEAR MISS — ${a.cs} / ${b.cs}`, 'bad');
            }
        }
    }
    for (const k of G.conf.keys()) if (!now.has(k)) G.conf.delete(k);
}

/* ------------------------------------------------------------------ */
/* Scope                                                               */
/* ------------------------------------------------------------------ */

const view = { x: 0, y: 0, scale: 10, w: 0, h: 0, dpr: 1 };
let canvas, ctx;
let drag = null;              // { id, mode: 'ac'|'gnd'|'pan', ac, sx, sy, moved, hdg, tgt, plan }
const pointers = new Map();
let pinch = null;

const PALETTE = {};
const SEL_PURPLE = '#c97fd6';            // Infinite Flight's selection ring and lines
PALETTE.radar = {
    bg: '#060b0f',
    outside: 'rgba(6,11,15,0.55)',
    mva: 'rgba(190,150,255,0.45)',
    ring: 'rgba(120,200,180,0.10)',
    ringLabel: 'rgba(140,210,190,0.35)',
    edge: 'rgba(120,200,180,0.35)',
    runway: '#d5dde6',
    center: 'rgba(79,209,255,0.35)',
    feather: 'rgba(79,209,255,0.06)',
    fixArr: '#7fb8c9',
    fixDep: '#f2c14e',
    fixApp: 'rgba(160,190,200,0.55)',
    arr: '#4fd1ff',
    dep: '#f2c14e',
    sel: '#ffffff',
    bad: '#ff5468',
    good: '#3ddc97',
};
// The light chart look: blue water, pale land, orange rings and approach lines.
PALETTE.chart = {
    bg: '#cfd5c6',
    outside: 'rgba(207,213,198,0.5)',
    mva: 'rgba(110,50,150,0.6)',
    ring: 'rgba(212,128,44,0.75)',
    ringLabel: 'rgba(150,80,20,0.9)',
    edge: '#d4802c',
    runway: '#5a4632',
    center: 'rgba(212,128,44,0.95)',
    feather: 'rgba(212,128,44,0.12)',
    fixArr: '#2f5d7a',
    fixDep: '#9a5b00',
    fixApp: 'rgba(60,80,100,0.7)',
    arr: '#1d5fbf',
    dep: '#a8560a',
    sel: '#111111',
    bad: '#d0102a',
    good: '#0f8a55',
};
let mapStyle = store.get('style', 'radar') === 'chart' ? 'chart' : 'radar';
let COLORS = PALETTE[mapStyle];

function fitView() {
    const r = canvas.getBoundingClientRect();
    view.w = r.width; view.h = r.height;
    view.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * view.dpr);
    canvas.height = Math.round(r.height * view.dpr);
}
/** How far the runways reach from the field's reference point, plus a margin. */
function fieldRadius() {
    return Math.max(1.2, ...G.world.ends.map(e => Math.hypot(e.thr.x, e.thr.y))) + 0.5;
}
/** Home view for the positions you work: the whole scope for Approach, the field for Tower and Ground. */
function resetView() {
    view.x = 0; view.y = 0;
    const r = !G || G.positions.has('APP') ? SCOPE_NM + 2 : G.positions.has('GND') && G.ground ? fieldRadius() : 8;
    view.scale = Math.min(view.w, view.h) / 2 / r;
}
const toS = (x, y) => [view.w / 2 + (x - view.x) * view.scale, view.h / 2 - (y - view.y) * view.scale];
const toW = (sx, sy) => [(sx - view.w / 2) / view.scale + view.x, -(sy - view.h / 2) / view.scale + view.y];

function draw() {
    const c = ctx;
    c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    c.fillStyle = COLORS.bg;
    c.fillRect(0, 0, view.w, view.h);
    if (!G) return;
    const s = view.scale;
    const [ox, oy] = toS(0, 0);

    // Land, water and height bands, inside the airspace only.
    if (G.dem) {
        const img = G.relief[mapStyle] || (G.relief[mapStyle] = renderRelief(G.dem, mapStyle, G.world.elev));
        const [ax, ay] = toS(-G.dem.half, G.dem.half), [bx, by] = toS(G.dem.half, -G.dem.half);
        c.save();
        c.beginPath(); c.arc(ox, oy, SCOPE_NM * s, 0, Math.PI * 2); c.clip();
        c.imageSmoothingEnabled = true;
        c.drawImage(img, ax, ay, bx - ax, by - ay);
        // Sharper tiles for whatever is on screen, at the screen's own resolution.
        const [wx0, wy1] = toW(0, 0), [wx1, wy0] = toW(view.w, view.h);
        const box = { x0: Math.max(wx0, -SCOPE_NM), x1: Math.min(wx1, SCOPE_NM), y0: Math.max(wy0, -SCOPE_NM), y1: Math.min(wy1, SCOPE_NM) };
        if (box.x0 < box.x1 && box.y0 < box.y1) G.tiles.draw(c, toS, s, view.dpr, box, mapStyle, (G.frame = (G.frame || 0) + 1));
        c.restore();
    }
    if (terrainOn()) drawMva();
    if (G.wx.length) drawWeather();
    // Outside the airspace is someone else's: dim it.
    c.fillStyle = COLORS.outside;
    c.beginPath();
    c.rect(0, 0, view.w, view.h);
    c.arc(ox, oy, SCOPE_NM * s, 0, Math.PI * 2, true);
    c.fill();

    // Range rings and the airspace edge.
    c.lineWidth = 1;
    c.font = '10px "JetBrains Mono", monospace';
    for (let r = 10; r < SCOPE_NM; r += 10) {
        c.strokeStyle = COLORS.ring;
        c.beginPath(); c.arc(ox, oy, r * s, 0, Math.PI * 2); c.stroke();
        c.fillStyle = COLORS.ringLabel;
        c.fillText(String(r), ox + 3, oy - r * s - 3);
    }
    c.strokeStyle = COLORS.edge;
    c.beginPath(); c.arc(ox, oy, SCOPE_NM * s, 0, Math.PI * 2); c.stroke();
    c.fillStyle = COLORS.ringLabel;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let b = 0; b < 360; b += 30) {
        const r1 = SCOPE_NM * s, r2 = r1 - 6;
        const sx = Math.sin(b * D2R), sy = -Math.cos(b * D2R);
        c.strokeStyle = COLORS.edge;
        c.beginPath(); c.moveTo(ox + sx * r1, oy + sy * r1); c.lineTo(ox + sx * r2, oy + sy * r2); c.stroke();
        c.fillText(hdg3(b), ox + sx * (r1 - 16), oy + sy * (r1 - 16));
    }
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';

    // Extended centerlines and ILS feathers for the arrival runways.
    for (const e of G.active.arr) {
        const cr = e.course * D2R, ux = Math.sin(cr), uy = Math.cos(cr);
        const [tx, ty] = toS(e.thr.x, e.thr.y);
        const L = 18;
        const spread = Math.tan(4 * D2R) * L;
        const px = Math.cos(cr), py = -Math.sin(cr);
        const fx = e.thr.x - ux * L, fy = e.thr.y - uy * L;
        const [a1x, a1y] = toS(fx + px * spread, fy + py * spread);
        const [a2x, a2y] = toS(fx - px * spread, fy - py * spread);
        c.fillStyle = COLORS.feather;
        c.beginPath(); c.moveTo(tx, ty); c.lineTo(a1x, a1y); c.lineTo(a2x, a2y); c.closePath(); c.fill();
        c.strokeStyle = COLORS.center;
        c.setLineDash([6, 6]);
        const [ex, ey] = toS(fx, fy);
        c.beginPath(); c.moveTo(tx, ty); c.lineTo(ex, ey); c.stroke();
        c.setLineDash([]);
        for (let m = 5; m <= 15; m += 5) {
            const [mx, my] = toS(e.thr.x - ux * m, e.thr.y - uy * m);
            const k = 4;
            c.beginPath(); c.moveTo(mx + px * k, my - py * k); c.lineTo(mx - px * k, my + py * k); c.stroke();
        }
    }

    // Runways.
    c.strokeStyle = COLORS.runway;
    c.lineCap = 'butt';
    const drawn = new Set();
    for (const e of G.world.ends) {
        if (drawn.has(e.phys)) continue;
        drawn.add(e.phys);
        const [ax, ay] = toS(e.thr.x, e.thr.y), [bx, by] = toS(e.far.x, e.far.y);
        c.lineWidth = Math.max(2, e.width * s);
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    }
    c.lineWidth = 1;
    if (s > 16) {
        c.fillStyle = 'rgba(213,221,230,0.75)';
        c.font = '10px "JetBrains Mono", monospace';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        for (const e of G.world.ends) {
            const cr = e.course * D2R;
            const [lx, ly] = toS(e.thr.x - Math.sin(cr) * 0.35, e.thr.y - Math.cos(cr) * 0.35);
            c.fillText(e.id, lx, ly);
        }
        c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    }

    drawProcedures();

    // Fixes.
    c.font = '10px "JetBrains Mono", monospace';
    for (const f of G.world.fixes) {
        if (f.kind === 'app' && !G.active.arr.includes(f.end)) continue;
        const [fx, fy] = toS(f.x, f.y);
        if (f.kind === 'wp') {
            // A procedure waypoint: a small triangle, named once zoomed in a little (Layers: on, dim or off).
            if (layers.wp === 'off') continue;
            c.strokeStyle = c.fillStyle = COLORS.fixApp; c.globalAlpha = layers.wp === 'dim' ? 0.22 : 0.55;
            c.beginPath(); c.moveTo(fx, fy - 3); c.lineTo(fx + 3, fy + 2.5); c.lineTo(fx - 3, fy + 2.5); c.closePath(); c.stroke();
            if (view.scale > (layers.wp === 'dim' ? 40 : 14)) c.fillText(f.name, fx + 5, fy + 3);
            c.globalAlpha = 1;
            continue;
        }
        c.strokeStyle = c.fillStyle = f.kind === 'dep' ? COLORS.fixDep : f.kind === 'arr' ? COLORS.fixArr : COLORS.fixApp;
        c.beginPath();
        if (f.kind === 'app') {
            c.moveTo(fx - 3, fy - 3); c.lineTo(fx + 3, fy + 3); c.moveTo(fx + 3, fy - 3); c.lineTo(fx - 3, fy + 3);
        } else if (f.kind === 'dep') {
            c.moveTo(fx, fy - 5); c.lineTo(fx + 5, fy + 4); c.lineTo(fx - 5, fy + 4); c.closePath();
        } else {
            c.moveTo(fx, fy + 5); c.lineTo(fx + 5, fy - 4); c.lineTo(fx - 5, fy - 4); c.closePath();
        }
        c.stroke();
        c.fillText(f.kind === 'dep' && f.exitAlt ? `${f.name} ${alt3(f.exitAlt)}+` : f.name, fx + 7, fy + (f.kind === 'app' ? 10 : 3));
        if (f.kind === 'dep') {
            // A short arrow outward: this is a way out.
            const b = f.bearing * D2R;
            const [qx, qy] = toS(f.x + Math.sin(b) * 3, f.y + Math.cos(b) * 3);
            c.setLineDash([2, 3]);
            c.beginPath(); c.moveTo(fx, fy); c.lineTo(qx, qy); c.stroke();
            c.setLineDash([]);
        }
    }

    if (G.surfaceMap && s > 25) drawSurface();

    // Departures waiting at each runway, as a queue count (no taxi map: they wait at the threshold).
    const queues = new Map();
    if (!G.ground) for (const a of G.aircraft) if (a.state === 'wait') queues.set(a.rwy, (queues.get(a.rwy) || 0) + 1);
    c.font = '700 10px "JetBrains Mono", monospace';
    for (const [e, n] of queues) {
        const [qx, qy] = toS(e.thr.x, e.thr.y);
        c.fillStyle = COLORS.dep;
        c.beginPath(); c.arc(qx, qy, 7, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#1a1408';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(n), qx, qy + 0.5);
        c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    }

    // The selected aircraft's intent: its fix or its runway.
    const sel = G.selected;
    if (sel && airborne(sel)) {
        const target = sel.direct || (sel.appr && sel.appr.end.thr) || (sel.kind === 'dep' ? sel.gate : null);
        if (target) {
            const [ax, ay] = toS(sel.x, sel.y), [bx, by] = toS(target.x, target.y);
            c.strokeStyle = COLORS.sel;
            c.globalAlpha = 0.35;
            c.setLineDash([3, 5]);
            c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
            c.setLineDash([]);
            c.globalAlpha = 1;
        }
    }

    // Aircraft. Radar doesn't see the ground, so surface traffic shows only zoomed in on the field.
    for (const a of G.aircraft) {
        if (!visible(a)) continue;
        if (a.state !== 'air' && a.state !== 'roll') drawSurfaceAircraft(a);
        else drawAircraft(a);
    }

    if (drag && drag.mode === 'gnd' && drag.moved) drawGroundDrag();

    if (drag && (drag.mode === 'ac' || drag.mode === 'twr') && drag.moved && drag.air) {
        const [ax, ay] = toS(drag.ac.x, drag.ac.y), t = drag.air, bad = !!t.err;
        c.save();
        c.strokeStyle = bad ? '#ff8a98' : COLORS.sel; c.setLineDash([4, 4]); c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(drag.px, drag.py); c.stroke(); c.setLineDash([]);
        if (t.x != null) { const [tx, ty] = toS(t.x, t.y); c.lineWidth = 2; c.beginPath(); c.arc(tx, ty, 10, 0, Math.PI * 2); c.stroke(); }
        c.font = '700 12px "JetBrains Mono", monospace';
        const w = c.measureText(t.label).width + 12, lx = Math.min(drag.px + 14, view.w - w - 4), ly = Math.max(drag.py - 30, 4);
        c.fillStyle = 'rgba(6,11,15,0.85)'; c.fillRect(lx, ly, w, 20);
        c.fillStyle = bad ? '#ff8a98' : COLORS.sel; c.textBaseline = 'middle'; c.fillText(t.label, lx + 6, ly + 10);
        c.restore(); c.textBaseline = 'alphabetic';
    } else
    // Heading drag.
    if (drag && drag.mode === 'ac' && drag.moved && drag.hdg != null) {
        const [ax, ay] = toS(drag.ac.x, drag.ac.y), [wx, wy] = toW(drag.px, drag.py);
        const nm = Math.hypot(wx - drag.ac.x, wy - drag.ac.y), min = nm / Math.max(drag.ac.spd, 60) * 60;
        c.save();
        c.strokeStyle = SEL_PURPLE; c.lineWidth = 2;
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(drag.px, drag.py); c.stroke();
        c.beginPath(); c.arc(drag.px, drag.py, 9, 0, Math.PI * 2); c.stroke();
        const l1 = `${hdg3(drag.hdg)}°  ${String(Math.round(nm)).padStart(3, '0')}NM`, l2 = `${Math.max(1, Math.round(min))}mn`;
        c.font = '700 13px "JetBrains Mono", monospace';
        const w = Math.max(c.measureText(l1).width, c.measureText(l2).width) + 14;
        const lx = clamp((ax + drag.px) / 2 - w / 2, 4, view.w - w - 4), ly = clamp((ay + drag.py) / 2 - 20, 4, view.h - 44);
        c.fillStyle = 'rgba(6,11,15,0.85)'; c.fillRect(lx, ly, w, 38);
        c.fillStyle = '#fff'; c.textBaseline = 'middle';
        c.fillText(l1, lx + 7, ly + 11); c.fillText(l2, lx + 7, ly + 27);
        c.restore(); c.textBaseline = 'alphabetic';
    }

    // The selected aircraft's filed route, from where it is: a dashed line through what's left, the fixes named.
    if (G.selected && !G.selected.gone && G.selected.state !== 'gate') {
        const a = G.selected, ahead = filedAhead(a);
        if (ahead.length) {
            c.save();
            c.strokeStyle = 'rgba(214,222,232,0.75)'; c.lineWidth = 1.4; c.setLineDash([6, 5]);
            c.beginPath(); c.moveTo(...toS(a.x, a.y));
            for (const p of ahead) c.lineTo(...toS(p.x, p.y));
            c.stroke(); c.setLineDash([]);
            c.font = '600 10px "JetBrains Mono", monospace'; c.fillStyle = 'rgba(232,238,245,0.9)';
            for (const p of ahead) { const [px, py] = toS(p.x, p.y); c.fillRect(px - 2, py - 2, 4, 4); c.fillText(p.name, px + 6, py - 6); }
            c.restore();
        }
    }

    // The selected aircraft, Infinite Flight style: a ring, and a line to the panel its commands are in.
    if (G.selected && !G.selected.gone) {
        const [x, y] = toS(G.selected.x, G.selected.y), side = $('.side').getBoundingClientRect(), r = canvas.getBoundingClientRect();
        c.save();
        c.strokeStyle = SEL_PURPLE; c.lineWidth = 1.5;
        c.beginPath(); c.arc(x, y, 16, 0, Math.PI * 2); c.stroke();
        c.beginPath();
        if (side.left >= r.right - 2) { c.moveTo(x + 16, y); c.lineTo(view.w - 1.5, y); c.moveTo(view.w - 1.5, 0); c.lineTo(view.w - 1.5, view.h); }
        else { c.moveTo(x, y + 16); c.lineTo(x, view.h - 1.5); c.moveTo(0, view.h - 1.5); c.lineTo(view.w, view.h - 1.5); }
        c.stroke();
        c.restore();
    }

    // Score floaters.
    c.font = '700 12px "JetBrains Mono", monospace';
    for (const f of G.floaters) {
        const [fx, fy] = toS(f.x, f.y);
        const life = (f.until - G.t) / 3;
        c.globalAlpha = clamp(life * 1.5, 0, 1);
        c.fillStyle = f.good ? COLORS.good : COLORS.bad;
        c.fillText(f.text, fx + 10, fy - 22 - (1 - life) * 20);
    }
    c.globalAlpha = 1;
}

function drawMva() {
    const c = ctx, m = G.mva, s = view.scale;
    const [ox, oy] = toS(0, 0);
    c.save();
    c.strokeStyle = COLORS.mva; c.fillStyle = COLORS.mva; c.lineWidth = 1;
    c.setLineDash([5, 4]);
    c.beginPath();
    // Lines only where the MVA steps, like an MVA chart's sector borders.
    for (let r = 0; r < m.rings; r++) {
        for (let w = 0; w < m.wedges; w++) {
            const v = mvaArea(m, r, w);
            if (r + 1 < m.rings && mvaArea(m, r + 1, w) !== v) {
                // Arc between this ring and the next. Canvas angles run clockwise from east.
                const a0 = (w * MVA_WEDGE - 90) * D2R, a1 = ((w + 1) * MVA_WEDGE - 90) * D2R, rad = (r + 1) * MVA_RING_NM * s;
                c.moveTo(ox + Math.cos(a0) * rad, oy + Math.sin(a0) * rad);
                c.arc(ox, oy, rad, a0, a1);
            }
            if (r > 0 && mvaArea(m, r, w + 1) !== v) {
                const b = (w + 1) * MVA_WEDGE * D2R;
                const [ax, ay] = toS(Math.sin(b) * r * MVA_RING_NM, Math.cos(b) * r * MVA_RING_NM);
                const [bx, by] = toS(Math.sin(b) * Math.min(SCOPE_NM, (r + 1) * MVA_RING_NM), Math.cos(b) * Math.min(SCOPE_NM, (r + 1) * MVA_RING_NM));
                c.moveTo(ax, ay); c.lineTo(bx, by);
            }
        }
    }
    c.stroke();
    c.setLineDash([]);
    // MVA charts give altitudes in hundreds of feet: 45 is 4,500.
    c.font = '700 10px "JetBrains Mono", monospace';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const l of m.labels) {
        const [lx, ly] = toS(l.x, l.y);
        c.fillText(String(Math.round(l.v / 100)), lx, ly);
    }
    c.restore();
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
}

function drawWeather() {
    const c = ctx, s = view.scale;
    const levels = [[1, 'rgba(70,190,80,0.32)'], [0.7, 'rgba(235,200,40,0.42)'], [0.4, 'rgba(225,50,40,0.55)']];
    for (const [f, col] of levels) {
        c.fillStyle = col;
        c.beginPath();
        for (const cell of G.wx) {
            const k = cellStrength(cell);
            if (k < 0.15) continue;
            for (const b of cell.blobs) {
                const [x, y] = toS(cell.x + b.dx, cell.y + b.dy);
                const r = b.r * k * f * s;
                c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2);
            }
        }
        c.fill('nonzero');
    }
}

let iconMode = store.get('icons', false);
const SURFACE_STATES = new Set(['gate', 'push', 'pushed', 'taxi', 'wait', 'lineup', 'luaw', 'clear', 'rollout', 'rto']);
function visible(a) {
    if (!SURFACE_STATES.has(a.state)) return true;
    if (!G.ground) return a.state !== 'wait';
    return view.scale > 25;
}

/**
 * Taxiways, aprons, buildings and stands, when zoomed in on the field. Drawn
 * the way Infinite Flight's map draws an airport: thin orange taxiway
 * centrelines, building outlines, and each stand as a dot on its lead-in
 * line (green free, red taken).
 */
function drawSurface() {
    const c = ctx, s = view.scale, gr = G.surfaceMap, chart = mapStyle === 'chart';
    const path = pts => { c.beginPath(); pts.forEach((p, i) => { const [x, y] = toS(p.x, p.y); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); };
    c.save();
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.fillStyle = chart ? 'rgba(120,120,110,0.18)' : 'rgba(255,255,255,0.035)';
    for (const poly of gr.aprons) { path(poly); c.closePath(); c.fill(); }
    if (gr.buildings && s > 40) {
        c.strokeStyle = chart ? 'rgba(60,60,70,0.55)' : 'rgba(225,230,238,0.5)';
        c.lineWidth = 1;
        for (const poly of gr.buildings) { path(poly); c.closePath(); c.stroke(); }
    }
    const orange = chart ? 'rgba(200,140,20,0.95)' : 'rgba(232,160,48,0.85)';
    c.strokeStyle = orange;
    c.lineWidth = Math.max(1, Math.min(2.2, s / 140));
    c.beginPath();
    for (const l of gr.lines) l.pts.forEach((p, i) => { const [x, y] = toS(p.x, p.y); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.stroke();
    if (s > 70) {
        c.font = '700 10px "JetBrains Mono", monospace';
        c.fillStyle = chart ? '#6b4f00' : 'rgba(242,193,78,0.9)';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        // Tiles cut taxiways into pieces: label each name once per ~0.4 NM, not once per piece.
        const placed = [];
        for (const l of gr.lines) {
            if (!l.name || l.kind !== 'taxiway' || l.pts.length < 2) continue;
            const m = l.pts[Math.floor(l.pts.length / 2)];
            if (placed.some(p => p.name === l.name && Math.hypot(p.x - m.x, p.y - m.y) < 0.4)) continue;
            placed.push({ name: l.name, x: m.x, y: m.y });
            const [x, y] = toS(m.x, m.y);
            c.fillText(l.name, x, y);
        }
    }
    if (s > 60 && gr.gates) {
        // Stands: names only clutter the field (they're in the strips and the card).
        const taken = new Set(G.aircraft.filter(a => a.stand && (a.state === 'gate' || a.state === 'push' || a.purpose === 'gate')).map(a => a.stand));
        const r = Math.max(2, Math.min(4.5, s / 70));
        if (G.ground && gr === G.ground) {
            c.strokeStyle = orange; c.lineWidth = 1;
            c.beginPath();
            for (const g of gr.gates) { const n = gr.nodes[g.node]; if (!n) continue; const [x, y] = toS(g.x, g.y), [nx, ny] = toS(n.x, n.y); c.moveTo(x, y); c.lineTo(nx, ny); }
            c.stroke();
        }
        for (const g of gr.gates) {
            const [x, y] = toS(g.x, g.y);
            c.fillStyle = taken.has(g) ? '#b4474f' : '#4ade80';
            c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        }
    }
    c.restore();
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
}

const SURFACE_TAG = { gate: 'GATE', push: 'PUSH', pushed: 'RDY TAXI', taxi: 'TAXI', wait: 'HS', lineup: 'LINEUP', luaw: 'LUAW', clear: 'CLEAR', rollout: 'ROLLOUT' };
function surfaceTag(a) {
    if (a.crossReq) return 'XING ' + a.crossReq.label + '?';
    if (a.holdPos) return 'HOLD POS';
    if (a.state === 'taxi') return a.purpose === 'gate' ? 'TAXI ' + (a.stand ? a.stand.ref : '') : a.purpose === 'exit' ? 'EXITING' : 'TAXI ' + a.rwy.id;
    if (a.state === 'wait' || a.state === 'luaw') return SURFACE_TAG[a.state] + ' ' + a.rwy.id;
    if (a.state === 'gate') return a.kind === 'dep' ? (a.called ? 'RDY PUSH ' : 'GATE ') + a.stand.ref : 'IN ' + (a.stand ? a.stand.ref : '');
    return SURFACE_TAG[a.state] || a.state.toUpperCase();
}

function drawSurfaceAircraft(a) {
    const c = ctx;
    const [x, y] = toS(a.x, a.y);
    const base = a.kind === 'arr' ? COLORS.arr : COLORS.dep;
    const col = a === G.selected ? COLORS.sel : a.color || base;
    const dim = !mine(a);
    c.globalAlpha = dim ? 0.6 : 1;
    if (!drawIcon(c, a.type, col, x, y, a.hdg, view.scale)) {
        c.fillStyle = col;
        c.fillRect(x - 3, y - 3, 6, 6);
    }
    if (a === G.selected) { c.strokeStyle = COLORS.sel; c.beginPath(); c.arc(x, y, 14, 0, Math.PI * 2); c.stroke(); }
    c.font = '700 10px "JetBrains Mono", monospace';
    c.fillStyle = col;
    c.fillText(a.cs, x + 10, y - 8);
    c.font = '10px "JetBrains Mono", monospace';
    c.fillText(surfaceTag(a), x + 10, y + 3);
    c.globalAlpha = 1;
    a.box = { x: x + 8, y: y - 18, w: 80, h: 26 };
}

function drawAircraft(a) {
    const c = ctx, s = view.scale;
    const [x, y] = toS(a.x, a.y);
    const base = a.kind === 'arr' ? COLORS.arr : COLORS.dep;
    const col = a.conflict || a.lowAlt || a.emerg ? COLORS.bad : a === G.selected ? COLORS.sel : a.color || base;

    // History.
    c.fillStyle = base;
    a.trail.forEach((p, i) => {
        const [px, py] = toS(p.x, p.y);
        c.globalAlpha = 0.12 + 0.08 * i;
        c.fillRect(px - 1.5, py - 1.5, 3, 3);
    });
    c.globalAlpha = 1;

    // One-minute leader.
    const tas = a.spd * (1 + a.alt / 1000 * 0.02);
    const lead = tas / 60;
    const [lx, ly] = toS(a.x + Math.sin(a.hdg * D2R) * lead, a.y + Math.cos(a.hdg * D2R) * lead);
    c.strokeStyle = col;
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y); c.lineTo(lx, ly); c.stroke();

    // Separation ring: 1.5 nm each, so touching rings means 3 nm.
    if (a.conflict) {
        c.strokeStyle = COLORS.bad;
        c.beginPath(); c.arc(x, y, (SEP_NM / 2) * s, 0, Math.PI * 2); c.stroke();
    }

    // Target: a radar return, or the aircraft itself.
    c.fillStyle = col;
    if (iconMode && drawIcon(c, a.type, col, x, y, a.hdg, view.scale)) { /* drawn */ }
    else if (a.kind === 'arr') c.fillRect(x - 3.5, y - 3.5, 7, 7);
    else { c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + 5, y); c.lineTo(x, y + 5); c.lineTo(x - 5, y); c.closePath(); c.fill(); }
    if (a === G.selected) {
        c.strokeStyle = COLORS.sel;
        c.beginPath(); c.arc(x, y, 10, 0, Math.PI * 2); c.stroke();
    }

    // Data block.
    const vs = a.tAlt - a.alt;
    const target = a.appr?.loc ? null : a.tAlt;
    const arrow = Math.abs(vs) < 60 || target == null ? ' ' : vs > 0 ? '↑' : '↓';
    const l2 = `${alt3(a.alt)}${arrow}${target != null && Math.abs(vs) >= 60 ? alt3(target) : '   '} ${String(Math.round(a.spd)).padStart(3)}`;
    const l3 = `${typeTag(a)} ${a.kind === 'arr' || a.lowAlt || a.wxReq || a.emerg ? intentTag(a) : `${a.gate.name} ${a.alt >= exitAlt(a) - 50 ? '✓' : alt3(exitAlt(a))}`}`;
    c.font = '700 11px "JetBrains Mono", monospace';
    c.fillStyle = col;
    // Where the tag sits (long press → Tag Placement): right by default, or left, above, below.
    const tw = 96, bx = a.tagPos === 'L' ? x - 12 - tw : a.tagPos === 'U' || a.tagPos === 'D' ? x - tw / 2 : x + 12;
    const by = a.tagPos === 'U' ? y - 46 : a.tagPos === 'D' ? y + 26 : y - 20;
    c.fillText(a.cs, bx, by);
    c.font = '11px "JetBrains Mono", monospace';
    c.fillText(l2, bx, by + 13);
    c.globalAlpha = 0.8;
    c.fillText(l3, bx, by + 26);
    c.globalAlpha = 1;
    a.box = { x: bx - 2, y: by - 11, w: 96, h: 42 };
}

/** Type as a data block shows it: H/ for heavy, J/ for super. */
const typeTag = a => (a.perf.wake === 'S' ? 'J/' : a.perf.wake === 'H' ? 'H/' : '') + a.type;
function intentTag(a) {
    if (a.emerg) return (a.emerg.mayday ? 'MAYDAY ' : 'PAN ') + (a.appr ? a.appr.end.id : '');
    if (a.lowAlt) return 'LA ' + alt3(mvaHere(a));
    if (a.wxReq) return 'WX ' + a.wxReq.deg + a.wxReq.dir;
    if (a.request) return 'REQ ' + a.request.tag;
    if (a.divert) return 'DIVERT';
    if (a.transit) return a.transit.ok ? 'TRANS' : 'TRANS?';
    if (a.circuit && !a.appr) return LEG_TAG[a.circuit.leg] + ' ' + a.circuit.end.id + (a.optionClr ? ' OPT' : a.landClr ? ' CL' : '');
    if (a.circuit && a.appr) return 'FNL ' + a.appr.end.id + (a.optionClr ? ' OPT' : a.landClr ? ' CL' : '');
    if (a.pattern && !towerInbound(a)) return 'VIS ' + a.pattern.end.id;
    if (a.appr) return (APP_TAG[a.appr.type] || 'ILS') + (a.appr.loc ? '* ' : ' ') + a.appr.end.id + (a.landClr ? ' CL' : '') + (a.appr.loc ? ' ' + a.appr.along.toFixed(1) : '');
    if (a.holdAt) return 'HLD ' + a.holdAt.fix.name;
    if (a.orbit) return '360' + a.orbit.dir;
    if (a.direct) return '>' + a.direct.name;
    return a.expect ? 'exp ' + a.expect.id : '';
}

/** The runway end under a screen point (on the runway itself, toward the nearer threshold), or null. */
function runwayAt(sx, sy) {
    const [wx, wy] = toW(sx, sy), px = 1 / view.scale;
    for (const e of G.world.ends) {
        const f = toSegment({ x: wx, y: wy }, e.thr, e.far);
        if (f.d < (e.width || 0.025) / 2 + 8 * px && f.t > 0 && f.t < 1) {
            const pair = G.world.ends.filter(o => o.phys === e.phys);
            return pair.sort((a, b) => Math.hypot(a.thr.x - wx, a.thr.y - wy) - Math.hypot(b.thr.x - wx, b.thr.y - wy))[0];
        }
    }
    return null;
}

/**
 * Dropping an airborne aircraft: on a fix, direct to it; on an arrival's final
 * approach course, a 30° intercept and the ILS; on its runway while on the
 * localizer, cleared to land. Elsewhere the drag is a heading. null for heading.
 */
function airTarget(ac, sx, sy) {
    const f = hitFix(sx, sy);
    if (f) return { label: `Direct ${f.name}`, cmd: { direct: f }, x: f.x, y: f.y };
    if (ac.kind !== 'arr') return null;
    const e = runwayAt(sx, sy);
    if (e && ac.appr?.loc && e.phys === ac.appr.end.phys) return ac.landClr ? { err: true, label: 'Already cleared to land', x: e.thr.x, y: e.thr.y } : { label: `Cleared to land ${ac.appr.end.id}`, cmd: { land: true }, x: e.thr.x, y: e.thr.y };
    const [wx, wy] = toW(sx, sy), px = 1 / view.scale;
    for (const end of G.active.arr) {
        const c = end.course * D2R, dx = wx - end.thr.x, dy = wy - end.thr.y;
        const along = -(dx * Math.sin(c) + dy * Math.cos(c)), xt = dx * Math.cos(c) - dy * Math.sin(c);
        if (along < FAF_NM || along > 25 || Math.abs(xt) > Math.max(0.6, 12 * px)) continue;
        // Aim at the point dropped on, no steeper than a 30° intercept; else 30° from the side it's on.
        // Checked now, so an approach that can't be joined from here shows red before it's sent.
        const P = ptOnFinal(end, along), side = finalGeom(ac, end).xt > 0 ? 1 : -1;
        const toward = brg(P.x - ac.x, P.y - ac.y), off = diff(end.course, toward);
        const tries = [Math.abs(off) <= 30 ? toward : norm(end.course + Math.sign(off) * 30), norm(end.course - 30 * side)]
            .map(h => Math.round(h / 5) * 5 || 360);
        for (const hdg of tries) {
            const ic = predictIntercept(ac, end, hdg);
            if (ic && ic.along >= FAF_NM && ic.angle <= 30.5) {
                const close = ic.along < GATE_NM + 2 ? ` · joins ${ic.along.toFixed(1)} mi, inside the gate` : '';
                return { label: `ILS ${end.id} · heading ${hdg3(hdg)}${close}`, cmd: { hdg, ils: end }, x: P.x, y: P.y };
            }
        }
        return { err: true, label: `Can't join the ${end.id} localizer from here: vector it first`, x: P.x, y: P.y };
    }
    return null;
}

/** A departure at the runway with no taxi map: onto the runway lines it up, and lined up, clears it for takeoff. */
function towerTarget(ac, sx, sy) {
    const e = runwayAt(sx, sy);
    if (!e || e.phys !== ac.rwy.phys) return { err: true, label: `Drop on runway ${ac.rwy.id}` };
    return ac.state === 'luaw' ? { label: `Cleared for takeoff ${ac.rwy.id}`, cmd: { takeoff: true }, x: e.thr.x, y: e.thr.y }
        : { label: `Line up and wait ${ac.rwy.id}`, cmd: { luaw: true }, x: e.thr.x, y: e.thr.y };
}

/** What a ground drag would end on: a gate dot, a runway, or a point on a taxiway. */
function groundTarget(sx, sy) {
    const gr = G.ground;
    const [wx, wy] = toW(sx, sy), p = { x: wx, y: wy }, px = 1 / view.scale;
    const other = G.aircraft.find(o => o !== drag?.ac && isSurface(o) && o.state !== 'gate' && Math.hypot(o.x - wx, o.y - wy) < 12 * px);
    if (other) return { kind: 'ac', ac: other, x: other.x, y: other.y, key: 'a' + other.id };
    let gate = null, gd = 14 * px;
    for (const g of gr.gates) { const d = Math.hypot(g.x - wx, g.y - wy); if (d < gd) { gd = d; gate = g; } }
    if (gate) return { kind: 'gate', gate, x: gate.x, y: gate.y, key: 'g' + gr.gates.indexOf(gate) };
    for (const rw of gr.physRunways) {
        const f = toSegment(p, rw.a, rw.b);
        if (f.d > rw.half + 8 * px || f.t <= 0 || f.t >= 1) continue;
        // Dropped toward one end: depart from that end.
        const end = G.world.ends.filter(e => e.phys === rw.phys)
            .sort((a, b) => Math.hypot(a.thr.x - wx, a.thr.y - wy) - Math.hypot(b.thr.x - wx, b.thr.y - wy))[0];
        if (end) {
            // Dropped on a taxiway that meets the runway part way along: an intersection departure (IFATC 3.2.5).
            const ex = (gr.exits.get(end) || []).map(x => ({ ...x, n: gr.nodes[x.node] })).filter(x => x.along > 0.5 && x.along < end.len * 0.6)
                .sort((a, b) => Math.hypot(a.n.x - wx, a.n.y - wy) - Math.hypot(b.n.x - wx, b.n.y - wy))[0];
            if (ex && Math.hypot(ex.n.x - wx, ex.n.y - wy) < 22 * px) {
                const name = ex.n.edges.find(e => e.name)?.name || 'the intersection';
                return { kind: 'rwy', end, inter: { node: ex.node, along: ex.along, name, left: Math.round((end.len - ex.along) * 6076 / 100) * 100 }, x: ex.n.x, y: ex.n.y, key: 'r' + end.id + '@' + ex.node };
            }
            return { kind: 'rwy', end, x: end.thr.x, y: end.thr.y, key: 'r' + end.id };
        }
    }
    let node = null, nd = 22 * px;
    for (const n of gr.main) { const d = Math.hypot(n.x - wx, n.y - wy); if (d < nd && !gr.onRunway(n)) { nd = d; node = n; } }
    return node ? { kind: 'twy', node, x: node.x, y: node.y, key: 'n' + node.id } : null;
}

/** What dropping an aircraft on a target means: { label, cmd, r } or { label, err }. */
function dropPlan(ac, tgt) {
    if (!tgt) return { err: true, label: 'Drop on a runway, taxiway or gate' };
    if (tgt.kind === 'ac') return { label: `Give way to ${tgt.ac.cs}`, cmd: { giveWay: tgt.ac } };
    if (ac.state === 'gate') return ac.kind === 'dep' && ac.called ? { label: 'Pushback approved', cmd: { push: true } } : { err: true, label: ac.kind === 'dep' ? 'Not ready to push yet' : 'Parked' };
    if (ac.crossReq && tgt.kind === 'rwy' && tgt.end.phys === ac.crossReq.phys) return { label: `Cross runway ${ac.crossReq.label}`, cmd: { cross: true } };
    if (ac.state === 'luaw' && tgt.kind === 'rwy' && tgt.end.phys === ac.rwy.phys) return { label: `Cleared for takeoff ${ac.rwy.id}`, cmd: { takeoff: true } };
    if (ac.state === 'wait' && tgt.kind === 'rwy' && tgt.end.phys === ac.rwy.phys) {
        return ac.freq === 'GND' ? { label: 'Contact Tower', cmd: { tower: true } } : { label: `Line up and wait ${ac.rwy.id}`, cmd: { luaw: true } };
    }
    if (ac.kind === 'arr' && ac.freq === 'TWR' && ['clear', 'rollout', 'taxi'].includes(ac.state)) {
        if (!G.positions.has('GND') || tgt.kind !== 'gate') return { label: 'Contact Ground', cmd: { ground: true } };
    }
    const plan = planTaxi(ac, tgt);
    if (plan.err) return { err: true, label: cap(plan.err) };
    const via = plan.r.names.length ? ' via ' + plan.r.names.join(' ') : '';
    if (tgt.kind === 'rwy' && tgt.inter && hasRemark('noInter')) return { err: true, label: `No intersection departures (ATIS): full length from the holding point` };
    if (tgt.kind === 'rwy' && tgt.inter && tgt.inter.left < 6000) return { err: true, label: `Only ${tgt.inter.left.toLocaleString('en-US')} ft left from ${tgt.inter.name}: too short` };
    const label = tgt.kind === 'rwy' ? `Runway ${tgt.end.id}${tgt.inter ? ` at ${tgt.inter.name} (${tgt.inter.left.toLocaleString('en-US')} ft)` : ''}${via}` : tgt.kind === 'gate' ? `Gate ${tgt.gate.ref}${via}` : `${via.trim() || 'Taxi'}, ${plan.hold}`;
    return { label: cap(label) + (plan.r.crossings.length ? ` · hold short ${plan.r.crossings[0].label}` : ''), cmd: { taxi: tgt }, r: plan.r };
}

function dropGround(ac, tgt) {
    const p = dropPlan(ac, tgt);
    if (p.err) { sys(`${ac.cs}: ${p.label}.`); return; }
    // Tower working both: an arrival dragged to a gate goes to Ground and gets its taxi in one go.
    if (p.cmd.ground && G.positions.has('GND') && tgt?.kind === 'gate' && ac.state === 'clear') {
        if (issue(ac, p.cmd)) issue(ac, { taxi: tgt });
        return;
    }
    issue(ac, p.cmd);
}

function drawGroundDrag() {
    const c = ctx, d = drag, [ax, ay] = toS(d.ac.x, d.ac.y);
    const p = d.plan, bad = !p || p.err;
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (p && p.r) {
        c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 7;
        c.beginPath(); p.r.pts.forEach((q, i) => { const [x, y] = toS(q.x, q.y); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
        c.strokeStyle = COLORS.sel; c.lineWidth = 3.5; c.stroke();
        for (const cr of p.r.crossings) {
            const q = pointAt(p.r, cr.stopS), [x, y] = toS(q.x, q.y);
            c.fillStyle = '#ef4444'; c.beginPath(); c.arc(x, y, 5, 0, Math.PI * 2); c.fill();
        }
    } else {
        c.strokeStyle = bad ? 'rgba(255,138,152,0.8)' : COLORS.sel; c.setLineDash([4, 4]); c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(d.px, d.py); c.stroke(); c.setLineDash([]);
    }
    if (d.tgt) { const [tx, ty] = toS(d.tgt.x, d.tgt.y); c.strokeStyle = bad ? '#ff8a98' : COLORS.sel; c.lineWidth = 2; c.beginPath(); c.arc(tx, ty, 9, 0, Math.PI * 2); c.stroke(); }
    const label = p ? p.label : 'Drop on a runway, taxiway or gate';
    c.font = '700 12px "JetBrains Mono", monospace';
    const w = c.measureText(label).width + 12;
    const lx = Math.min(d.px + 14, view.w - w - 4), ly = Math.max(d.py - 30, 4);
    c.fillStyle = 'rgba(6,11,15,0.85)'; c.fillRect(lx, ly, w, 20);
    c.fillStyle = bad ? '#ff8a98' : COLORS.sel; c.textBaseline = 'middle'; c.fillText(label, lx + 6, ly + 10);
    c.restore();
}

function hitAircraft(sx, sy) {
    let best = null, bestD = 18;
    for (const a of G.aircraft) {
        if (!visible(a)) continue;
        const [x, y] = toS(a.x, a.y);
        const d = Math.hypot(sx - x, sy - y);
        if (d < bestD) { best = a; bestD = d; }
    }
    if (best) return best;
    for (const a of G.aircraft) {
        const b = a.box;
        if (visible(a) && b && sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return a;
    }
    // A tap on a departure queue picks the first in line.
    for (const a of G.aircraft) {
        if (a.state !== 'wait' || G.ground) continue;
        const [x, y] = toS(a.rwy.thr.x, a.rwy.thr.y);
        if (Math.hypot(sx - x, sy - y) < 12) return a;
    }
    return null;
}

function hitFix(sx, sy) {
    for (const f of G.world.fixes) {
        if (f.kind === 'app' && !G.active.arr.includes(f.end)) continue;
        if (f.kind === 'wp' && layers.wp === 'off') continue;
        const [x, y] = toS(f.x, f.y);
        if (Math.hypot(sx - x, sy - y) < 12) return f;
    }
    return null;
}

function zoomAt(sx, sy, k) {
    const [wx, wy] = toW(sx, sy);
    const min = Math.min(view.w, view.h) / 2 / (SCOPE_NM * 1.6);
    view.scale = clamp(view.scale * k, min, 260);
    // Keep the world point under the cursor still.
    view.x = wx - (sx - view.w / 2) / view.scale;
    view.y = wy + (sy - view.h / 2) / view.scale;
}

function bindScope() {
    canvas.addEventListener('pointerdown', e => {
        canvas.setPointerCapture(e.pointerId);
        const r = canvas.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        pointers.set(e.pointerId, { sx, sy });
        if (pointers.size === 2) {
            const [p1, p2] = [...pointers.values()];
            pinch = { d: Math.hypot(p1.sx - p2.sx, p1.sy - p2.sy) };
            drag = null;
            return;
        }
        closeLadder(); closeContext();
        const ac = G && hitAircraft(sx, sy);
        if (ac) select(ac);
        const gnd = ac && G.ground && ac.state !== 'air' && ac.state !== 'roll';
        // Headings only for aircraft in the air; on the ground it's taxiing (or, with no taxi map, the runway).
        const twr = ac && !G.ground && (ac.state === 'wait' || ac.state === 'luaw');
        drag = { id: e.pointerId, mode: gnd ? 'gnd' : ac && ac.state === 'air' ? 'ac' : twr ? 'twr' : ac ? 'sel' : 'pan', ac, sx, sy, px: sx, py: sy, moved: false, hdg: null, vx: view.x, vy: view.y };
        // Hold on a target for Infinite Flight's quick menu.
        if (ac) { const d = drag; d.lpTimer = setTimeout(() => { if (drag === d && !d.moved) { d.lp = true; openContext(ac, sx, sy); } }, 550); }
    });
    canvas.addEventListener('pointermove', e => {
        const r = canvas.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { sx, sy });
        if (pinch && pointers.size === 2) {
            const [p1, p2] = [...pointers.values()];
            const d = Math.hypot(p1.sx - p2.sx, p1.sy - p2.sy);
            zoomAt((p1.sx + p2.sx) / 2, (p1.sy + p2.sy) / 2, d / pinch.d);
            pinch.d = d;
            return;
        }
        if (!drag || drag.id !== e.pointerId) return;
        if (Math.hypot(sx - drag.sx, sy - drag.sy) > 8 && !drag.lp) { drag.moved = true; clearTimeout(drag.lpTimer); }
        drag.px = sx; drag.py = sy;
        if (drag.mode === 'pan' && drag.moved) {
            view.x = drag.vx - (sx - drag.sx) / view.scale;
            view.y = drag.vy + (sy - drag.sy) / view.scale;
        } else if (drag.mode === 'gnd' && drag.moved) {
            const tgt = groundTarget(sx, sy);
            if ((tgt && tgt.key) !== drag.tgtKey) { drag.tgtKey = tgt && tgt.key; drag.tgt = tgt; drag.plan = tgt ? dropPlan(drag.ac, tgt) : null; }
        } else if (drag.mode === 'ac' && drag.moved && drag.ac.state !== 'roll') {
            const [ax, ay] = toS(drag.ac.x, drag.ac.y);
            drag.hdg = Math.round(brg(sx - ax, -(sy - ay)) / 5) * 5 || 360;
            drag.air = airTarget(drag.ac, sx, sy);
        } else if (drag.mode === 'twr' && drag.moved) {
            drag.air = towerTarget(drag.ac, sx, sy);
        }
    });
    const end = e => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!drag || drag.id !== e.pointerId) return;
        const d = drag;
        drag = null;
        clearTimeout(d.lpTimer);
        if (e.type === 'pointercancel' || d.lp) return;
        if (d.mode === 'gnd' && d.moved) {
            dropGround(d.ac, d.tgt);
            renderCard(true);
        } else if ((d.mode === 'ac' || d.mode === 'twr') && d.moved && d.air) {
            if (!d.air.err) issue(d.ac, d.air.cmd); else sys(`${d.ac.cs}: ${d.air.label}.`);
            renderCard(true);
        } else if (d.mode === 'ac' && d.moved && d.hdg != null) {
            // As in Infinite Flight: the heading, then pick the altitude (or keep it) from the ladder.
            if (mine(d.ac)) altitudeLadder(d.ac, d.hdg); else issue(d.ac, { hdg: d.hdg });
        } else if (d.mode === 'pan' && !d.moved) {
            const f = hitFix(d.sx, d.sy);
            if (f && G.selected && G.selected.state !== 'roll') { issue(G.selected, { direct: f }); }
            else select(null);
        }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    $('#zoom-in').onclick = () => zoomAt(view.w / 2, view.h / 2, 1.3);
    $('#zoom-out').onclick = () => zoomAt(view.w / 2, view.h / 2, 1 / 1.3);
    $('#zoom-reset').onclick = resetView;
    new ResizeObserver(() => { const first = !view.w; fitView(); if (first) resetView(); }).observe(canvas);
}

/* ------------------------------------------------------------------ */
/* Side panel                                                          */
/* ------------------------------------------------------------------ */


function select(ac) {
    if (G.selected !== ac) menuPath = [];
    if (ac) broadcastOpen = false;
    G.selected = ac;
    if (ac) ac.reminded = false;
    closeLadder(); closeContext();
    renderCard(true);
    renderStrips();
    filterLog();
}

/** With an aircraft selected, the log shows only its radio: its calls and yours to it. */
function filterLog() {
    let st = $('#log-filter');
    if (!st) { st = document.createElement('style'); st.id = 'log-filter'; document.head.appendChild(st); }
    st.textContent = G && G.selected ? `#log > :not([data-id="${G.selected.id}"]) { display: none; }` : '';
    const log = $('#log');
    if (log) log.scrollTop = log.scrollHeight;
}

/** Reminders set from the long-press menu: the strip asks for you when one is due. */
function reminders() {
    for (const a of G.aircraft) if (a.remindAt && G.t >= a.remindAt) {
        a.remindAt = null; a.reminded = true;
        sys(`Reminder: ${a.cs}.`); toast(`Reminder: ${a.cs}`);
    }
}

function statusText(ac) {
    const on = `On ${FREQ_NAME[ac.freq]}${mine(ac) ? '' : ' (the system)'} · `;
    return on + statusDetail(ac);
}
function statusDetail(ac) {
    if (ac.state === 'gate') return ac.kind === 'dep' ? `At gate ${ac.stand.ref}${ac.called ? ', ready to push' : ''} · runway ${ac.rwy.id}` : `Parked at ${ac.stand ? 'gate ' + ac.stand.ref : 'the ramp'}`;
    if (ac.state === 'push') return `Pushing back from ${ac.stand.ref}`;
    if (ac.state === 'pushed') return `Ready to taxi · runway ${ac.rwy.id}`;
    if (ac.state === 'taxi') {
        const cr = ac.crossReq ? ` · holding short of ${ac.crossReq.label}, wants to cross` : ac.holdPos ? ' · holding position' : '';
        const to = ac.purpose === 'runway' ? `runway ${ac.rwy.id}` : ac.purpose === 'gate' ? `gate ${ac.stand.ref}` : 'the exit';
        return `Taxiing to ${to}${ac.route?.names.length ? ' via ' + ac.route.names.join(' ') : ''} · ${Math.round(ac.spd)} kt${cr}`;
    }
    if (ac.state === 'clear') return `Clear of ${ac.landEnd.id}, waiting for taxi to ${ac.stand ? 'gate ' + ac.stand.ref : 'a gate'}`;
    if (ac.state === 'rollout') return `Rolling out on ${ac.landEnd.id} · ${Math.round(ac.spd)} kt`;
    if (ac.state === 'lineup') return `Lining up on ${ac.rwy.id}`;
    if (ac.state === 'wait') return `Holding short ${ac.rwy.id} · exit ${ac.gate.name} · climb to ${alt3(exitAlt(ac))}+`;
    if (ac.state === 'luaw') return `Lined up on ${ac.rwy.id} · exit ${ac.gate.name} · climb to ${alt3(exitAlt(ac))}+`;
    if (ac.state === 'roll') return `Rolling ${ac.rwy.id} · ${Math.round(ac.spd)} kt`;
    const vs = ac.tAlt - ac.alt;
    const alt = `${Math.round(ac.alt).toLocaleString('en-US')} ft${Math.abs(vs) > 60 && !ac.appr?.loc ? (vs > 0 ? ' ↑ ' : ' ↓ ') + ac.tAlt.toLocaleString('en-US') : ''}`;
    let lat = `hdg ${hdg3(ac.hdg)}`;
    if (ac.holdAt) lat = `holding at ${ac.holdAt.fix.name}`;
    else if (ac.orbit) lat = `${ac.orbit.dir === 'L' ? 'left' : 'right'} 360`;
    else if (ac.direct) lat = `direct ${ac.direct.name}`;
    else if (ac.via) { const nx = ac.via.legs.slice(ac.via.i).find(l => l.name); lat = `${ac.via.kind === 'STAR' ? 'descending via' : ac.via.kind === 'IAP' ? 'cleared' : ac.via.kind === 'FPL' ? 'as filed,' : 'climbing via'} ${ac.via.id}${nx ? ' > ' + nx.name : ''}${ac.via.vert || ac.via.kind === 'FPL' ? '' : ' (altitude assigned)'}`; }
    if (ac.appr) {
        const ap = ac.appr;
        lat = ap.loc ? `on the localizer ${ap.end.id} · ${ap.along.toFixed(1)} nm${ac.landClr ? ' · cleared to land' : ' · needs landing clearance'}` : `cleared ILS ${ap.end.id} · ${Math.abs(ap.xt).toFixed(1)} nm ${ap.xt > 0 ? 'right' : 'left'} of course`;
    } else if (ac.kind === 'arr' && ac.expect) lat += ` · expecting ${ac.expect.id}`;
    const tail = ac.kind === 'dep' ? ` · exit ${ac.gate.name} at ${alt3(exitAlt(ac))}+` : '';
    return `${alt} · ${Math.round(ac.spd)} kt · ${lat}${tail}`;
}

/* ---- Commands as Infinite Flight lays them out: a numbered menu in the side panel, sub-menus, the likely next call as a tile ---- */

let menuPath = [], menuKey = '', menuItems = [], menuTile = null;

/**
 * What can be said to this aircraft now, as menu items: { label, cmd } transmits,
 * { label, sub: () => items } opens a list, { label, run } opens a ladder.
 * hl marks what the pilot is asking for or the obvious next call.
 */
function menuFor(ac) {
    if (!mine(ac)) return [];
    const items = [], add = (label, x, hl) => items.push({ label, ...x, hl: !!hl });
    const air = ac.state === 'air';
    if (ac.request) {
        const r = ac.request, filed = filedRoute(ac);
        add(r.radarPattern ? 'Respond to radar pattern request' : `Respond to ${appWord(r.kind)} approach request`, { sub: () => [
            ...(filed ? [{ label: `Expect the ${appWord(r.kind)} runway ${r.end.id}, continue as filed`, cmd: { expectApp: { type: r.kind, end: r.end }, asFiled: true } }] : []),
            { label: `Expect vectors for the ${appWord(r.kind)} runway ${r.end.id}`, cmd: { expectApp: { type: r.kind, end: r.end } } },
            { label: 'Expect another approach…', sub: () => expectList(ac) },
            { label: `Cleared ${appWord(r.kind)} approach runway ${r.end.id}`, cmd: r.kind === 'VIS' ? { visual: r.end } : { ils: r.end, appType: r.kind } },
            { label: 'Unable at this time', cmd: { unable: true } },
        ] }, true);
    }
    if (ac.wxReq) add(`Approve ${ac.wxReq.deg}° ${ac.wxReq.dir === 'L' ? 'left' : 'right'} for weather`, { cmd: { deviate: true } }, true);
    const nextCross = ac.crossReq || (ac.state === 'taxi' && ac.route?.crossings.find(x => !x.cleared));
    if (nextCross && G.positions.has(crossOwner(ac))) add(`Cross runway ${crossName(nextCross)}${ac.crossReq ? '' : ' (ahead)'}`, { cmd: { cross: true } }, !!ac.crossReq);
    if (air) airMenu(ac, add); else groundMenu(ac, add);
    return items;
}

/** Runway ends with this kind of approach: the one the pilot asked for (or expects) first, then the landing runways, then the rest. */
function endsFor(type, ac) {
    const first = [ac?.request?.end, ac?.expect].filter(Boolean);
    return [...new Set([...first, ...G.active.arr, ...G.world.ends])].filter(e => hasApproach(e, type));
}
const APP_TYPES = () => ['ILS', ...(G.rules.id === 'ifatc' ? [] : ['LOC']), 'RNAV', 'VIS'];
/** A filed route to carry on along: the STAR or SID it's flying or was taken off, or a departure's exit. */
const filedRoute = ac => (ac.kind === 'dep' ? !!ac.gate : !!ac.expect);
/** "Expect approach…": each type, then the runways (requested first); with a filed route, also "…, continue as filed". */
const expectList = ac => APP_TYPES().map(t => ({ label: `${cap(appWord(t))} approach`, sub: () => endsFor(t, ac).flatMap(e => [
    ...(filedRoute(ac) ? [{ label: `Runway ${e.id}, continue as filed`, cmd: { expectApp: { type: t, end: e }, asFiled: true } }] : []),
    { label: `Runway ${e.id}`, cmd: { expectApp: { type: t, end: e } } },
]) }));

/** Infinite Flight's Misc. messages list for the frequency the aircraft is on. */
const miscMenu = ac => () => [...MISC_COMMON, ...(ac.freq === 'GND' ? MISC_GND : MISC_TWR)].map(m => ({ label: m[1], cmd: { msg: m } }));
/** Standby, corrections and intentions (IF's uncategorized messages). */
const standbyMenu = () => [
    { label: 'Standby', cmd: { standby: 'sb' } }, { label: 'Correction, standby', cmd: { standby: 'corr' } },
    { label: 'Disregard last message', cmd: { standby: 'disregard' } }, { label: 'Ask for intentions', cmd: { intentions: true } },
];
/** "Fly runway heading until at or above" heights: 1,000 to 5,000 ft above the field. */
const rhAlts = () => [1000, 2000, 3000, 4000, 5000].map(h => Math.round((G.world.elev + h) / 100) * 100);

function groundMenu(ac, add) {
    const onGnd = ac.freq === 'GND', onTwr = ac.freq === 'TWR', gr = G.ground;
    // Pushback: "pushback approved, expect runway XX", or just approved.
    if (ac.state === 'gate' && ac.kind === 'dep' && ac.called) {
        add(`Pushback approved, expect runway ${ac.rwy.id}`, { cmd: { push: true, expectRwy: true } }, true);
        add('Pushback approved', { cmd: { push: true } });
    }
    // Taxi to…: the likely one first, then the list.
    if (ac.state === 'pushed') add(`Taxi to runway ${ac.rwy.id}`, { cmd: { taxi: true } }, true);
    if (ac.state === 'clear' && onGnd) add(`Taxi to ${ac.stand ? 'gate ' + ac.stand.ref : 'parking'}`, { cmd: { taxi: true } }, true);
    if (onGnd && gr && (['pushed', 'clear'].includes(ac.state) || ac.state === 'taxi' && ac.purpose !== 'exit'))
        add('Taxi to…', { sub: () => [...(ac.kind === 'dep' ? G.active.dep.map(e => ({ label: `Runway ${e.id}`, cmd: { taxi: e.id } })) : []), { label: 'Parking', cmd: { taxi: ac.kind === 'arr' ? true : (ac.stand?.ref || true) } }] });
    if (ac.kind === 'dep' && onGnd && (ac.state === 'wait' || ac.state === 'taxi' && ac.purpose === 'runway' && !ac.toTower))
        add(`Contact Tower${ac.state === 'wait' ? '' : ' when ready'}`, { cmd: { tower: true } }, ac.state === 'wait');
    if (ac.kind === 'arr' && onTwr && (ac.state === 'clear' || !ac.toGround && (ac.state === 'rollout' || ac.state === 'taxi')))
        add('Contact Ground', { cmd: { ground: true } }, ac.state === 'clear' && !ac.exitHold);
    // Exit runway (IF): which side, expedite, cross the next runway or hold short of it.
    if (onTwr && ac.state === 'rollout' && gr) add('Exit runway…', { sub: () => {
        const v = (side, more, label) => ({ label, cmd: { exitRwy: { side, ...more } } });
        return [v('L', {}, 'When able turn left'), v('R', {}, 'When able turn right'), v(null, {}, 'Exit runway when able'),
            v('L', { expedite: true }, 'Turn left, expedite'), v('R', { expedite: true }, 'Turn right, expedite'), v(null, { expedite: true }, 'Exit when able, expedite'),
            v('L', { cross: true }, 'Turn left, cross runway, contact ground'), v('R', { cross: true }, 'Turn right, cross runway, contact ground'), v(null, { cross: true }, 'Exit when able, cross runway, contact ground'),
            v('L', { holdShort: true }, 'Turn left, hold short'), v('R', { holdShort: true }, 'Turn right, hold short'), v(null, { holdShort: true }, 'Exit when able, hold short')];
    } });
    if ((ac.state === 'taxi' || ac.state === 'push') && !ac.holdPos) add('Hold position', { cmd: { holdPos: true } });
    if (ac.holdPos) add('Continue taxi', { cmd: { cont: true } }, true);
    // Progressive taxi and give way (IFATC 2.2.1, 2.2.5), in IF's words.
    if (gr && onGnd && (['pushed', 'clear'].includes(ac.state) || ac.state === 'taxi' && ac.purpose !== 'exit')) {
        const near = G.aircraft.filter(o => o !== ac && isSurface(o) && o.state !== 'gate' && Math.hypot(o.x - ac.x, o.y - ac.y) < 0.8);
        const rel = o => diff(ac.hdg, brg(o.x - ac.x, o.y - ac.y));
        const ahead = near.filter(o => o.state === 'taxi' && Math.abs(rel(o)) < 35).sort((a, b) => Math.hypot(a.x - ac.x, a.y - ac.y) - Math.hypot(b.x - ac.x, b.y - ac.y))[0];
        const cr = ac.crossReq || ac.route?.crossings.find(x => !x.cleared);
        add('Progressive taxi', { sub: () => [
            ...(ac.prog ? [] : [{ label: 'Expect progressive taxi instructions', cmd: { expectProg: true } }]),
            ...(cr && G.positions.has(crossOwner(ac)) ? [{ label: `Cross runway ${crossName(cr)}`, cmd: { cross: true } }] : []),
            { label: 'Turn left next taxiway', cmd: { prog: 'L' } }, { label: 'Turn right next taxiway', cmd: { prog: 'R' } },
            { label: 'Continue straight ahead', cmd: { prog: 'S' } }, { label: 'Make 180', cmd: { prog: '180' } },
            ...(ac.prog ? [{ label: 'Continue taxi at your discretion', cmd: { discretion: true } }] : []),
            ...(ahead ? [{ label: 'Follow aircraft ahead', cmd: { follow: ahead, followAhead: true } }] : []),
        ] });
        if (near.length) add('Give way', { sub: () => {
            const out = [], seen = new Set();
            for (const o of near.sort((a, b) => Math.hypot(a.x - ac.x, a.y - ac.y) - Math.hypot(b.x - ac.x, b.y - ac.y))) {
                const r = rel(o), what = o.state === 'rollout' || o.purpose === 'exit' ? `Aircraft exiting runway ${(o.landEnd || o.rwy).id}` : Math.abs(r) < 35 ? 'Aircraft ahead' : `Aircraft on your ${r < 0 ? 'left' : 'right'}`;
                if (!seen.has(what)) { seen.add(what); out.push({ label: `${what} (${o.cs})`, cmd: { giveWay: o } }); }
            }
            return out;
        } });
    }
    // Tower: the departure at (or taxiing to) the runway.
    if (onTwr && ac.state === 'taxi' && ac.purpose === 'runway' && ac.preClr) add(`${ac.preClr === 'roll' ? 'Cleared for takeoff' : 'Line up and wait'} when it reaches the runway`, { cmd: null });
    if (onTwr && (ac.state === 'wait' || ac.state === 'luaw' || ac.state === 'taxi' && ac.purpose === 'runway' && !ac.preClr)) {
        if (ac.patternWork) {
            add(`Make left traffic, cleared for takeoff ${ac.rwy.id}`, { cmd: { takeoff: true, traffic: 'L' } }, true);
            add(`Make right traffic, cleared for takeoff ${ac.rwy.id}`, { cmd: { takeoff: true, traffic: 'R' } });
        } else {
            add(`Cleared for takeoff runway ${ac.rwy.id}`, { cmd: { takeoff: true } }, true);
            add('Cleared for takeoff…', { sub: () => [
                { label: `Runway ${ac.rwy.id}, immediate takeoff`, cmd: { immediate: true } },
                ...rhAlts().map(a => ({ label: `Fly runway heading until at or above ${fmtAlt(a)}ft`, cmd: { takeoff: true, rhUntil: a } })),
                ...rhAlts().map(a => ({ label: `Immediate, runway heading until at or above ${fmtAlt(a)}ft`, cmd: { immediate: true, rhUntil: a } })),
            ] });
        }
        if (ac.state !== 'luaw') add(`Line up and wait runway ${ac.rwy.id}`, { cmd: { luaw: true } });
        if (ac.state === 'wait') {
            add(`Hold short runway ${ac.rwy.id}`, { cmd: { holdShort: true } });
            if (departureNumber(ac) > 1) add(`Number ${departureNumber(ac)} for departure`, { cmd: { seqNo: true } });
            if (gr) add('Back taxi…', { sub: () => [
                { label: `Back taxi runway ${ac.rwy.id}`, cmd: { backTaxi: 'bt' } }, { label: `Back taxi runway ${ac.rwy.id}, please expedite`, cmd: { backTaxi: 'bt', expedite: true } },
                { label: `Back taxi runway ${ac.rwy.id}, line up and wait`, cmd: { backTaxi: 'luaw' } }, { label: `Back taxi, line up and wait, please expedite`, cmd: { backTaxi: 'luaw', expedite: true } },
            ] });
        }
    }
    if (onTwr && (ac.state === 'roll' || ac.state === 'lineup' && ac.lineupThen === 'roll')) add('Cancel takeoff clearance', { cmd: { cancelTO: true } });
    if (onGnd || onTwr) add('Misc. messages', { sub: miscMenu(ac) });
    add('Standby / corrections', { sub: standbyMenu });
}

function airMenu(ac, add) {
    if (ac.transit) {
        if (ac.transit.ok === null) {
            add('Transition approved', { cmd: { transit: 'ok' } }, true);
            add('Transition approved at…', { sub: () => [1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000].map(h => Math.round((G.world.elev + h) / 500) * 500).map(v => ({ label: `Maintain ${fmtAlt(v)}`, cmd: { transit: v } })) });
            add('Unable transition', { cmd: { transit: 'no' } });
        }
        add('Vectoring instructions', { sub: () => [{ label: 'Fly heading…', run: () => headingLadder(ac) }, { label: 'Climb or descend…', run: () => altitudeLadder(ac) }] });
        add('Misc. messages', { sub: miscMenu(ac) });
        add('Standby / corrections', { sub: standbyMenu });
        return;
    }
    if (ac.circuit) {
        const k = ac.circuit, e = k.end, others = G.aircraft.filter(o => o !== ac && o.state === 'air' && o.freq === 'TWR' && !o.transit && (o.circuit || o.pattern || o.appr) && sameRunwayish((o.appr || o.circuit || o.pattern).end, e));
        const ifr = G.rules.id === 'ifatc', n = landingNumber(ac);
        if (!ac.landClr) {
            // The clearance itself (IF: "number X, runway XX, cleared for the option[, make left/right traffic]").
            if (k.work) add(`Number ${n}, runway ${e.id}, cleared for the option`, { cmd: { option: 'opt' } }, k.leg === 'down' || !!ac.appr);
            else add(`Number ${n}, runway ${e.id}, cleared to land`, { cmd: { land: true } }, k.leg === 'down' || !!ac.appr);
            add('Cleared to land / option…', { sub: () => [
                { label: `Number ${n}, runway ${e.id}, cleared to land`, cmd: { land: true } },
                ...(k.work ? [{ label: 'Cleared for the option', cmd: { option: 'opt' } },
                    { label: 'Cleared for the option, make left traffic', cmd: { option: 'opt', traffic: 'L' } },
                    { label: 'Cleared for the option, make right traffic', cmd: { option: 'opt', traffic: 'R' } },
                    ...(ifr ? [] : [{ label: 'Cleared touch and go', cmd: { option: 'tg' } }])] : []),
            ] });
        }
        add('Pattern instructions', { sub: () => [
            ...(k.leg === 'up' ? [{ label: 'Turn crosswind', cmd: { turnCross: true } }, ...(k.extUp ? [] : [{ label: 'Extend upwind', cmd: { extUp: true } }])] : []),
            ...(k.leg === 'down' || k.leg === 'joinDown' ? [{ label: 'Turn base', cmd: { turnBase: true } }] : []),
            ...(k.leg === 'down' && !k.ext ? [{ label: 'Extend downwind', cmd: { extend: true } }] : []),
            ...(['up', 'cross', 'down', 'joinDown'].includes(k.leg) && !k.short && !ac.appr ? [{ label: 'Make short approach', cmd: { short: true } }] : []),
            ...(k.leg === 'up' || k.leg === 'cross' ? [{ label: `Make ${k.side < 0 ? 'right' : 'left'} traffic`, cmd: { traffic: k.side < 0 ? 'R' : 'L' } }] : []),
            ...(ac.alt > circuitAlt(ac) + 200 ? [{ label: 'Descend to pattern altitude', cmd: { descPat: true } }] : []),
            ...(ac.landClr ? [{ label: 'Cancel landing clearance', cmd: { cancelLand: true } }] : []),
            ...others.map(o => ({ label: `Number ${n}, traffic to follow is on ${legOf(o)} (${o.cs})`, cmd: { seqBehind: o } })),
        ] });
        if (!noRadar() && !ac.appr) add(`Contact ${freqLabel('APP')} (radar pattern)`, { cmd: { radarPattern: true } });
        add('Request speed', { sub: speedMenu(ac) });
        if (!ac.appr) { if (ifr) add('Make a 360 for spacing', { cmd: { orbit: 'L' } }); else { add('Make left 360', { cmd: { orbit: 'L' } }); add('Make right 360', { cmd: { orbit: 'R' } }); } }
        if (ac.appr) add('Go around…', { sub: () => [{ label: 'Go around', cmd: { goAround: true } }, { label: `Go around, make left traffic runway ${e.id}`, cmd: { goAround: true, traffic: 'L' } }, { label: `Go around, make right traffic runway ${e.id}`, cmd: { goAround: true, traffic: 'R' } }] });
        add('Misc. messages', { sub: miscMenu(ac) });
        add('Standby / corrections', { sub: standbyMenu });
        return;
    }
    const inbound = towerInbound(ac);
    if (ac.kind === 'dep' && ac.freq === 'TWR') add('Frequency change approved', { cmd: { freqChange: true } }, true);
    if ((ac.appr?.loc || towerInbound(ac) && ac.pattern) && !ac.landClr) add(`Cleared to land runway ${(ac.appr || ac.pattern).end.id}`, { cmd: { land: true } }, ac.freq === 'TWR');
    // A visual from Radar that isn't number 1 gets its sequence (IFATC 3.6.3).
    if (ac.freq === 'TWR' && ac.appr?.type === 'VIS' && !ac.landClr && landingNumber(ac) > 1) add(`Number ${landingNumber(ac)}`, { cmd: { seqLand: true } });
    if (inbound) {
        add('Continue inbound', { cmd: { contInbound: true } });
        add(`Number ${landingNumber(ac)}`, { cmd: { seqLand: true } });
        add(ac.pattern ? `Pattern entry (now ${PATTERN_SAY[ac.pattern.kind]} ${ac.pattern.end.id})…` : 'Pattern entry…', { sub: () => G.active.arr.flatMap(e => Object.keys(PATTERN_SAY).map(k => ({ label: `${cap(PATTERN_SAY[k])} runway ${e.id}`, cmd: { entry: { kind: k, end: e } } }))) }, !ac.pattern);
    } else {
        add('Vectoring instructions', { sub: () => [
            { label: 'Fly heading…', run: () => headingLadder(ac) },
            { label: 'Climb or descend…', run: () => altitudeLadder(ac) },
            { label: 'Direct to…', sub: () => nearFixes(ac).map(f => ({ label: f.label, cmd: { direct: f.f } })) },
            { label: 'Hold at…', sub: () => nearFixes(ac).map(f => ({ label: f.label, cmd: { holdFix: f.f } })) },
            { label: 'Left 360', cmd: { orbit: 'L' } }, { label: 'Right 360', cmd: { orbit: 'R' } },
            ...((ac.viaSaved || ac.via && !ac.via.vert) && (ac.viaSaved || ac.via).kind !== 'FPL' ? [{ label: `${ac.kind === 'arr' ? 'Descend via' : 'Climb via'} the ${(ac.viaSaved || ac.via).id}`, cmd: { via: true } }] : []),
        ] });
        add('Request speed', { sub: speedMenu(ac) });
    }
    if (inbound) add('Request speed', { sub: speedMenu(ac) });
    if (ac.kind === 'arr' && !inbound) add('Expect approach…', { sub: () => expectList(ac) });
    const other = [
        ...(ac.kind === 'arr' && ac.freq === 'APP' && (ac.appr || ac.pattern || radarVectorsOk(ac)) ? [{ label: `Contact ${freqLabel('TWR')}${ac.appr || ac.pattern ? '' : ` (${HANDOFF_SAY[ac.vfrIn || 'RV']})`}`, cmd: { toTwr: true } }] : []),
        ...(ac.kind === 'dep' && ac.freq === 'TWR' ? [{ label: 'Frequency change approved', cmd: { freqChange: true } }] : []),
    ];
    if (other.length) add('Contact other frequency', { sub: () => other });
    if (ac.kind === 'arr' && !inbound) add('Clear for approach', { sub: () => APP_TYPES().map(t => ({ label: `${cap(appWord(t))} approach`, sub: () => endsFor(t, ac).map(e => ({ label: `Runway ${e.id}`, cmd: t === 'VIS' ? { visual: e } : { ils: e, appType: t } })) })) });
    add('Ask for intentions', { cmd: { intentions: true } });
    if (ac.kind === 'arr') add('Misc. messages', { sub: () => [
        ...(visualWx() && !ac.fieldReported ? [{ label: 'Report the airport in sight', cmd: { reportField: true } }] : []),
        ...(ac.request ? [{ label: 'Unable', cmd: { unable: true } }] : []),
        { label: 'Say intentions', cmd: { intentions: true } },
        ...(ac.freq === 'TWR' ? miscMenu(ac)() : []),
    ] });
    if (ac.kind === 'arr') add('Missed approach instructions', { sub: () => [2000, 3000, 4000].map(h => Math.max(G.world.minAlt, Math.round((G.world.elev + h) / 1000) * 1000))
        .filter((v, i, a) => a.indexOf(v) === i).map(v => ({ label: `Runway heading, climb and maintain ${fmtAlt(v)}`, cmd: { missed: v } })) });
    if (filedRoute(ac) && !ac.appr && !ac.pattern && !(ac.via && ac.via.kind !== 'IAP') && !(ac.kind === 'dep' && ac.direct)) add('Continue as filed', { cmd: { asFiled: true } });
    if (ac.appr) add(ac.freq === 'TWR' ? 'Go around…' : 'Go around', ac.freq === 'TWR' ? { sub: () => [{ label: 'Go around', cmd: { goAround: true } }, { label: `Go around, make left traffic runway ${ac.appr.end.id}`, cmd: { goAround: true, traffic: 'L' } }, { label: `Go around, make right traffic runway ${ac.appr.end.id}`, cmd: { goAround: true, traffic: 'R' } }] } : { cmd: { goAround: true } });
    if (ac.kind === 'arr' && ac.freq === 'TWR' && !ac.landClr) add('Deny entry', { sub: () => DENY_ENTRY.map(m => ({ label: m[1], cmd: { msg: m } })) });
    if (ac.freq === 'TWR' && ac.kind !== 'arr') add('Misc. messages', { sub: miscMenu(ac) });
    add('Standby / corrections', { sub: standbyMenu });
}

/** Request speed, Infinite Flight's list: until a mile final, discretion, present, slowest, best forward, follow the one ahead, then exact speeds. */
const speedMenu = ac => () => {
    const ifr = G.rules.id === 'ifatc', lo = Math.ceil(minSpeed(ac) / 10) * 10, hi = ac.perf.prop ? 140 : ac.alt < 10000 ? 250 : 300;
    const out = [];
    if (ac.kind === 'arr') {
        const spds = ifr ? [180, 170, 160] : [230, 220, 210, 200, 190, 180, 170, 160], nms = ifr ? [6, 5, 4] : [10, 8, 6, 5, 4];
        const fits = spds.filter(v => v >= lo && v <= hi);
        out.push({ label: 'Maintain speed until a mile final…', sub: () => ifr
            ? fits.flatMap(v => nms.map(nm => ({ label: `Maintain ${v} knots until ${nm} mile final`, cmd: { spd: v, spdUntil: nm } })))
            : fits.map(v => ({ label: `${v} knots until…`, sub: () => nms.map(nm => ({ label: `${v} knots until ${nm} mile final`, cmd: { spd: v, spdUntil: nm } })) })) });
    }
    out.push({ label: 'Speed at your discretion', cmd: { spdDisc: true } }, { label: 'Maintain present speed', cmd: { spdPresent: true } },
        { label: 'Maintain slowest practical speed', cmd: { slowest: true } }, { label: 'Maintain best forward speed', cmd: { spdBest: true } });
    if (ac.kind === 'arr' && trafficAhead2(ac)) out.push({ label: 'Adjust speed to follow aircraft ahead', cmd: { spdFollow: true } });
    for (let v = hi; v >= lo; v -= 10) out.push({ label: `Maintain ${v} knots`, cmd: { spd: v } });
    return out;
};

/** The fixes nearest an aircraft, for direct-to and holds. */
function nearFixes(ac) {
    return G.world.fixes.filter(f => f.kind !== 'app' || G.active.arr.includes(f.end))
        .map(f => ({ f, d: Math.hypot(f.x - ac.x, f.y - ac.y) })).sort((a, b) => a.d - b.d).slice(0, 24)
        .map(({ f, d }) => ({ f, label: `${f.name} · ${f.kind === 'arr' ? 'entry' : f.kind === 'dep' ? 'exit' : f.kind === 'app' ? 'final ' + f.end.id : Math.round(d) + ' mi'}` }));
}

let broadcastOpen = false;
function renderCard(force) {
    const el = $('#cmdmenu'), ac = G && G.selected;
    if (!ac && broadcastOpen) {
        // Broadcasts, to everyone on your frequencies (IF: "Attention all aircraft, …").
        el.hidden = false; $('#strips').hidden = true;
        if (force || menuKey !== 'bcast') {
            menuKey = 'bcast';
            el.innerHTML = `<div class="cm-h"><div><b>BROADCAST</b><small>Attention all aircraft…</small></div><button type="button" class="cm-x" data-close aria-label="Close">✕</button></div>
                <div class="cm-list">${BROADCASTS.map((b, i) => `<button type="button" class="cm-i" data-bc="${i}"><span>${i + 1}</span>${escapeHtml(b[1])}</button>`).join('')}</div>`;
        }
        return;
    }
    el.hidden = !ac;
    $('#strips').hidden = !!ac;
    if (!ac) { menuKey = ''; menuPath = []; el.innerHTML = ''; return; }
    const top = menuFor(ac);
    let items = top, title = '';
    for (const p of menuPath) {
        const it = items.find(i => i.label === p && i.sub);
        if (!it) { menuPath = []; items = top; title = ''; break; }
        items = it.sub(); title = p;
    }
    menuTile = top.find(i => i.hl && (i.cmd || i.sub)) || null;
    const key = `${ac.id}|${mine(ac)}|${menuPath.join('>')}|${items.map(i => i.label + (i.hl ? '*' : '')).join('|')}|${menuTile?.label}`;
    if (force || key !== menuKey) {
        menuKey = key; menuItems = items;
        el.innerHTML = `<div class="cm-h"><div><b>${escapeHtml(ac.cs)}</b><small>${escapeHtml(ac.radio)}</small><span>${escapeHtml(typeTag(ac))}</span></div><div class="cm-num" id="cm-num"></div><button type="button" class="cm-x" data-close aria-label="Close">✕</button></div>
            <div class="cm-fpl" id="cm-fpl"></div>
            <div class="cm-st" id="cm-st"></div>
            <div class="cm-list">${menuPath.length ? `<button type="button" class="cm-i back" data-back><span>‹</span>${escapeHtml(title)}</button>` : ''}
            ${mine(ac) ? items.map((it, i) => `<button type="button" class="cm-i${it.hl ? ' hl' : ''}${it.cmd === null ? ' note' : ''}" data-i="${i}"><span>${i + 1}</span>${escapeHtml(it.label)}${it.sub ? '<i>›</i>' : ''}</button>`).join('') || '<div class="cm-none">Nothing to say right now.</div>'
                : `<div class="cm-none">The system is working ${FREQ_NAME[ac.freq]}. ${ac.cs} reaches your frequency when it's handed off.</div>`}</div>
            ${menuTile && !menuPath.length ? `<div class="cm-tiles"><button type="button" class="cm-tile" data-tile>${escapeHtml(menuTile.label)}</button></div>` : ''}`;
    }
    $('#cm-num').innerHTML = ac.state === 'air'
        ? `${Math.round(ac.alt).toLocaleString('en-US')}ft ${hdg3(ac.hdg)}°<br>GS ${Math.round(ac.spd)} · ${ac.freq}`
        : `${ac.state === 'gate' ? 'Gate ' + (ac.stand?.ref || '') : Math.round(ac.spd) + ' kt'}<br>${ac.freq}`;
    $('#cm-st').textContent = statusText(ac);
    $('#cm-fpl').textContent = 'FPL  ' + filedPlan(ac).text;
}

/** A menu item chosen: transmit it, open its list, or open its ladder. */
function menuPick(ac, it) {
    if (!it || it.cmd === null) return;
    if (it.sub) { menuPath.push(it.label); renderCard(true); return; }
    if (it.run) { it.run(); return; }
    issue(ac, it.cmd);
    menuPath = [];
    renderCard(true);
}

function bindCard() {
    $('#cmdmenu').addEventListener('click', e => {
        const ac = G && G.selected, b = e.target.closest('button');
        if (b && broadcastOpen && !ac) {
            if (b.dataset.bc != null) {
                const pos = ['TWR', 'GND', 'APP'].filter(f => G.positions.has(f)).map(f => FREQ_NAME[f]).join('/');
                atc(`Attention all aircraft, ${BROADCASTS[Number(b.dataset.bc)][2](pos)}.`);
            }
            broadcastOpen = false; menuKey = ''; renderCard(true); renderRail();
            return;
        }
        if (!ac || !b) return;
        if (b.hasAttribute('data-close')) { select(null); return; }
        if (b.hasAttribute('data-back')) { menuPath.pop(); renderCard(true); return; }
        if (b.hasAttribute('data-tile')) { menuPath = []; menuPick(ac, menuTile); return; }
        if (b.dataset.i != null) menuPick(ac, menuItems[Number(b.dataset.i)]);
    });
    $('#ladder').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (b && ladderPick) ladderPick(b.hasAttribute('data-keep') ? 'keep' : b.dataset.v);
    });
    // Controlling, not reading: no text selection, copy menu or callout on a long press anywhere in the game.
    const game = $('#game');
    for (const ev of ['contextmenu', 'selectstart', 'dragstart']) game.addEventListener(ev, e => { if (!e.target.closest('input')) e.preventDefault(); });
    // The map buttons, bottom right, fade out when the scope is left alone (as in Infinite Flight).
    const ctrls = $('.zoom');
    let idleT = 0;
    const wake = () => { ctrls.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => { if ($('#settings').hidden) ctrls.classList.add('idle'); }, 4000); };
    for (const ev of ['pointerdown', 'pointermove', 'wheel']) $('#scope-wrap').addEventListener(ev, wake, { passive: true });
    wake();
}

/* ---- Ladders: pick a heading or an altitude from a list beside the aircraft, as after a drag in Infinite Flight ---- */

/** A scrolling list near the aircraft; first may be a "no change" choice. */
function openLadder(ac, title, values, current, pickFn, keep) {
    const el = $('#ladder');
    const [x, y] = toS(ac.x, ac.y), r = canvas.getBoundingClientRect(), w = $('#scope-wrap').getBoundingClientRect();
    el.innerHTML = `<div class="ld-h">${escapeHtml(title)}</div>${keep ? `<button type="button" class="ld-i keep" data-keep>${escapeHtml(keep)}</button>` : ''}`
        + values.map(v => `<button type="button" class="ld-i${v.v === current ? ' cur' : ''}${v.now ? ' now' : ''}${v.warn ? ' warn' : ''}" data-v="${v.v}">${escapeHtml(v.label)}${v.now ? '<small>now</small>' : ''}</button>`).join('');
    el.hidden = false;
    const left = r.left - w.left + x + 26, maxLeft = w.width - el.offsetWidth - 8;
    el.style.left = Math.max(8, left > maxLeft ? r.left - w.left + x - 26 - el.offsetWidth : left) + 'px';
    el.style.top = Math.max(8, r.top - w.top + 8) + 'px';
    el.style.maxHeight = (r.height - 16) + 'px';
    const cur = el.querySelector('.now') || el.querySelector('.cur');
    if (cur) cur.scrollIntoView({ block: 'center' });
    ladderPick = v => { closeLadder(); pickFn(v); };
}
let ladderPick = null;
function closeLadder() { const el = $('#ladder'); if (el) el.hidden = true; ladderPick = null; }

function altitudeLadder(ac, hdg) {
    const lo = Math.max(1000, Math.ceil((G.world.elev + 1000) / 500) * 500), vals = [];
    // The altitude it's at now is green, so you can see where it is before picking where it goes.
    const now = Math.round(ac.alt / 500) * 500;
    for (let a = 24000; a >= lo; a -= 500) vals.push({ v: a, label: a.toLocaleString('en-US') + 'ft', now: a === now, warn: terrainOn() && a < mvaHere({ x: ac.x, y: ac.y }) });
    const cur = Math.round(ac.tAlt / 500) * 500;
    openLadder(ac, hdg != null ? `HDG ${hdg3(hdg)} · ALT` : 'ALTITUDE', vals, cur,
        v => { issue(ac, v === 'keep' ? { hdg } : { ...(hdg != null ? { hdg } : {}), alt: Number(v) }); renderCard(true); },
        hdg != null ? `Maintain ${ac.tAlt.toLocaleString('en-US')}ft` : null);
}

function headingLadder(ac) {
    const vals = [];
    for (let h = 5; h <= 360; h += 5) vals.push({ v: h, label: hdg3(h) + '°' });
    openLadder(ac, 'HEADING', vals, Math.round(ac.tHdg / 5) * 5 || 360, v => { issue(ac, { hdg: Number(v) }); renderCard(true); });
}

/* ---- Long press on a target: Infinite Flight's quick menu ---- */

const TAG_COLORS = { Yellow: '#ffd84d', Red: '#ff6b6b', Blue: '#5aa9ff', Green: '#5ee08a' };
function openContext(ac, sx, sy) {
    const el = $('#ctx');
    const show = items => {
        el.innerHTML = items.map((it, i) => `<button type="button" class="ctx-i" data-i="${i}"${it.color ? ` style="color:${it.color}"` : ''}>${escapeHtml(it.label)}</button>`).join('');
        el.onclick = e => {
            const b = e.target.closest('[data-i]');
            if (!b) return;
            const it = items[Number(b.dataset.i)];
            if (it.sub) { show(it.sub()); return; }
            closeContext();
            it.run();
        };
        const r = canvas.getBoundingClientRect(), w = $('#scope-wrap').getBoundingClientRect();
        el.hidden = false;
        el.style.left = Math.min(w.width - el.offsetWidth - 8, r.left - w.left + sx + 18) + 'px';
        el.style.top = Math.max(8, Math.min(w.height - el.offsetHeight - 8, r.top - w.top + sy - 20)) + 'px';
    };
    const air = ac.state === 'air' && mine(ac);
    show([
        ...(air ? [{ label: 'Assign Altitude', run: () => altitudeLadder(ac) }] : []),
        ...(air ? [{ label: 'Hold', sub: () => nearFixes(ac).slice(0, 8).map(f => ({ label: f.f.name, run: () => { issue(ac, { holdFix: f.f }); renderCard(true); } })) }] : []),
        { label: 'Set Reminder', sub: () => [1, 2, 5, 10].map(m => ({ label: `In ${m} minute${m > 1 ? 's' : ''}`, run: () => { ac.remindAt = G.t + m * 60; ac.reminded = false; toast(`Reminder for ${ac.cs} in ${m} min`); } })) },
        { label: 'Show Information', run: () => select(ac) },
        { label: 'Assign Color', sub: () => [...Object.entries(TAG_COLORS).map(([n, c]) => ({ label: n, color: c, run: () => { ac.color = c; } })), { label: 'Reset Color', run: () => { ac.color = null; } }] },
        { label: 'Tag Placement', sub: () => [['R', 'Right'], ['L', 'Left'], ['U', 'Above'], ['D', 'Below']].map(([k, n]) => ({ label: n, run: () => { ac.tagPos = k; } })) },
    ]);
}
function closeContext() { const el = $('#ctx'); if (el) el.hidden = true; }

/** A pilot waiting on you for something: the (1) on the strip's ATC cell. */
function wantsYou(a) {
    if (a.divert || a.standbyUntil > G.t) return false;
    if (a.transit) return a.transit.asked && a.transit.ok === null;
    if (a.circuit && a.circuit.leg === 'down' && !a.landClr) return true;
    return !!(a.emerg || a.crossReq || a.wxReq || a.lowAlt || a.reminded || a.request
        || (a.state === 'gate' && a.kind === 'dep' && a.called) || a.state === 'pushed' || a.state === 'clear'
        || a.state === 'wait' || (a.appr?.loc && !a.landClr && a.freq === 'TWR'));
}

function renderStrips() {
    if (!G) return;
    const el = $('#strips');
    const strip = a => {
        let right;
        if (SURFACE_STATES.has(a.state) && a.state !== 'wait' && a.state !== 'luaw') right = `<span class="l0">${surfaceTag(a)}</span><span class="l2">${a.kind === 'dep' ? 'rwy ' + a.rwy.id : a.landEnd ? 'from ' + a.landEnd.id : ''}</span>`;
        else if (a.state === 'luaw') right = `<span class="l0">LUAW ${a.rwy.id}</span><span class="l2">on the runway</span>`;
        else if (a.state === 'wait') right = `<span class="l0">HS ${a.rwy.id}</span><span class="l2">${Math.floor((G.t - a.born) / 60)}m</span>`;
        else if (a.state === 'roll') right = `<span class="l0">ROLL ${a.rwy.id}</span><span class="l2">${Math.round(a.spd)}kt</span>`;
        else {
            let what = a.kind === 'arr'
                ? (a.appr || a.holdAt || a.orbit || a.direct || a.lowAlt || a.wxReq ? intentTag(a) : 'H' + hdg3(a.tHdg))
                : `${a.gate.name} ${a.alt >= exitAlt(a) - 50 ? '✓' : alt3(exitAlt(a))}`;
            if (a.kind === 'dep' && (a.lowAlt || a.wxReq)) what = intentTag(a);
            right = `<span class="l0">${alt3(a.alt)}${Math.abs(a.tAlt - a.alt) > 60 && !a.appr?.loc ? (a.tAlt > a.alt ? '↑' : '↓') + alt3(a.tAlt) : ''}</span><span class="l2">${what}</span>`;
        }
        const req = mine(a) && wantsYou(a);
        return `<button class="strip ${a.kind}${a === G.selected ? ' sel' : ''}${a.conflict || a.lowAlt || a.wxReq || a.crossReq || a.emerg ? ' conf' : ''}${a.emerg ? ' emerg' : ''}${mine(a) ? '' : ' sys'}" data-id="${a.id}">
            <span class="bar"></span>
            <span><span class="l1">${a.cs}</span><span class="l2">${typeTag(a)}</span></span>
            <span class="r">${right}</span>
            <span class="atc${mine(a) ? ' yours' : ''}${req ? ' req' : ''}">ATC${req ? ' (1)' : ''}<i></i></span></button>`;
    };
    if (onFreq[railView]) {
        const list = G.aircraft.filter(a => onFreq[railView](a) && !(a.state === 'gate' && a.kind === 'arr'));
        el.innerHTML = `<div class="strip-h"><span>${escapeHtml(freqLabel(railView))}</span><span>${list.length}</span></div>` + (list.map(strip).join('') || '<div class="strip-none">Nobody on frequency.</div>');
        renderRail();
        return;
    }
    // Your frequencies first, each with its own traffic; then what the system is working.
    const order = ['APP', 'TWR', 'GND'].filter(f => G.positions.has(f));
    const groups = order.map(f => {
        const list = G.aircraft.filter(a => a.freq === f && !(a.state === 'gate' && a.kind === 'arr'));
        return `<div class="strip-h"><span>${FREQ_NAME[f]}</span><span>${list.length}</span></div>`
            + (list.map(strip).join('') || '<div class="strip-none">Nobody on frequency.</div>');
    });
    const sysList = G.aircraft.filter(a => !G.positions.has(a.freq) && !(a.state === 'gate' && a.kind === 'arr' && a.parkedUntil));
    if (sysList.length) groups.push(`<div class="strip-h"><span>With the system</span><span>${sysList.length}</span></div>` + sysList.map(strip).join(''));
    el.innerHTML = groups.join('');
    renderRail();
}

function renderHud() {
    $('#s-score').textContent = G.score;
    $('#s-landed').textContent = G.stats.landed;
    $('#s-departed').textContent = G.stats.departed;
    $('#s-incidents').textContent = G.stats.incidents;
    const z = new Date(G.zulu0 + G.t * 1000);
    const zulu = String(z.getUTCHours()).padStart(2, '0') + String(z.getUTCMinutes()).padStart(2, '0') + 'Z';
    const tog = `<button class="hud-tog" type="button" aria-label="${hudMin ? 'Show' : 'Hide'} the airport info">${hudMin ? '+' : '−'}</button>`;
    if (hudMin) { $('#hud').innerHTML = `${tog}<b>${G.world.icao}</b> ${zulu}`; return; }
    $('#hud').innerHTML = `${tog}<b>${G.world.icao}</b> ${zulu} · YOU <b>${['APP', 'TWR', 'GND'].filter(f => G.positions.has(f)).join(' ')}</b><br>`
        + `ATIS <b>${PHONETIC[G.atis].toUpperCase()}</b> · A<b>${G.altim}</b><br>`
        + `WIND <b>${hdg3(G.wind.dir)}/${String(G.wind.spd).padStart(2, '0')}${G.met.gust ? 'G' + G.met.gust : ''}</b>${G.opts.weather ? ` · <b>${metText(G.met)}</b>` : ''}<br>`
        + `ARR <b>${G.active.arr.map(e => e.id).join(' ')}</b> · <b>${G.atisCfg.apps.map(t => APP_TAG[t]).join('/')}</b>${G.atisCfg.mode === 'manual' ? ' (set)' : ''}<br>`
        + `DEP <b>${G.active.dep.map(e => e.id).join(' ')}</b><br>`
        + `EXIT <b>${terrainOn() ? 'by gate' : alt3(G.world.exitAlt) + '+'}</b> · MVA <b>${terrainOn() ? 'by sector' : alt3(G.world.minAlt)}</b>`
        + (G.surfaceStatus ? `<br><span class="taxi-st${G.ground ? '' : ' bad'}">TAXI MAP <b>${escapeHtml(G.surfaceStatus.length > 80 ? G.surfaceStatus.slice(0, 78) + '… (see log)' : G.surfaceStatus)}</b></span>` : '')
        + (G.opts.terrain && !G.mva ? '<br>loading terrain…' : '')
        + `<br>RULES <b>${G.rules.id === 'ifatc' ? 'INFINITE FLIGHT' : 'REAL LIFE (FAA)'}</b>`
        + (below(G.met) && G.rules.minimums ? '<br><b style="color:#ff8a98">BELOW MINIMUMS</b>' : '');
}

/* ------------------------------------------------------------------ */
/* Command line                                                        */
/* ------------------------------------------------------------------ */

function runCommand(text) {
    const toks = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return;
    let ac = null;
    const first = toks[0];
    const exact = G.aircraft.find(a => a.cs === first);
    const bySuffix = G.aircraft.filter(a => a.cs.endsWith(first) && /^\d+$/.test(first));
    if (exact) { ac = exact; toks.shift(); }
    else if (bySuffix.length === 1) { ac = bySuffix[0]; toks.shift(); }
    else ac = G.selected;
    if (!ac) { sys('Select an aircraft first, or start the command with its callsign.'); return; }
    if (ac !== G.selected) select(ac);

    const c = {};
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        let m;
        if ((m = /^([HLR])(\d{1,3})$/.exec(t))) { c.hdg = Number(m[2]); c.turn = m[1] === 'H' ? null : m[1]; }
        else if ((m = /^FL(\d{2,3})$/.exec(t))) c.alt = Number(m[1]) * 100;
        else if ((m = /^[ACD](\d{1,3})$/.exec(t))) { const n = Number(m[1]); c.alt = n < 30 ? n * 1000 : n * 100; }
        else if ((m = /^[ACD](\d{4,5})$/.exec(t))) c.alt = Number(m[1]);
        else if ((m = /^S(\d{2,3})$/.exec(t))) c.spd = Number(m[1]);
        else if ((m = /^I(?:LS)?(\d{1,2}[LRC]?)$/.exec(t))) c.ils = findEnd(m[1]);
        else if (t === 'ILS' || t === 'I') c.ils = findEnd(toks[++i] || '');
        else if ((m = /^(LOC|RNAV|GPS|RNV)(\d{1,2}[LRC]?)?$/.exec(t))) { c.ils = findEnd(m[2] || toks[++i] || ''); c.appType = m[1] === 'LOC' ? 'LOC' : 'RNAV'; }
        else if ((m = /^(?:VIS|VA|VISUAL)(\d{1,2}[LRC]?)?$/.exec(t))) { c.visual = findEnd(m[1] || toks[++i] || ''); if (!c.visual) { sys('Visual to which runway? e.g. "va 22L".'); return; } }
        else if (t === 'RFS' || t === 'FIELD') c.reportField = true;
        else if (t === 'UNABLE' || t === 'UN') c.unable = true;
        else if (t === 'DCT' || t === 'D' || t === 'DIRECT') c.direct = G.world.fixes.find(f => f.name === toks[++i]);
        else if (t === 'TO' || t === 'T' || t === 'CTO') c.takeoff = true;
        else if (t === 'GA') c.goAround = true;
        else if (t === 'LUAW' || t === 'LU') c.luaw = true;
        else if (t === 'DEV' || t === 'WX') c.deviate = true;
        else if (t === 'PB' || t === 'PUSH') c.push = true;
        else if (t === 'TX' || t === 'TAXI') {
            const nx = toks[i + 1];
            if (nx && (findEnd(nx) || G.ground?.gates.some(g => g.ref.toUpperCase() === nx))) { c.taxi = nx; i++; } else c.taxi = true;
        }
        else if (t === 'SP' || t === 'SLOW' || t === 'SLOWEST') c.slowest = true;
        else if (t === 'TL' || t === 'TR' || t === 'SA' || t === '180' || t === 'M180') c.prog = t === 'TL' ? 'L' : t === 'TR' ? 'R' : t === 'SA' ? 'S' : '180';
        else if (t === 'CYD' || t === 'DISC') c.discretion = true;
        else if (t === 'CXTO' || t === 'CANCEL' || t === 'RTO') c.cancelTO = true;
        else if (t === 'HS' || t === 'HOLDSHORT') c.holdShort = true;
        else if (t === 'CI') c.contInbound = true;
        else if (t === 'RP') c.radarPattern = true;
        else if (t === 'DV' || t === 'CV' || t === 'VIA') c.via = true;
        else if (t === 'NO' || t === 'NUMBER') c.seqLand = true;
        else if (t === 'ENT' || t === 'ENTER') {
            const k = toks[i + 1], e = findEnd(toks[i + 2] || '');
            if (!PATTERN_SAY[k] || !e) { sys('Pattern entry: "ent S 22L" (S straight in, DL/DR downwind, BL/BR base).'); return; }
            c.entry = { kind: k, end: e }; i += 2;
        }
        else if (t === 'SEQ' || t === 'NUM') c.seqNo = true;
        else if (t === 'ITO' || t === 'IMM') c.immediate = true;
        else if (t === 'FC' || t === 'FREQ') c.freqChange = true;
        else if (t === 'EPT' || t === 'PROG') c.expectProg = true;
        else if (t === 'GW' || t === 'FOL' || t === 'FOLLOW') {
            const o = G.aircraft.find(a => a.cs === toks[i + 1] || (a.cs.endsWith(toks[i + 1] || '#') && /^\d+$/.test(toks[i + 1] || '')));
            if (!o) { sys(`${t === 'GW' ? 'Give way to' : 'Follow'} whom? e.g. "${t.toLowerCase()} AAL123".`); return; }
            c[t === 'GW' ? 'giveWay' : 'follow'] = o; i++;
        }
        else if (t === 'MT' || t === 'TWR' || t === 'TOWER') c.tower = true;
        else if (t === 'MG' || t === 'GND' || t === 'GROUND') c.ground = true;
        else if (t === 'HP') c.holdPos = true;
        else if (t === 'CT' || t === 'CONT') c.cont = true;
        else if (t === 'CR' || t === 'CROSS') c.cross = true;
        else if (t === 'CL' || t === 'CTL' || t === 'LAND') c.land = true;
        else if (t === 'HOLD' || t === 'HLD') { c.holdFix = G.world.fixes.find(f => f.name === toks[++i]); if (!c.holdFix) { sys('Hold at which fix? e.g. "hold KORAN".'); return; } }
        else if ((m = /^([LR])360$/.exec(t))) c.orbit = m[1];
        else if (G.world.fixes.some(f => f.name === t)) c.direct = G.world.fixes.find(f => f.name === t);
        else { sys(`Didn't understand "${t}".`); return; }
    }
    if ('ils' in c && !c.ils) { sys('No such runway.'); return; }
    if ('direct' in c && !c.direct) { sys('No such fix.'); return; }
    if (Object.keys(c).length) issue(ac, c);
    renderCard(true);
}

/* ------------------------------------------------------------------ */
/* Loop, controls, start screen                                        */
/* ------------------------------------------------------------------ */

let last = 0, acc = 0, uiT = 0;

function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000 || 0);
    last = now;
    if (G && !G.over && G.speed > 0) {
        acc += dt * G.speed;
        while (acc >= TICK) { tick(TICK); acc -= TICK; }
    }
    if (G) {
        draw();
        if ((uiT += dt) > 0.4) {
            uiT = 0;
            const tiles = G.tiles ? G.tiles.loading + G.tiles.queue.length : 0;
            if ((loading.get('tiles') || '') !== (tiles ? `Loading map tiles (${tiles})` : '')) busy('tiles', tiles ? `Loading map tiles (${tiles})` : null);
            renderHud();
            renderStrips();
            renderCard(false);
            reminders();
        }
    }
    requestAnimationFrame(frame);
}

function setSpeed(s) {
    G.speed = s;
    if (s > 0) lastSpeed = s;             // tapping PAUSED resumes at this speed
    document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', Number(b.dataset.speed) === s));
    $('#paused-tag').hidden = s !== 0;
}

let lastSpeed = 1;
function togglePause() {
    if (G.speed === 0) setSpeed(lastSpeed || 1);
    else { lastSpeed = G.speed; setSpeed(0); }
}

function endShift() {
    G.over = true;
    loading.clear(); busy('', null);
    $('#coord').hidden = true;
    const best = store.get('best', {});
    const prev = best[G.world.icao] || null;
    const isBest = prev == null || G.score > prev;
    if (isBest) { best[G.world.icao] = G.score; store.set('best', best); }
    const mins = Math.floor(G.t / 60);
    const el = $('#summary');
    el.hidden = false;
    el.innerHTML = `<div class="summary-card">
        <h2>Shift over at ${G.world.icao}</h2>
        <div class="muted" style="color:var(--muted)">${mins} min on frequency</div>
        <div class="big">${G.score}</div>
        <div>${isBest ? 'New best at this airport.' : `Your best here: ${prev}`}</div>
        <div class="grid">
            <div>Landed <b>${G.stats.landed}</b></div>
            <div>Departed <b>${G.stats.departed}</b></div>
            <div>Separation losses <b>${G.stats.incidents}</b></div>
            <div>Go-arounds <b>${G.stats.goArounds}</b></div>
            <div>Rule violations <b>${G.stats.violations}</b></div>
            ${G.opts.terrain ? `<div>Low altitude alerts <b>${G.stats.lowAlt}</b></div><div>Lost to terrain <b>${G.stats.crashes}</b></div>` : ''}
            ${G.opts.weather ? `<div>Turbulence encounters <b>${G.stats.turbulence}</b></div>` : ''}
        </div>
        <div class="btn-row">
            <button class="btn primary" id="again">Another shift</button>
            <button class="btn" id="pick">Pick an airport</button>
        </div></div>`;
    $('#again').onclick = () => startGame(DATA.byIcao.get(G.world.icao), G.level);
    $('#pick').onclick = () => { $('#game').hidden = true; $('#start').hidden = false; document.body.classList.remove('in-game'); G = null; renderStart(); };
}

function bindGame() {
    bindScope();
    bindCard();
    bindLayers();
    bindAtis();
    bindRail();
    $('#coord').addEventListener('click', e => { const b = e.target.closest('[data-ans]'); if (b && G) answer(Number(b.dataset.ans)); });
    // The airport info box folds away to one line. On pointerdown: the box is redrawn several times a second.
    $('#hud').addEventListener('pointerdown', e => {
        if (!e.target.closest('.hud-tog') || !G) return;
        e.preventDefault();
        hudMin = !hudMin;
        store.set('hudMin', hudMin);
        renderHud(); renderRail();
    });
    $('#speed').addEventListener('click', e => { const b = e.target.closest('button'); if (b && G) setSpeed(Number(b.dataset.speed)); });
    // Settings (the gear under the centering button): two-way switches as segmented buttons.
    const segOn = (el, v) => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v)));
    const settings = $('#settings'), gear = $('#settings-btn');
    const showSettings = open => { settings.hidden = !open; gear.classList.toggle('on', open); gear.setAttribute('aria-expanded', String(open)); };
    gear.onclick = () => showSettings(settings.hidden);
    settings.addEventListener('click', e => { if (e.target.closest('[data-close]')) showSettings(false); });
    $('#paused-tag').onclick = () => { if (G && G.speed === 0) setSpeed(lastSpeed || 1); };
    const voice = $('#voice');
    segOn(voice, voiceOn ? 1 : 0);
    if (!('speechSynthesis' in window)) voice.closest('.srow').hidden = true;
    voice.onclick = e => {
        const b = e.target.closest('button');
        if (!b) return;
        voiceOn = b.dataset.v === '1';
        store.set('voice', voiceOn);
        segOn(voice, voiceOn ? 1 : 0);
        if (!voiceOn) try { speechSynthesis.cancel(); } catch { /* none */ }
    };
    $('#end').onclick = () => { if (G && !G.over) endShift(); };
    const icons = $('#icons');
    segOn(icons, iconMode ? 1 : 0);
    icons.onclick = e => { const b = e.target.closest('button'); if (!b) return; iconMode = b.dataset.v === '1'; store.set('icons', iconMode); segOn(icons, iconMode ? 1 : 0); };
    $('#zoom-field').onclick = () => { if (!G) return; view.x = 0; view.y = 0; view.scale = Math.min(view.w, view.h) / 2 / fieldRadius(); };
    const style = $('#style');
    segOn(style, mapStyle);
    style.onclick = e => {
        const b = e.target.closest('button');
        if (!b) return;
        mapStyle = b.dataset.v;
        COLORS = PALETTE[mapStyle];
        store.set('style', mapStyle);
        segOn(style, mapStyle);
    };
    $('#log').addEventListener('click', e => {
        const d = e.target.closest('[data-id]');
        const a = d && G && G.aircraft.find(x => x.id === Number(d.dataset.id));
        if (a) select(a);
    });
    $('#strips').addEventListener('click', e => {
        const b = e.target.closest('.strip');
        if (b) select(G.aircraft.find(a => a.id === Number(b.dataset.id)) || null);
    });
    $('#cmd-form').addEventListener('submit', e => {
        e.preventDefault();
        const input = $('#cmd');
        if (G && !G.over) runCommand(input.value);
        input.value = '';
    });
    document.addEventListener('keydown', e => {
        if (!G || G.over || $('#game').hidden) return;
        const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '');
        if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
        const k = e.key;
        if (k === ' ') { e.preventDefault(); togglePause(); }
        else if (k === '/') { e.preventDefault(); $('#cmd').focus(); }
        else if (k === 'Escape') select(null);
        else if (k === 'Tab') {
            e.preventDefault();
            const list = G.aircraft;
            if (!list.length) return;
            const i = list.indexOf(G.selected);
            select(list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]);
        } else if (G.selected && G.selected.state === 'air' && mine(G.selected)) {
            // Arrows: a heading 5° (10° with shift) either way, or 1,000 ft up or down, said at once.
            const ac = G.selected, step = e.shiftKey ? 10 : 5;
            if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); issue(ac, { hdg: norm(Math.round(ac.tHdg) + (k === 'ArrowLeft' ? -step : step)) || 360 }); }
            else if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); issue(ac, { alt: clamp(ac.tAlt + (k === 'ArrowUp' ? 1000 : -1000), G.world.minAlt, 24000) }); }
        }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && G && G.speed > 0 && !G.over) togglePause(); });
}

// Folded by default on short (sideways phone) screens, where the scope has little room.
let hudMin = store.get('hudMin', typeof matchMedia === 'function' && matchMedia('(max-height: 540px)').matches);
let opts = { terrain: store.get('terrain', false), weather: store.get('weather', false), positions: store.get('positions', ['APP', 'TWR']),
    start: store.get('start', 'random'), startN: store.get('startN', 6), emerg: store.get('emerg', true), rules: store.get('rules', 'faa'), radar: store.get('radar', 'system'), pattern: store.get('pattern', true) };

/* What's loading, shown with the InFlight mark in the bottom-right of the scope. */
const loading = new Map();      // id -> text, in the order they started
function busy(id, text) {
    if (text) loading.set(id, text); else loading.delete(id);
    const el = $('#loader');
    if (!el) return;
    el.hidden = !loading.size;
    $('#scope-wrap').classList.toggle('loading', loading.size > 0);
    $('#loader-steps').innerHTML = [...loading.values()].map(t => `<div>${escapeHtml(t)}</div>`).join('');
}

const RULES_NOTE = {
    faa: 'Real-world US procedures (FAA JO 7110.65): wake turbulence minima, 2.5 NM in trail on final, departure wake intervals, read-out taxi routes, emergencies and storm deviations.',
    ifatc: 'The way IFATC controls on the Expert Server, with only what Infinite Flight has: 3 NM / 1,000 ft separation, no wake turbulence (the sim doesn\'t model it), "taxi to runway" with the route dragged on the map, "contact Tower when ready", speed control including slowest practical speed, and no emergencies or storm cells.',
};

function toastStart(text) { $('#pos-summary').textContent = text; setTimeout(renderStart, 1600); }

/**
 * The field's taxiways and gates, from the sources the live map itself uses:
 * OpenFreeMap's free vector tiles (the live map's free engine and its 3D taxi
 * view) for the taxiways, and our backend's /api/gates for the gates.
 * OpenStreetMap via Overpass (three servers, plus the live map's own
 * airport-click request) runs alongside as a fallback. Every combination
 * that comes back is built, and the fullest network wins.
 * Resolves to { ground, source } or { error, map }, where `map` is whatever
 * taxiways were found, to draw even when they can't be taxied on.
 */
async function loadSurface(world, say = () => {}) {
    const xs = world.ends.map(e => e.thr.x), ys = world.ends.map(e => e.thr.y);
    const cosLat = Math.cos(world.lat * D2R), pad = 0.8;
    const box = {
        s: world.lat + (Math.min(...ys) - pad) / 60, n: world.lat + (Math.max(...ys) + pad) / 60,
        w: world.lon + (Math.min(...xs) - pad) / (60 * cosLat), e: world.lon + (Math.max(...xs) + pad) / (60 * cosLat),
    };
    const failures = [];
    const tryIt = (label, p) => p.catch(err => { failures.push(`${label}: ${err.name === 'AbortError' ? 'timed out' : err.message}`); return null; });
    const within = (ms, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timed out'), { name: 'AbortError' })), ms))]);

    const tiles = tryIt('OpenFreeMap', within(25000, aerowayFromOpenFreeMap(box)));
    const gates = tryIt('InFlight gates', within(15000, gatesFromBackend(world.icao)));
    // Overpass can take half a minute or more at a big field (the live map simply waits for it), so give it 90 s.
    const osm = tryIt('OpenStreetMap', within(90000, overpassLayout(world, box)));

    const options = [];
    let map = null;
    const build = (features, source) => {
        let ground;
        try { ground = buildGround({ type: 'FeatureCollection', features }, (lat, lon) => world.proj(lat, lon), world.ends); }
        catch (err) { ground = { error: `couldn't be read (${err.message})` }; }
        if (ground.error) {
            failures.push(`${source}: ${ground.error}`);
            if (ground.map && (!map || ground.map.lines.length > map.lines.length)) map = ground.map;
        } else options.push({ ground, source, score: ground.main.length + ground.gates.length * 5 });
    };
    // Building is a few seconds' work on a phone: let the status paint first.
    const paint = () => new Promise(r => setTimeout(r, 50));
    say('fetching OpenFreeMap tiles…');
    const t = await tiles;
    if (t) {
        say(`${t.length} OpenFreeMap features; fetching gates…`);
        const g = await gates;
        say('building the taxi network…');
        await paint();
        build([...t, ...(g || [])], `OpenFreeMap taxiways${g ? ' + InFlight gates' : ''}`);
    }
    // OpenFreeMap's tiles carry the taxiways but not the taxilanes between the terminals:
    // OpenStreetMap has those. With a network already in hand, the shift starts on it and
    // OpenStreetMap's replaces it when it arrives, if it's fuller (it usually is).
    if (options.length) {
        const first = options[0];
        const later = Promise.all([gates, osm]).then(async ([g, o]) => {
            if (!o) return { error: failures.filter(f => f.startsWith('OpenStreetMap')).join('; ') || 'OpenStreetMap: no answer' };
            await paint();
            const n = options.length;
            build([...o.features, ...(g || [])], `OpenStreetMap${g ? ' + InFlight gates' : ''}`);
            const full = options.length > n ? options[options.length - 1] : null;
            // OpenStreetMap's own network, unless it's clearly thinner than the tiles' (a partial answer):
            // then the tiles' taxiways with OpenStreetMap's taxilanes added.
            if (full && full.score >= first.score * 0.8) return { ground: full.ground, source: full.source };
            const lanes = o.features.filter(f => f.properties?.aeroway === 'taxilane' || f.properties?.aeroway === 'terminal' || f.properties?.aeroway === 'hangar');
            if (!lanes.length) return { error: 'OpenStreetMap has no taxilanes mapped here' };
            const before = options.length;
            build([...t, ...lanes, ...(g || [])], `OpenFreeMap taxiways + OpenStreetMap taxilanes${g ? ' + InFlight gates' : ''}`);
            return options.length > before ? { ground: options[options.length - 1].ground, source: options[options.length - 1].source } : { error: 'the taxilanes could not be joined to the taxiways' };
        });
        return { ground: first.ground, source: first.source, later };
    }
    say('waiting for OpenStreetMap (big airports can take a minute)…');
    const [g, o] = await Promise.all([gates, osm]);
    if (o) {
        say('building the taxi network from OpenStreetMap…');
        await paint();
        build([...o.features, ...(g || [])], `OpenStreetMap${g ? ' + InFlight gates' : ''}`);
    }
    if (!options.length) return { error: failures.join('; ') || 'no source answered', map: map && map.lines.length ? map : null };
    options.sort((a, b) => b.score - a.score);
    return { ground: options[0].ground, source: options[0].source };
}

/**
 * A fuller taxi network arrived mid-shift (OpenStreetMap, with the taxilanes):
 * use it from now on. Taxiing aircraft finish the route they have (it's
 * coordinates, not nodes); parked ones move to the same stand in the new map.
 */
function swapGround(up) {
    const gr = up.ground;
    G.pendingGround = null;
    for (const a of G.aircraft) {
        if (!a.stand) continue;
        const same = gr.gates.find(g => g.ref === a.stand.ref && Math.hypot(g.x - a.stand.x, g.y - a.stand.y) < 0.1)
            || gr.gates.reduce((b, g) => { const d = Math.hypot(g.x - a.stand.x, g.y - a.stand.y); return d < 0.05 && (!b || d < b.d) ? { g, d } : b; }, null)?.g;
        if (same) a.stand = same;
    }
    G.ground = G.surfaceMap = gr;
    G.surfaceStatus = `${up.source} ✓`;
    busy('swap', null);
    sys(`Taxilanes in: the taxi map is now ${up.source} (${gr.summary}).`, 'good');
    renderHud();
}

/** OpenStreetMap through Overpass: three servers at once, plus the live map's own airport request. Kept on the device per airport. */
function overpassLayout(world, box) {
    const key = 'inflight.approach.osm2.' + world.icao;
    try {
        const c = JSON.parse(localStorage.getItem(key) || 'null');
        if (c && Date.now() - c.t < 14 * 864e5 && c.features?.length) return Promise.resolve({ type: 'FeatureCollection', features: c.features });
    } catch { /* nothing kept */ }
    return overpassFetch(world, box).then(layout => {
        // Only what the taxi map uses, to 1 m: a big field is then a few hundred KB.
        const keep = ['taxiway', 'taxilane', 'apron', 'gate', 'parking_position', 'terminal', 'hangar'];
        const r5 = c => Array.isArray(c[0]) ? c.map(r5) : [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5];
        const features = layout.features.filter(f => keep.includes(f.properties?.aeroway) && f.geometry)
            .map(f => ({ type: 'Feature', properties: { aeroway: f.properties.aeroway, ref: f.properties.ref || f.properties.name || '' }, geometry: { type: f.geometry.type, coordinates: r5(f.geometry.coordinates) } }));
        // Not the live map's smaller-box answer: that one isn't the whole field.
        try { const txt = JSON.stringify({ t: Date.now(), features }); if (!layout.partial && txt.length < 2.5e6) localStorage.setItem(key, txt); } catch { /* full or private */ }
        return { type: 'FeatureCollection', features };
    });
}

function overpassFetch(world, box) {
    const bbox = `${box.s.toFixed(5)},${box.w.toFixed(5)},${box.n.toFixed(5)},${box.e.toFixed(5)}`;
    const q = `[out:json][timeout:60];(way["aeroway"~"taxiway|taxilane|apron|terminal|hangar"](${bbox});node["aeroway"~"gate|parking_position"](${bbox}););out geom;`;
    const errs = [];
    const take = (host, p) => p
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
        .then(d => (d.elements && d.elements.length ? AirportLayoutManager.processOsmData(d.elements) : Promise.reject(new Error('empty'))))
        .catch(err => { errs.push(`${host} ${err.message === 'Failed to fetch' ? 'unreachable' : err.message}`); throw err; });
    // The live map asks overpass-api.de with a GET; the mirrors take a POST.
    const get = () => take('overpass-api.de', fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q)));
    const post = url => take(new URL(url).host, fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
    const mirrors = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.osm.jp/api/interpreter'];
    return Promise.any([get(), ...mirrors.map(post)])
        // All of them refused (often a rate limit after a few quick reloads): one more go in 15 s.
        .catch(() => new Promise(res => setTimeout(res, 15000)).then(get))
        // Last resort: the live map's own airport request (a smaller box round the field).
        .catch(() => AirportLayoutManager.getLayout(world.icao, world.lat, world.lon).then(l => (l ? { ...l, partial: true } : Promise.reject(new Error('empty')))))
        .catch(() => Promise.reject(new Error([...new Set(errs)].join(', ') || 'no server answered')));
}
async function startGame(airport, level) {
    store.set('last', airport.icao);
    store.set('level', level);
    store.set('terrain', opts.terrain);
    store.set('weather', opts.weather);
    store.set('positions', opts.positions);
    store.set('start', opts.start);
    store.set('startN', opts.startN);
    store.set('emerg', opts.emerg);
    store.set('rules', opts.rules);
    store.set('radar', opts.radar);
    store.set('pattern', opts.pattern);
    $('#start').hidden = true;
    document.body.classList.add('in-game');
    $('#game').hidden = false;
    window.scrollTo(0, 0);
    $('#summary').hidden = true;
    $('#log').innerHTML = '';
    nextId = 1;
    // Real waypoints and procedures for US fields (nav/<ICAO>.json, built by tools/build-nav.mjs).
    const [nav, freqs] = await Promise.all([loadNav(airport.icao), loadFreqs(airport.icao)]);
    newGame(airport, level, { ...opts }, nav);
    G.freqs = freqs;
    railView = null; railHtml = '';
    const game = G;
    renderLayers();
    renderAsk();
    loading.clear(); busy('', null);
    // Only this shift's loading reaches the badge.
    const step = (id, text) => { if (G === game) busy(id, text); };
    fitView();
    resetView();
    menuKey = '';
    renderCard(true);
    // The map loads for everyone; with Terrain on, the shift waits for it so the MVAs are real from the start.
    step('map', 'Fetching the terrain map');
    const dem = loadDem(airport.lat, airport.lon).catch(() => null).finally(() => step('map', null));
    setSpeed(0);
    sys(game.positions.has('GND') ? 'Loading the airport\'s taxiways and gates…' : 'Loading the airport…');
    game.surfaceStatus = 'loading…';
    step('surface', 'Fetching taxiways and gates');
    const surface = await loadSurface(game.world, msg => { if (G === game) { game.surfaceStatus = msg; step('surface', cap(msg.replace(/…$/, ''))); renderHud(); } }).catch(err => ({ error: `couldn't be loaded (${err.message})` }));
    step('surface', null);
    if (G !== game) return;
    game.ground = surface.ground || null;
    game.surfaceMap = surface.ground || surface.map || null;
    // On the scope too, so it's visible without reading the log.
    if (surface.later) {
        step('lanes', 'Fetching taxilanes from OpenStreetMap');
        surface.later.then(up => {
            step('lanes', null);
            if (G !== game) return;
            if (up.ground) step('swap', 'Switching to the full taxi map');
            if (up.ground) { game.pendingGround = up; return; }
            game.surfaceStatus = game.surfaceStatus.replace(' · fetching taxilanes…', ` · no taxilanes (${up.error})`);
            sys(`No taxilanes between the terminals: ${up.error}. Stands are joined straight to the nearest taxiway.`, 'bad');
            renderHud();
        });
    }
    game.surfaceStatus = surface.ground ? `${surface.source} ✓${surface.later ? ' · fetching taxilanes…' : ''}`
        : surface.map ? `drawn only (${surface.map.lines.length} lines), no taxi network: ${surface.error}` : `none: ${surface.error}`;
    renderHud();
    if (surface.ground) sys(`Surface (${surface.source}): ${surface.ground.summary}.`);
    else sys(`No taxi map: ${surface.error}.${surface.map ? ` Drawing the ${surface.map.lines.length} taxiway segments found.` : ''}`, 'bad');
    if (!game.ground && game.positions.has('GND')) {
        game.positions.delete('GND');
        if (!game.positions.size) game.positions.add('TWR');
        const msg = `No taxi map for ${airport.icao} (${surface.error}), so Ground isn't available this shift. You're on ${[...game.positions].map(f => FREQ_NAME[f]).join(' and ')}.`;
        sys(msg, 'bad');
        toast(msg, 'bad', 9000);
    }
    resetView();
    if (game.opts.terrain) {
        setSpeed(0);
        sys('Loading terrain…');
        step('terrain', 'Building minimum vectoring altitudes from the terrain');
        const d = await dem;
        step('terrain', null);
        if (G !== game) return;
        if (d) {
            game.dem = d;
            game.mva = buildMva(d, game.world.minAlt);
            // Each gate's exit altitude clears the highest MVA within 10 miles of it.
            for (const f of game.world.fixes.filter(f => f.kind === 'dep')) {
                let hi = 0;
                for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) if (dx * dx + dy * dy <= 100) hi = Math.max(hi, mvaAt(game.mva, f.x + dx, f.y + dy));
                f.exitAlt = Math.max(game.world.exitAlt, Math.ceil(hi / 1000) * 1000);
            }
        }
        else sys('Terrain could not be loaded, so the MVA is one altitude for the whole scope.', 'bad');
    } else {
        dem.then(d => { if (G === game && d) game.dem = d; });
    }
    setSpeed(1);
    const wxNote = game.opts.weather ? ` Weather ${metText(game.met)}${below(game.met) ? ', below ILS minimums' : ''}.` : '';
    const yours = ['APP', 'TWR', 'GND'].filter(f => game.positions.has(f)).map(f => FREQ_NAME[f]).join(' and ');
    sys(`You're working ${yours}. The system works the rest.`);
    sys('Tap an aircraft (or its strip) to open its information and commands. Drag an airborne target to give a heading; drag one on the ground to a runway, taxiway or gate.');
    sys(`${airport.icao} approach is open. Landing ${G.active.arr.map(e => e.id).join(', ')}, departing ${G.active.dep.map(e => e.id).join(', ')}. Departures exit at ${terrainOn() ? 'the altitude on their strip' : fmtAlt(G.world.exitAlt) + ' or above'}.${wxNote}`);
    seedTraffic(game.opts.start === 'none' ? 0 : game.opts.start === 'set' ? game.opts.startN : Math.round(rand(2, TRAFFIC[level].max * 0.7)));
    const u = new URL(location.href);
    u.searchParams.set('airport', airport.icao);
    history.replaceState(null, '', u);
}

/* ---- start screen ---- */

let chosen = null;
let level = TRAFFIC[store.get('level', 'normal')] ? store.get('level', 'normal') : 'normal';

function apCard(p) {
    const best = store.get('best', {})[p.icao];
    return `<button class="ap-card${chosen === p ? ' on' : ''}" data-icao="${p.icao}">
        <span class="icao">${p.icao}${p.iata ? ` <span style="color:var(--muted);font-weight:500">${p.iata}</span>` : ''}</span>
        <span class="nm">${escapeHtml(p.name)}</span>
        <span class="best">${p.runways.length} runway${p.runways.length > 1 ? 's' : ''}${best != null ? ` · best ${best}` : ''}</span>
    </button>`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderStart() {
    if (!DATA) return;
    $('#featured').innerHTML = FEATURED.map(i => DATA.byIcao.get(i)).filter(Boolean).map(apCard).join('');
    renderResults();
    document.querySelectorAll('#traffic button').forEach(b => b.classList.toggle('on', b.dataset.level === level));
    document.querySelectorAll('#opt-terrain button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'on') === opts.terrain));
    document.querySelectorAll('#opt-weather button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'on') === opts.weather));
    document.querySelectorAll('#opt-rules button').forEach(b => b.classList.toggle('on', b.dataset.v === opts.rules));
    $('#rules-note').innerHTML = opts.rules === 'ifatc' ? RULES_NOTE.ifatc : RULES_NOTE.faa;
    // Infinite Flight has no emergencies: the option goes away with that rule set.
    $('#emerg-row').hidden = $('#emerg-h').hidden = opts.rules === 'ifatc';
    // With Approach closed (Infinite Flight only), Tower takes the inbounds itself (IFATC 3.3).
    $('#radar-row').hidden = $('#radar-h').hidden = opts.positions.includes('APP');
    $('#pattern-row').hidden = !opts.positions.includes('TWR');
    document.querySelectorAll('#opt-pattern button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'on') === opts.pattern));
    document.querySelectorAll('#opt-radar button').forEach(b => b.classList.toggle('on', b.dataset.v === opts.radar));
    document.querySelectorAll('#opt-emerg button').forEach(b => b.classList.toggle('on', (b.dataset.v === 'on') === opts.emerg));
    document.querySelectorAll('#opt-start [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === opts.start));
    $('#start-n').textContent = opts.startN;
    $('#start-n-row').classList.toggle('off', opts.start !== 'set');
    document.querySelectorAll('#opt-pos button').forEach(b => {
        const on = opts.positions.includes(b.dataset.pos);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
    });
    const names = list => list.map(f => FREQ_NAME[f]).join(' and ');
    const yours = ['APP', 'TWR', 'GND'].filter(f => opts.positions.includes(f));
    $('#pos-summary').textContent = `You'll work ${names(yours)}.`;
    $('#go').disabled = !chosen;
    $('#go-note').textContent = chosen ? `${chosen.icao} · ${TRAFFIC_NAME[level]} traffic · ${opts.rules === 'ifatc' ? 'Infinite Flight' : 'Real-life'} rules` : 'Choose an airport to start.';
    // The panel's header and frequencies, as on Infinite Flight's Control screen.
    $('#ctl-icao').textContent = chosen ? chosen.icao : '----';
    $('#ctl-name').textContent = chosen ? chosen.name : 'Pick an airport on the left';
    $('#ctl-sub').textContent = chosen ? `${chosen.iata ? chosen.iata + ' · ' : ''}${chosen.runways.length} runway${chosen.runways.length > 1 ? 's' : ''}${chosen.country ? ' · ' + chosen.country : ''}` : 'Approach · an endless ATC practice shift';
    const fill = f => { for (const k of ['ATIS', 'GND', 'TWR', 'APP', 'DEP']) { const el = $('#fq-' + k); el.textContent = f[k] ? mhz(f[k][0]) : '—'; if (k === 'DEP') el.hidden = !f.DEP; } };
    fill({});
    if (chosen) { const want = chosen; loadFreqs(chosen.icao).then(f => { if (chosen === want) fill(f); }); }
    drawStartMap();
}

const TRAFFIC_NAME = { light: 'Light', normal: 'Normal', busy: 'Busy', event: 'Event' };

/** The start screen's map: the chosen airport's runways on a dark chart, range rings round it. */
function drawStartMap() {
    const cv = $('#ctl-map');
    if (!cv || $('#start').hidden) return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width || !r.height) return;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0a0f14'; c.fillRect(0, 0, r.width, r.height);
    const cx = r.width / 2, cy = r.height / 2;
    c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 1;
    for (let x = 0; x < r.width; x += 48) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, r.height); c.stroke(); }
    for (let y = 0; y < r.height; y += 48) { c.beginPath(); c.moveTo(0, y); c.lineTo(r.width, y); c.stroke(); }
    if (!chosen) {
        c.fillStyle = '#5d6773'; c.font = '600 14px Inter, system-ui, sans-serif'; c.textAlign = 'center';
        c.fillText('Pick an airport: search, or tap one below', cx, cy);
        return;
    }
    const p = chosen, cos = Math.cos(p.lat * D2R);
    const pts = p.runways.map(w => [[(w.le_longitude_deg - p.lon) * 60 * cos, (w.le_latitude_deg - p.lat) * 60], [(w.he_longitude_deg - p.lon) * 60 * cos, (w.he_latitude_deg - p.lat) * 60], w]);
    const span = Math.max(1.2, ...pts.flatMap(([a, b]) => [Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1])]));
    const k = Math.min(r.width, r.height) * 0.32 / span, S = ([x, y]) => [cx + x * k, cy - y * k];
    c.strokeStyle = 'rgba(120,200,180,0.18)';
    for (const nm of [span * 1.5, span * 2.6]) { c.beginPath(); c.arc(cx, cy, nm * k, 0, Math.PI * 2); c.stroke(); }
    c.lineCap = 'round';
    for (const [a, b, w] of pts) {
        const [ax, ay] = S(a), [bx, by] = S(b);
        c.strokeStyle = '#c9d1db'; c.lineWidth = Math.max(3, (w.width_ft || 150) / 6076 * k);
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
        c.fillStyle = '#e8eef5'; c.font = '600 11px "JetBrains Mono", monospace'; c.textAlign = 'center';
        const ux = (ax - bx), uy = (ay - by), L = Math.hypot(ux, uy) || 1;
        c.fillText(String(w.le_ident), ax + ux / L * 14, ay + uy / L * 14 + 4);
        c.fillText(String(w.he_ident), bx - ux / L * 14, by - uy / L * 14 + 4);
    }
    c.fillStyle = '#4fd1ff'; c.beginPath(); c.arc(cx, cy, 4, 0, Math.PI * 2); c.fill();
}

function renderResults() {
    const q = $('#ap-search').value.trim().toUpperCase();
    const el = $('#results');
    if (q.length < 2) { el.innerHTML = ''; return; }
    const hits = [];
    for (const p of DATA.playable) {
        if (p.icao === q || p.iata === q) hits.unshift(p);
        else if (p.icao.startsWith(q) || p.name.toUpperCase().includes(q)) hits.push(p);
        if (hits.length >= 12) break;
    }
    el.innerHTML = hits.length ? hits.map(apCard).join('') : '<div class="loading">No airport with a paved runway matches that.</div>';
}

async function init() {
    canvas = $('#scope');
    ctx = canvas.getContext('2d');
    bindGame();
    requestAnimationFrame(frame);

    const onPick = e => {
        const b = e.target.closest('.ap-card');
        if (!b) return;
        chosen = DATA.byIcao.get(b.dataset.icao);
        renderStart();
    };
    $('#featured').addEventListener('click', onPick);
    $('#results').addEventListener('click', onPick);
    $('#ap-search').addEventListener('input', renderResults);
    $('#traffic').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        level = b.dataset.level;
        renderStart();
    });
    $('#opt-pos').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        const p = b.dataset.pos, has = opts.positions.includes(p);
        if (has && opts.positions.length === 1) { toastStart('You need at least one position.'); return; }
        opts.positions = has ? opts.positions.filter(x => x !== p) : [...opts.positions, p];
        renderStart();
    });
    $('#opt-radar').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (b) { opts.radar = b.dataset.v; renderStart(); }
    });
    $('#opt-rules').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (b) { opts.rules = b.dataset.v; renderStart(); }
    });
    $('#start-opts').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.v) opts.start = b.dataset.v;
        if (b.dataset.n) { opts.start = 'set'; opts.startN = clamp(opts.startN + Number(b.dataset.n), 1, 20); }
        renderStart();
    });
    for (const k of ['terrain', 'weather', 'emerg', 'pattern']) {
        $('#opt-' + k).addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            opts[k] = b.dataset.v === 'on';
            renderStart();
        });
    }
    $('#go').onclick = () => { if (chosen) startGame(chosen, level); };
    new ResizeObserver(drawStartMap).observe($('#ctl-map'));

    try {
        await loadData();
    } catch (err) {
        $('#featured').innerHTML = `<div class="loading">Couldn't load the airport database (${escapeHtml(err.message)}). Refresh to try again.</div>`;
        return;
    }
    const want = (new URLSearchParams(location.search).get('airport') || store.get('last', '') || '').toUpperCase();
    chosen = DATA.byIcao.get(want) || null;
    renderStart();
}

// ?debug exposes the running game for scripted checks from the console.
if (new URLSearchParams(location.search).has('debug')) {
    window.approach = { get G() { return G; }, tick, issue, runCommand, findEnd, startGame, get DATA() { return DATA; }, toS, render: () => renderHud(), spawnArrival, spawnDeparture, renderCard, broadcastAtis, select, spawnTransit, spawnVfrInbound };
}

init();
