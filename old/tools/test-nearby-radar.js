// test-nearby-radar.js
//
// The Nearby radar's geometry and its two markup builders.
//
// The scope is the kind of feature that fails quietly: a bearing with the wrong
// sign, a blip placed outside the outer ring, a range filter off by a factor of
// 1.852 — none of those throw, and all of them are only visible if you happen
// to know where the traffic actually was. So the maths is checked against
// independently-known great-circle answers, and the blip builder is checked to
// keep every contact inside the circle it is drawn in.
//
// Node builtins only, like tools/verify-data.js — no browser, no install step.
// nearbyRadar.js is an ES module that only touches `window` inside functions,
// so it imports cleanly here and the pure helpers can be called directly.
//
// Run:  node tools/test-nearby-radar.js
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const MODULE = pathToFileURL(path.resolve(__dirname, '..', 'nearbyRadar.js')).href;

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${extra ? `  (${extra})` : ''}`); fail++; }
};
const head = (s) => console.log(`\n${s}`);
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// A live feature the way flight.js caches it: coordinates on the geometry,
// everything else flat on properties. Only the fields the radar reads.
const feature = (id, lat, lon, props = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
        flightId: id,
        callsign: id,
        username: `pilot-${id}`,
        altitude: 30000,
        speed: 450,
        verticalSpeed: 0,
        heading: 90,
        aircraftName: 'Boeing 787-9',
        liveryName: 'British Airways',
        departureIcao: 'EGLL',
        arrivalIcao: 'KJFK',
        ...props,
    },
});

(async () => {
    const R = await import(MODULE);
    const UI = R.NearbyRadarUI;

    // ------------------------------------------------------------------
    head('Great-circle distance');
    // Reference values computed independently (spherical earth, R = 3440.07 NM).
    ok('EGLL → KJFK is ~2991 NM',
        near(R.distanceNm(51.4775, -0.4614, 40.6413, -73.7781), 2990.98, 0.5),
        R.distanceNm(51.4775, -0.4614, 40.6413, -73.7781).toFixed(2));
    ok('EGLL → LFPG is ~188 NM',
        near(R.distanceNm(51.4775, -0.4614, 49.0097, 2.5479), 187.86, 0.5));
    ok('one degree of latitude is ~60 NM',
        near(R.distanceNm(0, 0, 1, 0), 60.04, 0.05));
    ok('a point has no distance from itself',
        R.distanceNm(51.5, -0.4, 51.5, -0.4) === 0);
    ok('the antimeridian is not a wall — 179°E to 179°W is a short hop',
        near(R.distanceNm(0, 179, 0, -179), 120.08, 0.2),
        R.distanceNm(0, 179, 0, -179).toFixed(2));

    // ------------------------------------------------------------------
    head('Initial bearing');
    ok('due north is 000°', near(R.bearingDeg(0, 0, 1, 0), 0, 0.01));
    ok('due east is 090°', near(R.bearingDeg(0, 0, 0, 1), 90, 0.01));
    ok('due south is 180°', near(R.bearingDeg(0, 0, -1, 0), 180, 0.01));
    ok('due west is 270°', near(R.bearingDeg(0, 0, 0, -1), 270, 0.01));
    ok('never returns a negative bearing',
        R.bearingDeg(51.5, -0.4, 51.5, -10) >= 0);
    ok('EGLL → KJFK departs on ~288°',
        near(R.bearingDeg(51.4775, -0.4614, 40.6413, -73.7781), 287.93, 0.5));

    // ------------------------------------------------------------------
    head('Compass points');
    ok('0° is N', R.compassPoint(0) === 'N');
    ok('45° is NE', R.compassPoint(45) === 'NE');
    ok('202.5° is SSW', R.compassPoint(202.5) === 'SSW');
    ok('350° wraps back to N', R.compassPoint(350) === 'N');
    ok('360° is N, not an overflow', R.compassPoint(360) === 'N');
    ok('a negative bearing still names a point', R.compassPoint(-10) === 'N');

    // ------------------------------------------------------------------
    head('Read-outs');
    ok('on the ground reads GND', R.altText(3000, true) === 'GND');
    ok('below the transition reads in feet', /^\d{1,3}([, ]\d{3})*\s?ft$/.test(R.altText(4500, false)),
        R.altText(4500, false));
    ok('at 18,000 ft it becomes a flight level', R.altText(18000, false) === 'FL180');
    ok('a flight level is always three digits', R.altText(38000, false) === 'FL380');
    ok('a missing altitude is a dash, not NaN', R.altText(undefined, false) === '—');

    ok('level flight has no arrow', R.trend(0).glyph === '·');
    ok('a 200 fpm wobble is still level', R.trend(200).glyph === '·');
    ok('a climb points up', R.trend(1800).glyph === '▲');
    ok('a descent points down', R.trend(-1800).glyph === '▼');
    ok('an unknown vertical speed is level', R.trend(NaN).glyph === '·');

    ok('close-in distances keep a decimal', R.distText(5.234) === '5.2');
    ok('distant traffic is rounded whole', R.distText(42.4) === '42');
    ok('a missing distance is a dash', R.distText(NaN) === '—');

    ok('ground traffic is grey whatever its altitude',
        R.bandFor(300, true).color === R.bandFor(38000, true).color);
    ok('cruise and circuit altitudes are different colours',
        R.bandFor(38000, false).color !== R.bandFor(1500, false).color);

    // ------------------------------------------------------------------
    head('Collecting contacts');
    // EGLL as the origin; the fixtures sit at known offsets from it.
    const origin = { lat: 51.4775, lon: -0.4614 };
    globalThis.window = globalThis.window || {};
    // The last two are malformed on purpose: a feature with no geometry, and
    // one whose coordinates are not numbers. Both must be dropped rather than
    // placed at 0,0 — the Gulf of Guinea is a long way from anybody's radar.
    const FIXTURES = [
        feature('NEAR', 51.5, -0.45),                        // ~1 NM
        feature('MID', 52.4775, -0.4614),                    // ~60 NM due north
        feature('FAR', 40.6413, -73.7781),                   // ~2991 NM
        feature('GND1', 51.48, -0.46, { phase: 'Ground' }),  // on stand
        { type: 'Feature', geometry: null, properties: { flightId: 'BROKEN' } },
        { type: 'Feature', geometry: { coordinates: ['x', 'y'] }, properties: { flightId: 'JUNK' } },
    ];
    window.getLiveFlightData = () => FIXTURES;

    const within25 = R.collectContacts(origin, 25);
    ok('only traffic inside the ring is returned',
        within25.contacts.map(c => c.flightId).sort().join(',') === 'GND1,NEAR',
        within25.contacts.map(c => c.flightId).join(','));
    ok('a feature with no geometry is skipped, not crashed on',
        !within25.contacts.some(c => c.flightId === 'BROKEN'));
    ok('non-numeric coordinates are skipped rather than treated as 0,0',
        !within25.contacts.some(c => c.flightId === 'JUNK'));
    ok('ground and airborne are counted separately',
        within25.airborne === 1 && within25.ground === 1,
        `airborne=${within25.airborne} ground=${within25.ground}`);

    const within100 = R.collectContacts(origin, 100);
    ok('a wider range picks up the 60 NM contact',
        within100.contacts.some(c => c.flightId === 'MID'));
    ok('contacts come back nearest first',
        within100.contacts.every((c, i, a) => i === 0 || a[i - 1].nm <= c.nm),
        within100.contacts.map(c => c.nm.toFixed(1)).join(' '));
    ok('the far contact stays out at 100 NM',
        !within100.contacts.some(c => c.flightId === 'FAR'));
    ok('each contact carries the bearing the list shows',
        within100.contacts.every(c => Number.isFinite(c.brg) && c.brg >= 0 && c.brg < 360));
    ok('the 60 NM contact really is due north',
        near(within100.contacts.find(c => c.flightId === 'MID').brg, 0, 0.5));

    // ------------------------------------------------------------------
    head('Blip placement');
    UI._rangeNm = 100;
    UI._selectedId = null;
    const svg = UI._blipsHTML(within100.contacts);
    const points = [...svg.matchAll(/translate\((-?[\d.]+) (-?[\d.]+)\)/g)]
        .map(m => [Number(m[1]), Number(m[2])]);
    ok('one blip per contact', points.length === within100.contacts.length,
        `${points.length} vs ${within100.contacts.length}`);
    ok('every blip lands inside the outer ring',
        points.every(([x, y]) => Math.hypot(x - 110, y - 110) <= 100.01),
        points.map(([x, y]) => Math.hypot(x - 110, y - 110).toFixed(1)).join(' '));
    ok('a due-north contact is drawn above the centre, not below',
        (() => {
            const i = within100.contacts.findIndex(c => c.flightId === 'MID');
            return points[i][1] < 110 && Math.abs(points[i][0] - 110) < 0.5;
        })());
    ok('blips are rotated to the aircraft heading', /rotate\(90\.0\)/.test(svg));

    // A contact exactly on the ring must sit on it, and one beyond it — which
    // collectContacts would have filtered, but _blipsHTML must not trust that —
    // is clamped rather than drawn off the scope.
    const edge = UI._blipsHTML([
        { flightId: 'ON', nm: 100, brg: 90, heading: 0, alt: 30000, callsign: 'ON' },
        { flightId: 'OVER', nm: 400, brg: 90, heading: 0, alt: 30000, callsign: 'OVER' },
    ]);
    const edgePts = [...edge.matchAll(/translate\((-?[\d.]+) (-?[\d.]+)\)/g)].map(m => [Number(m[1]), Number(m[2])]);
    ok('a contact on the ring is drawn on the ring',
        near(Math.hypot(edgePts[0][0] - 110, edgePts[0][1] - 110), 100, 0.01));
    ok('a contact past the ring is clamped to it',
        near(Math.hypot(edgePts[1][0] - 110, edgePts[1][1] - 110), 100, 0.01));

    const many = Array.from({ length: 200 }, (_, i) => ({
        flightId: `F${i}`, nm: 10, brg: i, heading: 0, alt: 30000, callsign: `F${i}`,
    }));
    ok('the scope caps how many blips it draws',
        [...UI._blipsHTML(many).matchAll(/translate\(/g)].length === 80);

    // ------------------------------------------------------------------
    head('Row markup');
    const row = UI._rowHTML({
        flightId: 'x"><script>alert(1)</script>',
        nm: 12.3, brg: 91, heading: 0, alt: 33000, speed: 460, vs: 0,
        callsign: '<img src=x onerror=alert(1)>',
        username: 'pilot', acName: 'Airbus A350-900', dep: 'EGLL', arr: 'KJFK',
        onGround: false,
    });
    ok('a hostile callsign is escaped, not rendered',
        !row.includes('<img src=x') && row.includes('&lt;img src=x'));
    ok('a hostile flight id cannot break out of the attribute',
        !row.includes('<script>') && row.includes('&lt;script&gt;'));
    // 12.3 NM is past the one-decimal threshold, so the row reads a whole 12.
    ok('the row shows distance, bearing and level',
        /12<small> NM<\/small>/.test(row) && /091° E/.test(row) && /FL330/.test(row));
    ok('the route is shown when both ends are known', row.includes('EGLL → KJFK'));

    const groundRow = UI._rowHTML({
        flightId: 'G', nm: 0.4, brg: 12, heading: 0, alt: 240, speed: 0, vs: 0,
        callsign: 'G-ABCD', username: 'pilot', acName: 'Cessna 172', dep: '', arr: '',
        onGround: true,
    });
    ok('a contact on the ground reads GND rather than an altitude',
        groundRow.includes('GND') && !/\d{1,3},\d{3} ft/.test(groundRow));

    // ------------------------------------------------------------------
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
