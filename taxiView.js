/**
 * taxiView.js — the way a flight taxied, at a glance.
 *
 * Reads the flight's position history (the same /history trail the graph and
 * the legs detector use) and pulls out the ground movement at each end:
 *
 *   • taxi-out — from the first fix (usually the gate) to the start of the
 *     takeoff roll, plus the roll itself so the runway can be named;
 *   • taxi-in  — once the flight has landed, from the end of the landing
 *     roll to wherever it is now (or where it parked).
 *
 * Then draws it as a small airport diagram: the field's runways from the
 * runway database, the taxiway network once the OSM layout is to hand
 * (airportLayout.js), and the path itself on top — and names the taxiways
 * the path ran along ("A → B → K").
 *
 * Pure and dependency-free so it runs (and is tested) in Node; flight.js owns
 * the airport and runway lookups and the card around the drawing.
 *
 * Exposes window.TaxiView = { extract, runwayFor, analyse, taxiwaysUsed, renderSVG, fmtDur }.
 */
(function (global) {
    'use strict';

    // Same cut as flight-legs.js: at or below this the aircraft is on the
    // ground. A takeoff roll passes it within seconds; no airliner taxis at it.
    const GROUND_GS_KT = 40;
    // Moving at all (pushback included) rather than parked with a jittery fix.
    const MOVING_GS_KT = 3;
    // Above the ground segment's own altitude by this much and the roll is over.
    const ROLL_CEILING_FT = 150;
    // Less than this along the ground and it never really taxied.
    const MIN_TAXI_KM = 0.05;
    // A landing only counts if the flight was properly airborne before it.
    const MIN_AIRBORNE_GAIN_FT = 800;
    // How far off a runway's centreline the roll may sit and still be on it.
    const RUNWAY_MATCH_M = 250;

    function haversineKm(lat1, lon1, lat2, lon2) {
        const R = 6371, toRad = (d) => d * Math.PI / 180;
        const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function pathKm(pts) {
        let km = 0;
        for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
        return km;
    }

    const isGround = (s) => s.gs != null && s.gs <= GROUND_GS_KT;
    const minAlt = (pts) => pts.reduce((m, s) => (s.alt != null && s.alt < m ? s.alt : m), Infinity);

    // The run of samples from `from` stepping by `dir` that are still fast and
    // still low: the takeoff roll (dir +1) or the landing roll (dir -1).
    function rollFrom(samples, from, dir, groundAlt) {
        const roll = [];
        for (let i = from; i >= 0 && i < samples.length; i += dir) {
            const s = samples[i];
            if (isGround(s)) break;
            if (isFinite(groundAlt) && s.alt != null && s.alt > groundAlt + ROLL_CEILING_FT) break;
            roll.push(s);
        }
        return dir < 0 ? roll.reverse() : roll;
    }

    function summarise(kind, ground, roll, ongoing) {
        const firstMove = ground.findIndex((s) => s.gs != null && s.gs >= MOVING_GS_KT);
        const moving = firstMove < 0 ? [] : ground.slice(firstMove);
        const km = pathKm(kind === 'out' ? moving : ground);
        if (km < MIN_TAXI_KM && !roll.length) return null;
        let startT, endT;
        if (kind === 'out') {
            startT = firstMove < 0 ? null : ground[firstMove].t;
            endT = roll.length ? roll[0].t : ground[ground.length - 1].t;
        } else {
            startT = roll.length ? roll[roll.length - 1].t : ground[0].t;
            // Taxi-in ends when it stops for good; while still rolling, it is now.
            let last = ground.length - 1;
            if (!ongoing) while (last > 0 && (ground[last].gs == null || ground[last].gs < MOVING_GS_KT)) last--;
            endT = ground[last].t;
        }
        const minutes = (startT != null && endT != null && endT >= startT) ? (endT - startT) / 60000 : null;
        return { kind, path: ground, roll, distanceKm: km, minutes, ongoing: !!ongoing };
    }

    /**
     * Ground movement at each end of the trail.
     * @param {Array} samples - normalised trail ({ t, lat, lon, alt, gs }, oldest
     *   first) — FlightLegs.normalize() produces exactly this.
     * @returns {{ out: object|null, in: object|null }} each with path (ground
     *   samples), roll (takeoff/landing roll samples), distanceKm, minutes and
     *   ongoing (still taxiing).
     */
    function extract(samples) {
        const res = { out: null, in: null };
        if (!Array.isArray(samples) || samples.length < 2) return res;

        // Taxi-out: only when the trail starts on the ground.
        let takeoff = -1;
        if (isGround(samples[0])) {
            takeoff = samples.findIndex((s) => s.gs != null && s.gs > GROUND_GS_KT);
            const ground = takeoff < 0 ? samples.slice() : samples.slice(0, takeoff);
            const roll = takeoff < 0 ? [] : rollFrom(samples, takeoff, 1, minAlt(ground));
            if (ground.length >= 2) res.out = summarise('out', ground, roll, takeoff < 0);
        }
        if (takeoff < 0 && isGround(samples[0])) return res;   // has not taken off yet

        // Taxi-in: on the ground after the last fast sample, having flown.
        let landing = -1;
        for (let i = samples.length - 1; i >= 0; i--) {
            if (samples[i].gs != null && samples[i].gs > GROUND_GS_KT) { landing = i; break; }
        }
        if (landing < 0 || landing >= samples.length - 1) return res;
        const ground = samples.slice(landing + 1);
        if (!ground.every(isGround)) return res;
        const gAlt = minAlt(ground);
        const flown = samples.slice(Math.max(0, takeoff), landing + 1);
        const peak = flown.reduce((m, s) => (s.alt != null && s.alt > m ? s.alt : m), -Infinity);
        if (!(isFinite(gAlt) && isFinite(peak) && peak - gAlt >= MIN_AIRBORNE_GAIN_FT)) return res;
        const roll = rollFrom(samples, landing, -1, gAlt);
        const last = ground[ground.length - 1];
        res.in = summarise('in', ground, roll, last.gs != null && last.gs >= MOVING_GS_KT);
        return res;
    }

    // --- Runways -------------------------------------------------------------

    function rwyEnds(r) {
        const la = Number(r.le_latitude_deg), lo = Number(r.le_longitude_deg);
        const ha = Number(r.he_latitude_deg), ho = Number(r.he_longitude_deg);
        if (![la, lo, ha, ho].every(isFinite)) return null;
        return { le: { lat: la, lon: lo }, he: { lat: ha, lon: ho } };
    }

    // Local flat projection in metres around a reference latitude.
    function projector(lat0, lon0) {
        const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
        const fwd = (lat, lon) => ({ x: (lon - lon0) * kx, y: -(lat - lat0) * ky });
        fwd.inv = (x, y) => ({ lat: lat0 - y / ky, lon: lon0 + x / kx });
        return fwd;
    }

    // Slippy-map tile maths (Web Mercator, as every imagery server uses).
    const lon2tile = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
    const lat2tile = (lat, z) => {
        const r = lat * Math.PI / 180;
        return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
    };
    const tile2lon = (x, z) => x / 2 ** z * 360 - 180;
    const tile2lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;
    // Most tiles one drawing will ask for.
    const MAX_TILES = 48;

    /**
     * The runway a takeoff or landing roll was on, and which end.
     * @param {Array} runways - runway records (runwaysData[icao]).
     * @param {Array} roll - roll samples, in time order.
     * @param {object} [lead] - the sample just before the roll, for direction
     *   when the roll is a single fix.
     * @returns {{ ident: string, runway: object }|null}
     */
    function runwayFor(runways, roll, lead) {
        if (!Array.isArray(runways) || !roll || !roll.length) return null;
        const pts = lead ? [lead, ...roll] : roll;
        const P = projector(roll[0].lat, roll[0].lon);
        const xy = pts.map((s) => P(s.lat, s.lon));
        let best = null;
        for (const r of runways) {
            if (r.closed === 1 || r.closed === '1') continue;
            const e = rwyEnds(r);
            if (!e) continue;
            const a = P(e.le.lat, e.le.lon), b = P(e.he.lat, e.he.lon);
            const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
            if (!len2) continue;
            let sum = 0;
            for (let i = lead ? 1 : 0; i < xy.length; i++) {
                const p = xy[i];
                const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
                sum += Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
            }
            const off = sum / (xy.length - (lead ? 1 : 0));
            if (off <= RUNWAY_MATCH_M && (!best || off < best.off)) best = { r, off, dx, dy };
        }
        if (!best) return null;
        // Moving low-end → high-end means using the low end's designator.
        const first = xy[0], last = xy[xy.length - 1];
        const mx = last.x - first.x, my = last.y - first.y;
        const along = mx * best.dx + my * best.dy;
        const ident = (along >= 0 ? best.r.le_ident : best.r.he_ident) || best.r.le_ident || best.r.he_ident || '';
        return { ident: String(ident), runway: best.r };
    }

    // --- Taxiways, stops and timing -------------------------------------------

    // The path is sampled every few hundred metres, so it is walked at this
    // spacing (straight between fixes, time interpolated) and each step
    // matched to the nearest named taxiway centreline.
    const STEP_M = 12;
    // Further than this from every centreline and the step is on an apron,
    // a stand or a runway — not on a named taxiway.
    const TWY_MATCH_M = 40;
    // A stretch on one taxiway shorter than this is the path cutting across
    // it at a junction, not taxiing along it; it is folded into its neighbour.
    const TWY_MIN_RUN_M = 90;
    // Sitting still for at least this long counts as a stop (a hold, a
    // give-way, a wait for clearance).
    const STOP_MIN_MS = 15 * 1000;
    // A stop this close to where the roll began is holding short / lining up.
    const HOLD_SHORT_M = 250;

    // Pushback: slow (a tug, not engines), short, straight off the gate, and
    // ending in a stop or a change of direction as the aircraft turns to taxi
    // forwards.
    const PUSH_MAX_GS_KT = 8;
    const PUSH_MIN_M = 8, PUSH_MAX_M = 250;
    // The taxi heads off at least this far from the push direction — less if
    // the push ended in a stop (the tug disconnecting), more if it didn't.
    const PUSH_TURN_STOPPED_DEG = 60, PUSH_TURN_DEG = 100;
    // Snapping: a step is moved onto its taxiway only if the centreline is
    // this close, and never if that would make it jump further than it moved.
    const SNAP_MAX_M = TWY_MATCH_M * 1.5;
    const SNAP_JUMP_M = 25;
    // Rounding: a turn sharper than this over a stretch shorter than
    // SPIKE_M is a snapping artefact, not a manoeuvre an aircraft can make.
    const SPIKE_DEG = 120, SPIKE_M = 40;
    const KT = 1852 / 3600;   // m/s per knot

    /**
     * Everything the card says about a ground path, in one pass.
     * @param {object} seg - an extract() result's out or in.
     * @param {object} [layout] - airportLayout.js GeoJSON; taxiway/taxilane
     *   LineStrings carry their OSM `ref` ("A", "K3", …). Without it the
     *   legs are unnamed and the path is drawn as flown, but the timing,
     *   stops and ticks still work.
     * @returns {object}
     *   legs     — the route in order: { ref|null, t0, t1, m, at, stops: [] };
     *   stops    — { lat, lon, t0, t1, ms, ref, holdShort };
     *   ticks    — one per elapsed minute: { lat, lon, dx, dy, minute };
     *   pushback — { t0, t1, m, at } or null;
     *   times    — { pushback, taxi, takeoff, landed, parked } (ms, or null);
     *   route    — what to draw: { push: [{lat, lon}], taxi: [{lat, lon}] },
     *              the taxi part following the taxiway centrelines, its turns
     *              rounded. The rolls are never snapped.
     */
    function analyse(seg, layout) {
        const empty = { legs: [], stops: [], ticks: [], startT: null, endT: null, stoppedMs: 0,
            pushback: null, times: {}, route: null };
        const path = seg && seg.path;
        if (!path || path.length < 2) return empty;

        // Only the moving part: from the last fix at the gate to the first
        // fix parked at the other end.
        const moving = (s) => s.gs != null && s.gs >= MOVING_GS_KT;
        let i0 = 0, i1 = path.length - 1;
        const first = path.findIndex(moving);
        if (first < 0) return empty;
        if (seg.kind === 'out') i0 = Math.max(0, first - 1);
        if (seg.kind === 'in' && !seg.ongoing) {
            while (i1 > 0 && !moving(path[i1])) i1--;
            i1 = Math.min(path.length - 1, i1 + 1);
        }
        const pts = path.slice(i0, i1 + 1);
        if (pts.length < 2) return empty;

        const P = projector(pts[0].lat, pts[0].lon);
        const xy = pts.map((s) => ({ ...P(s.lat, s.lon), lat: s.lat, lon: s.lon, t: s.t, gs: s.gs }));
        const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
        // When it started moving towards fix b from a: b's time less the time
        // to cover the distance at b's speed, never before a.
        const departedAt = (a, b) => {
            const v = Math.max(MOVING_GS_KT, b.gs || 0) * KT;
            return Math.max(a.t, b.t - dist(a, b) / v);
        };

        // --- Pushback (taxi-out only) ---
        let push = null;
        if (seg.kind === 'out' && xy.length > 2 && !moving(xy[0])) {
            let j = 1;
            while (j < xy.length && moving(xy[j]) && xy[j].gs <= PUSH_MAX_GS_KT) j++;
            if (j > 1) {
                const stopped = j < xy.length && xy[j].gs != null && !moving(xy[j]);
                const endIdx = stopped ? j : j - 1;
                const end = xy[endIdx], len = dist(xy[0], end);
                let k = endIdx + 1;
                while (k < xy.length && dist(end, xy[k]) < 20) k++;
                let turn = 180;
                if (k < xy.length) {
                    const ux = end.x - xy[0].x, uy = end.y - xy[0].y, vx = xy[k].x - end.x, vy = xy[k].y - end.y;
                    const c = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
                    turn = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
                }
                if (len >= PUSH_MIN_M && len <= PUSH_MAX_M && turn >= (stopped ? PUSH_TURN_STOPPED_DEG : PUSH_TURN_DEG)) {
                    // The first fix that is really taxiing (moving on from the push end).
                    let m = endIdx + 1;
                    while (m < xy.length && !moving(xy[m])) m++;
                    push = { endIdx, end, m: len, t0: departedAt(xy[0], xy[1]), t1: end.t,
                        taxiT: m < xy.length ? departedAt(xy[m - 1], xy[m]) : null };
                }
            }
        }

        // Named centreline segments near the path, projected once.
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        xy.forEach((p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
        const pad = TWY_MATCH_M * 2;
        const segs = [];
        for (const f of ((layout && layout.features) || [])) {
            const g = f && f.geometry, p = (f && f.properties) || {};
            if (!g || g.type !== 'LineString' || (p.aeroway !== 'taxiway' && p.aeroway !== 'taxilane')) continue;
            const ref = String(p.ref || '').trim();
            if (!ref) continue;
            const c = g.coordinates.map(([lo, la]) => P(la, lo));
            for (let i = 1; i < c.length; i++) {
                const a = c[i - 1], b = c[i];
                if (Math.max(a.x, b.x) < x0 - pad || Math.min(a.x, b.x) > x1 + pad ||
                    Math.max(a.y, b.y) < y0 - pad || Math.min(a.y, b.y) > y1 + pad) continue;
                segs.push({ ref, a, b });
            }
        }
        // Nearest point on the centreline(s) — any, or one taxiway's.
        const nearest = (x, y, ref) => {
            let best = null;
            for (const s of segs) {
                if (ref && s.ref !== ref) continue;
                const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, len2 = dx * dx + dy * dy;
                const t = len2 ? Math.max(0, Math.min(1, ((x - s.a.x) * dx + (y - s.a.y) * dy) / len2)) : 0;
                const px = s.a.x + t * dx, py = s.a.y + t * dy, d = Math.hypot(x - px, y - py);
                if (!best || d < best.d) best = { x: px, y: py, d, ref: s.ref };
            }
            return best;
        };
        const nearestRef = (x, y) => { const n = nearest(x, y); return n && n.d < TWY_MATCH_M ? n.ref : null; };

        // Walk it in short steps, each with a position, a time and a taxiway.
        const steps = [];
        for (let i = 1; i < xy.length; i++) {
            const a = xy[i - 1], b = xy[i];
            const len = dist(a, b);
            const n = Math.max(1, Math.ceil(len / STEP_M));
            for (let k = (i === 1 ? 0 : 1); k <= n; k++) {
                const f = k / n;
                const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
                const t = a.t + (b.t - a.t) * f;
                const isPush = !!push && t <= push.t1;
                steps.push({ x, y, m: k ? len / n : 0, t, push: isPush, ref: isPush ? null : nearestRef(x, y) });
            }
        }
        const pushSteps = steps.filter((s) => s.push);
        const taxiSteps = steps.filter((s) => !s.push);
        if (!taxiSteps.length) taxiSteps.push(steps[steps.length - 1]);

        // Runs of one taxiway, then fold junction blips into their neighbour.
        const runs = [];
        for (const s of taxiSteps) {
            const last = runs[runs.length - 1];
            if (last && last.ref === s.ref) { last.m += s.m; last.pts.push(s); continue; }
            runs.push({ ref: s.ref, m: s.m, pts: [s] });
        }
        const legs = [];
        for (const r of runs) {
            const prev = legs[legs.length - 1];
            if (prev && (r.m < TWY_MIN_RUN_M || prev.ref === r.ref)) { prev.m += r.m; prev.pts.push(...r.pts); continue; }
            legs.push({ ref: r.ref, m: r.m, pts: r.pts.slice() });
        }
        // A short first stretch has nothing to fold into; give it to the next.
        if (legs.length > 1 && legs[0].m < TWY_MIN_RUN_M) {
            legs[1].m += legs[0].m; legs[1].pts.unshift(...legs[0].pts); legs.shift();
        }

        // Snap each leg's steps onto that leg's own taxiway — not merely the
        // nearest one, which flips at every junction and between close
        // parallel taxiways. A step stays where it was flown when the
        // centreline is far, or when snapping would make it jump.
        let prevRaw = null, prevOut = null;
        for (const l of legs) {
            for (const s of l.pts) {
                s.sx = s.x; s.sy = s.y;
                if (l.ref) {
                    const n = nearest(s.x, s.y, l.ref);
                    if (n && n.d <= SNAP_MAX_M && !(prevOut && Math.hypot(n.x - prevOut.x, n.y - prevOut.y) > dist(prevRaw, s) + SNAP_JUMP_M)) {
                        s.sx = n.x; s.sy = n.y;
                    }
                }
                prevRaw = s; prevOut = { x: s.sx, y: s.sy };
            }
        }
        const ll = (x, y) => P.inv(x, y);
        steps.forEach((s) => {
            const q = ll(s.sx != null ? s.sx : s.x, s.sy != null ? s.sy : s.y);
            s.lat = q.lat; s.lon = q.lon;
        });

        legs.forEach((l, i) => {
            l.t0 = l.pts[0].t;
            l.t1 = i + 1 < legs.length ? legs[i + 1].pts[0].t : l.pts[l.pts.length - 1].t;
            const mid = l.pts[Math.floor(l.pts.length / 2)];
            l.at = { lat: mid.lat, lon: mid.lon };
            l.stops = [];
            delete l.pts;
        });

        // Stops: fixes standing still for a while, between the first and last
        // move. The wait at the end of the pushback (engine start) belongs to
        // the pushback, not to the taxi.
        const stops = [];
        const firstMove = xy.findIndex(moving);
        for (let i = firstMove + 1; i < xy.length; i++) {
            if (moving(xy[i]) || xy[i].gs == null) continue;
            let j = i;
            while (j + 1 < xy.length && !moving(xy[j + 1]) && xy[j + 1].gs != null) j++;
            // Standing still at the end of the path: on a taxi-out that is
            // holding short, until the roll begins (or until now, if it hasn't
            // yet); on a taxi-in it is parked, which is not a stop.
            const atEnd = j + 1 >= xy.length;
            if (atEnd && seg.kind === 'in') break;
            const endT = !atEnd ? xy[j + 1].t
                : (seg.roll && seg.roll.length ? seg.roll[0].t : xy[j].t);
            const ms = endT - xy[i].t;
            if (ms >= STOP_MIN_MS && !(push && xy[i].t <= push.t1)) {
                const at = xy.slice(i, j + 1);
                let x = at.reduce((s, p) => s + p.x, 0) / at.length;
                let y = at.reduce((s, p) => s + p.y, 0) / at.length;
                const ref = nearestRef(x, y);
                // On the drawn (snapped) line, like the path through it.
                const n = ref && nearest(x, y, ref);
                if (n && n.d <= SNAP_MAX_M) { x = n.x; y = n.y; }
                const q = ll(x, y);
                stops.push({ lat: q.lat, lon: q.lon, t0: xy[i].t, t1: endT, ms, ref, holdShort: false });
            }
            i = j;
        }
        // The last stop before the roll, close to it, is holding short.
        if (seg.kind === 'out' && stops.length && seg.roll && seg.roll.length) {
            const s = stops[stops.length - 1], r = P(seg.roll[0].lat, seg.roll[0].lon), q = P(s.lat, s.lon);
            const lastFix = xy[xy.length - 1];
            if (Math.hypot(r.x - q.x, r.y - q.y) <= HOLD_SHORT_M + Math.hypot(lastFix.x - r.x, lastFix.y - r.y)) s.holdShort = true;
        }
        stops.forEach((s) => {
            const leg = legs.find((l) => s.t0 >= l.t0 && s.t0 <= l.t1) || legs[legs.length - 1];
            if (leg) leg.stops.push(s);
        });

        // A tick for every minute on the move, square to the path.
        const startT = steps[0].t, endT = steps[steps.length - 1].t;
        const ticks = [];
        for (let minute = 1, i = 1; i < steps.length; i++) {
            const tm = startT + minute * 60000;
            if (steps[i].t < tm) continue;
            const a = steps[i - 1], b = steps[i];
            const f = b.t > a.t ? (tm - a.t) / (b.t - a.t) : 1;
            // Direction from the nearest pair of steps that actually moved.
            let u = i, v = i - 1;
            const same = () => steps[u].lat === steps[v].lat && steps[u].lon === steps[v].lon;
            while (v > 0 && same()) v--;
            while (u < steps.length - 1 && same()) u++;
            ticks.push({
                lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f,
                dx: steps[u].lon - steps[v].lon, dy: steps[u].lat - steps[v].lat, minute,
            });
            minute++;
            i--;   // a long step can span several minutes
        }

        // What to draw: the push as flown; the taxi on its snapped steps,
        // cleared of spikes and with its corners rounded the way a nose-wheel
        // turn rounds them.
        const taxiXY = smoothPath(taxiSteps.map((s) => ({ x: s.sx != null ? s.sx : s.x, y: s.sy != null ? s.sy : s.y })));
        const pushXY = pushSteps.map((s) => ({ x: s.x, y: s.y }));
        if (pushXY.length && taxiXY.length) pushXY.push(taxiXY[0]);
        const route = {
            push: pushXY.map((p) => ll(p.x, p.y)),
            taxi: taxiXY.map((p) => ll(p.x, p.y)),
        };

        const times = {
            pushback: push ? push.t0 : null,
            // Without a pushback (powered out, or one too short to see), taxiing
            // starts when it first moves off the gate.
            taxi: push ? push.taxiT : (seg.kind === 'out' ? departedAt(xy[0], xy[1]) : steps[0].t),
            takeoff: seg.kind === 'out' && !seg.ongoing && seg.roll && seg.roll.length ? seg.roll[seg.roll.length - 1].t : null,
            landed: seg.kind === 'in' && seg.roll && seg.roll.length ? seg.roll[0].t : null,
            parked: seg.kind === 'in' && !seg.ongoing ? endT : null,
        };
        const pushback = push ? { t0: push.t0, t1: push.t1, m: push.m, at: { lat: push.end.lat, lon: push.end.lon } } : null;

        return { legs, stops, ticks, startT, endT, stoppedMs: stops.reduce((s, p) => s + p.ms, 0),
            pushback, times, route };
    }

    // Duplicate fixes out, spikes out, corners rounded (Chaikin), ends kept.
    function smoothPath(pts) {
        let p = [];
        for (const q of pts) {
            const l = p[p.length - 1];
            if (!l || Math.hypot(q.x - l.x, q.y - l.y) > 1) p.push(q);
        }
        const angle = (a, b, c) => {
            const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
            const cos = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1);
            return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
        };
        for (let changed = true; changed && p.length > 2;) {
            changed = false;
            for (let i = 1; i < p.length - 1; i++) {
                const a = p[i - 1], b = p[i], c = p[i + 1];
                if (angle(a, b, c) > SPIKE_DEG && Math.min(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y)) < SPIKE_M) {
                    p.splice(i, 1); changed = true; break;
                }
            }
        }
        for (let it = 0; it < 3 && p.length > 2; it++) {
            const q = [p[0]];
            for (let i = 0; i < p.length - 1; i++) {
                const a = p[i], b = p[i + 1];
                q.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
                    { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
            }
            q.push(p[p.length - 1]);
            p = q;
        }
        return p;
    }

    /**
     * The named taxiways a ground path used, in the order it used them.
     * @returns {Array<{ref: string, at: {lat: number, lon: number}}>} each
     *   taxiway once per stretch, with the middle of that stretch for its label.
     */
    function taxiwaysUsed(seg, layout, analysis) {
        const a = analysis || analyse(seg, layout);
        const out = [];
        for (const l of a.legs) {
            if (!l.ref || (out.length && out[out.length - 1].ref === l.ref)) continue;
            out.push({ ref: l.ref, at: l.at });
        }
        return out;
    }

    // --- Drawing -------------------------------------------------------------

    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /**
     * The diagram, as an SVG string. Colours come from classes (tv-*) so the
     * window's skin can restyle it.
     * @param {object} seg - an extract() result's out or in.
     * @param {object} [opts]
     * @param {Array}  [opts.runways] - runway records for the field.
     * @param {object} [opts.used] - runwayFor() result, highlighted.
     * @param {object} [opts.layout] - airportLayout.js GeoJSON (taxiways, aprons).
     * @param {Array}  [opts.taxiways] - taxiwaysUsed() result, highlighted and labelled.
     * @param {object} [opts.analysis] - analyse() result: minute ticks and stops.
     * @param {boolean} [opts.tall] - the enlarged, taller drawing.
     * @param {function} [opts.clock] - ms → clock text; when given, the
     *   pushback / taxi / takeoff (or landing / parking) times are tagged.
     * @param {string} [opts.tileUrl] - imagery tile template ({z}/{x}/{y});
     *   when given the drawing sits on satellite imagery instead of a plain
     *   background. Tiles are placed through the same projection as the
     *   path; at the size of an airport the difference from Web Mercator is
     *   well under a pixel.
     */
    /** A duration the way a person says it: "45s", "2m 10s", "1h 05m". */
    function fmtDur(ms) {
        const sec = Math.max(0, Math.round(ms / 1000));
        if (sec < 60) return `${sec}s`;
        const m = Math.floor(sec / 60), sc = sec % 60;
        if (m < 60) return sc ? `${m}m ${String(sc).padStart(2, '0')}s` : `${m}m`;
        return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
    }

    function renderSVG(seg, opts = {}) {
        if (!seg || !seg.path || !seg.path.length) return '';
        const W = 320, H = opts.tall ? 300 : 200;
        const ground = seg.path, roll = seg.roll || [];
        const all = ground.concat(roll);
        const lat0 = all.reduce((m, s) => m + s.lat, 0) / all.length;
        const lon0 = all.reduce((m, s) => m + s.lon, 0) / all.length;
        const P = projector(lat0, lon0);

        // Frame the taxi path and the runway end it met — the whole route,
        // as large as it fits. The runways and other taxiways are context and
        // run off the edge.
        const rollEnd = roll.length ? [seg.kind === 'out' ? roll[0] : roll[roll.length - 1]] : [];
        const frame = ground.concat(rollEnd).map((s) => P(s.lat, s.lon));
        let x0 = Math.min(...frame.map((p) => p.x)), x1 = Math.max(...frame.map((p) => p.x));
        let y0 = Math.min(...frame.map((p) => p.y)), y1 = Math.max(...frame.map((p) => p.y));
        // At least ~350 m across, padded, and in the drawing's aspect.
        const MIN = 350;
        if (x1 - x0 < MIN) { const c = (x0 + x1) / 2; x0 = c - MIN / 2; x1 = c + MIN / 2; }
        if (y1 - y0 < MIN * H / W) { const c = (y0 + y1) / 2; y0 = c - MIN * H / W / 2; y1 = c + MIN * H / W / 2; }
        const padX = (x1 - x0) * 0.14, padY = (y1 - y0) * 0.16;
        x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
        const scale = Math.min(W / (x1 - x0), H / (y1 - y0));
        const ox = (W - (x1 - x0) * scale) / 2 - x0 * scale;
        const oy = (H - (y1 - y0) * scale) / 2 - y0 * scale;
        const px = (lat, lon) => { const p = P(lat, lon); return [+(p.x * scale + ox).toFixed(1), +(p.y * scale + oy).toFixed(1)]; };
        const line = (pts) => pts.map((s) => px(s.lat, s.lon).join(',')).join(' ');

        const parts = [];

        // Satellite imagery underneath everything, sharp enough for a
        // high-density screen.
        const sat = !!opts.tileUrl;
        if (sat) {
            const inv = (sx, sy) => P.inv((sx - ox) / scale, (sy - oy) / scale);
            const nw = inv(0, 0), se = inv(W, H);
            // Zoom where a drawing unit gets ~3 tile pixels (phone screens are 2–3×).
            let z = Math.ceil(Math.log2(156543.03 * Math.cos(lat0 * Math.PI / 180) * scale * 3));
            z = Math.max(12, Math.min(19, z));
            const count = (zz) => (lon2tile(se.lon, zz) - lon2tile(nw.lon, zz) + 1) * (lat2tile(se.lat, zz) - lat2tile(nw.lat, zz) + 1);
            while (z > 12 && count(z) > MAX_TILES) z--;
            for (let ty = lat2tile(nw.lat, z); ty <= lat2tile(se.lat, z); ty++) {
                for (let tx = lon2tile(nw.lon, z); tx <= lon2tile(se.lon, z); tx++) {
                    const [ax, ay] = px(tile2lat(ty, z), tile2lon(tx, z));
                    const [bx, by] = px(tile2lat(ty + 1, z), tile2lon(tx + 1, z));
                    const href = opts.tileUrl.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
                    // A hair of overlap so no seam shows between tiles.
                    parts.push(`<image href="${esc(href)}" x="${(ax - 0.3).toFixed(1)}" y="${(ay - 0.3).toFixed(1)}" width="${(bx - ax + 0.6).toFixed(1)}" height="${(by - ay + 0.6).toFixed(1)}" preserveAspectRatio="none"/>`);
                }
            }
            // A light veil so the path and labels read over any imagery.
            parts.push(`<rect class="tv-veil" x="0" y="0" width="${W}" height="${H}"/>`);
        }
        const usedRefs = new Set((opts.taxiways || []).map((t) => t.ref));

        // Taxiway network and aprons, faint, when the OSM layout is to hand.
        const feats = (opts.layout && opts.layout.features) || [];
        const ring = (coords) => coords.map(([lo, la]) => px(la, lo).join(',')).join(' ');
        const inView = (coords) => coords.some(([lo, la]) => { const [x, y] = px(la, lo); return x > -W && x < 2 * W && y > -H && y < 2 * H; });
        for (const f of feats) {
            const g = f && f.geometry, kind = f && f.properties && f.properties.aeroway;
            if (!g || kind === 'runway' || kind === 'gate' || kind === 'parking_position') continue;
            if (g.type === 'Polygon' && g.coordinates[0] && inView(g.coordinates[0])) {
                parts.push(`<polygon class="tv-apron" points="${ring(g.coordinates[0])}"/>`);
            } else if (g.type === 'LineString' && (kind === 'taxiway' || kind === 'taxilane') && inView(g.coordinates)) {
                const used = usedRefs.has(String(f.properties.ref || '').trim());
                parts.push(`<polyline class="tv-twy${used ? ' tv-twy-used' : ''}" points="${ring(g.coordinates)}"/>`);
            }
        }

        // Labels are placed last, most important first, each at the first of
        // its candidate spots that is on the drawing and clear of the others.
        const labels = [];
        const placed = [];
        const box = (x, y, w, h) => ({ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 });
        const clear = (b) => b.x0 >= 1 && b.x1 <= W - 1 && b.y0 >= 1 && b.y1 <= H - 1 &&
            !placed.some((q) => !(b.x1 < q.x0 || b.x0 > q.x1 || b.y1 < q.y0 || b.y0 > q.y1));
        const place = (spots, w, h, draw) => {
            for (const [x, y] of spots) {
                const b = box(x, y, w, h);
                if (!clear(b)) continue;
                placed.push(b);
                labels.push(draw(x, y));
                return true;
            }
            return false;
        };
        const rwyIds = [];

        // Runways at their real width (never thinner than a few px).
        for (const r of (opts.runways || [])) {
            const e = rwyEnds(r);
            if (!e) continue;
            const used = opts.used && opts.used.runway === r;
            const [ax, ay] = px(e.le.lat, e.le.lon), [bx, by] = px(e.he.lat, e.he.lon);
            const w = Math.max(4, (Number(r.width_ft) || 150) * 0.3048 * scale);
            parts.push(`<line class="tv-rwy${used ? ' tv-rwy-used' : ''}" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke-width="${w.toFixed(1)}"/>`);
            parts.push(`<line class="tv-rwy-cl" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"/>`);
            // Designators just beyond each end, when that end is on screen.
            const len = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / len, uy = (by - ay) / len;
            [[ax, ay, -1, r.le_ident], [bx, by, 1, r.he_ident]].forEach(([x, y, d, id]) => {
                if (id) rwyIds.push({ x: x + ux * d * 11, y: y + uy * d * 11, id: String(id), used });
            });
        }

        // The path: the taxi along the taxiways (analyse()'s route, snapped
        // and rounded) or as flown when there is no layout; the pushback as a
        // dashed tail off the gate; the roll dashed along the runway — the
        // rolls and the push are never snapped.
        const route = opts.analysis && opts.analysis.route;
        const taxi = route && route.taxi && route.taxi.length > 1 ? route.taxi : ground;
        const pushTail = route && route.push && route.push.length > 1 ? route.push : null;
        const rollLine = seg.kind === 'out'
            ? [taxi[taxi.length - 1]].concat(roll)
            : roll.concat([taxi[0]]);
        if (roll.length) parts.push(`<polyline class="tv-roll" points="${line(rollLine)}"/>`);
        if (pushTail) parts.push(`<polyline class="tv-push" points="${line(pushTail)}"/>`);
        parts.push(`<polyline class="tv-path-halo" points="${line(taxi)}"/>`);
        parts.push(`<polyline class="tv-path" points="${line(taxi)}"/>`);

        // Gate end: a hollow ring. Runway end / current position: a filled dot.
        const gate = seg.kind === 'out' ? (pushTail || taxi)[0] : taxi[taxi.length - 1];
        const [gx, gy] = px(gate.lat, gate.lon);
        const tip = seg.kind === 'out'
            ? (roll.length ? roll[roll.length - 1] : ground[ground.length - 1])
            : (roll.length ? roll[0] : ground[0]);
        const [tx, ty] = px(tip.lat, tip.lon);
        if (seg.kind === 'in' && seg.ongoing) {
            parts.push(`<circle class="tv-now" cx="${gx}" cy="${gy}" r="5"/>`);
        } else {
            parts.push(`<circle class="tv-gate" cx="${gx}" cy="${gy}" r="4.5"/>`);
        }
        if (seg.kind === 'out' && seg.ongoing) {
            const [nx, ny] = px(taxi[taxi.length - 1].lat, taxi[taxi.length - 1].lon);
            parts.push(`<circle class="tv-now" cx="${nx}" cy="${ny}" r="5"/>`);
        } else {
            parts.push(`<circle class="tv-tip" cx="${tx}" cy="${ty}" r="3.5"/>`);
        }

        // A tick across the path for every minute on the move, numbered
        // sparsely enough to stay legible; ticks piled up at a stop are drawn once.
        const ticks = (opts.analysis && opts.analysis.ticks) || [];
        const every = ticks.length <= 8 ? 1 : ticks.length <= 16 ? 2 : 5;
        let lastTick = null;
        const tickLabels = [];
        for (const t of ticks) {
            const [x, y] = px(t.lat, t.lon);
            if (lastTick && Math.hypot(x - lastTick[0], y - lastTick[1]) < 5) continue;
            const [bx, by] = px(t.lat + t.dy, t.lon + t.dx);
            const len = Math.hypot(bx - x, by - y);
            if (!len) continue;
            const nx = -(by - y) / len, ny = (bx - x) / len;
            parts.push(`<line class="tv-tick" x1="${(x - nx * 4.5).toFixed(1)}" y1="${(y - ny * 4.5).toFixed(1)}" x2="${(x + nx * 4.5).toFixed(1)}" y2="${(y + ny * 4.5).toFixed(1)}"/>`);
            if (t.minute % every === 0) tickLabels.push({ x, y, nx, ny, minute: t.minute });
            lastTick = [x, y];
        }

        // Where it stopped (the markers keep their own space clear).
        const stops = (opts.analysis && opts.analysis.stops) || [];
        const stopAt = stops.map((st) => {
            const [x, y] = px(st.lat, st.lon);
            parts.push(`<circle class="tv-stop${st.holdShort ? ' tv-stop-hold' : ''}" cx="${x}" cy="${y}" r="5.5"/>`);
            placed.push(box(x, y, 11, 11));
            return { x, y, st };
        });
        placed.push(box(gx, gy, 10, 10));

        // 1. How long each stop lasted, beside it.
        for (const { x, y, st } of stopAt) {
            const txt = fmtDur(st.ms), w = 8 + txt.length * 5.4, h = 13;
            const g = w / 2 + 8;
            place([[x, y - 13], [x, y + 13], [x + g, y], [x - g, y], [x + g, y - 12], [x - g, y + 12]], w, h, (lx, ly) =>
                `<g class="tv-stop-tag" transform="translate(${lx.toFixed(1)},${ly.toFixed(1)})"><rect x="${(-w / 2).toFixed(1)}" y="-6.5" width="${w.toFixed(1)}" height="13" rx="6.5"/><text y="3.2" text-anchor="middle">${esc(txt)}</text></g>`);
        }
        // 1b. The clock at each milestone: pushed back, started taxiing, took
        //     off (or landed and parked), where each happened.
        const times = (opts.analysis && opts.analysis.times) || {};
        if (typeof opts.clock === 'function') {
            const marks = seg.kind === 'out' ? [
                ['Push', times.pushback, pushTail ? pushTail[0] : null],
                ['Taxi', times.taxi, taxi[0]],
                // Tagged where the roll began: liftoff itself is off the drawing.
                ['T/O', times.takeoff, roll.length ? roll[0] : null],
            ] : [
                ['Land', times.landed, roll.length ? roll[0] : null],
                ['Park', times.parked, taxi[taxi.length - 1]],
            ];
            for (const [what, t, at] of marks) {
                if (t == null || !at) continue;
                const txt = `${what} ${opts.clock(t)}`, w = 8 + txt.length * 4.9, h = 12;
                const [x, y] = px(at.lat, at.lon), g = w / 2 + 8;
                place([[x + g, y], [x - g, y], [x, y - 13], [x, y + 13], [x + g, y - 12], [x - g, y + 12], [x + g, y + 12], [x - g, y - 12]], w, h, (lx, ly) =>
                    `<g class="tv-time-tag" transform="translate(${lx.toFixed(1)},${ly.toFixed(1)})"><rect x="${(-w / 2).toFixed(1)}" y="-6" width="${w.toFixed(1)}" height="12" rx="3"/><text y="3" text-anchor="middle">${esc(txt)}</text></g>`);
            }
        }
        // 2. Taxiway letters where the path ran along them.
        const lettered = [];
        for (const t of (opts.taxiways || [])) {
            const [x, y] = px(t.at.lat, t.at.lon);
            lettered.push({ ref: t.ref, x, y });
            const w = 8 + String(t.ref).length * 6, h = 14;
            const d = w / 2 + 6;
            place([[x, y], [x + d, y], [x - d, y], [x, y - 12], [x, y + 12],
                [x + d + 8, y], [x - d - 8, y], [x + d, y - 12], [x - d, y + 12], [x + d, y + 12], [x - d, y - 12]], w, h, (lx, ly) =>
                `<g class="tv-twy-tag" transform="translate(${lx.toFixed(1)},${ly.toFixed(1)})"><rect x="${-w / 2}" y="-7" width="${w}" height="14" rx="3"/><text y="3.5" text-anchor="middle">${esc(t.ref)}</text></g>`);
        }
        // 3. Runway designators, the one used first.
        rwyIds.sort((a, b) => b.used - a.used).forEach((r) => {
            const w = r.id.length * 5.6 + 2;
            place([[r.x, r.y]], w, 10, (lx, ly) =>
                `<text class="tv-rwy-id${r.used ? ' tv-rwy-id-used' : ''}" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="middle">${esc(r.id)}</text>`);
        });
        // 4. Every other taxiway's letter, like an airport chart: yellow on
        //    black (a location sign), on its line where the line is on screen,
        //    repeated along long taxiways but never crowded.
        for (const f of feats) {
            const g = f && f.geometry, p = (f && f.properties) || {};
            if (!g || g.type !== 'LineString' || (p.aeroway !== 'taxiway' && p.aeroway !== 'taxilane')) continue;
            const ref = String(p.ref || '').trim();
            if (!ref) continue;
            const c = g.coordinates.map(([lo, la]) => px(la, lo));
            // Spots along the on-screen pieces — middle first, then sliding
            // towards the ends — longest pieces first.
            const spots = [];
            for (let i = 1; i < c.length; i++) {
                const [ax, ay] = c[i - 1], [bx, by] = c[i];
                const len = Math.hypot(bx - ax, by - ay);
                if (len < 14) continue;
                for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
                    const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
                    if (x < 8 || x > W - 8 || y < 8 || y > H - 8) continue;
                    spots.push([x, y, len - Math.abs(f - 0.5)]);
                }
            }
            spots.sort((a, b) => b[2] - a[2]);
            const used = usedRefs.has(ref);
            const w = 6 + ref.length * 5.4, h = 11;
            for (const [x, y] of spots) {
                // One letter per stretch of taxiway on screen (the route's own
                // tags count).
                if (lettered.some((q) => q.ref === ref && Math.hypot(q.x - x, q.y - y) < 90)) continue;
                if (place([[x, y]], w, h, (lx, ly) =>
                    `<g class="tv-twy-letter${used ? ' tv-twy-letter-used' : ''}" transform="translate(${lx.toFixed(1)},${ly.toFixed(1)})"><rect x="${(-w / 2).toFixed(1)}" y="-5.5" width="${w.toFixed(1)}" height="11" rx="2"/><text y="3" text-anchor="middle">${esc(ref)}</text></g>`)) {
                    lettered.push({ ref, x, y });
                }
            }
        }
        // 5. Minute numbers on the ticks, either side of the path.
        for (const t of tickLabels) {
            const txt = `${t.minute}′`, w = txt.length * 5 + 2;
            place([[t.x + t.nx * 11, t.y + t.ny * 11], [t.x - t.nx * 11, t.y - t.ny * 11]], w, 9, (lx, ly) =>
                `<text class="tv-tick-l" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="middle">${txt}</text>`);
        }

        return `<svg class="tv-svg${sat ? ' tv-sat' : ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Taxi route">${parts.join('')}${labels.join('')}</svg>`;
    }

    global.TaxiView = { extract, runwayFor, analyse, taxiwaysUsed, renderSVG, fmtDur };
})(typeof window !== 'undefined' ? window : this);
