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
    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll staff checks passed ✅');
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
