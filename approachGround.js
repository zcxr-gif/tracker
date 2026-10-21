/**
 * approachGround.js — the airport surface for Approach (approachGame.js).
 *
 * Turns the field's OpenStreetMap layout (airportLayout.js's getLayout: the
 * taxiways, taxilanes, aprons and gates the live map draws) into a taxi
 * network the game can route on:
 *
 *   - a graph of taxiway nodes, joined where OSM ways share a point;
 *   - gates, each tied to the nearest taxiway node;
 *   - per runway end, a hold-short point (where departures wait) and the
 *     exits arrivals can turn off at;
 *   - shortest routes between any two of those, with the taxiway names to
 *     read out ("A, B, K") and every runway the route crosses.
 *
 * Everything is in the game's local plane: nautical miles from the airport
 * reference point, x east, y north.
 */

const FT_PER_NM = 6076;

/** Distance from point p to segment a–b, and how far along a–b (0..1) the foot is. */
function toSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return { d: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t };
}

/** Where segments p1–p2 and q1–q2 cross, as a fraction along p1–p2, or -1. */
function crossAt(p1, p2, q1, q2) {
    const r = { x: p2.x - p1.x, y: p2.y - p1.y }, s = { x: q2.x - q1.x, y: q2.y - q1.y };
    const den = r.x * s.y - r.y * s.x;
    if (Math.abs(den) < 1e-12) return -1;
    const t = ((q1.x - p1.x) * s.y - (q1.y - p1.y) * s.x) / den;
    const u = ((q1.x - p1.x) * r.y - (q1.y - p1.y) * r.x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

const SNAP_NM = 0.006;      // ~11 m: points this close are one junction

/**
 * Taxiway lines -> a routable graph. OSM ways share their junction points,
 * but vector tiles cut lines at tile edges and simplify them, so pieces end
 * a few metres apart and cross without a shared point. So: split every
 * segment where it crosses another, join line ends that stop on (or just
 * short of) another line, and merge points within ~11 m into one node.
 */
function network(lines) {
    const segs = [];
    for (const l of lines) {
        const cost = l.kind === 'taxilane' ? 1.4 : 1;
        for (let i = 1; i < l.pts.length; i++) {
            const a = l.pts[i - 1], b = l.pts[i];
            if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) continue;
            segs.push({ a, b, name: l.name, cost, cuts: [0, 1] });
        }
    }
    // Spatial grid of segments, 0.1 NM cells.
    const CELL = 0.1, grid = new Map();
    const cellsOf = sg => {
        const out = [];
        const x0 = Math.floor((Math.min(sg.a.x, sg.b.x) - SNAP_NM) / CELL), x1 = Math.floor((Math.max(sg.a.x, sg.b.x) + SNAP_NM) / CELL);
        const y0 = Math.floor((Math.min(sg.a.y, sg.b.y) - SNAP_NM) / CELL), y1 = Math.floor((Math.max(sg.a.y, sg.b.y) + SNAP_NM) / CELL);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(x + ',' + y);
        return out;
    };
    segs.forEach((sg, i) => { for (const c of cellsOf(sg)) { if (!grid.has(c)) grid.set(c, []); grid.get(c).push(i); } });
    const near = sg => { const set = new Set(); for (const c of cellsOf(sg)) for (const j of grid.get(c) || []) set.add(j); return set; };
    segs.forEach((sg, i) => {
        for (const j of near(sg)) {
            if (j <= i) continue;
            const o = segs[j];
            const t = crossAt(sg.a, sg.b, o.a, o.b);
            if (t > 0 && t < 1) {
                sg.cuts.push(t);
                const u = toSegment({ x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t }, o.a, o.b).t;
                if (u > 0 && u < 1) o.cuts.push(u);
            }
        }
        // Ends that stop on (or a few metres short of) another line join it there.
        for (const end of [sg.a, sg.b]) {
            for (const j of near(sg)) {
                if (j === i) continue;
                const o = segs[j], f = toSegment(end, o.a, o.b);
                if (f.d < SNAP_NM && f.t > 0.001 && f.t < 0.999) o.cuts.push(f.t);
            }
        }
    });
    // Points -> nodes, merging anything within SNAP_NM.
    const list = [], pgrid = new Map();
    const nodeAt = (x, y) => {
        const cx = Math.floor(x / SNAP_NM), cy = Math.floor(y / SNAP_NM);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            for (const n of pgrid.get((cx + dx) + ',' + (cy + dy)) || []) if (Math.hypot(n.x - x, n.y - y) < SNAP_NM) return n;
        }
        const n = { id: list.length, x, y, edges: [] };
        list.push(n);
        const k = cx + ',' + cy;
        if (!pgrid.has(k)) pgrid.set(k, []);
        pgrid.get(k).push(n);
        return n;
    };
    for (const sg of segs) {
        const ts = [...new Set(sg.cuts)].sort((p, q) => p - q);
        let prev = null;
        for (const t of ts) {
            const n = nodeAt(sg.a.x + (sg.b.x - sg.a.x) * t, sg.a.y + (sg.b.y - sg.a.y) * t);
            if (prev && prev !== n && !prev.edges.some(e => e.to === n.id)) {
                const w = Math.hypot(prev.x - n.x, prev.y - n.y) * sg.cost;
                prev.edges.push({ to: n.id, w, name: sg.name });
                n.edges.push({ to: prev.id, w, name: sg.name });
            }
            prev = n;
        }
    }
    return list;
}

/**
 * Build the surface model. Returns { error } when the layout has too little
 * to taxi on, saying what was missing, so the game can tell the player.
 * @param layout  GeoJSON FeatureCollection from AirportLayoutManager.getLayout
 * @param proj    (lat, lon) -> {x, y} in NM
 * @param ends    the game's runway ends ({ id, thr, far, course, len, phys, width })
 */
export function buildGround(layout, proj, ends) {
    if (!layout || !layout.features) return { error: 'no layout data came back' };
    const lines = [], aprons = [], gatesRaw = [];
    for (const f of layout.features) {
        const p = f.properties || {}, g = f.geometry;
        if (!g) continue;
        if ((p.aeroway === 'taxiway' || p.aeroway === 'taxilane') && g.type === 'LineString') {
            const pts = g.coordinates.map(([lon, lat]) => proj(lat, lon));
            if (pts.length >= 2) lines.push({ name: String(p.ref || p.name || '').trim(), kind: p.aeroway, pts });
        } else if (p.aeroway === 'apron' && g.type === 'Polygon') {
            aprons.push(g.coordinates[0].map(([lon, lat]) => proj(lat, lon)));
        } else if ((p.aeroway === 'gate' || p.aeroway === 'parking_position') && g.type === 'Point') {
            const [lon, lat] = g.coordinates;
            gatesRaw.push({ ref: String(p.ref || p.name || '').trim(), ...proj(lat, lon), gate: p.aeroway === 'gate' });
        }
    }
    const list = network(lines);
    if (list.length < 10) return { error: `only ${lines.length} taxiways mapped (${list.length} points)` };

    // Keep the biggest connected network; stray fragments can't be reached.
    const comp = new Int32Array(list.length).fill(-1);
    let best = -1, bestSize = 0;
    for (let c = 0, s = 0; s < list.length; s++) {
        if (comp[s] >= 0) continue;
        let size = 0;
        const stack = [s]; comp[s] = c;
        while (stack.length) { const n = list[stack.pop()]; size++; for (const e of n.edges) if (comp[e.to] < 0) { comp[e.to] = c; stack.push(e.to); } }
        if (size > bestSize) { bestSize = size; best = c; }
        c++;
    }
    const main = list.filter(n => comp[n.id] === best);
    if (main.length < 10) return { error: 'the taxiways are mapped in pieces that never join up' };

    const physRunways = [];
    for (const e of ends) if (!physRunways.some(r => r.phys === e.phys)) physRunways.push({ phys: e.phys, a: e.thr, b: e.far, half: e.width / 2, label: `${e.id}/${e.opp.id}` });
    // The runway database and OSM can disagree on a centerline by tens of metres: be generous.
    const onRunway = p => physRunways.some(r => { const s = toSegment(p, r.a, r.b); return s.d < r.half + 0.02 && s.t > 0 && s.t < 1; });

    // Gates: tied to the nearest network node within ~250 m, off the runways.
    const nearest = (p, max, filter) => {
        let bn = null, bd = max;
        for (const n of main) { if (filter && !filter(n)) continue; const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; bn = n; } }
        return bn;
    };
    const gates = [];
    const seenRef = new Set();
    // Gates are often mapped at the terminal, a few hundred metres from the nearest taxilane.
    for (const g of gatesRaw.sort((a, b) => b.gate - a.gate)) {
        if (onRunway(g)) continue;
        const n = nearest(g, 0.35, n => !onRunway(n));
        if (!n) continue;
        const ref = g.ref || `S${gates.length + 1}`;
        if (seenRef.has(ref)) continue;
        seenRef.add(ref);
        gates.push({ ref, x: g.x, y: g.y, node: n.id });
    }
    // No usable gates: park on the aprons instead, at the network point nearest each apron's middle.
    if (gates.length < 3) {
        for (const poly of aprons) {
            const c = poly.reduce((t, p) => ({ x: t.x + p.x / poly.length, y: t.y + p.y / poly.length }), { x: 0, y: 0 });
            const n = nearest(c, 0.5, n => !onRunway(n));
            if (n && !gates.some(g => g.node === n.id)) gates.push({ ref: `R${gates.length + 1}`, x: n.x, y: n.y, node: n.id });
        }
    }
    // Still nothing: dead-end taxilanes off the runways are stands too.
    if (gates.length < 3) {
        for (const n of main) {
            if (n.edges.length === 1 && !onRunway(n)) gates.push({ ref: `R${gates.length + 1}`, x: n.x, y: n.y, node: n.id });
            if (gates.length >= 12) break;
        }
    }
    if (gates.length < 3) return { error: `nowhere to park (${gatesRaw.length} gates mapped, none near a taxiway)` };

    // Per runway end: where departures hold short, and where arrivals can turn off.
    const holds = new Map(), exits = new Map();
    for (const e of ends) {
        const c = e.course * Math.PI / 180, ux = Math.sin(c), uy = Math.cos(c);
        const geo = n => {
            const dx = n.x - e.thr.x, dy = n.y - e.thr.y;
            return { along: dx * ux + dy * uy, lat: Math.abs(dx * uy - dy * ux) };
        };
        const half = e.width / 2;
        let hold = null, hb = Infinity;
        const ex = [];
        for (const n of main) {
            const g = geo(n);
            const beside = g.lat > half + 0.02 && g.lat < 0.25;
            if (!beside) continue;
            // A node beside the runway that leads onto it is a taxiway meeting the runway.
            const meets = n.edges.some(ed => { const m = list[ed.to]; return geo(m).lat < half + 0.03; });
            if (g.along > -0.15 && g.along < 0.45) {
                const score = Math.max(0, g.along) + g.lat * 0.5 + (meets ? 0 : 0.3);
                if (score < hb) { hb = score; hold = { node: n.id, along: Math.max(0, g.along) }; }
            }
            if (meets && g.along > 0.45 && g.along < e.len - 0.1) ex.push({ node: n.id, along: g.along });
        }
        if (hold) holds.set(e, hold);
        exits.set(e, ex.sort((a, b) => a.along - b.along));
    }

    return { nodes: list, main, gates, holds, exits, lines, aprons, physRunways, onRunway,
        summary: `${lines.length} taxiway segments, ${gates.length} ${gatesRaw.length >= 3 ? 'gates' : 'apron stands'}, holding points at ${holds.size} of ${ends.length} runway ends` };
}

/** Nearest node of the main network to a point (optionally off the runways). */
export function nearestNode(ground, p, offRunway = true) {
    let bn = null, bd = Infinity;
    for (const n of ground.main) {
        if (offRunway && ground.onRunway(n)) continue;
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < bd) { bd = d; bn = n; }
    }
    return bn;
}

/**
 * Shortest route from node a to node b: the points to follow, the taxiway
 * names in order, and each runway it crosses with where to stop short of it.
 * `avoid` (node ids) costs extra, for routing round a blockage.
 */
export function route(ground, a, b, avoid) {
    const N = ground.nodes;
    const dist = new Float64Array(N.length).fill(Infinity), prev = new Int32Array(N.length).fill(-1);
    const via = new Array(N.length);
    dist[a] = 0;
    // Binary-heap Dijkstra.
    const heap = [[0, a]];
    const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
        const [d, u] = pop();
        if (d > dist[u]) continue;
        if (u === b) break;
        for (const e of N[u].edges) {
            const w = e.w * (avoid && avoid.has(e.to) ? 25 : 1);
            if (d + w < dist[e.to]) { dist[e.to] = d + w; prev[e.to] = u; via[e.to] = e.name; push(d + w, e.to); }
        }
    }
    if (!isFinite(dist[b])) return null;
    const ids = [];
    for (let v = b; v !== -1; v = prev[v]) ids.push(v);
    ids.reverse();
    const pts = ids.map(i => ({ x: N[i].x, y: N[i].y }));
    const names = [];
    for (let i = 1; i < ids.length; i++) {
        const n = via[ids[i]];
        if (n && names[names.length - 1] !== n) names.push(n);
    }
    return withCrossings(ground, { pts, names, ids });
}

/** Cumulative distances along a route, and the runways it crosses with stop points. */
export function withCrossings(ground, r) {
    const cum = [0];
    for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y));
    r.cum = cum; r.len = cum[cum.length - 1];
    r.crossings = [];
    for (const rw of ground.physRunways) {
        for (let i = 1; i < r.pts.length; i++) {
            const t = crossAt(r.pts[i - 1], r.pts[i], rw.a, rw.b);
            if (t < 0) continue;
            const s = cum[i - 1] + t * (cum[i] - cum[i - 1]);
            // Stop clear of the runway edge, about where the hold-short line is painted.
            const stopS = Math.max(0, s - rw.half - 0.04);
            if (!r.crossings.some(c => c.phys === rw.phys && Math.abs(c.s - s) < 0.1)) {
                r.crossings.push({ phys: rw.phys, label: rw.label, s, stopS, clearS: s + rw.half + 0.03, cleared: false, asked: false });
            }
            break;
        }
    }
    r.crossings.sort((a, b) => a.s - b.s);
    return r;
}

/** The point and heading at distance s along a route. */
export function pointAt(r, s) {
    const { pts, cum } = r;
    if (s <= 0) return { x: pts[0].x, y: pts[0].y, i: 1 };
    for (let i = 1; i < pts.length; i++) {
        if (cum[i] >= s) {
            const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
            return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t, i };
        }
    }
    const l = pts[pts.length - 1];
    return { x: l.x, y: l.y, i: pts.length - 1 };
}

export const NM_PER_FT = 1 / FT_PER_NM;
