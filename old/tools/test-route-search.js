// test-route-search.js
//
// The route shape of the global search: "EGLL-KJFK" and everything anyone
// might type meaning the same thing.
//
// This is a parser sitting in front of a search box, so the failure mode that
// matters is not "it threw" but "it quietly decided this wasn't a route" — or
// worse, decided an ordinary two-word query was one. Both directions are
// checked here, along with the ordering of the traffic it finds, which is the
// part a reader of the list has no way to verify by eye.
//
// Node builtins only, like tools/verify-data.js — no browser, no install step.
//
// Run:  node tools/test-route-search.js
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const MODULE = pathToFileURL(path.resolve(__dirname, '..', 'searchEngine.js')).href;

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${extra ? `  (${extra})` : ''}`); fail++; }
};
const head = (s) => console.log(`\n${s}`);

// Four real fields plus one deliberate IATA collision: a heliport that also
// answers to LHR, to prove the resolver prefers the real indicator.
const AIRPORTS = {
    EGLL: { name: 'London Heathrow', iata: 'LHR', lat: 51.4775, lon: -0.4614, country: 'GB', s: 4 },
    KJFK: { name: 'John F Kennedy Intl', iata: 'JFK', lat: 40.6413, lon: -73.7781, country: 'US', s: 4 },
    LFPG: { name: 'Paris Charles de Gaulle', iata: 'CDG', lat: 49.0097, lon: 2.5479, country: 'FR', s: 4 },
    EHAM: { name: 'Amsterdam Schiphol', iata: 'AMS', lat: 52.3105, lon: 4.7683, country: 'NL', s: 4 },
    '2LH9': { name: 'Lower Heathrow Helipad', iata: 'LHR', lat: 51.4, lon: -0.45, country: 'GB', s: 0 },
};

const flight = (id, dep, arr, lat, lon, extra = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
        flightId: id, callsign: id, username: `pilot_${id}`,
        altitude: 35000, speed: 460, heading: 270,
        aircraftName: 'Boeing 777-300ER', liveryName: 'British Airways',
        departureIcao: dep, arrivalIcao: arr, ...extra,
    },
});

const FLIGHTS = [
    // Three on EGLL → KJFK at different points along the way.
    flight('BAW117', 'EGLL', 'KJFK', 51.4, -0.5),    // still at Heathrow
    flight('BAW175', 'EGLL', 'KJFK', 53.0, -30.0),   // mid-ocean
    flight('VIR3', 'EGLL', 'KJFK', 41.0, -72.0),     // nearly there
    // One coming back the other way.
    flight('BAW178', 'KJFK', 'EGLL', 45.0, -40.0),
    // Unrelated traffic that must never appear on the route.
    flight('AFR1680', 'LFPG', 'EHAM', 50.0, 3.0),
    // Filed nowhere — a very common state in the live feed.
    flight('N172SP', '', '', 51.2, -0.6),
];

(async () => {
    const S = await import(MODULE);
    const run = (q) => S.runSearch(q, { airportsData: AIRPORTS, flights: FLIGHTS });
    const routeOf = (q) => (run(q).routes || [])[0] || null;

    // ------------------------------------------------------------------
    head('Parsing the pair');
    for (const q of ['EGLL-KJFK', 'EGLL KJFK', 'egll>kjfk', 'EGLL/KJFK', 'EGLL to KJFK',
        'EGLL–KJFK', 'EGLL → KJFK', '  egll  -  kjfk  ']) {
        const p = S.parseRoutePair(q);
        ok(`"${q}" is EGLL → KJFK`, p && p[0] === 'EGLL' && p[1] === 'KJFK', JSON.stringify(p));
    }

    head('Refusing what is not a pair');
    for (const q of ['EGLL', 'heathrow', 'EGLL KJFK LFPG', 'EG-KJFK', 'EGLL-EGLL', '', '-', 'to']) {
        ok(`"${q}" is not a route`, S.parseRoutePair(q) === null, JSON.stringify(S.parseRoutePair(q)));
    }
    // "to" is stripped as a word, so a code that merely contains those letters
    // has to survive: TOJ is a real ICAO prefix shape.
    ok('a code containing "to" is not mangled',
        JSON.stringify(S.parseRoutePair('KTOL-KJFK')) === '["KTOL","KJFK"]',
        JSON.stringify(S.parseRoutePair('KTOL-KJFK')));

    // ------------------------------------------------------------------
    head('Resolving the ends');
    ok('ICAO codes resolve directly', !!routeOf('EGLL-KJFK'));
    const byIata = routeOf('LHR-JFK');
    ok('IATA codes resolve too', byIata && byIata.dep.icao === 'EGLL' && byIata.arr.icao === 'KJFK',
        byIata && `${byIata.dep.icao}-${byIata.arr.icao}`);
    ok('a shared IATA code picks the real airport, not the helipad',
        byIata && byIata.dep.icao === 'EGLL');
    ok('mixing ICAO and IATA works', (routeOf('EGLL-JFK') || {}).arr?.icao === 'KJFK');
    ok('an unknown code yields no route', routeOf('EGLL-ZZZZ') === null);
    ok('two unknown codes yield no route', routeOf('ZZZZ-YYYY') === null);
    ok('an ordinary query yields no route', routeOf('british airways') === null);
    ok('a single airport query yields no route', routeOf('EGLL') === null);

    // ------------------------------------------------------------------
    head('The route itself');
    const r = routeOf('EGLL-KJFK');
    ok('carries both airports by name',
        r.dep.name === 'London Heathrow' && r.arr.name === 'John F Kennedy Intl');
    ok('great-circle distance is ~2991 NM', Math.abs(r.distanceNm - 2990.98) < 1, r.distanceNm.toFixed(1));
    ok('counts only the traffic going that way', r.total === 3, String(r.total));
    ok('counts the return leg separately', r.reverse === 1, String(r.reverse));
    ok('unrelated traffic is excluded',
        !r.flights.some(x => ['AFR1680', 'N172SP', 'BAW178'].includes(x.feature.properties.flightId)));
    ok('the nearly-arrived flight is listed first',
        r.flights[0].feature.properties.flightId === 'VIR3',
        r.flights.map(x => x.feature.properties.flightId).join(','));
    ok('the one still on stand is listed last',
        r.flights[r.flights.length - 1].feature.properties.flightId === 'BAW117');
    ok('each entry carries the distance still to run',
        r.flights.every(x => Number.isFinite(x.toGoNm)) && r.flights[0].toGoNm < r.flights[2].toGoNm);

    const back = routeOf('KJFK-EGLL');
    ok('the reverse query is its own route', back.dep.icao === 'KJFK' && back.total === 1);

    const empty = routeOf('LFPG-KJFK');
    ok('a route nobody is flying still resolves',
        empty && empty.total === 0 && empty.flights.length === 0 && empty.distanceNm > 0);

    // ------------------------------------------------------------------
    head('Not breaking the rest of the box');
    const normal = run('BAW117');
    ok('a callsign search still finds its flight',
        normal.flights.some(x => x.feature.properties.flightId === 'BAW117'));
    ok('a callsign search adds no route', (normal.routes || []).length === 0);
    const apt = run('heathrow');
    ok('an airport search still works', apt.airports.some(x => x.airport.icao === 'EGLL'));
    ok('every result set carries a routes array', Array.isArray(run('x').routes));
    ok('a too-short query returns the empty shape',
        Array.isArray(run('a').routes) && run('a').routes.length === 0);

    // ------------------------------------------------------------------
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
