/*
 * tools/test-crew-codeshare.js — `npm run test:codeshare`
 *
 * CODESHARES BETWEEN CREW CENTRES, HUBS, TOURS & CHALLENGES, AND EXPORTS.
 *
 * Drives the REAL crew-dashboard.html and crew-pilot.html against a faked
 * backend and checks that each control sends what it says it sends:
 *
 *   * the routes drawer offers the network tools to staff, with a badge for
 *     requests waiting on this airline
 *   * finding a partner and asking: the picker's "choose" really narrows, and
 *     the request carries exactly the ticked routes
 *   * reviewing a request starts from what they asked for, and unticking one
 *     of ours is what the accept sends
 *   * ticking routes in the list and pressing Export sends those ids — and the
 *     CSV dialog's combined sheet and one-partner options send theirs
 *   * hubs save cleaned, from a tap on a busy airport
 *   * a tour typed as a routing becomes chained legs, and saves as such
 *   * a pilot's page shows the tour they are part-way round, next leg first
 *
 * No framework and no database: `node tools/test-crew-codeshare.js`.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? '/crew-dashboard.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

const TW = `(function(){var s=document.createElement('style');s.textContent=[
 '.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}.sticky{position:sticky}',
 '.inset-0{inset:0}.top-0{top:0}.right-0{right:0}.bottom-0{bottom:0}.hidden{display:none}',
 '.grid{display:grid}.flex{display:flex}.block{display:block}.inline-flex{display:inline-flex}',
 '.items-center{align-items:center}.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.min-w-0{min-width:0}',
 '.w-full{width:100%}.h-full{height:100%}.overflow-y-auto{overflow-y:auto}.overflow-hidden{overflow:hidden}',
 '.translate-x-full{transform:translateX(100%)}.z-50{z-index:50}'
].join('');document.head.appendChild(s);window.tailwind={config:{}};})();`;

const ROUTES = [
    { id: 'a1', flightNumber: 'AU1', origin: 'EGLL', destination: 'KJFK', aircraft: 'Boeing 777-200ER', distanceNm: 3000, active: true, kind: 'own' },
    { id: 'a2', flightNumber: 'AU2', origin: 'EGLL', destination: 'LFPG', aircraft: 'Airbus A320-200', distanceNm: 190, active: true, kind: 'own' },
    { id: 'a3', flightNumber: 'AU3', origin: 'EGLL', destination: 'EDDF', aircraft: 'Airbus A320-200', distanceNm: 350, active: true, kind: 'own' },
    { id: 'c1', flightNumber: 'BR1', origin: 'ENGM', destination: 'EGLL', aircraft: 'Boeing 737-800', distanceNm: 650, active: true, kind: 'codeshare', partnerName: 'Borealis Virtual', partnerSlug: 'borealis' },
    { id: 'c2', flightNumber: 'NV1', origin: 'EKCH', destination: 'EGLL', aircraft: 'Airbus A320-200', distanceNm: 530, active: true, kind: 'codeshare', partnerName: 'Nordic Virtual', partnerSlug: 'ext:x1' },
];
const BOREALIS = [
    { id: 'b1', flightNumber: 'BR1', origin: 'ENGM', destination: 'EGLL', aircraft: 'Boeing 737-800', distanceNm: 650, kind: 'own', active: true },
    { id: 'b2', flightNumber: 'BR2', origin: 'ENGM', destination: 'KJFK', aircraft: 'Boeing 787-9', distanceNm: 3200, kind: 'own', active: true },
    { id: 'b3', flightNumber: 'BR3', origin: 'ENGM', destination: 'ESSA', aircraft: 'Boeing 737-800', distanceNm: 220, kind: 'own', active: true },
];
const sel = (mode, routeIds = []) => ({ mode, routeIds });
const EXT = {
    id: 'x1', name: 'Nordic Virtual', logo: '', website: 'https://nordic.example', platform: 'vamsys', feedUrl: 'https://nordic.example/routes.csv',
    format: 'auto', take: sel('all'), share: sel('selected', ['a1']), autoSync: true, active: true, notes: '', partnerSlug: 'ext:x1',
    lastSync: { at: new Date().toISOString(), routes: 12, created: 0, updated: 1, removed: 0, error: '' },
    ourFeed: { csv: 'https://api.example/api/crew-feed/codeshare/abc.csv', json: 'https://api.example/api/crew-feed/codeshare/abc.json' },
};
const INCOMING = {
    id: 'ag2', status: 'pending', direction: 'incoming', partner: { slug: 'cirrus', name: 'Cirrus Air', logo: '' },
    iTake: sel('all'), iWant: sel('all'), theyTake: sel('all'), theyAllowMe: sel('all'), iAllowThem: sel('all'),
    message: 'Let’s fly together', requestedBy: 'Cirrus CEO', createdAt: new Date().toISOString(),
    canAccept: true, canWithdraw: false, canEnd: false, mySync: {}, theirSync: {},
};
const ACTIVE = {
    id: 'ag1', status: 'active', direction: 'outgoing', partner: { slug: 'borealis', name: 'Borealis Virtual', logo: '' },
    iTake: sel('all'), iWant: sel('all'), theyTake: sel('selected', ['a1']), theyAllowMe: sel('all'), iAllowThem: sel('selected', ['a1']),
    createdAt: new Date().toISOString(), decidedAt: new Date().toISOString(), linkedRoutes: 1,
    canAccept: false, canWithdraw: false, canEnd: true, mySync: { at: new Date().toISOString(), routes: 1 }, theirSync: { routes: 1 },
};
const TOUR = {
    id: 'tour_1', kind: 'tour', title: 'Channel hop', blurb: '', image: '', ordered: true, active: true, phase: 'live', minRank: '',
    legs: [{ origin: 'EGLL', destination: 'LFPG' }, { origin: 'LFPG', destination: 'EDDF' }, { origin: 'EDDF', destination: 'EGLL' }],
    award: { name: 'Channel crosser', tier: 'silver', icon: 'flag' },
    me: { done: 1, total: 3, complete: false, completedAt: null, legs: [{ at: new Date().toISOString() }, null, null], nextLeg: 1 },
    board: { finishers: 0, flying: 1, top: [] },
};

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log('  ✗ ' + n + (x ? '  (' + x + ')' : '')); fail++; } };

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
    const errs = [];
    const sent = [];

    async function fake(page, role) {
        page.on('pageerror', (e) => errs.push(e.message));
        await page.route('**/cdn.tailwindcss.com**', (r) => r.fulfill({ contentType: 'application/javascript', body: TW }));
        await page.route('**/unpkg.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
        await page.route('**/api/**', (route) => {
            const req = route.request();
            const url = new URL(req.url());
            const p = url.pathname;
            const m = req.method();
            const json = (x, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
            const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch { return {}; } };
            if (m !== 'GET') sent.push({ m, p, body: body() });
            if (p.endsWith('/badge-image') && m === 'POST') return json({ url: 'https://cdn.test/fjord-logo.png' });
            if (p.endsWith('/routes/export')) return route.fulfill({ status: 200, contentType: 'text/csv', headers: { 'Content-Disposition': 'attachment; filename="x.csv"' }, body: 'a,b\n' });
            if (p.endsWith('/codeshare/external') && m === 'GET') return json({ partners: [EXT], platforms: [], max: 40 });
            if (p.endsWith('/codeshare/external/preview')) return json({ total: 2, errors: 1, format: 'csv', routes: [{ id: 'id:N1', flightNumber: 'NV1', origin: 'EKCH', destination: 'EGLL' }, { id: 'id:N2', flightNumber: 'NV2', origin: 'EKCH', destination: 'LFPG' }] });
            if (p.endsWith('/codeshare/external') && m === 'POST') return json({ partner: { ...EXT, id: 'x2', name: body().name }, sync: { routes: 1, created: 1, updated: 0, removed: 0 } }, 201);
            if (/\/codeshare\/external\/[^/]+\/sync$/.test(p)) return json({ sync: { routes: 2, created: 0, updated: 2, removed: 0 } });
            if (p.endsWith('/codeshare/directory')) return json({ airlines: [{ slug: 'borealis', name: 'Borealis Virtual', callsign: 'BRL', standing: '' }, { slug: 'cirrus', name: 'Cirrus Air', standing: 'incoming' }] });
            if (p.includes('/codeshare/network/borealis')) return json({ airline: { slug: 'borealis', name: 'Borealis Virtual' }, routes: BOREALIS });
            if (p.includes('/codeshare/network/cirrus')) return json({ airline: { slug: 'cirrus', name: 'Cirrus Air' }, routes: [{ id: 'z1', flightNumber: 'CI1', origin: 'LIRF', destination: 'EGLL', kind: 'own', active: true }] });
            if (p.endsWith('/codeshare') && m === 'GET') return json({ agreements: [ACTIVE, INCOMING], open: true, schemaLinks: true, incoming: 1, me: { name: 'Aurora' } });
            if (p.endsWith('/codeshare') && m === 'POST') return json({ agreement: { ...ACTIVE, id: 'ag3', status: 'pending' } }, 201);
            if (/\/codeshare\/[^/]+\/accept$/.test(p)) return json({ agreement: { ...INCOMING, status: 'active' }, sync: { routes: 1 } });
            if (p.endsWith('/hubs') && m === 'GET') return json({ hubs: [] });
            if (p.endsWith('/hubs') && m === 'PUT') return json({ hubs: body().hubs });
            if (p.endsWith('/goals')) return json({ canManage: role !== 'pilot', signedIn: true, tours: [TOUR], challenges: [] });
            if (p.endsWith('/tours') && m === 'POST') return json({ tour: { ...TOUR, id: 'tour_2' } }, 201);
            if (p.endsWith('/routes')) return json({ routes: ROUTES, ranks: [], partners: [{ name: 'Borealis Virtual', routes: 1, destinations: 1, aircraft: [] }] });
            if (p.endsWith('/route-map')) return json({ routes: [], airports: [], stats: {} });
            if (p.includes('/va-ads/by-slug/') || p.endsWith('/branding')) return json({ name: 'Aurora', code: 'AUR', layout: 'editorial', allowedLayouts: ['editorial'] });
            if (p.endsWith('/me')) return json(role === 'pilot' ? { role: 'pilot', name: 'Rae', mustChangePassword: false } : { role: 'owner', capabilities: ['routes.manage', 'events.manage'], name: 'Owner' });
            return json({});
        });
        await page.addInitScript((r) => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'X', role: r }));
            // The first-visit walkthrough, marked seen for both audiences.
            localStorage.setItem('crew:tour:staff:testva', '1');
            localStorage.setItem('crew:tour:pilot:testva', '1');
        }, role);
    }
    const quiet = (page) => page.evaluate(() => {
        try { if (window.CrewTour && CrewTour.close) CrewTour.close(); } catch {}
        document.querySelectorAll('.ctour-mask, .ctour-pop, .ctour').forEach((e) => e.remove());
    });
    const last = (re) => [...sent].reverse().find((s) => re.test(s.p));

    // ================= the dashboard =================
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, acceptDownloads: true });
    const page = await ctx.newPage();
    await fake(page, 'owner');
    await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
    await page.waitForTimeout(1200);
    await quiet(page);

    console.log('\n the routes drawer');
    await page.evaluate(() => openRoutes());
    await page.waitForTimeout(600);
    ok('staff get the network tools', await page.isVisible('#routeTools'));
    ok('…with a badge for the request waiting on them', (await page.textContent('#csReqBadge')).trim() === '1');
    ok('a synced codeshare says so on its card', await page.evaluate(() => !!document.querySelector('#routeList [data-rid="c1"] a[href="/crew/borealis"]')));
    ok('…and one read from an outside airline does not link to a crew centre here', await page.evaluate(() => !document.querySelector('#routeList [data-rid="c2"] a[href^="/crew/"]') && /synced/.test(document.querySelector('#routeList [data-rid="c2"]').textContent)));

    console.log('\n ticking routes and exporting them');
    await page.click('#routeSelectBtn');
    await page.check('#routeList [data-rid="a1"] [data-rsel]');
    await page.check('#routeList [data-rid="c1"] [data-rsel]');
    ok('the bar counts what is ticked', (await page.textContent('#routeSelectCount')).includes('2 selected'));
    await page.click('#routeSelectExport');
    await page.waitForTimeout(400);
    ok('Export selected sends exactly those ids', JSON.stringify((last(/routes\/export$/) || {}).body) === JSON.stringify({ ids: ['a1', 'c1'] }), JSON.stringify(last(/routes\/export$/)));

    console.log('\n the CSV dialog');
    await page.evaluate(() => openCsv('routes'));
    await page.waitForTimeout(200);
    ok('it opens on "only what you ticked"', await page.isChecked('input[name="csvScope"][value="selected"]'));
    ok('…and offers one partner', await page.isVisible('#csvScopePartnerRow'));
    // The stub stylesheet does not stack the modal over the drawer the way
    // Tailwind's z-[60] does, so the radios are set rather than clicked.
    const scope = (v) => page.evaluate((x) => { document.querySelector(`input[name="csvScope"][value="${x}"]`).checked = true; return exportCsv(); }, v);
    await scope('combined');
    await page.waitForTimeout(400);
    ok('a combined sheet asks for one', (last(/routes\/export$/) || {}).body.combined === true);
    await scope('partner');
    await page.waitForTimeout(400);
    ok('one partner asks by name', (last(/routes\/export$/) || {}).body.partner === 'Borealis Virtual');
    await page.evaluate(() => closeCsv());
    await page.evaluate(() => toggleRouteSelect(false));

    console.log('\n asking for a codeshare');
    await page.evaluate(() => openCodeshare('find'));
    await page.waitForSelector('#crewCodeshare [data-cs-pick="borealis"]');
    ok('the directory is searchable airlines, marked where you already stand',
        await page.evaluate(() => !!document.querySelector('#crewCodeshare [data-cs-pick="cirrus"] .cp-chip')));
    await page.click('#crewCodeshare [data-cs-pick="borealis"]');
    await page.waitForSelector('#pk-take');
    await page.click('#pk-take [data-pk-mode="selected"]');
    ok('switching to "choose" starts with everything ticked', await page.evaluate(() => document.querySelectorAll('#pk-take [data-pk-id]:checked').length) === 3);
    await page.fill('#pk-take [data-pk-q]', 'ESSA');
    await page.waitForTimeout(100);
    ok('search narrows the list', await page.evaluate(() => document.querySelectorAll('#pk-take [data-pk-id]').length) === 1);
    await page.fill('#pk-take [data-pk-q]', '');
    await page.click('#pk-take [data-pk-clear]');
    await page.click('#pk-take [data-pk-port="KJFK"]');
    ok('an airport chip ticks what touches it', await page.evaluate(() => [...document.querySelectorAll('#pk-take [data-pk-id]:checked')].map((i) => i.getAttribute('data-pk-id')).join()) === 'b2');
    await page.click('#pk-offer [data-pk-mode="all"]');
    await page.fill('#crewCodeshare [data-cs-msg]', 'Hello from Aurora');
    await page.click('#crewCodeshare [data-cs-send]');
    await page.waitForTimeout(400);
    const req = last(/\/codeshare$/);
    ok('the request carries exactly what was ticked', req && JSON.stringify(req.body) === JSON.stringify({ partner: 'borealis', take: { mode: 'selected', routeIds: ['b2'] }, offer: { mode: 'all', routeIds: [] }, message: 'Hello from Aurora' }), JSON.stringify(req && req.body));

    console.log('\n answering one');
    await page.waitForSelector('#crewCodeshare [data-cs-review]');
    await page.click('#crewCodeshare [data-cs-review]');
    await page.waitForSelector('#pk-offer');
    ok('the review starts from what they asked for', await page.getAttribute('#pk-offer [data-pk-mode="all"]', 'aria-pressed') === 'true');
    await page.click('#pk-offer [data-pk-mode="selected"]');
    await page.uncheck('#pk-offer [data-pk-id="a3"]');
    await page.click('#crewCodeshare [data-cs-accept]');
    await page.waitForTimeout(400);
    const acc = last(/accept$/);
    ok('accepting sends the narrowed offer', acc && acc.body.offer.mode === 'selected' && acc.body.offer.routeIds.join() === 'a1,a2', JSON.stringify(acc && acc.body));
    ok('…and takes what they offered', acc && acc.body.take.mode === 'all');

    console.log('\n an outside airline');
    await page.click('#crewCodeshare [data-cs-tab="outside"]');
    await page.waitForSelector('#crewCodeshare [data-ext-id="x1"]');
    ok('an outside partner shows its feed for them to import',
        await page.evaluate(() => [...document.querySelectorAll('#crewCodeshare [data-ext-id="x1"] input[readonly]')].map((i) => i.value).join() === 'https://api.example/api/crew-feed/codeshare/abc.csv,https://api.example/api/crew-feed/codeshare/abc.json'));
    await page.click('#crewCodeshare [data-ext-id="x1"] [data-ext-sync]');
    await page.waitForTimeout(300);
    ok('sync now re-reads their list', !!last(/external\/x1\/sync$/));
    await page.click('#crewCodeshare [data-ext-add]');
    await page.waitForSelector('#extName');
    await page.fill('#extName', 'Fjord Air');
    await page.selectOption('#extPlatform', 'phpvms');
    await page.fill('#extFeed', 'https://fjord.example/export.csv');
    await page.click('#crewCodeshare [data-ext-check]');
    await page.waitForSelector('#pk-extTake');
    await page.waitForTimeout(200);
    ok('checking the feed shows what it found', /2 routes found · 1 row skipped/.test(await page.textContent('#crewCodeshare [data-ext-preview]')));
    ok('the form keeps what was typed through a redraw', await page.inputValue('#extName') === 'Fjord Air');
    await page.click('#pk-extTake [data-pk-mode="selected"]');
    await page.uncheck('#pk-extTake [data-pk-id="id:N2"]');
    await page.click('#pk-extShare [data-pk-mode="all"]');
    await page.click('#crewCodeshare [data-ext-save]');
    await page.waitForTimeout(400);
    const add = last(/codeshare\/external$/);
    ok('adding sends the partner, their routes to fly and ours to share',
        add && add.body.name === 'Fjord Air' && add.body.platform === 'phpvms' && add.body.feedUrl === 'https://fjord.example/export.csv'
        && add.body.take.mode === 'selected' && add.body.take.routeIds.join() === 'id:N1' && add.body.share.mode === 'all', JSON.stringify(add && add.body));
    ok('no word of selling', await page.evaluate(() => !/\bsell/i.test(document.querySelector('#crewCodeshare').textContent)));

    // No feed, no spreadsheet: their logo uploaded and their legs typed in.
    await page.waitForSelector('#crewCodeshare [data-ext-add]');
    await page.click('#crewCodeshare [data-ext-add]');
    await page.waitForSelector('#extName');
    await page.fill('#extName', 'Skerry Air');
    ok('a partner’s logo is uploaded, not pasted as a link', !(await page.$('#crewCodeshare [data-ext-f="logo"]')) && !!(await page.$('#crewCodeshare [data-ext-logopick]')));
    await page.setInputFiles('#crewCodeshare [data-ext-file="logo"]', { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
    await page.waitForSelector('#crewCodeshare [data-ext-logoclr]');
    ok('…and shows once it is up', await page.evaluate(() => !!document.querySelector('#crewCodeshare .cs-logo img[src="https://cdn.test/fjord-logo.png"]')));
    ok('…without losing the name typed before it', await page.inputValue('#extName') === 'Skerry Air');
    await page.click('#crewCodeshare [data-ext-type]');
    await page.waitForSelector('#crewCodeshare [data-ext-lk="origin"]');
    const legRow = (i, k) => `#crewCodeshare [data-ext-leg="${i}"][data-ext-lk="${k}"]`;
    await page.fill(legRow(0, 'flightNumber'), 'SK10');
    await page.fill(legRow(0, 'origin'), 'ekch');
    await page.fill(legRow(0, 'destination'), 'ENGM');
    await page.fill(legRow(0, 'aircraft'), 'ATR 72');
    await page.click('#crewCodeshare [data-ext-legadd]');
    await page.fill(legRow(1, 'flightNumber'), 'SK11');
    await page.fill(legRow(1, 'origin'), 'ENGM');
    await page.fill(legRow(1, 'destination'), 'EKCH');
    ok('a second leg keeps the first', await page.inputValue(legRow(0, 'flightNumber')) === 'SK10');
    await page.click('#crewCodeshare [data-ext-legsuse]');
    await page.waitForTimeout(300);
    const typed = last(/external\/preview$/);
    ok('typed legs are read like a spreadsheet would be',
        typed && typed.body.csv === 'flightNumber,origin,destination,aircraft\nSK10,EKCH,ENGM,ATR 72\nSK11,ENGM,EKCH,', JSON.stringify(typed && typed.body));
    ok('…and the preview says where they came from', /2 legs typed in/.test(await page.textContent('#crewCodeshare [data-ext-preview]')));
    await page.click('#crewCodeshare [data-ext-save]');
    await page.waitForTimeout(400);
    const addTyped = last(/codeshare\/external$/);
    ok('adding sends the typed legs and the uploaded logo',
        addTyped && addTyped.body.name === 'Skerry Air' && addTyped.body.logo === 'https://cdn.test/fjord-logo.png' && /SK11,ENGM,EKCH/.test(addTyped.body.csv || ''), JSON.stringify(addTyped && addTyped.body));
    await page.evaluate(() => CrewCodeshare.close());

    console.log('\n hubs');
    await page.evaluate(() => openHubs());
    await page.waitForSelector('#crewHubs [data-hb-suggest="EGLL"]');
    await page.click('#crewHubs [data-hb-suggest="EGLL"]');
    await page.fill('#crewHubs [data-hb="0"] [data-hb-f="name"]', 'London Heathrow');
    await page.click('#crewHubs [data-hb-save]');
    await page.waitForTimeout(300);
    ok('a tapped airport saves as the hub', JSON.stringify((last(/\/hubs$/) || {}).body) === JSON.stringify({ hubs: [{ icao: 'EGLL', name: 'London Heathrow', kind: 'hub' }] }), JSON.stringify(last(/\/hubs$/)));
    await page.evaluate(() => CrewHubs.close());

    console.log('\n a tour, typed as a routing');
    await page.evaluate(() => openGoals());
    await page.waitForSelector('#crewGoals [data-gl-new]');
    await page.click('#crewGoals [data-gl-new]');
    await page.fill('#crewGoals [data-f="title"]', 'Three capitals');
    await page.fill('#crewGoals [data-gl-routing]', 'EGLL-LFPG EDDF');
    await page.click('#crewGoals [data-gl-routing-go]');
    ok('a routing becomes chained legs', await page.evaluate(() => document.querySelectorAll('#crewGoals [data-leg]').length) === 2);
    await page.click('#crewGoals [data-gl-save]');
    await page.waitForTimeout(400);
    const tour = last(/\/tours$/);
    ok('…and saves as those legs', tour && tour.body.legs.map((l) => `${l.origin}-${l.destination}`).join() === 'EGLL-LFPG,LFPG-EDDF' && tour.body.title === 'Three capitals', JSON.stringify(tour && tour.body));
    await ctx.close();

    // ================= the pilot page =================
    console.log('\n a pilot’s page');
    const pctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const pilot = await pctx.newPage();
    await fake(pilot, 'pilot');
    await pilot.goto(`http://127.0.0.1:${port}/crew-pilot.html?va=testva`);
    await pilot.waitForTimeout(1600);
    await quiet(pilot);
    ok('the tour they are part-way round is on the page', await pilot.evaluate(() => {
        const h = document.getElementById('goalStrip');
        return !!h && !h.classList.contains('cp-hidden') && /Channel hop/.test(h.textContent);
    }));
    ok('…with the next leg called out', /Next:\s*LFPG → EDDF/.test(await pilot.textContent('#goalStrip')));
    ok('there is a tile for all of them', await pilot.evaluate(() => [...document.querySelectorAll('#quickGrid .font-semibold')].some((e) => e.textContent.includes('Tours & challenges'))));
    await pctx.close();

    const real = errs.filter((e) => !/lucide|Tailwind|tailwind|ResizeObserver/.test(e));
    ok('no page errors', !real.length, real.join(' | '));

    await browser.close();
    server.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
