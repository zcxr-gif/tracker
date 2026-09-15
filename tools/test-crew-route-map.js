/*
 * tools/test-crew-route-map.js — `npm run test:route-map`
 *
 * THE CREW CENTRE'S ROUTE MAP.
 *
 * This used to be MapLibre over OpenFreeMap — an engine from a CDN and a
 * basemap from a tile service, two third-party hosts away — with the drawing
 * below as a floor under it. Every way either host could fail ended as the same
 * screen: a black rectangle, because the overlay is painted var(--bg). A
 * blocked CDN, an office proxy, an ad-blocker that eats tile hosts, a phone out
 * of WebGL contexts, one slow minute on the tile host. Each got its own
 * deadline and its own sentence, and the worst of them was the one that
 * reported success — style arrived, layers in, spinner off, no tiles — because
 * nothing was left watching by then.
 *
 * The floor is now the map. What is under test is that the network draws from
 * data we already hold, that it asks NO third party for permission to do it,
 * and that everything the overlay promises — the filters, the tooltip, the
 * focus, the rail — works on it.
 *
 * No framework and no database: `node tools/test-crew-route-map.js`, exits
 * non-zero on a failure, needs nothing running.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let blockNetMap = false;
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    // The one remaining way this map can fail to exist: its own script not
    // arriving, which means the page's scripts did not load at all.
    if (blockNetMap && p === '/crewNetMap.js') { res.writeHead(404); return res.end(''); }
    const file = path.join(ROOT, p === '/' ? '/crew-dashboard.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

// A network with something of everything: two ends of the world, a short hop,
// somebody else's metal, and one route still in draft.
const AP = {
    EGLL: [51.47, -0.46], KJFK: [40.64, -73.78], LFPG: [49.01, 2.55],
    OMDB: [25.25, 55.36], YSSY: [-33.95, 151.18],
};
const ROUTES = [
    { id: '1', flightNumber: 'TA1', origin: 'EGLL', destination: 'KJFK', aircraft: 'Boeing 787-9', distanceNm: 3000, active: true, kind: 'own', partnerName: '' },
    { id: '2', flightNumber: 'TA2', origin: 'EGLL', destination: 'LFPG', aircraft: 'Airbus A320', distanceNm: 200, active: true, kind: 'own', partnerName: '' },
    { id: '3', flightNumber: 'TA3', origin: 'EGLL', destination: 'OMDB', aircraft: 'Boeing 787-9', distanceNm: 2900, active: true, kind: 'codeshare', partnerName: 'Emirates' },
    { id: '4', flightNumber: 'TA4', origin: 'EGLL', destination: 'YSSY', aircraft: 'Boeing 787-9', distanceNm: 9100, active: false, kind: 'own', partnerName: '' },
];
let routes = ROUTES;

const mapPayload = () => ({
    routes: routes.map(r => ({ ...r, o: AP[r.origin] || null, d: AP[r.destination] || null, mapped: !!(AP[r.origin] && AP[r.destination]) })),
    airports: [...new Set(routes.flatMap(r => [r.origin, r.destination]))]
        .filter(i => AP[i])
        .map(i => ({ icao: i, lat: AP[i][0], lon: AP[i][1], dep: 1, arr: 1, routes: 2, mapped: true })),
    stats: { unmapped: 0 },
});

/* Just enough of the Tailwind play CDN to give the overlay its geometry. The
   sandbox cannot reach the real one, and a map measured inside an unpositioned
   box is not a map anybody is testing. */
const TW = `(function(){var s=document.createElement('style');s.textContent=[
 '.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}',
 '.inset-0{inset:0}.inset-x-0{left:0;right:0}.top-0{top:0}.left-0{left:0}.right-0{right:0}.bottom-0{bottom:0}',
 '.grid{display:grid}.flex{display:flex}.block{display:block}.inline-flex{display:inline-flex}',
 '.place-items-center{place-items:center}.items-center{align-items:center}',
 '.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.min-w-0{min-width:0}',
 '.w-full{width:100%}.h-full{height:100%}.h-16{height:4rem}',
 '.overflow-y-auto{overflow-y:auto}.translate-x-full{transform:translateX(100%)}',
 '.pointer-events-none{pointer-events:none}.pointer-events-auto{pointer-events:auto}',
 '.z-10{z-index:10}.z-20{z-index:20}.z-\\\\[60\\\\]{z-index:60}.left-1\\\\/2{left:50%}',
 '.top-\\\\[4\\\\.5rem\\\\]{top:4.5rem}'
].join('');document.head.appendChild(s);window.tailwind={config:{}};})();`;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log('  ✗ ' + n + (x ? '  (' + x + ')' : '')); fail++; } };

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    const open = async (deviceInit, viewport) => {
        const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        const errs = []; page.on('pageerror', e => errs.push(e.message));
        // Every third-party host this page touches, watched. The route map must
        // not add to this list — that is the whole point of the change.
        const outside = [];
        page.on('request', (r) => { const u = r.url(); if (!u.includes('127.0.0.1') && !u.startsWith('data:')) outside.push(u); });
        await page.route('**/cdn.tailwindcss.com**', r => r.fulfill({ contentType: 'application/javascript', body: TW }));
        await page.route('**/unpkg.com/**', r => r.fulfill({ contentType: 'application/javascript', body: 'window.lucide={createIcons:function(){}};' }));
        await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.route('**/api/**', (route) => {
            const p = new URL(route.request().url()).pathname;
            const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
            if (p.endsWith('/crew/aircraft-metadata')) return json({ ok: true, aircraft: [], liveries: {} });
            if (p.endsWith('/route-map')) return json(mapPayload());
            if (p.endsWith('/routes')) return json({ routes, ranks: [] });
            if (p.includes('/va-ads/by-slug/') || p.endsWith('/branding')) return json({ name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial'], fleet: [] });
            if (p.endsWith('/me')) return json({ role: 'owner', capabilities: ['routes.manage'], name: 'Owner' });
            return json({});
        });
        await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })));
        if (deviceInit) await page.addInitScript(deviceInit);
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForTimeout(1100);
        // The first-visit tour sits over the whole page and would eat every click.
        await page.evaluate(() => { try { if (window.CrewTour && CrewTour.close) CrewTour.close(); } catch {}
            document.querySelectorAll('.ctour-mask, .ctour-pop, .ctour').forEach(e => e.remove()); });
        return { ctx, page, errs, outside };
    };

    const read = (page) => page.evaluate(() => ({
        arcs: document.querySelectorAll('#rmCanvas .cnm-arc').length,
        hits: document.querySelectorAll('#rmCanvas .cnm-hit').length,
        dashed: document.querySelectorAll('#rmCanvas .cnm-arc.is-share').length,
        draft: document.querySelectorAll('#rmCanvas .cnm-arc.is-draft').length,
        dots: document.querySelectorAll('#rmCanvas [data-airport]').length,
        labels: document.querySelectorAll('#rmCanvas .cnm-label').length,
        zoom: document.querySelectorAll('#rmCanvas [data-cnm-zoom]').length,
        focused: !!document.querySelector('#rmCanvas .cnm-svg.is-focus'),
        lit: document.querySelectorAll('#rmCanvas .cnm-arc.is-on').length,
        spinnerShown: !document.getElementById('rmLoading').classList.contains('hidden'),
        emptyShown: !document.getElementById('rmEmpty').classList.contains('hidden'),
        emptyTitle: document.getElementById('rmEmptyTitle').textContent,
        emptyMsg: document.getElementById('rmEmptyMsg').textContent,
        stats: document.getElementById('rmStats').textContent.replace(/\s+/g, ' ').trim(),
        railShown: !document.getElementById('rmRail').classList.contains('hidden'),
        railTitle: document.getElementById('rmRailTitle').textContent,
        tipShown: !document.getElementById('rmTip').classList.contains('hidden'),
        tip: document.getElementById('rmTip').textContent.replace(/\s+/g, ' ').trim(),
        zoomVar: document.getElementById('rmCanvas').style.getPropertyValue('--cnm-z') || '',
    }));

    /* ==================================================================
     * 1. THE MAP, DRAWN FROM OUR OWN DATA
     * ================================================================ */
    console.log('\nThe network, drawn here');
    routes = ROUTES;
    let { ctx, page, errs, outside } = await open();
    await page.evaluate(() => { openRoutes(); openRouteMap(); });
    await page.waitForTimeout(900);
    let s = await read(page);

    ok('the network is drawn', s.arcs > 0, JSON.stringify(s));
    // Three of the four are active; the draft one is held back by "Active only".
    ok('…every active sector of it', s.arcs === 3, 'arcs ' + s.arcs);
    ok('…with an airport for each end, named', s.dots === 4 && s.labels > 0, 'dots ' + s.dots + ' labels ' + s.labels);
    ok('…somebody else’s metal drawn as somebody else’s', s.dashed === 1, 'dashed ' + s.dashed);
    ok('…each sector given something a finger can hit', s.hits === s.arcs, 'hits ' + s.hits + ' arcs ' + s.arcs);
    ok('…and it can be zoomed', s.zoom === 3);
    ok('there is no spinner left turning', !s.spinnerShown);
    // "Map unavailable" over an empty rectangle was the old answer to a bad minute.
    ok('the empty state is not shown over a drawn map', !s.emptyShown, s.emptyTitle);
    ok('the statistics count the network', /3 routes/.test(s.stats) && /4 airports/.test(s.stats), s.stats);

    // THE POINT OF ALL OF THIS.
    const third = outside.filter(u => /maplibre|openfreemap|tiles\./i.test(u));
    ok('nothing is asked of a map CDN or a tile host', third.length === 0, third.join(' | '));
    ok('no page errors', errs.length === 0, errs.join('|'));

    /* The filters are the same controls they always were. */
    console.log('\nThe filters');
    await page.evaluate(() => { document.getElementById('rmKind').value = 'own'; rmApplyFilters(); });
    await page.waitForTimeout(250);
    s = await read(page);
    ok('“our own metal” drops the codeshare', s.arcs === 2 && s.dashed === 0, JSON.stringify({ arcs: s.arcs, dashed: s.dashed }));

    await page.evaluate(() => { document.getElementById('rmKind').value = 'codeshare'; rmApplyFilters(); });
    await page.waitForTimeout(250);
    s = await read(page);
    ok('…and “codeshares” keeps only it', s.arcs === 1 && s.dashed === 1, JSON.stringify({ arcs: s.arcs, dashed: s.dashed }));

    await page.evaluate(() => { document.getElementById('rmKind').value = ''; rmToggleActive(); });
    await page.waitForTimeout(250);
    s = await read(page);
    ok('turning off “active only” brings the draft sector in', s.arcs === 4 && s.draft === 1, JSON.stringify({ arcs: s.arcs, draft: s.draft }));

    await page.evaluate(() => { document.getElementById('rmSearch').value = 'LFPG'; rmApplyFilters(); });
    await page.waitForTimeout(250);
    s = await read(page);
    ok('searching an airport narrows it to that airport’s sectors', s.arcs === 1, 'arcs ' + s.arcs);

    await page.evaluate(() => { document.getElementById('rmSearch').value = ''; rmToggleActive(); rmApplyFilters(); });
    await page.waitForTimeout(250);

    /* A filter is not a reason to throw away where somebody was looking. */
    console.log('\nZoom survives a filter, and “Fit” gives it back');
    await page.evaluate(() => { document.querySelector('#rmCanvas [data-cnm-zoom="in"]').click(); });
    await page.waitForTimeout(150);
    const zoomed = (await read(page)).zoomVar;
    ok('zooming in is recorded', parseFloat(zoomed) > 1, 'z ' + zoomed);
    await page.evaluate(() => { document.getElementById('rmKind').value = 'own'; rmApplyFilters(); });
    await page.waitForTimeout(250);
    s = await read(page);
    ok('…and a filter change keeps it', parseFloat(s.zoomVar) > 1, 'z ' + s.zoomVar);
    await page.evaluate(() => { document.getElementById('rmKind').value = ''; rmFitAll(); });
    await page.waitForTimeout(250);
    s = await read(page);
    ok('…while “Fit” really does fit the whole network again', !s.zoomVar || parseFloat(s.zoomVar) === 1, 'z ' + s.zoomVar);

    /* ==================================================================
     * 2. TAPPING IT, WHICH IS THE POINT OF A MAP
     * ================================================================ */
    console.log('\nTapping and pointing');
    await page.evaluate(() => { const d = document.querySelector('#rmCanvas [data-airport="EGLL"]'); d.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await page.waitForTimeout(250);
    s = await read(page);
    ok('an airport opens its details', s.railShown && /EGLL/.test(s.railTitle), s.railTitle);
    ok('…and the rest of the network gets out of the way', s.focused && s.lit > 0, JSON.stringify({ focused: s.focused, lit: s.lit }));

    await page.evaluate(() => { const a = document.querySelector('#rmCanvas .cnm-hit[data-route="2"]'); a.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await page.waitForTimeout(250);
    s = await read(page);
    ok('a sector opens its own details', s.railShown && /LFPG/.test(s.railTitle), s.railTitle);
    ok('…and exactly that sector is lit', s.lit === 1, 'lit ' + s.lit);

    await page.evaluate(() => { document.querySelector('#rmCanvas .cnm-land').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await page.waitForTimeout(250);
    s = await read(page);
    ok('tapping the sea puts the whole network back', !s.focused && !s.railShown, JSON.stringify({ focused: s.focused, rail: s.railShown }));

    // The tooltip knows things the map never had to be told — the flight number
    // and the distance are this page's, not the drawing's.
    await page.evaluate(() => {
        const a = document.querySelector('#rmCanvas .cnm-hit[data-route="1"]');
        const r = a.getBoundingClientRect();
        a.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerType: 'mouse' }));
    });
    await page.waitForTimeout(200);
    s = await read(page);
    ok('hovering a sector names it', s.tipShown && /EGLL/.test(s.tip) && /KJFK/.test(s.tip), s.tip);
    ok('…with what this page knows about it', /TA1/.test(s.tip) && /3,000 nm/.test(s.tip), s.tip);
    ok('no page errors', errs.length === 0, errs.join('|'));
    await ctx.close();

    /* ==================================================================
     * 3. A NETWORK WITH NOTHING IN IT
     *
     * "No routes yet" and "the map would not load" are different problems and
     * must not wear each other's words.
     * ================================================================ */
    console.log('\nAn airline with no routes');
    routes = [];
    ({ ctx, page, errs } = await open());
    await page.evaluate(() => { openRoutes(); openRouteMap(); });
    await page.waitForTimeout(900);
    s = await read(page);
    ok('says there are no routes, not that the map is broken',
        s.emptyShown && /no routes/i.test(s.emptyTitle), s.emptyTitle);
    ok('no page errors', errs.length === 0, errs.join('|'));
    await ctx.close();

    /* ==================================================================
     * 4. THE DEVICE THAT USED TO GET A BLACK SCREEN
     *
     * An iPhone with two 3D viewers already open, refused another WebGL
     * context. The old map was WebGL; this one is arithmetic and an SVG.
     * ================================================================ */
    console.log('\nA device that will not give out WebGL at all');
    routes = ROUTES;
    ({ ctx, page, errs } = await open(() => { HTMLCanvasElement.prototype.getContext = function () { return null; }; }));
    await page.evaluate(() => { openRoutes(); openRouteMap(); });
    await page.waitForTimeout(900);
    s = await read(page);
    ok('the network is drawn anyway', s.arcs === 3, JSON.stringify({ arcs: s.arcs }));
    ok('…with no apology on screen', !s.emptyShown && !s.spinnerShown, JSON.stringify(s));
    ok('no page errors', errs.length === 0, errs.join('|'));
    await ctx.close();

    /* Dark and light are two drawings, and switching between them with the map
       open used to be the one thing that could rebuild it into nothing. */
    console.log('\nSwitching the theme with the map open');
    ({ ctx, page, errs } = await open());
    await page.evaluate(() => { openRoutes(); openRouteMap(); });
    await page.waitForTimeout(900);
    await page.evaluate(() => toggleTheme());
    await page.waitForTimeout(400);
    s = await read(page);
    ok('the network is still on the screen', s.arcs === 3 && !s.emptyShown, JSON.stringify({ arcs: s.arcs, empty: s.emptyShown }));
    ok('no page errors', errs.length === 0, errs.join('|'));
    await ctx.close();

    /* ==================================================================
     * 5. THE LAST WAY THIS CAN FAIL
     *
     * crewNetMap.js itself not arriving. There is nothing to fall back to and
     * nothing to pretend, so it is said — rather than shown as a black box.
     * ================================================================ */
    console.log('\nWhen the map’s own script does not arrive');
    blockNetMap = true;
    ({ ctx, page, errs } = await open());
    await page.evaluate(() => { openRoutes(); openRouteMap(); });
    await page.waitForTimeout(900);
    s = await read(page);
    ok('it says so rather than showing a black rectangle',
        s.emptyShown && /unavailable/i.test(s.emptyTitle), s.emptyTitle + ' / ' + s.emptyMsg);
    ok('…and the spinner does not turn for ever', !s.spinnerShown);
    ok('no page errors', errs.length === 0, errs.join('|'));
    await ctx.close();
    blockNetMap = false;

    console.log(`\n${pass} passed, ${fail} failed`);
    await browser.close(); server.close();
    process.exit(fail ? 1 : 0);
})();
