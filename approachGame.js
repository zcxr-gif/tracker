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
 */

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

const TRAFFIC = {
    light:  { gap: 140, max: 6 },
    normal: { gap: 95,  max: 10 },
    busy:   { gap: 60,  max: 15 },
};

const FEATURED = ['KJFK', 'KLAX', 'KATL', 'KORD', 'KDFW', 'KDEN', 'KSFO', 'KSEA', 'KBOS', 'KMIA', 'KLAS', 'KEWR'];

const AIRLINES = [
    { icao: 'AAL', radio: 'American',   w: 10, types: ['B738', 'A321', 'A320', 'B772', 'B789'] },
    { icao: 'DAL', radio: 'Delta',      w: 10, types: ['A321', 'B739', 'A320', 'A339', 'B763', 'A359'] },
    { icao: 'UAL', radio: 'United',     w: 10, types: ['B738', 'B739', 'A320', 'B772', 'B789', 'B38M'] },
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
        vapp: heavy ? 150 : regional ? 130 : 140,
        vr: heavy ? 160 : regional ? 135 : 145,
        climb: heavy ? 2000 : 2600,
        desc: 2000,
    };
}

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
        icao: p.icao, name: p.name, elev, ends, fixes, minAlt,
        exitAlt: Math.max(9000, Math.ceil((elev + 6000) / 1000) * 1000),
    };
}

function computeActive(world, wind) {
    const head = e => Math.cos(diff(e.course, wind.dir) * D2R);
    const best = Math.max(...world.ends.map(head));
    const arr = world.ends.filter(e => head(e) >= best - 0.12);
    const dep = [...arr].sort((a, b) => b.len - a.len).slice(0, 2);
    return { arr, dep, key: arr.map(e => e.id).join(' ') };
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

let G = null;
let nextId = 1;

function newGame(airport, level) {
    const world = buildWorld(airport);
    const wind = { dir: Math.round(rand(0, 36)) * 10 || 360, spd: Math.round(rand(5, 18)) };
    G = {
        world, wind, level,
        active: computeActive(world, wind),
        aircraft: [],
        t: 0,
        score: 0,
        stats: { landed: 0, departed: 0, incidents: 0, goArounds: 0 },
        conf: new Map(),
        occupied: new Map(),       // physical runway index -> sim time it is clear again
        nextSpawn: 45,
        nextWind: rand(900, 1500),
        speed: 1,
        selected: null,
        depRR: 0,
        floaters: [],
        zulu0: Date.now(),
        over: false,
    };
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
        const heavy = HEAVY.has(type);
        const digits = String(num).split('').map(d => DIGIT_WORDS[d]).join(' ');
        return {
            cs, type,
            radio: `${al.radio} ${num}${heavy ? ' heavy' : ''}`,
            spoken: `${al.radio} ${digits}${heavy ? ' heavy' : ''}`,
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
        const alt = Math.round((G.world.elev + rand(8000, 12500)) / 1000) * 1000;
        const crowded = G.aircraft.some(a => airborne(a) && Math.hypot(a.x - x, a.y - y) < 7 && Math.abs(a.alt - alt) < 1500);
        if (crowded) continue;
        const hdg = norm(brg(-x, -y) + rand(-12, 12));
        const spd = alt < 10000 ? 250 : 280;
        const ac = {
            id: nextId++, ...id, kind: 'arr', state: 'air', perf: perf(id.type), entry: f,
            x, y, alt, hdg, spd, tHdg: hdg, tAlt: alt, tSpd: spd, turn: null,
            trail: [], trailT: 0, born: G.t,
        };
        G.aircraft.push(ac);
        pilot(ac, `Approach, ${ac.radio}, with you at ${fmtAlt(alt)} via ${f.name}.`);
        return true;
    }
    return false;
}

function nextDepRunway() {
    const dep = G.active.dep;
    return dep[(G.depRR++) % dep.length];
}

function spawnDeparture() {
    const waiting = G.aircraft.filter(a => a.state === 'wait');
    const rwy = nextDepRunway();
    if (waiting.filter(a => a.rwy === rwy).length >= 3) return false;
    const id = makeCallsign();
    if (!id) return false;
    const gate = pick(G.world.fixes.filter(f => f.kind === 'dep'));
    const initial = Math.ceil((G.world.elev + 4000) / 1000) * 1000;
    const ac = {
        id: nextId++, ...id, kind: 'dep', state: 'wait', perf: perf(id.type), rwy, gate,
        x: rwy.thr.x, y: rwy.thr.y, alt: G.world.elev, hdg: rwy.course, spd: 0,
        tHdg: rwy.course, tAlt: initial, tSpd: 280, turn: null,
        trail: [], trailT: 0, born: G.t, remindAt: G.t + 240,
    };
    G.aircraft.push(ac);
    pilot(ac, `Tower, ${ac.radio}, holding short runway ${rwy.id}, ready for departure, ${gate.name} gate.`);
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
function atc(text) { logLine('atc', text); }
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
function toast(text, tone) {
    const el = $('#toast');
    el.textContent = text;
    el.className = 'toast show ' + (tone || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2600);
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

function runwayBusyUntil(phys) {
    let until = G.occupied.get(phys) || 0;
    if (G.aircraft.some(a => a.state === 'roll' && a.rwy.phys === phys)) until = Math.max(until, G.t + 30);
    return until;
}

/**
 * Apply one transmission to an aircraft. `c` may carry hdg/turn, alt, spd,
 * ils (runway end), direct (fix), hold ('L'|'R'), takeoff, goAround.
 * Returns true when the pilot accepted it.
 */
function issue(ac, c) {
    if (!ac || ac.gone) return false;
    const parts = [], back = [];
    const onGround = ac.state === 'wait' || ac.state === 'roll';

    if (c.takeoff) {
        if (ac.state !== 'wait') { sys(`${ac.cs} is not holding short.`); return false; }
        if (runwayBusyUntil(ac.rwy.phys) > G.t) {
            atc(`${ac.radio}, runway ${ac.rwy.id}, cleared for takeoff.`);
            pilot(ac, `Unable, the runway is occupied, ${ac.radio}.`);
            return false;
        }
        const short = G.aircraft.find(a => a.appr?.loc && a.appr.end.phys === ac.rwy.phys && a.appr.along < 3);
        if (short) {
            atc(`${ac.radio}, runway ${ac.rwy.id}, cleared for takeoff.`);
            pilot(ac, `Unable, traffic on short final, ${ac.radio}.`);
            return false;
        }
    }
    if (c.ils) {
        if (ac.kind !== 'arr' || !airborne(ac)) { sys(`${ac.cs} can't fly an approach right now.`); return false; }
        const g = finalGeom(ac, c.ils);
        // Judge the intercept on the heading they'll be flying: "turn left 190, cleared ILS" is one call.
        const off = Math.abs(diff(c.ils.course, c.hdg != null ? c.hdg : ac.hdg));
        const inCone = g.along > 2 && g.along < 32 && Math.abs(g.xt) < g.along * Math.tan(40 * D2R) + 1;
        if (!inCone || off > 120) {
            atc(`${ac.radio}, cleared ILS runway ${c.ils.id} approach.`);
            pilot(ac, `Unable, we're not in position for runway ${c.ils.id}, ${ac.radio}.`);
            return false;
        }
    }

    if (c.goAround) {
        if (!ac.appr) { sys(`${ac.cs} isn't on an approach.`); return false; }
        goAround(ac, null);
        atc(`${ac.radio}, go around.`);
        return true;
    }
    if (c.hdg != null) {
        const h = norm(c.hdg) || 360;
        const d = diff(ac.hdg, h);
        const dir = c.turn || (Math.abs(d) < 3 ? null : d < 0 ? 'L' : 'R');
        ac.tHdg = h; ac.turn = c.turn || null; ac.hold = null; ac.direct = null;
        if (ac.appr) cancelApproach(ac);
        if (onGround) {
            parts.push(`after departure fly heading ${hdg3(h)}`);
            back.push(`heading ${hdg3(h)} after departure`);
        } else {
            const side = dir === 'L' ? 'left ' : dir === 'R' ? 'right ' : '';
            parts.push(`${side ? 'turn ' + side : 'fly '}heading ${hdg3(h)}`);
            back.push(`${side}heading ${hdg3(h)}`);
        }
    }
    if (c.direct) {
        ac.direct = c.direct; ac.hold = null; ac.turn = null;
        if (ac.appr) cancelApproach(ac);
        parts.push(`proceed direct ${c.direct.name}`);
        back.push(`direct ${c.direct.name}`);
    }
    if (c.hold) {
        if (onGround) { sys(`${ac.cs} is on the ground.`); return false; }
        ac.hold = c.hold; ac.direct = null;
        if (ac.appr) cancelApproach(ac);
        parts.push(`hold present position, ${c.hold === 'L' ? 'left' : 'right'} turns`);
        back.push(`holding, ${c.hold === 'L' ? 'left' : 'right'} turns`);
    }
    if (c.alt != null) {
        const a = clamp(Math.round(c.alt / 1000) * 1000, G.world.minAlt, 24000);
        const ref = onGround ? G.world.elev : ac.alt;
        const verb = Math.abs(a - ref) < 50 ? 'maintain' : a > ref ? 'climb and maintain' : 'descend and maintain';
        ac.tAlt = a;
        parts.push(`${verb} ${fmtAlt(a)}`);
        back.push(`${verb.replace(' and maintain', '')} ${fmtAlt(a)}`);
    }
    if (c.spd != null) {
        const s = clamp(Math.round(c.spd / 10) * 10, 160, 320);
        const verb = s < ac.spd - 3 ? 'reduce speed to' : s > ac.spd + 3 ? 'increase speed to' : 'maintain';
        ac.tSpd = s;
        parts.push(`${verb} ${s}${verb === 'maintain' ? ' knots' : ''}`);
        back.push(`${s} knots`);
        if (ac.alt < 10000 && s > 250) back.push('two-fifty below ten');
    }
    if (c.ils) {
        ac.appr = { end: c.ils, loc: false, gs: false, est: false, along: 99, xt: 0 };
        ac.hold = null; ac.direct = null; ac.turn = null;
        parts.push(`cleared ILS runway ${c.ils.id} approach`);
        back.push(`cleared ILS ${c.ils.id}`);
    }
    if (c.takeoff) {
        ac.state = 'roll';
        ac.hdg = ac.rwy.course;
        parts.push(`runway ${ac.rwy.id}, cleared for takeoff`);
        back.push(`cleared for takeoff ${ac.rwy.id}`);
    }
    if (!parts.length) return false;
    atc(`${ac.radio}, ${parts.join(', ')}.`);
    pilot(ac, `${cap(back.join(', '))}, ${ac.radio}.`);
    return true;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function cancelApproach(ac) { ac.appr = null; }

function goAround(ac, reason) {
    const e = ac.appr ? ac.appr.end : null;
    ac.appr = null; ac.direct = null; ac.hold = null; ac.turn = null;
    if (e) ac.tHdg = e.course;
    ac.tAlt = Math.max(G.world.minAlt, Math.ceil((G.world.elev + 3000) / 1000) * 1000);
    ac.tSpd = 210;
    G.stats.goArounds++;
    award(ac, -3);
    pilot(ac, `${ac.radio}, going around${reason ? ', ' + reason : ''}.`);
    if (reason) toast(`${ac.cs} going around — ${reason}`, 'bad');
}

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */

function tick(dt) {
    G.t += dt;

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
    G.floaters = G.floaters.filter(f => f.until > G.t);
}

function shiftWind() {
    G.nextWind = G.t + rand(900, 1500);
    G.wind = { dir: norm(G.wind.dir + Math.round(rand(-7, 7)) * 10) || 360, spd: Math.round(rand(4, 20)) };
    const prev = G.active.key;
    G.active = computeActive(G.world, G.wind);
    if (G.active.key === prev) {
        sys(`Wind now ${hdg3(G.wind.dir)} at ${G.wind.spd}.`);
        return;
    }
    sys(`Wind now ${hdg3(G.wind.dir)} at ${G.wind.spd}. Runway change — landing ${G.active.arr.map(e => e.id).join(', ')}, departing ${G.active.dep.map(e => e.id).join(', ')}.`, 'good');
    toast(`Runway change: ${G.active.arr.map(e => e.id).join(' / ')}`, 'good');
    for (const ac of G.aircraft) {
        if (ac.state !== 'wait' || G.active.dep.includes(ac.rwy)) continue;
        ac.rwy = nextDepRunway();
        ac.x = ac.rwy.thr.x; ac.y = ac.rwy.thr.y; ac.hdg = ac.tHdg = ac.rwy.course;
    }
    renderCard(true);
}

function step(ac, dt) {
    const p = ac.perf, elev = G.world.elev;

    if (ac.state === 'wait') {
        if (G.t >= ac.remindAt) {
            ac.remindAt = G.t + 240;
            pilot(ac, `Tower, ${ac.radio}, still holding short ${ac.rwy.id}.`);
        }
        return;
    }
    if (ac.state === 'roll') {
        ac.spd += 3.5 * dt;
        move(ac, dt);
        if (ac.spd >= p.vr) {
            ac.state = 'air';
            ac.alt = elev + 20;
            pilot(ac, `${ac.radio}, airborne, passing ${fmtAlt(Math.round((elev + 500) / 100) * 100)} for ${fmtAlt(ac.tAlt)}.`);
        }
        return;
    }

    // ---- lateral
    if (ac.appr) {
        if (!approachLateral(ac)) return;   // landed or went around this tick
    } else if (ac.direct) {
        const f = ac.direct;
        ac.tHdg = brg(f.x - ac.x, f.y - ac.y);
        if (Math.hypot(f.x - ac.x, f.y - ac.y) < 1) ac.direct = null;
    }
    if (ac.hold) {
        ac.hdg = norm(ac.hdg + (ac.hold === 'L' ? -1 : 1) * TURN_RATE * dt);
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
        tAlt = Math.min(gsAlt, ac.alt);
        rate = ac.alt > gsAlt + 100 ? p.desc * 1.4 : 2200;
        if (ac.appr.along < 3 && ac.alt > gsAlt + 350) { goAround(ac, 'too high'); return; }
        if (ac.appr.along < 6) tSpd = p.vapp;
        else if (ac.appr.along < 12) tSpd = Math.min(tSpd, 180);
    }
    const maxClimb = rate / 60 * dt;
    ac.alt += clamp(tAlt - ac.alt, -maxClimb, maxClimb);

    // ---- speed: 250 below 10,000 unless on final
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
        } else if (g.along < 1.5) {
            ac.appr = null;
            pilot(ac, `${ac.radio}, we've flown through the localizer for ${e.id}, request vectors.`);
            return true;
        } else {
            return true;   // keep the assigned heading until the intercept
        }
    }
    ac.tHdg = norm(c + clamp(-g.xt * 40, -30, 30));
    ac.turn = null;
    if (!ap.est && Math.abs(g.xt) < 0.2 && Math.abs(diff(ac.hdg, c)) < 10) ap.est = true;

    // The runway has to be clear by the time we get there.
    if (g.along < 1.2 && g.along > 0.15) {
        const eta = g.along / (ac.spd / 3600);
        if (runwayBusyUntil(e.phys) > G.t + eta) { goAround(ac, 'runway occupied'); return false; }
    }
    if (g.along <= 0.15) {
        if (ac.alt - elev > 300 || Math.abs(g.xt) > 0.3) { goAround(ac, 'unstable'); return false; }
        if (runwayBusyUntil(e.phys) > G.t) { goAround(ac, 'runway occupied'); return false; }
        land(ac, e);
        return false;
    }
    return true;
}

function land(ac, e) {
    ac.gone = true;
    G.occupied.set(e.phys, G.t + 35);
    G.stats.landed++;
    const comp = G.wind.spd * Math.cos(diff(e.course, G.wind.dir) * D2R);
    if (comp < -5) { award(ac, 5, 'tailwind'); sys(`${ac.cs} landed ${e.id} with a ${Math.round(-comp)} kt tailwind.`); }
    else { award(ac, 10); sys(`${ac.cs} landed runway ${e.id}.`, 'good'); }
}

function exitScope(ac) {
    ac.gone = true;
    if (ac.kind === 'dep') {
        const b = brg(ac.x, ac.y);
        const onGate = Math.abs(diff(b, ac.gate.bearing)) <= 20;
        G.stats.departed++;
        if (onGate && ac.alt >= G.world.exitAlt - 50) {
            award(ac, 10);
            pilot(ac, `Over to Center, ${ac.radio}, good day.`);
        } else if (onGate) {
            award(ac, 5, 'low');
            sys(`${ac.cs} left via ${ac.gate.name} below ${fmtAlt(G.world.exitAlt)}.`, 'bad');
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

function separation() {
    const air = G.aircraft.filter(airborne);
    for (const a of G.aircraft) a.conflict = false;
    const now = new Set();
    const nearField = a => Math.hypot(a.x, a.y) < 5 && agl(a) < 2500;
    for (let i = 0; i < air.length; i++) {
        for (let j = i + 1; j < air.length; j++) {
            const a = air[i], b = air[j];
            const dz = Math.abs(a.alt - b.alt);
            if (dz >= SEP_FT - 25) continue;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d >= SEP_NM) continue;
            if (nearField(a) && nearField(b)) continue;                 // tower's problem
            const la = a.appr?.loc, lb = b.appr?.loc;
            if (la && lb && a.appr.end !== b.appr.end) continue;        // parallel approaches
            if (la && lb && d >= 2.5) continue;                         // in trail on the same ILS
            const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
            now.add(key);
            a.conflict = b.conflict = true;
            let c = G.conf.get(key);
            if (!c) {
                c = { t: G.t, last: G.t, near: false };
                G.conf.set(key, c);
                G.stats.incidents++;
                G.score -= 10;
                sys(`Separation lost: ${a.cs} and ${b.cs}.`, 'bad');
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

const COLORS = {
    bg: '#060b0f',
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

function fitView() {
    const r = canvas.getBoundingClientRect();
    view.w = r.width; view.h = r.height;
    view.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * view.dpr);
    canvas.height = Math.round(r.height * view.dpr);
}
function resetView() {
    view.x = 0; view.y = 0;
    view.scale = Math.min(view.w, view.h) / 2 / (SCOPE_NM + 2);
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
        c.fillText(f.name, fx + 7, fy + (f.kind === 'app' ? 10 : 3));
        if (f.kind === 'dep') {
            // A short arrow outward: this is a way out.
            const b = f.bearing * D2R;
            const [qx, qy] = toS(f.x + Math.sin(b) * 3, f.y + Math.cos(b) * 3);
            c.setLineDash([2, 3]);
            c.beginPath(); c.moveTo(fx, fy); c.lineTo(qx, qy); c.stroke();
            c.setLineDash([]);
        }
    }

    // Departures waiting at each runway, as a queue count.
    const queues = new Map();
    for (const a of G.aircraft) if (a.state === 'wait') queues.set(a.rwy, (queues.get(a.rwy) || 0) + 1);
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
            c.strokeStyle = 'rgba(255,255,255,0.28)';
            c.setLineDash([3, 5]);
            c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
            c.setLineDash([]);
        }
    }

    // Aircraft.
    for (const a of G.aircraft) {
        if (a.state === 'wait') continue;
        drawAircraft(a);
    }

    // Heading drag.
    if (drag && drag.mode === 'ac' && drag.moved && drag.hdg != null) {
        const [ax, ay] = toS(drag.ac.x, drag.ac.y);
        c.strokeStyle = '#fff';
        c.setLineDash([4, 4]);
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(drag.px, drag.py); c.stroke();
        c.setLineDash([]);
        c.font = '700 13px "JetBrains Mono", monospace';
        c.fillStyle = '#fff';
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

function drawAircraft(a) {
    const c = ctx, s = view.scale;
    const [x, y] = toS(a.x, a.y);
    const base = a.kind === 'arr' ? COLORS.arr : COLORS.dep;
    const col = a.conflict ? COLORS.bad : a === G.selected ? COLORS.sel : base;

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

    // Target.
    c.fillStyle = col;
    if (a.kind === 'arr') c.fillRect(x - 3.5, y - 3.5, 7, 7);
    else { c.beginPath(); c.moveTo(x, y - 5); c.lineTo(x + 5, y); c.lineTo(x, y + 5); c.lineTo(x - 5, y); c.closePath(); c.fill(); }
    if (a === G.selected) {
        c.strokeStyle = '#fff';
        c.beginPath(); c.arc(x, y, 10, 0, Math.PI * 2); c.stroke();
    }

    // Data block.
    const vs = a.tAlt - a.alt;
    const target = a.appr?.loc ? null : a.tAlt;
    const arrow = Math.abs(vs) < 60 || target == null ? ' ' : vs > 0 ? '↑' : '↓';
    const l2 = `${alt3(a.alt)}${arrow}${target != null && Math.abs(vs) >= 60 ? alt3(target) : '   '} ${String(Math.round(a.spd)).padStart(3)}`;
    const l3 = a.kind === 'arr'
        ? `${a.type} ${a.appr ? (a.appr.loc ? 'LOC ' : 'ILS ') + a.appr.end.id : a.direct ? '>' + a.direct.name : a.hold ? 'HOLD' : ''}`
        : `${a.type} ${a.gate.name} ${a.alt >= G.world.exitAlt - 50 ? '✓' : alt3(G.world.exitAlt)}`;
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

function hitAircraft(sx, sy) {
    let best = null, bestD = 18;
    for (const a of G.aircraft) {
        if (a.state === 'wait') continue;
        const [x, y] = toS(a.x, a.y);
        const d = Math.hypot(sx - x, sy - y);
        if (d < bestD) { best = a; bestD = d; }
    }
    if (best) return best;
    for (const a of G.aircraft) {
        const b = a.box;
        if (a.state !== 'wait' && b && sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return a;
    }
    // A tap on a departure queue picks the first in line.
    for (const a of G.aircraft) {
        if (a.state !== 'wait') continue;
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
    if (ac.state === 'wait') return `Holding short ${ac.rwy.id} · exit ${ac.gate.name} · climb to ${alt3(G.world.exitAlt)}+`;
    if (ac.state === 'roll') return `Rolling ${ac.rwy.id} · ${Math.round(ac.spd)} kt`;
    const vs = ac.tAlt - ac.alt;
    const alt = `${Math.round(ac.alt).toLocaleString('en-US')} ft${Math.abs(vs) > 60 && !ac.appr?.loc ? (vs > 0 ? ' ↑ ' : ' ↓ ') + ac.tAlt.toLocaleString('en-US') : ''}`;
    let lat = `hdg ${hdg3(ac.hdg)}`;
    if (ac.hold) lat = `holding ${ac.hold === 'L' ? 'left' : 'right'}`;
    else if (ac.direct) lat = `direct ${ac.direct.name}`;
    if (ac.appr) {
        const ap = ac.appr;
        lat = ap.loc ? `on the localizer ${ap.end.id} · ${ap.along.toFixed(1)} nm` : `cleared ILS ${ap.end.id} · ${Math.abs(ap.xt).toFixed(1)} nm ${ap.xt > 0 ? 'right' : 'left'} of course`;
    }
    const tail = ac.kind === 'dep' ? ` · exit ${ac.gate.name} at ${alt3(G.world.exitAlt)}+` : '';
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
    const key = `${ac.id}|${ac.state}|${G.active.key}|${!!ac.appr}`;
    if (!force && key === cardKey) { updateCard(); return; }
    cardKey = key;
    const ground = ac.state !== 'air';
    const ilsBtns = ac.kind === 'arr' && !ground
        ? G.active.arr.map(e => `<button class="btn ils" data-ils="${e.id}">ILS ${e.id}</button>`).join('')
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
            <span class="radio">${ac.radio} · ${ac.type}</span>
        </div>
        <div class="card-status" id="card-status"></div>
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
        ${ac.state === 'wait' ? `<div class="btn-row"><button class="btn primary" data-act="takeoff">Cleared for takeoff ${ac.rwy.id}</button></div>` : ''}
        ${ilsBtns ? `<div class="btn-row">${ilsBtns}</div>` : ''}
        ${!ground ? `<div class="btn-row">
            <select data-act="direct" aria-label="Direct to fix"><option value="">Direct to…</option>${fixOpts}</select>
            ${ac.kind === 'arr' && others.length ? `<select data-act="ils-other" aria-label="Other runway"><option value="">Other ILS…</option>${others.map(e => `<option value="${e.id}">ILS ${e.id}</option>`).join('')}</select>` : ''}
        </div>
        <div class="btn-row">
            <button class="btn" data-act="holdL">Hold left</button>
            <button class="btn" data-act="holdR">Hold right</button>
        </div>` : ''}`;
    updateCard();
}

function updateCard() {
    const ac = G.selected;
    if (!ac) return;
    $('#card-status').textContent = statusText(ac);
    const set = (k, txt) => { const v = $('#p-' + k); if (v) { v.textContent = txt; v.classList.toggle('dirty', pending.dirty[k]); } };
    set('hdg', hdg3(pending.hdg));
    set('alt', pending.alt.toLocaleString('en-US'));
    set('spd', String(pending.spd));
}

function transmitPending() {
    const ac = G.selected;
    if (!ac) return;
    const c = {};
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
        if (b.dataset.ils) { issue(ac, { ils: findEnd(b.dataset.ils) }); renderCard(true); return; }
        const act = b.dataset.act;
        if (act === 'send') transmitPending();
        else if (act === 'reset') { syncPending(true); updateCard(); }
        else if (act === 'takeoff') { transmitPending(); issue(ac, { takeoff: true }); renderCard(true); }
        else if (act === 'ga') { issue(ac, { goAround: true }); syncPending(true); renderCard(true); }
        else if (act === 'holdL' || act === 'holdR') { issue(ac, { hold: act === 'holdL' ? 'L' : 'R' }); renderCard(true); }
    });
    el.addEventListener('change', e => {
        const s = e.target;
        if (!G.selected || !s.value) return;
        if (s.dataset.act === 'direct') issue(G.selected, { direct: G.world.fixes.find(f => f.name === s.value) });
        if (s.dataset.act === 'ils-other') issue(G.selected, { ils: findEnd(s.value) });
        renderCard(true);
    });
}

function renderStrips() {
    if (!G) return;
    const el = $('#strips');
    const strip = a => {
        let right;
        if (a.state === 'wait') right = `<span class="l0">HOLD ${a.rwy.id}</span><span class="l2">${Math.floor((G.t - a.born) / 60)}m</span>`;
        else if (a.state === 'roll') right = `<span class="l0">ROLL ${a.rwy.id}</span><span class="l2">${Math.round(a.spd)}kt</span>`;
        else {
            const what = a.kind === 'arr'
                ? (a.appr ? (a.appr.loc ? 'LOC ' : 'ILS ') + a.appr.end.id : a.direct ? '>' + a.direct.name : a.hold ? 'HOLD' : 'H' + hdg3(a.tHdg))
                : `${a.gate.name} ${a.alt >= G.world.exitAlt - 50 ? '✓' : alt3(G.world.exitAlt)}`;
            right = `<span class="l0">${alt3(a.alt)}${Math.abs(a.tAlt - a.alt) > 60 && !a.appr?.loc ? (a.tAlt > a.alt ? '↑' : '↓') + alt3(a.tAlt) : ''}</span><span class="l2">${what}</span>`;
        }
        return `<button class="strip ${a.kind}${a === G.selected ? ' sel' : ''}${a.conflict ? ' conf' : ''}" data-id="${a.id}">
            <span class="bar"></span>
            <span><span class="l1">${a.cs}</span><span class="l2">${a.type}${a.perf.heavy ? ' · H' : ''}</span></span>
            <span class="r">${right}</span></button>`;
    };
    const arr = G.aircraft.filter(a => a.kind === 'arr');
    const dep = G.aircraft.filter(a => a.kind === 'dep').sort((a, b) => (a.state === 'wait') - (b.state === 'wait'));
    el.innerHTML = `
        <div class="strip-h"><span>Arrivals</span><span>${arr.length}</span></div>
        ${arr.map(strip).join('') || '<div class="strip-none">None inbound.</div>'}
        <div class="strip-h"><span>Departures</span><span>${dep.length}</span></div>
        ${dep.map(strip).join('') || '<div class="strip-none">Nobody waiting.</div>'}`;
}

function renderHud() {
    const z = new Date(G.zulu0 + G.t * 1000);
    const zulu = String(z.getUTCHours()).padStart(2, '0') + String(z.getUTCMinutes()).padStart(2, '0') + 'Z';
    $('#hud').innerHTML = `<b>${G.world.icao}</b> ${zulu}<br>`
        + `WIND <b>${hdg3(G.wind.dir)}/${String(G.wind.spd).padStart(2, '0')}</b><br>`
        + `ARR <b>${G.active.arr.map(e => e.id).join(' ')}</b><br>`
        + `DEP <b>${G.active.dep.map(e => e.id).join(' ')}</b><br>`
        + `EXIT <b>${alt3(G.world.exitAlt)}+</b> · MVA <b>${alt3(G.world.minAlt)}</b>`;
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
        else if (t === 'HOLD' || t === 'HR') c.hold = 'R';
        else if (t === 'HL') c.hold = 'L';
        else if (G.world.fixes.some(f => f.name === t)) c.direct = G.world.fixes.find(f => f.name === t);
        else { sys(`Didn't understand "${t}".`); return; }
    }
    if ('ils' in c && !c.ils) { sys('No such runway.'); return; }
    if ('direct' in c && !c.direct) { sys('No such fix.'); return; }
    // Takeoff goes last so its own heading/altitude ride along.
    const takeoff = c.takeoff; delete c.takeoff;
    if (Object.keys(c).length) issue(ac, c);
    if (takeoff) issue(ac, { takeoff: true });
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

function startGame(airport, level) {
    store.set('last', airport.icao);
    store.set('level', level);
    $('#start').hidden = true;
    $('#game').hidden = false;
    window.scrollTo(0, 0);
    $('#summary').hidden = true;
    $('#log').innerHTML = '';
    nextId = 1;
    newGame(airport, level);
    fitView();
    resetView();
    setSpeed(1);
    cardKey = '';
    renderCard(true);
    sys(`${airport.icao} approach is open. Landing ${G.active.arr.map(e => e.id).join(', ')}, departing ${G.active.dep.map(e => e.id).join(', ')}. Departures exit at ${fmtAlt(G.world.exitAlt)} or above.`);
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
