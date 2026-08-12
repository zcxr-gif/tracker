// test-crew-events-staff.js
// Drives the REAL crew-dashboard.html against a faked crew center: that the
// "next event" card is the VA's own next event rather than the placeholder it
// replaced, that the Events tile opens the calendar, and that the editor sends
// what was typed — including a departure time converted out of the staff
// member's local clock into an instant, which is the thing everybody gets
// wrong and nobody notices until the event starts an hour late.
//
// Run:  node tools/test-crew-events-staff.js
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
    const file = path.join(ROOT, p === '/' ? '/crew-dashboard.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

let events = [{
    id: 'ev1', title: 'Maple Milk Run', origin: 'CYUL', destination: 'CYYZ',
    startsAt: new Date(Date.now() + 2 * 86400e3).toISOString(), slots: 0,
    gatesOpen: true, gatesLocked: false, gateIcao: 'CYUL', status: 'published',
    locked: false, going: 7, waitlisted: 0, seatsLeft: null, full: false, canManage: true,
    aircraft: '', server: '', description: '', bannerUrl: '', minRank: '',
}];
let created = null;
let signedOff = null;

async function api(route) {
    const p = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.endsWith('/events') && method === 'GET') {
        return json({ events, mine: [], canManage: true, ranks: [{ name: 'Cadet', minHours: 0 }, { name: 'Captain', minHours: 300 }] });
    }
    if (p.endsWith('/events') && method === 'POST') {
        created = route.request().postDataJSON();
        const ev = { ...events[0], ...created, id: 'ev2', going: null, canManage: true };
        events = [...events, ev];
        return json({ event: ev }, 201);
    }
    if (/\/events\/ev\d$/.test(p) && method === 'GET') {
        const ev = events.find(e => p.endsWith(e.id)) || events[0];
        return json({ event: ev, attending: [], mine: null, canManage: true });
    }
    if (p.endsWith('/routes')) {
        return json({
            routes: [
                { id: 'rt1', flightNumber: 'AM404', origin: 'MMMX', destination: 'KJFK', aircraft: 'B789', active: true, kind: 'own' },
                { id: 'rt2', flightNumber: 'DL99', origin: 'MMMX', destination: 'KATL', aircraft: 'B739', active: true, kind: 'codeshare', partnerName: 'Delta Virtual', partnerLogo: '' },
                { id: 'rt3', flightNumber: 'DL77', origin: 'MMMX', destination: 'KSLC', aircraft: 'B739', active: true, kind: 'codeshare', partnerName: 'Delta Virtual', partnerLogo: '' },
                { id: 'rt4', flightNumber: 'KL55', origin: 'MMMX', destination: 'EHAM', aircraft: 'B789', active: true, kind: 'codeshare', partnerName: 'KLM Virtual', partnerLogo: '' },
            ],
            counts: { own: 1, codeshare: 3, locked: 0 },
            partners: [
                { name: 'Delta Virtual', logo: '', routes: 2, destinations: 2, lockedRoutes: 0 },
                { name: 'KLM Virtual', logo: '', routes: 1, destinations: 1, lockedRoutes: 0 },
            ],
            ranks: [{ name: 'Cadet', minHours: 0 }, { name: 'Captain', minHours: 300 }],
        });
    }
    if (p.endsWith('/roster')) {
        return json({ roster: [
            { id: 'p1', name: 'Antony', callsign: 'AMX101', hours: 420, aircraft: [], status: 'active',
              rank: { name: 'First Officer', color: '#4f46e5', icon: 'award',
                      awaitingCheck: { name: 'Captain', minHours: 300, checkNote: 'One long-haul sector with a training captain.' } },
              checksPassed: [] },
            { id: 'p2', name: 'Rae', callsign: 'AMX204', hours: 40, aircraft: [], status: 'active',
              rank: { name: 'Cadet', color: '#64748b', icon: 'star', awaitingCheck: null }, checksPassed: [] },
        ] });
    }
    if (/\/roster\/p1\/checkride$/.test(p) && method === 'POST') {
        signedOff = route.request().postDataJSON();
        return json({ member: { id: 'p1', name: 'Antony', callsign: 'AMX101', hours: 420, aircraft: [], status: 'active',
            rank: { name: 'Captain', color: '#d97706', icon: 'medal', awaitingCheck: null }, checksPassed: ['Captain'] }, promoted: true });
    }
    if (p.includes('/api/va-ads/by-slug/')) return json({ name: 'Test VA', code: 'TST' });
    if (p.endsWith('/me')) return json({ role: 'owner', caps: [], capabilities: [], staffRoles: [], staffAssignments: [] });
    if (p.endsWith('/stats')) return json({ ok: true, connected: true, stats: { pilots: 12, hours: 400, flights30d: 3, pireps: 9 } });
    return json({});
}

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
    const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    await page.route('**/api/**', api);
    await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner' })));
    await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
    await page.waitForTimeout(1800);

    let failures = 0;
    const check = (label, ok, extra) => { if (!ok) { failures++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); } else console.log('  ✓ ' + label); };

    // 1. The "next event" card is the VA's own event, not the old placeholder.
    const sum = await page.textContent('#nextEvent .cev-sum-title').catch(() => null);
    check('the dashboard’s next-event card shows a real event', sum === 'Maple Milk Run', `got ${sum}`);
    const shown = await page.evaluate(() => document.body.innerText);
    check('no invented event survives anywhere on the dashboard',
        !/Transcon Group Flight/.test(shown) && !/34 signed up/.test(shown));
    check('and the count comes from the feed', /7 signed up/.test(await page.textContent('#nextEvent')));

    // 2. The Events tile opens the panel.
    await page.click('#toolGrid a:has-text("Events")');
    await page.waitForSelector('#cevPanel:not(.cev-hidden)', { timeout: 5000 });
    check('the Events tile opens the calendar', true);
    check('staff see the New event button',
        await page.isVisible('#cevNewBtn'));

    // 3. The editor.
    await page.click('#cevNewBtn');
    await page.waitForSelector('#cevfTitle', { timeout: 5000 });
    const rankOpts = await page.$$eval('#cevfRank option', els => els.map(e => e.textContent));
    check('the rank gate offers the VA’s own ladder',
        rankOpts.join(',') === 'Everyone,Cadet,Captain', rankOpts.join(','));

    await page.fill('#cevfTitle', 'Pacífico Nocturno');
    await page.fill('#cevfOrigin', 'mmmx');
    await page.fill('#cevfDest', 'rjaa');
    await page.fill('#cevfStarts', '2026-09-26T04:00');
    await page.fill('#cevfSlots', '30');
    await page.selectOption('#cevfRank', 'Captain');
    await page.click('#cevSavePubBtn');
    await page.waitForTimeout(900);

    check('creating an event sends what was typed',
        created && created.title === 'Pacífico Nocturno' && created.origin === 'mmmx' && created.slots === 30,
        JSON.stringify(created));
    check('“Create & publish” publishes it', created && created.status === 'published', created && created.status);
    check('the rank gate is carried', created && created.minRank === 'Captain', created && created.minRank);
    // The form takes local wall-clock time; what leaves must be the instant.
    const sent = new Date(created.startsAt);
    check('the departure time is sent as an instant, not a bare wall clock',
        sent.getTime() === new Date('2026-09-26T04:00').getTime(), created.startsAt);
    check('the panel closed on save', await page.isHidden('#cevEdit'));

    const titles = await page.$$eval('#cevList .cev-card-title', els => els.map(e => e.textContent));
    check('the new event appears in the calendar', titles.includes('Pacífico Nocturno'), titles.join(','));

    const ours = errors.filter(e => !/Failed to load resource|tailwind is not defined|lucide/i.test(e));
    check('no page errors of our own', ours.length === 0, ours.join(' | '));

    await page.screenshot({ path: path.join(__dirname, 'staff-events.png') });
    await page.close();

    // 4. A VA whose database has no events tables yet. "No events" and "your
    //    database can't hold events" look identical on screen and only one of
    //    them is something the VA can act on, so the panel must not flatten
    //    the second into the first.
    {
        const p2 = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        await p2.route('**/api/**', (route) => {
            const u = new URL(route.request().url()).pathname;
            if (u.endsWith('/events')) {
                return route.fulfill({
                    status: 409,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        error: 'This crew center’s project does not have the events tables yet. Re-run the setup SQL (Settings → Data store) to add them.',
                        code: 'store_events_missing',
                    }),
                });
            }
            return api(route);
        });
        await p2.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner' })));
        await p2.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await p2.waitForTimeout(1500);

        const card = await p2.textContent('#nextEvent');
        check('an unusable store says what is wrong, not "nothing scheduled"',
            /events tables yet/.test(card) && !/Nothing scheduled/.test(card), card.trim());

        await p2.click('#toolGrid a:has-text("Events")');
        await p2.waitForTimeout(700);
        const list = await p2.textContent('#cevList');
        check('…and the panel says the same rather than "No events yet"',
            /events tables yet/.test(list) && !/No events yet/.test(list), list.trim().slice(0, 120));
        await p2.close();
    }

    // 5. The route picker, the countdown, the check-ride and the partner strip.
    {
        const p3 = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        const errs = [];
        p3.on('pageerror', e => errs.push(String(e)));
        await p3.route('**/api/**', api);
        await p3.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner' })));
        await p3.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await p3.waitForTimeout(1600);

        // The countdown ticks. Two reads a second apart must differ, or it is
        // a static string dressed up as a clock.
        const first = await p3.textContent('#nextEvent .cev-clock').catch(() => '');
        check('the next-event card carries a countdown', /\d+d \d\d:\d\d:\d\d/.test(first), first);
        await p3.waitForTimeout(1100);
        const second = await p3.textContent('#nextEvent .cev-clock').catch(() => '');
        check('…and it actually ticks', first !== second, `${first} then ${second}`);

        // The editor offers the VA's own network to build an event on.
        await p3.click('#toolGrid a:has-text("Events")');
        await p3.waitForSelector('#cevNewBtn', { timeout: 5000 });
        await p3.click('#cevNewBtn');
        await p3.waitForSelector('#cevfRoute', { timeout: 5000 });
        await p3.waitForTimeout(500);
        const routeOpts = await p3.$$eval('#cevfRoute option', els => els.map(e => e.textContent));
        check('the editor offers the VA’s own routes',
            routeOpts.length === 5 && /AM404/.test(routeOpts[1]), routeOpts.join(' | '));
        check('…and marks whose metal a codeshare is',
            routeOpts.some(t => /DL99.*Delta Virtual/.test(t)), routeOpts.join(' | '));

        // Picking one fills the leg in rather than making staff retype it.
        await p3.selectOption('#cevfRoute', 'rt1');
        await p3.waitForTimeout(200);
        check('picking a route fills the leg in', await p3.inputValue('#cevfOrigin') === 'MMMX'
            && await p3.inputValue('#cevfDest') === 'KJFK'
            && await p3.inputValue('#cevfAircraft') === 'B789');
        await p3.click('#cevEdit .cev-icon-btn[data-cev-edit-close]');
        // …and the events panel itself, which otherwise covers the tiles below.
        await p3.click('#cevPanel .cev-head .cev-icon-btn[data-cev-close]');
        await p3.waitForTimeout(300);

        // The roster shows who is waiting on a person, and signs them off.
        await p3.click('#toolGrid a:has-text("Roster")');
        await p3.waitForSelector('#rosterList [data-id]', { timeout: 5000 });
        await p3.waitForTimeout(600);
        const roster = await p3.textContent('#rosterList');
        check('a pilot at a check-ride is shown as ready, not silently stalled',
            /Ready for Captain/.test(roster), roster.replace(/\s+/g, ' ').slice(0, 120));
        check('…and a pilot who is not waiting carries no such badge',
            (roster.match(/Ready for/g) || []).length === 1);

        p3.once('dialog', d => d.accept());
        await p3.click('#rosterList [data-checkride]');
        await p3.waitForTimeout(700);
        check('signing off sends the rank it was for', signedOff && signedOff.rank === 'Captain', JSON.stringify(signedOff));
        const after = await p3.textContent('#rosterList');
        check('…and the pilot is a Captain on the spot',
            /Captain/.test(after) && !/Ready for Captain/.test(after));

        // The partner strip: browse somebody else's metal by their airline.
        await p3.click('#toolGrid a:has-text("Routes")');
        await p3.waitForSelector('#routePartners [data-partner]', { timeout: 5000 });
        const tiles = await p3.$$eval('#routePartners [data-partner]', els => els.map(e => e.dataset.partner));
        check('every codeshare partner gets a tile', tiles.join(',') === 'Delta Virtual,KLM Virtual', tiles.join(','));
        const tileText = await p3.textContent('#routePartners [data-partner="Delta Virtual"]');
        check('…carrying how much of the network it is', /2 legs/.test(tileText), tileText.replace(/\s+/g, ' '));

        await p3.click('#routePartners [data-partner="Delta Virtual"]');
        await p3.waitForTimeout(400);
        const listed = await p3.$$eval('#routeList [data-rid]', els => els.length);
        check('tapping a partner narrows the network to their legs', listed === 2, String(listed));
        await p3.click('#routePartners [data-partner="Delta Virtual"]');
        await p3.waitForTimeout(400);
        // Back to every codeshare — not to the whole network. Untapping takes
        // the partner filter off, and you are still browsing somebody else's
        // metal, which is where you were.
        check('…and tapping it again shows every partner’s legs again',
            await p3.$$eval('#routeList [data-rid]', els => els.length) === 3);

        const mine = errs.filter(e => !/Failed to load resource|tailwind is not defined|lucide/i.test(e));
        check('no page errors of our own (part two)', mine.length === 0, mine.join(' | '));
        await p3.screenshot({ path: path.join(__dirname, 'staff-ranks.png') });
        await p3.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll staff checks passed ✅');
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
