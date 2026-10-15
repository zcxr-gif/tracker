// test-taxi-view.js — the taxi path pulled out of a flight's trail.
//
// What matters, and fails quietly if wrong:
//   * the taxi-out stops where the takeoff roll starts, and only exists when
//     the trail starts on the ground (a flight that spawned airborne has none);
//   * a taxi-in only appears after a real landing, not while still flying;
//   * the runway is named by the end the aircraft rolled FROM (04L, not 22R,
//     for a roll heading north-east along 04L/22R).
//
// Node builtins only. Run:  node tools/test-taxi-view.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ctx = { window: {}, Math, Number, String, Array, isFinite, Infinity };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'taxiView.js'), 'utf8'), ctx);
const TV = ctx.window.TaxiView;

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${extra ? `  (${extra})` : ''}`); fail++; }
};
const head = (s) => console.log(`\n${s}`);

const JFK = JSON.parse(fs.readFileSync(path.join(ROOT, 'runways-core.json'), 'utf8')).KJFK;
const t0 = Date.UTC(2026, 9, 14, 12, 0, 0);
let t = t0;
const at = (lat, lon, alt, gs, dtSec = 60) => ({ t: (t += dtSec * 1000), lat, lon, alt, gs });

// Gate at T4, taxi south to the 04L threshold, roll north-east, climb out.
const taxiOut = [
    at(40.6441, -73.7822, 13, 0), at(40.6441, -73.7822, 13, 0), at(40.6420, -73.7840, 13, 15),
    at(40.6395, -73.7870, 13, 18), at(40.6370, -73.7900, 13, 16), at(40.6330, -73.7930, 13, 15),
    at(40.6290, -73.7900, 13, 14), at(40.6250, -73.7870, 13, 12), at(40.6222, -73.7858, 13, 5),
];
const roll = [at(40.6260, -73.7826, 13, 90, 20), at(40.6320, -73.7778, 40, 150, 15)];
const climb = [at(40.6500, -73.7600, 1500, 180), at(40.7500, -73.6000, 9000, 300), at(41.2, -72.8, 30000, 450)];

head('Taxi-out');
{
    const r = TV.extract(taxiOut.concat(roll, climb));
    ok('found', !!r.out);
    ok('ends where the roll starts', r.out && r.out.path.length === taxiOut.length, r.out && r.out.path.length);
    ok('the roll is the fast, low samples', r.out && r.out.roll.length === 2, r.out && r.out.roll.length);
    ok('timed from the first movement, not from the gate', r.out && Math.round(r.out.minutes) === 6, r.out && r.out.minutes);
    ok('has a sensible distance', r.out && r.out.distanceKm > 2 && r.out.distanceKm < 4, r.out && r.out.distanceKm);
    ok('is finished', r.out && !r.out.ongoing);
    ok('no taxi-in while still flying', r.in === null);

    const rwy = TV.runwayFor(JFK, r.out.roll, r.out.path[r.out.path.length - 1]);
    ok('runway identified as 04L', rwy && rwy.ident === '04L', rwy && rwy.ident);

    const svg = TV.renderSVG(r.out, { runways: JFK, used: rwy });
    ok('draws an svg', /^<svg[^>]*class="tv-svg"/.test(svg));
    ok('with the path and the used runway', svg.includes('tv-path') && svg.includes('tv-rwy-used'));
    ok('and the runway designator', svg.includes('>04L<'));
}

head('Taxiways used');
{
    t = t0;
    const r = TV.extract(taxiOut.concat(roll, climb));
    const line = (ref, coords, aeroway = 'taxiway') => ({
        type: 'Feature', properties: { aeroway, ref },
        geometry: { type: 'LineString', coordinates: coords.map(([la, lo]) => [lo, la]) },
    });
    // A, then B, then K along the path; Z crosses it at right angles; one
    // taxiway has no name; an apron sits under the gate.
    const layout = { type: 'FeatureCollection', features: [
        line('A', [[40.6441, -73.7822], [40.6420, -73.7840], [40.6395, -73.7870], [40.6370, -73.7900]]),
        line('B', [[40.6370, -73.7900], [40.6330, -73.7930], [40.6290, -73.7900]]),
        line('K', [[40.6290, -73.7900], [40.6250, -73.7870], [40.6222, -73.7858]]),
        line('Z', [[40.6395, -73.7900], [40.6395, -73.7840]]),
        line('', [[40.6300, -73.7950], [40.6250, -73.7950]]),
        { type: 'Feature', properties: { aeroway: 'apron' }, geometry: { type: 'Polygon', coordinates: [[[-73.783, 40.644], [-73.781, 40.644], [-73.781, 40.645], [-73.783, 40.644]]] } },
    ] };
    const used = TV.taxiwaysUsed(r.out, layout);
    const refs = used.map((u) => u.ref).join(' ');
    ok('names them in order', refs === 'A B K', refs);
    ok('a taxiway only crossed is not listed', !used.some((u) => u.ref === 'Z'));
    ok('each comes with a label point', used.every((u) => isFinite(u.at.lat) && isFinite(u.at.lon)));
    ok('no layout, no names', TV.taxiwaysUsed(r.out, null).length === 0);

    const svg = TV.renderSVG(r.out, { runways: JFK, layout, taxiways: used });
    ok('the used taxiways are highlighted', (svg.match(/tv-twy tv-twy-used/g) || []).length === 3);
    ok('and labelled', svg.includes('>A<') && svg.includes('>B<') && svg.includes('>K<'));
    ok('taxiways it did not use are lettered too', /class="tv-twy-letter"[^>]*>.*?>Z</.test(svg));
    ok('a used taxiway is lettered once, not twice', ['A', 'B', 'K'].every((r) => (svg.match(new RegExp('>' + r + '<', 'g')) || []).length === 1),
        ['A', 'B', 'K'].map((r) => (svg.match(new RegExp('>' + r + '<', 'g')) || []).length).join(','));
}

head('Timing, stops and ticks');
{
    const T = (min) => t0 + min * 60000;
    const s = (min, lat, lon, gs, alt = 13) => ({ t: T(min), lat, lon, alt, gs });
    const path = [
        s(0, 40.6441, -73.7822, 0), s(2, 40.6441, -73.7822, 0),          // at the gate 2 min
        s(3, 40.6420, -73.7840, 15), s(4, 40.6395, -73.7870, 16), s(5, 40.6370, -73.7900, 15),
        s(6, 40.6330, -73.7930, 0), s(7.5, 40.6330, -73.7930, 0),         // stopped on B 2 min
        s(8, 40.6290, -73.7900, 14), s(9, 40.6250, -73.7870, 12),
        s(10, 40.6222, -73.7858, 0), s(11, 40.6222, -73.7858, 0),         // holding short 04L
        s(11.3, 40.6260, -73.7826, 90), s(11.5, 40.6320, -73.7778, 150, 40), s(12, 40.6500, -73.7600, 180, 1500),
        s(13, 40.7500, -73.6000, 300, 9000),
    ];
    const r = TV.extract(path);
    const line = (ref, coords) => ({ type: 'Feature', properties: { aeroway: 'taxiway', ref },
        geometry: { type: 'LineString', coordinates: coords.map(([la, lo]) => [lo, la]) } });
    const layout = { features: [
        line('A', [[40.6441, -73.7822], [40.6420, -73.7840], [40.6395, -73.7870], [40.6370, -73.7900]]),
        line('B', [[40.6370, -73.7900], [40.6330, -73.7930], [40.6290, -73.7900]]),
        line('K', [[40.6290, -73.7900], [40.6250, -73.7870], [40.6222, -73.7858]]),
    ] };
    const a = TV.analyse(r.out, layout);
    ok('legs in order', a.legs.map((l) => l.ref).join(' ') === 'A B K', a.legs.map((l) => l.ref).join(' '));
    ok('timed from leaving the gate', a.startT === T(2), (a.startT - t0) / 60000);
    ok('leg times add up to the whole taxi', a.legs.reduce((m, l) => m + (l.t1 - l.t0), 0) === a.endT - a.startT);
    ok('two stops found', a.stops.length === 2, a.stops.length);
    ok('the first is on B, for two minutes', a.stops[0] && a.stops[0].ref === 'B' && a.stops[0].ms === 120000,
        a.stops[0] && `${a.stops[0].ref} ${a.stops[0].ms}`);
    ok('it is filed under taxiway B', a.legs[1].stops.includes(a.stops[0]));
    ok('the last is holding short', a.stops[1] && a.stops[1].holdShort && !a.stops[0].holdShort);
    ok('total stopped time', a.stoppedMs === 120000 + 78000, a.stoppedMs);
    ok('a tick per minute on the move', a.ticks.length === Math.floor((a.endT - a.startT) / 60000), a.ticks.length);
    ok('ticks are numbered in order', a.ticks.every((tk, i) => tk.minute === i + 1));
    ok('without a layout the timing still works', TV.analyse(r.out, null).stops.length === 2);

    const svg = TV.renderSVG(r.out, { runways: JFK, layout, analysis: a, taxiways: TV.taxiwaysUsed(r.out, layout, a) });
    ok('ticks are drawn', (svg.match(/class="tv-tick"/g) || []).length >= 5);
    ok('stops are drawn with their time', svg.includes('tv-stop') && svg.includes('>2m<'));
    ok('the tall drawing is taller', /viewBox="0 0 320 300"/.test(TV.renderSVG(r.out, { tall: true })));
    const satSvg = TV.renderSVG(r.out, { runways: JFK, analysis: a, tileUrl: 'https://tiles.test/{z}/{y}/{x}' });
    const tiles = [...satSvg.matchAll(/<image href="https:\/\/tiles\.test\/(\d+)\/(\d+)\/(\d+)"/g)];
    ok('satellite draws imagery tiles under the route', satSvg.includes('tv-sat') && tiles.length > 0 && satSvg.indexOf('<image') < satSvg.indexOf('tv-path'));
    ok('at a sharp enough zoom, in a bounded number', tiles.every((m) => +m[1] >= 14 && +m[1] <= 19) && tiles.length <= 48, `${tiles.length} @ z${tiles[0] && tiles[0][1]}`);
    ok('the tiles cover JFK', tiles.some((m) => +m[3] === Math.floor((-73.79 + 180) / 360 * 2 ** +m[1])));
    ok('no tiles without imagery', !TV.renderSVG(r.out, { runways: JFK }).includes('<image'));
    ok('durations read naturally', TV.fmtDur(45000) === '45s' && TV.fmtDur(130000) === '2m 10s' && TV.fmtDur(3900000) === '1h 05m');
}

head('Pushback, snapping to the taxiways, clock times');
{
    // A local grid in metres around a point: m(east, north) → {lat, lon}.
    const LAT0 = 40.64, LON0 = -73.78;
    const m = (e, n) => ({ lat: LAT0 + n / 110540, lon: LON0 + e / (111320 * Math.cos(LAT0 * Math.PI / 180)) });
    const T = (sec) => t0 + sec * 1000;
    const fix = (sec, e, n, gs, alt = 13) => ({ t: T(sec), ...m(e, n), alt, gs });
    // Gate at (0,0). Pushed back 45 m south at 4 kt, waits a minute (engines),
    // then taxis east along A (centreline at n = -60), turns north onto B
    // (centreline at e = 600), holds short, rolls north. The fixes wander
    // ~10–15 m off the centrelines, as reported positions do.
    const path = [
        fix(0, 0, 0, 0), fix(60, 0, 0, 0),
        fix(80, 2, -45, 4), fix(100, 1, -46, 0), fix(160, 1, -46, 0),        // push, engine start
        fix(190, 90, -72, 14), fix(220, 260, -48, 16), fix(250, 430, -73, 15),
        fix(280, 590, -50, 12),                                               // the turn
        fix(310, 612, 120, 15), fix(340, 588, 300, 14), fix(370, 611, 470, 6),
        fix(400, 600, 520, 0), fix(460, 600, 520, 0),                        // holding short
        fix(475, 600, 700, 90), fix(485, 600, 1100, 150, 60), fix(500, 600, 2200, 170, 900),
    ];
    const line = (ref, pts) => ({ type: 'Feature', properties: { aeroway: 'taxiway', ref },
        geometry: { type: 'LineString', coordinates: pts.map(([e, n]) => { const q = m(e, n); return [q.lon, q.lat]; }) } });
    const layout = { features: [
        line('A', [[-200, -60], [300, -60], [700, -60]]),
        line('B', [[600, -200], [600, 200], [600, 560]]),
        line('C', [[300, -300], [300, 300]]),                                 // crossed, not used
    ] };
    const r = TV.extract(path);
    const a = TV.analyse(r.out, layout);
    ok('a pushback is found', !!a.pushback, JSON.stringify(a.pushback && { m: Math.round(a.pushback.m) }));
    ok('about 45 m of it', a.pushback && Math.abs(a.pushback.m - 45) < 6, a.pushback && a.pushback.m);
    ok('pushed back, then started taxiing, then took off — in that order',
        a.times.pushback < a.times.taxi && a.times.taxi < a.times.takeoff, JSON.stringify(a.times));
    ok('push started after the last fix at the gate', a.times.pushback >= T(60) && a.times.pushback <= T(80));
    ok('taxi started after the engine-start wait', a.times.taxi >= T(160) && a.times.taxi <= T(190));
    ok('the engine-start wait is not counted as a taxi stop', a.stops.length === 1 && a.stops[0].holdShort,
        a.stops.map((s) => s.ms / 1000 + 's').join(','));
    ok('took off at the end of the roll', a.times.takeoff === r.out.roll[r.out.roll.length - 1].t);
    ok('legs are A then B', a.legs.map((l) => l.ref).join(' ') === 'A B', a.legs.map((l) => l.ref).join(' '));

    // Distance (m) from a point to the nearest of the used centrelines.
    const toLine = (q) => {
        const e = (q.lon - LON0) * 111320 * Math.cos(LAT0 * Math.PI / 180), n = (q.lat - LAT0) * 110540;
        return Math.min(Math.abs(n + 60) + (e < -200 || e > 700 ? 999 : 0), Math.abs(e - 600) + (n < -200 || n > 560 ? 999 : 0));
    };
    const taxi = a.route.taxi;
    const rawOff = Math.max(...r.out.path.slice(5).map(toLine));
    ok('the reported fixes are well off the centrelines', rawOff > 10, rawOff.toFixed(1));
    // Away from the corner (where rounding cuts inside), the drawn path is on the line.
    const straight = taxi.filter((q) => { const e = (q.lon - LON0) * 84470, n = (q.lat - LAT0) * 110540; return Math.hypot(e - 600, n + 60) > 60; });
    const drawnOff = Math.max(...straight.map(toLine));
    ok('the drawn taxi follows the centrelines', drawnOff < 3, drawnOff.toFixed(1));
    // No reversals or kinks: heading change between points ~10 m apart stays gentle.
    const hd = [];
    for (let i = 0, last = taxi[0]; i < taxi.length; i++) {
        const q = taxi[i];
        if (Math.hypot((q.lon - last.lon) * 84470, (q.lat - last.lat) * 110540) < 10) continue;
        hd.push(Math.atan2((q.lat - last.lat) * 110540, (q.lon - last.lon) * 84470) * 180 / Math.PI);
        last = q;
    }
    const worst = Math.max(...hd.slice(1).map((h, i) => { const d = Math.abs(h - hd[i]) % 360; return d > 180 ? 360 - d : d; }));
    ok('no sharp kinks or reversals in the drawn taxi', worst < 60, worst.toFixed(0) + '°');
    ok('the pushback is drawn as flown, ending where the taxi begins',
        a.route.push.length >= 2 && Math.abs(a.route.push[a.route.push.length - 1].lat - taxi[0].lat) < 1e-9
        && Math.abs(a.route.push[a.route.push.length - 1].lon - taxi[0].lon) < 1e-9);
    ok('the roll is not snapped', r.out.roll.every((s) => !taxi.includes(s)));

    // The stop marker sits on the drawn line.
    ok('the hold-short marker is on the centreline', toLine(a.stops[0]) < 3, toLine(a.stops[0]).toFixed(1));

    const svg = TV.renderSVG(r.out, { layout, analysis: a, clock: (ms) => new Date(ms).toISOString().slice(11, 16) });
    ok('the push tail is drawn', svg.includes('class="tv-push"'));
    ok('push, taxi and take-off times are tagged', /Push \d\d:\d\d/.test(svg) && /Taxi \d\d:\d\d/.test(svg) && /T\/O \d\d:\d\d/.test(svg),
        (svg.match(/(Push|Taxi|T\/O) \d\d:\d\d/g) || []).join(','));

    // Without a layout nothing is snapped, and nothing breaks.
    const plain = TV.analyse(r.out, null);
    ok('without a layout the path is drawn as flown', plain.route.taxi.length > 2 && !!plain.pushback);

    // No pushback when it powers straight out at taxi speed.
    const noPush = TV.analyse(TV.extract([fix(0, 0, 0, 0), fix(60, 0, 0, 0), fix(90, 150, -50, 15), fix(120, 400, -60, 15),
        fix(150, 600, -60, 15), fix(160, 600, 300, 120), fix(170, 600, 900, 160, 400)]).out, layout);
    ok('powering straight out is not a pushback', noPush.pushback === null && noPush.times.taxi >= T(60));
}

head('In flight: top of climb, steps, top of descent');
{
    const T = (min) => t0 + min * 60000;
    const s = (min, alt) => ({ t: T(min), lat: 40 + min * 0.01, lon: -73 + min * 0.05, alt, gs: alt > 100 ? 300 : 0 });
    const prof = [];
    for (let m = 0; m <= 20; m++) prof.push(s(m, m * 1750));                     // climb to 35,000
    for (let m = 21; m <= 80; m++) prof.push(s(m, 35000 + (m % 3) * 60));       // FL350 (with wobble)
    for (let m = 81; m <= 84; m++) prof.push(s(m, 35000 + (m - 80) * 500));      // step climb
    for (let m = 85; m <= 140; m++) prof.push(s(m, 37000));                      // FL370
    for (let m = 141; m <= 170; m++) prof.push(s(m, 37000 - (m - 140) * 1200));  // descent
    const ms = TV.milestones(prof);
    ok('top of climb at FL350', ms[0] && ms[0].kind === 'toc' && ms[0].fl === 350, JSON.stringify(ms[0]));
    ok('when it got there', ms[0] && ms[0].t <= T(21) && ms[0].t >= T(19));
    ok('a step climb to FL370', ms[1] && ms[1].kind === 'step' && ms[1].fl === 370 && ms[1].dir === 1, JSON.stringify(ms[1]));
    ok('top of descent last', ms[2] && ms[2].kind === 'tod' && ms[2].t >= T(139) && ms[2].t <= T(141), JSON.stringify(ms[2]));
    ok('nothing else', ms.length === 3, ms.map((m) => m.kind).join(','));
    ok('still climbing: no milestones yet', TV.milestones(prof.slice(0, 15)).length === 0);
    ok('in cruise: top of climb, no top of descent', TV.milestones(prof.slice(0, 60)).map((m) => m.kind).join(',') === 'toc');
}

head('Still taxiing');
{
    const r = TV.extract(taxiOut.slice(0, 5));
    ok('reported as ongoing', r.out && r.out.ongoing);
    ok('with no roll yet', r.out && r.out.roll.length === 0);
    ok('and no taxi-in', r.in === null);
}

head('Spawned in the air');
{
    const r = TV.extract(climb);
    ok('has no taxi-out', r.out === null);
}

head('Landed and taxied in');
{
    t = t0 + 3 * 3600 * 1000;
    const approach = [at(40.70, -73.90, 3000, 160), at(40.66, -73.82, 600, 145)];
    // Landing roll north-east along 04R, then off to the gates.
    const landRoll = [at(40.6313, -73.7657, 15, 130, 20), at(40.6363, -73.7618, 15, 80, 20)];
    const taxiIn = [at(40.6360, -73.7680, 13, 25), at(40.6400, -73.7740, 13, 15), at(40.6430, -73.7800, 13, 6), at(40.6441, -73.7822, 13, 0), at(40.6441, -73.7822, 13, 0)];
    const r = TV.extract(climb.concat(approach, landRoll, taxiIn));
    ok('found', !!r.in);
    ok('starts after the landing roll', r.in && r.in.path[0] === taxiIn[0]);
    ok('the landing roll is kept for the runway', r.in && r.in.roll.length === 2, r.in && r.in.roll.length);
    ok('parked, so not ongoing', r.in && !r.in.ongoing);
    ok('timed until it stopped', r.in && Math.round(r.in.minutes) === 3, r.in && r.in.minutes);
    const rwy = TV.runwayFor(JFK, r.in.roll);
    ok('landing runway identified as 04R', rwy && rwy.ident === '04R', rwy && rwy.ident);
}

head('Nothing usable');
{
    ok('an empty trail', TV.extract([]).out === null);
    ok('no runway without a roll', TV.runwayFor(JFK, []) === null);
    ok('no runway far from any', TV.runwayFor(JFK, [{ lat: 41.5, lon: -72.0 }]) === null);
    ok('no drawing without a path', TV.renderSVG(null) === '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
