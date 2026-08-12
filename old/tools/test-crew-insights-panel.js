// test-crew-insights-panel.js
// The Statistics panel on the real dashboard: that it is gated like the
// endpoint, asks for the window the user picked, and reports what it counted
// rather than presenting a subset as the whole.
//
// Run:  node tools/test-crew-insights-panel.js
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

let ME = { role: 'owner', view: 'staff', caps: ['flights.review'] };
let asked = [];

const INSIGHTS = {
    ok: true,
    window: { days: 90 },
    totals: { flights: 128, hours: 402.5, landings: 141, distanceNm: 96500, pilotsFlying: 9, flightsAllTime: 640, hoursAllTime: 2100 },
    topRoutes: [
        { origin: 'EGLL', destination: 'LFPG', flights: 22, hours: 27.5, pilots: 6 },
        { origin: 'EGLL', destination: 'KJFK', flights: 14, hours: 98, pilots: 4 },
    ],
    topPilots: [
        { memberId: 'm2', name: 'Jo Adeyemi', callsign: 'BAW71', onRoster: true, flights: 31, hours: 74.2, landings: 33 },
        { memberId: 'gone', name: 'A pilot no longer on the roster', callsign: '', onRoster: false, flights: 9, hours: 20, landings: 9 },
    ],
    topAirports: [{ icao: 'EGLL', departures: 40, arrivals: 38, movements: 78 }],
    topAircraft: [{ aircraft: 'Airbus A320', flights: 44, hours: 61 }],
    monthly: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, flights: i === 3 ? 0 : i * 3, hours: i * 8, pilots: 2 })),
    coverage: { routes: 40, flown: 28, neverFlown: 12, examples: [{ origin: 'EGLL', destination: 'YSSY', flightNumber: 'BA15' }] },
    crew: { days: 30, joins: 5, promotions: 2, checkrides: 1, eventsPublished: 3, schedulesPublished: 4 },
    counted: { approved: 903, reports: 1284 },
    generatedAt: new Date().toISOString(),
};

function api(route) {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.endsWith('/insights')) { asked.push(url.searchParams.get('days')); return json(INSIGHTS); }
    if (p.endsWith('/me')) return json({ name: 'Owner', capabilities: [], rolePresets: [], ...ME });
    if (p.endsWith('/branding')) return json({ name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial'] });
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: false });
    if (p.endsWith('/events')) return json({ events: [], canManage: false, mine: [], ranks: [] });
    if (p.endsWith('/schedules')) return json({ schedules: [], mine: [], canManage: false, rules: { enabled: true }, ranks: [] });
    if (p.endsWith('/me/pilot')) return json({ pilot: null, linkable: false });
    return json({});
}

let pass = 0; let fail = 0;
const ok = (n, c, e) => { if (c) { console.log(`  ✓ ${n}`); pass++; } else { console.log(`  ✗ ${n}${e ? `  (${e})` : ''}`); fail++; } };
const head = (s) => console.log(`\n${s}`);

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    const openDash = async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        await page.route('**/api/**', api);
        await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })));
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForTimeout(1000);
        return { ctx, page };
    };
    const tiles = (page) => page.$$eval('#toolGrid [data-i]', (els) => els.map((e) => e.querySelector('.font-semibold').textContent.trim()));

    // ------------------------------------------------------------------
    head('Gated like the endpoint it calls');

    ME = { role: 'staff', view: 'staff', caps: ['roster.manage'] };
    const { ctx: c0, page: p0 } = await openDash();
    ok('no Statistics tile without flights.review', !(await tiles(p0)).includes('Statistics'), (await tiles(p0)).join('/'));
    await c0.close();

    ME = { role: 'staff', view: 'staff', caps: ['flights.review'] };
    const { ctx, page } = await openDash();
    ok('a flight reviewer is offered it', (await tiles(page)).includes('Statistics'), (await tiles(page)).join('/'));

    // ------------------------------------------------------------------
    head('What it shows');

    asked = [];
    await page.evaluate(() => window.openInsights());
    await page.waitForTimeout(700);
    const text = await page.innerText('#insPanel');

    ok('defaults to 90 days', asked[0] === '90', asked.join(','));
    ok('the headline totals are there', /128/.test(text) && /402\.5h/.test(text), text.slice(0, 120));
    ok('it says what it counted, and what it did not', /903 of 1284 reports/.test(text), text.slice(0, 400));
    ok('…and that pending and rejected are excluded', /Pending and rejected reports are not counted/.test(text));

    ok('most flown routes are listed', /EGLL → LFPG/.test(text), text.slice(0, 300));
    ok('…with the pilots who fly them', /Pilots/.test(text));
    ok('most active pilots are listed', /Jo Adeyemi/.test(text));
    ok('…marked when they have left the roster', /\(left\)/.test(text));
    ok('…and explained as flights, not career hours', /not by career hours/.test(text));
    ok('busiest airports are listed', /Movements/.test(text));
    ok('most flown aircraft are listed', /Airbus A320/.test(text));

    ok('unflown routes are named, not just counted', /EGLL→YSSY/.test(text), text.slice(-500));
    ok('…and scoped as all-time', /never flown/i.test(text));
    ok('crew activity comes from the noticeboard', /joined/.test(text) && /promoted/.test(text));
    ok('…and the webhook relationship is stated honestly', /posts and forgets/.test(text));

    const bars = await page.$$eval('#insPanel .accent-bg', (els) => els.length);
    ok('twelve monthly bars are drawn, including the empty month', bars >= 12, `${bars} bars`);

    // ------------------------------------------------------------------
    head('Changing the window');

    asked = [];
    await page.click('[data-insdays="30"]');
    await page.waitForTimeout(600);
    ok('picking 30 days re-asks the server for 30', asked.includes('30'), asked.join(','));

    asked = [];
    await page.click('[data-insdays="0"]');
    await page.waitForTimeout(600);
    ok('All time asks for 0', asked.includes('0'), asked.join(','));
    ok('…and the panel still renders', /Most flown routes/.test(await page.innerText('#insPanel')));

    await ctx.close();
    await browser.close();
    server.close();
    console.log(`\n${fail ? `${fail} failed, ` : ''}${pass} passed.`);
    process.exit(fail ? 1 : 0);
})();
