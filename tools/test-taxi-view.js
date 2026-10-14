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
