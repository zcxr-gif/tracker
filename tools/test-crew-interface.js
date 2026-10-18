// test-crew-interface.js
// Drives the REAL crew-dashboard.html to prove the crew center's SECOND
// interface is a choice and not a coat of paint:
//
//   * a VA that has never chosen sees the interface it has always had — the
//     aurora sheet is present but not one of its rules applies
//   * ?ui=aurora previews the second interface without writing anything down,
//     because an owner pastes that link into Discord for staff to look at
//   * choosing it in Settings → Appearance changes the page on the spot AND
//     posts it to the crew record, so everyone else gets it too
//   * the switch in the top bar is a PERSONAL choice: this device remembers
//     it, the crew record is not touched, and it outranks what the VA picked
//   * a VA's own brand palette still wins inside the second interface — the
//     skin supplies form, the airline supplies colour
//   * both interfaces cover the whole product: the panels every module is
//     built from follow the page they are opened on
//
// Run:  node tools/test-crew-interface.js
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

// The page's own Tailwind build, in place of the CDN a test box cannot reach.
// Unlike most of the crew tests this one needs it: the settings drawer is
// `fixed inset-0` in Tailwind's utilities and plain flow content without them,
// and the chooser being tested lives inside that drawer.
const TAILWIND = fs.readFileSync(path.join(__dirname, 'crew-tailwind.css'), 'utf8');

const CAPABILITIES = [
    { id: 'settings.branding', group: 'Appearance', label: 'Change appearance' },
    { id: 'roster.manage', group: 'Roster', label: 'Add, edit & remove pilots' },
    { id: 'announcements.manage', group: 'Communications', label: 'Post notices' },
];

// Rebuilt per scenario so one test's saved settings cannot leak into the next.
let state = null;
const freshState = () => ({
    ui: '',                 // what the crew record says the crew's interface is
    theme: null,            // the VA's own brand palette, when it has one
    savedSettings: [],      // every /settings POST body, in order
    live: false,            // the crew centre's own data, for the Console's front page
});

// What the Console's front page reads, when a scenario asks for it: a pilot
// record, a rank ladder with routes above it, a week of flight reports, the
// roster behind them — and an inbox that, for a staff login, is not theirs.
const day = (d, h) => { const t = new Date(); t.setDate(t.getDate() - d); t.setHours(h, 0, 0, 0); return t.toISOString(); };
const LIVE = {
    '/me/badges': () => ({ badges: [{ kind: 'rank', name: 'Captain' }], pilot: { memberId: 'm-7f3a91c2', name: 'Rae Okafor', callsign: 'TST142', hours: 312.4 } }),
    '/routes': () => ({
        ranks: [{ name: 'Cadet', minHours: 0 }, { name: 'Captain', minHours: 300 }, { name: 'Senior Captain', minHours: 750 }, { name: 'Commander', minHours: 1500 }],
        routes: [
            { origin: 'EGLL', destination: 'KJFK', aircraft: 'Boeing 737-800', minRank: '', locked: false },
            { origin: 'EGLL', destination: 'RJAA', aircraft: 'Boeing 787-9', minRank: 'Senior Captain', locked: true, hoursUntilUnlock: 437.6 },
            { origin: 'EGLL', destination: 'VHHH', aircraft: 'Boeing 787-9', minRank: 'Senior Captain', locked: true, hoursUntilUnlock: 437.6 },
            { origin: 'EGLL', destination: 'OMDB', aircraft: 'Airbus A380', minRank: 'Commander', locked: true, hoursUntilUnlock: 1187.6 },
            // Locked on this route, open on another: flyable now, so not "next".
            { origin: 'EGLL', destination: 'KLAX', aircraft: 'Boeing 737-800', minRank: 'Commander', locked: true, hoursUntilUnlock: 1187.6 },
        ],
    }),
    '/pireps': () => ({ canReview: true, pireps: [
        { id: 'p1', memberId: 'm-1', pilotName: 'Luis Herrera', callsign: 'TST601', flightNumber: 'TST601', origin: 'EGLL', destination: 'KJFK', aircraftName: 'Boeing 737-800', durationMin: 432, status: 'pending', flownAt: day(0, 9) },
        { id: 'p2', memberId: 'm-2', pilotName: 'Ana Ruiz', callsign: 'TST044', flightNumber: 'TST044', origin: 'KJFK', destination: 'EGLL', aircraftName: 'Boeing 737-800', durationMin: 410, status: 'approved', flownAt: day(1, 18) },
    ] }),
    '/roster': () => ({ roster: [
        { id: 'm-1', name: 'Luis Herrera', callsign: 'TST601', hours: 842, rank: { name: 'Senior Captain' }, ifcUsername: 'luis.h', discordUsername: 'luish' },
        { id: 'm-2', name: 'Ana Ruiz', callsign: 'TST044', hours: 120, ifcUsername: 'ana.r' },
    ] }),
};

function api(route) {
    const p = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (state.live) {
        const hit = Object.keys(LIVE).find((k) => p.endsWith(k));
        if (hit && method === 'GET') return json(LIVE[hit]());
        if (p.endsWith('/inbox') && method === 'GET') return json({ error: 'Pilots only.' }, 401);
    }

    if (p.includes('/api/va-ads/by-slug/')) {
        const b = { name: 'Test VA', code: 'TST' };
        if (state.ui) b.ui = state.ui;
        if (state.theme) b.theme = state.theme;
        return json(b);
    }
    if (p.endsWith('/settings') && method === 'POST') {
        state.savedSettings.push(route.request().postDataJSON() || {});
        return json({ ok: true });
    }
    if (p.endsWith('/me')) {
        return json({ role: 'owner', caps: CAPABILITIES.map((c) => c.id), capabilities: CAPABILITIES, rolePresets: [], staffRoles: [], staffAssignments: [] });
    }
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: true });
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
    // outranks the crew record. `cached` is the crew default this device saw
    // on its last visit — the thing that stops the first paint flipping.
    const openDash = async ({ query = '', device = '', cached = '' } = {}) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/**', (r) => api(r));
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({
            contentType: 'text/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});`,
        }));
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        // What the interface was BEFORE the VA record came back. crewSkin.js is
        // a blocking script in <head>, so by the time the document is ready it
        // has already decided — which is the difference between painting the
        // right interface and flashing the wrong one first.
        await page.addInitScript(() => {
            document.addEventListener('DOMContentLoaded', () => {
                window.__skinAtDomReady = document.documentElement.getAttribute('data-skin');
            });
        });
        await page.addInitScript(([mine, crew]) => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' }));
            // A returning user, not a first-timer: the walkthrough puts a mask
            // over the whole page, and every click below would land on it.
            localStorage.setItem('crew:tour:staff:testva', '1');
            if (mine) localStorage.setItem('crew:ui:testva', mine);
            if (crew) localStorage.setItem('crew:ui:default:testva', crew);
        }, [device, cached]);
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva${query}`);
        await page.waitForTimeout(1800);
        return { page, errors };
    };

    // Measured, never inferred from the attribute: the attribute is what we
    // set, and what we want to know is whether it CHANGED ANYTHING. The top
    // bar is square and full-width in the essential interface and a rounded
    // floating pill in aurora, so its own geometry answers the question — and
    // it is drawn by crewSkin.css, which is served locally, so this does not
    // quietly become a test of whether the Tailwind CDN was reachable.
    const bar = (page) => page.$eval('body > header.sticky', (el) => {
        const s = getComputedStyle(el);
        return {
            radius: parseFloat(s.borderTopLeftRadius) || 0,
            width: Math.round(el.getBoundingClientRect().width),
            viewport: window.innerWidth,
        };
    });
    const skin = (page) => page.getAttribute('html', 'data-skin');
    const stored = (page) => page.evaluate(() => ({
        mine: localStorage.getItem('crew:ui:testva') || '',
        crew: localStorage.getItem('crew:ui:default:testva') || '',
    }));

    // ---- 1. A VA that has never chosen ------------------------------------
    console.log('\nUntouched — the interface the crew center has always had');
    state = freshState();
    {
        const { page, errors } = await openDash();
        check('the page says which interface it is wearing', (await skin(page)) === 'essential');
        const b = await bar(page);
        // `viewport` includes the scrollbar, so "full width" is within a
        // scrollbar's worth of it rather than exactly it.
        check('the top bar is still the full-width ruled bar', b.radius < 1 && b.width > b.viewport - 20,
            `radius ${b.radius}, ${b.width} of ${b.viewport}`);
        check('nothing was written down', (await stored(page)).mine === '');
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 2. The preview link ----------------------------------------------
    console.log('\n?ui=aurora — a link an owner pastes into Discord');
    state = freshState();
    {
        const { page, errors } = await openDash({ query: '&ui=aurora' });
        check('the second interface is on', (await skin(page)) === 'aurora');
        const b = await bar(page);
        check('the top bar floats free of the window', b.radius > 8 && b.width < b.viewport - 20,
            `radius ${b.radius}, ${b.width} of ${b.viewport}`);
        check('looking is not choosing — nothing persisted', (await stored(page)).mine === '');
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 3. An owner chooses it for the crew -------------------------------
    console.log('\nSettings → Appearance — choosing for everybody');
    state = freshState();
    {
        const { page, errors } = await openDash();
        await page.click('header button[title="Settings"]');
        await page.waitForTimeout(500);
        check('the chooser is offered', await page.isVisible('#uiOpts [data-skin-opt="aurora"]'));
        check('…showing the current interface as the current one',
            (await page.getAttribute('#uiOpts [data-skin-opt="essential"]', 'aria-checked')) === 'true');
        check('…and each option draws the interface it is offering',
            await page.isVisible('#uiOpts [data-skin-opt="aurora"] .ifc-prev-aurora'));

        await page.click('#uiOpts [data-skin-opt="aurora"]');
        await page.waitForTimeout(700);
        check('the page changes on the spot', (await skin(page)) === 'aurora');
        check('…the chooser keeps up',
            (await page.getAttribute('#uiOpts [data-skin-opt="aurora"]', 'aria-checked')) === 'true');
        check('…it is saved for the crew',
            state.savedSettings.some((s) => s.ui === 'aurora'), JSON.stringify(state.savedSettings));
        check('…and remembered on this device', (await stored(page)).mine === 'aurora');
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 4. The crew record, on somebody else's first visit ----------------
    console.log('\nEverybody else');
    state = freshState();
    state.ui = 'aurora';
    {
        const { page, errors } = await openDash();
        check('a first-time reader gets the interface their VA chose', (await skin(page)) === 'aurora');
        check('…cached, so the NEXT visit paints it from the first frame',
            (await stored(page)).crew === 'aurora');
        check('…without being recorded as their own choice', (await stored(page)).mine === '');
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }
    {
        // The cache is the whole point: read synchronously in <head>, before
        // the VA record has come back, so there is no flash of the other one.
        const { page } = await openDash({ cached: 'aurora' });
        const early = await page.evaluate(() => window.__skinAtDomReady || null);
        check('…and that cache is read before the page paints',
            early === 'aurora', `was ${early} when the document was ready`);
        await page.close();
    }

    // ---- 5. A pilot who disagrees ------------------------------------------
    console.log('\nOne pilot’s own device');
    state = freshState();
    state.ui = 'aurora';
    {
        const { page, errors } = await openDash({ device: 'essential' });
        check('their own choice outranks the crew default', (await skin(page)) === 'essential');

        await page.click('header [data-skin-toggle] .ifc-toggle');
        await page.waitForTimeout(700);
        // The switch steps through the interfaces in order; Console is next.
        check('the switch in the top bar flips it', (await skin(page)) === 'console');
        check('…and remembers it on this device', (await stored(page)).mine === 'console');
        check('…without changing it for the crew',
            !state.savedSettings.some((s) => s.ui), JSON.stringify(state.savedSettings));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 6. The VA's brand still wins --------------------------------------
    console.log('\nA VA with its own palette');
    state = freshState();
    state.ui = 'aurora';
    state.theme = { light: { bg: '#120A16', surface: '#1E1026', ink: '#FDF4FF' }, mode: 'light' };
    {
        const { page, errors } = await openDash();
        const tokens = await page.evaluate(() => {
            const s = getComputedStyle(document.documentElement);
            return { bg: s.getPropertyValue('--bg').trim(), surface: s.getPropertyValue('--surface').trim() };
        });
        check('the airline’s paper, not the skin’s', tokens.bg.toLowerCase() === '#120a16', tokens.bg);
        check('the airline’s cards, not the skin’s', tokens.surface.toLowerCase() === '#1e1026', tokens.surface);
        const b = await bar(page);
        check('…in the second interface’s form all the same', b.radius > 8 && b.width < b.viewport - 20,
            `radius ${b.radius}`);
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 7. The panels come with it ----------------------------------------
    console.log('\nThe rest of the product');
    state = freshState();
    {
        const { page, errors } = await openDash({ query: '&ui=aurora' });
        await page.click('#toolGrid a:has-text("Announcements")');
        await page.waitForSelector('#cnPanel:not(.cp-hidden)', { timeout: 5000 });
        const sheet = await page.$eval('#cnPanel .cp-sheet', (el) => {
            const s = getComputedStyle(el);
            return {
                radius: parseFloat(s.borderTopLeftRadius) || 0,
                blurred: /blur/.test(s.backdropFilter || s.webkitBackdropFilter || ''),
            };
        });
        check('a module panel is skinned by having been built properly',
            sheet.radius > 8, `radius ${sheet.radius}`);
        check('…including the glass it is drawn on', sheet.blurred);
        const scrim = await page.$eval('#cnPanel .cp-scrim', (el) => /blur/.test(getComputedStyle(el).backdropFilter || ''));
        check('…and the dashboard is left legible behind it', scrim);
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 8. The Console is a shell of its own ------------------------------
    console.log('\nConsole');
    state = freshState();
    state.live = true;
    {
        const { page, errors } = await openDash({ query: '&ui=console' });
        check('it is the interface on', (await skin(page)) === 'console');
        check('its shell is drawn', await page.isVisible('#crewConsole .cc-board'));
        check('the dashboard underneath is put away', !(await page.isVisible('body > header.sticky')));
        check('the way out is in its rail', await page.isVisible('#crewConsole [data-skin-toggle] .ifc-toggle'));

        // The front page is the crew centre's own data, not the placeholder.
        const front = (sel) => page.textContent('#crewConsole .cc-card-front ' + sel).then((t) => t.trim());
        check('the front card is the member’s own crew ID', (await front('.cc-num')) === 'M7F3 A91C 2', await front('.cc-num'));
        const foot = await page.$$eval('#crewConsole .cc-card-front .cc-foot span', (els) => els.map((e) => e.textContent.trim()));
        check('…in their name and rank', foot.join('|') === 'Rae Okafor|Captain', foot.join('|'));
        const behind = await page.$$eval('#crewConsole .cc-card-back b', (els) => els.map((e) => e.textContent.trim()));
        check('behind it, the aircraft that open next, soonest first', behind.join('|') === 'Boeing 787-9|Airbus A380', behind.join('|'));
        check('a type already open on another route is not “next”', !behind.includes('Boeing 737-800'));
        // The hero: who is here, how far they have come, and the aeroplane.
        check('the hero greets the member by name', /, Rae\.$/.test((await page.textContent('#crewConsole .cc-hero-title')).trim()));
        check('…with their progress to the next rank', /Senior Captain/.test(await page.textContent('#crewConsole .cc-hprog')));
        check('…and an aeroplane to fly in it', !!(await page.getAttribute('#crewConsole .cc-hero-plane', 'data-hero-aircraft')));
        check('the table is the latest flight reports', (await page.textContent('#crewConsole .cc-table tbody tr:first-child .cc-c-flight')).trim() === 'TST601');
        check('the panel shows the pilot behind the latest one', (await page.textContent('#crewConsole .cc-name')).trim() === 'Luis Herrera');
        await page.click('#crewConsole .cc-table tbody tr:nth-child(2)');
        await page.waitForTimeout(200);
        check('a flight row puts its pilot in the panel', (await page.textContent('#crewConsole .cc-name')).trim() === 'Ana Ruiz');
        check('the review button counts what is waiting', (await page.textContent('#crewConsole .cc-end')).replace(/\s+/g, ' ').trim() === 'Review flights 1');
        check('a staff login is told it has no inbox', /no inbox of their own/.test(await page.textContent('#crewConsole .cc-convos')));
        await page.click('#crewConsole .cc-tabs [data-cc-act="openRoutes"]');
        await page.waitForTimeout(600);
        check('a tab opens the dashboard’s own panel over the Console', await page.isVisible('#routes'));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);

        // The cards: the first on edge is the one that comes next, and
        // pressing it brings it to the front.
        const order = () => page.$$eval('#crewConsole .cc-stack .cc-card', (els) => els.map((e) => e.getAttribute('data-card')));
        const before = await order();
        const next = page.locator('#crewConsole .cc-card-back').first();
        const nb = await next.boundingBox();
        await next.click({ position: { x: nb.width - 20, y: nb.height / 2 } });
        await page.waitForTimeout(700);
        const after = await order();
        check('the next card comes to the front', after[0] === before[1], after.join(','));
        check('…and the one it replaced goes to the back of the line', after[after.length - 1] === before[0], after.join(','));
        await page.click('#crewConsole .cc-card-front');
        await page.waitForTimeout(700);
        check('pressing the front card moves on to the next', (await order())[0] === before[2]);
        // An aircraft card face on carries its type for the 3D model, and the
        // matcher finds every family from what an airline might type. (The
        // model itself needs WebGL and three.js, which this page does not
        // have: the card must simply go without, quietly.)
        check('an aircraft card names its aircraft for the model',
            !!(await page.getAttribute('#crewConsole .cc-card-front', 'data-aircraft')));
        await page.waitForFunction(() => !!window.CrewAircraft3D, null, { timeout: 5000 }).catch(() => {});
        const matched = await page.evaluate(() => window.CrewAircraft3D && ['B38M', 'Airbus A321neo', 'B77W', 'Embraer 175', 'CRJ-900', 'A388', 'A359', 'ATR 72']
            .map((n) => { const m = window.CrewAircraft3D.match(n); return m ? m.file + (m.exact ? '' : '~') : '-'; }).join(' '));
        check('fleet types find their models', matched === '737.glb a320.glb 777-300er.glb e175.glb crj900.glb a380.glb 787.glb~ -', matched);

        await page.click('#crewConsole [data-skin-toggle] .ifc-toggle');
        await page.waitForTimeout(700);
        check('…and it leads to the next interface', (await skin(page)) === 'aurora');
        check('the shell steps aside', !(await page.isVisible('#crewConsole')));
        check('the dashboard is back', await page.isVisible('body > header.sticky'));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 9. The Console wears the airline ---------------------------------
    console.log('\nConsole in the airline’s colours');
    state = freshState();
    state.live = true;
    {
        // No accent: the Console keeps its own orange, but still takes the
        // airline's name and flight code.
        const { page, errors } = await openDash({ query: '&ui=console' });
        const accent = () => page.$eval('#crewConsole', (el) => el.style.getPropertyValue('--cc-accent'));
        check('an airline with no accent keeps the Console’s own colour', (await accent()) === '');
        check('the card carries the airline’s name', (await page.textContent('#crewConsole .cc-bank')).trim() === 'Test VA');
        check('its initials stand in for a logo', (await page.textContent('#crewConsole .cc-rail .cc-logo')).trim() === 'TV');
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }
    state = freshState();
    state.theme = { light: { accent: '#0E7C66' }, dark: { accent: '#2DD4BF' } };
    {
        const { page, errors } = await openDash({ query: '&ui=console' });
        const accent = await page.$eval('#crewConsole', (el) => el.style.getPropertyValue('--cc-accent'));
        check('the dark-mode accent is the Console’s colour', accent.toLowerCase() === '#2dd4bf', accent);
        const ink = await page.$eval('#crewConsole', (el) => el.style.getPropertyValue('--cc-accent-ink'));
        check('…with ink that can be read on it', ink === '#111111', ink);
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 10. The Console on a phone ----------------------------------------
    console.log('\nConsole on a phone');
    state = freshState();
    {
        const { page, errors } = await openDash({ query: '&ui=console' });
        await page.setViewportSize({ width: 390, height: 844 });
        // Long enough for the inbox column to finish sliding away as the
        // window narrows into a phone.
        await page.waitForTimeout(700);
        const sheetUp = () => page.$eval('#crewConsole .cc-convos', (el) => getComputedStyle(el).visibility === 'visible');
        check('the way out is in its top bar', await page.isVisible('#crewConsole .cc-mhead [data-skin-toggle] .ifc-toggle'));
        check('the page does not scroll sideways',
            await page.$eval('#crewConsole', (el) => el.scrollWidth <= el.clientWidth));
        check('the inbox starts put away', !(await sheetUp()));
        await page.click('#crewConsole .cc-mhead [data-cc-inbox]');
        await page.waitForTimeout(500);
        check('…comes up as a sheet', await sheetUp());
        await page.click('#crewConsole [data-cc-close]');
        await page.waitForTimeout(500);
        check('…and goes away again', !(await sheetUp()));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
    process.exit(failures ? 1 : 0);
})();
