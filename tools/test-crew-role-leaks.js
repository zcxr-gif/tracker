// test-crew-role-leaks.js
// Proves the staff room stays the staff room:
//
//   * a pilot who reaches crew-dashboard.html is sent to their own crew center
//     rather than shown the airline's admin tools
//   * every tool tile is gated on the capability its panel needs, so a staff
//     member hired for one job is not offered somebody else's
//   * the Settings tile is not offered to somebody with no settings tab
//   * an owner sees everything, and the permission tick boxes actually render
//   * when the permission catalogue does not arrive, the role editor SAYS so
//     instead of drawing a role card with nothing underneath it
//   * the team editor lists the VA's REAL staff logins with a role dropdown
//     each, rather than asking an owner to type a username from memory — the
//     typo that saved cleanly and granted nothing
//   * the "Staff" tick on a crew ROLE says it is a badge and points at the
//     screen that actually grants permissions
//
// Run:  node tools/test-crew-role-leaks.js
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
];

let ME = {};
let sendCatalogue = true;
// null → the backend has no such route, which is the out-of-date-backend case.
let ACCOUNTS = null;

function api(route) {
    const p = new URL(route.request().url()).pathname;
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.endsWith('/me')) {
        return json({
            name: 'Someone', ...ME,
            capabilities: sendCatalogue ? CAPABILITIES : undefined,
            rolePresets: [{ id: 'pirep-manager', name: 'PIREP manager', color: '#0EA5E9', description: 'Reviews flight reports.', permissions: ['flights.review'] }],
        });
    }
    if (p.endsWith('/staff-accounts')) return ACCOUNTS ? json({ accounts: ACCOUNTS }) : json({ error: 'nope' }, 404);
    if (p.endsWith('/branding')) return json({ name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial'] });
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: false });
    if (p.endsWith('/events')) return json({ events: [], canManage: false, mine: [], ranks: [] });
    if (p.endsWith('/schedules')) return json({ schedules: [], mine: [], canManage: false, rules: { enabled: true }, ranks: [] });
    if (p.endsWith('/me/pilot')) return json({ pilot: null, linkable: false });
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

    const openDash = async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        await page.route('**/api/**', api);
        await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Someone', role: 'staff' })));
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForTimeout(1100);
        return { ctx, page };
    };
    const tiles = (page) => page.$$eval('#toolGrid [data-i]', (els) => els.map((e) => e.querySelector('.font-semibold').textContent.trim()));

    // ------------------------------------------------------------------
    head('A pilot does not land in the staff room');

    ME = { role: 'pilot', view: 'pilot', caps: [] };
    const { ctx: c1, page: p1 } = await openDash();
    ok('a pilot session is redirected off the dashboard', /crew-pilot\.html/.test(p1.url()), p1.url());
    ok('…keeping the crew center it was for', /va=testva/.test(p1.url()), p1.url());
    await c1.close();

    // ------------------------------------------------------------------
    head('A staff member hired for one job sees one job');

    ME = { role: 'staff', view: 'staff', caps: ['flights.review'] };
    const { ctx: c2, page: p2 } = await openDash();
    const t2 = await tiles(p2);
    ok('stays on the dashboard', !/crew-pilot/.test(p2.url()));
    ok('no Roster tile without roster.manage', !t2.includes('Roster'), t2.join('/'));
    ok('no Routes tile without routes.manage', !t2.includes('Routes'), t2.join('/'));
    ok('no Announcements tile without announcements.manage', !t2.includes('Announcements'), t2.join('/'));
    ok('no Embeds tile without settings.branding', !t2.includes('Embeds'), t2.join('/'));
    ok('no Partnership tile', !t2.includes('Partnership'), t2.join('/'));
    ok('no Settings tile with no reachable tab', !t2.includes('Settings'), t2.join('/'));
    ok('…but Flights, which is their job, is there', t2.includes('Flights'), t2.join('/'));
    ok('…and Events, readable by any crew member', t2.includes('Events'), t2.join('/'));
    await c2.close();

    // ------------------------------------------------------------------
    head('A schedule manager gets the schedule and its settings');

    ME = { role: 'staff', view: 'staff', caps: ['schedules.manage'] };
    const { ctx: c3, page: p3 } = await openDash();
    const t3 = await tiles(p3);
    ok('the Schedules tile is offered', t3.includes('Schedules'), t3.join('/'));
    ok('…and Settings, because the Crew tab is reachable', t3.includes('Settings'), t3.join('/'));
    ok('still no Roster', !t3.includes('Roster'), t3.join('/'));
    await c3.close();

    // ------------------------------------------------------------------
    head('The owner sees everything, and the tick boxes are really there');

    ME = { role: 'owner', view: 'staff', caps: CAPABILITIES.map((c) => c.id), staffRoles: [], staffAssignments: [] };
    const { ctx: c4, page: p4 } = await openDash();
    const t4 = await tiles(p4);
    for (const label of ['Roster', 'Routes', 'Schedules', 'Events', 'Flights', 'Announcements', 'Embeds', 'Partnership', 'Settings']) {
        ok(`owner is offered ${label}`, t4.includes(label), t4.join('/'));
    }

    await p4.evaluate(() => window.openSettings('team'));
    await p4.waitForTimeout(250);
    ok('the Team tab is reachable', await p4.isVisible('[data-panel="team"]'));
    ok('…and says plainly that it is owner-only', /Only you, the owner/.test(await p4.innerText('[data-panel="team"]')));

    await p4.evaluate(() => window.addStaffRole());
    await p4.waitForTimeout(250);
    const boxes = await p4.$$eval('#staffRoleRows [data-perm]', (els) => els.map((e) => e.getAttribute('data-perm')));
    ok('a new role shows every capability as a tick box', boxes.length === CAPABILITIES.length, `${boxes.length} boxes`);
    ok('…including the one this VA would grant a reviewer', boxes.includes('flights.review'), boxes.join(','));
    const groups = await p4.$$eval('#staffRoleRows .uppercase', (els) => els.map((e) => e.textContent.trim()));
    ok('…grouped by subject rather than listed as ids', groups.includes('Operations'), groups.join('/'));
    await c4.close();

    // ------------------------------------------------------------------
    head('When the catalogue does not arrive, it says so');

    sendCatalogue = false;
    const { ctx: c5, page: p5 } = await openDash();
    await p5.evaluate(() => window.openSettings('team'));
    await p5.waitForTimeout(200);
    await p5.evaluate(() => window.addStaffRole());
    await p5.waitForTimeout(250);
    const rowText = await p5.innerText('#staffRoleRows');
    ok('the role editor explains the empty list', /Couldn’t load the permission list/.test(rowText), rowText.slice(0, 120));
    ok('…rather than drawing a role card with nothing under it', !/^\s*$/.test(rowText));
    await c5.close();
    sendCatalogue = true;

    // ------------------------------------------------------------------
    head('The team editor lists the real staff logins');

    ACCOUNTS = [
        { username: 'skypilot', displayName: 'Sky Pilot', role: 'owner', active: true },
        { username: 'routeguy', displayName: 'Route Guy', role: 'staff', active: true },
        { username: 'oldhand', displayName: 'Old Hand', role: 'staff', active: false },
    ];
    ME = {
        role: 'owner', view: 'staff', caps: CAPABILITIES.map((c) => c.id),
        staffRoles: [{ id: 'role-rm', name: 'Route manager', color: '#4f46e5', permissions: ['routes.manage'] }],
        staffAssignments: [],
    };
    const { ctx: c6, page: p6 } = await openDash();
    await p6.evaluate(() => window.openSettings('team'));
    await p6.waitForTimeout(400);

    const acctText = await p6.innerText('#accountRows');
    ok('a staff login is listed by name', /Route Guy/.test(acctText), acctText.slice(0, 160));
    ok('…with the username it actually signs in with', /@routeguy/.test(acctText));
    ok('a disabled account is marked as such', /disabled/.test(acctText));
    ok('the owner is listed without a dropdown to change', /Owner · full access/.test(acctText));
    const selCount = await p6.$$eval('#accountRows [data-acctrole]', (e) => e.length);
    ok('…so only the two non-owner accounts get one', selCount === 2, `${selCount} dropdowns`);
    const optText = await p6.$eval('#accountRows [data-acctrole]', (e) => e.textContent);
    ok('the dropdown offers the VA’s own role', /Route manager/.test(optText), optText);
    ok('…and “no role” is an option, not a blank', /No role/.test(optText));

    // The whole point: choosing a role here becomes a real assignment keyed on
    // the login username, with no typing involved.
    await p6.selectOption('#accountRows [data-acct="routeguy"] [data-acctrole]', 'role-rm');
    await p6.waitForTimeout(150);
    const asn1 = await p6.evaluate(() => JSON.parse(JSON.stringify(window.STAFF_ASSIGN ?? STAFF_ASSIGN)));
    ok('picking a role assigns that exact username', asn1.length === 1 && asn1[0].username === 'routeguy' && asn1[0].roleId === 'role-rm', JSON.stringify(asn1));

    // Back to "no role" removes the row rather than saving a blank one, which
    // sanitizeAssignments would drop anyway.
    await p6.selectOption('#accountRows [data-acct="routeguy"] [data-acctrole]', '');
    await p6.waitForTimeout(150);
    const asn2 = await p6.evaluate(() => JSON.parse(JSON.stringify(window.STAFF_ASSIGN ?? STAFF_ASSIGN)));
    ok('…and “no role” clears it rather than saving an empty one', asn2.length === 0, JSON.stringify(asn2));

    // The confusion that started this: the crew-role Staff tick is a badge.
    await p6.evaluate(() => window.openSettings('crew'));
    await p6.waitForTimeout(250);
    const crewText = await p6.innerText('#crewStructureBlock');
    ok('the crew-role Staff tick says it grants no access', /grants no access/.test(crewText), crewText.slice(0, 200));
    ok('…and points at the screen that does', /Settings › Team/.test(crewText));
    await c6.close();

    // ------------------------------------------------------------------
    head('An out-of-date backend says so instead of showing nothing');

    ACCOUNTS = null;
    const { ctx: c7, page: p7 } = await openDash();
    await p7.evaluate(() => window.openSettings('team'));
    await p7.waitForTimeout(400);
    ok('the missing route is explained', /out of date/.test(await p7.innerText('#accountsNote')));
    ok('…and the manual username route is still offered',
        await p7.isVisible('#assignRows') || /isn’t listed/.test(await p7.innerText('[data-panel="team"]')));
    await c7.close();

    await browser.close();
    server.close();

    console.log(`\n${fail ? `${fail} failed, ` : ''}${pass} passed.`);
    process.exit(fail ? 1 : 0);
})();
