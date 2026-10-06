// test-crew-probation.js
// Probation on set routes, through the REAL pages against a faked backend:
//
//   * the roster-sweep settings send how many routes and who picks them
//   * Roster → Probation lists who is on probation, and choosing routes,
//     drawing again and taking them away each send what they say
//   * a pilot sees their routes, which are flown, and when probation ends —
//     and sees nothing at all once they are through
//
// Run:  node tools/test-crew-probation.js
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
// The same stand-in for Tailwind the codeshare test uses: just enough layout
// for the drawers to sit on screen.
const TW = `(function(){var s=document.createElement('style');s.textContent=[
 '.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}.sticky{position:sticky}',
 '.inset-0{inset:0}.top-0{top:0}.right-0{right:0}.bottom-0{bottom:0}.hidden{display:none}',
 '.grid{display:grid}.flex{display:flex}.block{display:block}.inline-flex{display:inline-flex}',
 '.items-center{align-items:center}.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.min-w-0{min-width:0}',
 '.w-full{width:100%}.h-full{height:100%}.overflow-y-auto{overflow-y:auto}.overflow-hidden{overflow:hidden}',
 '.translate-x-full{transform:translateX(100%)}.z-50{z-index:50}'
].join('');document.head.appendChild(s);window.tailwind={config:{}};})();`;

const ROUTES = [
    { id: 'r1', flightNumber: 'TV1', origin: 'EGLL', destination: 'KJFK', aircraft: 'B777', flown: false },
    { id: 'r2', flightNumber: 'TV2', origin: 'KJFK', destination: 'EGLL', aircraft: 'B777', flown: false },
    { id: 'r3', flightNumber: 'TV3', origin: 'EGLL', destination: 'LFPG', aircraft: 'A320', flown: false },
];
const DUE = '2026-10-13T12:00:00.000Z';

let failures = 0;
const check = (label, ok, extra) => {
    if (!ok) { failures++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); } else console.log('  ✓ ' + label);
};

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });

    const open = async (file, { role = 'owner', probation, sent = [] }) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        page.on('pageerror', (e) => { failures++; console.log('  ✗ page error — ' + String(e).split('\n')[0]); });
        await page.route('**/cdn.tailwindcss.com**', (r) => r.fulfill({ contentType: 'application/javascript', body: TW }));
        await page.route('**/unpkg.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
        await page.route('**/api/**', (route) => {
            const req = route.request();
            const p = new URL(req.url()).pathname;
            const m = req.method();
            const json = (x, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
            const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch { return {}; } };
            if (m !== 'GET') sent.push({ m, p, body: body() });
            if (/\/probation\/[^/]+$/.test(p) && m === 'PUT') {
                const b = body();
                const ids = b.random ? ['r3', 'r1'] : (b.routeIds || []);
                return json({ ok: true, pilot: { memberId: p.split('/').pop(), assigned: !b.clear, by: b.random ? 'random' : 'staff', required: ids.length, done: 0, dueAt: DUE, routes: ROUTES.filter((r) => ids.includes(r.id)) } });
            }
            if (p.endsWith('/probation')) return json(typeof probation === 'function' ? probation() : probation);
            if (p.endsWith('/settings') && m === 'POST') return json({ ok: true });
            if (p.endsWith('/retention')) return json({ rules: { enabled: true, firstFlight: true, firstFlightDays: 7, firstFlightRoutes: 0 }, preview: { checked: 2, warned: [], removed: [], deactivated: [], awaitingRoutes: [{ id: 'm2', name: 'Robin Diaz' }] } });
            if (p.endsWith('/me')) return json({ role, caps: role === 'owner' ? ['*'] : ['roster.manage'], capabilities: [], rolePresets: [], staffRoles: [], staffAssignments: [] });
            if (p.endsWith('/roster')) return json({ roster: [] });
            return json({});
        });
        await page.addInitScript(([r]) => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: r }));
            localStorage.setItem('crew:tour:staff:testva', '1');
            localStorage.setItem('crew:tour:pilot:testva', '1');
        }, [role === 'pilot' ? 'pilot' : role]);
        await page.goto(`http://127.0.0.1:${port}/${file}?va=testva`);
        await page.waitForTimeout(1500);
        await page.evaluate(() => document.querySelectorAll('.ctour-mask, .ctour-pop, .ctour').forEach((e) => e.remove()));
        return page;
    };

    // ---- settings ----
    console.log('\nThe roster-sweep settings');
    let sent = [];
    let page = await open('crew-dashboard.html', { probation: { enabled: false }, sent });
    await page.evaluate(() => window.openSettings('crew'));
    await page.waitForTimeout(600);
    check('there is a “routes to fly” box and a “picked” choice', !!(await page.$('#ret_firstFlightRoutes')) && !!(await page.$('#ret_firstFlightRoutePick')));
    check('it opens on 0 — any one flight', (await page.inputValue('#ret_firstFlightRoutes')) === '0');
    check('the preview names pilots waiting for routes', /Waiting for routes 1/.test(await page.textContent('#ret_preview')), await page.textContent('#ret_preview'));
    await page.evaluate(() => {
        const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
        set('ret_firstFlightRoutes', '3'); set('ret_firstFlightRoutePick', 'staff');
        return saveRetentionPrefs(null);
    });
    await page.waitForTimeout(500);
    const saved = sent.find((s) => s.body && s.body.retention);
    check('saving sends three set routes, picked by staff',
        saved && saved.body.retention.firstFlightRoutes === 3 && saved.body.retention.firstFlightRoutePick === 'staff', JSON.stringify(saved && saved.body.retention));
    await page.evaluate(() => { document.getElementById('ret_firstFlightRoutes').value = '99'; return saveRetentionPrefs(null); });
    await page.waitForTimeout(400);
    check('…clamped to 10 on the way out', sent.filter((s) => s.body && s.body.retention).pop().body.retention.firstFlightRoutes === 10);
    await page.close();

    // ---- staff list ----
    console.log('\nRoster → Probation');
    sent = [];
    const STAFF = {
        enabled: true, required: 2, pick: 'staff', days: 7, canManage: true, routes: ROUTES,
        pilots: [
            { memberId: 'm1', name: 'Jordan Lee', callsign: 'TVA1', assigned: true, by: 'random', required: 2, done: 1, dueAt: DUE, routes: [{ ...ROUTES[0], flown: true }, ROUTES[1]] },
            { memberId: 'm2', name: 'Robin Diaz', callsign: 'TVA2', assigned: false, required: 2, done: 0, routes: [] },
        ],
    };
    page = await open('crew-dashboard.html', { probation: STAFF, sent });
    await page.evaluate(() => openRoster());
    await page.waitForTimeout(400);
    check('the Probation tab is offered to roster staff', await page.isVisible('#rosterViewTabs [data-view="probation"]'));
    await page.evaluate(() => switchRosterView('probation'));
    await page.waitForSelector('#probationList [data-pb-member="m1"]');
    check('a pilot on probation shows how far they have got', /1 of 2/.test(await page.textContent('#probationList [data-pb-member="m1"]')));
    check('…with the flown leg ticked', (await page.$$('#probationList [data-pb-member="m1"] .pb-done')).length === 1);
    check('a pilot waiting for routes says their clock has not started', /clock has not started/.test(await page.textContent('#probationList [data-pb-member="m2"]')));
    await page.click('#probationList [data-pb-edit="m2"]');
    await page.check('#probationList [data-pb-route="r1"]');
    await page.check('#probationList [data-pb-route="r3"]');
    await page.click('#probationList [data-pb-save="m2"]');
    await page.waitForTimeout(300);
    const chose = sent.find((s) => /probation\/m2$/.test(s.p));
    check('choosing routes sends exactly those', chose && chose.m === 'PUT' && chose.body.routeIds.join() === 'r1,r3', JSON.stringify(chose && chose.body));
    check('…and the row then shows them', /0 of 2/.test(await page.textContent('#probationList [data-pb-member="m2"]')));
    await page.click('#probationList [data-pb-random="m1"]');
    await page.waitForTimeout(300);
    check('“Draw again” asks for a random pick', sent.some((s) => /probation\/m1$/.test(s.p) && s.body.random === true));
    await page.click('#probationList [data-pb-clear="m1"]');
    await page.waitForTimeout(300);
    check('“Take away” clears them', sent.some((s) => /probation\/m1$/.test(s.p) && s.body.clear === true));
    await page.close();

    // ---- pilot ----
    console.log('\nA pilot’s own page');
    page = await open('crew-pilot.html', { role: 'pilot', probation: { enabled: true, required: 2, pick: 'random', days: 7, mine: { memberId: 'm1', assigned: true, required: 2, done: 1, complete: false, dueAt: DUE, routes: [{ ...ROUTES[0], flown: true }, ROUTES[1]] } } });
    await page.waitForTimeout(500);
    check('the card is up', await page.isVisible('#probationCard'));
    check('…naming both routes', /TV1/.test(await page.textContent('#probationCard')) && /TV2/.test(await page.textContent('#probationCard')));
    check('…how many are flown', /1 of 2 flown/.test(await page.textContent('#probationCard')));
    await page.close();
    page = await open('crew-pilot.html', { role: 'pilot', probation: { enabled: true, required: 2, pick: 'random', days: 7, mine: { memberId: 'm1', assigned: true, required: 2, done: 2, complete: true, dueAt: DUE, routes: [] } } });
    await page.waitForTimeout(500);
    check('through probation, there is no card', !(await page.isVisible('#probationCard')));
    await page.close();
    page = await open('crew-pilot.html', { role: 'pilot', probation: { enabled: true, required: 3, pick: 'staff', days: 7, mine: { memberId: 'm1', assigned: false } } });
    await page.waitForTimeout(500);
    check('waiting on staff, the pilot is told so', /Your staff will choose 3 routes/.test(await page.textContent('#probationCard')));
    await page.close();

    await browser.close(); server.close();
    console.log(failures ? `\n${failures} failed\n` : '\nAll good.\n');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
