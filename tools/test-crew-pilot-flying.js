// test-crew-pilot-flying.js
// Drives the REAL crew-pilot.html — the page ordinary pilots use — to prove it
// shows THIS pilot's flying rather than the four invented Air Canada legs and
// the "214h of 250h" rank card that were hardcoded into it.
//
//   * the stat row, the rank card, the recent list and the hero all come from
//     GET /me/flying, and none of the old fake values survive
//   * a pilot with no flights is told so, rather than shown somebody else's
//   * the logbook opens from both the link and the tile (neither had a handler)
//     and shows pending and rejected reports, not just the approved ones
//   * filing a flight means PICKING one out of their real Infinite Flight
//     logbook — the browser sends an id, never a route or a duration — with the
//     typed form kept as the fallback for a flight IF never logged
//   * standings show a pilot where they sit among the people they fly with —
//     including, and especially, when they are nowhere near the top
//   * a pilot at the top of the ladder is not shown an empty progress bar
//
// Run:  node tools/test-crew-pilot-flying.js
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? '/crew-pilot.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

const FLIGHTS = [
    { id: 'p1', origin: 'EGLL', destination: 'LFPG', aircraftName: 'Airbus A320', flightNumber: 'BA304', durationMin: 75, status: 'approved', flownAt: ago(30) },
    { id: 'p2', origin: 'LFPG', destination: 'EGLL', aircraftName: 'Airbus A320', flightNumber: 'BA305', durationMin: 80, status: 'pending', flownAt: ago(10) },
    { id: 'p3', origin: 'EGLL', destination: 'EDDF', aircraftName: 'Boeing 737', flightNumber: '', durationMin: 95, status: 'rejected', flownAt: ago(200) },
    { id: 'p4', origin: 'EGKK', destination: 'LEBL', aircraftName: 'Airbus A321', flightNumber: 'BA490', durationMin: 130, status: 'approved', flownAt: ago(900) },
];

// The pilot's real Infinite Flight logbook, as GET /me/if-flights hands it over:
// already judged against this airline (filed before? fleet aircraft? published
// route?), because those are facts the browser cannot work out for itself.
const LOGBOOK_PAGES = [
    {
        linked: true, page: 1, totalPages: 2, hasNextPage: true,
        flights: [
            { flightId: 'if-1', origin: 'EGLL', destination: 'KSFO', aircraftName: 'Boeing 777-300ER', liveryName: 'British Airways', durationMin: 645, landings: 1, xp: 1200, violations: 0, server: 'Expert', callsign: 'BAW285', flownAt: ago(6), filed: false, inFleet: true, routeMatched: true, flightNumber: 'BA285' },
            { flightId: 'if-2', origin: 'EGLL', destination: 'LFPG', aircraftName: 'Airbus A320', liveryName: 'British Airways', durationMin: 75, landings: 1, xp: 300, violations: 0, server: 'Expert', callsign: 'BAW304', flownAt: ago(30), filed: true, inFleet: true, routeMatched: true, flightNumber: 'BA304' },
            { flightId: 'if-3', origin: 'KJFK', destination: 'KBOS', aircraftName: 'Cessna 172', liveryName: 'Generic', durationMin: 55, landings: 3, xp: 90, violations: 1, server: 'Training', callsign: 'N172RG', flownAt: ago(48), filed: false, inFleet: false, routeMatched: false, flightNumber: '' },
        ],
    },
    {
        linked: true, page: 2, totalPages: 2, hasNextPage: false,
        flights: [
            { flightId: 'if-4', origin: 'EGKK', destination: 'LEBL', aircraftName: 'Airbus A321', liveryName: 'British Airways', durationMin: 130, landings: 1, xp: 420, violations: 0, server: 'Expert', callsign: 'BAW490', flownAt: ago(900), filed: false, inFleet: true, routeMatched: true, flightNumber: 'BA490' },
        ],
    },
];
let logbook = LOGBOOK_PAGES[0];

// The standings, as GET /standings hands them over: ranked by flights inside a
// window, with the caller's own row carried separately so the panel can show it
// whether or not they made the board.
const STANDINGS = (window) => ({
    window,
    board: [
        { rank: 1, memberId: 'm9', name: 'Kit Marlowe', callsign: 'BAW09', onRoster: true, flights: 12, hours: 19.4, landings: 12, lastFlightAt: ago(4), badge: { name: 'Captain' } },
        { rank: 2, memberId: 'm1', name: 'Rae Okafor', callsign: 'BAW22', onRoster: true, flights: 7, hours: 11.2, landings: 7, lastFlightAt: ago(30), badge: { name: 'First Officer' } },
        { rank: 3, memberId: 'm8', name: 'Ada Nwosu', callsign: 'BAW08', onRoster: true, flights: 3, hours: 5.1, landings: 3, lastFlightAt: ago(60), badge: { name: 'First Officer' } },
    ],
    me: { rank: 2, memberId: 'm1', name: 'Rae Okafor', callsign: 'BAW22', onRoster: true, flights: 7, hours: 11.2, landings: 7, lastFlightAt: ago(30), badge: { name: 'First Officer' }, of: 3 },
    totals: { pilots: 3, flights: 22, hours: 35.7 },
});
let standingsBody = null;      // set to override; null means the shape above
let standingsWindow = null;    // what the page last asked for

let filed = null;
let flyingBody = {
    pilot: { memberId: 'm1', name: 'Rae Okafor', callsign: 'BAW22', hours: 214.5, status: 'active' },
    rank: { name: 'First Officer', minHours: 100, next: { name: 'Captain', minHours: 250, hoursAway: 35.5, requiresCheck: false }, awaitingCheck: null },
    flights: FLIGHTS,
    totals: { flights: 2, pending: 1, rejected: 1, minutes: 205, minutes30d: 75, flights30d: 1, lastFlightAt: ago(30) },
};

function api(route) {
    const p = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.endsWith('/me/flying')) return json(flyingBody);
    if (p.endsWith('/standings')) {
        standingsWindow = Number(new URL(route.request().url()).searchParams.get('window'));
        return json(standingsBody || STANDINGS(standingsWindow));
    }
    if (p.endsWith('/me/if-flights')) {
        // An unlinked pilot has one page and no flights; everyone else pages.
        if (logbook.linked === false) return json(logbook);
        const want = Number(new URL(route.request().url()).searchParams.get('page') || 1);
        return json(LOGBOOK_PAGES[want - 1] || { linked: true, page: want, hasNextPage: false, flights: [] });
    }
    if (p.endsWith('/pireps') && method === 'POST') { filed = route.request().postDataJSON(); return json({ pirep: { id: 'new' }, routeMatched: true }, 201); }
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: false });
    if (p.endsWith('/events')) return json({ events: [], canManage: false, mine: [], ranks: [] });
    if (p.endsWith('/schedules')) return json({ schedules: [], mine: [], canManage: false, rules: { enabled: true }, ranks: [] });
    if (p.endsWith('/me')) return json({ role: 'pilot', name: 'Rae Okafor', mustChangePassword: false });
    if (p.endsWith('/branding')) return json({ name: 'Test VA', code: 'TVA' });
    return json({});
}

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${extra ? `  (${extra})` : ''}`); fail++; }
};
const head = (s) => console.log(`\n${s}`);

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    const open = async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        await page.route('**/api/**', api);
        await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Rae Okafor', role: 'pilot' })));
        await page.goto(`http://127.0.0.1:${port}/crew-pilot.html?va=testva`);
        await page.waitForTimeout(1000);
        return { ctx, page };
    };

    const { ctx, page } = await open();

    // ------------------------------------------------------------------
    head('The invented pilot is gone');

    const bodyText = await page.innerText('body');
    for (const ghost of ['CYYZ → CYVR', 'CYYZ → EGLL', 'CYUL → KLGA', 'CYVR → RJTT', 'ACA1174', 'ACA085']) {
        ok(`no trace of "${ghost}"`, !bodyText.includes(ghost));
    }
    ok('"Welcome back, Jordan" is gone', !bodyText.includes('Jordan'), bodyText.slice(0, 60));

    // ------------------------------------------------------------------
    head('The numbers are this pilot\'s own');

    ok('hours come from their own approved reports', (await page.textContent('#statHours')).trim() === '3h', await page.textContent('#statHours'));
    ok('…with the last 30 days beside it', /1h/.test(await page.textContent('#statHoursSub')), await page.textContent('#statHoursSub'));
    ok('flights count approved only', (await page.textContent('#statFlights')).trim() === '2', await page.textContent('#statFlights'));
    ok('the rank is the one they hold', (await page.textContent('#statRank')).trim() === 'First Officer', await page.textContent('#statRank'));
    ok('a report awaiting review is surfaced', (await page.textContent('#statPending')).trim() === '1', await page.textContent('#statPending'));

    const rank = await page.innerText('#rankBody');
    ok('the rank card names the real next rung', /First Officer → Captain/.test(rank), rank);
    ok('…against this VA\'s own threshold', /of 250h/.test(rank), rank);
    ok('…and their real hours', /214\.5h/.test(rank), rank);
    ok('the hero says something true about them', /35\.5 hours from Captain/.test(await page.innerText('#heroLine')), await page.innerText('#heroLine'));
    ok('the callsign is theirs', (await page.textContent('#heroCallsign')).trim() === 'BAW22');

    // ------------------------------------------------------------------
    head('Recent flights');

    const flights = await page.innerText('#flights');
    ok('their real legs are listed', /EGLL → LFPG/.test(flights), flights.slice(0, 80));
    ok('a pending report is visible to the pilot who filed it', /Pending/.test(flights), flights);
    ok('…and a rejected one is not silently hidden', /Rejected/.test(flights), flights);

    // ------------------------------------------------------------------
    head('The logbook (both controls were dead)');

    await page.click('text=Logbook');
    await page.waitForTimeout(600);
    let log = await page.innerText('#pilotLogbook');
    ok('the Logbook link opens it', /My logbook/.test(log));
    ok('…showing the whole history', /EGKK → LEBL/.test(log), log.slice(0, 120));
    ok('…with the totals on top', /2 flights/.test(log.replace(/\s+/g, ' ')), log.slice(0, 160));

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.click('#quickGrid [data-i="3"]');
    await page.waitForTimeout(600);
    ok('the "My logbook" tile opens it too', await page.isVisible('#pilotLogbook .cp-body'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // ------------------------------------------------------------------
    head('Filing a flight — picked out of the real logbook');

    await page.click('#quickGrid [data-i="0"]');
    await page.waitForTimeout(600);
    let picker = await page.innerText('#crewFlightPicker');
    ok('the File a PIREP tile opens the pilot\'s own flights', await page.isVisible('#crewFlightPicker .fp-list'));
    ok('…listing what they actually flew', /EGLL → KSFO/.test(picker), picker.slice(0, 160));
    ok('…with the route it matches named', /BA285/.test(picker), picker.slice(0, 200));
    ok('…a flight already filed marked as such', /already filed/i.test(picker), picker);
    ok('…and an aircraft the airline doesn\'t operate flagged', /not in the fleet/i.test(picker), picker);
    ok('a flight already filed cannot be filed twice',
        await page.isDisabled('[data-fp-pick="if-2"]'));

    await page.click('[data-fp-pick="if-1"]');
    await page.waitForTimeout(300);
    const confirm = await page.innerText('#crewFlightPicker');
    ok('picking one shows what will be filed', /Boeing 777-300ER/.test(confirm), confirm.slice(0, 200));
    ok('…including the time off the record, not off the pilot', /10h 45m/.test(confirm), confirm);
    ok('…and the livery they flew in', /British Airways/.test(confirm), confirm);

    await page.click('[data-fp-file]');
    await page.waitForTimeout(600);

    ok('filing sends the flight id and nothing else that matters',
        filed && filed.flightId === 'if-1', JSON.stringify(filed));
    ok('…so no route, aircraft or duration can be edited on the way in',
        filed && !('origin' in filed) && !('aircraftName' in filed) && !('durationMin' in filed) && !('hours' in filed),
        JSON.stringify(filed));
    ok('…with the page it was found on, so the server can look it up again',
        filed && filed.flightPage === 1, JSON.stringify(filed));
    ok('the panel closes once it is filed', !(await page.isVisible('#crewFlightPicker .fp-list')));

    // Older pages, for a flight further back than the first page.
    await page.click('#quickGrid [data-i="0"]');
    await page.waitForTimeout(600);
    await page.click('[data-fp-more]');
    await page.waitForTimeout(500);
    picker = await page.innerText('#crewFlightPicker');
    ok('older flights load onto the list rather than replacing it',
        /EGLL → KSFO/.test(picker) && /EGKK → LEBL/.test(picker), picker.slice(0, 240));

    // ------------------------------------------------------------------
    head('Filing by hand — the fallback, for a flight IF never logged');

    filed = null;
    await page.click('[data-fp-manual]');
    await page.waitForTimeout(500);
    ok('the by-hand form is still reachable', await page.isVisible('#pfForm'));

    await page.fill('#pfFrom', 'egll');
    await page.fill('#pfTo', 'ksfo');
    await page.fill('#pfAircraft', 'Boeing 777-300ER');
    await page.fill('#pfHours', '10');
    await page.fill('#pfMinutes', '45');
    await page.click('#pfSubmit');
    await page.waitForTimeout(600);

    ok('it sends the airports, upper-cased', filed && filed.origin === 'EGLL' && filed.destination === 'KSFO', JSON.stringify(filed));
    ok('…the aircraft', filed && filed.aircraftName === 'Boeing 777-300ER');
    ok('…and the duration as hours + minutes', filed && filed.hours === 10 && filed.minutes === 45, JSON.stringify(filed));
    ok('…attributed to this pilot', filed && filed.memberId === 'm1');

    // ------------------------------------------------------------------
    head('Standings — the panel pilots were never shown');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.click('#quickGrid [data-i="6"]');
    await page.waitForTimeout(600);
    let board = await page.innerText('#crewStandings');
    ok('the Standings tile opens the board', await page.isVisible('#crewStandings .cs-list'));
    ok('…ranking the people actually flying', /Kit Marlowe/.test(board), board.slice(0, 200));
    ok('…over this month by default', /This month/.test(board));
    ok('…with the airline\'s totals on top', /3 pilots flying/.test(board), board.slice(0, 200));

    ok('the signed-in pilot is marked on the board', await page.isVisible('.cs-row-me'));
    const mine = await page.innerText('.cs-row-me');
    ok('…as themselves, not a name they have to find', /\byou\b/i.test(mine), mine);

    // The window buttons are the whole point of ranking over a window.
    await page.click('[data-cs-window="0"]');
    await page.waitForTimeout(500);
    board = await page.innerText('#crewStandings');
    ok('all-time is a different board, not the same one relabelled',
        /Rae Okafor/.test(board) && standingsWindow === 0, `window=${standingsWindow}`);

    await ctx.close();

    // ------------------------------------------------------------------
    head('A pilot who has flown nothing this month');

    // The case a leaderboard normally answers by leaving you off it.
    standingsBody = {
        window: 30,
        board: [
            { rank: 1, memberId: 'm9', name: 'Kit Marlowe', callsign: 'BAW09', onRoster: true, flights: 9, hours: 14.5, landings: 9, lastFlightAt: ago(4), badge: { name: 'Captain' } },
            { rank: 2, memberId: 'm8', name: 'Ada Nwosu', callsign: 'BAW08', onRoster: true, flights: 4, hours: 6.2, landings: 4, lastFlightAt: ago(20), badge: { name: 'First Officer' } },
        ],
        me: { rank: null, memberId: 'm1', name: 'Rae Okafor', callsign: 'BAW22', onRoster: true, flights: 0, hours: 0, landings: 0, lastFlightAt: null, badge: null, of: 2 },
        totals: { pilots: 2, flights: 13, hours: 20.7 },
    };
    const { ctx: cS, page: pS } = await open();
    await pS.click('#quickGrid [data-i="6"]');
    await pS.waitForTimeout(600);
    const off = await pS.innerText('#crewStandings');
    ok('a pilot off the board is still shown their own standing', /nothing flown in this window/.test(off), off);
    ok('…and told what it would take to appear', /4 more flights and you’re on the board/.test(off), off);
    await cS.close();
    standingsBody = null;

    // ------------------------------------------------------------------
    head('A pilot whose account was never linked');

    logbook = { linked: false, flights: [], page: 1, hasNextPage: false };
    const { ctx: c0, page: p0 } = await open();
    await p0.click('#quickGrid [data-i="0"]');
    await p0.waitForTimeout(600);
    const unlinked = await p0.innerText('#crewFlightPicker');
    ok('they are told why their flights aren\'t there', /isn’t linked to an Infinite Flight account/.test(unlinked), unlinked);
    ok('…and can still file by hand', await p0.isVisible('[data-fp-manual]'));
    await c0.close();
    logbook = LOGBOOK_PAGES[0];

    // ------------------------------------------------------------------
    head('Pilots the old page could not describe');

    // Top of the ladder — the hardcoded card always showed a bar to Captain.
    flyingBody = {
        pilot: { memberId: 'm2', name: 'Sam Park', callsign: 'BAW01', hours: 900, status: 'active' },
        rank: { name: 'Captain', minHours: 250, next: null, awaitingCheck: null },
        flights: [], totals: { flights: 0, pending: 0, rejected: 0, minutes: 0, minutes30d: 0, flights30d: 0, lastFlightAt: null },
    };
    const { ctx: c2, page: p2 } = await open();
    const topRank = await p2.innerText('#rankBody');
    ok('the top of the ladder is an achievement, not an empty bar', /top of this airline/.test(topRank), topRank);
    ok('…and no progress bar is drawn', !(await p2.isVisible('#rankBody .accent-bg')));
    ok('a pilot with no flights is told so', /No flights yet/.test(await p2.innerText('#flights')), await p2.innerText('#flights'));
    ok('…and their hours read zero rather than 214', (await p2.textContent('#statHours')).trim() === '0m', await p2.textContent('#statHours'));
    await c2.close();

    // A pilot who has the hours but is waiting on a person.
    flyingBody = {
        pilot: { memberId: 'm3', name: 'Jo Adeyemi', callsign: 'BAW71', hours: 260, status: 'active' },
        rank: { name: 'First Officer', minHours: 100, next: { name: 'Captain', minHours: 250, hoursAway: 0, requiresCheck: true }, awaitingCheck: { name: 'Captain' } },
        flights: [], totals: { flights: 0, pending: 0, rejected: 0, minutes: 0, minutes30d: 0, flights30d: 0, lastFlightAt: null },
    };
    const { ctx: c3, page: p3 } = await open();
    const waiting = await p3.innerText('#rankBody');
    ok('a stalled promotion says it needs a check-ride', /check-ride/.test(waiting), waiting);
    ok('…rather than telling them to keep flying', !/hours to go/.test(waiting), waiting);
    await c3.close();

    // Not linked to a roster row at all.
    flyingBody = { pilot: null, rank: null, flights: [], totals: null };
    const { ctx: c4, page: p4 } = await open();
    ok('an unlinked account is not given invented hours', (await p4.textContent('#statHours')).trim() === '—', await p4.textContent('#statHours'));
    await c4.close();

    await browser.close();
    server.close();

    console.log(`\n${fail ? `${fail} failed, ` : ''}${pass} passed.`);
    process.exit(fail ? 1 : 0);
})();
