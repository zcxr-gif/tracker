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

// The steady-state allocation check counts garbage collections, which can only
// be observed from outside the process — PerformanceObserver delivers 'gc'
// entries on a later tick, and a measured loop that never yields would report
// zero however much garbage it made. So the suite re-execs itself under
// --trace-gc, captures the child's stdout, and counts collections between the
// markers the child prints. Everything else runs identically either way.
const GC_BEGIN = '=== GC WINDOW BEGINS ===';
const GC_END = '=== GC WINDOW ENDS ===';

if (process.env.GPB_GC_CHILD !== '1') {
    const { spawnSync } = require('child_process');
    // V8 writes --trace-gc to stdout, so the child's stdout is captured and
    // replayed here with the trace lines filtered back out.
    const r = spawnSync(
        process.execPath,
        ['--expose-gc', '--trace-gc', __filename, ...process.argv.slice(2)],
        {
            env: { ...process.env, GPB_GC_CHILD: '1' },
            stdio: ['inherit', 'pipe', 'inherit'],
            encoding: 'utf8'
        }
    );

    const out = r.stdout || '';
    const isTrace = (line) => /^\[\d+:.*\]\s+\d+ ms: (Scavenge|Mark-|Mark_)/.test(line);

    let inWindow = false;
    let collections = 0;
    for (const line of out.split('\n')) {
        if (line.includes(GC_BEGIN)) { inWindow = true; continue; }
        if (line.includes(GC_END)) { inWindow = false; continue; }
        if (isTrace(line)) { if (inWindow) collections++; continue; }
        if (/^##COUNTS /.test(line)) continue;
        if (line.length) console.log(line);
    }

    // Measured against the version that crashed: rebuilding every feature and
    // coordinate pair per push ran 137 collections over this same workload. A
    // pooled steady state runs a handful — one every few hundred pushes, which
    // at thirty pushes a second is a minor GC every ten seconds or so, i.e.
    // ordinary. Anything approaching the old figure means the pooling has been
    // undone somewhere and the phone will die again.
    const budget = 40;
    const okGc = collections <= budget;
    console.log(okGc
        ? `  ✓ 5,000 pushes of a 2,000-aircraft window stay off the collector (${collections} GCs, budget ${budget})`
        : `  ✗ 5,000 pushes triggered ${collections} collections (budget ${budget}) — something allocates per push`);

    const counts = /##COUNTS (\d+) (\d+)/.exec(out);
    const childPass = counts ? Number(counts[1]) : 0;
    const childFail = counts ? Number(counts[2]) : 1;
    const pass = childPass + (okGc ? 1 : 0);
    const fail = childFail + (okGc ? 0 : 1);
    console.log(`\n${pass} passing${fail ? `, ${fail} failing` : ''}\n`);
    process.exit(fail === 0 && r.status === 0 ? 0 : 1);
}

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
     * Headings — an aircraft points where it is going
     * ---------------------------------------------------------------- *
     * Reported as the planes "swinging around" instead of flying.
     *
     * The recorded heading field was the obvious source, and it is what
     * flightReplay and atcReplay use. It is right for them: they animate every
     * recorded point and interpolate straight between them, so the direction
     * they draw an aircraft moving IS the recorded heading.
     *
     * This replay is not that. Position follows a spline through points the
     * backend has already thinned to a time grid, while recorded heading is a
     * separate signal sampled at those same instants. Through a turn the two
     * part company — measured at up to 33° on a realistic track — and an
     * aircraft drawn moving one way while pointing another reads as the map
     * swinging around, not as crabbing.
     *
     * So heading is taken from the tangent of the curve being drawn. These
     * assert that, and they fail against the recorded-heading version.
     */
    const bearing = (from, to) =>
        (Math.atan2((to.lon - from.lon) * Math.cos(from.lat * Math.PI / 180), to.lat - from.lat)
            * 180 / Math.PI + 360) % 360;
    const angleGap = (x, y) => Math.abs(((x - y + 540) % 360) - 180);

    {
        // The decisive case: a recorded heading that flatly disagrees with the
        // path. The aircraft flies due east; the field says it is pointing
        // north. What is drawn must follow the path.
        const f = mk([
            { t: T0, lat: 40, lon: -60, hdg: 0 },
            { t: T0 + 60000, lat: 40, lon: -59.8, hdg: 0 },
            { t: T0 + 120000, lat: 40, lon: -59.6, hdg: 0 }
        ]);
        const mid = positionAt(f, T0 + 30000);
        ok('an aircraft points along its path, not along the recorded heading field',
            angleGap(mid.hdg, 90) < 3,
            `drawn at ${mid.hdg.toFixed(1)}°, but the leg tracks 090°`);
    }

    {
        // Through a turn, at the coarse spacing a busy window produces. This is
        // where recorded heading and the drawn path diverge worst.
        const f = mk(turningTrack(T0, 12, 120000));
        const A = GlobalPlayback._internals.makePosition();
        const B = GlobalPlayback._internals.makePosition();
        const gaps = [];
        const last = f.points[f.points.length - 1].t;
        for (let t = f.points[0].t; t <= last - 2000; t += 1000) {
            const a = positionAt(f, t, A);
            const b = positionAt(f, t + 1000, B);
            if (!a || !b) continue;
            gaps.push(angleGap(a.hdg, bearing(a, b)));
        }
        gaps.sort((x, y) => x - y);
        const p95 = gaps[Math.floor(gaps.length * 0.95)];
        ok('through a turn it still points exactly where it is moving',
            p95 < 2 && gaps[gaps.length - 1] < 6,
            `p95 ${p95.toFixed(2)}°, worst ${gaps[gaps.length - 1].toFixed(1)}° off the direction of travel`);
    }

    {
        // Rotation has to be continuous too — a heading that is correct at every
        // instant but jumps between them is the same fault seen a frame later.
        const f = mk(turningTrack(T0, 12, 120000));
        const P = GlobalPlayback._internals.makePosition();
        let prev = null, worst = 0;
        const last = f.points[f.points.length - 1].t;
        for (let t = f.points[0].t; t <= last; t += 1000) {
            const p = positionAt(f, t, P);
            if (!p) { prev = null; continue; }
            if (prev !== null) worst = Math.max(worst, angleGap(p.hdg, prev));
            prev = p.hdg;
        }
        // A rate-one turn is 3°/s; anything past that in one second of session
        // time is a snap rather than a turn.
        ok('the icon never snaps round — rotation stays at a rate an aircraft could fly',
            worst < 3.5, `turned ${worst.toFixed(1)}° in one second`);
    }

    {
        // Crossing north must not spin the long way. atan2 gives this for free
        // now, which is the point — it was arithmetic that had to be got right
        // by hand when the heading came from the recorded field.
        const f = mk([
            { t: T0, lat: 40, lon: -60.02, hdg: 350 },
            { t: T0 + 60000, lat: 40.1, lon: -60, hdg: 10 },
            { t: T0 + 120000, lat: 40.2, lon: -59.98, hdg: 10 }
        ]);
        const P = GlobalPlayback._internals.makePosition();
        let prev = null, worst = 0;
        for (let t = T0; t <= T0 + 120000; t += 1000) {
            const p = positionAt(f, t, P);
            if (!p) continue;
            if (prev !== null) worst = Math.max(worst, angleGap(p.hdg, prev));
            prev = p.hdg;
        }
        ok('a track crossing north does not spin the aircraft the long way round',
            worst < 3.5, `spun ${worst.toFixed(1)}° in one second crossing north`);
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

    /* ---------------------------------------------------------------- *
     * Drawing: bounded work, stable choices, and no garbage
     * ---------------------------------------------------------------- *
     * These are the two faults that made the first cut unwatchable, and
     * neither is visible by reading the code.
     *
     * A push that rebuilds a few thousand features and tens of thousands of
     * coordinate pairs is tens of megabytes per second of garbage. That is
     * not "a bit slow" on a phone — it is a crash after a few minutes of
     * playing, which is exactly how it was reported. So the steady state has
     * to allocate nothing, and that is asserted against the heap rather than
     * assumed from the shape of the code.
     *
     * And the work per push has to be bounded by the size of the screen, not
     * by how busy the server was — otherwise a peak-hour window degrades the
     * frame rate, and a degraded frame rate is the stepping this whole module
     * exists to remove.
     */
    {
        const {
            selectVisible, buildPlanes, buildTrails, measureTrack,
            setThinGridForTest, poolSizes, MAX_DRAWN, TRAIL_POINTS, SOFT_CAP
        } = GlobalPlayback._internals;

        // A busy window: 2,000 aircraft spread over the North Atlantic, each
        // an hour long and sampled the way the recorder samples.
        const busy = [];
        for (let k = 0; k < 2000; k++) {
            const pts = [];
            for (let i = 0; i <= 30; i++) {
                pts.push({
                    t: T0 + i * 120000,
                    lat: 35 + (k % 40) * 0.4,
                    lon: -70 + Math.floor(k / 40) * 0.4 + i * 0.15,
                    alt: 35000, gs: 460, hdg: 90
                });
            }
            const f = measureTrack(mk(pts));
            f.flightId = `BUSY-${k}`;
            f.callsign = `TST${k}`;
            f.username = 'Pilot';
            f.aircraftName = 'A350-900';
            f.category = 'A350';
            busy.push(f);
        }

        const view = { minLat: 30, maxLat: 60, minLon: -80, maxLon: -40, wrapped: false };
        // A phone-sized window: 30° of latitude over ~700px, 40° of longitude
        // over ~400px, at one aircraft per 5px cell.
        setThinGridForTest((30 / 700) * 5, (40 / 400) * 5);

        const midT = T0 + 30 * 60000;

        const airborneThinned = selectVisible(busy, midT, view, true);
        const drawnThinned = poolSizes().chosen;
        const candidates = poolSizes().candidates;
        const airborneAll = selectVisible(busy, midT, view, false);
        const drawnAll = poolSizes().chosen;

        ok('every aircraft in the window is counted as airborne, drawn or not',
            airborneThinned === airborneAll && airborneThinned > 1500,
            `thinned counted ${airborneThinned}, unthinned ${airborneAll}`);

        // The point of the safety valve is that it does not fire until it has
        // to. Density at world zoom *is* the picture — a busy evening thinned
        // down to a sparse scatter is a worse lie than a dropped frame — so
        // below the cap nothing is dropped at all.
        // And when it does fire it thins to the cap, not past it. The grid is
        // sized in pixels, so left alone it drops however much the traffic
        // happens to overlap — three thousand down to five hundred, when
        // fifteen hundred would have fitted. Whatever room is left gets filled
        // back in.
        ok('the drawn set is capped, but only once it exceeds what a push carries',
            drawnThinned === Math.min(candidates, SOFT_CAP),
            `${candidates} visible → drew ${drawnThinned} (soft cap ${SOFT_CAP})`);

        ok('the drawn set never exceeds the hard cap',
            drawnThinned <= MAX_DRAWN && drawnAll <= MAX_DRAWN,
            `${drawnThinned} / ${drawnAll} against a cap of ${MAX_DRAWN}`);

        // The regression this guards against: an earlier cut thinned at
        // icon size and unconditionally, which turned three thousand
        // contacts into five hundred and made a packed evening render as a
        // quiet one. Below the cap, every visible aircraft must be drawn —
        // even a fleet deliberately stacked on top of itself.
        {
            const stacked = busy.slice(0, 600).map(f => {
                const g = Object.create(Object.getPrototypeOf(f));
                Object.assign(g, f);
                return g;
            });
            selectVisible(stacked, midT, view, true);
            const p = poolSizes();
            ok('below the cap nothing is thinned, however stacked the traffic is',
                p.chosen === p.candidates && p.candidates > 0,
                `${p.candidates} visible but only ${p.chosen} drawn`);
        }

        // Flicker: if the winner inside a cell were "whichever was visited
        // first", the drawn set would churn between neighbours frame to frame
        // and the map would sparkle. The winner is hashed, so it is stable.
        selectVisible(busy, midT, view, true);
        buildPlanes();
        const firstIds = GlobalPlayback._internals.poolSizes().planeList
            ? new Set(planeIdsAfterBuild()) : null;
        selectVisible(busy, midT + 900, view, true);
        buildPlanes();
        const secondIds = new Set(planeIdsAfterBuild());
        let kept = 0;
        for (const id of firstIds) if (secondIds.has(id)) kept++;
        ok('the same aircraft stay drawn between frames — the map does not sparkle',
            kept / firstIds.size > 0.95,
            `only ${(100 * kept / firstIds.size).toFixed(1)}% of drawn aircraft survived a 0.9s step`);

        // Tails are capped per aircraft, whatever the recording's resolution.
        selectVisible(busy, midT, view, true);
        buildPlanes();
        buildTrails(midT);
        const trails = trailFeaturesAfterBuild();
        const planes = GlobalPlayback._internals.__planeFeatures();
        ok('every comet tail is capped at its vertex budget',
            trails.length > 0 && trails.every(t => t.geometry.coordinates.length <= TRAIL_POINTS),
            `longest tail had ${Math.max(...trails.map(t => t.geometry.coordinates.length))} vertices`);

        // Reported as "the planes aren't following their paths". Two causes,
        // and this is the first: tails were capped at 700 while up to 1500
        // aircraft were drawn, so more than half the map had no path under it.
        ok('every drawn aircraft gets a tail, not just the first few hundred',
            trails.length === planes.length,
            `${planes.length} aircraft drawn but only ${trails.length} tails`);

        // And the second: tails were rebuilt on a slower cadence than the
        // aircraft, which at 120x is twelve seconds of flight and at 600x a
        // full minute — the aircraft floats visibly ahead of its own trail.
        // The head of every tail must BE the aircraft's position.
        // Matched by position rather than by index, so this holds even if a
        // flight is skipped and the two lists fall out of step.
        const drawnAt = new Set(planes.map(p => `${p.geometry.coordinates[0]},${p.geometry.coordinates[1]}`));
        const orphans = trails.filter(t => {
            const head = t.geometry.coordinates[t.geometry.coordinates.length - 1];
            return !drawnAt.has(`${head[0]},${head[1]}`);
        }).length;
        ok('every tail is anchored to its aircraft, with no lag between them',
            orphans === 0,
            `${orphans} of ${trails.length} tails end somewhere no aircraft is`);

        // ---- the crash test ----
        // Warm every pool, then measure the heap across a few hundred pushes.
        for (let i = 0; i < 60; i++) {
            selectVisible(busy, midT + i * 1000, view, true);
            buildPlanes();
            buildTrails(midT + i * 1000);
        }
        const warmPool = poolSizes().planePool;

        // Churn, not retained heap. The objects a rebuild-every-push design
        // creates are garbage by definition, so measuring the heap either side
        // of a forced GC says nothing at all — it comes back clean and the test
        // passes while the phone still dies. What kills the phone is the
        // *volume*: allocate a few thousand objects several times a second and
        // the collector runs constantly, which is both the jank and, once tile
        // buffers are competing for the same ceiling, the crash.
        //
        // So count the collections. A pooled steady state does not make
        // garbage, so it does not trigger any.
        // The collections that happen inside these markers are counted by the
        // parent process from --trace-gc output; see the top of this file.
        global.gc();
        console.log(GC_BEGIN);
        for (let i = 0; i < 5000; i++) {
            const t = midT + (i % 300) * 1000;
            selectVisible(busy, t, view, true);
            buildPlanes();
            buildTrails(t);
        }
        console.log(GC_END);

        // Pools settle at a high-water mark rather than at a fixed size — the
        // drawn count moves a little as aircraft cross cell boundaries, so a
        // few more slots get claimed after warm-up. What matters is that it
        // converges and stays under the cap, not that it never moves.
        const finalPool = poolSizes().planePool;
        ok('the pools converge on a high-water mark instead of growing without bound',
            finalPool <= MAX_DRAWN && finalPool - warmPool < warmPool * 0.25,
            `pool went ${warmPool} → ${finalPool} over 5,000 pushes (cap ${MAX_DRAWN})`);

        // Second run, from an already-settled pool: this one should not move
        // at all, which is the steady state the memory claim actually rests on.
        const settled = poolSizes().planePool;
        for (let i = 0; i < 1000; i++) {
            const t = midT + (i % 300) * 1000;
            selectVisible(busy, t, view, true);
            buildPlanes();
            buildTrails(t);
        }
        ok('…and once settled, a further 1,000 pushes claim no new slots at all',
            poolSizes().planePool === settled,
            `pool moved ${settled} → ${poolSizes().planePool} on a second run`);

        function planeIdsAfterBuild() {
            // buildPlanes writes into the pooled features; read the ids back
            // out of the live plane list via a fresh selection each time.
            return GlobalPlayback._internals.__planeIds();
        }
        function trailFeaturesAfterBuild() {
            return GlobalPlayback._internals.__trailFeatures();
        }
    }

    // The parent adds the collection-count assertion and prints the summary.
    console.log(`##COUNTS ${pass} ${fail}`);
    process.exit(fail === 0 ? 0 : 1);
})();
