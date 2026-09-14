// test-crew-tour.js
// The walk around the crew centre, driven the way a first-time reader drives it.
//
// WHAT MATTERS HERE is not that a tour exists — it is that it never gets in the
// way. The three ways a guided tour goes wrong in production are all asserted:
//
//   1. it runs a second time on somebody who has already seen it;
//   2. it spotlights something that is not on the page, because what a crew
//      centre shows depends on permissions and on what the VA has set up;
//   3. it opens over a dialog the reader has to answer first — the pilot's
//      change-your-password form, or the terms prompt — leaving a dark page
//      and no way to tell why.
//
// Run:  node tools/test-crew-tour.js
// Needs: playwright-core and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
//        pre-installed /opt/pw-browsers/chromium).
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TAILWIND = fs.readFileSync(path.join(__dirname, 'crew-tailwind.css'), 'utf8');

const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('');
    }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    fs.createReadStream(file).pipe(res);
});

let failures = 0;
const check = (label, ok, extra) => {
    if (ok) { console.log('  ✓ ' + label); return; }
    failures++;
    console.log(`  ✗ ${label}${extra ? '\n      ' + extra : ''}`);
};

let state = null;
const fresh = (over) => Object.assign({ role: 'owner', mustChangePassword: false }, over || {});

function api(route) {
    const p = new URL(route.request().url()).pathname;
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('/api/va-ads/by-slug/')) {
        return json({ name: 'Test VA', code: 'TST', slug: 'testva', accent: '#14375E', ranks: [], roles: [], fleet: [], join: {} });
    }
    if (p.endsWith('/me')) {
        // mustChangePassword is what actually raises the pilot's password
        // gate — the stored session only paints it before this lands.
        return json({
            role: state.role || 'owner', caps: [], capabilities: [], rolePresets: [],
            staffRoles: [], staffAssignments: [],
            mustChangePassword: !!state.mustChangePassword, canChangePassword: true,
        });
    }
    if (p.endsWith('/me/flying')) return json({ hours: 214, flights: 96, rank: { name: 'First Officer' }, pending: 0, logbook: [] });
    if (p.endsWith('/stats')) return json({ ok: true, connected: true, stats: { pilots: 12, hours: 400 } });
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: true });
    return json({});
}

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });

    const open = async (which, { session = {}, seen = null } = {}) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/**', api);
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({
            contentType: 'text/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});`,
        }));
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.addInitScript(([s, mark]) => {
            localStorage.setItem('crew:session:testva', JSON.stringify(Object.assign({ token: 'tok', name: 'Jordan Lee', role: 'owner' }, s)));
            if (mark) localStorage.setItem(mark[0], mark[1]);
        }, [session, seen]);
        await page.goto(`http://127.0.0.1:${port}/${which}?va=testva`);
        // The tour is offered a beat after boot, on purpose — see crewTour.js.
        await page.waitForTimeout(2200);
        return { page, errors };
    };

    const card = (page) => page.evaluate(() => {
        const el = document.querySelector('.ctour-card');
        if (!el) return null;
        return {
            step: (el.querySelector('.ctour-step') || {}).textContent || '',
            title: (el.querySelector('.ctour-title') || {}).textContent || '',
            body: (el.querySelector('.ctour-body') || {}).textContent || '',
            buttons: [...el.querySelectorAll('.ctour-btn')].map((b) => b.textContent.trim()),
        };
    });

    /* ==================================================================
     * 1. AN OWNER'S FIRST VISIT
     * ================================================================ */
    console.log('\nAn owner, arriving for the first time');
    state = fresh();
    {
        const { page, errors } = await open('crew-dashboard.html');
        const first = await card(page);
        check('the walk is offered', !!first, 'no tour card on the page');
        check('and opens on a welcome that names the airline',
            !!first && /Test VA/.test(first.title), first ? first.title : '');
        check('it says how long it is', !!first && /Step 1 of \d+/.test(first.step), first ? first.step : '');
        check('leaving is offered as plainly as continuing',
            !!first && first.buttons.indexOf('Skip') > -1 && first.buttons.indexOf('Next') > -1,
            first ? first.buttons.join(', ') : '');

        /* THE SPOTLIGHT IS ON SOMETHING. A hole cut over nothing is the
           failure this is really guarding: it looks like a tour and teaches
           nobody anything. Stepping forward must land it on a real element. */
        await page.locator('.ctour-btn--go').click();
        await page.waitForTimeout(700);
        const lit = await page.evaluate(() => {
            const hole = document.querySelector('.ctour-hole');
            if (!hole) return null;
            const r = hole.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { w: Math.round(r.width), h: Math.round(r.height), on: el ? (el.id || el.className || el.tagName) : null };
        });
        check('the second step lights up something real',
            !!lit && lit.w > 40 && lit.h > 20 && !!lit.on,
            lit ? `${lit.w}×${lit.h} over ${lit.on}` : 'no spotlight');

        // Escape is the way out that costs nothing to discover.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        check('Escape ends it', (await card(page)) === null);
        check('and takes the overlay with it',
            (await page.locator('.ctour-mask').count()) === 0);
        check('nothing threw', errors.length === 0, errors[0]);
        await page.close();
    }

    /* ==================================================================
     * 2. THE SECOND VISIT
     * ================================================================ */
    console.log('\nThe same owner, the next day');
    state = fresh();
    {
        const { page, errors } = await open('crew-dashboard.html', { seen: ['crew:tour:staff:testva', '1'] });
        check('the walk is not offered again', (await card(page)) === null);

        // …but it is still there to ask for, which is the whole reason the
        // steps are registered on a visit that does not show them.
        await page.evaluate(() => window.CrewTour.replay('staff'));
        await page.waitForTimeout(400);
        check('and Show me around still runs it', !!(await card(page)));
        check('nothing threw', errors.length === 0, errors[0]);
        await page.close();
    }

    /* ==================================================================
     * 3. A PILOT WITH A DOOR TO GET THROUGH FIRST
     * ================================================================ */
    console.log('\nA pilot who must change their password first');
    state = fresh({ role: 'pilot', mustChangePassword: true });
    {
        const { page, errors } = await open('crew-pilot.html', { session: { role: 'pilot', mustChangePassword: true } });
        const gateUp = await page.evaluate(() => {
            const el = document.getElementById('pwGate');
            return !!el && !el.classList.contains('hidden');
        });
        check('the password form is the thing on screen', gateUp);
        check('and the walk waits rather than opening behind it', (await card(page)) === null);

        // Clearing the gate is what releases it — watched, not timed.
        await page.evaluate(() => document.getElementById('pwGate').classList.add('hidden'));
        await page.waitForTimeout(1200);
        check('once the door is clear, the walk is offered', !!(await card(page)));
        check('nothing threw', errors.length === 0, errors[0]);
        await page.close();
    }

    /* ==================================================================
     * 4. A PILOT ARRIVING WITH NOTHING IN THE WAY
     * ================================================================ */
    console.log('\nA pilot, arriving for the first time');
    state = fresh({ role: 'pilot' });
    {
        const { page, errors } = await open('crew-pilot.html', { session: { role: 'pilot' } });
        const first = await card(page);
        check('the walk is offered', !!first);
        check('and greets them by name', !!first && /Jordan/.test(first.title), first ? first.title : '');

        /* EVERY STEP LANDS ON SOMETHING. Walked end to end rather than
           sampled: a tour is only as good as its worst step, and the steps
           that break are the ones pointing at a section this VA has not
           filled in. */
        let steps = 0, blind = 0;
        for (let i = 0; i < 12; i++) {
            const shown = await card(page);
            if (!shown) break;
            steps++;
            const hole = await page.evaluate(() => {
                const h = document.querySelector('.ctour-hole');
                if (!h || getComputedStyle(h).opacity === '0') return 'centred';
                const r = h.getBoundingClientRect();
                return (r.width > 20 && r.height > 12) ? 'on something' : 'nothing';
            });
            if (hole === 'nothing') blind++;
            const next = page.locator('.ctour-btn--go');
            if (await next.count() === 0) break;
            await next.click();
            await page.waitForTimeout(600);
        }
        check('every step is either centred or on a real element', blind === 0, blind + ' step(s) lit up nothing');
        check('the walk is short enough to finish', steps >= 3 && steps <= 8, steps + ' steps');

        await page.locator('.ctour-btn').last().click();
        await page.waitForTimeout(300);
        check('finishing closes it', (await card(page)) === null);
        const mark = await page.evaluate(() => localStorage.getItem('crew:tour:pilot:testva'));
        check('and is remembered, so it does not open again tomorrow', mark === '1', 'stored: ' + mark);
        check('nothing threw', errors.length === 0, errors[0]);
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
