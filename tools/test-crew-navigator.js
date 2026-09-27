// test-crew-navigator.js
// Drives the REAL crew-dashboard.html and crew-pilot.html to prove the crew
// center's THIRD interface, Navigator, is a different shape and not a coat of
// paint:
//
//   * a sidebar down the left names every topic the tiles would have, grouped,
//     and the page moves over to make room for it
//   * the tile wall is gone — the sidebar is the tile wall
//   * the overview is views shown one at a time, each with its own link
//   * a topic opens IN THE PANE, beside the sidebar and under the top bar, and
//     the sidebar lights it up; picking another closes the first
//   * the burger folds the sidebar to a rail on a computer (remembered), and
//     slides it in as a drawer on a phone
//   * what is waiting on staff (flight reports to review) is counted on the
//     row that leads to it — and on the tile, in the other two looks
//   * switching to another interface undoes all of it
//   * the pilot home gets the same shell, with its own views and actions
//
// Run:  node tools/test-crew-navigator.js
// Needs: playwright-core, and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
//        pre-installed /opt/pw-browsers/chromium).
// Writes screenshots to $SHOTS when that is set.
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? '/crew-dashboard.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

const TAILWIND = fs.readFileSync(path.join(__dirname, 'crew-tailwind.css'), 'utf8');
const CAPS = ['settings.branding', 'roster.manage', 'announcements.manage', 'routes.manage', 'schedules.manage',
    'flights.review', 'documents.manage', 'members.message', 'links.manage'];

let saved = [];
function api(route, role) {
    const p = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('/api/va-ads/by-slug/') || p.endsWith('/branding')) return json({ name: 'Test Virtual', code: 'TVA' });
    if (p.endsWith('/settings') && method === 'POST') { saved.push(route.request().postDataJSON() || {}); return json({ ok: true }); }
    if (p.endsWith('/me')) {
        return role === 'pilot'
            ? json({ role: 'pilot', name: 'Rae Okafor', mustChangePassword: false })
            : json({ role: 'owner', caps: CAPS, capabilities: CAPS.map((id) => ({ id, group: 'x', label: id })), rolePresets: [], staffRoles: [], staffAssignments: [] });
    }
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: role !== 'pilot' });
    if (p.endsWith('/stats')) return json({ ok: true, connected: true, stats: { pilots: 12, hours: 400, flights30d: 3, pireps: 9, pirepsApproved: 9, pirepsPending: 3 } });
    if (p.endsWith('/events')) return json({ events: [], canManage: false, mine: [], ranks: [] });
    if (p.endsWith('/schedules')) return json({ schedules: [], mine: [], canManage: false, rules: { enabled: true }, ranks: [] });
    if (p.endsWith('/me/pilot')) return json({ linkable: false, linked: false, pilot: null });
    return json({});
}

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    let failures = 0;
    const check = (label, ok, extra) => {
        if (!ok) { failures++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); } else console.log('  ✓ ' + label);
    };
    const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

    const open = async ({ file = 'crew-dashboard.html', role = 'owner', query = '&ui=navigator', width = 1366, height = 900, dark = false, before } = {}) => {
        const page = await browser.newPage({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light' });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/**', (r) => api(r, role));
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({
            contentType: 'text/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});`,
        }));
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.addInitScript(([r, d]) => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: r === 'pilot' ? 'Rae Okafor' : 'Owner', role: r }));
            localStorage.setItem('crew:tour:staff:testva', '99');
            localStorage.setItem('crew:tour:pilot:testva', '99');
            localStorage.setItem('crew-theme', d ? 'dark' : 'light');
        }, [role, dark]);
        if (before) await before(page);
        await page.goto(`http://127.0.0.1:${port}/${file}?va=testva${query}`);
        await page.waitForTimeout(1800);
        return { page, errors };
    };
    const box = (page, sel) => page.$eval(sel, (el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const visible = (page, sel) => page.$eval(sel, (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)).catch(() => false);
    const current = (page) => page.$$eval('#csbNav [aria-current="true"]', (els) => els.map((e) => e.getAttribute('data-csb-view') || e.getAttribute('data-csb-go')));

    // ---- 1. The staff dashboard on a computer -----------------------------
    console.log('\nThe staff dashboard, on a computer');
    {
        const { page, errors } = await open();
        check('the page is wearing Navigator', (await page.getAttribute('html', 'data-skin')) === 'navigator');
        const nav = await box(page, '#csbNav');
        check('a sidebar runs down the left edge', nav.x === 0 && nav.y === 0 && nav.h === 900 && nav.w > 200 && nav.w < 280, JSON.stringify(nav));
        const main = await box(page, 'main');
        check('…and the page has moved over for it', main.x >= nav.w, `main at ${main.x}, sidebar ${nav.w}`);
        const caps = await page.$$eval('#csbNav .csb-cap', (els) => els.map((e) => e.textContent.trim()));
        check('topics are grouped', caps[0] === 'Operations' && caps.includes('Crew') && caps.includes('Admin'), caps.join(', '));
        const ids = await page.$$eval('#csbNav [data-csb-go]', (els) => els.map((e) => e.getAttribute('data-csb-go')));
        check('…and it names what the tiles did', ['roster', 'routes', 'schedule', 'events', 'pireps', 'notices', 'settings'].every((i) => ids.includes(i)), ids.join(','));
        check('the tile wall is gone', !(await visible(page, '#toolGrid')));
        check('the burger is in the top bar', await visible(page, 'body > header .csb-burger'));
        check('the overview is the view that is lit', (await current(page)).join() === 'overview');
        check('flight reports waiting are counted on the Flights row',
            (await page.$eval('#csbNav [data-csb-go="pireps"] [data-todo]', (e) => e.textContent).catch(() => '')) === '3');
        check('…and nothing is counted where nothing waits',
            !(await visible(page, '#csbNav [data-csb-go="roster"] .csb-badge')));
        check('…and it is the overview on screen', (await visible(page, '.r-identity')) && !(await visible(page, '.r-live')));
        await shot(page, 'nav-dashboard');

        await page.click('#csbNav [data-csb-view="live"]');
        await page.waitForTimeout(250);
        check('a view shows only itself', (await visible(page, '.r-live')) && !(await visible(page, '.r-identity')));
        check('…lights up', (await current(page)).join() === 'live');
        check('…and has a link of its own', (await page.evaluate(() => location.hash)) === '#/live');
        const live = await box(page, '.r-live');
        check('the live map gets the pane, not a strip', live.h > 600, `h ${live.h}`);

        await page.click('#csbNav [data-csb-go="settings"]');
        await page.waitForTimeout(400);
        const panel = await box(page, '#settings');
        check('a topic opens in the pane — beside the sidebar', panel.x === nav.w, `x ${panel.x} vs ${nav.w}`);
        check('…and under the top bar', panel.y === 64, `y ${panel.y}`);
        const sheet = await box(page, '#settings > .panel');
        check('…using all of it, not a 28rem column', sheet.w >= 1366 - nav.w - 2, `w ${sheet.w}`);
        check('…with nothing dimmed behind it', !(await visible(page, '#settings > .ctw-scrim')));
        check('the sidebar lights the open topic', (await current(page)).join() === 'settings');
        check('the three looks are offered in Settings', (await page.$$('#uiOpts [data-skin-opt]')).length === 3);
        check('…Navigator drawn as a sidebar miniature', await visible(page, '#uiOpts .ifc-prev-navigator .ifc-side'));
        await shot(page, 'nav-dashboard-settings');

        await page.click('#csbNav [data-csb-go="roster"]');
        await page.waitForTimeout(400);
        check('picking another topic closes the first', !(await visible(page, '#settings > .panel')) || (await page.$eval('#settings', (e) => e.classList.contains('hidden'))));
        check('…and opens the second', (await current(page)).join() === 'roster');
        await shot(page, 'nav-dashboard-roster');

        await page.click('#csbNav [data-csb-view="overview"]');
        await page.waitForTimeout(300);
        check('going back to a view closes the topic', (await page.$eval('#roster', (e) => e.classList.contains('hidden'))));
        check('…and shows it', await visible(page, '.r-identity'));

        await page.click('body > header .csb-burger');
        await page.waitForTimeout(350);
        const rail = await box(page, '#csbNav');
        check('the burger folds the sidebar to a rail', rail.w < 80, `w ${rail.w}`);
        check('…the page follows it', (await box(page, 'main')).x < 200);
        check('…the labels go', !(await visible(page, '#csbNav .csb-label')));
        await shot(page, 'nav-dashboard-rail');
        check('…and it is remembered', (await page.evaluate(() => localStorage.getItem('crew:nav:collapsed:testva'))) === '1');
        await page.keyboard.press('[');
        await page.waitForTimeout(350);
        check('`[` unfolds it again', (await box(page, '#csbNav')).w > 200);

        await page.evaluate(() => CrewSkin.set('essential', { animate: false }));
        await page.waitForTimeout(300);
        check('switching look takes the sidebar away', !(await visible(page, '#csbNav')) && !(await visible(page, '.csb-burger')));
        check('…and hides nothing it hid', (await page.$$('.csb-off')).length === 0);
        check('…and the tiles are back', await visible(page, '#toolGrid'));
        check('…with the same count on the Flights tile',
            (await page.$eval('#toolGrid [data-todo="pireps"]', (e) => e.offsetWidth > 0 && e.textContent).catch(() => '')) === '3');
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 2. A link to a view ---------------------------------------------
    console.log('\nA link straight to a view');
    {
        const { page, errors } = await open({ query: '&ui=navigator#/live' });
        check('lands on that view', (await current(page)).join() === 'live' && (await visible(page, '.r-live')));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 3. Dark ----------------------------------------------------------
    console.log('\nIn the dark');
    {
        const { page, errors } = await open({ dark: true });
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        check('the page is dark', /rgb\((\d+), (\d+), (\d+)\)/.test(bg) && +RegExp.$1 < 40, bg);
        await shot(page, 'nav-dashboard-dark');
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 4. A phone -------------------------------------------------------
    console.log('\nOn a phone');
    {
        const { page, errors } = await open({ width: 390, height: 844 });
        const nav = await box(page, '#csbNav');
        check('the sidebar is off screen until asked for', nav.x + nav.w <= 0, JSON.stringify(nav));
        check('the page has the whole width', (await box(page, 'main')).x === 0);
        await page.click('body > header .csb-burger');
        await page.waitForTimeout(400);
        check('the burger slides it in', (await box(page, '#csbNav')).x === 0);
        check('…over a scrim', await visible(page, '.csb-scrim'));
        await shot(page, 'nav-phone-drawer');
        await page.click('#csbNav [data-csb-go="settings"]');
        await page.waitForTimeout(450);
        check('picking a topic puts the drawer away', (await box(page, '#csbNav')).x < 0);
        const panel = await box(page, '#settings');
        check('…and the topic fills the screen under the bar', panel.x === 0 && panel.y === 64, JSON.stringify(panel));
        await shot(page, 'nav-phone-settings');
        await page.click('body > header .csb-burger');
        await page.waitForTimeout(400);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        check('Escape puts the drawer away', (await box(page, '#csbNav')).x < 0);
        check('…without closing the topic under it', !(await page.$eval('#settings', (e) => e.classList.contains('hidden'))));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 5. The pilot home -----------------------------------------------
    console.log('\nThe pilot home');
    {
        const { page, errors } = await open({ file: 'crew-pilot.html', role: 'pilot' });
        check('the pilot home wears it too', await visible(page, '#csbNav'));
        const views = await page.$$eval('#csbNav [data-csb-view]', (els) => els.map((e) => e.getAttribute('data-csb-view')));
        check('its views are the parts of the page', ['home', 'flying', 'upcoming', 'account'].every((v) => views.includes(v)), views.join(','));
        check('…a section with nothing in it is not offered', !views.includes('links'));
        const acts = await page.$$eval('#csbNav [data-csb-go]', (els) => els.map((e) => e.getAttribute('data-csb-go')));
        check('the quick actions are down the side', ['file', 'schedule', 'logbook', 'events', 'inbox'].every((a) => acts.includes(a)), acts.join(','));
        check('…so the tile grid is not repeated', !(await visible(page, '#quickGrid')));
        check('home shows the hero', (await visible(page, '#hero')) && !(await visible(page, '#eventsSec')));
        await shot(page, 'nav-pilot');
        await page.click('#csbNav [data-csb-view="upcoming"]');
        await page.waitForTimeout(250);
        check('a view shows only itself', (await visible(page, '#eventsSec')) && !(await visible(page, '#hero')));
        await page.click('#csbNav [data-csb-go="events"]');
        await page.waitForTimeout(500);
        const ev = await box(page, '#cevPanel');
        check('a panel opens in the pane', ev.x === (await box(page, '#csbNav')).w && ev.y === 64, JSON.stringify(ev));
        check('…and is lit', (await current(page)).join() === 'events');
        await shot(page, 'nav-pilot-events');
        await page.click('#csbNav [data-csb-view="home"]');
        await page.waitForTimeout(300);
        check('back home closes it', await page.$eval('#cevPanel', (e) => e.classList.contains('cev-hidden')));
        check('the top-bar switch offers the next look along', (await page.getAttribute('[data-skin-toggle] .ifc-toggle', 'aria-label')).includes('Essential'));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 6. Choosing it for the crew --------------------------------------
    console.log('\nChoosing it for everybody');
    {
        saved = [];
        const { page, errors } = await open({ query: '' });
        check('an untouched crew is on Essential', (await page.getAttribute('html', 'data-skin')) === 'essential');
        await page.evaluate(() => openSettings('appearance'));
        await page.waitForTimeout(500);
        await page.click('#uiOpts [data-skin-opt="navigator"]');
        await page.waitForTimeout(700);
        check('the page becomes Navigator on the spot', (await page.getAttribute('html', 'data-skin')) === 'navigator');
        check('…it is saved for the crew', saved.some((s) => s.ui === 'navigator'), JSON.stringify(saved));
        check('…and the sidebar is up', await visible(page, '#csbNav'));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
})();
