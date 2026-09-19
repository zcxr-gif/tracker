/*
 * tools/test-crew-route-gates.js — `npm run test:route-gates`
 *
 * GATE TO GATE, ON A ROUTE.
 *
 * A route has always said which airports. It can now say which stands, and the
 * whole feature is optional — a VA that publishes none must not be able to tell
 * that the fields exist. So the properties worth protecting are not "can a gate
 * be typed in", they are the edges around it:
 *
 *   * a stand is DRAWN under the airport it belongs to, and only where the VA
 *     set one. A "Gate —" under every ICAO on a network that publishes none is
 *     a second line of nothing on every card in the drawer.
 *   * a gate typed in lower case is SAVED upper case. "a12" and "A12" are one
 *     stand to everybody except a string compare, and a network that holds both
 *     spellings of the same gate is a network nobody trusts.
 *   * editing a route OPENS ON the stands it was saved with. This is the one
 *     that silently destroys data: a form that does not pre-fill them sends ''
 *     on the next save, and a VA who edited the notes has lost their gates.
 *   * a route with no gates sends '' rather than undefined, so clearing one is
 *     something a VA can actually do.
 *
 * No framework and no database: `node tools/test-crew-route-gates.js`, exits
 * non-zero on a failure, needs nothing running.
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
 '.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}',
 '.inset-0{inset:0}.top-0{top:0}.right-0{right:0}.hidden{display:none}',
 '.grid{display:grid}.flex{display:flex}.block{display:block}.inline-flex{display:inline-flex}',
 '.items-center{align-items:center}.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.min-w-0{min-width:0}',
 '.w-full{width:100%}.h-full{height:100%}.overflow-y-auto{overflow-y:auto}',
 '.translate-x-full{transform:translateX(100%)}.z-50{z-index:50}.z-\\\\[60\\\\]{z-index:60}',
 '.left-1\\\\/2{left:50%}.top-1\\\\/2{top:50%}'
].join('');document.head.appendChild(s);window.tailwind={config:{}};})();`;

// One leg the airline publishes stands for, one it does not. The second is the
// control: everything this feature adds has to be invisible on it.
const ROUTES = [
    { id: 'r1', flightNumber: 'ACA123', origin: 'CYYZ', destination: 'EGLL', aircraft: 'B789',
      distanceNm: 3050, notes: '', active: true, kind: 'own', partnerName: '', partnerLogo: '',
      minRank: '', departureGate: 'A12', arrivalGate: '231', locked: false, hoursUntilUnlock: 0 },
    { id: 'r2', flightNumber: 'ACA88', origin: 'CYVR', destination: 'RJTT', aircraft: 'B77W',
      distanceNm: 4180, notes: '', active: true, kind: 'own', partnerName: '', partnerLogo: '',
      minRank: '', departureGate: '', arrivalGate: '', locked: false, hoursUntilUnlock: 0 },
];

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log('  ✗ ' + n + (x ? '  (' + x + ')' : '')); fail++; } };

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const page = await ctx.newPage();

    const errs = []; page.on('pageerror', e => errs.push(e.message));
    // Every route write the page attempts, in order. What is in here is the
    // other half of this file's assertions.
    const writes = [];
    // Which airports were asked about, in order — the cache assertion below is
    // about what is NOT in here a second time.
    const gateLookups = [];

    await page.route('**/cdn.tailwindcss.com**', r => r.fulfill({ contentType: 'application/javascript', body: TW }));
    await page.route('**/unpkg.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/api/**', async (route) => {
        const req = route.request();
        const p = new URL(req.url()).pathname;
        const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
        const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch { return {}; } };

        if (/\/routes(\/[^/]+)?$/.test(p) && (req.method() === 'POST' || req.method() === 'PATCH')) {
            const b = body();
            writes.push({ method: req.method(), body: b });
            // The id it was addressed at, echoed back — the page swaps the saved
            // row into its list by id, and a stub that renamed it would leave
            // the next step editing a route that is no longer there.
            const id = req.method() === 'PATCH' ? p.split('/').pop() : 'new';
            return json({ route: { ...b, id } });
        }
        if (p.includes('/airport-gates/')) {
            const icao = p.split('/').pop();
            gateLookups.push(icao);
            // CYUL answers; EGLL is the field nobody has mapped, and LFPG is
            // Overpass being down. All three have to leave the form usable.
            if (icao === 'CYUL') return json({ icao, gates: ['B 6', 'B 8', 'C 51'], source: 'osm' });
            if (icao === 'LFPG') return route.fulfill({ status: 502, contentType: 'application/json', body: '{}' });
            return json({ icao, gates: [], source: 'osm' });
        }
        if (p.endsWith('/routes')) return json({ routes: ROUTES, ranks: [], partners: [] });
        if (p.endsWith('/route-map')) return json({ routes: [], airports: [], stats: {} });
        if (p.endsWith('/crew/aircraft-metadata')) return json({ ok: true, aircraft: ['Boeing 787-9 Dreamliner'], liveries: {} });
        if (p.includes('/aircraft/lookup')) return json({ isPlaceholder: true, imageUrl: null, contributorName: 'System' });
        if (p.includes('/va-ads/by-slug/') || p.endsWith('/branding')) {
            return json({ name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial'],
                fleet: [{ type: 'Boeing 787-9 Dreamliner', name: 'Test VA', image: '' }] });
        }
        if (p.endsWith('/me')) return json({ role: 'owner', capabilities: ['routes.manage'], name: 'Owner' });
        return json({});
    });

    await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })));
    await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
    await page.waitForTimeout(1100);
    await page.evaluate(() => {
        try { if (window.CrewTour && CrewTour.close) CrewTour.close(); } catch {}
        document.querySelectorAll('.ctour-mask, .ctour-pop, .ctour').forEach(e => e.remove());
    });

    console.log('\n the stands on the card');
    await page.evaluate(() => openRoutes());
    await page.waitForTimeout(400);
    const cards = await page.evaluate(() => [...document.querySelectorAll('#routeList [data-rid]')]
        .map(e => ({ id: e.getAttribute('data-rid'), text: e.textContent.replace(/\s+/g, ' ').trim() })));
    const gated = cards.find(c => c.id === 'r1') || { text: '' };
    const plain = cards.find(c => c.id === 'r2') || { text: '' };
    ok('both legs are drawn', cards.length === 2, JSON.stringify(cards.map(c => c.id)));
    ok('the departure stand is on the card', /Gate A12/.test(gated.text), gated.text);
    ok('…and so is the arrival stand', /Gate 231/.test(gated.text), gated.text);
    ok('a leg with no stands says nothing about gates', !/Gate/.test(plain.text), plain.text);

    console.log('\n adding a leg gate to gate');
    await page.evaluate(() => openRouteForm());
    await page.waitForTimeout(200);
    ok('the form opens with the stands empty',
        await page.evaluate(() => !document.getElementById('nr_depGate').value && !document.getElementById('nr_arrGate').value));
    await page.fill('#nr_from', 'CYUL');
    await page.fill('#nr_to', 'LFPG');
    await page.waitForTimeout(350);
    ok('the airport’s own stands are offered for the origin',
        (await page.evaluate(() => [...document.querySelectorAll('#nr_depGateList option')].map(o => o.value)))
            .join(',') === 'B 6,B 8,C 51');
    ok('…and an airport the lookup could not answer for offers nothing, silently',
        (await page.evaluate(() => document.querySelectorAll('#nr_arrGateList option').length)) === 0);
    ok('…without stopping the field being typed into',
        !(await page.evaluate(() => document.getElementById('nr_arrGate').disabled)));
    // Typed the way somebody actually types it: lower case, with a stray space.
    await page.fill('#nr_depGate', ' b 6 ');
    await page.fill('#nr_arrGate', 'k41');
    await page.evaluate(() => submitRoute());
    await page.waitForTimeout(400);
    const added = writes.find(w => w.method === 'POST');
    ok('the add was sent', !!added, JSON.stringify(writes));
    ok('the departure stand went with it, tidied', added && added.body.departureGate === 'B 6',
        added && JSON.stringify(added.body.departureGate));
    ok('…and so did the arrival stand', added && added.body.arrivalGate === 'K41',
        added && JSON.stringify(added.body.arrivalGate));

    console.log('\n editing a leg that already has stands');
    await page.evaluate(() => openRouteForm(ROUTES.find(r => r.id === 'r1')));
    await page.waitForTimeout(200);
    ok('the form opens on the gate it was saved with',
        (await page.evaluate(() => document.getElementById('nr_depGate').value)) === 'A12');
    ok('…both of them',
        (await page.evaluate(() => document.getElementById('nr_arrGate').value)) === '231');
    // THE ONE THAT DESTROYS DATA. Change something else entirely and save: the
    // stands have to survive a VA who came here to fix a typo in the notes.
    await page.fill('#nr_notes', 'Now with a note');
    await page.evaluate(() => submitRoute());
    await page.waitForTimeout(400);
    const edited = writes.find(w => w.method === 'PATCH');
    ok('an unrelated edit was sent', !!edited, JSON.stringify(writes));
    ok('…and did not blank the departure stand', edited && edited.body.departureGate === 'A12',
        edited && JSON.stringify(edited.body.departureGate));
    ok('…nor the arrival stand', edited && edited.body.arrivalGate === '231',
        edited && JSON.stringify(edited.body.arrivalGate));

    console.log('\n clearing them again');
    await page.evaluate(() => openRouteForm(ROUTES.find(r => r.id === 'r1')));
    await page.waitForTimeout(200);
    await page.fill('#nr_depGate', '');
    await page.fill('#nr_arrGate', '');
    await page.evaluate(() => submitRoute());
    await page.waitForTimeout(400);
    const cleared = writes.filter(w => w.method === 'PATCH').pop();
    // Empty strings, not absent keys: a PATCH that simply omits them leaves the
    // old stands in the database and the VA cannot take a gate off a route.
    ok('a cleared stand is sent as empty rather than left out',
        cleared && cleared.body.departureGate === '' && cleared.body.arrivalGate === '',
        cleared && JSON.stringify(cleared.body));

    console.log('\n asking about an airport once');
    const before = gateLookups.filter(i => i === 'CYYZ').length;
    await page.evaluate(() => openRouteForm(ROUTES.find(r => r.id === 'r1')));
    await page.waitForTimeout(350);
    ok('an airport already looked up is not asked about again',
        gateLookups.filter(i => i === 'CYYZ').length === before, gateLookups.join(','));
    ok('…and it was asked about at all', before > 0, gateLookups.join(','));

    ok('no page errors throughout', errs.length === 0, errs.join(' | '));

    await browser.close();
    server.close();
    console.log(`\n${fail ? `${fail} failed, ` : ''}all ${pass} checks passed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
