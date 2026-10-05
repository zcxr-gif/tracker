// test-crew-featured.js
// Drives the REAL crew-pilot.html and crew-dashboard.html to prove what the
// Route of the Week / of the Day became:
//
//   * the week is a board of up to seven legs — a codeshare leg wearing its
//     partner's logo, the bonus legs saying what they pay, and the whole thing
//     open to every rank
//   * a pilot can file a flight AS the Route of the Week (the leg fills the
//     form in), the Route of the Day, or an event
//   * staff get a Route of the Week tile that opens the planner, where they
//     add legs from the network and release them — and pilots never get the
//     planner
//
// Run:  node tools/test-crew-featured.js
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? '/crew-pilot.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

// A 1×1 PNG, so a logo URL is a real image the page can draw.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const LOGO = 'https://logos.example/borealis.png';

const leg = (n, o, d, extra) => ({
    id: `r${n}`, flightNumber: `AM${n}`, origin: o, destination: d, aircraft: 'Boeing 737-800', distanceNm: 400,
    active: true, kind: 'own', partnerName: '', minRank: 'Captain', locked: false, hoursUntilUnlock: 0,
    featured: 'week', logo: '', ...(extra || {}),
});
const LEGS = [
    leg(1, 'MMMX', 'KJFK'), leg(2, 'MMMX', 'LEMD'), leg(3, 'MMGL', 'KLAX'), leg(4, 'MMUN', 'MMMX'),
    leg(5, 'MMMX', 'SCEL'), leg(6, 'MMMX', 'RJAA'),
    leg(9, 'CYYZ', 'MMMX', { kind: 'codeshare', partnerName: 'Borealis Virtual', logo: LOGO }),
];
const BONUS = [2, 1, 1, 1.5, 1, 1, 1.25];
const WEEK = () => ({
    period: 'week', periodKey: '2026-W41', source: 'auto', pinned: false, planned: false,
    route: LEGS[0], bonus: 2, estimatedMin: 285,
    legs: LEGS.map((r, i) => ({ route: r, bonus: BONUS[i], estimatedMin: 120 + i * 30 })),
});
const DAY = () => {
    const r = leg(8, 'MMMX', 'MPTO', { featured: 'day' });
    return { period: 'day', periodKey: '2026-10-06', source: 'auto', pinned: false, planned: false, route: r, bonus: 1, estimatedMin: 230, legs: [{ route: r, bonus: 1, estimatedMin: 230 }] };
};

let state;
const fresh = () => ({
    canManage: false,
    pireps: [],
    plans: [],
    planPosts: [],
});

function staffPayload() {
    const routes = [...LEGS, leg(8, 'MMMX', 'MPTO'), leg(10, 'MMMX', 'MMTJ')].map((r) => ({
        id: r.id, flightNumber: r.flightNumber, origin: r.origin, destination: r.destination, aircraft: r.aircraft,
        distanceNm: r.distanceNm, kind: r.kind, partnerName: r.partnerName, logo: r.logo, estimatedMin: 150,
    }));
    const keys = (n, step) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, startsAt: new Date(Date.UTC(2026, 9, 5) + i * step).toISOString() }));
    return {
        week: WEEK(), day: DAY(), canManage: true, network: 9, currency: { name: 'Miles', short: 'mi' },
        plans: state.plans, upcoming: { week: keys(9, 7 * 864e5), day: keys(32, 864e5) },
        maxLegs: { week: 7, day: 1 }, bonusSteps: [1.25, 1.5, 2], autoPost: true, webhook: true, routes,
    };
}

function api(r) {
    const url = new URL(r.request().url());
    const p = url.pathname;
    const method = r.request().method();
    const json = (b, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.endsWith('/suggestions')) {
        return json({ suggestions: [], profile: null, week: WEEK(), day: DAY(), network: 9,
            canManage: state.canManage, currency: { name: 'Miles', short: 'mi' } });
    }
    if (p.endsWith('/featured-routes/plans') && method === 'POST') {
        const body = r.request().postDataJSON() || {};
        state.planPosts.push(body);
        state.plans = [{ id: 'p1', period: body.period, periodKey: body.periodKey, status: body.release ? 'released' : 'draft',
            title: body.title || '', note: body.note || '', legs: body.legs.map((l) => ({ ...l })), releasedBy: 'Owner' }];
        return json({ ...staffPayload(), planId: 'p1', posted: !!body.release }, 201);
    }
    if (p.endsWith('/featured-routes') && method === 'GET') {
        return json(state.canManage ? staffPayload() : { week: WEEK(), day: DAY(), canManage: false, network: 9, currency: { name: 'Miles', short: 'mi' } });
    }
    if (p.endsWith('/events') && method === 'GET') {
        return json({ events: [{ id: 'e1', title: 'Friday fly-in', startsAt: '2026-10-09T19:00:00Z', status: 'published', origin: 'MMMX', destination: 'MMUN' }],
            canManage: false, mine: [], ranks: [] });
    }
    if (p.endsWith('/pireps') && method === 'POST') {
        const body = r.request().postDataJSON() || {};
        state.pireps.push(body);
        return json({ pirep: { id: 'x', ...body }, routeMatched: true }, 201);
    }
    if (p.endsWith('/me/flying')) {
        return json({ pilot: { memberId: 'm1', name: 'Rae Okafor', callsign: 'AM101', hours: 3, status: 'active' },
            rank: { name: 'Cadet', minHours: 0, next: null }, flights: [],
            totals: { flights: 0, pending: 0, rejected: 0, minutes: 0, minutes30d: 0, flights30d: 0, lastFlightAt: null } });
    }
    if (p.endsWith('/me')) {
        return json(state.canManage
            ? { role: 'owner', caps: [], capabilities: [], name: 'Owner' }
            : { role: 'pilot', name: 'Rae Okafor', mustChangePassword: false });
    }
    if (p.endsWith('/branding')) return json({ name: 'Aeroméxico Virtual', code: 'AM', layout: 'editorial', allowedLayouts: ['editorial'] });
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: false });
    if (p.endsWith('/schedules')) return json({ schedules: [], mine: [], canManage: false, rules: { enabled: true }, ranks: [] });
    if (p.endsWith('/routes')) return json({ routes: LEGS, counts: { own: 6, codeshare: 1, locked: 0 } });
    return json({});
}

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${extra ? `  (${extra})` : ''}`); fail++; }
};
const head = (s) => console.log(`\n${s}`);

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
    const errors = [];

    const open = async (pageName, slug, role) => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
        await page.route('**/api/**', api);
        await page.route('https://site--acars-backend**', (r) => r.abort());
        await page.route('https://logos.example/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
        await page.addInitScript(([s, who]) => {
            localStorage.setItem('crew:session:' + s, JSON.stringify({ token: 'tok', name: who === 'owner' ? 'Owner' : 'Rae Okafor', role: who, slug: s }));
            localStorage.setItem('crew:tour:pilot:' + s, '99');
            localStorage.setItem('crew:tour:staff:' + s, '99');
        }, [slug, role]);
        await page.goto(`http://127.0.0.1:${port}/${pageName}?va=${slug}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        return { ctx, page };
    };

    // ==================================================================
    head('The week is a board of seven, open to every rank');
    state = fresh();
    let { ctx, page } = await open('crew-pilot.html', 'am', 'pilot');
    await page.waitForSelector('#suggestStrip .sg-leg', { timeout: 6000 }).catch(() => {});
    const strip = await page.innerText('#suggestStrip').catch(() => '');
    ok('all seven legs are on the pilot’s home', (await page.locator('#suggestStrip .sg-leg').count()) === 7, strip.slice(0, 200));
    ok('…and the day’s leg beside them', /MPTO/.test(strip));
    ok('the codeshare leg wears its partner’s logo',
        (await page.locator(`#suggestStrip .sg-leg img.sg-leg-logo[src="${LOGO}"]`).count()) === 1);
    ok('…and names the partner', /Borealis Virtual/.test(strip));
    ok('bonus legs say what they pay, in the airline’s currency', /2× mi/.test(strip) && /1\.5× mi/.test(strip), strip.match(/\d(\.\d+)?× \w+/g));
    ok('the block time is on every leg', (strip.match(/\dh \d\dm|\b\d+m\b/g) || []).length >= 7);
    ok('it says every rank can fly them', /open to every rank/i.test(strip));
    ok('a pilot is not offered the planner', (await page.locator('#suggestStrip [data-sg-plan]').count()) === 0);
    if (process.env.SHOT_DIR) await page.locator('#suggestStrip').screenshot({ path: path.join(process.env.SHOT_DIR, 'strip.png') });

    // ==================================================================
    head('Filing a flight as the Route of the Week');
    await page.evaluate(() => openFilePirepManual());
    await page.waitForSelector('#pfFlownAs [data-fa-kind]', { timeout: 6000 }).catch(() => {});
    const kinds = await page.$$eval('#pfFlownAs [data-fa-kind] option', (els) => els.map((e) => e.value));
    ok('the form asks what it was flown as', kinds.join(',') === ',week,day,event', kinds.join(','));
    await page.selectOption('#pfFlownAs [data-fa-kind]', 'week');
    await page.selectOption('#pfFlownAs [data-fa-pick="week"]', 'r9');
    await page.waitForTimeout(150);
    ok('picking a leg fills the airports in',
        (await page.inputValue('#pfFrom')) === 'CYYZ' && (await page.inputValue('#pfTo')) === 'MMMX',
        `${await page.inputValue('#pfFrom')} → ${await page.inputValue('#pfTo')}`);
    ok('…and the aircraft', (await page.inputValue('#pfAircraft')) === 'Boeing 737-800');
    const options = await page.$$eval('#pfFlownAs [data-fa-pick="week"] option', (els) => els.map((e) => e.textContent));
    ok('the legs are listed with their bonus', options.some((t) => /2× pay/.test(t)), options.join(' / '));
    await page.fill('#pfHours', '5');
    await page.click('#pfSubmit');
    await page.waitForTimeout(500);
    const filed = state.pireps[0] || {};
    ok('the report goes up AS the Route of the Week, naming the leg',
        filed.featured === 'week' && filed.routeId === 'r9' && filed.origin === 'CYYZ', JSON.stringify(filed));

    await page.evaluate(() => openFilePirepManual());
    await page.waitForSelector('#pfFlownAs [data-fa-kind]', { timeout: 6000 }).catch(() => {});
    await page.selectOption('#pfFlownAs [data-fa-kind]', 'event');
    ok('an event is offered by name', /Friday fly-in/.test(await page.innerText('#pfFlownAs')));
    await page.fill('#pfFrom', 'MMMX'); await page.fill('#pfTo', 'MMUN'); await page.fill('#pfHours', '2');
    await page.click('#pfSubmit');
    await page.waitForTimeout(500);
    const ev = state.pireps[1] || {};
    ok('…and filed against it', ev.eventId === 'e1' && !ev.featured, JSON.stringify(ev));

    await page.evaluate(() => openFilePirepManual());
    await page.waitForSelector('#pfFlownAs [data-fa-kind]', { timeout: 6000 }).catch(() => {});
    await page.fill('#pfFrom', 'MMMX'); await page.fill('#pfTo', 'MMTJ'); await page.fill('#pfHours', '1');
    await page.click('#pfSubmit');
    await page.waitForTimeout(500);
    const plain = state.pireps[2] || {};
    ok('a regular flight claims nothing', !plain.featured && !plain.eventId && !plain.routeId, JSON.stringify(plain));
    await ctx.close();

    // ==================================================================
    head('Staff plan the week and release it');
    state = fresh();
    state.canManage = true;
    ({ ctx, page } = await open('crew-dashboard.html', 'am', 'owner'));
    const tiles = await page.$$eval('#toolGrid .font-semibold', (els) => els.map((e) => e.textContent.trim()));
    ok('there is a Route of the Week tile', tiles.includes('Route of the Week'), tiles.join(' / '));
    await page.evaluate(() => document.querySelector('#toolGrid [data-action="featured"]').click());
    await page.waitForSelector('#crewFeaturedPlanner [data-fp2-key]', { timeout: 6000 }).catch(() => {});
    const planner = await page.innerText('#crewFeaturedPlanner').catch(() => '');
    ok('the planner opens on this week', /This week/.test(planner), planner.slice(0, 200));
    ok('…showing what the rotation picked', /Nothing planned/.test(planner) && /Customise these/.test(planner));
    ok('…and offers the codeshares to pick from, logo and all',
        (await page.locator(`#crewFeaturedPlanner [data-fp2-add] img[src="${LOGO}"]`).count()) === 1);

    await page.fill('#crewFeaturedPlanner [data-fp2-q]', 'KJFK');
    await page.waitForTimeout(150);
    ok('search narrows the network', (await page.locator('#crewFeaturedPlanner [data-fp2-add]').count()) === 1);
    await page.click('#crewFeaturedPlanner [data-fp2-add]');
    await page.fill('#crewFeaturedPlanner [data-fp2-q]', 'Borealis');
    await page.waitForTimeout(150);
    await page.click('#crewFeaturedPlanner [data-fp2-add]');
    await page.waitForTimeout(150);
    ok('legs go onto the plan', (await page.locator('#crewFeaturedPlanner .fp2-leg select[data-fp2-bonus]').count()) === 2);
    await page.selectOption('#crewFeaturedPlanner [data-fp2-bonus="1"]', '2');
    await page.fill('#crewFeaturedPlanner [data-fp2-title]', 'Ruta de la semana');
    await page.click('#crewFeaturedPlanner [data-fp2-release]');
    await page.waitForTimeout(600);
    const sent = state.planPosts[0] || {};
    ok('releasing sends the legs, in order, with the bonus set',
        sent.release === true && sent.period === 'week'
        && JSON.stringify(sent.legs) === JSON.stringify([{ routeId: 'r1', bonus: 1 }, { routeId: 'r9', bonus: 2 }]), JSON.stringify(sent));
    ok('…and the headline', sent.title === 'Ruta de la semana');
    ok('the planner says it is live', /Released/.test(await page.innerText('#crewFeaturedPlanner')));
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, 'planner.png') });
    ok('Discord can be posted to by hand', (await page.locator('#crewFeaturedPlanner [data-fp2-post="week"]:not([disabled])').count()) === 1);
    await ctx.close();

    head('Nothing threw on the way');
    ok('no page errors', errors.length === 0, errors.join(' | '));

    await browser.close();
    server.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
