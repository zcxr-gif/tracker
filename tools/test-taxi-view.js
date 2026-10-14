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
    ok('durations read naturally', TV.fmtDur(45000) === '45s' && TV.fmtDur(130000) === '2m 10s' && TV.fmtDur(3900000) === '1h 05m');
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
