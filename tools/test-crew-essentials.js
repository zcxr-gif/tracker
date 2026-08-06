// test-crew-essentials.js
// Drives the REAL crew-dashboard.html and crew-pilot.html against a faked crew
// center to prove the two things a crew center could not do before this change:
// keep the airline's manuals, and say something to one pilot.
//
// What is checked, and why each one is the case that would actually break:
//
//   THE LIBRARY
//   * the Documents tile opens the library and lists what the backend returned
//   * a rank-gated document a pilot cannot read is still LISTED, as a title with
//     a lock and the hours to go — hiding it means a pilot cannot work towards it
//   * and its content never reaches the page: no body, no link, no file URL, for
//     a locked row. This is the leak the whole feature has to not have.
//   * switching a document's source clears the fields it is not using, so a VA
//     who pastes a link over a half-written body does not leave a second, stale
//     copy of the manual behind
//   * a written document's body is rendered as TEXT — a manual containing
//     <script> or <img onerror> must not execute against the whole roster
//   * saving sends what was typed, including the rank gate
//   * a database too old for the library says so and offers the update button,
//     rather than showing an empty shelf — those look identical and only one is
//     actionable
//
//   THE INBOX
//   * a pilot's unread messages paint a badge on their Messages tile, and the
//     badge goes when they have been read
//   * opening the inbox marks what was on screen read (after the settle delay)
//   * a staff member gets a compose form; the audience picker offers the rank
//     band Discord cannot express, and picking it sends the rank
//   * the pilot list is fetched when compose is opened, NOT taken from a roster
//     the dashboard may not have loaded yet
//   * a half-typed message survives the roster landing — the bug a re-render
//     would have introduced
//   * a message body is rendered as text, same reasoning as the library
//
//   THE LINKS BOARD
//   * the board is painted into the PAGE, not behind a panel — a quick link you
//     have to open a panel to reach is not quick
//   * a tile is a real <a href> with rel="noopener noreferrer" and target=_blank
//   * a rank-gated tile is drawn WITHOUT an anchor at all: there is no address to
//     put in one, and a link that looks clickable and does nothing is worse than
//     one that says why
//   * a gated tile's address is nowhere in the DOM
//   * opening a tile tells the backend, so staff can see what the crew uses
//   * staff can add a link, and a javascript: URL is refused with the backend's
//     own reason rather than silently becoming a tile
//   * reordering sends the whole new order, not just the moved tile
//
// Run:  node tools/test-crew-essentials.js
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

const RANKS = [
    { name: 'Cadet', minHours: 0 },
    { name: 'First Officer', minHours: 100 },
    { name: 'Captain', minHours: 300 },
];

// The library as the BACKEND would return it for a pilot on 88 hours: the gated
// row arrives already stripped, because crewDocs.visibleTo did that server-side.
// The fake has to behave the same way or the test would be proving the panel
// hides something it was handed, which is not the guarantee being made.
const XSS = '<img src=x onerror="window.__pwned=1">';
const lockedDoc = {
    id: 'd3', title: 'Captain SOP', summary: 'Long-haul procedures.', kind: 'sop', source: 'file',
    body: '', linkUrl: '', fileUrl: '', fileName: '', fileSize: 0,
    minRank: 'Captain', locked: true, hoursUntilUnlock: 212,
    pinned: false, status: 'published', revision: 'Rev B', revisedAt: hoursFromNow(-200),
    authorName: 'Ops', createdAt: hoursFromNow(-900), updatedAt: hoursFromNow(-200),
};
let documents = [
    {
        id: 'd1', title: 'Operations Manual', summary: 'How we fly — read this first.',
        kind: 'manual', source: 'text', body: `Fuel policy.\nSecond line.\n${XSS}`,
        linkUrl: '', fileUrl: '', fileName: '', fileSize: 0,
        minRank: '', locked: false, hoursUntilUnlock: 0,
        pinned: true, status: 'published', revision: 'Rev C', revisedAt: hoursFromNow(-72),
        authorName: 'Ops', createdAt: hoursFromNow(-1000), updatedAt: hoursFromNow(-72),
    },
    {
        id: 'd2', title: 'Uniform policy', summary: '', kind: 'policy', source: 'link',
        body: '', linkUrl: 'https://example.com/uniform', fileUrl: '', fileName: '', fileSize: 0,
        minRank: '', locked: false, hoursUntilUnlock: 0,
        pinned: false, status: 'published', revision: '', revisedAt: null,
        authorName: '', createdAt: hoursFromNow(-500), updatedAt: hoursFromNow(-500),
    },
    lockedDoc,
];

let messages = [
    {
        id: 'n1', title: 'You’re now First Officer', body: `Up from Cadet.\n${XSS}`, kind: 'promotion',
        refId: 'm2', linkUrl: '', senderName: '', readAt: null, createdAt: hoursFromNow(-2),
    },
    {
        id: 'n2', title: 'You’re flying BA117', body: 'EGLL–KJFK. Departs tomorrow.', kind: 'booking',
        refId: 'sc1', linkUrl: '', senderName: 'Ops', readAt: null, createdAt: hoursFromNow(-20),
    },
    {
        id: 'n3', title: 'Welcome to Test VA', body: 'Your application was accepted.', kind: 'application',
        refId: 'm2', linkUrl: '', senderName: 'Ops', readAt: hoursFromNow(-400), createdAt: hoursFromNow(-500),
    },
];

// The board as the backend would return it. The gated tile arrives with `url`
// already emptied, because crewLinks.visibleTo did that server-side — the fake
// has to behave the same way or the test proves the panel hides something it was
// handed, which is not the guarantee.
let links = [
    {
        id: 'k1', title: 'Discord', url: 'https://discord.gg/testva', description: 'Where we fly together',
        category: 'community', icon: 'message-circle', minRank: '', locked: false, hoursUntilUnlock: 0,
        pinned: true, status: 'published', sortOrder: 1, opens: 42, lastOpenedAt: hoursFromNow(-1),
        host: 'discord.gg', createdAt: hoursFromNow(-900),
    },
    {
        id: 'k2', title: 'SimBrief', url: 'https://simbrief.com/', description: 'Plan your fuel',
        category: 'tools', icon: 'route', minRank: '', locked: false, hoursUntilUnlock: 0,
        pinned: false, status: 'published', sortOrder: 0, opens: 8, lastOpenedAt: null,
        host: 'simbrief.com', createdAt: hoursFromNow(-800),
    },
    {
        id: 'k3', title: 'Staff ops toolkit', url: '', description: 'Rostering tools',
        category: 'tools', icon: 'wrench', minRank: 'Captain', locked: true, hoursUntilUnlock: 212,
        pinned: false, status: 'published', sortOrder: 0, opens: 0, lastOpenedAt: null,
        host: '', createdAt: hoursFromNow(-700),
    },
];
const CATEGORIES = ['community', 'tools', 'charts', 'downloads', 'training', 'forms', 'social', 'other'];

const roster = [
    { id: 'm1', name: 'Rae Okafor', callsign: 'BAW22', hours: 412, rank: { name: 'Captain' }, status: 'active', aircraft: [] },
    { id: 'm2', name: 'Jo Adeyemi', callsign: 'BAW71', hours: 88, rank: { name: 'First Officer' }, status: 'active', aircraft: [] },
];

const CAPABILITIES = [
    { id: 'roster.manage', group: 'Roster', label: 'Add, edit & remove pilots' },
    { id: 'documents.manage', group: 'Communications', label: 'Publish & manage the document library' },
    { id: 'members.message', group: 'Communications', label: 'Message pilots individually or by rank' },
];

// What the page did, so a check can assert on the REQUEST rather than on the
// optimistic redraw — the redraw is the thing most likely to be right by
// accident.
let savedDoc = null;
let sentMessage = null;
let readCalls = [];
let rosterFetches = 0;
let savedLink = null;
let openedLink = null;
let sentOrder = null;

function api(route, over = {}) {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (over[p + ':' + method]) return over[p + ':' + method](route, json);

    // ---- the library ----
    if (p.endsWith('/documents') && method === 'GET') {
        return json({
            documents,
            summary: {
                total: documents.length,
                open: documents.filter((d) => !d.locked).length,
                locked: documents.filter((d) => d.locked).length,
                pinned: documents.filter((d) => d.pinned).length,
            },
            canManage: true,
        });
    }
    if (p.endsWith('/documents') && method === 'POST') {
        savedDoc = route.request().postDataJSON();
        const d = { ...documents[0], ...savedDoc, id: 'd9', locked: false, hoursUntilUnlock: 0 };
        documents = [...documents, d];
        return json({ document: d }, 201);
    }
    if (/\/documents\/[\w-]+$/.test(p) && method === 'GET') {
        const id = p.split('/').pop();
        const d = documents.find((x) => x.id === id);
        return d ? json({ document: d, canManage: true }) : json({ error: 'Document not found.' }, 404);
    }
    if (/\/documents\/[\w-]+$/.test(p) && method === 'PATCH') {
        savedDoc = route.request().postDataJSON();
        const id = p.split('/').pop();
        documents = documents.map((x) => (x.id === id ? { ...x, ...savedDoc } : x));
        return json({ document: documents.find((x) => x.id === id) });
    }
    if (/\/documents\/[\w-]+$/.test(p) && method === 'DELETE') return json({ ok: true });

    // ---- the inbox ----
    if (p.endsWith('/inbox') && method === 'GET') {
        return json({
            messages,
            total: messages.length,
            unread: messages.filter((m) => !m.readAt).length,
            badge: messages.filter((m) => !m.readAt).length,
        });
    }
    if (p.endsWith('/inbox/read') && method === 'POST') {
        const b = route.request().postDataJSON() || {};
        readCalls.push(b);
        const now = new Date().toISOString();
        const ids = new Set(b.ids || []);
        messages = messages.map((m) => (b.all || ids.has(m.id) ? { ...m, readAt: m.readAt || now } : m));
        return json({ ok: true, marked: ids.size });
    }
    if (p.endsWith('/inbox/send') && method === 'POST') {
        sentMessage = route.request().postDataJSON();
        return json({ sent: 7 }, 201);
    }
    if (/\/inbox\/[\w-]+$/.test(p) && method === 'DELETE') return json({ ok: true });

    // ---- the links board ----
    if (p.endsWith('/links') && method === 'GET') {
        const visible = links;
        const sections = CATEGORIES
            .map((c) => ({ category: c, links: visible.filter((l) => l.category === c) }))
            .filter((s2) => s2.links.length);
        return json({
            links: visible,
            sections,
            summary: {
                total: visible.length,
                locked: visible.filter((l) => l.locked).length,
                pinned: visible.filter((l) => l.pinned).length,
                opens: visible.reduce((n, l) => n + (l.opens || 0), 0),
            },
            categories: CATEGORIES,
            canManage: true,
        });
    }
    if (p.endsWith('/links') && method === 'POST') {
        savedLink = route.request().postDataJSON();
        // The backend's URL allowlist, as the real one behaves: refused with a
        // reason rather than stored. crewLinks.safeUrl is tested properly in the
        // backend repo; this is here so the PANEL is proven to surface the reason.
        if (/^\s*[a-z]+script\s*:|^\s*data\s*:/i.test(savedLink.url || '')) {
            return json({ error: 'Links have to start with http:// or https://.' }, 400);
        }
        const l = {
            id: 'k9', ...savedLink, locked: false, hoursUntilUnlock: 0, opens: 0,
            lastOpenedAt: null, host: 'example.com', sortOrder: 0,
            category: savedLink.category || 'other', icon: savedLink.icon || 'link',
            createdAt: new Date().toISOString(),
        };
        links = [...links, l];
        return json({ link: l }, 201);
    }
    if (p.endsWith('/links/order') && method === 'POST') {
        sentOrder = route.request().postDataJSON();
        return json({ ok: true, moved: (sentOrder.ids || []).length });
    }
    if (/\/links\/[\w-]+\/open$/.test(p) && method === 'POST') {
        openedLink = p.split('/').slice(-2)[0];
        return json({ ok: true, opens: 43 });
    }
    if (/\/links\/[\w-]+$/.test(p) && method === 'PATCH') {
        savedLink = route.request().postDataJSON();
        return json({ link: { ...links[0], ...savedLink } });
    }
    if (/\/links\/[\w-]+$/.test(p) && method === 'DELETE') return json({ ok: true });

    // ---- everything else the pages need to boot ----
    if (p.endsWith('/roster')) { rosterFetches += 1; return json({ roster }); }
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: true });
    if (p.endsWith('/schedules')) return json({ schedules: [], mine: [], canManage: true, rules: { enabled: false }, ranks: RANKS });
    if (p.endsWith('/routes')) return json({ routes: [], counts: {}, partners: [], ranks: RANKS });
    if (p.endsWith('/events')) return json({ events: [], mine: [], canManage: true, ranks: RANKS });
    if (p.includes('/api/va-ads/by-slug/')) return json({ name: 'Test VA', code: 'TST', ranks: RANKS });
    if (p.endsWith('/me/pilot')) return json({ linkable: true, linked: true, pilot: { memberId: 'm2', name: 'Jo Adeyemi', callsign: 'BAW71', hours: 88 } });
    if (p.endsWith('/me/flying')) return json({ flights: [], totals: {} });
    if (p.endsWith('/me')) return json({
        role: 'owner', caps: CAPABILITIES.map((c) => c.id), capabilities: CAPABILITIES,
        rolePresets: [], staffRoles: [], staffAssignments: [],
    });
    if (p.endsWith('/stats')) return json({ ok: true, connected: true, stats: { pilots: 2, hours: 500, flights30d: 1, pireps: 4 } });
    if (p.endsWith('/pireps')) return json({ pireps: [], canManage: true });
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

    const openPage = async (file, routeHandler) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/**', routeHandler || ((r) => api(r)));
        await page.addInitScript(() => localStorage.setItem('crew:session:testva',
            JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })));
        await page.goto(`http://127.0.0.1:${port}/${file}?va=testva`);
        await page.waitForTimeout(1800);
        return { page, errors };
    };

    /* =====================================================================
     * THE LIBRARY, on the staff dashboard
     * =================================================================== */
    console.log('\nThe document library');
    const { page, errors } = await openPage('crew-dashboard.html');

    await page.click('#toolGrid a:has-text("Documents")');
    await page.waitForSelector('#cd-panel:not(.cp-hidden)', { timeout: 5000 });
    check('the Documents tile opens the library', true);

    const listText = await page.textContent('#cd-panel');
    check('the manual is listed', /Operations Manual/.test(listText));
    check('so is the linked policy', /Uniform policy/.test(listText));
    check('the revision label is on the card', /Rev C/.test(listText));

    // The gated one. Listed — not hidden — so a pilot can see there is something
    // to work towards, which is the whole reason it is not filtered out.
    check('a rank-gated document is still listed, by title', /Captain SOP/.test(listText));

    // ---- the leak that must not exist -------------------------------------
    const lockedHtml = await page.evaluate(() => {
        const card = [...document.querySelectorAll('#cd-panel .cd-card')]
            .find((c) => c.textContent.includes('Captain SOP'));
        return card ? card.outerHTML : '';
    });
    check('a locked document\'s content is nowhere in the page',
        !!lockedHtml && !/Long-haul procedures[\s\S]*sop\.pdf/.test(lockedHtml)
            && !lockedHtml.includes('.pdf') && !lockedHtml.includes('http'),
        lockedHtml.slice(0, 120));

    // ---- the manual, read ------------------------------------------------
    await page.click('#cd-panel .cd-card:has-text("Operations Manual")');
    await page.waitForTimeout(500);
    const readText = await page.textContent('#cd-panel');
    check('opening the manual shows its body', /Fuel policy/.test(readText));
    check('line breaks in the body survive', /Second line/.test(readText));

    // The one that would be a whole-roster XSS: a manual is written by staff and
    // read by every pilot, so its body must never be parsed as markup.
    const pwned = await page.evaluate(() => !!window.__pwned);
    check('a document body is rendered as text, not markup', !pwned);
    check('…and the markup is visible as the characters it is',
        /<img src=x/.test(readText));

    await page.click('[data-cd-back]');
    await page.waitForTimeout(300);

    /* =====================================================================
     * THE EDITOR
     * =================================================================== */
    console.log('\nThe editor');
    await page.click('[data-cd-new]');
    await page.waitForSelector('#cd-title', { timeout: 5000 });
    check('staff get a new-document form', true);

    // The source switch. A body typed and then abandoned for a link must not
    // survive as an invisible second version of the document.
    await page.fill('#cd-title', 'Winter ops brief');
    await page.fill('#cd-body', 'This should not be saved once a link is chosen.');
    // Clicked on the LABEL, which is what a reader does — the radio itself is
    // visually hidden inside it.
    await page.click('.cd-src:has-text("Linked")');
    await page.waitForTimeout(200);
    check('choosing "linked" hides the body field',
        await page.isHidden('#cd-body'));
    check('…and shows the link field',
        await page.isVisible('#cd-linkUrl'));
    await page.fill('#cd-linkUrl', 'https://example.com/winter');

    // The rank gate is the access-control decision, so it has to actually reach
    // the request rather than only being drawn.
    await page.selectOption('#cd-minRank', 'Captain');
    check('the rank picker offers the VA’s own ladder',
        (await page.$$eval('#cd-minRank option', (o) => o.map((x) => x.value))).includes('Captain'));

    await page.selectOption('#cd-status', 'published');
    await page.click('#cd-panel button[type="submit"]');
    await page.waitForTimeout(800);

    check('saving sends the title', savedDoc && savedDoc.title === 'Winter ops brief', JSON.stringify(savedDoc));
    check('…the chosen source', savedDoc && savedDoc.source === 'link');
    check('…the link', savedDoc && savedDoc.linkUrl === 'https://example.com/winter');
    check('…the rank gate', savedDoc && savedDoc.minRank === 'Captain');
    check('…the published status', savedDoc && savedDoc.status === 'published');
    check('and the abandoned body is NOT sent',
        savedDoc && !String(savedDoc.body || '').includes('should not be saved'),
        JSON.stringify(savedDoc && savedDoc.body));

    check('no page errors on the dashboard', errors.length === 0, errors.join(' | '));
    await page.close();

    /* =====================================================================
     * A DATABASE TOO OLD FOR THE LIBRARY
     * =================================================================== */
    console.log('\nAn out-of-date database');
    const gap = await openPage('crew-dashboard.html', (r) => api(r, {
        [`/api/crew/testva/documents:GET`]: (route, json) => json({
            error: 'This crew center’s project does not have the document library yet. Re-run the setup SQL (Settings → Data store) to add it.',
            code: 'store_documents_missing',
        }, 409),
    }));
    await gap.page.click('#toolGrid a:has-text("Documents")');
    await gap.page.waitForSelector('#cd-panel:not(.cp-hidden)', { timeout: 5000 });
    const gapText = await gap.page.textContent('#cd-panel');
    check('an old database says so, rather than showing an empty shelf',
        /does not have the document library yet/.test(gapText), gapText.trim().slice(0, 100));
    check('…and offers the button that fixes it',
        await gap.page.isVisible('#cd-panel [data-cp-fix-store]'));
    await gap.page.close();

    /* =====================================================================
     * THE INBOX, on the pilot page
     * =================================================================== */
    console.log('\nA pilot’s inbox');
    readCalls = [];
    const pilot = await openPage('crew-pilot.html');

    const badge = await pilot.page.textContent('#inboxBadge').catch(() => '');
    check('unread messages paint a badge on the Messages tile', /2/.test(badge), JSON.stringify(badge));

    // Against the fake's CURRENT length, not a literal: the dashboard section
    // above created a document, and the fake keeps its state across pages the way
    // a real backend would.
    const docsCount = await pilot.page.textContent('#docsCount').catch(() => '');
    check('the Documents tile carries a real count',
        docsCount.includes(`${documents.length} documents`), JSON.stringify(docsCount));
    check('…and says how many are further up the ladder',
        /1 higher up/.test(docsCount), JSON.stringify(docsCount));

    await pilot.page.click('#quickGrid a:has-text("Messages")');
    await pilot.page.waitForSelector('#ci-panel:not(.cp-hidden)', { timeout: 5000 });
    const inboxText = await pilot.page.textContent('#ci-panel');
    check('the inbox lists the promotion', /now First Officer/.test(inboxText));
    check('…and the departure staff put them on', /flying BA117/.test(inboxText));
    check('…and one already read', /Welcome to Test VA/.test(inboxText));

    const inboxPwned = await pilot.page.evaluate(() => !!window.__pwned);
    check('a message body is rendered as text, not markup', !inboxPwned);

    // Marked read on a delay, so opening and immediately closing does not clear
    // a notice nobody read.
    check('nothing is marked read instantly', readCalls.length === 0, JSON.stringify(readCalls));
    await pilot.page.waitForTimeout(1600);
    check('what was on screen is marked read shortly after',
        readCalls.length === 1 && Array.isArray(readCalls[0].ids) && readCalls[0].ids.length === 2,
        JSON.stringify(readCalls));

    await pilot.page.waitForTimeout(300);
    const badgeAfter = await pilot.page.textContent('#inboxBadge').catch(() => '');
    check('and the badge clears', !/[12]/.test(badgeAfter), JSON.stringify(badgeAfter));

    check('a pilot is not offered a compose form',
        !(await pilot.page.isVisible('[data-ci-new]').catch(() => false)));
    check('no page errors on the pilot page', pilot.errors.length === 0, pilot.errors.join(' | '));
    await pilot.page.close();

    /* =====================================================================
     * STAFF SENDING A MESSAGE
     * =================================================================== */
    console.log('\nStaff messaging the crew');
    rosterFetches = 0;
    const staff = await openPage('crew-dashboard.html');

    await staff.page.click('#toolGrid a:has-text("Messages")');
    await staff.page.waitForSelector('#ci-panel:not(.cp-hidden)', { timeout: 5000 });
    check('the Messages tile opens', true);
    check('staff holding members.message get a compose button',
        await staff.page.isVisible('[data-ci-new]'));

    await staff.page.click('[data-ci-new]');
    await staff.page.waitForSelector('#ci-title', { timeout: 5000 });

    // Typed BEFORE the roster lands, to prove the lazy fetch does not wipe it.
    // This is the race a re-render would have lost.
    await staff.page.fill('#ci-title', 'New fuel policy');
    await staff.page.fill('#ci-body', 'Read it before your next flight.');
    await staff.page.waitForTimeout(900);
    check('the roster is fetched for the pilot picker', rosterFetches >= 1, String(rosterFetches));
    check('a half-typed message survives the roster landing',
        (await staff.page.inputValue('#ci-title')) === 'New fuel policy'
        && (await staff.page.inputValue('#ci-body')) === 'Read it before your next flight.');

    // The audience Discord cannot express, which is the reason the feature exists.
    await staff.page.click('.ci-aud:has-text("A rank and above")');
    await staff.page.waitForTimeout(200);
    check('choosing "a rank and above" shows the rank picker',
        await staff.page.isVisible('#ci-minRank'));
    await staff.page.selectOption('#ci-minRank', 'Captain');

    await staff.page.click('#ci-panel button[type="submit"]');
    await staff.page.waitForTimeout(800);
    check('sending sends the subject', sentMessage && sentMessage.title === 'New fuel policy', JSON.stringify(sentMessage));
    check('…the body', sentMessage && /before your next flight/.test(sentMessage.body || ''));
    check('…the audience', sentMessage && sentMessage.audience === 'rank');
    check('…and the rank it goes to', sentMessage && sentMessage.minRank === 'Captain');

    // Picking named pilots instead.
    await staff.page.click('[data-ci-new]');
    await staff.page.waitForSelector('#ci-title', { timeout: 5000 });
    await staff.page.fill('#ci-title', 'A word with you');
    await staff.page.click('.ci-aud:has-text("Named pilots")');
    await staff.page.waitForTimeout(400);
    const pilotNames = await staff.page.textContent('#ci-panel [data-ci-pilots]');
    check('the pilot picker lists the roster', /Jo Adeyemi/.test(pilotNames), pilotNames.trim().slice(0, 80));
    await staff.page.check('.ci-pilot input[value="m2"]');
    await staff.page.click('#ci-panel button[type="submit"]');
    await staff.page.waitForTimeout(800);
    check('a named send carries the pilot ids',
        sentMessage && Array.isArray(sentMessage.memberIds) && sentMessage.memberIds.includes('m2'),
        JSON.stringify(sentMessage && sentMessage.memberIds));

    check('no page errors while messaging', staff.errors.length === 0, staff.errors.join(' | '));
    await staff.page.close();

    /* =====================================================================
     * THE LINKS BOARD
     * =================================================================== */
    console.log('\nThe quick-links board');
    openedLink = null;
    sentOrder = null;
    const lk = await openPage('crew-pilot.html');

    // On the PAGE, not behind a panel. That is the whole design decision.
    const boardText = await lk.page.textContent('#linksBoard').catch(() => '');
    check('the board is painted into the page, no panel opened',
        /Discord/.test(boardText) && /SimBrief/.test(boardText), boardText.trim().slice(0, 90));
    check('the section is revealed once it has tiles',
        !(await lk.page.getAttribute('#linksSec', 'class') || '').includes('cp-hidden'));
    check('tiles are grouped into sections',
        /Community/i.test(boardText) && /Tools/i.test(boardText));

    // A real anchor, opened safely.
    const anchor = await lk.page.evaluate(() => {
        const a = document.querySelector('#linksBoard a[data-cl-open="k1"]');
        return a ? { href: a.getAttribute('href'), target: a.target, rel: a.rel } : null;
    });
    check('a tile is a real link to the address', anchor && anchor.href === 'https://discord.gg/testva',
        JSON.stringify(anchor));
    check('…opened in a new tab', anchor && anchor.target === '_blank');
    check('…with noopener and noreferrer',
        anchor && /noopener/.test(anchor.rel) && /noreferrer/.test(anchor.rel), anchor && anchor.rel);

    // The gated one: no anchor at all, because there is no address to put in one.
    const lockedTile = await lk.page.evaluate(() => {
        const t = [...document.querySelectorAll('#linksBoard .cl-tile')]
            .find((x) => x.textContent.includes('Staff ops toolkit'));
        return t ? { tag: t.tagName, html: t.outerHTML } : null;
    });
    check('a gated tile is still shown, so a pilot knows it exists', !!lockedTile);
    check('…drawn as text, not as a link that does nothing',
        lockedTile && lockedTile.tag !== 'A', lockedTile && lockedTile.tag);
    check('…saying which rank opens it',
        lockedTile && /Captain/.test(lockedTile.html));
    check('…and its address is nowhere in the tile',
        lockedTile && !/href/.test(lockedTile.html) && !/example\.com/.test(lockedTile.html));

    // Opening one tells the backend, which is what makes the usage figure real.
    await lk.page.evaluate(() => {
        // Prevented, so the test does not actually navigate to discord.gg — the
        // click still reaches the delegated listener, which is what is under test.
        document.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a) e.preventDefault(); }, true);
    });
    await lk.page.click('#linksBoard a[data-cl-open="k1"]');
    await lk.page.waitForTimeout(700);
    check('opening a tile is reported to the backend', openedLink === 'k1', String(openedLink));

    check('no page errors from the board', lk.errors.length === 0, lk.errors.join(' | '));
    await lk.page.close();

    /* =====================================================================
     * CURATING THE BOARD
     * =================================================================== */
    console.log('\nCurating the board');
    const cur = await openPage('crew-dashboard.html');

    // The dashboard gets a compact strip too.
    const strip = await cur.page.textContent('#linksBoard').catch(() => '');
    check('the dashboard carries the board as a strip', /Discord/.test(strip), strip.trim().slice(0, 80));

    await cur.page.click('#toolGrid a:has-text("Quick links")');
    await cur.page.waitForSelector('#cl-panel:not(.cp-hidden)', { timeout: 5000 });
    check('the Quick links tile opens the manager', true);

    const manageText = await cur.page.textContent('#cl-panel');
    check('staff see how often each tile is used', /opened 42 times/.test(manageText), manageText.trim().slice(0, 120));
    check('…and which have never been opened', /never opened/.test(manageText));

    // A javascript: URL must be refused by the backend and SAID, not swallowed.
    await cur.page.click('[data-cl-new]');
    await cur.page.waitForSelector('#cl-url', { timeout: 5000 });
    await cur.page.fill('#cl-url', 'javascript:alert(1)');
    await cur.page.click('#cl-panel button[type="submit"]');
    await cur.page.waitForTimeout(700);
    const toast = await cur.page.textContent('#cp-toasts').catch(() => '');
    check('a javascript: URL is refused, with the reason shown',
        /have to start with http/i.test(toast), toast.trim().slice(0, 90));
    check('…and no tile was created for it',
        !(await cur.page.textContent('#cl-panel')).includes('javascript:'));

    // A good one goes through.
    await cur.page.fill('#cl-url', 'example.com/liveries');
    await cur.page.fill('#cl-title', 'Livery pack');
    await cur.page.selectOption('#cl-category', 'downloads');
    await cur.page.click('#cl-panel button[type="submit"]');
    await cur.page.waitForTimeout(800);
    check('a bare host is accepted and sent as typed',
        savedLink && savedLink.url === 'example.com/liveries', JSON.stringify(savedLink && savedLink.url));
    check('…with the label', savedLink && savedLink.title === 'Livery pack');
    check('…and the section chosen', savedLink && savedLink.category === 'downloads');

    // Reordering sends the WHOLE order, because moving one tile renumbers the rest.
    await cur.page.waitForTimeout(300);
    const downBtns = await cur.page.$$('#cl-panel [data-cl-down]:not([disabled])');
    if (downBtns.length) {
        await downBtns[0].click();
        await cur.page.waitForTimeout(800);
        check('reordering sends the whole new order',
            sentOrder && Array.isArray(sentOrder.ids) && sentOrder.ids.length >= 2,
            JSON.stringify(sentOrder));
        check('…with the moved tile in its new place',
            sentOrder && sentOrder.ids[0] !== 'k1', JSON.stringify(sentOrder && sentOrder.ids.slice(0, 2)));
    } else {
        check('reordering sends the whole new order', false, 'no enabled move-down button found');
    }

    check('no page errors while curating', cur.errors.length === 0, cur.errors.join(' | '));
    await cur.page.close();

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} failed ❌\n` : '\nAll good ✅\n');
    process.exit(failures ? 1 : 0);
})();
