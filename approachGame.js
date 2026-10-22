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
const GS_FT_PER_NM = 318;   // 3° glideslope
const MIN_LANDING_RWY_FT = 4500;
const FAF_NM = 5;           // nominal final approach fix
const GATE_NM = FAF_NM + 1; // approach gate: 1 NM outside the FAF (7110.65 5-9-1)
const LAND_CLR_NM = 0.6;    // no landing clearance by here and the pilot goes around
const VIOLATION_PTS = 5;

const TRAFFIC = {
    light:  { gap: 140, max: 6 },
    normal: { gap: 95,  max: 10 },
    busy:   { gap: 60,  max: 15 },
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

function perf(type) {
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
        if (v.kind === 'STAR') pilot(ac, `${ac.radio}, end of the ${v.id} arrival, request vectors.`);
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
    $('#layers-btn').onclick = () => { el.hidden = !el.hidden; $('#layers-btn').classList.toggle('on', !el.hidden); renderLayers(); };
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

/** The SID a departure from this runway flies to this gate, if any (runway transitions: RW31L, or RW31B for both). */
function sidFor(gate, rwy) {
    const list = gate?.sids || [];
    const base = rwy.id.replace(/[LRC]$/, '');
    return list.find(s => s.rwy === rwy.id) || list.find(s => s.rwy === base + 'B' || s.rwy === base) || list.find(s => !s.rwy) || null;
}

/**
 * Active runways for a wind, the way a busy field runs them: one flow (the
 * best-into-wind runway and its parallels, no crossing runways at once).
 * The outermost parallel on each side lands and the ones inside it depart,
 * as at ATL, LAX or DEN; a lone runway (or one close pair) does both.
 */
function computeActive(world, wind) {
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
    if (lanes.length >= 2) {
        // The outermost runway on each side lands; everything inside it departs.
        arr = [lanes[0][0], lanes[lanes.length - 1][lanes[lanes.length - 1].length - 1]];
        dep = family.filter(e => !arr.includes(e));
        if (!dep.length) dep = [...arr];
    } else {
        arr = [[...lanes[0]].sort((a, b) => b.len - a.len)[0]];
        dep = [...lanes[0]];
    }
    dep = dep.sort((a, b) => b.len - a.len).slice(0, 3);
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
        active: computeActive(world, wind),
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
    if (opts.weather && G.rules.storms) for (let i = 0; i < 4; i++) spawnCell(true);
}

function airborne(a) { return a.state === 'air'; }
function agl(a) { return a.alt - G.world.elev; }

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
    const entries = G.world.fixes.filter(f => f.kind === 'arr').sort(() => Math.random() - 0.5);
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
            const st = pick(f.stars);
            const first = st.legs.find(l => l.alt != null);
            if (first && first.desc !== '-') { ac.alt = Math.max(ac.alt, first.alt); ac.tAlt = ac.alt; }
            ac.via = { kind: 'STAR', id: st.id, legs: st.legs, i: 0, vert: true };
            ac.star = st.id;
        }
        G.aircraft.push(ac);
        maybeEmergency(ac);
        if (noRadar()) {
            // No Approach: straight to Tower, inbound on the ILS when lined up with a final, otherwise for landing.
            const onIls = G.active.arr.find(e => { const g = finalGeom(ac, e); return g.along > 6 && Math.abs(g.xt) < g.along * Math.tan(25 * D2R); });
            if (onIls) ac.expect = onIls;
            Object.assign(ac, { freq: 'TWR', tAlt: Math.max(G.world.minAlt, Math.round((G.world.elev + 4000) / 1000) * 1000), tSpd: 230, tHdg: brg(-x, -y) });
            const dir = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(norm(brg(x, y)) / 45) % 8];
            pilot(ac, `${G.world.icao} Tower, ${ac.radio}, ${fmtAlt(alt)}, ${onIls ? `inbound on the ILS runway ${onIls.id}` : `inbound for landing, ${Math.round(r)} miles ${dir}`}, information ${PHONETIC[G.atis]}.`);
            return true;
        }
        pilot(ac, `${G.world.icao} Approach, ${ac.radio}, ${fmtAlt(ac.alt)}${ac.via ? `, descending via the ${ac.via.id} arrival` : ''}, information ${PHONETIC[G.atis]}.`);
        atc(`${ac.radio}, ${G.world.icao} Approach, altimeter ${G.altim}, expect ILS runway ${ac.expect.id} approach.`);
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

function spawnDeparture() {
    const waiting = G.aircraft.filter(a => a.state === 'wait');
    let rwy = nextDepRunway();
    if (!G.ground && waiting.filter(a => a.rwy === rwy).length >= 3) return false;
    const stand = G.ground ? freeStand() : null;
    if (G.ground && (!stand || G.aircraft.filter(a => a.kind === 'dep' && a.state !== 'air').length >= 6)) return false;
    const id = makeCallsign();
    if (!id) return false;
    const gate = pick(G.world.fixes.filter(f => f.kind === 'dep'));
    const initial = Math.max(Math.ceil((G.world.elev + 4000) / 1000) * 1000, mvaCeilingWithin(10));
    const ac = {
        id: nextId++, ...id, kind: 'dep', state: 'wait', perf: perf(id.type), rwy, gate,
        x: rwy.thr.x, y: rwy.thr.y, alt: G.world.elev, hdg: rwy.course, spd: 0,
        tHdg: rwy.course, tAlt: initial, tSpd: 280, turn: null,
        trail: [], trailT: 0, born: G.t, remindAt: G.t + 240, freq: 'TWR',
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
    pilot(ac, `${G.world.icao} Tower, ${ac.radio}, holding short runway ${rwy.id}, information ${PHONETIC[G.atis]}, ready for departure.`);
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
        parts.push('pushback approved'); back.push('pushing back');
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
        parts.push(`cross runway ${crossName(cr)}`); back.push(`crossing ${crossName(cr)}`);
    }
    if (c.giveWay) {
        const o = c.giveWay;
        if (o === ac || !isSurface(o)) { sys('Give way to an aircraft on the ground.'); return false; }
        ac.giveWay = { o, t: G.t, closest: Infinity };
        parts.push(`give way to ${o.radio}`); back.push(`giving way to ${o.radio}`);
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
    if (c.land && !(ac.appr && ac.appr.loc) && !(noRadar() && ac.pattern)) { sys(`${ac.cs} isn't established on the final approach course yet.`); return false; }
    if ((c.holdFix || c.orbit || c.ils || c.direct) && onGround) { sys(`${ac.cs} is on the ground.`); return false; }
    if (c.ils && ac.kind !== 'arr') { sys(`${ac.cs} is a departure.`); return false; }
    if (c.spd != null && ac.appr && ac.appr.along < Math.max(FAF_NM, 5)) {
        sys('No speed adjustments inside the final approach fix or 5 miles from the runway (7110.65 5-7-1).');
        delete c.spd;
    }

    let icpt = null;
    if (c.ils) {
        const willFly = c.hdg != null ? c.hdg : (ac.holdAt || ac.orbit || ac.direct) ? ac.hdg : ac.tHdg;
        icpt = predictIntercept(ac, c.ils, willFly);
        if (!icpt || icpt.along < FAF_NM) {
            atc(`${ac.radio}, cleared ILS runway ${c.ils.id} approach.`);
            pilot(ac, `Unable, on this heading we won't join the ${c.ils.id} localizer outside the final approach fix, ${ac.radio}.`);
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
        atc(`${ac.radio}, go around.`);
        goAround(ac, null);
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
        parts.push(`make a ${c.orbit === 'L' ? 'left' : 'right'} three-sixty`);
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
            parts.push(`maintain ${fmtAlt(a)} until established on the localizer`);
            back.push(`${fmtAlt(a)} until established`);
        } else {
            const verb = Math.abs(a - ref) < 50 ? 'maintain' : a > ref ? 'climb and maintain' : 'descend and maintain';
            parts.push(`${verb} ${fmtAlt(a)}`);
            back.push(`${verb.replace(' and maintain', '')} ${fmtAlt(a)}`);
        }
    }

    // ---- approach clearance
    if (c.ils) {
        const e = c.ils;
        ac.appr = { end: e, loc: false, gs: false, est: false, along: 99, xt: 0, spd: null };
        ac.holdAt = null; ac.direct = null; ac.orbit = null; ac.turn = null; ac.landClr = false;
        parts.push(`cleared ILS runway ${e.id} approach`);
        back.push(`cleared ILS ${e.id}`);
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
    if (c.spd != null) {
        let sp = clamp(Math.round(c.spd / 10) * 10, 130, 340);
        const min = minSpeed(ac);
        if (sp < min) { sys(`Minimum assignable speed for ${ac.cs} here is ${min} knots (7110.65 5-7-3).`); sp = min; }
        if (ac.alt < 10000 && sp > 250) { sys('250 knots maximum below 10,000 feet (14 CFR 91.117).'); sp = 250; }
        const verb = sp < ac.spd - 3 ? 'reduce speed to' : sp > ac.spd + 3 ? 'increase speed to' : 'maintain';
        if (ac.appr) {
            ac.appr.spd = sp;
            parts.push(`maintain ${sp} knots until ${FAF_NM} mile final`);
            back.push(`${sp} to ${FAF_NM} mile final`);
        } else {
            ac.tSpd = sp;
            parts.push(`${verb} ${sp}${verb === 'maintain' ? ' knots' : ''}`);
            back.push(`${sp} knots`);
        }
    }

    // ---- Tower: inbounds with no radar (IFATC 3.3)
    if (c.entry || c.contInbound || c.seqLand) {
        if (!noRadar() || ac.kind !== 'arr' || ac.state !== 'air' || ac.freq !== 'TWR' || ac.appr?.loc) { sys(`${ac.cs} isn't an inbound for you to sequence.`); return false; }
        if (c.contInbound) { ac.contInbound = true; parts.push('continue inbound'); back.push('continuing inbound'); }
        if (c.entry) {
            const { kind, end } = c.entry;
            ac.pattern = { end, kind, pts: patternPoints(ac, kind, end) };
            ac.via = null;
            Object.assign(ac, { expect: end, appr: null, orbit: null, holdAt: null, direct: null, tAlt: patternAlt(), tSpd: Math.min(ac.tSpd, 210) });
            parts.push(`enter ${PATTERN_SAY[kind]} runway ${end.id}`); back.push(`${PATTERN_SAY[kind]} ${end.id}`);
        }
        if (c.seqLand) { const n = landingNumber(ac); parts.push(`number ${n}`); back.push(`number ${n}`); }
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
    if (c.cancelTO) {
        if (ac.state === 'lineup' && ac.lineupThen === 'roll') {
            ac.lineupThen = 'luaw';
            atc(`${ac.radio}, cancel takeoff clearance, line up and wait runway ${ac.rwy.id}.`, G.aiActing);
            pilot(ac, `Cancel takeoff clearance, line up and wait, ${ac.radio}.`);
            return true;
        }
        if (ac.state !== 'roll') { sys(`${ac.cs} isn't on its takeoff roll.`); return false; }
        atc(`${ac.radio}, cancel takeoff clearance.`, G.aiActing);
        // Too late above 100 kt (IFATC 3.1.3): it's going.
        if (ac.spd >= 100) { pilot(ac, `Unable, ${ac.radio}, too fast to stop.`); return false; }
        ac.state = 'rto';
        pilot(ac, `Rejecting takeoff, ${ac.radio}.`);
        return true;
    }
    if (c.luaw) {
        if (ac.state === 'taxi') ac.preClr = 'luaw'; else startLineup(ac, 'luaw');
        parts.push(`runway ${ac.rwy.id}, line up and wait`);
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
        const sidName = !c.hdg && sidFor(ac.gate, ac.rwy)?.id;
        if (c.hdg != null) ac.hdgAssigned = true;
        const hdgPart = sidName ? `${sidName} departure` : runwayHdg ? 'fly runway heading' : `fly heading ${hdg3(ac.tHdg)}`;
        const imm = ac.immediate ? 'immediate ' : '';
        parts.push(`${wind}, runway ${ac.rwy.id}, ${hdgPart}, cleared for ${imm}takeoff`);
        back.push(`${sidName ? sidName + ' departure' : runwayHdg ? 'runway heading' : 'heading ' + hdg3(ac.tHdg)}, cleared for ${imm}takeoff ${ac.rwy.id}`);
    }
    if (c.land) {
        ac.landClr = true;
        const le = (ac.appr || ac.pattern).end;
        parts.push(`${wind}, runway ${le.id}, cleared to land`);
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
        parts.push(where ? `taxi to ${where}${hs}${purpose === 'runway' ? ', contact tower when ready' : ''}` : `taxi as shown, ${hold}${hs}`);
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
    pilot(ac, `${G.world.icao} Tower, ${ac.radio}, holding short runway ${ac.rwy.id}, ready for departure.`);
}

/** An arrival clear of the runway goes over to Ground and asks for its gate. */
function toGround(ac) {
    Object.assign(ac, { freq: 'GND', toGround: false });
    ac.stand = ac.stand || freeStand();
    pilot(ac, `${G.world.icao} Ground, ${ac.radio}, clear of ${ac.landEnd.id}${ac.exitTwy ? ' at ' + ac.exitTwy : ''}, taxi to ${ac.stand ? 'gate ' + ac.stand.ref : 'the ramp'}.`);
}

function startTaxi(ac, r, purpose) {
    ac.route = r; ac.s = 0; ac.purpose = purpose; ac.state = 'taxi'; ac.holdPos = false; ac.crossReq = null;
    ac.spd = Math.max(ac.spd, 0);
}

/** Onto the runway from the holding point, then line up and wait or roll. */
/* ---- No radar (IFATC 3.3): with Approach closed, Tower takes the inbounds ---- */

const noRadar = () => !!G && G.rules.id === 'ifatc' && G.opts.radar === 'none' && !G.positions.has('APP');
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
    const endOf = a => a.appr?.end || a.pattern?.end || a.expect;
    const left = a => a.appr?.loc ? a.appr.along
        : a.pattern ? a.pattern.pts.reduce((t, p, i, arr) => t + Math.hypot(p.x - (i ? arr[i - 1].x : a.x), p.y - (i ? arr[i - 1].y : a.y)), 6.5)
        : Math.hypot(a.x, a.y) + 10;
    const e = endOf(ac);
    const q = G.aircraft.filter(a => a.kind === 'arr' && a.state === 'air' && a.freq === 'TWR' && endOf(a) && sameRunwayish(endOf(a), e)).sort((a, b) => left(a) - left(b));
    return q.indexOf(ac) + 1;
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
                const e = ac.pattern.end, g = finalGeom(ac, e);
                ac.appr = { end: e, loc: false, gs: false, est: false, along: g.along, xt: g.xt, spd: null };
                ac.tHdg = norm(e.course - Math.sign(g.xt || 1) * Math.min(30, Math.max(10, Math.abs(g.xt) * 60)));
                ac.pattern = null;
            }
        }
        return;
    }
    const d = Math.hypot(ac.x, ac.y);
    if (d > 8) { if (!ac.orbit) { ac.tHdg = brg(-ac.x, -ac.y); ac.turn = null; } return; }
    if (!ac.noEntryFlagged) {
        ac.noEntryFlagged = true;
        violation(ac, 'IFATC 3.3.2', `${ac.cs} reached the pattern without a pattern entry`);
        pilot(ac, `Tower, ${ac.radio}, 8 miles out, request pattern entry, we'll orbit here.`);
    }
    if (!ac.orbit) ac.orbit = { dir: 'L', rem: 360 };
}

/** A departure checks in with Departure (Approach). */
function departureCheckIn(ac) {
    ac.freq = 'APP';
    if (noRadar()) return;                         // no Departure on: it's on its own navigation
    pilot(ac, `${G.world.icao} Departure, ${ac.radio}, ${fmtAlt(Math.round(Math.max(ac.alt, G.world.elev + 500) / 100) * 100)} climbing ${fmtAlt(ac.tAlt)}.`);
    atc(`${ac.radio}, ${G.world.icao} Departure, radar contact.`, !G.positions.has('APP'));
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
    ac.tAlt = Math.max(G.world.minAlt, Math.ceil((G.world.elev + 3000) / 1000) * 1000, mvaCeilingWithin(4), terrainOn() ? Math.ceil(maxMvaAlong(ac, ahead) / 1000) * 1000 : 0);
    // No radar: it stays with Tower and needs a new pattern entry (IFATC 3.3).
    if (noRadar()) Object.assign(ac, { pattern: null, noEntryFlagged: false });
    else if (ac.freq === 'TWR') ac.freq = 'APP';
    ac.tSpd = 210;
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
            pilot(ac, `${G.world.icao} Approach, ${ac.radio}, request ${deg} degrees ${dir === 'L' ? 'left' : 'right'} for weather.`);
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
            pilot(ac, `${G.world.icao} Ground, ${ac.radio}, gate ${ac.stand.ref}, information ${PHONETIC[G.atis]}, ready to push.`);
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
        // Brake to turn-off speed by the exit.
        const vmax = Math.sqrt(Math.max(0, 2 * (3 / 3600) * left)) * 3600 + 15;
        ac.spd = Math.max(15, Math.min(ac.spd - 3 * dt, vmax));
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
    let want = TAXI_KT;
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
        pilot(ac, `${G.world.icao} Tower, ${ac.radio}, approaching runway ${ac.rwy.id}, ready for departure.`);
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

const PROG_SAY = { L: 'turn left next taxiway', R: 'turn right next taxiway', S: 'continue straight ahead', 180: 'make a 180' };

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
        parts.push(`follow ${o.radio}`); back.push(`following ${o.radio}`);
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

function aiControl() {
    if (G.opts.emerg) emergencyCheck();
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
    const gap = pref === 'gaps' || (pref === 'auto' && waiting >= 2) ? 3 : 0;
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
            ask('TWR', 'APP', `I've got ${q.holding} departures holding for ${q.e.id}. Can you give me a 6-mile gap on final?`, [
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
    if (noRadar() && ac.kind === 'arr' && ac.state === 'air' && !ac.appr && !ac.pattern && Math.hypot(ac.x, ac.y) < 15) {
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
        const score = t + (e === ac.expect ? -20 : 0) + (inner ? 900 : 0);
        // Never turn in across another final when there's any runway that avoids it.
        if (!best || (best.inner && !inner) || (best.inner === inner && score < best.score)) best = { e, f, side, P, eta, score, inner };
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
    if (ac.state !== 'air') return;
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
    if (ai(ac, { hdg, ils: plan.e, alt: plan.f.joinAlt, spd: 180 })) plan.phase = 'final';
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
    if (!ac.aiTurned && ac.alt >= aboveFinals - 300 && ac.alt >= maxMvaAlong(ac, ac.gate) - 500 && !(ac.aiCeil && ac.aiConflict)) {
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
    const movable = a => !mine(a) && a.freq === 'APP' && !a.appr && a.aiPlan?.phase !== 'hold';
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
            const wantDep = waiting < 3 && Math.random() < 0.45;
            ok = wantDep ? spawnDeparture() || spawnArrival() : spawnArrival() || spawnDeparture();
        }
        const ramp = Math.max(0.55, 1 - (G.t / 5400) * 0.45);
        G.nextSpawn = G.t + (ok ? cfg.gap * ramp * rand(0.7, 1.3) : 15);
    }

    if (G.t >= G.nextWind) shiftWind();

    if (noRadar()) for (const ac of G.aircraft) if (ac.kind === 'arr' && ac.state === 'air' && ac.freq === 'TWR' && !ac.appr) patternNav(ac);
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
    G.active = computeActive(G.world, G.wind);
    G.atis = (G.atis + 1) % 26;
    G.altim = clamp(G.altim + Math.round(rand(-3, 3)), 2950, 3050);
    G.met = makeMet();
    if (G.active.key === prev) {
        sys(`Information ${PHONETIC[G.atis]} is current: wind ${hdg3(G.wind.dir)} at ${G.wind.spd}, altimeter ${G.altim}.`);
        return;
    }
    sys(`Information ${PHONETIC[G.atis]}: wind ${hdg3(G.wind.dir)} at ${G.wind.spd}, altimeter ${G.altim}. Runway change — landing ${G.active.arr.map(e => e.id).join(', ')}, departing ${G.active.dep.map(e => e.id).join(', ')}.`, 'good');
    toast(`Runway change: ${G.active.arr.map(e => e.id).join(' / ')}`, 'good');
    for (const ac of G.aircraft) {
        if (noRadar() && ac.kind === 'arr' && ac.freq === 'TWR' && ac.state === 'air' && (ac.pattern || ac.landClr || ac.appr) && !G.active.arr.includes((ac.appr || ac.pattern || {}).end)) {
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
                pilot(ac, `${G.world.icao} Ground, ${ac.radio}, we'll need new taxi instructions for runway ${ac.rwy.id}.`);
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
    } else if (ac.via && !(ac.kind === 'dep' && agl(ac) < 400)) {
        viaStep(ac);
    }
    if (ac.orbit) {
        const turn = TURN_RATE * dt;
        ac.hdg = norm(ac.hdg + (ac.orbit.dir === 'L' ? -1 : 1) * turn);
        if ((ac.orbit.rem -= turn) <= 0) ac.orbit = null;
    } else {
        // Departures fly runway heading until 400 ft.
        const target = ac.kind === 'dep' && agl(ac) < 400 ? ac.rwy.course : ac.tHdg;
        let d = diff(ac.hdg, target);
        if (ac.turn === 'L' && d > 0) d -= 360;
        if (ac.turn === 'R' && d < 0) d += 360;
        const maxTurn = TURN_RATE * dt;
        if (Math.abs(d) <= maxTurn) { ac.hdg = norm(target); if (target === ac.tHdg) ac.turn = null; }
        else ac.hdg = norm(ac.hdg + Math.sign(d) * maxTurn);
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
        else if (ac.appr.spd != null) tSpd = ac.appr.spd;
        else tSpd = al > 15 ? Math.min(ac.tSpd, 210) : al > 8 ? 180 : 160;
    }
    if (ac.holdAt) tSpd = Math.min(tSpd, ac.alt <= 6000 ? 200 : ac.alt <= 14000 ? 230 : 265);  // holding speeds
    const maxClimb = rate / 60 * dt;
    ac.alt += clamp(tAlt - ac.alt, -maxClimb, maxClimb);

    // ---- speed: 250 below 10,000 (14 CFR 91.117)
    if (ac.alt < 10000 && tSpd > 250) tSpd = 250;
    const ds = tSpd - ac.spd;
    ac.spd += clamp(ds, -1.5 * dt, 2 * dt);

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
        const radius = tas / 3600 / (TURN_RATE * D2R);
        const lead = radius * (1 - Math.cos(Math.min(Math.abs(ia), 90) * D2R)) + 0.1;
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
        ac.freq = 'TWR';
        // Approach hands it to the tower; you are both, so the call comes straight to you.
        pilot(ac, `${G.world.icao} Tower, ${ac.radio}, ${Math.max(1, Math.round(g.along))} mile final runway ${e.id}.`);
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
            const visual = noRadar() && a.freq === 'TWR' && b.freq === 'TWR';
            if (!sameFinal && dz >= (visual ? 500 : SEP_FT - 25)) continue;              // 1,000 ft vertical (5-5-5)
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d >= 8) continue;
            const req = visual ? { nm: 1, why: 'pattern traffic (no radar)' } : requiredSep(a, b);
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
        const [ax, ay] = toS(drag.ac.x, drag.ac.y);
        c.strokeStyle = COLORS.sel;
        c.setLineDash([4, 4]);
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(drag.px, drag.py); c.stroke();
        c.setLineDash([]);
        c.font = '700 13px "JetBrains Mono", monospace';
        c.fillStyle = COLORS.sel;
        c.fillText(hdg3(drag.hdg), drag.px + 10, drag.py - 10);
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
    const col = a === G.selected ? COLORS.sel : base;
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
    const col = a.conflict || a.lowAlt || a.emerg ? COLORS.bad : a === G.selected ? COLORS.sel : base;

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
    const bx = x + 12, by = y - 20;
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
    if (a.appr) return (a.appr.loc ? 'LOC ' : 'ILS ') + a.appr.end.id + (a.landClr ? ' CL' : '') + (a.appr.loc ? ' ' + a.appr.along.toFixed(1) : '');
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
        const ac = G && hitAircraft(sx, sy);
        if (ac) select(ac);
        const gnd = ac && G.ground && ac.state !== 'air' && ac.state !== 'roll';
        // Headings only for aircraft in the air; on the ground it's taxiing (or, with no taxi map, the runway).
        const twr = ac && !G.ground && (ac.state === 'wait' || ac.state === 'luaw');
        drag = { id: e.pointerId, mode: gnd ? 'gnd' : ac && ac.state === 'air' ? 'ac' : twr ? 'twr' : ac ? 'sel' : 'pan', ac, sx, sy, px: sx, py: sy, moved: false, hdg: null, vx: view.x, vy: view.y };
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
        if (Math.hypot(sx - drag.sx, sy - drag.sy) > 8) drag.moved = true;
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
        if (e.type === 'pointercancel') return;
        if (d.mode === 'gnd' && d.moved) {
            dropGround(d.ac, d.tgt);
            renderCard(true);
        } else if ((d.mode === 'ac' || d.mode === 'twr') && d.moved && d.air) {
            if (!d.air.err) issue(d.ac, d.air.cmd); else sys(`${d.ac.cs}: ${d.air.label}.`);
            syncPending(true); renderCard(true);
        } else if (d.mode === 'ac' && d.moved && d.hdg != null) {
            issue(d.ac, { hdg: d.hdg });
            syncPending(true);
        } else if (d.mode === 'pan' && !d.moved) {
            const f = hitFix(d.sx, d.sy);
            if (f && G.selected && G.selected.state !== 'roll') { issue(G.selected, { direct: f }); syncPending(true); }
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

const pending = { hdg: null, alt: null, spd: null, dirty: { hdg: false, alt: false, spd: false } };
let cardKey = '';

function select(ac) {
    G.selected = ac;
    syncPending(true);
    renderCard(true);
    renderStrips();
}

function syncPending(force) {
    const ac = G.selected;
    if (!ac) return;
    for (const k of ['hdg', 'alt', 'spd']) {
        if (force || !pending.dirty[k]) {
            pending[k] = k === 'hdg' ? Math.round(ac.tHdg) : k === 'alt' ? ac.tAlt : Math.round(ac.tSpd);
            pending.dirty[k] = false;
        }
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
    else if (ac.via) { const nx = ac.via.legs.slice(ac.via.i).find(l => l.name); lat = `${ac.via.kind === 'STAR' ? 'descending via' : 'climbing via'} ${ac.via.id}${nx ? ' > ' + nx.name : ''}${ac.via.vert ? '' : ' (altitude assigned)'}`; }
    if (ac.appr) {
        const ap = ac.appr;
        lat = ap.loc ? `on the localizer ${ap.end.id} · ${ap.along.toFixed(1)} nm${ac.landClr ? ' · cleared to land' : ' · needs landing clearance'}` : `cleared ILS ${ap.end.id} · ${Math.abs(ap.xt).toFixed(1)} nm ${ap.xt > 0 ? 'right' : 'left'} of course`;
    } else if (ac.kind === 'arr' && ac.expect) lat += ` · expecting ${ac.expect.id}`;
    const tail = ac.kind === 'dep' ? ` · exit ${ac.gate.name} at ${alt3(exitAlt(ac))}+` : '';
    return `${alt} · ${Math.round(ac.spd)} kt · ${lat}${tail}`;
}

function renderCard(force) {
    const el = $('#card');
    const ac = G && G.selected;
    el.hidden = !ac;
    $('#scope-wrap').classList.toggle('info-open', !!ac);
    if (!ac) { cardKey = 'none'; el.innerHTML = ''; return; }
    const key = `${ac.id}|${ac.state}|${G.active.key}|${!!ac.appr}|${!!ac.appr?.loc}|${!!ac.landClr}|${!!ac.wxReq}|${!!ac.crossReq}|${!!ac.holdPos}|${ac.freq}|${!!ac.called}|${!!ac.toTower}|${!!ac.toGround}|${ac.purpose}|${!!ac.prog}|${ac.preClr}|${!!ac.via}|${!!ac.viaSaved}|${ac.pattern?.kind}${ac.pattern?.end.id}|${ac.route?.crossings.filter(x => x.cleared).length}`;
    if (!force && key === cardKey) { updateCard(); return; }
    cardKey = key;
    const ground = ac.state !== 'air';
    const surface = ['gate', 'push', 'pushed', 'taxi', 'clear', 'rollout', 'lineup'].includes(ac.state) || ac.state === 'wait' && ac.freq === 'GND';
    const yours = mine(ac);
    const twr = G.positions.has('TWR');
    const groundBtns = [
        ac.state === 'gate' && ac.kind === 'dep' && ac.called ? `<button class="btn primary" data-act="push">Pushback approved</button>` : '',
        ac.state === 'pushed' ? `<button class="btn primary" data-act="taxi">Taxi to runway ${ac.rwy.id}</button>` : '',
        ac.state === 'clear' && ac.freq === 'GND' ? `<button class="btn primary" data-act="taxi">Taxi to ${ac.stand ? 'gate ' + ac.stand.ref : 'a gate'}</button>` : '',
        ac.kind === 'dep' && ac.freq === 'GND' && (ac.state === 'wait' || ac.state === 'taxi' && ac.purpose === 'runway' && !ac.toTower)
            ? `<button class="btn${ac.state === 'wait' ? ' primary' : ''}" data-act="tower">Contact Tower${ac.state === 'wait' ? '' : ' when ready'}</button>` : '',
        ac.kind === 'arr' && ac.freq === 'TWR' && (ac.state === 'clear' || !ac.toGround && (ac.state === 'rollout' || ac.state === 'taxi'))
            ? `<button class="btn${ac.state === 'clear' ? ' primary' : ''}" data-act="ground">Contact Ground</button>` : '',
        (ac.state === 'taxi' || ac.state === 'push') && !ac.holdPos ? `<button class="btn" data-act="holdPos">Hold position</button>` : '',
        ac.holdPos ? `<button class="btn primary" data-act="cont">Continue taxi</button>` : '',
    ].join('');
    const nextCross = ac.crossReq || (ac.state === 'taxi' && ac.route?.crossings.find(x => !x.cleared));
    const crossBtn = nextCross && G.positions.has(crossOwner(ac))
        ? `<div class="btn-row"><button class="btn${ac.crossReq ? ' primary' : ''}" data-act="cross">Cross runway ${crossName(nextCross)}${ac.crossReq ? '' : ' (ahead)'}</button></div>` : '';
    // Progressive taxi and give way (IFATC 2.2.1, 2.2.5), for whoever's on Ground and moving or ready to.
    const gndMoving = G.ground && ac.freq === 'GND' && yours && (['pushed', 'clear'].includes(ac.state) || ac.state === 'taxi' && ac.purpose !== 'exit');
    const nearby = gndMoving ? G.aircraft.filter(o => o !== ac && isSurface(o) && o.state !== 'gate' && Math.hypot(o.x - ac.x, o.y - ac.y) < 0.8) : [];
    const progBtns = gndMoving ? `
        <div class="btn-row">
            <button class="btn" data-prog="L">↰ Left next</button><button class="btn" data-prog="S">↑ Straight</button><button class="btn" data-prog="R">Right next ↱</button><button class="btn" data-prog="180">180</button>
        </div>
        <div class="btn-row">
            ${ac.prog ? `<button class="btn primary" data-act="discretion">Continue at your discretion</button>` : `<button class="btn" data-act="expectProg">Expect progressive taxi</button>`}
        </div>
        ${picker('giveWay', 'Give way to…', nearby.map(o => [String(o.id), o.cs, typeTag(o)]))}
        ${picker('follow', 'Follow…', nearby.filter(o => o.state === 'taxi').map(o => [String(o.id), o.cs, typeTag(o)]))}` : '';
    const inbound = noRadar() && ac.kind === 'arr' && !ground && ac.freq === 'TWR' && !ac.appr?.loc;
    const ilsBtns = ac.kind === 'arr' && !ground
        ? (inbound ? '' : G.active.arr.map(e => `<button class="btn ils" data-ils="${e.id}">ILS ${e.id}</button>`).join(''))
          + ((ac.appr?.loc || (noRadar() && ac.pattern)) && !ac.landClr ? `<button class="btn primary" data-act="land">Cleared to land ${(ac.appr || ac.pattern).end.id}</button>` : '')
          + (ac.appr ? `<button class="btn warn" data-act="ga">Go around</button>` : '')
        : '';
    const others = G.world.ends.filter(e => !G.active.arr.includes(e));
    const fixList = G.world.fixes.filter(f => f.kind !== 'app' || G.active.arr.includes(f.end));
    // Tap-to-pick lists (no dropdowns or typing): a heading, then a grid of chips.
    const picker = (act, title, items) => items.length ? `<details class="pick"><summary>${title}</summary><div class="chips">${items.map(([v, label, sub]) =>
        `<button type="button" class="chip-btn" data-pick="${act}" data-v="${escapeHtml(v)}">${escapeHtml(label)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</button>`).join('')}</div></details>` : '';
    const fixItems = fixList.slice().sort((a, b) => Math.hypot(a.x - ac.x, a.y - ac.y) - Math.hypot(b.x - ac.x, b.y - ac.y)).slice(0, 24)
        .map(f => [f.name, f.name, f.kind === 'arr' ? 'entry' : f.kind === 'dep' ? 'exit' : f.kind === 'wp' ? Math.round(Math.hypot(f.x - ac.x, f.y - ac.y)) + ' mi' : 'final ' + f.end.id]);
    el.innerHTML = `
        <div class="info-h"><span style="flex:1">INFORMATION</span><button class="info-x" data-act="close" aria-label="Close">✕</button></div>
        <div class="card-head">
            <span class="cs">${ac.cs}</span>
            <span class="badge ${ac.kind}">${ac.kind === 'arr' ? 'Arrival' : 'Departure'}</span>
            <span class="radio">${ac.radio} · ${typeTag(ac)}</span>
        </div>
        <div class="card-status" id="card-status"></div>
        ${crossBtn}
        ${yours && inbound ? `<div class="btn-row"><button class="btn" data-act="contInbound">Continue inbound</button><button class="btn" data-act="seqLand">Number ${landingNumber(ac)}</button></div>
            ${picker('entry', ac.pattern ? `Pattern entry (now ${PATTERN_SAY[ac.pattern.kind]} ${ac.pattern.end.id})…` : 'Pattern entry…', G.active.arr.flatMap(e => Object.keys(PATTERN_SAY).map(k => [k + '|' + e.id, PATTERN_SAY[k], e.id])))}` : ''}
        ${yours && ac.state === 'taxi' && ac.purpose === 'runway' && ac.freq === 'TWR' ? (ac.preClr ? `<div class="card-empty">${ac.preClr === 'roll' ? 'Cleared for takeoff' : 'Line up and wait'} when it reaches the runway.</div>` : `<div class="btn-row">
            <button class="btn" data-act="luaw">Line up and wait</button><button class="btn" data-act="immediate">Immediate takeoff</button>
            <button class="btn primary" data-act="takeoff">Cleared for takeoff ${ac.rwy.id}</button></div>`) : ''}
        ${yours && (ac.state === 'roll' || (ac.state === 'lineup' && ac.lineupThen === 'roll')) ? `<div class="btn-row"><button class="btn warn" data-act="cancelTO">Cancel takeoff clearance</button></div>` : ''}
        ${progBtns}
        ${!yours ? `<div class="card-empty">The system is working ${FREQ_NAME[ac.freq]}. It will reach your frequency when it's handed off.</div>` : surface ? (groundBtns ? `<div class="btn-row">${groundBtns}</div>` : '') : `
        ${ac.wxReq ? `<div class="btn-row"><button class="btn primary" data-act="dev">Approve ${ac.wxReq.deg}° ${ac.wxReq.dir === 'L' ? 'left' : 'right'} for weather</button></div>` : ''}
        ${ground ? '' : `<div class="row"><label>Heading</label><div class="stepper">
            <button data-adj="hdg:-10">−10</button><button data-adj="hdg:-5">−5</button>
            <span class="val" id="p-hdg"></span>
            <button data-adj="hdg:5">+5</button><button data-adj="hdg:10">+10</button></div></div>`}
        <div class="row"><label>Altitude</label><div class="stepper">
            <button data-adj="alt:-1000">−1000</button>
            <span class="val" id="p-alt"></span>
            <button data-adj="alt:1000">+1000</button></div></div>
        <div class="row"><label>Speed</label><div class="stepper">
            <button data-adj="spd:-10">−10</button>
            <span class="val" id="p-spd"></span>
            <button data-adj="spd:10">+10</button></div></div>
        ${ground ? '' : `<div class="btn-row"><button class="btn" data-act="slowest">Slowest practical speed</button></div>`}
        <div class="send-row">
            <button class="btn primary" data-act="send">Transmit ⏎</button>
            <button class="btn" data-act="reset">Reset</button>
        </div>
        ${ac.kind === 'dep' && ac.state === 'air' && ac.freq === 'TWR' ? `<div class="btn-row"><button class="btn primary" data-act="freqChange">Frequency change approved</button></div>` : ''}
        ${ac.state === 'wait' ? `<div class="btn-row">
            <button class="btn" data-act="holdShort">Hold short</button>
            ${departureNumber(ac) > 1 ? `<button class="btn" data-act="seqNo">Number ${departureNumber(ac)} for departure</button>` : ''}</div>` : ''}
        ${ac.state === 'wait' || ac.state === 'luaw' || (ac.state === 'taxi' && ac.purpose === 'runway' && ac.freq === 'TWR' && !ac.preClr) ? `<div class="btn-row">
            ${ac.state !== 'luaw' ? `<button class="btn" data-act="luaw">Line up and wait</button>` : ''}
            <button class="btn" data-act="immediate">Immediate takeoff</button>
            <button class="btn primary" data-act="takeoff">Cleared for takeoff ${ac.rwy.id}</button></div>` : ''}
        ${ilsBtns ? `<div class="btn-row">${ilsBtns}</div>` : ''}
        ${!ground && (ac.viaSaved || (ac.via && !ac.via.vert)) ? `<div class="btn-row"><button class="btn" data-act="via">${ac.kind === 'arr' ? 'Descend via' : 'Climb via'} ${(ac.viaSaved || ac.via).id}</button></div>` : ''}
        ${!ground ? `
        ${picker('direct', 'Direct to…', fixItems)}
        ${ac.kind === 'arr' ? picker('ils-other', 'Other ILS…', others.map(e => [e.id, 'ILS ' + e.id])) : ''}
        ${picker('hold', 'Hold at…', fixItems)}
        <div class="btn-row">
            <button class="btn" data-act="orbitL">Left 360</button>
            <button class="btn" data-act="orbitR">Right 360</button>
        </div>` : ''}`}`;
    updateCard();
}

function updateCard() {
    const ac = G.selected;
    if (!ac) return;
    $('#card-status').textContent = statusText(ac);
    if (!$('#p-alt')) return;
    const set = (k, txt) => { const v = $('#p-' + k); if (v) { v.textContent = txt; v.classList.toggle('dirty', pending.dirty[k]); } };
    set('hdg', hdg3(pending.hdg));
    set('alt', pending.alt.toLocaleString('en-US'));
    set('spd', String(pending.spd));
}

/** The card's changed values, plus anything extra, as one transmission. */
function transmitPending(extra) {
    const ac = G.selected;
    if (!ac) return;
    const c = { ...(extra || {}) };
    if (pending.dirty.hdg) c.hdg = pending.hdg;
    if (pending.dirty.alt) c.alt = pending.alt;
    if (pending.dirty.spd) c.spd = pending.spd;
    if (Object.keys(c).length) issue(ac, c);
    syncPending(true);
    renderCard(true);
}

function adjust(k, delta) {
    if (!G.selected) return;
    if (k === 'hdg' && G.selected.state !== 'air') return;
    if (k === 'hdg') pending.hdg = norm(pending.hdg + delta) || 360;
    if (k === 'alt') pending.alt = clamp(pending.alt + delta, G.world.minAlt, 24000);
    if (k === 'spd') pending.spd = clamp(pending.spd + delta, 160, 320);
    pending.dirty[k] = true;
    updateCard();
}

function bindCard() {
    const el = $('#card');
    el.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b || !G.selected) return;
        const ac = G.selected;
        if (b.dataset.act === 'close') { select(null); return; }
        if (b.dataset.pick) {
            const v = b.dataset.v, act = b.dataset.pick;
            if (act === 'direct' || act === 'hold') issue(ac, { [act === 'direct' ? 'direct' : 'holdFix']: G.world.fixes.find(f => f.name === v) });
            else if (act === 'ils-other') { transmitPending({ ils: findEnd(v) }); return; }
            else if (act === 'giveWay' || act === 'follow') { const o = G.aircraft.find(a => a.id === Number(v)); if (o) issue(ac, { [act]: o }); }
            else if (act === 'entry') { const [kind, id] = v.split('|'); issue(ac, { entry: { kind, end: findEnd(id) } }); }
            syncPending(true); renderCard(true);
            return;
        }
        if (b.dataset.prog) { issue(ac, { prog: b.dataset.prog }); renderCard(true); return; }
        if (b.dataset.act === 'discretion' || b.dataset.act === 'expectProg') { issue(ac, { [b.dataset.act]: true }); renderCard(true); return; }
        if (b.dataset.adj) { const [k, v] = b.dataset.adj.split(':'); adjust(k, Number(v)); return; }
        if (b.dataset.ils) { transmitPending({ ils: findEnd(b.dataset.ils) }); return; }
        const act = b.dataset.act;
        if (act === 'send') transmitPending();
        else if (act === 'reset') { syncPending(true); updateCard(); }
        else if (act === 'takeoff') transmitPending({ takeoff: true });
        else if (act === 'luaw') transmitPending({ luaw: true });
        else if (act === 'dev') { issue(ac, { deviate: true }); renderCard(true); }
        else if (['push', 'taxi', 'holdPos', 'cont', 'cross', 'tower', 'ground'].includes(act)) { issue(ac, { [act]: true }); renderCard(true); }
        else if (act === 'land') { issue(ac, { land: true }); renderCard(true); }
        else if (act === 'cancelTO') { issue(ac, { cancelTO: true }); renderCard(true); }
        else if (['freqChange', 'holdShort', 'seqNo', 'contInbound', 'seqLand', 'via'].includes(act)) { issue(ac, { [act]: true }); renderCard(true); }
        else if (act === 'immediate') transmitPending({ immediate: true });
        else if (act === 'slowest') { issue(ac, { slowest: true }); syncPending(true); renderCard(true); }
        else if (act === 'ga') { issue(ac, { goAround: true }); syncPending(true); renderCard(true); }
        else if (act === 'orbitL' || act === 'orbitR') { issue(ac, { orbit: act === 'orbitL' ? 'L' : 'R' }); renderCard(true); }
    });
    el.addEventListener('change', e => {
        const s = e.target;
        if (!G.selected || !s.value) return;
        if (s.dataset.act === 'direct') issue(G.selected, { direct: G.world.fixes.find(f => f.name === s.value) });
        if (s.dataset.act === 'hold') issue(G.selected, { holdFix: G.world.fixes.find(f => f.name === s.value) });
        if (s.dataset.act === 'ils-other') { transmitPending({ ils: findEnd(s.value) }); return; }
        if (s.dataset.act === 'giveWay' || s.dataset.act === 'follow') {
            const o = G.aircraft.find(a => a.id === Number(s.value));
            if (o) issue(G.selected, { [s.dataset.act]: o });
        }
        renderCard(true);
    });
}

/** A pilot waiting on you for something: the (1) on the strip's ATC cell. */
function wantsYou(a) {
    return !!(a.emerg || a.crossReq || a.wxReq || a.lowAlt
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
        + `ARR <b>${G.active.arr.map(e => e.id).join(' ')}</b><br>`
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
    syncPending(true);
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
            syncPending(false);
        }
    }
    requestAnimationFrame(frame);
}

function setSpeed(s) {
    G.speed = s;
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
    $('#coord').addEventListener('click', e => { const b = e.target.closest('[data-ans]'); if (b && G) answer(Number(b.dataset.ans)); });
    // The airport info box folds away to one line. On pointerdown: the box is redrawn several times a second.
    $('#hud').addEventListener('pointerdown', e => {
        if (!e.target.closest('.hud-tog') || !G) return;
        e.preventDefault();
        hudMin = !hudMin;
        store.set('hudMin', hudMin);
        renderHud();
    });
    $('#speed').addEventListener('click', e => { const b = e.target.closest('button'); if (b && G) setSpeed(Number(b.dataset.speed)); });
    const voice = $('#voice');
    voice.classList.toggle('on', voiceOn);
    if (!('speechSynthesis' in window)) voice.hidden = true;
    voice.onclick = () => {
        voiceOn = !voiceOn;
        store.set('voice', voiceOn);
        voice.classList.toggle('on', voiceOn);
        if (!voiceOn) try { speechSynthesis.cancel(); } catch { /* none */ }
    };
    $('#end').onclick = () => { if (G && !G.over) endShift(); };
    const icons = $('#icons');
    const showIcons = () => { icons.textContent = iconMode ? 'Aircraft' : 'Targets'; icons.classList.toggle('on', iconMode); };
    showIcons();
    icons.onclick = () => { iconMode = !iconMode; store.set('icons', iconMode); showIcons(); };
    $('#zoom-field').onclick = () => { if (!G) return; view.x = 0; view.y = 0; view.scale = Math.min(view.w, view.h) / 2 / fieldRadius(); };
    const style = $('#style');
    const showStyle = () => { style.textContent = mapStyle === 'chart' ? 'Chart' : 'Radar'; style.classList.toggle('on', mapStyle === 'chart'); };
    showStyle();
    style.onclick = () => {
        mapStyle = mapStyle === 'chart' ? 'radar' : 'chart';
        COLORS = PALETTE[mapStyle];
        store.set('style', mapStyle);
        showStyle();
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
        } else if (G.selected) {
            if (k === 'ArrowLeft') { e.preventDefault(); adjust('hdg', e.shiftKey ? -10 : -5); }
            else if (k === 'ArrowRight') { e.preventDefault(); adjust('hdg', e.shiftKey ? 10 : 5); }
            else if (k === 'ArrowUp') { e.preventDefault(); adjust('alt', 1000); }
            else if (k === 'ArrowDown') { e.preventDefault(); adjust('alt', -1000); }
            else if (k === 'Enter') { e.preventDefault(); transmitPending(); }
        }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && G && G.speed > 0 && !G.over) togglePause(); });
}

// Folded by default on short (sideways phone) screens, where the scope has little room.
let hudMin = store.get('hudMin', typeof matchMedia === 'function' && matchMedia('(max-height: 540px)').matches);
let opts = { terrain: store.get('terrain', false), weather: store.get('weather', false), positions: store.get('positions', ['APP', 'TWR']),
    start: store.get('start', 'random'), startN: store.get('startN', 6), emerg: store.get('emerg', true), rules: store.get('rules', 'faa'), radar: store.get('radar', 'system') };

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
    $('#start').hidden = true;
    document.body.classList.add('in-game');
    $('#game').hidden = false;
    window.scrollTo(0, 0);
    $('#summary').hidden = true;
    $('#log').innerHTML = '';
    nextId = 1;
    // Real waypoints and procedures for US fields (nav/<ICAO>.json, built by tools/build-nav.mjs).
    const nav = await loadNav(airport.icao);
    newGame(airport, level, { ...opts }, nav);
    const game = G;
    renderLayers();
    renderAsk();
    loading.clear(); busy('', null);
    // Only this shift's loading reaches the badge.
    const step = (id, text) => { if (G === game) busy(id, text); };
    fitView();
    resetView();
    cardKey = '';
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
let level = store.get('level', 'normal');

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
    $('#radar-row').hidden = $('#radar-h').hidden = opts.rules !== 'ifatc' || opts.positions.includes('APP');
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
    const yours = ['APP', 'TWR', 'GND'].filter(f => opts.positions.includes(f)), theirs = ['APP', 'TWR', 'GND'].filter(f => !opts.positions.includes(f));
    $('#pos-summary').textContent = `You'll work ${names(yours)}.` + (theirs.length ? ` The system works ${names(theirs)}.` : ' The whole airport is yours.');
    $('#go').disabled = !chosen;
    $('#go-note').textContent = chosen ? `${chosen.icao} — ${chosen.name}` : 'Choose an airport to start.';
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
    for (const k of ['terrain', 'weather', 'emerg']) {
        $('#opt-' + k).addEventListener('click', e => {
            const b = e.target.closest('button');
            if (!b) return;
            opts[k] = b.dataset.v === 'on';
            renderStart();
        });
    }
    $('#go').onclick = () => { if (chosen) startGame(chosen, level); };

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
    window.approach = { get G() { return G; }, tick, issue, runCommand, findEnd, startGame, get DATA() { return DATA; }, toS, render: () => renderHud() };
}

init();
