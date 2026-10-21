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
import { buildGround, nearestNode, route, withCrossings, pointAt } from './approachGround.js';
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
const wakeNm = (lead, follow) => (WAKE_NM[lead.perf.wake] || {})[follow.perf.wake] || 0;
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
function buildWorld(p) {
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
    return {
        icao: p.icao, name: p.name, elev, ends, fixes, minAlt, proj, lat: p.lat, lon: p.lon,
        exitAlt: Math.max(9000, Math.ceil((elev + 6000) / 1000) * 1000),
    };
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

function newGame(airport, level, opts) {
    const world = buildWorld(airport);
    const wind = { dir: Math.round(rand(0, 36)) * 10 || 360, spd: Math.round(rand(5, opts.weather ? 22 : 18)) };
    G = {
        world, wind, level, opts, airport,
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
    if (opts.weather) for (let i = 0; i < 4; i++) spawnCell(true);
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

function spawnArrival() {
    const id = makeCallsign();
    if (!id) return false;
    const entries = G.world.fixes.filter(f => f.kind === 'arr').sort(() => Math.random() - 0.5);
    for (const f of entries) {
        const r = SCOPE_NM - 0.5;
        const x = Math.sin(f.bearing * D2R) * r, y = Math.cos(f.bearing * D2R) * r;
        let alt = Math.round((G.world.elev + rand(8000, 12500)) / 1000) * 1000;
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
        G.aircraft.push(ac);
        pilot(ac, `${G.world.icao} Approach, ${ac.radio}, ${fmtAlt(alt)}, information ${PHONETIC[G.atis]}.`);
        atc(`${ac.radio}, ${G.world.icao} Approach, altimeter ${G.altim}, expect ILS runway ${ac.expect.id} approach.`);
        return true;
    }
    return false;
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
    const rwy = nextDepRunway();
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
        Object.assign(ac, { state: 'gate', stand, x: stand.x, y: stand.y, hdg: brg(stand.x - n.x, stand.y - n.y), freq: 'GND', readyAt: G.t + rand(5, 60), called: false });
        G.aircraft.push(ac);
        return true;
    }
    G.aircraft.push(ac);
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
    div.textContent = text;
    log.appendChild(div);
    while (log.children.length > 80) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
}
function atc(text, ai) { logLine(ai ? 'ai' : 'atc', text); }
function sys(text, tone) { logLine(tone || 'sys', text); }
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
    if (a.state === 'roll' || a.state === 'luaw' || a.state === 'lineup') return a.rwy.phys;
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
    const other = G.aircraft.find(a => a !== ac && onRunwayPhys(a) === phys);
    if (other) return `${other.cs} is on the runway`;
    if ((G.occupied.get(phys) || 0) > G.t) return 'the previous aircraft has not cleared it';
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
    sys(`${text} — ${rule}.`, 'bad');
}

function zuluAt(t) {
    const z = new Date(G.zulu0 + t * 1000);
    return String(z.getUTCHours()).padStart(2, '0') + String(z.getUTCMinutes()).padStart(2, '0');
}

/**
 * Apply one transmission to an aircraft. `c` may carry hdg/turn, alt, spd,
 * ils (runway end), direct (fix), holdFix (fix), orbit ('L'|'R'), luaw,
 * takeoff, land, goAround. Returns true when the pilot accepted it.
 */
function issue(ac, c) {
    if (!ac || ac.gone) return false;
    // Runway crossings are the tower's to give, whoever the aircraft is talking to.
    const owner = c.cross ? 'TWR' : ac.freq;
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
        ac.state = 'push'; ac.pushLeft = 40;
        parts.push('pushback approved'); back.push('pushing back');
    }
    if (c.taxi) {
        const r = c.taxi === true ? null : c.taxi;
        if (!taxiClearance(ac, r, parts, back)) return false;
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
        const cr = ac.crossReq;
        if (!cr) { sys(`${ac.cs} isn't waiting to cross a runway.`); return false; }
        cr.cleared = true; ac.crossReq = null;
        parts.push(`cross runway ${cr.label}`); back.push(`crossing ${cr.label}`);
    }

    // ---- things that stop the call before it is made
    if (c.luaw && ac.state !== 'wait') { sys(`${ac.cs} is not holding short.`); return false; }
    if (c.takeoff && ac.state !== 'wait' && ac.state !== 'luaw') { sys(`${ac.cs} is not at the runway.`); return false; }
    if (c.luaw && G.aircraft.some(a => a !== ac && a.state === 'luaw' && a.rwy.phys === ac.rwy.phys)) {
        sys(`Someone is already lined up on ${ac.rwy.id}.`); return false;
    }
    if (c.takeoff) {
        const why = runwayBlocker(ac);
        if (why) { sys(`Runway ${ac.rwy.id} is not clear: ${why} (7110.65 3-9-6).`, 'bad'); return false; }
    }
    if (c.land && !(ac.appr && ac.appr.loc)) { sys(`${ac.cs} isn't established on the final approach course yet.`); return false; }
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

    // ---- runway
    if (c.luaw) {
        startLineup(ac, 'luaw');
        parts.push(`runway ${ac.rwy.id}, line up and wait`);
        back.push(`line up and wait ${ac.rwy.id}`);
    }
    if (c.takeoff) {
        const w = departureWake(ac);
        if (w) violation(ac, '7110.65 3-9-6', `${ac.cs} rolled ${Math.round(w.since)} seconds after ${w.lead} (${WAKE_NAME[w.wake]}); the wake turbulence interval is ${w.need / 60} minutes`);
        if (ac.state === 'luaw') { ac.state = 'roll'; ac.hdg = ac.rwy.course; }
        else startLineup(ac, 'roll');
        if (mine(ac)) award(ac, 3);
        const runwayHdg = Math.abs(diff(ac.tHdg, ac.rwy.course)) < 3;
        const hdgPart = runwayHdg ? 'fly runway heading' : `fly heading ${hdg3(ac.tHdg)}`;
        parts.push(`${wind}, runway ${ac.rwy.id}, ${hdgPart}, cleared for takeoff`);
        back.push(`${runwayHdg ? 'runway heading' : 'heading ' + hdg3(ac.tHdg)}, cleared for takeoff ${ac.rwy.id}`);
    }
    if (c.land) {
        ac.landClr = true;
        parts.push(`${wind}, runway ${ac.appr.end.id}, cleared to land`);
        back.push(`cleared to land ${ac.appr.end.id}`);
    }

    if (!parts.length) return false;
    atc(`${ac.radio}, ${parts.join(', ')}.`, G.aiActing);
    pilot(ac, `${cap(back.join(', '))}, ${ac.radio}.`);
    return true;
}

/** Route a ground aircraft and read the route out: to its runway, or to a gate. */
function taxiClearance(ac, rwyId, parts, back) {
    const gr = G.ground;
    if (!gr) { sys('There is no taxiway map for this airport.'); return false; }
    if (ac.kind === 'dep') {
        if (ac.state === 'gate') { sys(`${ac.cs} needs pushback first.`); return false; }
        if (ac.state !== 'pushed') { sys(`${ac.cs} isn't ready to taxi.`); return false; }
        if (rwyId) {
            const e = findEnd(rwyId);
            if (!e) { sys('No such runway.'); return false; }
            ac.rwy = e;
        }
        const hold = gr.holds.get(ac.rwy);
        if (!hold) { sys(`No holding point found for runway ${ac.rwy.id}.`); return false; }
        const from = nearestNode(gr, ac);
        const r = from && route(gr, from.id, hold.node);
        if (!r) { sys(`No taxi route to runway ${ac.rwy.id} from here.`); return false; }
        r.pts.unshift({ x: ac.x, y: ac.y });
        withCrossings(gr, r);
        startTaxi(ac, r, 'runway');
        const hs = r.crossings.length ? `, hold short of runway ${r.crossings[0].label}` : '';
        parts.push(`runway ${ac.rwy.id}, taxi via ${r.names.join(', ') || 'the taxiway'}${hs}`);
        back.push(`runway ${ac.rwy.id}, via ${r.names.join(', ') || 'the taxiway'}${hs}`);
        return true;
    }
    if (ac.state !== 'clear') { sys(`${ac.cs} isn't clear of the runway yet.`); return false; }
    const stand = ac.stand || (ac.stand = freeStand());
    if (!stand) { sys('Every gate is taken.'); return false; }
    const from = nearestNode(gr, ac);
    const r = from && route(gr, from.id, stand.node);
    if (!r) { sys(`No taxi route to gate ${stand.ref}.`); return false; }
    r.pts.unshift({ x: ac.x, y: ac.y });
    r.pts.push({ x: stand.x, y: stand.y });
    withCrossings(gr, r);
    startTaxi(ac, r, 'gate');
    const hs = r.crossings.length ? `, hold short of runway ${r.crossings[0].label}` : '';
    parts.push(`taxi to gate ${stand.ref} via ${r.names.join(', ') || 'the taxiway'}${hs}`);
    back.push(`gate ${stand.ref} via ${r.names.join(', ') || 'the taxiway'}${hs}`);
    return true;
}

function startTaxi(ac, r, purpose) {
    ac.route = r; ac.s = 0; ac.purpose = purpose; ac.state = 'taxi'; ac.holdPos = false; ac.crossReq = null;
    ac.spd = Math.max(ac.spd, 0);
}

/** Onto the runway from the holding point, then line up and wait or roll. */
function startLineup(ac, then) {
    ac.lineupThen = then;
    if (!G.ground || !G.ground.holds.get(ac.rwy)) {
        Object.assign(ac, { x: ac.rwy.thr.x, y: ac.rwy.thr.y, hdg: ac.rwy.course });
        ac.state = then;
        return;
    }
    const hold = G.ground.holds.get(ac.rwy), c = ac.rwy.course * D2R;
    ac.lineupAt = { x: ac.rwy.thr.x + Math.sin(c) * hold.along, y: ac.rwy.thr.y + Math.cos(c) * hold.along };
    ac.state = 'lineup';
    ac.spd = 8;
}

/** A Super or Heavy left this runway (or a close parallel) too recently: 2 minutes, 3 behind a Super. */
function departureWake(ac) {
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
    ac.appr = null; ac.direct = null; ac.holdAt = null; ac.orbit = null; ac.turn = null; ac.landClr = false;
    if (e) ac.tHdg = e.course;
    // Missed approach: runway heading, climbing clear of the terrain along it, back to Approach for another go.
    const ahead = e ? { x: ac.x + Math.sin(e.course * D2R) * 15, y: ac.y + Math.cos(e.course * D2R) * 15 } : ac;
    ac.tAlt = Math.max(G.world.minAlt, Math.ceil((G.world.elev + 3000) / 1000) * 1000, mvaCeilingWithin(4), terrainOn() ? Math.ceil(maxMvaAlong(ac, ahead) / 1000) * 1000 : 0);
    if (ac.freq === 'TWR') ac.freq = 'APP';
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
        if (G.wx.length < 6) spawnCell(false);
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
const isSurface = a => ['gate', 'push', 'pushed', 'taxi', 'wait', 'lineup', 'luaw', 'clear', 'rollout'].includes(a.state);

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
        if (ac.holdPos) return true;
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
    case 'pushed': case 'clear':
        return true;
    case 'lineup': {
        const t = ac.lineupAt, d = Math.hypot(t.x - ac.x, t.y - ac.y), stepNm = 8 / 3600 * dt;
        if (d <= stepNm) {
            Object.assign(ac, { x: t.x, y: t.y, hdg: ac.rwy.course, state: ac.lineupThen, spd: 0 });
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
    let limit = cx ? Math.min(r.len, cx.stopS) : r.len;
    if (ac.holdPos) limit = ac.s;
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
        pilot(ac, `${G.world.icao} Tower, ${ac.radio}, holding short of runway ${cx.label}, request to cross.`);
    }
    if (ac.s >= r.len - 0.0005) arrive(ac);
}

/** End of a taxi route. */
function arrive(ac) {
    ac.spd = 0; ac.route = null;
    if (ac.purpose === 'runway') {
        Object.assign(ac, { state: 'wait', freq: 'TWR', hdg: brg(ac.rwy.thr.x - ac.x, ac.rwy.thr.y - ac.y), remindAt: G.t + 240 });
        if (G.positions.has('GND')) award(ac, 3);
        pilot(ac, `${G.world.icao} Tower, ${ac.radio}, holding short runway ${ac.rwy.id}, ready for departure.`);
    } else if (ac.purpose === 'exit') {
        const where = nearestNode(G.ground, ac);
        const twy = where && where.edges.find(e => e.name)?.name;
        ac.state = 'clear'; ac.freq = 'GND';
        ac.stand = ac.stand || freeStand();
        pilot(ac, `${G.world.icao} Ground, ${ac.radio}, clear of ${ac.landEnd.id}${twy ? ' at ' + twy : ''}, taxi to ${ac.stand ? 'gate ' + ac.stand.ref : 'the ramp'}.`);
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
    if (!G.positions.has('APP')) { aiConflicts(); aiTerrainNet(); }
    for (const ac of G.aircraft) {
        if (ac.gone) continue;
        if (ac.crossReq && !G.positions.has('TWR')) aiCross(ac);
        if (G.positions.has(ac.freq)) continue;
        if (ac.freq === 'APP') aiApproach(ac);
        else if (ac.freq === 'TWR') aiTower(ac);
        else if (ac.freq === 'GND') aiGround(ac);
    }
}

const ai = (ac, c) => issue(ac, { ...c, ai: true });

function aiGround(ac) {
    if (ac.state === 'gate' && ac.kind === 'dep' && ac.called) ai(ac, { push: true });
    else if (ac.state === 'pushed' || ac.state === 'clear') ai(ac, { taxi: true });
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
    if (ai(ac, { takeoff: true, hdg })) G.lastClr.set(phys, G.t);
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
    let t = eta;
    for (const x of q) t = Math.max(t, x.t + spacingSec(x.ac, ac));
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
        if (wxOnPath(ac, plan.P) && !wxOnPath(ac, other)) { plan.side = -plan.side; plan.P = other; }
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
            if (finalTooTight(ac, plan)) {
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

    for (const ac of G.aircraft) step(ac, dt);
    G.aircraft = G.aircraft.filter(a => !a.gone);
    if (G.selected && G.selected.gone) select(null);
    separation();
    terrainCheck();
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
            pilot(ac, ac.state === 'luaw' ? `Tower, ${ac.radio}, lined up and waiting on ${ac.rwy.id}.` : `Tower, ${ac.radio}, still holding short ${ac.rwy.id}.`);
        }
        return;
    }
    if (ac.state === 'roll') {
        ac.spd += 3.5 * dt;
        move(ac, dt);
        if (ac.spd >= p.vr) {
            ac.state = 'air';
            ac.alt = elev + 20;
            // Clear of the runway once airborne and past ~6,000 ft (7110.65 3-9-6).
            G.occupied.set(ac.rwy.phys, G.t + 5);
            G.lastDepAt.set(ac.rwy.phys, G.t);
            ac.freq = 'APP';
            if (p.wake === 'S' || p.wake === 'H') G.depWake.set(ac.rwy.phys, { t: G.t, cs: ac.cs, wake: p.wake });
            pilot(ac, `${G.world.icao} Departure, ${ac.radio}, ${fmtAlt(Math.round((elev + 500) / 100) * 100)} climbing ${fmtAlt(ac.tAlt)}.`);
            atc(`${ac.radio}, ${G.world.icao} Departure, radar contact.`);
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
    if (g.along <= 0.65 && below(G.met)) { goAround(ac, 'minimums, no runway in sight', true); return false; }
    if (g.along <= 0.15) {
        if (ac.alt - elev > 300 || Math.abs(g.xt) > 0.3) { goAround(ac, 'not stabilized'); return false; }
        if (runwayBusyUntil(e.phys) > G.t) { goAround(ac, 'runway occupied'); return false; }
        land(ac, e);
        return false;
    }
    return true;
}

function land(ac, e) {
    G.stats.landed++;
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
    if (ea && eb && sameRunwayish(ea, eb) && a.appr.along < 10 && b.appr.along < 10) { nm = 2.5; why = 'in trail on final'; }
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
            if (!sameFinal && dz >= SEP_FT - 25) continue;              // 1,000 ft vertical (5-5-5)
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d >= 8) continue;
            const req = requiredSep(a, b);
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
let drag = null;              // { id, mode: 'ac'|'pan', ac, sx, sy, moved, hdg }
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

    // Fixes.
    c.font = '10px "JetBrains Mono", monospace';
    for (const f of G.world.fixes) {
        if (f.kind === 'app' && !G.active.arr.includes(f.end)) continue;
        const [fx, fy] = toS(f.x, f.y);
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
const SURFACE_STATES = new Set(['gate', 'push', 'pushed', 'taxi', 'wait', 'lineup', 'luaw', 'clear', 'rollout']);
function visible(a) {
    if (!SURFACE_STATES.has(a.state)) return true;
    if (!G.ground) return a.state !== 'wait';
    return view.scale > 25;
}

/** Taxiways, aprons and gates, when zoomed in on the field. */
function drawSurface() {
    const c = ctx, s = view.scale, gr = G.surfaceMap, chart = mapStyle === 'chart';
    c.save();
    c.fillStyle = chart ? 'rgba(120,120,110,0.18)' : 'rgba(255,255,255,0.05)';
    for (const poly of gr.aprons) {
        c.beginPath();
        poly.forEach((p, i) => { const [x, y] = toS(p.x, p.y); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
        c.closePath(); c.fill();
    }
    c.strokeStyle = chart ? 'rgba(200,150,30,0.9)' : 'rgba(242,193,78,0.38)';
    c.lineWidth = Math.max(1, Math.min(3, s / 120));
    c.beginPath();
    for (const l of gr.lines) l.pts.forEach((p, i) => { const [x, y] = toS(p.x, p.y); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.stroke();
    if (s > 70) {
        c.font = '700 10px "JetBrains Mono", monospace';
        c.fillStyle = chart ? '#6b4f00' : 'rgba(242,193,78,0.85)';
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
    if (s > 140) {
        c.font = '9px "JetBrains Mono", monospace';
        c.fillStyle = chart ? '#334' : 'rgba(200,215,230,0.7)';
        for (const g of gr.gates) { const [x, y] = toS(g.x, g.y); c.fillRect(x - 1.5, y - 1.5, 3, 3); c.fillText(g.ref, x, y - 8); }
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
    const col = a.conflict || a.lowAlt ? COLORS.bad : a === G.selected ? COLORS.sel : base;

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
    const l3 = `${typeTag(a)} ${a.kind === 'arr' || a.lowAlt || a.wxReq ? intentTag(a) : `${a.gate.name} ${a.alt >= exitAlt(a) - 50 ? '✓' : alt3(exitAlt(a))}`}`;
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
    if (a.lowAlt) return 'LA ' + alt3(mvaHere(a));
    if (a.wxReq) return 'WX ' + a.wxReq.deg + a.wxReq.dir;
    if (a.appr) return (a.appr.loc ? 'LOC ' : 'ILS ') + a.appr.end.id + (a.landClr ? ' CL' : '');
    if (a.holdAt) return 'HLD ' + a.holdAt.fix.name;
    if (a.orbit) return '360' + a.orbit.dir;
    if (a.direct) return '>' + a.direct.name;
    return a.expect ? 'exp ' + a.expect.id : '';
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
        drag = { id: e.pointerId, mode: ac ? 'ac' : 'pan', ac, sx, sy, px: sx, py: sy, moved: false, hdg: null, vx: view.x, vy: view.y };
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
        } else if (drag.mode === 'ac' && drag.moved && drag.ac.state !== 'roll') {
            const [ax, ay] = toS(drag.ac.x, drag.ac.y);
            drag.hdg = Math.round(brg(sx - ax, -(sy - ay)) / 5) * 5 || 360;
        }
    });
    const end = e => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (!drag || drag.id !== e.pointerId) return;
        const d = drag;
        drag = null;
        if (e.type === 'pointercancel') return;
        if (d.mode === 'ac' && d.moved && d.hdg != null) {
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
    if (!ac) {
        if (cardKey !== 'none' || force) {
            cardKey = 'none';
            el.innerHTML = `<div class="card-empty">Select an aircraft on the scope or in the strips. Drag from a target to give it a heading.</div>`;
        }
        return;
    }
    const key = `${ac.id}|${ac.state}|${G.active.key}|${!!ac.appr}|${!!ac.appr?.loc}|${!!ac.landClr}|${!!ac.wxReq}|${!!ac.crossReq}|${!!ac.holdPos}|${ac.freq}|${!!ac.called}`;
    if (!force && key === cardKey) { updateCard(); return; }
    cardKey = key;
    const ground = ac.state !== 'air';
    const surface = ['gate', 'push', 'pushed', 'taxi', 'clear', 'rollout', 'lineup'].includes(ac.state);
    const yours = mine(ac);
    const twr = G.positions.has('TWR');
    const groundBtns = [
        ac.state === 'gate' && ac.kind === 'dep' && ac.called ? `<button class="btn primary" data-act="push">Pushback approved</button>` : '',
        ac.state === 'pushed' ? `<button class="btn primary" data-act="taxi">Taxi to runway ${ac.rwy.id}</button>` : '',
        ac.state === 'clear' ? `<button class="btn primary" data-act="taxi">Taxi to ${ac.stand ? 'gate ' + ac.stand.ref : 'a gate'}</button>` : '',
        (ac.state === 'taxi' || ac.state === 'push') && !ac.holdPos ? `<button class="btn" data-act="holdPos">Hold position</button>` : '',
        ac.holdPos ? `<button class="btn primary" data-act="cont">Continue taxi</button>` : '',
    ].join('');
    const crossBtn = ac.crossReq && twr ? `<div class="btn-row"><button class="btn primary" data-act="cross">Cross runway ${ac.crossReq.label}</button></div>` : '';
    const ilsBtns = ac.kind === 'arr' && !ground
        ? G.active.arr.map(e => `<button class="btn ils" data-ils="${e.id}">ILS ${e.id}</button>`).join('')
          + (ac.appr?.loc && !ac.landClr ? `<button class="btn primary" data-act="land">Cleared to land ${ac.appr.end.id}</button>` : '')
          + (ac.appr ? `<button class="btn warn" data-act="ga">Go around</button>` : '')
        : '';
    const others = G.world.ends.filter(e => !G.active.arr.includes(e));
    const fixOpts = G.world.fixes
        .filter(f => f.kind !== 'app' || G.active.arr.includes(f.end))
        .map(f => `<option value="${f.name}">${f.name} · ${f.kind === 'arr' ? 'entry' : f.kind === 'dep' ? 'exit gate' : 'final ' + f.end.id}</option>`).join('');
    el.innerHTML = `
        <div class="card-head">
            <span class="cs">${ac.cs}</span>
            <span class="badge ${ac.kind}">${ac.kind === 'arr' ? 'Arrival' : 'Departure'}</span>
            <span class="radio">${ac.radio} · ${typeTag(ac)}</span>
        </div>
        <div class="card-status" id="card-status"></div>
        ${crossBtn}
        ${!yours ? `<div class="card-empty">The system is working ${FREQ_NAME[ac.freq]}. It will reach your frequency when it's handed off.</div>` : surface ? (groundBtns ? `<div class="btn-row">${groundBtns}</div>` : '') : `
        ${ac.wxReq ? `<div class="btn-row"><button class="btn primary" data-act="dev">Approve ${ac.wxReq.deg}° ${ac.wxReq.dir === 'L' ? 'left' : 'right'} for weather</button></div>` : ''}
        <div class="row"><label>Heading</label><div class="stepper">
            <button data-adj="hdg:-10">−10</button><button data-adj="hdg:-5">−5</button>
            <span class="val" id="p-hdg"></span>
            <button data-adj="hdg:5">+5</button><button data-adj="hdg:10">+10</button></div></div>
        <div class="row"><label>Altitude</label><div class="stepper">
            <button data-adj="alt:-1000">−1000</button>
            <span class="val" id="p-alt"></span>
            <button data-adj="alt:1000">+1000</button></div></div>
        <div class="row"><label>Speed</label><div class="stepper">
            <button data-adj="spd:-10">−10</button>
            <span class="val" id="p-spd"></span>
            <button data-adj="spd:10">+10</button></div></div>
        <div class="send-row">
            <button class="btn primary" data-act="send">Transmit ⏎</button>
            <button class="btn" data-act="reset">Reset</button>
        </div>
        ${ac.state === 'wait' || ac.state === 'luaw' ? `<div class="btn-row">
            ${ac.state === 'wait' ? `<button class="btn" data-act="luaw">Line up and wait</button>` : ''}
            <button class="btn primary" data-act="takeoff">Cleared for takeoff ${ac.rwy.id}</button></div>` : ''}
        ${ilsBtns ? `<div class="btn-row">${ilsBtns}</div>` : ''}
        ${!ground ? `<div class="btn-row">
            <select data-act="direct" aria-label="Direct to fix"><option value="">Direct to…</option>${fixOpts}</select>
            ${ac.kind === 'arr' && others.length ? `<select data-act="ils-other" aria-label="Other runway"><option value="">Other ILS…</option>${others.map(e => `<option value="${e.id}">ILS ${e.id}</option>`).join('')}</select>` : ''}
        </div>
        <div class="btn-row">
            <select data-act="hold" aria-label="Hold at fix"><option value="">Hold at…</option>${fixOpts}</select>
            <button class="btn" data-act="orbitL">Left 360</button>
            <button class="btn" data-act="orbitR">Right 360</button>
        </div>` : ''}`}`;
    updateCard();
}

function updateCard() {
    const ac = G.selected;
    if (!ac) return;
    $('#card-status').textContent = statusText(ac);
    if (!$('#p-hdg')) return;
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
        if (b.dataset.adj) { const [k, v] = b.dataset.adj.split(':'); adjust(k, Number(v)); return; }
        if (b.dataset.ils) { transmitPending({ ils: findEnd(b.dataset.ils) }); return; }
        const act = b.dataset.act;
        if (act === 'send') transmitPending();
        else if (act === 'reset') { syncPending(true); updateCard(); }
        else if (act === 'takeoff') transmitPending({ takeoff: true });
        else if (act === 'luaw') transmitPending({ luaw: true });
        else if (act === 'dev') { issue(ac, { deviate: true }); renderCard(true); }
        else if (['push', 'taxi', 'holdPos', 'cont', 'cross'].includes(act)) { issue(ac, { [act]: true }); renderCard(true); }
        else if (act === 'land') { issue(ac, { land: true }); renderCard(true); }
        else if (act === 'ga') { issue(ac, { goAround: true }); syncPending(true); renderCard(true); }
        else if (act === 'orbitL' || act === 'orbitR') { issue(ac, { orbit: act === 'orbitL' ? 'L' : 'R' }); renderCard(true); }
    });
    el.addEventListener('change', e => {
        const s = e.target;
        if (!G.selected || !s.value) return;
        if (s.dataset.act === 'direct') issue(G.selected, { direct: G.world.fixes.find(f => f.name === s.value) });
        if (s.dataset.act === 'hold') issue(G.selected, { holdFix: G.world.fixes.find(f => f.name === s.value) });
        if (s.dataset.act === 'ils-other') { transmitPending({ ils: findEnd(s.value) }); return; }
        renderCard(true);
    });
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
        return `<button class="strip ${a.kind}${a === G.selected ? ' sel' : ''}${a.conflict || a.lowAlt || a.wxReq || a.crossReq ? ' conf' : ''}${mine(a) ? '' : ' sys'}" data-id="${a.id}">
            <span class="bar"></span>
            <span><span class="l1">${a.cs}</span><span class="l2">${typeTag(a)}</span></span>
            <span class="r">${right}</span></button>`;
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
    const z = new Date(G.zulu0 + G.t * 1000);
    const zulu = String(z.getUTCHours()).padStart(2, '0') + String(z.getUTCMinutes()).padStart(2, '0') + 'Z';
    $('#hud').innerHTML = `<b>${G.world.icao}</b> ${zulu} · YOU <b>${['APP', 'TWR', 'GND'].filter(f => G.positions.has(f)).join(' ')}</b><br>`
        + `ATIS <b>${PHONETIC[G.atis].toUpperCase()}</b> · A<b>${G.altim}</b><br>`
        + `WIND <b>${hdg3(G.wind.dir)}/${String(G.wind.spd).padStart(2, '0')}${G.met.gust ? 'G' + G.met.gust : ''}</b>${G.opts.weather ? ` · <b>${metText(G.met)}</b>` : ''}<br>`
        + `ARR <b>${G.active.arr.map(e => e.id).join(' ')}</b><br>`
        + `DEP <b>${G.active.dep.map(e => e.id).join(' ')}</b><br>`
        + `EXIT <b>${terrainOn() ? 'by gate' : alt3(G.world.exitAlt) + '+'}</b> · MVA <b>${terrainOn() ? 'by sector' : alt3(G.world.minAlt)}</b>`
        + (G.surfaceStatus ? `<br><span class="taxi-st${G.ground ? '' : ' bad'}">TAXI MAP <b>${escapeHtml(G.surfaceStatus)}</b></span>` : '')
        + (G.opts.terrain && !G.mva ? '<br>loading terrain…' : '')
        + (below(G.met) ? '<br><b style="color:#ff8a98">BELOW MINIMUMS</b>' : '');
    $('#s-score').textContent = G.score;
    $('#s-landed').textContent = G.stats.landed;
    $('#s-departed').textContent = G.stats.departed;
    $('#s-incidents').textContent = G.stats.incidents;
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
        else if (t === 'TX' || t === 'TAXI') { const nx = toks[i + 1]; if (nx && findEnd(nx)) { c.taxi = nx; i++; } else c.taxi = true; }
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
    $('#pick').onclick = () => { $('#game').hidden = true; $('#start').hidden = false; G = null; renderStart(); };
}

function bindGame() {
    bindScope();
    bindCard();
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

let opts = { terrain: store.get('terrain', false), weather: store.get('weather', false), positions: store.get('positions', ['APP', 'TWR']) };

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
async function loadSurface(world) {
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
    const gates = tryIt('InFlight gates', within(20000, gatesFromBackend(world.icao)));
    const osm = tryIt('OpenStreetMap', within(45000, overpassLayout(world, box)));

    const [t, g, o] = await Promise.all([tiles, gates, osm]);
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
    if (t) build([...t, ...(g || [])], `OpenFreeMap taxiways${g ? ' + InFlight gates' : ''}`);
    if (o) build([...o.features, ...(g || [])], `OpenStreetMap${g ? ' + InFlight gates' : ''}`);
    if (!options.length) return { error: failures.join('; ') || 'no source answered', map: map && map.lines.length ? map : null };
    options.sort((a, b) => b.score - a.score);
    return { ground: options[0].ground, source: options[0].source };
}

/** OpenStreetMap through Overpass: three servers at once, plus the live map's own airport request. */
function overpassLayout(world, box) {
    const bbox = `${box.s.toFixed(5)},${box.w.toFixed(5)},${box.n.toFixed(5)},${box.e.toFixed(5)}`;
    const q = `[out:json][timeout:40];(way["aeroway"~"taxiway|taxilane|apron"](${bbox});node["aeroway"~"gate|parking_position"](${bbox}););out geom;`;
    const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
    const ask = url => fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`${new URL(url).host} ${r.status}`)))
        .then(d => (d.elements && d.elements.length ? AirportLayoutManager.processOsmData(d.elements) : Promise.reject(new Error('no data'))));
    const live = AirportLayoutManager.getLayout(world.icao, world.lat, world.lon).then(l => l || Promise.reject(new Error('no data')));
    return Promise.any([...servers.map(ask), live]).catch(() => Promise.reject(new Error('no server answered')));
}
async function startGame(airport, level) {
    store.set('last', airport.icao);
    store.set('level', level);
    store.set('terrain', opts.terrain);
    store.set('weather', opts.weather);
    store.set('positions', opts.positions);
    $('#start').hidden = true;
    $('#game').hidden = false;
    window.scrollTo(0, 0);
    $('#summary').hidden = true;
    $('#log').innerHTML = '';
    nextId = 1;
    newGame(airport, level, { ...opts });
    const game = G;
    fitView();
    resetView();
    cardKey = '';
    renderCard(true);
    // The map loads for everyone; with Terrain on, the shift waits for it so the MVAs are real from the start.
    const dem = loadDem(airport.lat, airport.lon).catch(() => null);
    setSpeed(0);
    sys(game.positions.has('GND') ? 'Loading the airport\'s taxiways and gates…' : 'Loading the airport…');
    game.surfaceStatus = 'loading…';
    const surface = await loadSurface(game.world).catch(err => ({ error: `couldn't be loaded (${err.message})` }));
    if (G !== game) return;
    game.ground = surface.ground || null;
    game.surfaceMap = surface.ground || surface.map || null;
    // On the scope too, so it's visible without reading the log.
    game.surfaceStatus = surface.ground ? `${surface.source} ✓`
        : surface.map ? `drawn only (${surface.map.lines.length} lines), no taxi network: ${surface.error}` : `none: ${surface.error}`;
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
        const d = await dem;
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
    sys(`${airport.icao} approach is open. Landing ${G.active.arr.map(e => e.id).join(', ')}, departing ${G.active.dep.map(e => e.id).join(', ')}. Departures exit at ${terrainOn() ? 'the altitude on their strip' : fmtAlt(G.world.exitAlt) + ' or above'}.${wxNote}`);
    spawnArrival();
    spawnDeparture();
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
    for (const k of ['terrain', 'weather']) {
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
    window.approach = { get G() { return G; }, tick, issue, runCommand, findEnd, startGame, get DATA() { return DATA; } };
}

init();
