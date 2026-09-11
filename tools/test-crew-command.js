// test-crew-command.js
// Drives the REAL crew center to prove the four systems added on top of it do
// what they claim — and, first, that the two controls which have been lying
// since the pages shipped now tell the truth:
//
//   * the search box in the top bar opens a search that works, ranks a
//     callsign above a word that merely contains those letters, and offers
//     only the tools this member is actually allowed to open
//   * the bell counts something real, and stops counting once it is read
//   * a pilot can see what stands between them and the next rank, ask for a
//     check-ride, and a staff member passing it is the same act as promoting
//   * awards show progress on the ones not earned yet, because a locked grey
//     square is a wall people close
//   * the crew-health board sorts the roster into the four conversations
//     staff can actually have, and every row can be answered with a message
//   * every one of them is silent on a crew center whose database predates it
//
// Run:  node tools/test-crew-command.js
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

const CAPS = [
    { id: 'roster.manage', group: 'Roster', label: 'Manage the roster' },
    { id: 'routes.manage', group: 'Operations', label: 'Edit the network' },
    { id: 'settings.branding', group: 'Appearance', label: 'Change appearance' },
];

const RANKS = [
    { name: 'Cadet', minHours: 0 },
    { name: 'First Officer', minHours: 50, minFlights: 10, checkride: true },
    { name: 'Captain', minHours: 500, minFlights: 30, checkride: true, note: 'One transatlantic sector.' },
];

let state = null;
const freshState = () => ({
    role: 'owner',
    caps: CAPS.map((c) => c.id),
    missing: false,
    alerts: [
        { id: 'n1', kind: 'pirep_approved', title: 'Your KSEA → EGLL flight was approved', body: '9h 40m credited.', createdAt: new Date(Date.now() - 3600e3).toISOString() },
        { id: 'n2', kind: 'message', title: 'Message from Rae Okafor', body: 'Friday slot?', createdAt: new Date(Date.now() - 7200e3).toISOString() },
    ],
    read: [],                 // every POST /alerts/read body
    requests: [],             // every POST /training/requests
    patches: [],              // every PATCH /training/requests/<id>
    nudges: [],               // every POST /crew-health/nudge
});

function api(route) {
    const p = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    const gap = () => json({ error: 'Your crew center’s database needs updating.', code: 'training_missing' }, 409);

    if (p.includes('/api/va-ads/by-slug/')) return json({ name: 'Test VA', code: 'TST', ranks: RANKS });
    if (p.endsWith('/me')) return json({ role: state.role, caps: state.caps, capabilities: CAPS, rolePresets: [], staffRoles: [], staffAssignments: [] });
    if (p.endsWith('/roster')) return json({ roster: [
        { id: 'm1', name: 'Rae Okafor', callsign: 'BAW22', hours: 412, rank: { name: 'Captain' } },
        { id: 'm2', name: 'Gibraltar Jones', callsign: 'TST9', hours: 12, rank: { name: 'Cadet' } },
    ] });
    if (p.endsWith('/routes')) return json({ routes: [{ id: 'r1', origin: 'KSEA', destination: 'EGLL', flightNumber: 'TST100' }], counts: {}, partners: [], ranks: [] });
    if (p.endsWith('/events')) return json({ events: [{ id: 'e1', title: 'Transcon', startsAt: new Date(Date.now() + 86400e3).toISOString() }], mine: [], canManage: true, ranks: [] });
    if (p.endsWith('/documents')) return json({ documents: [{ id: 'd1', title: 'Operations Manual', category: 'SOP' }], canManage: true });

    if (p.endsWith('/alerts') && method === 'GET') {
        if (state.missing) return json({}, 404);
        return json({ alerts: state.alerts, unread: state.alerts.filter((a) => !a.readAt).length });
    }
    if (p.endsWith('/alerts/read')) {
        const body = route.request().postDataJSON() || {};
        state.read.push(body);
        (body.ids || []).forEach((id) => { const a = state.alerts.find((x) => x.id === id); if (a) a.readAt = new Date().toISOString(); });
        return json({ ok: true });
    }

    if (p.endsWith('/training') && method === 'GET') {
        if (state.missing) return gap();
        return json({ canManage: state.caps.includes('roster.manage'), ranks: RANKS,
            me: { rank: 'Cadet', hours: 32, flights: 6 },
            requests: [{ id: 'q1', pilotName: 'Gibraltar Jones', forRank: 'First Officer', status: 'scheduled',
                hours: 60, flights: 12, scheduledAt: new Date(Date.now() + 86400e3).toISOString(), examinerName: 'Rae' }] });
    }
    if (p.endsWith('/training/requests') && method === 'POST') { state.requests.push(route.request().postDataJSON() || {}); return json({ ok: true }); }
    if (/\/training\/requests\/[^/]+$/.test(p) && method === 'PATCH') { state.patches.push(route.request().postDataJSON() || {}); return json({ ok: true }); }

    if (p.endsWith('/awards')) {
        if (state.missing) return json({}, 404);
        return json({
            catalog: [{ id: 'a1', name: 'First flight', desc: 'Filed your first', icon: 'plane-takeoff', tier: 'bronze' },
                { id: 'a2', name: 'Century', desc: '100 hours logged', icon: 'clock', tier: 'silver' }],
            earned: [{ id: 'a1', at: new Date(Date.now() - 86400e3 * 30).toISOString() }],
            progress: { a2: { have: 32, need: 100 } },
        });
    }

    if (p.endsWith('/leave') && method === 'GET') return json({ mine: null, canManage: true, sweep: { enabled: true, quietDays: 60 } });
    if (p.endsWith('/crew-health')) {
        return json({ groups: {
            quiet: [{ id: 'm1', name: 'Rae Okafor', callsign: 'BAW22', lastFlightAt: new Date(Date.now() - 86400e3 * 24).toISOString(), weeks: [3, 4, 2, 0, 0, 0, 0, 0] }],
            never: [{ id: 'm2', name: 'Gibraltar Jones', callsign: 'TST9', joinedAt: new Date(Date.now() - 86400e3 * 40).toISOString() }],
            away: [{ id: 'm3', name: 'Jun Park', callsign: 'TST88', until: new Date(Date.now() + 86400e3 * 10).toISOString() }],
        } });
    }
    if (p.endsWith('/crew-health/nudge')) { state.nudges.push(route.request().postDataJSON() || {}); return json({ ok: true }); }

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

    const openPage = async (which = '/crew-dashboard.html?va=testva') => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/**', (r) => api(r));
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({ contentType: 'text/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});` }));
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })));
        await page.goto(`http://127.0.0.1:${port}${which}`);
        await page.waitForTimeout(1800);
        return { page, errors };
    };
    const rowTexts = (page) => page.$$eval('.cmd-row', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));

    // ---- 1. The search box -------------------------------------------------
    console.log('\nThe search box that never worked');
    state = freshState();
    {
        const { page, errors } = await openPage();
        check('it no longer takes a caret it cannot answer',
            await page.$eval('[data-crew-search]', (el) => el.readOnly));
        await page.click('[data-crew-search]');
        await page.waitForTimeout(500);
        check('clicking it opens a search that does', await page.isVisible('.cmd-box'));
        check('…with nothing typed, it offers the doors', (await rowTexts(page)).length > 3);

        await page.keyboard.type('baw');
        await page.waitForTimeout(400);
        const rows = await rowTexts(page);
        check('a callsign finds its pilot', /Rae Okafor/.test(rows[0] || ''), rows.slice(0, 3).join(' | '));

        // "gib" is IN "Gibraltar Jones" as a prefix and in nothing else. The
        // point of the ranking is that a prefix wins, so it is first.
        await page.fill('.cmd-input', 'gib');
        await page.waitForTimeout(300);
        check('a name prefix outranks a chance substring',
            /Gibraltar/.test((await rowTexts(page))[0] || ''));

        await page.fill('.cmd-input', 'ksea');
        await page.waitForTimeout(300);
        check('an ICAO finds the sector', /KSEA/.test((await rowTexts(page))[0] || ''));

        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        check('escape leaves', !(await page.isVisible('.cmd-box')));

        await page.keyboard.press('Control+k');
        await page.waitForTimeout(400);
        check('⌘K opens it from anywhere', await page.isVisible('.cmd-box'));
        await page.keyboard.press('Escape');
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    console.log('\nIt offers only what this member may open');
    state = freshState(); state.role = 'member'; state.caps = [];
    {
        const { page, errors } = await openPage();
        await page.click('[data-crew-search]');
        await page.waitForTimeout(600);
        const rows = (await rowTexts(page)).join(' | ');
        check('a crew member is not offered the roster tools', !/Roster/.test(rows), rows.slice(0, 120));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 2. The bell -------------------------------------------------------
    console.log('\nThe bell that always had a dot on it');
    state = freshState();
    {
        const { page, errors } = await openPage();
        await page.waitForTimeout(700);
        check('it counts what is actually unread',
            (await page.textContent('[data-crew-bell] .al-dot')).trim() === '2');
        await page.click('[data-crew-bell]');
        await page.waitForSelector('#crewAlerts:not(.cp-hidden)', { timeout: 4000 });
        await page.waitForTimeout(800);
        check('…and opens what it was counting',
            /flight was approved/.test(await page.textContent('#crewAlerts .cp-body')));
        check('reading them marks exactly those, by id',
            state.read.length === 1 && (state.read[0].ids || []).length === 2, JSON.stringify(state.read));
        check('…and the count goes away', !(await page.$('[data-crew-bell] .al-dot')));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    console.log('\nA crew center whose database predates it');
    state = freshState(); state.missing = true;
    {
        const { page, errors } = await openPage();
        await page.waitForTimeout(900);
        check('the bell simply does not light up', !(await page.$('[data-crew-bell] .al-dot')));
        await page.evaluate(() => openTraining());
        await page.waitForTimeout(900);
        check('training says what to do about it',
            /database/i.test(await page.textContent('#crewTraining .cp-body')));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 3. The ladder -----------------------------------------------------
    console.log('\nThe ladder');
    state = freshState();
    {
        const { page, errors } = await openPage();
        await page.evaluate(() => openTraining());
        await page.waitForTimeout(900);
        await page.click('[data-tr-view="me"]');
        await page.waitForTimeout(400);
        const body = await page.textContent('#crewTraining .cp-body');
        check('it says where the pilot is', /Cadet · you/.test(body), body.slice(0, 80));
        check('…and exactly what the next rank is short of',
            /18h more/.test(body) && /4 more flights/.test(body), body.replace(/\s+/g, ' ').slice(0, 300));

        await page.click('[data-tr-request="First Officer"]');
        await page.waitForTimeout(600);
        check('asking for a check-ride sends the rank asked for',
            state.requests.length === 1 && state.requests[0].forRank === 'First Officer', JSON.stringify(state.requests));

        await page.click('[data-tr-view="queue"]');
        await page.waitForTimeout(400);
        check('staff see it waiting on them', await page.isVisible('[data-tr-pass="q1"]'));

        await page.click('[data-tr-pass="q1"]');
        await page.waitForTimeout(400);
        check('recording a pass asks for a word first', await page.isVisible('.cp-ask-box'));
        await page.fill('.cp-ask-box [data-v]', 'Flew it well.');
        await page.click('.cp-ask-box [data-ok]');
        await page.waitForTimeout(600);
        check('…and passing IS the promotion, in one call',
            state.patches.length === 1 && state.patches[0].action === 'pass' && state.patches[0].notes === 'Flew it well.',
            JSON.stringify(state.patches));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 4. Awards ---------------------------------------------------------
    console.log('\nAwards');
    state = freshState();
    {
        const { page, errors } = await openPage();
        await page.evaluate(() => openAwards());
        await page.waitForTimeout(900);
        const body = await page.textContent('#crewAwards .cp-body');
        check('it counts them', /1 of 2 earned/.test(body), body.slice(0, 60));
        check('an earned one says when', /First flight/.test(body) && /ago/.test(body));
        check('a locked one shows how far along they are', /32 of 100/.test(body), body.replace(/\s+/g, ' ').slice(0, 200));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    // ---- 5. Crew health ----------------------------------------------------
    console.log('\nCrew health');
    state = freshState();
    {
        const { page, errors } = await openPage();
        await page.evaluate(() => openLeave());
        await page.waitForTimeout(1100);
        const body = await page.textContent('#crewLeave .cp-body');
        check('the roster is sorted into conversations, not one list',
            /Going quiet/.test(body) && /Never started/.test(body) && /Away/.test(body));
        check('a pilot who is legitimately away is not chased',
            (await page.$$('[data-lv-nudge]')).length === 2, 'nudge buttons');

        await page.click('[data-lv-nudge="m1"]');
        await page.waitForTimeout(400);
        check('the nudge starts from a sentence, not a blank box',
            (await page.inputValue('.cp-ask-box [data-v]')).includes('Rae'));
        await page.click('.cp-ask-box [data-ok]');
        await page.waitForTimeout(500);
        check('…and sends it to that pilot',
            state.nudges.length === 1 && state.nudges[0].pilotId === 'm1' && !!state.nudges[0].message,
            JSON.stringify(state.nudges));
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
    process.exit(failures ? 1 : 0);
})();
