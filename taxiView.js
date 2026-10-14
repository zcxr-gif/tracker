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
 * runway database, the taxiway network when the OSM layout is already to hand
 * (airportLayout.js), and the path itself on top.
 *
 * Pure and dependency-free so it runs (and is tested) in Node; flight.js owns
 * the airport and runway lookups and the card around the drawing.
 *
 * Exposes window.TaxiView = { extract, runwayFor, renderSVG }.
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
        return (lat, lon) => ({ x: (lon - lon0) * kx, y: -(lat - lat0) * ky });
    }

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

    // --- Drawing -------------------------------------------------------------

    const W = 320, H = 200;
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /**
     * The diagram, as an SVG string. Colours come from classes (tv-*) so the
     * window's skin can restyle it.
     * @param {object} seg - an extract() result's out or in.
     * @param {object} [opts]
     * @param {Array}  [opts.runways] - runway records for the field.
     * @param {object} [opts.used] - runwayFor() result, highlighted.
     * @param {object} [opts.layout] - airportLayout.js GeoJSON (taxiways, aprons).
     */
    function renderSVG(seg, opts = {}) {
        if (!seg || !seg.path || !seg.path.length) return '';
        const ground = seg.path, roll = seg.roll || [];
        const all = ground.concat(roll);
        const lat0 = all.reduce((m, s) => m + s.lat, 0) / all.length;
        const lon0 = all.reduce((m, s) => m + s.lon, 0) / all.length;
        const P = projector(lat0, lon0);

        // Frame the path and the runway it used; everything else is context
        // and may run off the edge.
        const frame = all.map((s) => P(s.lat, s.lon));
        const usedEnds = opts.used && rwyEnds(opts.used.runway);
        if (usedEnds) frame.push(P(usedEnds.le.lat, usedEnds.le.lon), P(usedEnds.he.lat, usedEnds.he.lon));
        let x0 = Math.min(...frame.map((p) => p.x)), x1 = Math.max(...frame.map((p) => p.x));
        let y0 = Math.min(...frame.map((p) => p.y)), y1 = Math.max(...frame.map((p) => p.y));
        // At least ~500 m across, padded, and in the drawing's aspect.
        const MIN = 500;
        if (x1 - x0 < MIN) { const c = (x0 + x1) / 2; x0 = c - MIN / 2; x1 = c + MIN / 2; }
        if (y1 - y0 < MIN * H / W) { const c = (y0 + y1) / 2; y0 = c - MIN * H / W / 2; y1 = c + MIN * H / W / 2; }
        const padX = (x1 - x0) * 0.12, padY = (y1 - y0) * 0.14;
        x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
        const scale = Math.min(W / (x1 - x0), H / (y1 - y0));
        const ox = (W - (x1 - x0) * scale) / 2 - x0 * scale;
        const oy = (H - (y1 - y0) * scale) / 2 - y0 * scale;
        const px = (lat, lon) => { const p = P(lat, lon); return [+(p.x * scale + ox).toFixed(1), +(p.y * scale + oy).toFixed(1)]; };
        const line = (pts) => pts.map((s) => px(s.lat, s.lon).join(',')).join(' ');

        const parts = [];

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
                parts.push(`<polyline class="tv-twy" points="${ring(g.coordinates)}"/>`);
            }
        }

        // Runways at their real width (never thinner than a few px).
        const labels = [];
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
                if (!id) return;
                const lx = x + ux * d * 11, ly = y + uy * d * 11 + 3;
                if (lx < 8 || lx > W - 8 || ly < 8 || ly > H - 4) return;
                labels.push(`<text class="tv-rwy-id${used ? ' tv-rwy-id-used' : ''}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${esc(id)}</text>`);
            });
        }

        // The roll (dashed, along the runway), then the taxi path over it.
        const rollLine = seg.kind === 'out'
            ? [ground[ground.length - 1]].concat(roll)
            : roll.concat([ground[0]]);
        if (roll.length) parts.push(`<polyline class="tv-roll" points="${line(rollLine)}"/>`);
        parts.push(`<polyline class="tv-path-halo" points="${line(ground)}"/>`);
        parts.push(`<polyline class="tv-path" points="${line(ground)}"/>`);

        // Gate end: a hollow ring. Runway end / current position: a filled dot.
        const gate = seg.kind === 'out' ? ground[0] : ground[ground.length - 1];
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
            const [nx, ny] = px(ground[ground.length - 1].lat, ground[ground.length - 1].lon);
            parts.push(`<circle class="tv-now" cx="${nx}" cy="${ny}" r="5"/>`);
        } else {
            parts.push(`<circle class="tv-tip" cx="${tx}" cy="${ty}" r="3.5"/>`);
        }

        return `<svg class="tv-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Taxi route">${parts.join('')}${labels.join('')}</svg>`;
    }

    global.TaxiView = { extract, runwayFor, renderSVG };
})(typeof window !== 'undefined' ? window : this);
