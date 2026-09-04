// test-crew-embed-views.js
// Drives the REAL embed-crew.html — the widget a VA pastes onto their own
// website — against a faked crew center, to prove that what their site shows
// and what their crew center shows are the same thing:
//
//   * the route network is there at all (it used to have no view, so a VA who
//     wanted their network on their homepage had to build it themselves)
//   * so are the pilots and the airline's headline figures
//   * a route parked as a DRAFT never reaches the VA's website, and a route
//     whose row simply omits `active` does — the one rule the crew center's
//     four route surfaces now share (crewPanels.isPublishedRoute)
//   * a figure the endpoint did not send renders as nothing, never as 0
//   * the staff to-do counts stay in the crew center
//   * a codeshare is marked as a codeshare, so a network on a public page
//     cannot be read as more metal than the airline operates
//
// Run:  node tools/test-crew-embed-views.js
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
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

const routes = [
    { id: 'r1', flightNumber: 'BA117', origin: 'EGLL', destination: 'KJFK', aircraft: 'Boeing 787-9', distanceNm: 3007, notes: 'Daily flagship', active: true, kind: 'own' },
    // No `active` at all. The staff dashboard used to hide this one while the
    // pilot's network panel showed it; both now publish it, and so must this.
    { id: 'r2', flightNumber: 'BA286', origin: 'KSFO', destination: 'EGLL', aircraft: 'Airbus A350', distanceNm: 4650, kind: 'own' },
    { id: 'r3', flightNumber: 'BA999', origin: 'EGKK', destination: 'LEMD', aircraft: 'A320', active: false, kind: 'own', notes: 'SEKRET DRAFT' },
    { id: 'r4', flightNumber: 'EI55', origin: 'EGLL', destination: 'EIDW', aircraft: 'A320', active: true, kind: 'codeshare', partnerName: 'Emerald Virtual' },
    { id: 'r5', flightNumber: 'BA24', origin: 'EGLL', destination: 'YSSY', aircraft: 'B77W', active: true, kind: 'own', minRank: 'Captain' },
];
const roster = [
    { id: 'm1', name: 'Rae Okafor', callsign: 'BAW22', hours: 412.4, rank: { name: 'Captain' }, status: 'active', aircraft: ['A320', 'B789'] },
    { id: 'm2', name: 'Jo Adeyemi', callsign: 'BAW71', hours: 88, rank: 'First Officer', status: 'loa', aircraft: [] },
    { id: 'm3', name: 'Sam Ferreira', callsign: 'BAW08', hours: 1204, rank: { name: 'Training Captain' }, status: 'active', aircraft: [] },
];
// Deliberately incomplete: no `hours`, no `flights30d`. Those two tiles must
// not appear at all — this is the whole "never invent a figure" rule.
const stats = {
    pilots: 12, pilotsActive: 9,
    routes: 4, destinations: 5,
    pirepsApproved: 140, pirepsPending: 3, applicationsPending: 2,
};

const FEEDS = {
    '/routes': { routes, partners: [{ name: 'Emerald Virtual', routes: 1, destinations: 1 }], ranks: [] },
    '/roster': { roster },
    '/stats': { ok: true, stats },
    '/announcements': { announcements: [] },
};

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    let failures = 0;
    const check = (label, ok, extra) => {
        if (!ok) { failures++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); } else console.log('  ✓ ' + label);
    };

    // Every view is opened the way a VA's website opens it: no session, no
    // token, one query string.
    const open = async (query, over) => {
        const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/crew/**', (route) => {
            const p = new URL(route.request().url()).pathname;
            const key = Object.keys(FEEDS).find((k) => p.endsWith(k));
            const body = (over && over[key]) || FEEDS[key] || {};
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        });
        await page.goto(`http://127.0.0.1:${port}/embed-crew.html?va=testva&${query}`);
        await page.waitForTimeout(700);
        return { page, errors, text: async () => page.textContent('#wrap') };
    };

    // ---- 1. The route network ---------------------------------------------
    console.log('\nThe route network on the VA’s own website');
    {
        const { page, errors, text } = await open('view=routes&limit=20');
        const t = await text();
        check('the widget renders a route view at all', /EGLL/.test(t), t.trim().slice(0, 80));
        check('a published route is on it', /BA117/.test(t) && /KJFK/.test(t));
        check('so is a route whose row omits `active`', /BA286/.test(t),
            'the dashboard hid these while every other surface showed them');
        check('a DRAFT route never reaches the public page',
            !/BA999/.test(t) && !/SEKRET DRAFT/.test(t), t.slice(0, 200));
        check('a codeshare is marked as one', /Codeshare/.test(t) && /Emerald Virtual/.test(t));
        check('a rank-gated route says which rank', /Captain\+/.test(t.replace(/\s+/g, '')));
        check('the distance is a rounded figure, not a decimal', /3,007 nm/.test(t), t.slice(0, 300));
        check('the header counts what is on screen — 4 published of 5',
            (await page.textContent('#wrap .count')) === '4');
        check('nothing threw', !errors.length, errors[0]);
        await page.close();
    }

    // ---- 2. The pilots -----------------------------------------------------
    console.log('\nThe pilots');
    {
        const { page, errors, text } = await open('view=pilots&limit=20');
        const t = await text();
        check('the roster is there', /Rae Okafor/.test(t) && /Jo Adeyemi/.test(t));
        check('callsigns come with it', /BAW22/.test(t));
        check('a rank object renders its name', /Captain/.test(t));
        check('…and so does a rank that arrived as a plain string', /First Officer/.test(t));
        check('hours are rounded for a headline', /412 h/.test(t) && !/412\.4/.test(t), t.slice(0, 300));
        check('someone on leave says so', /loa/i.test(t));
        check('roster order is kept by default', t.indexOf('Rae Okafor') < t.indexOf('Sam Ferreira'));
        check('nothing threw', !errors.length, errors[0]);
        await page.close();
    }
    {
        const { page, text } = await open('view=roster&sort=hours&limit=20');
        const t = await text();
        check('`roster` is accepted as the name the crew center uses', /Rae Okafor/.test(t));
        check('sort=hours puts the most-flown pilot first',
            t.indexOf('Sam Ferreira') < t.indexOf('Rae Okafor'), t.slice(0, 160));
        await page.close();
    }

    // ---- 3. The figures ----------------------------------------------------
    console.log('\nThe figures');
    {
        const { page, errors, text } = await open('view=stats');
        const t = await text();
        check('the figures render', /Pilots/.test(t) && /12/.test(t));
        check('the sub-line carries what the endpoint sent', /9 active/.test(t));
        check('routes and destinations are there', /Routes/.test(t) && /5 destinations/.test(t));
        check('approved flight reports are there', /140/.test(t));
        check('a figure the endpoint did NOT send draws nothing at all',
            !/Hours logged/.test(t) && !/Flights · 30d/.test(t), t.slice(0, 300));
        check('…and certainly never a 0', !/\b0\b/.test(t), t.slice(0, 300));
        check('staff to-do counts stay in the crew center',
            !/awaiting/i.test(t) && !/applications/i.test(t), t.slice(0, 300));
        check('no row count beside a one-object view', !/By the numbers\s*1/.test(t));
        check('nothing threw', !errors.length, errors[0]);
        await page.close();
    }
    {
        // An endpoint that answered, but with nothing we recognise. This must
        // read as "nothing published", not as an empty box.
        const { page, text } = await open('view=stats', { '/stats': { ok: true, stats: {} } });
        const t = await text();
        check('figures with nothing in them say so', /hasn’t published any figures/.test(t), t.trim().slice(0, 120));
        await page.close();
    }
    {
        const { page, text } = await open('view=routes', { '/routes': { routes: [] } });
        const t = await text();
        check('an airline with no network says so', /hasn’t published any routes/.test(t), t.trim().slice(0, 120));
        await page.close();
    }

    // ---- 4. Appearance still applies to the new views ----------------------
    console.log('\nThe new views take the same theming as the old ones');
    {
        const { page, text } = await open('view=routes&theme=light&header=off&accent=%23ff0000&limit=2');
        check('light theme applies', await page.$eval('body', (b) => b.getAttribute('data-theme') === 'light'));
        check('the header can be hidden', await page.$eval('body', (b) => b.getAttribute('data-header') === 'off'));
        check('the accent is taken from the URL',
            await page.$eval('html', (h) => h.style.getPropertyValue('--accent').trim() === '#ff0000'));
        const rows = await page.$$('#wrap .row');
        check('limit is honoured', rows.length === 2, `${rows.length} rows`);
        const t = await text();
        check('the powered-by line is still there', /Powered by Inflight/.test(t));
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} failure(s)\n` : '\nAll good.\n');
    process.exit(failures ? 1 : 0);
})();
