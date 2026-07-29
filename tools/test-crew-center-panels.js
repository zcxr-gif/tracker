// test-crew-center-panels.js
// Drives the REAL crew-dashboard.html against a faked crew center to prove the
// four dead controls now do something, and do the right thing:
//
//   * Recent activity is the VA's OWN noticeboard, and the three invented
//     people who used to live there (Jordan Lee, Sam Park, ACA412) are gone
//   * the Announcements tile opens the noticeboard, and posting sends what was
//     typed
//   * the Schedule button — the one that had no handler at all — opens the
//     schedule, and booking a leg calls the API rather than deciding locally
//   * the Embeds tile builds a snippet carrying the VA's OWN code, and previews
//     the exact URL it hands over
//   * the Partnership tile shows standing and warnings, and tells a staff
//     member plainly that it is owner-only rather than failing silently
//   * a database too old for the schedule says so, rather than "nothing
//     scheduled" — those look identical on screen and only one is actionable
//
// Run:  node tools/test-crew-center-panels.js
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

const hoursFromNow = (h) => new Date(Date.now() + h * 3600e3).toISOString();

let announcements = [
    { id: 'a1', title: 'Rae Okafor joined the airline', body: '', kind: 'join', auto: true, pinned: false, authorName: '', createdAt: hoursFromNow(-3) },
    { id: 'a2', title: 'July schedule is live', body: 'Bidding closes Friday.', kind: 'notice', auto: false, pinned: true, authorName: 'Ops', createdAt: hoursFromNow(-30) },
];
let schedules = [
    {
        id: 'sc1', flightNumber: 'BA117', origin: 'EGLL', destination: 'KJFK', aircraft: 'Boeing 787-9',
        departsAt: hoursFromNow(26), arrivesAt: hoursFromNow(34), blockMinutes: 480, seats: 2,
        minRank: '', notes: '', status: 'published', locked: false, hoursUntilUnlock: 0,
        booked: 1, seatsLeft: 1, full: false, flown: false, canManage: true, routeId: null,
    },
    {
        id: 'sc2', flightNumber: 'BA286', origin: 'KSFO', destination: 'EGLL', aircraft: 'Airbus A350',
        departsAt: hoursFromNow(50), arrivesAt: null, blockMinutes: null, seats: 1,
        minRank: 'Captain', notes: '', status: 'published', locked: false, hoursUntilUnlock: 0,
        booked: 0, seatsLeft: 1, full: false, flown: false, canManage: true, routeId: null,
    },
];
let scheduleRules = { enabled: true, booking: 'pilots', minRank: '', maxPerPilot: 0, openDaysAhead: 0, cancelHoursBefore: 0 };
let posted = null;
let booked = null;
let bookCalls = 0;
let createdSchedule = null;

function api(route, over = {}) {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (over[p + ':' + method]) return over[p + ':' + method](route, json);

    if (p.endsWith('/announcements') && method === 'GET') return json({ announcements, canManage: true });
    if (p.endsWith('/announcements') && method === 'POST') {
        posted = route.request().postDataJSON();
        const a = { id: 'a3', ...posted, kind: 'notice', auto: false, authorName: 'Owner', createdAt: new Date().toISOString() };
        announcements = [a, ...announcements];
        return json({ announcement: a }, 201);
    }
    if (/\/announcements\/\w+$/.test(p)) return json({ ok: true });

    if (p.endsWith('/schedules') && method === 'GET') {
        return json({
            schedules, mine: [], canManage: true, rules: scheduleRules,
            ranks: [{ name: 'Cadet', minHours: 0 }, { name: 'Captain', minHours: 300 }],
        });
    }
    if (p.endsWith('/schedules') && method === 'POST') {
        createdSchedule = route.request().postDataJSON();
        return json({ schedules: [{ ...schedules[0], id: 'sc9' }], created: Number(createdSchedule.count) || 1 }, 201);
    }
    if (/\/schedules\/\w+\/book$/.test(p) && method === 'POST') {
        booked = p;
        bookCalls += 1;
        return json({ booking: { id: 'bk1', seat: 2, pilotName: 'Owner', callsign: '', note: '', status: 'booked' } }, 201);
    }
    if (/\/schedules\/\w+$/.test(p) && method === 'GET') {
        return json({ schedule: schedules[0], crew: [{ id: 'bk0', seat: 1, pilotName: 'Rae Okafor', callsign: 'BAW117', status: 'booked' }], mine: null, flights: [], canManage: true });
    }

    if (p.endsWith('/partnership')) {
        return json({
            partnership: {
                name: 'Test VA', code: 'TST', status: 'approved', partnered: true, featured: true,
                announcedAt: hoursFromNow(-24 * 200), since: hoursFromNow(-24 * 400),
                region: 'Europe', hubs: ['EGLL'], recruiting: true,
                logoUrl: null, bannerUrl: null, websiteUrl: 'https://example.com', discordUrl: null,
            },
            standing: { level: 'first', label: 'First warning', meaning: 'A reminder, on record.', palette: '', activeWarnings: 1, terminated: false },
            warnings: [{ id: 'w1', level: 'first', label: 'First warning', reason: 'Banner exceeded the size limit.', issuedAt: hoursFromNow(-100), termsVersion: '1.2', acknowledged: false, acknowledgedAt: null }],
            terms: { version: '1.2', effectiveDate: '2026-01-01', pageUrl: '/terms', pdfUrl: '/t.pdf', acknowledged: false, acknowledgedAt: null, acknowledgedBy: '' },
            flightEvents: { requested: true, requestedAt: hoursFromNow(-72), approved: false, enabled: true },
            portal: { url: '/va-portal.html', submissionsUrl: '/va-portal.html#submissions', warningsUrl: '/va-portal.html#warnings', termsUrl: '/va-portal.html#terms' },
        });
    }

    if (p.endsWith('/routes')) return json({ routes: [{ id: 'rt1', flightNumber: 'BA117', origin: 'EGLL', destination: 'KJFK', aircraft: 'Boeing 787-9', active: true, kind: 'own' }], counts: {}, partners: [], ranks: [] });
    if (p.endsWith('/events')) return json({ events: [], mine: [], canManage: true, ranks: [] });
    if (p.includes('/api/va-ads/by-slug/')) return json({ name: 'Test VA', code: 'TST' });
    if (p.endsWith('/me')) return json({ role: 'owner', caps: [], capabilities: [], staffRoles: [], staffAssignments: [] });
    if (p.endsWith('/stats')) return json({ ok: true, connected: true, stats: { pilots: 12, hours: 400, flights30d: 3, pireps: 9 } });
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

    const openDash = async (routeHandler) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/**', routeHandler || ((r) => api(r)));
        await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })));
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForTimeout(1800);
        return { page, errors };
    };

    // ---- 1. Recent activity ------------------------------------------------
    console.log('\nRecent activity');
    const { page, errors } = await openDash();

    const activity = await page.textContent('#activity');
    check('the feed shows the VA’s own noticeboard', /Rae Okafor joined the airline/.test(activity), activity.trim().slice(0, 90));
    check('a pinned staff notice is there too', /July schedule is live/.test(activity));

    // The whole point of the change: none of the invented people survive.
    const wholePage = await page.evaluate(() => document.body.innerText);
    check('no invented pilot survives anywhere on the dashboard',
        !/Jordan Lee/.test(wholePage) && !/Sam Park/.test(wholePage) && !/ACA412/.test(wholePage));

    // ---- 2. The noticeboard panel -----------------------------------------
    console.log('\nAnnouncements');
    await page.click('#toolGrid a:has-text("Announcements")');
    await page.waitForSelector('#cnPanel:not(.cp-hidden)', { timeout: 5000 });
    check('the Announcements tile opens the noticeboard', true);
    check('staff get a composer', await page.isVisible('#cnCompose'));

    await page.fill('#cnTitle', 'Winter ops brief');
    await page.fill('#cnBody', 'De-icing procedure has changed.');
    await page.check('#cnPin');
    await page.click('#cnPost');
    await page.waitForTimeout(700);
    check('posting sends what was typed',
        posted && posted.title === 'Winter ops brief' && posted.pinned === true,
        JSON.stringify(posted));
    check('and the new notice appears on the board',
        /Winter ops brief/.test(await page.textContent('#cnPanel')));
    check('the dashboard feed picks it up too',
        /Winter ops brief/.test(await page.textContent('#activity')));
    await page.click('#cnPanel .cp-head [data-cp-close]');

    // ---- 3. The schedule ---------------------------------------------------
    console.log('\nSchedule');
    // The button that used to have no handler at all.
    await page.click('button:has-text("Schedule")');
    await page.waitForSelector('#csPanel:not(.cp-hidden)', { timeout: 5000 });
    check('the hero Schedule button opens the schedule', true);

    const sched = await page.textContent('#csPanel');
    check('departures are listed', /BA117/.test(sched) && /EGLL/.test(sched), sched.trim().slice(0, 100));
    check('rows are grouped into days', (await page.$$('#csPanel .cs-day')).length > 0);
    check('coverage the server counted is shown', /1 of 2 open/.test(sched));
    check('staff get the add button', await page.isVisible('#csNewBtn'));

    await page.click('#csPanel [data-book="sc2"]');
    await page.waitForTimeout(700);
    check('booking calls the API rather than deciding locally',
        booked === '/api/crew/testva/schedules/sc2/book', String(booked));

    // The editor, including the thing that repeats a template.
    await page.click('#csNewBtn');
    await page.waitForSelector('#csEdit', { timeout: 5000 });
    await page.fill('#csOrigin', 'egll');
    await page.fill('#csDest', 'lfpg');
    await page.fill('#csFlightNo', 'BA304');
    await page.fill('#csDep', '2026-09-26T18:40');
    await page.selectOption('#csRepeat', 'weekly');
    await page.fill('#csCount', '4');
    await page.selectOption('#csStatus', 'published');
    await page.click('#csSave');
    await page.waitForTimeout(700);

    check('the editor sends what was typed',
        createdSchedule && createdSchedule.origin === 'EGLL' && createdSchedule.flightNumber === 'BA304',
        JSON.stringify(createdSchedule));
    check('a repeat is carried as a repeat, not four separate rows',
        createdSchedule && createdSchedule.repeat === 'weekly' && createdSchedule.count === 4);
    // The form takes local wall-clock time; what leaves must be the instant.
    check('the departure time is sent as an instant, not a bare wall clock',
        new Date(createdSchedule.departsAt).getTime() === new Date('2026-09-26T18:40').getTime(),
        createdSchedule && createdSchedule.departsAt);
    // REGRESSION. `panel.body` survives every render — only its innerHTML is
    // replaced — so the delegated click handler used to be attached again on
    // each one. Opening the panel renders twice (once on open, once when the
    // fetch lands), so a single tap on Book fired POST /book TWICE: the second
    // request lost the race against its own twin and came back "you are already
    // booked", showing an error to a pilot whose booking had just succeeded.
    bookCalls = 0;
    await page.click('#csPanel [data-book="sc1"]');
    await page.waitForTimeout(800);
    check('one tap on Book sends exactly one booking', bookCalls === 1, `sent ${bookCalls}`);

    await page.click('#csPanel .cp-head [data-cp-close]');

    // ---- 4. Embeds ---------------------------------------------------------
    console.log('\nEmbeds');
    await page.click('#toolGrid a:has-text("Embeds")');
    await page.waitForSelector('#cePanel:not(.cp-hidden)', { timeout: 5000 });
    check('the Embeds tile opens the builder', true);

    const snippet = await page.inputValue('#ceSnippet');
    check('the snippet is an iframe', /^<iframe/.test(snippet.trim()), snippet.slice(0, 40));
    check('…carrying the VA’s own code, not a placeholder', /va=TST/.test(snippet), snippet.slice(0, 160));
    const previewSrc = await page.getAttribute('#cePreview', 'src');
    check('the preview renders the exact URL being handed over',
        snippet.includes(previewSrc), previewSrc);

    // The sentence that matters most on this panel.
    await page.click('[data-pick="map"]');
    await page.waitForTimeout(300);
    check('map mode warns whose Mapbox account is billed',
        /billed?|bills/i.test(await page.textContent('.ce-cost')) && /your own mapbox/i.test(await page.textContent('.ce-cost')));

    await page.click('[data-pick="notices"]');
    await page.waitForTimeout(300);
    const noticeSnippet = await page.inputValue('#ceSnippet');
    check('the noticeboard widget is keyed by slug', /embed-crew\.html/.test(noticeSnippet) && /va=testva/.test(noticeSnippet),
        noticeSnippet.slice(0, 160));
    await page.click('#cePanel .cp-head [data-cp-close]');

    // ---- 5. Partnership ----------------------------------------------------
    console.log('\nPartnership');
    await page.click('#toolGrid a:has-text("Partnership")');
    await page.waitForSelector('#cptPanel:not(.cp-hidden)', { timeout: 5000 });
    const partner = await page.textContent('#cptPanel');
    check('the Partnership tile opens the panel', true);
    // A warning nobody reads is the failure this panel exists to prevent, so
    // the reason has to be on screen — not behind a link to another product.
    check('an active warning is shown in full', /Banner exceeded the size limit/.test(partner), partner.trim().slice(0, 120));
    check('standing is stated', /First warning/.test(partner));
    check('unaccepted terms are called out', /Not accepted yet/.test(partner));
    check('a feed waiting on us says so', /Waiting on us/.test(partner));
    check('every action links out to the portal',
        (await page.$$('#cptPanel a[href*="va-portal"]')).length >= 2);
    await page.click('#cptPanel .cp-head [data-cp-close]');

    const ours = errors.filter((e) => !/Failed to load resource|tailwind is not defined|lucide/i.test(e));
    check('no page errors of our own', ours.length === 0, ours.join(' | '));
    await page.screenshot({ path: path.join(__dirname, 'crew-center-panels.png') });
    await page.close();

    // ---- 6. A database too old for the schedule ---------------------------
    // "Nothing scheduled" and "your database can't hold a schedule" look
    // identical on screen, and only one of them is something the VA can act on.
    console.log('\nAn out-of-date database');
    {
        const { page: p2 } = await openDash((route) => {
            const u = new URL(route.request().url()).pathname;
            if (u.endsWith('/schedules')) {
                return route.fulfill({
                    status: 409,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        error: 'This crew center’s project does not have the schedule tables yet. Re-run the setup SQL (Settings → Data store) to add them.',
                        code: 'store_schedules_missing',
                    }),
                });
            }
            return api(route);
        });
        await p2.click('button:has-text("Schedule")');
        await p2.waitForTimeout(700);
        const body = await p2.textContent('#csPanel');
        check('the panel names the missing tables rather than saying "nothing scheduled"',
            /schedule tables yet/.test(body) && !/Nothing scheduled yet/.test(body), body.trim().slice(0, 120));
        check('…and offers the button that fixes it', await p2.isVisible('[data-cp-fix-store]'));
        await p2.close();
    }

    // ---- 7. A staff member, who may not see the partnership ---------------
    console.log('\nA staff member opening the partnership');
    {
        const { page: p3 } = await openDash((route) => {
            const u = new URL(route.request().url()).pathname;
            if (u.endsWith('/partnership')) {
                return route.fulfill({
                    status: 403, contentType: 'application/json',
                    body: JSON.stringify({ error: 'Only the VA owner can see the partnership.' }),
                });
            }
            return api(route);
        });
        await p3.click('#toolGrid a:has-text("Partnership")');
        await p3.waitForTimeout(700);
        const body = await p3.textContent('#cptPanel');
        check('a refusal is explained, not reported as a fault',
            /Only the VA owner/.test(body) && !/went wrong/.test(body), body.trim().slice(0, 120));
        await p3.close();
    }

    // ---- 8. The rules a VA sets ------------------------------------------
    // The panel must SAY why a leg is closed, not just fail to offer it. A
    // greyed button with no reason is what sends a pilot to ask staff.
    console.log('\nThe VA\u2019s own booking rules');
    {
        scheduleRules = { enabled: true, booking: 'staff', minRank: '', maxPerPilot: 0, openDaysAhead: 0, cancelHoursBefore: 0 };
        schedules = schedules.map((s) => ({
            ...s,
            refusal: { code: 'staff_assigned', message: 'Your staff assign the flying on this schedule — ask them for a leg.', opensAt: null },
        }));
        const { page: p4 } = await openDash();
        await p4.click('button:has-text("Schedule")');
        await p4.waitForTimeout(900);
        const body = await p4.textContent('#csPanel');
        check('the rules are stated once at the top', /Staff assign the flying/.test(body), body.trim().slice(0, 110));
        check('a refused leg offers no Book button', (await p4.$$('#csPanel [data-book]')).length === 0);
        check('…and says why instead', /Staff assigned/.test(body));
        await p4.close();

        // Off entirely: the tile and the hero button go with it.
        scheduleRules = { ...scheduleRules, enabled: false };
        const { page: p5 } = await openDash();
        await p5.waitForTimeout(400);
        check('a VA that turned the schedule off gets no hero button',
            await p5.isHidden('#heroScheduleBtn'));
        const tiles = await p5.textContent('#toolGrid');
        check('…and no Schedules tile', !/Schedules/.test(tiles));
        await p5.close();

        scheduleRules = { enabled: true, booking: 'pilots', minRank: '', maxPerPilot: 0, openDaysAhead: 0, cancelHoursBefore: 0 };
        schedules = schedules.map(({ refusal, ...s }) => s);
    }

    // ---- 9. On a phone ----------------------------------------------------
    // Not "does it fit" — does it become the right SHAPE. A slide-over squeezed
    // to 390px is not a mobile layout, it is a desktop one with less room.
    console.log('\nOn a phone');
    {
        const phone = await browser.newPage({
            viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
            deviceScaleFactor: 3,
        });
        await phone.route('**/api/**', (r) => api(r));
        await phone.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })));
        await phone.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await phone.waitForTimeout(1800);

        const noHScroll = await phone.evaluate(() =>
            document.documentElement.scrollWidth <= window.innerWidth + 1);
        check('the dashboard does not scroll sideways', noHScroll);

        await phone.click('button:has-text("Schedule")');
        await phone.waitForSelector('#csPanel:not(.cp-hidden)');
        await phone.waitForTimeout(600);

        const sheet = await phone.evaluate(() => {
            const el = document.querySelector('#csPanel .cp-sheet');
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
                full: Math.abs(r.width - window.innerWidth) < 2,
                onBottom: Math.abs(r.bottom - window.innerHeight) < 2,
                leavesTop: r.top > 0,
                rounded: parseFloat(cs.borderTopLeftRadius) > 4,
            };
        });
        check('the panel is a bottom sheet, not a squeezed slide-over',
            sheet.full && sheet.onBottom && sheet.leavesTop, JSON.stringify(sheet));
        check('…with a rounded top edge', sheet.rounded);

        // The page behind must not scroll under the sheet.
        check('the page behind is locked while it is open',
            await phone.evaluate(() => getComputedStyle(document.body).position === 'fixed'));

        // Every control has to be reachable by a thumb.
        const small = await phone.evaluate(() => {
            const bad = [];
            document.querySelectorAll('#csPanel button').forEach((b) => {
                const r = b.getBoundingClientRect();
                if (r.width && r.height && r.height < 40) bad.push((b.textContent || b.ariaLabel || '?').trim().slice(0, 20));
            });
            return bad;
        });
        check('every control in the panel is a real tap target', small.length === 0, small.join(', '));

        const rowShape = await phone.evaluate(() => {
            const row = document.querySelector('#csPanel .cs-row');
            if (!row) return null;
            return getComputedStyle(row).flexDirection;
        });
        check('schedule rows stack rather than wrapping a desktop row', rowShape === 'column', String(rowShape));

        await phone.click('#csPanel .cp-head [data-cp-close]');
        await phone.waitForTimeout(300);
        check('closing it gives the page back',
            await phone.evaluate(() => getComputedStyle(document.body).position !== 'fixed'));

        await phone.screenshot({ path: path.join(__dirname, 'crew-center-mobile.png') });
        await phone.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} failure(s)\n` : '\nAll good.\n');
    process.exit(failures ? 1 : 0);
})();
