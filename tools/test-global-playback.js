// test-global-playback.js — does the world move smoothly when you rewind it?
//
// Global playback animates thousands of recorded aircraft against one clock.
// The recorder throttles a cruising aircraft to a position report every two
// minutes (backend: history.cjs, CRUISE_THROTTLE_MS), so at 450 knots the raw
// data is a fifteen-mile chord between samples. Drawn literally that is a
// polyline: the aircraft slides along a straight line, snaps to a new heading
// at the corner, and slides again. On a map full of them it reads as
// teleporting, which is the one thing a replay must not do.
//
// So the interpolation is the feature, and this is what pins it down:
//
//   * position and direction are both continuous across a sample boundary —
//     no corner at the vertex, which is what a polyline gives you;
//   * a track crossing the antimeridian stays continuous instead of streaking
//     back across the whole map;
//   * an aircraft is NOT slid across a hole in the recording, because smooth
//     motion over ground nobody saw it cover is a fabrication, not a fix;
//   * headings take the short way round, so nothing spins through a full turn
//     as it crosses north.
//
// Node builtins only. globalPlayback.js touches `window` only inside its
// methods and in one guarded mirror at the end, so it imports against stubs.
//
// Run:  node tools/test-global-playback.js
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.error(`  ✗ ${name}${extra ? `\n      ${extra}` : ''}`); fail++; }
};

// --- browser stubs -------------------------------------------------------
global.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
global.document = {
    getElementById: () => null,
    head: { appendChild() {} },
    body: { appendChild() {} },
    createElement: () => ({
        style: {}, classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], remove() {}
    })
};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const NM_PER_DEG = 60;

// Great-circle-ish distance in nautical miles. Small-angle flat approximation,
// which is exact enough at the scales asserted on here.
function distNm(a, b) {
    const dLat = b.lat - a.lat;
    const dLon = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
    return Math.hypot(dLat, dLon) * NM_PER_DEG;
}

// Pack points the way the backend sends them: [dt, lat, lon, alt, gs, hdg]
// with dt in whole seconds from the window start.
function packed(points, startMs) {
    return points.map(p => [
        Math.round((p.t - startMs) / 1000), p.lat, p.lon, p.alt ?? 35000, p.gs ?? 450, p.hdg ?? 0
    ]);
}

// A curving track — a wide turn, the case a straight-line interpolation gets
// visibly wrong. Sampled every 120s, exactly as a cruising aircraft is.
function turningTrack(startMs, samples = 12, sampleMs = 120000) {
    const pts = [];
    const R = 3;                       // degrees, a lazy sweeping turn
    for (let i = 0; i < samples; i++) {
        const theta = (i / samples) * (Math.PI / 2);   // a quarter turn
        pts.push({
            t: startMs + i * sampleMs,
            lat: 40 + R * Math.sin(theta),
            lon: -60 + R * (1 - Math.cos(theta)),
            alt: 36000,
            gs: 460,
            hdg: (90 - theta * 180 / Math.PI + 360) % 360
        });
    }
    return pts;
}

(async () => {
    console.log('\nGlobal playback — motion\n');

    const { GlobalPlayback } = await import(pathToFileURL(path.join(ROOT, 'globalPlayback.js')).href);
    const { normalizePath, positionAt, MAX_INTERP_GAP_MS, FADE_MS } = GlobalPlayback._internals;

    const T0 = 1712345678000;
    const mk = (pts) => ({ points: normalizePath(packed(pts, T0), T0), cursor: 0 });

    /* ---------------------------------------------------------------- *
     * Continuity: no corners, no jumps
     * ---------------------------------------------------------------- */
    {
        const f = mk(turningTrack(T0));
        const last = f.points[f.points.length - 1].t;

        // Walk the whole track at 1s resolution and measure each step. If the
        // motion were teleporting, one step would be enormous next to its
        // neighbours; if it were merely piecewise-linear, the *direction*
        // would jump at each sample even though the position did not.
        let prev = null, maxStep = 0, minStep = Infinity;
        let maxHeadingJump = 0, prevHeading = null;
        let sampled = 0;

        for (let t = T0; t <= last; t += 1000) {
            const p = positionAt(f, t);
            if (!p) continue;
            const here = { lat: p.lat, lon: p.lon };
            if (prev) {
                const step = distNm(prev, here);
                maxStep = Math.max(maxStep, step);
                minStep = Math.min(minStep, step);
                const bearing = Math.atan2(here.lon - prev.lon, here.lat - prev.lat) * 180 / Math.PI;
                if (prevHeading !== null) {
                    let d = Math.abs(bearing - prevHeading);
                    if (d > 180) d = 360 - d;
                    maxHeadingJump = Math.max(maxHeadingJump, d);
                }
                prevHeading = bearing;
            }
            prev = here;
            sampled++;
        }

        ok('the whole track is interpolated, not just the sample points',
            sampled > 1300, `only ${sampled} positions over ${(last - T0) / 1000}s`);

        // A 460kt aircraft covers ~0.128nm per second. Every one-second step
        // should be about that — an order-of-magnitude outlier is a jump.
        ok('every one-second step is the same size — no position jumps',
            maxStep < minStep * 3 && maxStep < 0.4,
            `steps ranged ${minStep.toFixed(4)}–${maxStep.toFixed(4)} nm`);

        // The corner test. Piecewise-linear interpolation of this turn snaps
        // direction by ~7.5° at each of the twelve vertices; a spline spreads
        // that across the segment.
        ok('direction is continuous across sample boundaries — no corner at each vertex',
            maxHeadingJump < 1.5, `largest one-second direction change was ${maxHeadingJump.toFixed(2)}°`);
    }

    /* ---------------------------------------------------------------- *
     * The spline actually curves — it is not linear wearing a hat
     * ---------------------------------------------------------------- */
    {
        const track = turningTrack(T0);
        const f = mk(track);

        // Midway between two samples, a straight line sits on the chord while
        // the real turn bows away from it. Measure the offset.
        const a = track[4], b = track[5];
        const mid = positionAt(f, (a.t + b.t) / 2);
        const chord = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
        const bow = distNm(chord, { lat: mid.lat, lon: mid.lon });

        ok('the interpolated path bows off the chord, following the turn',
            bow > 0.05, `bowed only ${bow.toFixed(4)} nm off the straight line`);
        // …but it must not overshoot into a shape nothing flew.
        ok('the bow stays sane — no spline overshoot',
            bow < distNm(a, b) * 0.1, `bowed ${bow.toFixed(3)} nm off a ${distNm(a, b).toFixed(1)} nm segment`);
    }

    /* ---------------------------------------------------------------- *
     * Antimeridian
     * ---------------------------------------------------------------- */
    {
        // Eastbound across the dateline: 179.6 → -179.8 in the raw feed.
        const f = mk([
            { t: T0, lat: -18, lon: 179.2 },
            { t: T0 + 120000, lat: -18, lon: 179.8 },
            { t: T0 + 240000, lat: -18, lon: -179.6 },
            { t: T0 + 360000, lat: -18, lon: -179.0 }
        ]);

        let maxStep = 0, prev = null;
        for (let t = T0; t <= T0 + 360000; t += 1000) {
            const p = positionAt(f, t);
            if (!p) continue;
            if (prev) maxStep = Math.max(maxStep, Math.abs(p.lon - prev));
            prev = p.lon;
        }
        ok('a dateline crossing stays continuous instead of streaking across the map',
            maxStep < 0.1, `longitude jumped ${maxStep.toFixed(2)}° in one second`);

        // Longitude is left unwrapped past 180 on purpose — Mapbox wraps it
        // back onto the globe, and keeping it continuous is what stops the
        // trail drawing a line through everything.
        const after = positionAt(f, T0 + 300000);
        ok('longitude is carried past 180 rather than wrapped mid-track',
            after.lon > 180, `got ${after.lon}`);
    }

    /* ---------------------------------------------------------------- *
     * Holes in the recording
     * ---------------------------------------------------------------- */
    {
        const gap = MAX_INTERP_GAP_MS + 60000;
        const f = mk([
            { t: T0, lat: 40, lon: -60 },
            { t: T0 + 120000, lat: 40.2, lon: -59.7 },
            { t: T0 + 120000 + gap, lat: 44, lon: -50 },     // reappears far away
            { t: T0 + 240000 + gap, lat: 44.2, lon: -49.7 }
        ]);

        ok('an aircraft is not slid across a hole in the recording',
            positionAt(f, T0 + 120000 + gap / 2) === null,
            'it was interpolated over ground it was never seen covering');
        ok('…and it is picked back up once reporting resumes',
            positionAt(f, T0 + 180000 + gap) !== null);
    }

    /* ---------------------------------------------------------------- *
     * Headings
     * ---------------------------------------------------------------- */
    {
        // 350° → 10° is a 20° turn through north, not a 340° spin the other way.
        const f = mk([
            { t: T0, lat: 40, lon: -60, hdg: 350 },
            { t: T0 + 60000, lat: 40.1, lon: -60, hdg: 10 }
        ]);
        const mid = positionAt(f, T0 + 30000);
        const nearNorth = mid.hdg > 355 || mid.hdg < 5;
        ok('a heading crossing north takes the short way round',
            nearNorth, `midpoint heading was ${mid.hdg.toFixed(1)}°, expected ~0/360`);
    }
    {
        // A recorded heading of 0 on both ends is a missing value, not due
        // north — an aircraft tracking east must not be drawn pointing north.
        const f = mk([
            { t: T0, lat: 40, lon: -60, hdg: 0 },
            { t: T0 + 60000, lat: 40, lon: -59, hdg: 0 }
        ]);
        const mid = positionAt(f, T0 + 30000);
        ok('a missing heading falls back to the direction of travel',
            mid.hdg > 80 && mid.hdg < 100, `got ${mid.hdg.toFixed(1)}°, expected ~90° for an eastbound leg`);
    }

    /* ---------------------------------------------------------------- *
     * Entry and exit
     * ---------------------------------------------------------------- */
    {
        const f = mk(turningTrack(T0));
        const last = f.points[f.points.length - 1].t;

        ok('an aircraft fades in rather than blinking into existence',
            positionAt(f, T0 + 1000).opacity < 0.2 && positionAt(f, T0 + FADE_MS + 1000).opacity === 1);
        ok('…and fades out at the end of its track',
            positionAt(f, last - 1000).opacity < 0.2);
        ok('nothing is drawn outside the recorded track',
            positionAt(f, T0 - 1000) === null && positionAt(f, last + 1000) === null);
    }

    /* ---------------------------------------------------------------- *
     * Scrubbing — the cursor cache must not remember a stale answer
     * ---------------------------------------------------------------- */
    {
        const f = mk(turningTrack(T0));
        const last = f.points[f.points.length - 1].t;
        const mid = (T0 + last) / 2;

        const forward = positionAt(f, mid);
        const atMid = { lat: forward.lat, lon: forward.lon };

        positionAt(f, last - 1000);          // jump to the end…
        const backward = positionAt(f, mid); // …then scrub back to the middle

        ok('scrubbing backwards lands in the same place as playing forwards',
            Math.abs(backward.lat - atMid.lat) < 1e-9 && Math.abs(backward.lon - atMid.lon) < 1e-9,
            'the per-flight cursor did not rewind');
    }

    /* ---------------------------------------------------------------- *
     * Viewport culling
     * ---------------------------------------------------------------- *
     * Culling is what keeps a zoomed-in view cheap enough to push every
     * frame, and it fails in one direction silently: a wrongly-rejected
     * aircraft just isn't there, and nothing says so. The wrap arithmetic is
     * the part that gets it wrong, so that is what is pinned here.
     */
    {
        const { measureTrack, inView, trackMayBeInView } = GlobalPlayback._internals;
        const box = (minLon, maxLon, minLat = -60, maxLat = 60) =>
            ({ minLon, maxLon, minLat, maxLat, wrapped: (maxLon - minLon) >= 340 });

        const track = (pts) => measureTrack(mk(pts));

        // Atlantic viewport, no wrap involved.
        const atlantic = box(-70, -10, 30, 60);
        const overAtlantic = track([
            { t: T0, lat: 45, lon: -40 }, { t: T0 + 120000, lat: 45.2, lon: -39 }
        ]);
        const overPacific = track([
            { t: T0, lat: 20, lon: -160 }, { t: T0 + 120000, lat: 20.2, lon: -159 }
        ]);
        ok('a track inside the viewport is kept', trackMayBeInView(overAtlantic, atlantic));
        ok('a track on the far side of the world is rejected', !trackMayBeInView(overPacific, atlantic));

        // A viewport straddling the dateline, with a track normalizePath has
        // carried past 180. Both must land in the same branch.
        const dateline = box(170, 190, -40, 0);
        const crossing = track([
            { t: T0, lat: -18, lon: 179.2 },
            { t: T0 + 120000, lat: -18, lon: -179.6 }   // becomes 180.4 unwrapped
        ]);
        ok('a dateline-crossing track is visible in a dateline viewport',
            trackMayBeInView(crossing, dateline));
        ok('a point carried past 180 tests inside a dateline viewport',
            inView(-18, 180.4, dateline));
        ok('…and the same point is rejected by an Atlantic viewport',
            !inView(-18, 180.4, atlantic));

        // The case a naive interval test gets wrong: a track that begins east
        // of the viewport and runs east far enough to come back around into it.
        // Built from realistic steps, because normalizePath only ever carries
        // longitude past 180 by accumulating hops of less than half a turn.
        const narrow = box(-10, 10, 30, 60);
        const eastbound = [];
        for (let i = 0; i <= 12; i++) {
            eastbound.push({ t: T0 + i * 120000, lat: 45, lon: ((20 + i * 30 + 180) % 360) - 180 });
        }
        const roundTheWorld = track(eastbound);       // unwraps to 20° … 380°
        ok('a track long enough to wrap back into view is not rejected',
            trackMayBeInView(roundTheWorld, narrow),
            `track spans ${roundTheWorld.minLon}…${roundTheWorld.maxLon}`);

        // …and one that stops short of coming back around still is rejected.
        const stopsShort = track([
            { t: T0, lat: 45, lon: 20 },
            { t: T0 + 120000, lat: 45, lon: 120 }
        ]);
        ok('a track east of the viewport that never comes back around is rejected',
            !trackMayBeInView(stopsShort, narrow));

        // Latitude still bounds everything.
        const polar = track([{ t: T0, lat: 85, lon: 0 }, { t: T0 + 120000, lat: 85.1, lon: 1 }]);
        ok('a track above the viewport is rejected on latitude', !trackMayBeInView(polar, narrow));

        // Zoomed all the way out there is nothing left to cull.
        const world = box(-180, 180, -85, 85);
        ok('a world view culls nothing', trackMayBeInView(overPacific, world) && inView(20, -160, world));
    }

    console.log(`\n${pass} passing${fail ? `, ${fail} failing` : ''}\n`);
    process.exit(fail === 0 ? 0 : 1);
})();
