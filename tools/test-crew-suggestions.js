// test-crew-suggestions.js
// Drives the REAL crew-pilot.html to prove the four things added for a pilot
// who opens the crew center asking "what should I fly tonight":
//
//   * the Route of the Day and the Route of the Week are on the page, named,
//     and lead somewhere — not a heading over an empty box
//   * the short list prints ONLY reasons the server actually scored, and the
//     live-ATC reason is the one that gets a colour
//   * the live ATC read is the BROWSER'S job: the ICAOs the tracker has in
//     memory travel out on the suggestions request, and a page with no tracker
//     under it still gets a panel
//   * a pilot with too little flying behind them is told that, rather than
//     shown a confident sentence about habits nobody has
//   * the card's finish follows the pilot's CLUB — a colour the server chose —
//     and an older server that sends no club still draws the card it always drew
//   * the shop's Crew tab shows what other pilots hold, and never a balance
//   * staff, and only staff, can pin a leg as the day's or the week's
//
// Run:  node tools/test-crew-suggestions.js
// Needs: playwright-core, and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
//        pre-installed /opt/pw-browsers/chromium).
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

const route = (id, o, d, extra) => ({
    id, flightNumber: `TV${id}`, origin: o, destination: d, aircraft: 'Boeing 737-800',
    distanceNm: 420, active: true, kind: 'own', locked: false, minRank: '',
    hoursUntilUnlock: 0, partnerName: '', partnerLogo: '', notes: '', ...(extra || {}),
});

// What the server decided, including the reasons. The browser must print these
// and never invent one of its own — that is the property this file exists to
// hold, because a reason generated in the page is a reason that drifts from the
// score that produced the ordering.
const SUGGESTIONS = () => ([
    {
        route: route('c', 'EGKK', 'LEMG', { distanceNm: 900 }),
        score: 62, estimatedMin: 153, atc: { origin: 1, destination: 1 }, inbound: 7,
        why: [
            { text: 'ATC open at both ends — EGKK and LEMG', tone: 'atc' },
            { text: 'One you have not flown yet', tone: 'new' },
        ],
    },
    {
        route: route('b', 'EGLL', 'LFPG', { distanceNm: 190 }),
        score: 34, estimatedMin: 56, atc: { origin: 0, destination: 0 }, inbound: 0,
        why: [
            { text: 'A short hop, about your usual leg', tone: 'habit' },
            { text: 'You know EGLL', tone: 'habit' },
        ],
    },
    {
        route: route('z', 'EGLL', 'VHHH', { distanceNm: 5100, locked: true, minRank: 'Captain', hoursUntilUnlock: 36 }),
        score: 12, estimatedMin: 725, atc: { origin: 0, destination: 0 }, inbound: 0, why: [],
    },
]);

const club = (key, name, index, color) => ({
    key, name, index, of: 5, color, minHours: [0, 25, 100, 250, 500][index], benefits: [],
});
// The ladder as the server sends it, with the benefits a VA has actually
// attached. Only the top two give anything, which is the shape of every real
// loyalty scheme and the shape this file needs to prove the page draws.
const CLUBS = () => ([
    { key: 'standard', name: 'Standard', minHours: 0, color: '#4A5568', earnBonus: 0, earlyHours: 0, priority: false, benefits: [] },
    { key: 'bronze', name: 'Bronze', minHours: 25, color: '#A4622B', earnBonus: 0, earlyHours: 0, priority: false, benefits: [] },
    { key: 'silver', name: 'Silver', minHours: 100, color: '#7C8794', earnBonus: 5, earlyHours: 0, priority: false,
        benefits: [{ kind: 'earn', value: 5, label: '5% more on every flight', detail: '' }] },
    { key: 'gold', name: 'Gold', minHours: 250, color: '#B8860B', earnBonus: 15, earlyHours: 24, priority: true,
        benefits: [
            { kind: 'earn', value: 15, label: '15% more on every flight', detail: '' },
            { kind: 'early', value: 24, label: '24h early access to the shop', detail: '' },
            { kind: 'priority', value: 1, label: 'Your orders are handled first', detail: '' },
        ] },
    { key: 'platinum', name: 'Platinum', minHours: 500, color: '#2C3446', earnBonus: 20, earlyHours: 48, priority: true,
        benefits: [
            { kind: 'earn', value: 20, label: '20% more on every flight', detail: '' },
            { kind: 'early', value: 48, label: "2 days' early access to the shop", detail: '' },
            { kind: 'priority', value: 1, label: 'Your orders are handled first', detail: '' },
        ] },
]);

// Rae is 214 hours in: Silver, with Gold 36 hours away.
const MY_CLUB = () => ({
    ...club('silver', 'Silver', 2, '#7C8794'),
    benefits: CLUBS()[2].benefits,
    next: { key: 'gold', name: 'Gold', minHours: 250, hoursAway: 36, benefits: CLUBS()[3].benefits },
});

let state = null;
const fresh = () => ({
    canManage: false,
    shopManage: false,
    confident: true,
    club: MY_CLUB(),
    clubs: CLUBS(),
    savedClubs: [],                 // every POST /clubs, in order
    pins: [],                       // every POST /featured-routes, in order
    week: { period: 'week', periodKey: '2026-W38', pinned: false, estimatedMin: 153, route: route('c', 'EGKK', 'LEMG', { distanceNm: 900 }) },
    day: { period: 'day', periodKey: '2026-09-16', pinned: false, estimatedMin: 56, route: route('b', 'EGLL', 'LFPG', { distanceNm: 190 }) },
    suggestQueries: [],             // the query string of every /suggestions call
    noRoutes: false,
});

const CREW = () => ([
    {
        pilotId: 'm1', name: 'Rae Okafor', callsign: 'BAW22', rank: 'First Officer',
        club: MY_CLUB(),
        hours: 214, since: '2026-03-02', status: 'active', earned: 9140, isMe: true,
        holds: [
            { name: 'A badge on your profile', count: 2, since: '2026-06-01', itemId: 'i1' },
            { name: 'Your own callsign', count: 1, since: '2026-07-11', itemId: 'i2' },
            { name: 'Lead the next group flight', count: 1, since: '2026-08-02', itemId: 'i3' },
        ],
    },
    {
        pilotId: 'm2', name: 'Jo Lindqvist', callsign: 'BAW41', rank: 'Captain',
        club: { ...club('platinum', 'Platinum', 4, '#2C3446'), benefits: CLUBS()[4].benefits, next: null },
        hours: 640, since: '2025-11-04', status: 'active', earned: 26100, isMe: false,
        holds: [{ name: 'A tail number of your choosing', count: 1, since: '2026-02-02', itemId: 'i4' }],
    },
    {
        pilotId: 'm3', name: 'Kit Abara', callsign: 'BAW88', rank: 'Second Officer',
        club: { ...club('standard', 'Standard', 0, '#4A5568'), next: { key: 'bronze', name: 'Bronze', minHours: 25, hoursAway: 13, benefits: [] } },
        hours: 12, since: '2026-09-01', status: 'active', earned: 400, isMe: false,
        holds: [],
    },
]);

function api(r) {
    const url = new URL(r.request().url());
    const p = url.pathname;
    const method = r.request().method();
    const json = (b, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.endsWith('/suggestions')) {
        state.suggestQueries.push(url.search);
        if (state.noRoutes) {
            return json({ suggestions: [], profile: null, week: null, day: null, network: 0, canManage: state.canManage });
        }
        return json({
            suggestions: SUGGESTIONS(),
            profile: state.confident
                ? { flights: 24, hours: 41, confident: true, typicalMin: 82, lean: 'short',
                    longHauls: 1, shortHauls: 19,
                    aircraft: [{ value: 'Boeing 737-800', count: 14 }],
                    airports: [{ value: 'EGLL', count: 20 }] }
                : { flights: 2, hours: 3, confident: false, typicalMin: 78, lean: '',
                    longHauls: 0, shortHauls: 2, aircraft: [], airports: [] },
            week: state.week, day: state.day, network: 6, canManage: state.canManage,
        });
    }
    if (p.endsWith('/featured-routes') && method === 'POST') {
        const body = r.request().postDataJSON() || {};
        state.pins.push(body);
        for (const period of ['week', 'day']) {
            if (!(period in body)) continue;
            const id = String(body[period] || '');
            if (!id) { state[period] = { ...state[period], pinned: false }; continue; }
            const hit = SUGGESTIONS().find((s) => String(s.route.id) === id);
            if (hit) state[period] = { period, periodKey: 'x', pinned: true, estimatedMin: hit.estimatedMin, route: hit.route };
        }
        return json({ week: state.week, day: state.day });
    }
    if (p.endsWith('/shop/crew')) return json({ enabled: true, currency: { name: 'Miles', short: 'mi' }, crew: CREW(), clubs: CLUBS() });
    if (p.endsWith('/clubs/suggested')) return json({ clubs: CLUBS() });
    if (p.endsWith('/clubs') && method === 'POST') {
        state.savedClubs.push(r.request().postDataJSON() || {});
        return json({ clubs: CLUBS(), anyBenefits: true });
    }
    if (p.endsWith('/shop') && method === 'GET') {
        return json({
            enabled: true, canManage: state.shopManage, currency: { name: 'Miles', short: 'mi' },
            // Three shelf states the club changes: open to everybody, open to
            // this pilot EARLY, and not open to them yet. The server decides
            // all three; the page must draw what it was told and work none of
            // it out for itself.
            items: [
                { id: 'i1', name: 'A badge on your profile', desc: 'A mark by your name.', price: 1100, stock: -1, active: true,
                    access: { open: true, early: false, opensAt: null, needs: null } },
                { id: 'i2', name: 'Retro livery', desc: 'The 1987 scheme.', price: 900, stock: -1, active: true,
                    access: { open: true, early: true, opensAt: new Date(Date.now() + 20 * 3600e3).toISOString(), needs: null } },
                { id: 'i3', name: 'Name a route', desc: 'Pick the next city pair.', price: 800, stock: -1, active: true,
                    access: { open: false, early: false, opensAt: new Date(Date.now() + 40 * 3600e3).toISOString(),
                        needs: { key: 'platinum', name: 'Platinum', minHours: 500 } } },
            ],
            clubs: state.clubs,
            wallet: state.club === null ? {
                pilotId: 'm1', name: 'Rae Okafor', callsign: 'BAW22', rank: 'First Officer',
                since: '2026-03-02', balance: 4820, earned: 9140, spent: 4320,
            } : {
                pilotId: 'm1', name: 'Rae Okafor', callsign: 'BAW22', rank: 'First Officer',
                club: state.club, hours: 214,
                since: '2026-03-02', balance: 4820, earned: 9140, spent: 4320,
            },
        });
    }
    if (p.endsWith('/shop/orders')) return json({ orders: [] });
    if (p.endsWith('/me/flying')) {
        return json({
            pilot: { memberId: 'm1', name: 'Rae Okafor', callsign: 'BAW22', hours: 214.5, status: 'active' },
            rank: { name: 'First Officer', minHours: 100, next: null, awaitingCheck: null },
            flights: [], totals: { flights: 0, pending: 0, rejected: 0, minutes: 0, minutes30d: 0, flights30d: 0, lastFlightAt: null },
        });
    }
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: false });
    if (p.endsWith('/events')) return json({ events: [], canManage: false, mine: [], ranks: [] });
    if (p.endsWith('/schedules')) return json({ schedules: [], mine: [], canManage: false, rules: { enabled: true }, ranks: [] });
    if (p.endsWith('/routes')) return json({ routes: SUGGESTIONS().map((s) => s.route), counts: { own: 3, codeshare: 0, locked: 1 } });
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
    const errors = [];

    /**
     * `tracker` seeds the live ATC bridge this page reads when it is running
     * inside the flight tracker. Left out, there is no bridge and no map —
     * which is the other half of the contract and is tested too.
     */
    const open = async ({ tracker = true } = {}) => {
        state = state || fresh();
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/**', api);
        // The live feed is not reachable from a test box, and must not be
        // needed: every request to it is refused so the "no tracker" path is
        // the real one rather than a slow one.
        await page.route('https://site--acars-backend**', (r) => r.abort());
        await page.addInitScript(([on]) => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Rae Okafor', role: 'pilot' }));
            // The first-run tour covers the page with a mask. Marked as
            // already seen — this file is testing the page, not the walk, and
            // the walk has its own tests.
            localStorage.setItem('crew:tour:pilot:testva', '99');
            if (!on) return;
            window.InflightATC = {
                getFacilities: () => ([
                    { airportName: 'EGKK', type: 1 },
                    { airportName: 'EGKK', type: 0 },
                    { airportName: 'LEMG', type: 1 },
                    // A centre controller has no field. Counting it would put a
                    // blank ICAO on the wire.
                    { airportName: '', type: 6 },
                ]),
            };
            window.currentMapFeatures = {
                f1: { properties: { arrivalIcao: 'LEMG' } },
                f2: { properties: { arrivalIcao: 'LEMG' } },
                f3: { properties: { arrivalIcao: 'LEMG' } },
                // No plan filed. Must not be counted as inbound anywhere.
                f4: { properties: { arrivalIcao: null } },
            };
        }, [tracker]);
        await page.goto(`http://127.0.0.1:${port}/crew-pilot.html?va=testva`);
        await page.waitForTimeout(1200);
        return { ctx, page };
    };

    // ==================================================================
    head('The two featured legs are on the pilot’s home');
    state = fresh();
    let { ctx, page } = await open();

    await page.waitForSelector('#suggestStrip .sg-feature', { timeout: 6000 }).catch(() => {});
    const strip = await page.innerText('#suggestStrip').catch(() => '');
    ok('the strip is revealed once there is a leg to name',
        !(await page.locator('#suggestStrip').getAttribute('class') || '').includes('cp-hidden'));
    ok('Route of the day is named', /Route of the day/i.test(strip), strip.slice(0, 120));
    ok('Route of the week is named', /Route of the week/i.test(strip), strip.slice(0, 120));
    ok('…the day’s leg is the day’s leg', /EGLL/.test(strip) && /LFPG/.test(strip));
    ok('…and the week’s is the week’s', /EGKK/.test(strip) && /LEMG/.test(strip));
    // innerText is what is RENDERED, and the kicker is uppercased in CSS —
    // so this compares positions case-insensitively rather than asserting a
    // spelling the stylesheet owns.
    const lower = strip.toLowerCase();
    ok('the day is drawn first — it is the one with a deadline on it',
        lower.indexOf('route of the day') >= 0
        && lower.indexOf('route of the day') < lower.indexOf('route of the week'));
    ok('a pilot is not shown a staff control', !(await page.locator('#suggestStrip .sg-unpin').count()));

    // ==================================================================
    head('The browser does the live read, the server does the airline');

    const q = state.suggestQueries.join(' ');
    ok('the controlled fields travel out with the request', /atc=/.test(q), q);
    ok('…EGKK among them', /EGKK/.test(decodeURIComponent(q)), q);
    ok('…deduplicated — two positions at one field is one field',
        (decodeURIComponent(q).match(/EGKK/g) || []).length === 1, q);
    ok('…and a centre controller, which has no field, is not sent',
        !/,,|=,|,(?=&)/.test(decodeURIComponent(q)), q);
    ok('inbound traffic travels with it', /inbound=/.test(q), q);
    ok('…counted only where a plan was actually filed',
        /LEMG:3/.test(decodeURIComponent(q)), decodeURIComponent(q));

    // ==================================================================
    head('The short list prints what the server decided, and nothing else');

    await page.click('#suggestStrip [data-sg-open]');
    await page.waitForSelector('#crewSuggestions .sg-item', { timeout: 6000 });
    const panel = await page.innerText('#crewSuggestions');
    ok('every suggestion is drawn', (await page.locator('#crewSuggestions .sg-item').count()) === 3);
    ok('the server’s own reason is printed verbatim',
        panel.includes('ATC open at both ends — EGKK and LEMG'), panel.slice(0, 200));
    ok('…and the habit reason too', panel.includes('A short hop, about your usual leg'));
    ok('a leg the server gave no reason for claims none',
        (await page.locator('#crewSuggestions .sg-item').nth(2).locator('.sg-why').count()) === 0);
    ok('ATC is the reason that gets a colour',
        (await page.locator('#crewSuggestions .sg-why-atc').count()) === 1);
    ok('a locked leg says how far off it is', /36h away/i.test(panel),
        await page.innerText('#crewSuggestions .sg-item:nth-of-type(3)').catch(() => ''));
    ok('the live line says how many fields are controlled', /2 fields are being controlled/.test(panel), panel);

    head('…and says what it thinks this pilot flies');
    ok('the lean is named', /short hops/.test(panel), panel.slice(-400));
    ok('…with the aeroplane', /Boeing 737-800/.test(panel));
    ok('…and the field', /EGLL/.test(panel));
    ok('…and how much flying it is based on', /24 approved flights/.test(panel), panel.slice(-300));

    await ctx.close();

    // ==================================================================
    head('A pilot with barely any flying behind them is told so');
    state = fresh(); state.confident = false;
    ({ ctx, page } = await open());
    await page.waitForSelector('#suggestStrip [data-sg-open]', { timeout: 6000 });
    await page.click('#suggestStrip [data-sg-open]');
    await page.waitForSelector('#crewSuggestions .sg-you', { timeout: 6000 });
    const thin = await page.innerText('#crewSuggestions .sg-you');
    ok('no confident sentence about habits nobody has', !/You mostly fly/.test(thin), thin);
    ok('…it says what it is waiting for instead', /start matching how you actually fly/.test(thin), thin);
    await ctx.close();

    // ==================================================================
    head('No tracker under the page, and it still works');
    state = fresh();
    ({ ctx, page } = await open({ tracker: false }));
    await page.waitForSelector('#suggestStrip [data-sg-open]', { timeout: 8000 });
    await page.click('#suggestStrip [data-sg-open]');
    await page.waitForSelector('#crewSuggestions .sg-item', { timeout: 8000 });
    const offline = await page.innerText('#crewSuggestions');
    ok('the panel still draws', /Route of the day/i.test(offline));
    const q2 = state.suggestQueries.join(' ');
    ok('…and no ATC is claimed on the wire', !/atc=/.test(q2), q2);
    ok('…nor any live line in the panel', !/being controlled right now/.test(offline));
    await ctx.close();

    // ==================================================================
    head('A VA with no published routes carries no empty frame');
    state = fresh(); state.noRoutes = true;
    ({ ctx, page } = await open());
    await page.waitForTimeout(800);
    ok('the strip stays hidden',
        ((await page.locator('#suggestStrip').getAttribute('class')) || '').includes('cp-hidden'));
    ok('…and it is empty, not blank-but-drawn',
        !(await page.innerHTML('#suggestStrip')).trim());
    await ctx.close();

    // ==================================================================
    head('Staff, and only staff, can pin a leg');
    state = fresh(); state.canManage = true;
    ({ ctx, page } = await open());
    await page.waitForSelector('#suggestStrip [data-sg-open]', { timeout: 6000 });
    await page.click('#suggestStrip [data-sg-open]');
    await page.waitForSelector('#crewSuggestions .sg-pin', { timeout: 6000 });
    ok('every suggestion offers both slots',
        (await page.locator('#crewSuggestions [data-sg-pin]').count()) === 6);
    // The leg that is already the day's route cannot be pinned as it again.
    ok('…and the one already in a slot says so, disabled',
        await page.locator('#crewSuggestions [data-sg-pin="day"][data-sg-id="b"]').isDisabled());

    await page.click('#crewSuggestions [data-sg-pin="week"][data-sg-id="b"]');
    await page.waitForTimeout(600);
    ok('pinning sends the route id for that period',
        JSON.stringify(state.pins[state.pins.length - 1]) === JSON.stringify({ week: 'b' }),
        JSON.stringify(state.pins));
    const pinned = await page.innerText('#crewSuggestions');
    ok('…and the tile repaints from what the server sent back',
        /Picked by your staff/.test(pinned), pinned.slice(0, 300));
    ok('…with a way to hand the slot back',
        (await page.locator('#crewSuggestions .sg-unpin').count()) >= 1);

    // Unpinning must not also open the route behind it.
    await page.click('#crewSuggestions .sg-unpin');
    await page.waitForTimeout(500);
    ok('unpinning clears the slot',
        JSON.stringify(state.pins[state.pins.length - 1]) === JSON.stringify({ week: '' }),
        JSON.stringify(state.pins));
    ok('…and does not open the network panel underneath it',
        !(await page.locator('#crewNetwork:not(.cp-hidden)').count()));
    await ctx.close();

    // ==================================================================
    head('The card’s finish follows the club, not the rank');
    state = fresh();
    ({ ctx, page } = await open());
    await page.waitForSelector('#shopCard .sh-card', { timeout: 6000 });
    const cardClass = await page.getAttribute('#shopCard .sh-card', 'class');
    const cardStyle = await page.getAttribute('#shopCard .sh-card', 'style');
    ok('the card wears the club the server chose', /sh-card-t2/.test(cardClass), cardClass);
    ok('…painted in the colour the server sent', /--sh-face:\s*#7C8794/i.test(cardStyle || ''), cardStyle);
    const face = await page.innerText('#shopCard .sh-card');
    // Case-insensitive throughout this block: the card's small caps are a
    // text-transform, so innerText is not the string the module wrote.
    ok('…and names it', /silver/i.test(face), face.slice(0, 120));
    // The whole point of two ladders: a rank is what the airline calls you, a
    // club is what your flying earned. Printing one in place of the other
    // would lose the half that made the card worth looking at.
    ok('…beside the rank rather than instead of it', /first officer/i.test(face));
    ok('the ladder is drawn as pips', (await page.locator('#shopCard .sh-pip').count()) === 5);
    ok('…filled to where this pilot is', (await page.locator('#shopCard .sh-pip-on').count()) === 3);
    ok('a square logo cannot have a square corner',
        (await page.$eval('#navLogo', (el) => getComputedStyle(el).borderRadius)) !== '0px');
    await ctx.close();

    // ==================================================================
    head('An older server that knows nothing about clubs still draws a card');
    state = fresh(); state.club = null; state.clubs = undefined;
    ({ ctx, page } = await open());
    await page.waitForSelector('#shopCard .sh-card', { timeout: 6000 });
    const plainClass = await page.getAttribute('#shopCard .sh-card', 'class');
    ok('no club class is invented', !/sh-card-t\d/.test(plainClass), plainClass);
    ok('…no face colour either — it falls back to the page accent',
        !/--sh-face/.test((await page.getAttribute('#shopCard .sh-card', 'style')) || ''));
    ok('…and the rank is still on the front of it',
        /first officer/i.test(await page.innerText('#shopCard .sh-card')));
    ok('…with no pips promising a ladder nobody can see',
        (await page.locator('#shopCard .sh-pip').count()) === 0);
    await ctx.close();

    // ==================================================================
    head('The Clubs tab says what a club is actually for');
    state = fresh();
    ({ ctx, page } = await open());
    await page.waitForSelector('#shopCard [data-sh-open]', { timeout: 6000 });
    await page.click('#shopCard [data-sh-open]');
    await page.waitForSelector('#crewShop [data-sh-view="clubs"]', { timeout: 6000 });
    await page.click('#crewShop [data-sh-view="clubs"]');
    await page.waitForSelector('#crewShop .sh-club-list', { timeout: 6000 });
    const clubsText = await page.innerText('#crewShop');
    // The figure and the club name are separate elements in a flex row, so
    // innerText puts a line break between them. Collapsed before matching —
    // asserting the layout's whitespace would be asserting the stylesheet.
    const flat = clubsText.replace(/\s+/g, ' ');

    // The one sentence the whole screen exists for.
    ok('how far the next club is, in hours', /36h to Gold/i.test(flat), flat.slice(0, 260));
    ok('…and what crossing that line is worth', /15% more on every flight/i.test(clubsText));
    ok('…drawn as a bar across THIS step, not the whole ladder',
        (await page.locator('#crewShop .sh-club-bar span').count()) === 1);
    const width = await page.$eval('#crewShop .sh-club-bar span', (el) => el.style.width);
    // 214 hours, between Silver (100) and Gold (250): 114/150 = 76%.
    ok('…filled to where this pilot actually is', width === '76%', width);

    ok('every club on the ladder is listed', (await page.locator('#crewShop .sh-club').count()) === 5);
    ok('…the pilot’s own is marked', (await page.locator('#crewShop .sh-club-here').count()) === 1);
    ok('…the ones behind them are dimmed rather than hidden',
        (await page.locator('#crewShop .sh-club-past').count()) === 2);
    ok('…a club with nothing attached says so rather than looking broken',
        /the badge, and the card/i.test(clubsText), clubsText.slice(0, 400));
    ok('…and the hours each one takes are named', /from 250h flown/i.test(clubsText));
    ok('a pilot is not offered the staff editor',
        !(await page.locator('#crewShop [data-sh-saveclubs]').count()));
    await ctx.close();

    // ==================================================================
    head('Early access is drawn from what the server decided');
    state = fresh();
    ({ ctx, page } = await open());
    await page.waitForSelector('#shopCard [data-sh-open]', { timeout: 6000 });
    await page.click('#shopCard [data-sh-open]');
    await page.waitForSelector('#crewShop .sh-item', { timeout: 6000 });
    const shelf = await page.innerText('#crewShop');
    ok('an item that is theirs early says so', /yours first/i.test(shelf), shelf.slice(0, 500));
    ok('…and one that is not yet names the club that has it', /platinum first/i.test(shelf));
    ok('…with when it opens to everybody', /opens in/i.test(shelf), shelf.slice(0, 600));
    ok('a shut item cannot be bought',
        (await page.locator('#crewShop .sh-item-shut [data-sh-buy]').count()) === 0);
    ok('…and the ones that are open still can',
        (await page.locator('#crewShop [data-sh-buy]').count()) === 2);
    ok('exactly one item is shut', (await page.locator('#crewShop .sh-item-shut').count()) === 1);
    await ctx.close();

    // ==================================================================
    head('Staff set what each club is worth');
    state = fresh(); state.shopManage = true;
    ({ ctx, page } = await open());
    await page.waitForSelector('#shopCard [data-sh-open]', { timeout: 6000 });
    await page.click('#shopCard [data-sh-open]');
    await page.waitForSelector('#crewShop [data-sh-view="manage"]', { timeout: 6000 });
    await page.click('#crewShop [data-sh-view="manage"]');
    await page.waitForSelector('#crewShop [data-sh-club]', { timeout: 6000 });
    ok('the whole ladder is editable', (await page.locator('#crewShop [data-sh-club]').count()) === 5);
    ok('the first club cannot be removed — everybody starts in it',
        await page.locator('#crewShop [data-sh-club]').first().locator('[data-sh-delclub]').isDisabled());
    ok('…nor moved off zero hours',
        await page.locator('#crewShop [data-sh-club]').first().locator('[data-sh-cf="minHours"]').isDisabled());

    // Typing into one row and then adding another must not lose the typing.
    const row = (n) => page.locator('#crewShop [data-sh-club]').nth(n);
    await row(2).locator('[data-sh-cf="name"]').fill('Emerald');
    await row(2).locator('[data-sh-cf="earnBonus"]').fill('9');
    await page.click('#crewShop [data-sh-addclub]');
    await page.waitForTimeout(300);
    ok('adding a club keeps what was already typed',
        (await row(2).locator('[data-sh-cf="name"]').inputValue()) === 'Emerald');
    ok('…and the new rung is on the end', (await page.locator('#crewShop [data-sh-club]').count()) === 6);
    ok('…starting above the current top rather than at zero',
        Number(await row(5).locator('[data-sh-cf="minHours"]').inputValue()) > 500,
        await row(5).locator('[data-sh-cf="minHours"]').inputValue());

    await page.click('#crewShop [data-sh-saveclubs]');
    await page.waitForTimeout(600);
    const saved = state.savedClubs[state.savedClubs.length - 1];
    ok('saving sends the whole ladder', Array.isArray(saved && saved.clubs) && saved.clubs.length === 6,
        JSON.stringify(saved).slice(0, 200));
    ok('…with the edits in it',
        saved.clubs[2].name === 'Emerald' && saved.clubs[2].earnBonus === 9,
        JSON.stringify(saved.clubs[2]));
    ok('…and the key kept, so an early-access window survives a rename',
        saved.clubs[2].key === 'silver', JSON.stringify(saved.clubs[2]));
    ok('a club is never validated in the browser — the numbers go as typed',
        typeof saved.clubs[2].earnBonus === 'number');
    // The editor redraws from what the SERVER settled on, not from what was
    // typed: it sorts by hours, floors the bottom rung and clamps every rate,
    // and a screen still showing the typed version would be lying about what
    // is saved. The stub returns the original five.
    ok('…and the editor comes back showing what was actually saved',
        (await page.locator('#crewShop [data-sh-club]').count()) === 5);

    await row(4).locator('[data-sh-delclub]').click();
    await page.waitForTimeout(300);
    ok('a club can be removed', (await page.locator('#crewShop [data-sh-club]').count()) === 4);
    await page.click('#crewShop [data-sh-saveclubs]');
    await page.waitForTimeout(600);
    ok('…and saving sends the ladder without it',
        state.savedClubs[state.savedClubs.length - 1].clubs.length === 4);
    await ctx.close();

    // ==================================================================
    head('The shop’s Crew tab shows what other pilots hold');
    state = fresh();
    ({ ctx, page } = await open());
    await page.waitForSelector('#shopCard [data-sh-open]', { timeout: 6000 });
    await page.click('#shopCard [data-sh-open]');
    await page.waitForSelector('#crewShop [data-sh-view="crew"]', { timeout: 6000 });
    await page.click('#crewShop [data-sh-view="crew"]');
    await page.waitForSelector('#crewShop .sh-crew-row', { timeout: 6000 });
    const crew = await page.innerText('#crewShop');
    ok('the whole crew is listed', (await page.locator('#crewShop .sh-crew-row').count()) === 3);
    ok('…with what they hold on the row', /a badge on your profile/i.test(crew), crew.slice(0, 400));
    ok('…and each pilot’s club beside their rank', /silver/i.test(crew) && /platinum/i.test(crew));
    ok('…counted where they hold more than one', /×2/.test(crew));
    ok('…and the pilot who holds nothing says so', /Nothing yet/.test(crew));
    ok('the signed-in pilot is marked', /\bYOU\b/i.test(crew));
    ok('nobody’s balance is published', !/4,820/.test(crew), crew.slice(0, 500));
    ok('each row carries the finish as a swatch',
        (await page.locator('#crewShop .sh-crew-swatch').count()) === 3);

    await page.click('#crewShop [data-sh-crew="m2"]');
    await page.waitForSelector('#crewShop .sh-crew-body', { timeout: 4000 });
    const opened = await page.innerText('#crewShop .sh-crew-body');
    ok('opening a pilot draws their card', (await page.locator('#crewShop .sh-crew-body .sh-card').count()) === 1);
    ok('…in their own club’s finish',
        /sh-card-t4/.test(await page.getAttribute('#crewShop .sh-crew-body .sh-card', 'class')));
    ok('…and the figure on it is what they EARNED, said so',
        /earned/.test(opened), opened.slice(0, 300));
    ok('…never a balance', !/4,820/.test(opened));
    ok('…with their whole shelf under it', /a tail number of your choosing/i.test(opened));
    ok('one row open at a time',
        (await page.locator('#crewShop .sh-crew-body').count()) === 1);
    await page.click('#crewShop [data-sh-crew="m2"]');
    await page.waitForTimeout(300);
    ok('…and a second press closes it', (await page.locator('#crewShop .sh-crew-body').count()) === 0);
    await ctx.close();

    // ==================================================================
    head('Nothing threw');
    ok('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    await browser.close();
    server.close();
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})();
