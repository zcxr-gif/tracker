// test-crew-mobile.js
// Drives the REAL crew-dashboard.html at phone widths, because the controls
// this covers were all present in the DOM and all off the side of the screen:
//
//   * every Settings tab is reachable on a phone — including Team, the one
//     that grants permissions, and Data, which used to sit past the right
//     edge of the panel with no scrollbar to say it was there
//   * the roster, routes and flights drawers keep their actions — CSV, Add,
//     and the X that closes the drawer — on the screen instead of pushing
//     them off the end of a header row that never wrapped
//   * the Team tab shows WHOSE permissions a row is editing, rather than
//     truncating the name to make room for the role dropdown
//   * naming a rank, a role or an aircraft is possible: those fields used to
//     collapse to ~20px, which is narrower than a single character
//   * permission tick boxes are big enough to hit with a finger
//
// Layout is the whole subject here, so the page needs its stylesheet. The CDN
// build is not reachable from a test runner, so a locally built copy of the
// same Tailwind output is served in its place:
//
//   npm i --no-save tailwindcss@3.4.17
//   echo "module.exports={content:['./crew-dashboard.html','./crew*.js']}" > /tmp/tw.config.js
//   printf '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' > /tmp/tw.css
//   npx tailwindcss -c /tmp/tw.config.js -i /tmp/tw.css -o tools/crew-tailwind.css
//
// Regenerate it when the dashboard starts using a utility class it has never
// used before; a missing class shows up here as a layout that is wrong in a
// way the browser would not be.
//
// Run:  node tools/test-crew-mobile.js
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

const TAILWIND = fs.readFileSync(path.join(__dirname, 'crew-tailwind.css'), 'utf8');

const CAPABILITIES = [
    { id: 'roster.manage', group: 'Roster', label: 'Add, edit & remove pilots' },
    { id: 'applications.review', group: 'Recruitment', label: 'Review applications' },
    { id: 'settings.recruitment', group: 'Recruitment', label: 'Edit join settings' },
    { id: 'settings.branding', group: 'Appearance', label: 'Change appearance, ranks, roles & fleet' },
    { id: 'settings.notifications', group: 'Notifications', label: 'Manage Discord & email notifications' },
    { id: 'routes.manage', group: 'Operations', label: 'Create & manage the route network' },
    { id: 'flights.review', group: 'Operations', label: 'Review flights (PIREPs)' },
    { id: 'events.manage', group: 'Operations', label: 'Create & manage events' },
    { id: 'schedules.manage', group: 'Operations', label: 'Build the schedule' },
    { id: 'announcements.manage', group: 'Communications', label: 'Post & pin notices' },
    { id: 'partnership.view', group: 'Partnership', label: 'See the Inflight partnership' },
    { id: 'staff.manage', group: 'Owner', label: 'Create staff roles & assign the team' },
];

// A display name long enough that squeezing it is a real temptation.
const ACCOUNTS = [
    { username: 'ada', displayName: 'Ada Lovelace-Okonkwo', role: 'owner', active: true },
    { username: 'samanthapark', displayName: 'Samantha Park', role: 'staff', active: true },
];

function api(route) {
    const p = new URL(route.request().url()).pathname;
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.endsWith('/me')) {
        return json({
            name: 'Ada', role: 'owner', view: 'staff',
            caps: CAPABILITIES.map((c) => c.id), capabilities: CAPABILITIES,
            staffRoles: [], staffAssignments: [], rolePresets: [],
        });
    }
    if (p.endsWith('/staff-accounts')) return json({ accounts: ACCOUNTS });
    if (p.endsWith('/branding')) return json({ name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial'] });
    if (p.endsWith('/roster')) {
        return json({ roster: [{ id: 'm1', name: 'Jordan Lee', callsign: 'ACA1174', hours: 214, aircraft: ['A320'], status: 'active' }] });
    }
    if (p.endsWith('/routes')) return json({ routes: [], ranks: [] });
    if (p.includes('/pireps')) return json({ pireps: [], canReview: true });
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: true });
    if (p.endsWith('/events')) return json({ events: [], canManage: true, mine: [], ranks: [] });
    if (p.endsWith('/schedules')) return json({ schedules: [], mine: [], canManage: true, rules: { enabled: true }, ranks: [] });
    if (p.endsWith('/me/pilot')) return json({ pilot: null, linkable: false });
    return json({});
}

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${extra !== undefined ? `  (${extra})` : ''}`); fail++; }
};
const head = (s) => console.log(`\n${s}`);

// The phones people actually open a crew center on. 320 is the narrowest
// screen still in use, and it is where every one of these bugs was worst.
const PHONES = [
    { name: 'iPhone 14', width: 390, height: 844 },
    { name: 'Android', width: 360, height: 740 },
    { name: 'iPhone SE', width: 320, height: 568 },
];

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    const openDash = async (vp) => {
        const ctx = await browser.newContext({
            viewport: { width: vp.width, height: vp.height },
            isMobile: vp.width < 900, hasTouch: vp.width < 900,
        });
        const page = await ctx.newPage();
        await page.route('**/api/**', api);
        // The page's own stylesheet, in place of the CDN the runner cannot reach.
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({
            contentType: 'text/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});`,
        }));
        // Icons are drawn by their utility classes here; the real library only
        // fills them in, and it is not reachable either.
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Ada', role: 'owner' })));
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForTimeout(1100);
        return { ctx, page };
    };

    // Everything a finger has to find must be inside the window. An element
    // that hangs off the right-hand edge is, to the person holding the phone,
    // simply not there.
    const offScreen = (page, selector) => page.$$eval(selector, (els, w) => els
        .filter((e) => {
            const s = getComputedStyle(e);
            if (s.display === 'none' || s.visibility === 'hidden') return false;
            const r = e.getBoundingClientRect();
            return r.width > 0 && (r.right > w + 1 || r.left < -1);
        })
        .map((e) => (e.textContent || '').trim().slice(0, 20) || e.id || e.title || e.tagName), page.viewportSize().width);

    for (const vp of PHONES) {
        head(`${vp.name} — ${vp.width}×${vp.height}`);
        const { ctx, page } = await openDash(vp);

        // ---------------- Settings tabs -------------------------------
        await page.evaluate(() => window.openSettings('team'));
        await page.waitForTimeout(300);

        const tabs = await page.$$eval('.settings-tab', (els, w) => els
            .filter((e) => !e.classList.contains('hidden'))
            .map((e) => { const r = e.getBoundingClientRect(); return { cat: e.dataset.cat, right: r.right, h: r.height, on: r.right <= w + 1 }; }), vp.width);
        ok('all six settings tabs are on the screen', tabs.length === 6 && tabs.every((t) => t.on),
            tabs.filter((t) => !t.on).map((t) => t.cat).join(',') || `${tabs.length} tabs`);
        ok('…including Team, where permissions are granted', tabs.some((t) => t.cat === 'team' && t.on));
        ok('…and Data, which used to fall off the end', tabs.some((t) => t.cat === 'data' && t.on));
        ok('…each tall enough to tap', tabs.every((t) => t.h >= 32), Math.min(...tabs.map((t) => Math.round(t.h))));

        // ---------------- The Team tab itself -------------------------
        ok('the permission tick boxes are finger-sized', await page.$eval(
            '#staffRoleRows, [data-panel="team"]',
            () => true,
        ) && await (async () => {
            await page.evaluate(() => window.addStaffRole());
            await page.waitForTimeout(200);
            const box = await page.$$eval('#staffRoleRows input[type="checkbox"]', (els) => els.map((e) => e.getBoundingClientRect().width));
            return box.length > 0 && box.every((w) => w >= 16);
        })());

        const acct = await page.$$eval('#accountRows [data-acct]', (rows) => rows.map((row) => {
            const name = row.querySelector('div');
            const sel = row.querySelector('select');
            return { name: Math.round(name.getBoundingClientRect().width), sel: Math.round(sel.getBoundingClientRect().width), text: name.textContent.trim() };
        }));
        ok('a staff member is named at a readable width beside their role', acct.length > 0 && acct.every((a) => a.name >= 140),
            JSON.stringify(acct));
        ok('…and the role dropdown gets the full width of the row', acct.every((a) => a.sel >= 140), JSON.stringify(acct));

        // ---------------- Naming a rank, role or aircraft -------------
        await page.evaluate(() => { window.openSettings('crew'); window.addRank(); window.addRole(); window.addFleet(); });
        await page.waitForTimeout(300);
        const fields = await page.$$eval('#rankRows [data-f="name"], #roleRows [data-f="name"], #fleetRows [data-f="type"]',
            (els) => els.map((e) => ({ ph: e.placeholder, w: Math.round(e.getBoundingClientRect().width) })));
        ok('a rank, role and aircraft can each be typed into', fields.length === 3 && fields.every((f) => f.w >= 120),
            JSON.stringify(fields));
        ok('nothing in the settings panel hangs off the screen',
            (await offScreen(page, '#settings .panel *')).length === 0,
            (await offScreen(page, '#settings .panel *')).join(' / '));

        // ---------------- The drawers ---------------------------------
        for (const [label, open] of [
            ['roster', () => window.openRoster()],
            ['routes', () => window.openRoutes()],
            ['flights', () => {
                window.openPireps();
                // Both are capability-gated; show them so the widest version
                // of the header is the one under test.
                document.getElementById('filePirepBtn').classList.remove('hidden');
                document.getElementById('syncPirepsBtn').classList.remove('hidden');
            }],
        ]) {
            await page.evaluate(() => document.querySelectorAll('[data-topic]').forEach((p) => p.classList.add('hidden')));
            await page.evaluate(open);
            await page.waitForTimeout(300);
            const stray = await offScreen(page, '[data-topic]:not(.hidden) .drawer-head *');
            ok(`the ${label} drawer keeps every header control on the screen`, stray.length === 0, stray.join(' / '));
            const closer = await page.$$eval('[data-topic]:not(.hidden) .drawer-actions button:last-child',
                (els, w) => els.map((e) => e.getBoundingClientRect().right <= w + 1), vp.width);
            ok(`…including the X that closes it`, closer.length === 1 && closer[0]);
        }

        await ctx.close();
    }

    // ------------------------------------------------------------------
    // The desktop layout is the one that already worked. None of the above
    // is allowed to have cost it anything.
    head('Desktop is unchanged');
    const { ctx, page } = await openDash({ name: 'desktop', width: 1280, height: 900 });
    await page.evaluate(() => window.openSettings('team'));
    await page.waitForTimeout(300);
    const rows = await page.$$eval('.settings-tab', (els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    ok('the settings tabs stay on one line', rows === 1, `${rows} rows`);
    await page.evaluate(() => { document.querySelectorAll('[data-topic]').forEach((p) => p.classList.add('hidden')); window.openRoster(); });
    await page.waitForTimeout(300);
    // NOT one line: the roster drawer is 512px wide whatever the screen, and
    // its header wants ~540. It overflowed on a desktop too — the X simply
    // fell off the right-hand edge of a panel that is flush with it. Wrapping
    // is the fix there as well, so what is asserted is that everything is on
    // the screen, not that it is on one row.
    const strayDesk = await page.$$eval('#roster .drawer-head *',
        (els, w) => els.filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > w + 1).length, 1280);
    ok('the roster header fits the drawer', strayDesk === 0, `${strayDesk} off the edge`);
    await ctx.close();

    await browser.close();
    server.close();
    console.log(`\n${pass} passed${fail ? `, ${fail} FAILED` : ''}.`);
    process.exit(fail ? 1 : 0);
})();
