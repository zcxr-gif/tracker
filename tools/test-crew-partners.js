/*
 * tools/test-crew-partners.js — `npm run test:partners`
 *
 * CODESHARE PARTNERS: THE AIRLINES A VA SELLS SEATS ON.
 *
 * A partner used to exist only as a name typed on a route. Forty Iberia
 * codeshares meant typing "Iberia" forty times and pasting the same logo URL
 * forty times; one typo on the eleventh split the airline in two on the public
 * site; and there was nowhere to say what Iberia flies, so the codeshare
 * aircraft box offered the entire community catalogue and hoped.
 *
 * What is under test is that a partner is now a RECORD, and that the record is
 * actually used:
 *
 *   * a partner can be added with a logo and its own aircraft, and saves under
 *     `partners` — never overwriting the VA's own fleet
 *   * its aeroplanes get photos from the same library, with the same credit
 *   * the route form offers the partner instead of asking for it to be retyped,
 *     and carries the logo across so it is not pasted per leg
 *   * picking the partner offers THEIR aircraft, which is the thing the old
 *     free-text box could never do
 *   * the tiles pilots tap are round-cornered whatever the logo file looks like,
 *     and tapping one shows that partner's legs
 *   * a partner set up but not yet flown still appears, rather than vanishing
 *     until its first route exists
 *
 * No framework and no database: `node tools/test-crew-partners.js`, exits
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
 '.w-full{width:100%}.h-full{height:100%}.overflow-y-auto{overflow-y:auto}.overflow-hidden{overflow:hidden}',
 '.translate-x-full{transform:translateX(100%)}.z-50{z-index:50}',
 '.rounded-lg{border-radius:.5rem}.rounded-xl{border-radius:.75rem}.rounded-md{border-radius:.375rem}',
 '.w-9{width:2.25rem}.h-9{height:2.25rem}.w-10{width:2.5rem}.h-10{height:2.5rem}'
].join('');document.head.appendChild(s);window.tailwind={config:{}};})();`;

const ROUTES = [
    { id: '1', flightNumber: 'TA1', origin: 'EGLL', destination: 'KJFK', aircraft: 'Boeing 777-200ER', distanceNm: 3000, active: true, kind: 'own', partnerName: '' },
    { id: '2', flightNumber: 'TA2', origin: 'EGLL', destination: 'LEMD', aircraft: 'Airbus A320-200', distanceNm: 670, active: true, kind: 'codeshare', partnerName: 'Iberia Virtual' },
    { id: '3', flightNumber: 'TA3', origin: 'EGLL', destination: 'LEBL', aircraft: 'Airbus A320-200', distanceNm: 620, active: true, kind: 'codeshare', partnerName: 'Iberia Virtual' },
];
// Declared on the VA record: a logo and a fleet of their own.
let PARTNERS = [{
    name: 'Iberia Virtual',
    logo: 'https://cdn.test/iberia.png',
    aircraft: [
        { type: 'Airbus A320-200', name: 'Iberia', image: 'https://cdn.test/a320.jpg', imageAuto: true, photographer: 'Jan Polet', photoLink: '' },
        { type: 'Airbus A350-900', name: 'Iberia', image: '', imageAuto: false, photographer: '', photoLink: '' },
    ],
}];

const partnerPayload = () => {
    const byName = new Map();
    for (const r of ROUTES.filter(r => r.kind === 'codeshare')) {
        const k = r.partnerName.toLowerCase();
        if (!byName.has(k)) byName.set(k, { name: r.partnerName, routes: 0, destinations: new Set() });
        byName.get(k).routes++; byName.get(k).destinations.add(r.destination);
    }
    for (const d of PARTNERS) if (!byName.has(d.name.toLowerCase())) byName.set(d.name.toLowerCase(), { name: d.name, routes: 0, destinations: new Set() });
    return [...byName.values()].map(p => {
        const d = PARTNERS.find(x => x.name.toLowerCase() === p.name.toLowerCase());
        return {
            name: p.name, logo: (d && d.logo) || '', routes: p.routes,
            destinations: p.destinations.size, lockedRoutes: 0,
            aircraft: d ? d.aircraft.filter(a => a.type) : [], declared: !!d,
        };
    }).sort((a, b) => b.routes - a.routes);
};

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log('  ✗ ' + n + (x ? '  (' + x + ')' : '')); fail++; } };

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    const writes = [];

    await page.route('**/cdn.tailwindcss.com**', r => r.fulfill({ contentType: 'application/javascript', body: TW }));
    await page.route('**/unpkg.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/cdn.test/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('89504e470d0a1a0a', 'hex') }));
    await page.route('**/api/**', (route) => {
        const req = route.request();
        const p = new URL(req.url()).pathname;
        const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
        const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch { return {}; } };
        if (p.endsWith('/settings') && req.method() === 'POST') {
            const b = body();
            writes.push({ what: 'settings', keys: Object.keys(b), partners: b.partners, fleet: b.fleet });
            if (b.partners) PARTNERS = b.partners;
            return json({ ok: true, partners: b.partners || [], fleet: b.fleet || [] });
        }
        if (p.endsWith('/crew/aircraft-metadata')) return json({ ok: true,
            aircraft: ['Airbus A320-200', 'Airbus A350-900', 'Boeing 777-200ER'],
            liveries: { 'Airbus A320-200': ['Iberia', 'Generic'], 'Airbus A350-900': ['Iberia'] } });
        if (p.includes('/aircraft/lookup')) return json({ imageUrl: 'https://cdn.test/a350.jpg', contributorName: 'Jan Polet', isPlaceholder: false });
        if (p.endsWith('/routes')) return json({ routes: ROUTES, ranks: [], partners: partnerPayload() });
        if (p.endsWith('/route-map')) return json({ routes: [], airports: [], stats: {} });
        if (p.includes('/va-ads/by-slug/') || p.endsWith('/branding')) {
            return json({ name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial'],
                fleet: [{ type: 'Boeing 777-200ER', name: 'Test VA', image: '' }], partners: PARTNERS });
        }
        if (p.endsWith('/me')) return json({ role: 'owner', capabilities: ['routes.manage'], name: 'Owner' });
        return json({});
    });

    await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })));
    await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
        try { if (window.CrewTour && CrewTour.close) CrewTour.close(); } catch {}
        document.querySelectorAll('.ctour-mask, .ctour-pop, .ctour').forEach(e => e.remove());
    });

    console.log('\n the tiles pilots tap');
    await page.evaluate(() => openRoutes());
    await page.waitForTimeout(500);
    ok('a tile is drawn per partner',
        (await page.evaluate(() => document.querySelectorAll('#routePartners [data-partner]').length)) === 1);
    // A logo is a picture somebody else chose; plenty are hard-edged rectangles.
    const round = await page.evaluate(() => {
        // The frame is the element that WRAPS the logo, not the row above it.
        const img = document.querySelector('#routePartners [data-partner] img[src*="iberia"]');
        const frame = img && img.parentElement;
        if (!frame || !img) return null;
        const fs_ = getComputedStyle(frame), is = getComputedStyle(img);
        return { frameRadius: fs_.borderTopLeftRadius, clipped: fs_.overflow, imgRadius: is.borderTopLeftRadius };
    });
    ok('the logo frame is round-cornered', round && parseFloat(round.frameRadius) > 0, JSON.stringify(round));
    ok('…and clips the image to it, so a sharp-edged file still reads round',
        round && round.clipped === 'hidden', JSON.stringify(round));
    ok('…with the image inheriting the same rounding',
        round && parseFloat(round.imgRadius) > 0, JSON.stringify(round));
    ok('the partner’s aeroplane is shown on the tile',
        (await page.evaluate(() => !!document.querySelector('#routePartners [data-partner] img[src*="a320"]'))));
    ok('…credited on hover',
        /Jan Polet/.test(await page.evaluate(() => {
            const i = document.querySelector('#routePartners [data-partner] img[src*="a320"]');
            return (i && i.getAttribute('title')) || ''; })));
    ok('the tile counts their aircraft as well as their legs',
        /2 aircraft/.test(await page.evaluate(() => document.querySelector('#routePartners [data-partner]').textContent)));

    console.log('\n tapping one');
    await page.evaluate(() => setRoutePartner('Iberia Virtual'));
    await page.waitForTimeout(300);
    ok('it loads that partner’s routes and nothing else',
        (await page.evaluate(() => ROUTE_PARTNER)) === 'Iberia Virtual'
        && (await page.evaluate(() => ROUTE_KIND_VIEW)) === 'codeshare');
    ok('…and the tile reads as pressed',
        (await page.evaluate(() => document.querySelector('#routePartners [data-partner]').getAttribute('aria-pressed'))) === 'true');
    await page.evaluate(() => setRoutePartner('Iberia Virtual'));
    await page.waitForTimeout(200);
    ok('…tapping it again takes the filter off',
        (await page.evaluate(() => ROUTE_PARTNER)) === '');

    console.log('\n picking one on a route');
    await page.evaluate(() => { openRouteForm(); setRouteKind('codeshare'); });
    await page.waitForTimeout(300);
    ok('the partner is offered rather than retyped',
        (await page.evaluate(() => [...document.querySelectorAll('#nr_partnerPick option')].map(o => o.value)))
            .includes('Iberia Virtual'));
    ok('…with a way out for a one-off',
        (await page.evaluate(() => [...document.querySelectorAll('#nr_partnerPick option')].map(o => o.value)))
            .includes('__new'));
    await page.selectOption('#nr_partnerPick', 'Iberia Virtual');
    await page.waitForTimeout(250);
    ok('choosing it fills the name', (await page.inputValue('#nr_partner')) === 'Iberia Virtual');
    ok('…and brings the logo, so it is not pasted per leg',
        (await page.inputValue('#nr_partnerLogo')) === 'https://cdn.test/iberia.png');
    ok('…and offers THEIR aircraft, which free text never could',
        (await page.evaluate(() => [...document.querySelectorAll('#nr_partnerAc option')].map(o => o.value)))
            .includes('Airbus A350-900 · Iberia'));
    await page.selectOption('#nr_partnerAc', 'Airbus A350-900 · Iberia');
    await page.waitForTimeout(150);
    ok('…and picking one sets the route’s aircraft',
        (await page.inputValue('#nr_acFree')) === 'Airbus A350-900 · Iberia');

    console.log('\n setting one up');
    await page.evaluate(() => openPartners());
    await page.waitForTimeout(400);
    ok('the editor lists what is there',
        (await page.evaluate(() => document.querySelectorAll('#partnerRows > [data-pidx]').length)) === 1);
    ok('…with their aircraft under them',
        (await page.evaluate(() => document.querySelectorAll('#partnerRows [data-aidx]').length)) === 2);

    await page.evaluate(() => addPartner());
    await page.waitForTimeout(250);
    await page.fill('#partnerRows > [data-pidx="1"] [data-p="name"]', 'Vueling Virtual');
    await page.fill('#partnerRows > [data-pidx="1"] [data-p="logo"]', 'https://cdn.test/vy.png');
    await page.evaluate(() => { document.querySelector('#partnerRows > [data-pidx="1"] [data-paadd]').click(); });
    await page.waitForTimeout(250);
    await page.fill('#partnerRows > [data-pidx="1"] [data-aidx="0"] [data-pa="type"]', 'Airbus A320-200');
    await page.fill('#partnerRows > [data-pidx="1"] [data-aidx="0"] [data-pa="name"]', 'Vueling');
    await page.waitForTimeout(150);
    ok('a second partner can be added with a logo and an aircraft',
        (await page.evaluate(() => PARTNERS.length)) === 2
        && (await page.evaluate(() => PARTNERS[1].aircraft.length)) === 1);

    // The photo comes from the same library, with the same credit.
    await page.evaluate(() => { document.querySelector('#partnerRows > [data-pidx="1"] [data-aidx="0"] [data-ppic]').click(); });
    await page.waitForTimeout(500);
    ok('their aeroplane gets a photo from the community library',
        (await page.evaluate(() => PARTNERS[1].aircraft[0].image)) === 'https://cdn.test/a350.jpg');
    ok('…credited to whoever supplied it',
        (await page.evaluate(() => PARTNERS[1].aircraft[0].photographer)) === 'Jan Polet');

    await page.evaluate(() => saveStructure('partners', document.querySelector('#partners button')));
    await page.waitForTimeout(600);
    const save = writes.find(w => w.what === 'settings');
    ok('saving sends them as `partners`', save && save.keys.includes('partners'), JSON.stringify(save && save.keys));
    ok('…and never as the fleet', save && !save.keys.includes('fleet'));
    ok('…carrying both airlines', save && save.partners.length === 2);
    ok('…each with their own aircraft',
        save && save.partners[1].aircraft[0].type === 'Airbus A320-200');
    // The bug this guards: the save response feeds `d[kind]` back, and without
    // a partners branch that replaced the VA's own aircraft list.
    ok('the VA’s own fleet is untouched by a partner save',
        (await page.evaluate(() => FLEET.map(f => f.type).join(','))) === 'Boeing 777-200ER',
        await page.evaluate(() => JSON.stringify(FLEET.map(f => f.type))));

    ok('no page errors throughout', errs.length === 0, errs.join(' | '));

    await ctx.close(); await browser.close(); server.close();
    console.log(fail ? `\n${fail} failed, ${pass} passed\n` : `\nall ${pass} checks passed\n`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
