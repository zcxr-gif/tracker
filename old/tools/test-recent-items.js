// test-recent-items.js — the flights and airports offered by an empty search.
//
// Two behaviours here are worth pinning down, because both fail quietly:
//
//   * Re-opening something must refresh its place in the list, not append a
//     second row saying the same thing with an older timestamp.
//   * A remembered flight is resolved LIVE, at tap time — not at record time.
//     The list can sit on screen while a flight lands underneath it, and the
//     row has to send you to the replay rather than to a flight that is no
//     longer in the feed. Recording the state instead would look correct in
//     every quick test and be wrong exactly when it matters.
//
// Node builtins only. recentItems.js touches `window` and `localStorage` only
// inside its methods, so it imports cleanly against stubs.
//
// Run:  node tools/test-recent-items.js
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${extra ? `  (${extra})` : ''}`); fail++; }
};
const head = (s) => console.log(`\n${s}`);

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis.window || {};
window.localStorage = globalThis.localStorage;

(async () => {
    const { RecentItems: R } = await import(pathToFileURL(path.join(ROOT, 'recentItems.js')).href);

    // ------------------------------------------------------------------
    head('Recording what was opened');
    store.clear();
    ok('nothing is remembered to start with', R.isEmpty());

    R.rememberFlight({ flightId: 'f1', callsign: 'BAW117', username: 'ant', departureIcao: 'egll', arrivalIcao: 'kjfk' });
    const first = R.flights()[0];
    ok('a flight is remembered', first && first.id === 'f1');
    ok('its callsign is kept', first.callsign === 'BAW117');
    ok('airport codes are upper-cased', first.dep === 'EGLL' && first.arr === 'KJFK');
    ok('it is timestamped', typeof first.at === 'number');
    ok('the list is no longer empty', !R.isEmpty());

    R.rememberFlight({ flightId: 'f2', callsign: 'EZY42' });
    ok('the newest is first', R.flights()[0].id === 'f2');

    R.rememberFlight({ flightId: 'f1', callsign: 'BAW117' });
    ok('re-opening moves it back to the front', R.flights()[0].id === 'f1');
    ok('re-opening does not duplicate it',
        R.flights().filter(f => f.id === 'f1').length === 1, String(R.flights().length));

    R.rememberFlight({ callsign: 'NOID' });
    ok('a flight with no id is ignored', !R.flights().some(f => f.callsign === 'NOID'));

    head('...and how much of it');
    for (let i = 0; i < 40; i++) R.rememberFlight({ flightId: 'bulk' + i, callsign: 'C' + i });
    ok('the stored list is capped', R.flights().length <= 12, String(R.flights().length));
    ok('the dropdown shows fewer still', R.forDisplay().flights.length <= 5,
        String(R.forDisplay().flights.length));

    head('Airports');
    store.clear();
    window.getAirportName = (icao) => (icao === 'EGLL' ? 'London Heathrow' : '');
    R.rememberAirport('egll');
    ok('an airport is remembered upper-cased', R.airports()[0].icao === 'EGLL');
    ok('its name is resolved once and kept', R.airports()[0].name === 'London Heathrow');
    R.rememberAirport('   ');
    ok('a blank code is ignored', R.airports().length === 1);
    R.rememberAirport('KJFK');
    ok('a name we do not know is not fabricated', R.airports()[0].name === null);

    head('Storage that has gone wrong');
    store.set('inflight_recent_flights', 'not json');
    ok('corrupt storage reads as empty rather than throwing', R.flights().length === 0);
    store.set('inflight_recent_flights', JSON.stringify([{ id: 'a', at: Date.now() }, null, 'x', { id: 'b' }]));
    ok('malformed entries are dropped', R.flights().length === 1, String(R.flights().length));
    // An entry from last month is history, not "recent".
    store.set('inflight_recent_flights', JSON.stringify([
        { id: 'old', at: Date.now() - 30 * 24 * 60 * 60 * 1000 },
        { id: 'new', at: Date.now() },
    ]));
    ok('stale entries expire', R.flights().length === 1 && R.flights()[0].id === 'new');

    // ------------------------------------------------------------------
    head('Opening a flight resolves at tap time');
    {
        store.clear();
        R.rememberFlight({ flightId: 'live1', callsign: 'BAW117' });
        R.rememberFlight({ flightId: 'gone1', callsign: 'EZY42' });

        const liveFeature = { geometry: { coordinates: [-30.5, 53.2] }, properties: { flightId: 'live1' } };
        window.getLiveFlightById = (id) => (id === 'live1' ? liveFeature : null);

        let opened = null; let replayed = null;
        window.onSearchResultClick = (id, lat, lon) => { opened = { id, lat, lon }; };
        window.openFlightReplayById = (id, meta) => { replayed = { id, meta }; };

        ok('a live flight reports as live', R.isLive('live1'));
        ok('a landed flight reports as not live', !R.isLive('gone1'));

        ok('opening a live flight opens the window', R.openFlight('live1') === 'live');
        ok('it passes the position in lat, lon order',
            opened && opened.lat === 53.2 && opened.lon === -30.5,
            JSON.stringify(opened));

        ok('opening a landed flight falls back to the replay',
            R.openFlight('gone1', { callsign: 'EZY42' }) === 'replay');
        ok('the replay is labelled with the callsign',
            replayed && replayed.meta.callsign === 'EZY42');

        // The row can be tapped after the flight leaves the feed — the answer
        // must come from the feed at that moment, not from what was recorded.
        window.getLiveFlightById = () => null;
        ok('a flight that just landed no longer reports as live', !R.isLive('live1'));
        ok('and now opens the replay instead', R.openFlight('live1') === 'replay');

        window.openFlightReplayById = undefined;
        ok('with no replay available it reports that plainly', R.openFlight('gone1') === 'none');
    }

    head('Opening an airport');
    {
        let asked = null;
        window.getAirportCoords = (icao) => (icao === 'EGLL' ? { lat: 51.4775, lon: -0.4614 } : null);
        window.onAirportSearchResultClick = (arg) => { asked = arg; };
        ok('it goes through the search-result path', R.openAirport('egll') === true);
        ok('with the code and its coordinates',
            asked.icao === 'EGLL' && asked.lat === 51.4775, JSON.stringify(asked));
        ok('an airport with no coordinates still opens', R.openAirport('ZZZZ') === true);
    }

    head('Clearing');
    ok('clear empties both lists', (R.clear(), R.isEmpty()));

    // ------------------------------------------------------------------
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
