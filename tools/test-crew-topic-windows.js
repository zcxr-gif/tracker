// test-crew-topic-windows.js
// Drives the REAL crew-dashboard.html to prove the owner's choice of how a
// topic opens actually changes what happens:
//
//   * left alone, nothing moves: a topic is still a slide-over, over a dimmed
//     dashboard, in a column — and there is no burger in the corner
//   * switching to full page in Settings widens the topic to the whole window,
//     drops the scrim, and posts the choice to the crew record
//   * a full-page topic gets its own link, so Back closes it and a pasted link
//     opens it — the two things that make "a window per topic" work at all
//   * the burger moves between topics, closing the one that was open (two
//     full-page topics stacked would be two opaque layers, and the reader
//     would be looking at whichever happened to be on top)
//   * the menu offers exactly the tiles the signed-in member is allowed —
//     a second door into the same rooms needs the same lock
//
// Run:  node tools/test-crew-topic-windows.js
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

const CAPABILITIES = [
    { id: 'roster.manage', group: 'Roster', label: 'Add, edit & remove pilots' },
    { id: 'routes.manage', group: 'Operations', label: 'Edit the route network' },
    { id: 'flights.review', group: 'Operations', label: 'Review flights (PIREPs)' },
    { id: 'schedules.manage', group: 'Operations', label: 'Build the schedule' },
    { id: 'announcements.manage', group: 'Communications', label: 'Post notices' },
    { id: 'settings.branding', group: 'Appearance', label: 'Change appearance' },
    { id: 'partnership.view', group: 'Partnership', label: 'See the partnership' },
];

// Rebuilt per scenario, so one test's saved settings cannot leak into the next.
let state = null;
const freshState = () => ({
    role: 'owner',
    caps: CAPABILITIES.map((c) => c.id),
    topicMode: 'sheet',     // what the crew record says on load
    savedSettings: [],      // every /settings POST body, in order
});

function api(route) {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.includes('/api/va-ads/by-slug/')) {
        return json({ name: 'Test VA', code: 'TST', topicMode: state.topicMode });
    }
    if (p.endsWith('/settings') && method === 'POST') {
        state.savedSettings.push(route.request().postDataJSON() || {});
        return json({ ok: true });
    }
    if (p.endsWith('/me')) {
        return json({ role: state.role, caps: state.caps, capabilities: CAPABILITIES, rolePresets: [], staffRoles: [], staffAssignments: [] });
    }
    if (p.endsWith('/roster')) {
        return json({ roster: [{ id: 'm1', name: 'Rae Okafor', callsign: 'BAW22', hours: 412, rank: { name: 'Captain' }, status: 'active', aircraft: [] }] });
    }
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: true });
    if (p.endsWith('/schedules')) {
        return json({ schedules: [], mine: [], canManage: true, ranks: [], rules: { enabled: true, booking: 'pilots' } });
    }
    if (p.endsWith('/routes')) return json({ routes: [], counts: {}, partners: [], ranks: [] });
    if (p.endsWith('/events')) return json({ events: [], mine: [], canManage: true, ranks: [] });
    if (p.endsWith('/stats')) return json({ ok: true, connected: true, stats: { pilots: 12, hours: 400, flights30d: 3, pireps: 9 } });
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

    // `device` is what this browser has already chosen for itself, which
    // outranks the crew record — the two are separate on purpose and the tests
    // below need to be able to set each one.
    const openDash = async ({ hash = '', device = '' } = {}) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/**', (r) => api(r));
        await page.addInitScript((pref) => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' }));
            if (pref) localStorage.setItem('crew:topics:testva', pref);
        }, device);
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva${hash}`);
        await page.waitForTimeout(1800);
        return { page, errors };
    };

    // How wide is the thing the reader is actually looking at, and is the
    // dashboard dimmed behind it? That is the whole difference between the two
    // modes, measured rather than inferred from a class name.
    //
    // Widths are only ever asked of the crewPanels sheets (#cnPanel, #csPanel),
    // never of the dashboard's own drawers. Those drawers get their column
    // width from a Tailwind utility class, and Tailwind is a CDN script that a
    // test box may not be able to reach — measuring them would be measuring
    // whether the network was up. Their half of the change is the scrim, which
    // this page styles itself, so that is what they are checked on.
    const shape = (page, sel) => page.$eval(sel, (el) => {
        const panel = el.querySelector('.cp-sheet, .cev-sheet, .panel') || el;
        const scrim = el.querySelector('.cp-scrim, .cev-scrim, .ctw-scrim');
        return {
            width: Math.round(panel.getBoundingClientRect().width),
            viewport: window.innerWidth,
            scrimShown: !!scrim && getComputedStyle(scrim).display !== 'none',
        };
    });

    // ---- 1. Left alone, nothing moves -------------------------------------
    console.log('\nSlide-over (the default)');
    state = freshState();
    {
        const { page, errors } = await openDash();
        check('the dashboard does not start in page mode',
            (await page.getAttribute('html', 'data-topic-mode')) === 'sheet');
        check('there is no burger in the corner', !(await page.isVisible('#ctwBurger')));

        await page.click('#toolGrid a:has-text("Announcements")');
        await page.waitForSelector('#cnPanel:not(.cp-hidden)', { timeout: 5000 });
        const s = await shape(page, '#cnPanel');
        check('a topic opens as a column, not the whole window', s.width < s.viewport * 0.75, `${s.width} of ${s.viewport}`);
        check('…over a dimmed dashboard', s.scrimShown);
        check('…and does not take over the address bar', !page.url().includes('#/'), page.url());
        await page.click('#cnPanel .cp-head [data-cp-close]');
        await page.waitForTimeout(400);

        // The dashboard's own drawers are the other half of the change.
        await page.click('#toolGrid a:has-text("Roster")');
        await page.waitForTimeout(500);
        check('the dashboard’s own drawers are dimmed over too', (await shape(page, '#roster')).scrimShown);
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 2. The owner switches to full page --------------------------------
    console.log('\nSwitching to full page');
    state = freshState();
    {
        const { page, errors } = await openDash();
        await page.click('header button[title="Settings"]');
        await page.waitForTimeout(400);
        check('Settings offers the choice', await page.isVisible('#topicOpts [data-topicmode="page"]'));
        check('…and shows slide-over as the current one',
            (await page.getAttribute('#topicOpts [data-topicmode="sheet"]', 'aria-checked')) === 'true');

        await page.click('#topicOpts [data-topicmode="page"]');
        await page.waitForTimeout(600);
        check('the choice is saved for the crew',
            state.savedSettings.some((s) => s.topicMode === 'page'),
            JSON.stringify(state.savedSettings));
        check('…and remembered on this device',
            (await page.evaluate(() => localStorage.getItem('crew:topics:testva'))) === 'page');
        check('the burger appears', await page.isVisible('#ctwBurger'));

        // Settings is itself a topic, so it re-shapes under the reader — which
        // is the fastest possible demonstration that the switch is live.
        check('the dashboard stops dimming behind the open panel', !(await shape(page, '#settings')).scrimShown);
        check('…and the panel that was open takes the address bar with it',
            page.url().endsWith('#/settings'), page.url());
        await page.click('#settings button[onclick="closeSettings()"]');
        await page.waitForTimeout(500);

        await page.click('#toolGrid a:has-text("Announcements")');
        await page.waitForSelector('#cnPanel:not(.cp-hidden)', { timeout: 5000 });
        const notices = await shape(page, '#cnPanel');
        check('a topic opened afterwards fills the window',
            notices.width >= notices.viewport - 2, `${notices.width} of ${notices.viewport}`);
        check('…with nothing dimmed behind it', !notices.scrimShown);
        check('the topic gets its own link', page.url().endsWith('#/notices'), page.url());
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 3. A topic is a place you can go Back from ------------------------
    console.log('\nThe address bar');
    state = freshState();
    {
        const { page, errors } = await openDash({ device: 'page' });
        check('the device’s own choice is honoured without asking the server',
            (await page.getAttribute('html', 'data-topic-mode')) === 'page');

        await page.click('#toolGrid a:has-text("Roster")');
        await page.waitForTimeout(500);
        check('opening a topic pushes a history entry', page.url().endsWith('#/roster'), page.url());

        await page.goBack();
        await page.waitForTimeout(600);
        check('Back closes the topic instead of leaving the crew center',
            !(await page.isVisible('#roster .panel')) && page.url().includes('va=testva'), page.url());

        // Closing with the panel's own control has to agree with the address
        // bar, or a reload would reopen something the reader just dismissed.
        await page.click('#toolGrid a:has-text("Roster")');
        await page.waitForTimeout(500);
        await page.click('#roster button[onclick="closeRoster()"]');
        await page.waitForTimeout(600);
        check('closing a topic by hand clears its link too', !page.url().includes('#/roster'), page.url());
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 4. A pasted link opens the topic ----------------------------------
    console.log('\nOne window per topic');
    state = freshState();
    state.topicMode = 'page';
    {
        const { page, errors } = await openDash({ hash: '#/schedule' });
        const arrived = await page.$('#csPanel:not(.cp-hidden)');
        check('a link straight to a topic opens it', !!arrived);
        check('…and only it', !(await page.isVisible('#roster .panel')));
        const s = arrived ? await shape(page, '#csPanel') : { width: 0, viewport: 1 };
        check('…full width, as its own page', s.width >= s.viewport - 2, `${s.width} of ${s.viewport}`);
        check('the crew record’s choice is what a first visit gets',
            (await page.getAttribute('html', 'data-topic-mode')) === 'page');
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 5. The burger -----------------------------------------------------
    console.log('\nThe burger');
    state = freshState();
    state.topicMode = 'page';
    {
        const { page, errors } = await openDash();
        await page.click('#ctwBurger');
        await page.waitForTimeout(300);
        const menu = (await page.textContent('#ctwNavList')).replace(/\s+/g, ' ');
        check('the menu lists the dashboard and the topics',
            /Dashboard/.test(menu) && /Roster/.test(menu) && /Schedules/.test(menu) && /Settings/.test(menu), menu.slice(0, 120));

        await page.click('#ctwNavList [data-ctw-go="roster"]');
        await page.waitForTimeout(600);
        check('picking one opens it', await page.isVisible('#roster .panel'));
        check('…and closes the menu', !(await page.isVisible('#ctwNav .ctw-nav-panel')));

        await page.click('#ctwBurger');
        await page.waitForTimeout(300);
        check('the menu marks where you are',
            (await page.getAttribute('#ctwNavList [data-ctw-go="roster"]', 'aria-current')) === 'true');
        await page.click('#ctwNavList [data-ctw-go="schedule"]');
        await page.waitForTimeout(800);
        check('moving to another topic closes the one that was open',
            (await page.isVisible('#csPanel')) && !(await page.isVisible('#roster .panel')));
        check('…and the link follows', page.url().endsWith('#/schedule'), page.url());

        await page.click('#ctwBurger');
        await page.waitForTimeout(300);
        await page.click('#ctwNavList [data-ctw-home]');
        await page.waitForTimeout(600);
        check('Dashboard closes everything', !(await page.isVisible('#csPanel')));

        // The way back, without going through Settings — the menu is where
        // somebody who does not like this mode is standing when they decide.
        await page.click('#ctwBurger');
        await page.waitForTimeout(300);
        await page.click('#ctwNavSheet');
        await page.waitForTimeout(500);
        check('the menu can put it back to slide-overs',
            (await page.getAttribute('html', 'data-topic-mode')) === 'sheet' && !(await page.isVisible('#ctwBurger')));
        check('…and says so to the crew record too',
            state.savedSettings.some((s) => s.topicMode === 'sheet'), JSON.stringify(state.savedSettings));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 6. The menu is gated like the tiles -------------------------------
    console.log('\nWhat a staff member is offered');
    state = freshState();
    state.topicMode = 'page';
    state.role = 'staff';
    state.caps = ['announcements.manage'];   // notices and nothing else
    {
        const { page, errors } = await openDash();
        await page.click('#ctwBurger');
        await page.waitForTimeout(300);
        const menu = await page.textContent('#ctwNavList');
        check('a staff member is offered what their role allows', /Announcements/.test(menu));
        check('…and not the roster they cannot manage', !/Roster/.test(menu), menu.replace(/\s+/g, ' ').slice(0, 120));
        check('…nor the route network', !/Routes/.test(menu));

        // A link is not a way around the gate: the tile is gone, so the topic
        // is not registered, so the route has nothing to open.
        await page.goto(page.url().split('#')[0] + '#/roster');
        await page.waitForTimeout(1200);
        check('a link to a gated topic opens nothing', !(await page.isVisible('#roster .panel')));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
    process.exit(failures ? 1 : 0);
})();
