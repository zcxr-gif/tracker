// test-crew-multipliers.js
// Temporary multipliers on events and routes, through the REAL pages against a
// faked backend:
//
//   * staff see live, upcoming and finished ones, named by their event or route
//   * picking an event fills in its own window; saving sends exactly that
//   * "End now" ends a live one rather than deleting it
//   * a pilot sees what is boosted now and next, and nothing that has ended
//
// Run:  node tools/test-crew-multipliers.js
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

let failures = 0;
const check = (label, ok, extra) => {
    if (!ok) { failures++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); } else console.log('  ✓ ' + label);
};
const DAY = 864e5;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const ROUTES = [{ id: 'r1', flightNumber: 'AU117', origin: 'EGLL', destination: 'KJFK', kind: 'own', active: true }];
const EVENTS = [{ id: 'ev1', title: 'Christmas Flyout', startsAt: iso(3 * DAY), endsAt: iso(3 * DAY + 4 * 3600e3) }];
const LIST = [
    { id: 'mx1', kind: 'route', targetId: 'r1', factor: 1.5, label: 'Hub week', startsAt: iso(-DAY), endsAt: iso(2 * DAY) },
    { id: 'mx2', kind: 'route', targetId: 'r1', factor: 2, label: '', startsAt: iso(-10 * DAY), endsAt: iso(-5 * DAY) },
];

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });
    const open = async (file, { staff, sent }) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        page.on('pageerror', (e) => { failures++; console.log('  ✗ page error — ' + String(e).split('\n')[0]); });
        await page.route('**/cdn.tailwindcss.com**', (r) => r.fulfill({ contentType: 'application/javascript', body: TW }));
        await page.route('**/unpkg.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
        let stored = LIST.slice();
        await page.route('**/api/**', (route) => {
            const req = route.request();
            const p = new URL(req.url()).pathname;
            const m = req.method();
            const json = (x, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
            const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch { return {}; } };
            if (m !== 'GET') sent.push({ m, p, body: body() });
            if (p.endsWith('/multipliers') && m === 'PUT') { stored = body().multipliers.map((x, i) => ({ id: x.id || `new${i}`, ...x })); return json({ multipliers: stored }); }
            if (p.endsWith('/multipliers')) {
                const now = Date.now();
                return json(staff ? { multipliers: stored, canManage: { route: true, event: true }, min: 1.1, max: 5 }
                    : { multipliers: stored.filter((x) => new Date(x.endsAt) > now), canManage: { route: false, event: false } });
            }
            if (p.endsWith('/routes')) return json({ routes: ROUTES, ranks: [], partners: [] });
            if (p.endsWith('/events')) return json({ events: EVENTS });
            if (p.endsWith('/me')) return json({ role: staff ? 'owner' : 'pilot', caps: staff ? ['*'] : [], capabilities: [], rolePresets: [], staffRoles: [], staffAssignments: [] });
            if (p.endsWith('/roster')) return json({ roster: [] });
            return json({});
        });
        await page.addInitScript(([r]) => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: r }));
            localStorage.setItem('crew:tour:staff:testva', '1');
            localStorage.setItem('crew:tour:pilot:testva', '1');
        }, [staff ? 'owner' : 'pilot']);
        await page.goto(`http://127.0.0.1:${port}/${file}?va=testva`);
        await page.waitForTimeout(1500);
        await page.evaluate(() => document.querySelectorAll('.ctour-mask, .ctour-pop, .ctour').forEach((e) => e.remove()));
        return page;
    };

    console.log('\nStaff');
    const sent = [];
    let page = await open('crew-dashboard.html', { staff: true, sent });
    await page.evaluate(() => openMultipliers());
    await page.waitForSelector('#crewMultipliers [data-mx-id="mx1"]');
    const panel = () => page.textContent('#crewMultipliers');
    check('a live one is listed under “Live now”, named by its route', /Live now/.test(await panel()) && /AU117/.test(await panel()) && /Hub week/.test(await panel()));
    check('…and an ended one under “Finished”', /Finished/.test(await panel()) && !!(await page.$('#crewMultipliers .mx-ended[data-mx-id="mx2"]')));
    await page.click('#crewMultipliers [data-mx-new]');
    await page.selectOption('#crewMultipliers [data-mx-f="kind"]', 'event');
    await page.waitForTimeout(100);
    await page.selectOption('#crewMultipliers [data-mx-f="targetId"]', 'ev1');
    await page.waitForTimeout(100);
    await page.fill('#crewMultipliers [data-mx-f="factor"]', '2');
    await page.fill('#crewMultipliers [data-mx-f="label"]', 'Christmas double');
    await page.click('#crewMultipliers [data-mx-save]');
    await page.waitForTimeout(300);
    const put = sent.filter((s) => s.m === 'PUT').pop();
    const added = put && put.body.multipliers.find((x) => x.targetId === 'ev1');
    check('saving sends the new one on the event', added && added.kind === 'event' && Number(added.factor) === 2 && added.label === 'Christmas double', JSON.stringify(added));
    check('…over the event’s own window', added && Math.abs(new Date(added.startsAt) - new Date(EVENTS[0].startsAt)) < 60e3 && Math.abs(new Date(added.endsAt) - new Date(EVENTS[0].endsAt)) < 60e3);
    check('…keeping the others', put && put.body.multipliers.some((x) => x.id === 'mx1') && put.body.multipliers.some((x) => x.id === 'mx2'));
    await page.click('#crewMultipliers [data-mx-id="mx1"] [data-mx-del]');
    await page.waitForTimeout(300);
    const ended = sent.filter((s) => s.m === 'PUT').pop().body.multipliers.find((x) => x.id === 'mx1');
    check('“End now” ends a live one rather than deleting it', ended && new Date(ended.endsAt).getTime() <= Date.now() + 1000);
    await page.close();

    console.log('\nA pilot');
    page = await open('crew-pilot.html', { staff: false, sent: [] });
    await page.waitForTimeout(500);
    const strip = await page.textContent('#bonusStrip');
    check('the bonus card is up', await page.isVisible('#bonusStrip'));
    check('…naming the boosted route and its factor', /AU117/.test(strip) && /1\.5×/.test(strip));
    check('…and nothing that has ended', !/2×/.test(strip));
    await page.close();

    await browser.close(); server.close();
    console.log(failures ? `\n${failures} failed\n` : '\nAll good.\n');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
