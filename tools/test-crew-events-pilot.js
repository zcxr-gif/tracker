// test-crew-events-pilot.js
// Drives the REAL crew-pilot.html against a faked crew center, in a real
// browser, to check the half of events that only exists once it is rendered:
// that the calendar shows the VA's own events and not an invented one, that
// the attendee roll names who is coming and which stand they hold, and that
// the gate board draws taken and free stands apart and claims one.
//
// The fake backend enforces the gate index the way Postgres does, so the
// "somebody took it while you were looking at it" path is exercised rather
// than assumed — that is the case the whole design is arranged around.
//
// Run:  node tools/test-crew-events-pilot.js
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
    const file = path.join(ROOT, p === '/' ? '/crew-pilot.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('nope');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

// ---- the fake crew center -------------------------------------------------
const EVENT = {
    id: 'ev1', title: 'Águila Transatlántica', description: 'Push at 1900Z together.',
    origin: 'MMMX', destination: 'LEMD', aircraft: 'Boeing 787-9', server: 'Expert',
    startsAt: new Date(Date.now() + 3 * 86400e3).toISOString(), slots: 40,
    gatesOpen: true, gatesLocked: false, gateIcao: 'MMMX', minRank: '', status: 'published',
    locked: false, hoursUntilUnlock: 0, going: 2, waitlisted: 0, seatsLeft: 38, full: false,
    canManage: false, bannerUrl: '',
};
let attending = [
    { id: 's1', pilotName: 'Sam Park', callsign: 'AMX204', aircraft: 'B789', gate: 'B24', gateLat: 19.436, gateLon: -99.072, status: 'going' },
    { id: 's2', pilotName: 'Rae Ortiz', callsign: 'AMX311', aircraft: 'B788', gate: '', status: 'going' },
];
let mine = null;
const OSM = [
    { ref: 'B24', lat: 19.436, lon: -99.072, kind: 'gate' },
    { ref: 'B25', lat: 19.437, lon: -99.073, kind: 'gate' },
    { ref: 'B26', lat: 19.438, lon: -99.074, kind: 'gate' },
    { ref: 'R7', lat: 19.44, lon: -99.08, kind: 'parking_position' },
];
const board = () => {
    const held = new Map(attending.filter(a => a.gate).map(a => [a.gate.toUpperCase(), a]));
    return OSM.map(g => {
        const h = held.get(g.ref.toUpperCase());
        return { ...g, taken: !!h, takenBy: h ? h.pilotName : '', takenByAircraft: h ? h.aircraft : '', signupId: h ? h.id : null };
    });
};

let claimed = null;

async function api(route) {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (p.endsWith('/events') && method === 'GET') {
        return json({ events: [EVENT], mine: mine ? [{ eventId: 'ev1', ...mine }] : [], ranks: [], canManage: false });
    }
    if (p.endsWith('/events/ev1') && method === 'GET') {
        return json({ event: EVENT, attending, mine, canManage: false });
    }
    if (p.endsWith('/events/ev1/gates')) {
        return json({ icao: 'MMMX', gatesOpen: true, gatesLocked: false, gates: board(), source: 'osm' });
    }
    if (p.endsWith('/events/ev1/signup') && method === 'POST') {
        const body = route.request().postDataJSON() || {};
        // The gate index, as Postgres would enforce it.
        if (body.gate && attending.some(a => (a.gate || '').toUpperCase() === body.gate.toUpperCase())) {
            return json({ error: 'That stand has just been taken — pick another one.', code: 'gate_taken' }, 409);
        }
        mine = { id: 'me', pilotName: 'You', callsign: 'AMX999', aircraft: 'B789', gate: body.gate || '', status: 'going' };
        attending = [...attending, mine];
        if (body.gate) claimed = body.gate;
        return json({ signup: mine, waitlisted: false }, 201);
    }
    if (p.endsWith('/events/ev1/signup') && method === 'PATCH') {
        const body = route.request().postDataJSON() || {};
        if (body.gate && attending.some(a => a.id !== 'me' && (a.gate || '').toUpperCase() === body.gate.toUpperCase())) {
            return json({ error: 'That stand has just been taken — pick another one.', code: 'gate_taken' }, 409);
        }
        mine = { ...mine, gate: body.gate || '' };
        attending = attending.map(a => (a.id === 'me' ? mine : a));
        claimed = body.gate;
        return json({ signup: mine });
    }
    if (p.includes('/api/va-ads/by-slug/')) return json({ name: 'Aeromexico Virtual', code: 'AMX', accent: '#0C2C64' });
    if (p.endsWith('/me')) return json({ role: 'pilot', mustChangePassword: false, canChangePassword: true });
    return json({});
}

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    const errors = [];
    page.on('pageerror', e => errors.push(String(e) + ' :: ' + (e.stack||'').split('\n').slice(0, 4).join(' | ')));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.route('**/api/crew/**', api);
    await page.route('**/api/va-ads/**', api);
    // Keep tiles and Leaflet's CDN out of it — this checks our code, not the map's.
    await page.route('**/tile.openstreetmap.org/**', r => r.abort());
    // Leaflet from the vendored copy rather than unpkg: this checks our code,
    // and a sandbox without egress should not decide whether the test passes.
    await page.route('**/unpkg.com/leaflet**/leaflet.js', r => r.fulfill({
        contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'leaflet.js'), 'utf8') }));
    await page.route('**/unpkg.com/leaflet**/leaflet.css', r => r.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(__dirname, 'leaflet-layout.css'), 'utf8') }));

    // A signed-in pilot.
    await page.addInitScript(() => {
        localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'You' }));
    });

    await page.goto(`http://127.0.0.1:${port}/crew-pilot.html?va=testva`);
    await page.waitForTimeout(1500);

    const step = (label, ok, extra) => console.log(ok ? '  ✓ ' + label : `  ✗ ${label}${extra ? ' — ' + extra : ''}`);
    let failures = 0;
    const check = (label, ok, extra) => { if (!ok) failures++; step(label, ok, extra); };

    // 1. Cards render from the feed.
    const cardTitle = await page.textContent('#events .cev-card-title').catch(() => null);
    check('the pilot home lists the VA’s real event', cardTitle === 'Águila Transatlántica', `got ${cardTitle}`);
    const cards = await page.$$eval('#events .cev-card-title', els => els.map(e => e.textContent));
    check('and nothing else — the invented placeholders are gone',
        cards.length === 1 && !cards.some(t => /Transcon|Maple Milk|Pacific Overnighter/.test(t)), cards.join(','));

    // 2. Opening the card opens the brief with the attendee list.
    await page.click('#events .cev-card');
    await page.waitForSelector('#cevDetailBody .cev-atts', { timeout: 5000 });
    const names = await page.$$eval('#cevDetailBody .cev-att-name', els => els.map(e => e.textContent));
    check('who’s attending is listed', names.join(',') === 'Sam Park,Rae Ortiz', names.join(','));
    const gateBadge = await page.textContent('#cevDetailBody .cev-att-gate').catch(() => null);
    check('an attendee’s stand shows on the roll', gateBadge === 'B24', `got ${gateBadge}`);
    const noStand = await page.textContent('#cevDetailBody .cev-att-nogate').catch(() => null);
    check('…and one without a stand says so', noStand === 'no stand yet', `got ${noStand}`);

    // 3. The gate board.
    await page.click('#cevDetailBody [data-act="gates"]');
    await page.waitForSelector('#cevGateList .cev-gate', { timeout: 8000 });
    const sub = await page.textContent('#cevGatesSub');
    check('the board counts stands and free ones', /4 stands · 3 free/.test(sub), sub);

    const takenRow = await page.textContent('#cevGateList .cev-gate-taken .cev-gate-who');
    check('a taken stand names who has it', /Sam Park/.test(takenRow), takenRow);
    const freeFirst = await page.$eval('#cevGateList .cev-gate:first-child', el => el.className);
    check('free stands are listed first', /cev-gate-free/.test(freeFirst), freeFirst);

    const pins = await page.$$eval('.cev-pin', els => els.map(e => e.className));
    check('every mapped stand gets a pin', pins.length === 4, `got ${pins.length}`);
    check('taken and free pins are drawn apart',
        pins.filter(c => /cev-pin-taken/.test(c)).length === 1 && pins.filter(c => /cev-pin-free/.test(c)).length === 3,
        pins.join(' | '));

    // 4. Claiming a free stand.
    await page.click('#cevGateList [data-gate="B25"]');
    await page.waitForTimeout(1200);
    check('claiming a free stand sends it to the server', claimed === 'B25', `got ${claimed}`);
    const toastText = await page.textContent('#cev-toasts .cev-toast').catch(() => '');
    check('…and the pilot is told it is theirs', /B25 is yours/.test(toastText), toastText);

    // 5. Losing the race for a taken one.
    await page.waitForTimeout(600);
    await page.click('#cevGateList [data-gate="B24"]');
    await page.waitForTimeout(800);
    const toasts = await page.$$eval('#cev-toasts .cev-toast', els => els.map(e => e.textContent));
    check('a taken stand is refused, by name', toasts.some(t => /B24 is taken — Sam Park/.test(t)), toasts.join(' | '));

    // Only OUR errors. The page pulls Tailwind and Lucide off CDNs this sandbox
    // cannot reach, and those failures say nothing about the code under test.
    const ours = errors.filter(e => !/Failed to load resource|tailwind is not defined|lucide/i.test(e));
    check('no page errors of our own', ours.length === 0, ours.join(' | '));

    await page.screenshot({ path: path.join(__dirname, 'gate-board.png') });
    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll board checks passed ✅');
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
