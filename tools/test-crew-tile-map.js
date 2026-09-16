/*
 * tools/test-crew-tile-map.js — `npm run test:tile-map`
 *
 * THE CREW CENTRE'S ROUTE MAP, ON A REAL BASEMAP.
 *
 * The route map used to be MapLibre over OpenFreeMap: an engine from a CDN and
 * a basemap from a tile service, and every way either could fail ended as the
 * same black rectangle. It was replaced by crewNetMap.js, which draws the
 * network itself and asks nobody for anything — and that map is still here, and
 * still tested, by tools/test-crew-route-map.js.
 *
 * What the drawn map cannot do is be a map: no cities, no coast detail, and a
 * zoom that makes the picture bigger rather than showing more. So Leaflet over
 * Carto's raster tiles is back as the default (crewTileMap.js), and the whole
 * question this file exists to answer is whether it is back on better terms:
 *
 *   * THE ENGINE IS OURS. Leaflet is vendored in this repository and loaded
 *     from our own origin, so no CDN gets a vote. A page that cannot load it
 *     still gets a map.
 *   * A BASEMAP THAT NEVER PAINTS IS A FAILURE. The worst old failure reported
 *     success — engine up, layers in, no tiles — so the only signal trusted
 *     here is a tile arriving. Blocked tiles must put the drawn map back, on
 *     their own, without the reader asking.
 *   * THE DRAWN MAP IS STILL REACHABLE ON PURPOSE. It is the second option, not
 *     just the crash mat.
 *
 * Plus the two complaints that started this: zoom that does nothing with a
 * finger, and a network that sits too far away on a phone.
 *
 * No framework and no database: `node tools/test-crew-tile-map.js`, exits
 * non-zero on a failure, needs nothing running.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let blockLeaflet = false;
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    // The engine failing to arrive — the failure mode that used to be fatal.
    if (blockLeaflet && p === '/leaflet.js') { res.writeHead(404); return res.end(''); }
    const file = path.join(ROOT, p === '/' ? '/crew-dashboard.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

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
const mapPayload = () => ({
    routes: ROUTES.map(r => ({ ...r, o: AP[r.origin] || null, d: AP[r.destination] || null, mapped: true })),
    airports: [...new Set(ROUTES.flatMap(r => [r.origin, r.destination]))]
        .map(i => ({ icao: i, lat: AP[i][0], lon: AP[i][1], dep: 1, arr: 1, routes: 2, mapped: true })),
    stats: { unmapped: 0 },
});

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

// One transparent pixel, served as every tile. Enough to fire `tileload`, which
// is the only thing this map accepts as proof that a basemap exists.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log('  ✗ ' + n + (x ? '  (' + x + ')' : '')); fail++; } };

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    /* `tiles`: 'ok' serves a pixel, 'dead' aborts every tile request. */
    const open = async ({ tiles = 'ok', base = 'tiles', viewport, hasTouch = false } = {}) => {
        const ctx = await browser.newContext({
            viewport: viewport || { width: 1280, height: 900 },
            hasTouch, isMobile: false,
        });
        const page = await ctx.newPage();
        const errs = []; page.on('pageerror', e => errs.push(e.message));
        const tileHits = [];
        await page.route('**/cdn.tailwindcss.com**', r => r.fulfill({ contentType: 'application/javascript', body: TW }));
        await page.route('**/unpkg.com/**', r => r.fulfill({ contentType: 'application/javascript', body: 'window.lucide={createIcons:function(){}};' }));
        await page.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.route('**basemaps.cartocdn.com**', (r) => {
            tileHits.push(r.request().url());
            if (tiles === 'dead') return r.abort();
            return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
        });
        await page.route('**/api/**', (route) => {
            const p = new URL(route.request().url()).pathname;
            const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
            if (p.endsWith('/crew/aircraft-metadata')) return json({ ok: true, aircraft: [], liveries: {} });
            if (p.endsWith('/route-map')) return json(mapPayload());
            if (p.endsWith('/routes')) return json({ routes: ROUTES, ranks: [] });
            if (p.includes('/va-ads/by-slug/') || p.endsWith('/branding')) return json({ name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial'], fleet: [] });
            if (p.endsWith('/me')) return json({ role: 'owner', capabilities: ['routes.manage'], name: 'Owner' });
            return json({});
        });
        await page.addInitScript((b) => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' }));
            localStorage.setItem('crew-routemap-base', b);
        }, base);
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForTimeout(1100);
        await page.evaluate(() => { try { if (window.CrewTour && CrewTour.close) CrewTour.close(); } catch {}
            document.querySelectorAll('.ctour-mask, .ctour-pop, .ctour').forEach(e => e.remove()); });
        return { ctx, page, errs, tileHits };
    };

    const read = (page) => page.evaluate(() => ({
        // The tile map
        leaflet: document.querySelectorAll('#rmCanvas .leaflet-container').length,
        tileImgs: document.querySelectorAll('#rmCanvas .leaflet-tile').length,
        paths: document.querySelectorAll('#rmCanvas .ctm-arc').length,
        hits: document.querySelectorAll('#rmCanvas .ctm-hit').length,
        dashed: document.querySelectorAll('#rmCanvas .ctm-arc.is-share').length,
        dots: document.querySelectorAll('#rmCanvas .ctm-dot').length,
        labels: document.querySelectorAll('#rmCanvas .ctm-label').length,
        zoomCtl: document.querySelectorAll('#rmCanvas .leaflet-control-zoom a').length,
        attrib: (document.querySelector('#rmCanvas .leaflet-control-attribution') || {}).textContent || '',
        // The drawn map
        arcs: document.querySelectorAll('#rmCanvas .cnm-arc').length,
        cnmZoomBtns: document.querySelectorAll('#rmCanvas [data-cnm-zoom]').length,
        zoomVar: document.getElementById('rmCanvas').style.getPropertyValue('--cnm-z') || '',
        // Shared chrome
        baseLabel: (document.getElementById('rmBaseLabel') || {}).textContent || '',
        emptyShown: !document.getElementById('rmEmpty').classList.contains('hidden'),
        emptyTitle: document.getElementById('rmEmptyTitle').textContent,
        spinnerShown: !document.getElementById('rmLoading').classList.contains('hidden'),
        stats: document.getElementById('rmStats').textContent.replace(/\s+/g, ' ').trim(),
        railShown: !document.getElementById('rmRail').classList.contains('hidden'),
        railTitle: document.getElementById('rmRailTitle').textContent,
        saved: localStorage.getItem('crew-routemap-base'),
    }));

    const openMap = async (page, wait = 1400) => {
        await page.evaluate(() => { openRoutes(); openRouteMap(); });
        await page.waitForTimeout(wait);
    };

    /* ==================================================================
     * 1. THE BASEMAP, WHEN THE TILES ARRIVE
     * ================================================================ */
    console.log('\nThe tiled basemap');
    let { ctx, page, errs, tileHits } = await open();
    await openMap(page);
    let s = await read(page);

    ok('Leaflet came up, from our own origin', s.leaflet === 1, JSON.stringify({ leaflet: s.leaflet }));
    ok('…and tiles were actually requested', tileHits.length > 0, 'requests ' + tileHits.length);
    ok('…and painted', s.tileImgs > 0, 'tiles ' + s.tileImgs);
    // Three of the four sectors; the draft one is held back by "Active only".
    ok('the network is drawn over them', s.paths === 3, 'arcs ' + s.paths);
    ok('…somebody else’s metal drawn as somebody else’s', s.dashed === 1, 'dashed ' + s.dashed);
    ok('…each sector given something a finger can hit', s.hits === s.paths, 'hits ' + s.hits);
    ok('…every airport has a dot', s.dots === 4, 'dots ' + s.dots);
    ok('…the busiest fields are named', s.labels > 0, 'labels ' + s.labels);
    ok('there are zoom controls', s.zoomCtl === 2, 'controls ' + s.zoomCtl);
    ok('the basemap is attributed', /OpenStreetMap/.test(s.attrib) && /CARTO/.test(s.attrib), s.attrib);
    ok('the drawn map is NOT also in the canvas', s.arcs === 0, 'arcs ' + s.arcs);
    ok('the button says which map this is', s.baseLabel === 'Map', s.baseLabel);
    ok('there is no spinner left turning', !s.spinnerShown);
    ok('the empty state is not shown over a drawn map', !s.emptyShown, s.emptyTitle);
    ok('the statistics still count the network', /3 routes/.test(s.stats), s.stats);
    ok('no page errors', errs.length === 0, errs.join('|'));

    /* The overlay is `hidden` until it opens, so Leaflet is built against a
       zero-sized box. A map that was never told to look again is grey. */
    const sized = await page.evaluate(() => {
        const el = document.querySelector('#rmCanvas .leaflet-container');
        return el ? { w: el.clientWidth, h: el.clientHeight } : null;
    });
    ok('the map was measured against the opened overlay, not a hidden box',
        !!sized && sized.w > 600 && sized.h > 400, JSON.stringify(sized));

    /* Focus and the rail are this page's, and have to work on either map. */
    console.log('\nFocus, on the tiled map');
    await page.evaluate(() => rmFocusAirport('EGLL'));
    await page.waitForTimeout(250);
    s = await read(page);
    ok('tapping a field opens its rail', s.railShown && /EGLL/.test(s.railTitle), s.railTitle);
    const dimmed = await page.evaluate(() => {
        const ps = [...document.querySelectorAll('#rmCanvas .leaflet-overlay-pane path')];
        return ps.some(p => parseFloat(p.getAttribute('stroke-opacity') || '1') <= 0.15);
    });
    ok('…and dims what it is not about', dimmed);

    /* Clearing focus has to put back what each sector looked like, and a
       codeshare does not look like our own metal. Restoring them all to one
       opacity is the bug this checks for. */
    // Clear the EGLL focus above first: every sector touches EGLL, so sampling
    // the resting opacities while it is still lit reads 0.95 four times.
    await page.evaluate(() => rmClearFocus());
    await page.evaluate(() => { rmToggleActive(); });           // bring the draft in
    await page.waitForTimeout(900);
    const before = await page.evaluate(() => [...document.querySelectorAll('#rmCanvas .ctm-arc')]
        .map(p => p.getAttribute('stroke-opacity')).sort());
    await page.evaluate(() => rmFocusRoute('1'));
    await page.waitForTimeout(200);
    await page.evaluate(() => rmClearFocus());
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => [...document.querySelectorAll('#rmCanvas .ctm-arc')]
        .map(p => p.getAttribute('stroke-opacity')).sort());
    ok('clearing focus restores each sector to its OWN opacity',
        JSON.stringify(before) === JSON.stringify(after) && new Set(before).size > 1,
        JSON.stringify({ before, after }));
    await page.evaluate(() => { rmToggleActive(); });
    await page.waitForTimeout(700);
    await ctx.close();

    /* ==================================================================
     * 2. THE FALLBACK — a basemap that never paints
     *
     * The old failure that mattered most: everything reports success and no
     * tile ever lands. Nothing was left watching, so the reader got a black
     * rectangle. Now a deadline is running until a tile arrives.
     * ================================================================ */
    console.log('\nWhen the basemap cannot be reached');
    ({ ctx, page, errs, tileHits } = await open({ tiles: 'dead' }));
    await openMap(page);
    // Long enough for the tile-error limit; the deadline behind it is longer.
    await page.waitForTimeout(2500);
    s = await read(page);
    ok('the drawn map takes over on its own', s.arcs > 0, 'arcs ' + s.arcs);
    ok('…with its own zoom controls', s.cnmZoomBtns === 3, 'buttons ' + s.cnmZoomBtns);
    ok('…and Leaflet is gone from the canvas', s.leaflet === 0, 'leaflet ' + s.leaflet);
    ok('…the button now says so', s.baseLabel === 'Plain', s.baseLabel);
    ok('there is no black rectangle with a dead spinner', !s.spinnerShown);
    ok('“Map unavailable” is NOT what the reader is told', !s.emptyShown, s.emptyTitle);
    ok('the network is still all there', /3 routes/.test(s.stats), s.stats);
    // The fallback is automatic, not a preference. Next time, tiles again.
    ok('the reader’s saved choice is not overwritten by our failure',
        s.saved === 'tiles', String(s.saved));
    ok('no page errors', errs.length === 0, errs.join('|'));
    await ctx.close();

    /* ==================================================================
     * 3. THE ENGINE ITSELF FAILING TO ARRIVE
     * ================================================================ */
    console.log('\nWhen Leaflet cannot be loaded at all');
    blockLeaflet = true;
    ({ ctx, page, errs } = await open());
    await openMap(page, 1800);
    s = await read(page);
    ok('the drawn map takes over', s.arcs > 0, 'arcs ' + s.arcs);
    ok('…and the reader is not shown an error page', !s.emptyShown, s.emptyTitle);
    ok('no page errors', errs.length === 0, errs.join('|'));
    await ctx.close();
    blockLeaflet = false;

    /* ==================================================================
     * 4. THE DRAWN MAP AS A DELIBERATE CHOICE
     * ================================================================ */
    console.log('\nThe drawn map as the second option');
    ({ ctx, page, errs, tileHits } = await open({ base: 'drawn' }));
    await openMap(page);
    s = await read(page);
    ok('the saved choice is honoured', s.arcs > 0 && s.leaflet === 0, JSON.stringify({ arcs: s.arcs, leaflet: s.leaflet }));
    ok('…and NOTHING is asked of a tile host', tileHits.length === 0, tileHits.join(' | '));

    await page.evaluate(() => rmToggleBase());
    await page.waitForTimeout(1400);
    s = await read(page);
    ok('the toggle brings the basemap back', s.leaflet === 1 && s.arcs === 0, JSON.stringify({ leaflet: s.leaflet, arcs: s.arcs }));
    ok('…and remembers it', s.saved === 'tiles', String(s.saved));
    await page.evaluate(() => rmToggleBase());
    await page.waitForTimeout(600);
    s = await read(page);
    ok('…and back again, without either map being left behind',
        s.arcs > 0 && s.leaflet === 0, JSON.stringify({ arcs: s.arcs, leaflet: s.leaflet }));
    ok('no page errors', errs.length === 0, errs.join('|'));
    await ctx.close();

    /* ==================================================================
     * 5. THE TWO COMPLAINTS THAT STARTED THIS
     * ================================================================ */
    console.log('\nZoom, with a finger, on the drawn map');
    ({ ctx, page, errs } = await open({ base: 'drawn', viewport: { width: 390, height: 844 }, hasTouch: true }));
    await openMap(page);
    s = await read(page);
    ok('it opens unzoomed', s.zoomVar === '' || s.zoomVar === '1', s.zoomVar);

    /* A pinch. There was no pinch handling here at all — the wheel path wants a
       modifier key a phone has not got, and the buttons are a 2rem target in the
       corner of a map somebody is already touching. */
    const pinched = await page.evaluate(() => {
        const wrap = document.querySelector('#rmCanvas .cnm-wrap');
        if (!wrap) return 'no wrap';
        const r = wrap.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const touch = (id, x, y) => new Touch({ identifier: id, target: wrap, clientX: x, clientY: y });
        const fire = (type, pts) => {
            const ts = pts.map((p, i) => touch(i, p[0], p[1]));
            wrap.dispatchEvent(new TouchEvent(type, {
                touches: ts, targetTouches: ts, changedTouches: ts,
                bubbles: true, cancelable: true,
            }));
        };
        fire('touchstart', [[cx - 40, cy], [cx + 40, cy]]);
        fire('touchmove', [[cx - 120, cy], [cx + 120, cy]]);
        fire('touchend', []);
        return document.getElementById('rmCanvas').style.getPropertyValue('--cnm-z') || '';
    });
    ok('spreading two fingers zooms in', parseFloat(pinched) > 1.5, 'z=' + pinched);

    const tapped = await page.evaluate(() => {
        const wrap = document.querySelector('#rmCanvas .cnm-wrap');
        const host = document.getElementById('rmCanvas');
        host.style.removeProperty('--cnm-z');
        const r = wrap.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const tap = () => {
            const t = new Touch({ identifier: 1, target: wrap, clientX: x, clientY: y });
            wrap.dispatchEvent(new TouchEvent('touchend', {
                touches: [], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true,
            }));
        };
        tap(); tap();
        return host.style.getPropertyValue('--cnm-z') || '';
    });
    ok('…and a double tap does too', parseFloat(tapped) > 1, 'z=' + tapped);

    /* "It's too far away on mobile." The crop used to be inflated to the
       phone's own aspect ratio without limit, which on a 1:2 portrait screen
       meant growing the map several times over — and every one of those times
       made the airline smaller. The growth is now capped, so the drawn network
       has to occupy a real share of the viewport. */
    const framing = await page.evaluate(() => {
        const svg = document.querySelector('#rmCanvas .cnm-svg');
        if (!svg) return null;
        const host = document.getElementById('rmCanvas').getBoundingClientRect();
        const pts = [...svg.querySelectorAll('.cnm-pt')];
        if (!pts.length) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        pts.forEach(p => { const b = p.getBoundingClientRect();
            x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top);
            x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom); });
        return { w: (x1 - x0) / host.width, h: (y1 - y0) / host.height };
    });
    ok('the network fills a usable share of a portrait phone',
        !!framing && framing.w > 0.5, JSON.stringify(framing));
    ok('no page errors', errs.length === 0, errs.join('|'));
    await ctx.close();

    await browser.close();
    server.close();
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
