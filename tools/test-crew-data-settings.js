// test-crew-data-settings.js
// Drives the REAL crew-dashboard.html to prove the four things this change
// claims:
//
//   * Settings tabs group by subject — Alerts is its own tab rather than the
//     tail of Recruit, and Data carries the connection, the storage report and
//     bulk deletion instead of splitting them across two tabs
//   * the owner can see what is in each dataset and how much a purge would take
//     BEFORE running it
//   * deleting by age and wiping a dataset send what they say they send, and a
//     wipe that is not confirmed sends nothing
//   * a panel that throws mid-open gives the page back rather than leaving a
//     white screen — the reported "the window doesn't load, the page just goes
//     white", which is the scroll lock left on, not an empty panel
//
// Run:  node tools/test-crew-data-settings.js
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

let purgeCalls = [];
let datasets = [
    { id: 'pireps', label: 'Flight reports', total: 1284, matching: 903, dateColumn: 'flown_at' },
    { id: 'events', label: 'Events', total: 42, matching: 31, dateColumn: 'starts_at' },
    { id: 'schedules', label: 'Scheduled flights', total: 210, matching: 180, dateColumn: 'departs_at' },
    { id: 'applications', label: 'Applications', total: 66, matching: 40, dateColumn: 'created_at' },
    { id: 'announcements', label: 'Noticeboard posts', total: 0, matching: 0, dateColumn: 'created_at' },
];

function api(route) {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.endsWith('/data') && method === 'GET') {
        return json({ datasets, olderThanDays: Number(url.searchParams.get('olderThanDays')) || 365, minDays: 7, storeKind: 'supabase' });
    }
    if (/\/data\/\w+\/purge$/.test(p) && method === 'POST') {
        const body = route.request().postDataJSON() || {};
        const dataset = p.split('/').slice(-2)[0];
        purgeCalls.push({ dataset, ...body });
        const set = datasets.find((d) => d.id === dataset);
        return json({ deleted: body.all ? set.total : set.matching, dataset, label: set.label, all: !!body.all });
    }
    if (p.endsWith('/store/usage')) return json({ databaseBytes: 12e6, limitBytes: 500e6, percentUsed: 2.4, tables: [], health: { ok: true, provisioned: true, storage: true } });
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: true });
    if (p.endsWith('/me/pilot')) return json({ pilot: null, linkable: false });
    if (p.endsWith('/schedules')) return json({ schedules: [], mine: [], canManage: true, rules: { enabled: true }, ranks: [] });
    if (p.endsWith('/events')) return json({ events: [], canManage: true, mine: [], ranks: [] });
    if (p.endsWith('/branding')) return json({ name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial'] });
    if (p.endsWith('/me')) return json({ role: 'owner', capabilities: [], name: 'Owner' });
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

    const open = async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        await page.route('**/api/**', api);
        await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })));
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForTimeout(900);
        return { ctx, page };
    };

    const { ctx, page } = await open();

    // ------------------------------------------------------------------
    head('Settings group by subject');

    await page.evaluate(() => window.openSettings());
    await page.waitForTimeout(200);

    const tabs = await page.$$eval('.settings-tab:not(.hidden)', (els) => els.map((e) => e.textContent.trim()));
    ok('Alerts is a tab of its own', tabs.includes('Alerts'), tabs.join('/'));
    ok('Storage is no longer a separate tab', !tabs.includes('Storage'), tabs.join('/'));

    await page.evaluate(() => window.setCat('recruit'));
    await page.waitForTimeout(150);
    const webhookUnderRecruit = await page.evaluate(() => {
        const el = document.getElementById('hookUrl');
        return !!(el && el.offsetParent !== null);
    });
    ok('the Discord webhook is not under Recruit any more', !webhookUnderRecruit);

    await page.evaluate(() => window.setCat('alerts'));
    await page.waitForTimeout(150);
    const webhookUnderAlerts = await page.evaluate(() => {
        const el = document.getElementById('hookUrl');
        return !!(el && el.offsetParent !== null);
    });
    ok('…it is under Alerts', webhookUnderAlerts);

    await page.evaluate(() => window.setCat('data'));
    await page.waitForTimeout(600);
    const dataSections = await page.evaluate(() => ({
        connection: !!document.querySelector('[data-panel="data"]:not(.hidden)'),
        storage: !!document.querySelector('[data-panel="storage"]:not(.hidden)'),
        manage: !!document.querySelector('[data-panel="datamanage"]:not(.hidden)'),
    }));
    ok('Data shows the connection', dataSections.connection);
    ok('…the storage report', dataSections.storage);
    ok('…and manage & delete, in one tab', dataSections.manage);

    // ------------------------------------------------------------------
    head('What is in the data, before anything is deleted');

    const rows = await page.$$eval('#dataManageList > div', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    ok('every dataset is listed', rows.length === 5, `got ${rows.length}`);
    ok('a row says how many there are in total', /1284 in total/.test(rows.join(' ')), rows[0]);
    ok('…and how many the purge would take', /903 older than 365 days/.test(rows.join(' ')), rows[0]);
    ok('an empty dataset offers nothing to delete', /Noticeboard posts/.test(rows[4]) && /Delete none/.test(rows[4]), rows[4]);

    // Changing the age re-counts rather than deleting anything.
    datasets = datasets.map((d) => (d.id === 'pireps' ? { ...d, matching: 120 } : d));
    await page.selectOption('#purgeAge', '90');
    await page.waitForTimeout(500);
    const afterAge = await page.$$eval('#dataManageList > div', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    ok('choosing a different age re-counts', /120 older than 90 days/.test(afterAge.join(' ')), afterAge[0]);
    ok('…and deletes nothing on its own', purgeCalls.length === 0, JSON.stringify(purgeCalls));

    // ------------------------------------------------------------------
    head('Deleting');

    // The wipe asks for the dataset name to be typed back. `typeBack` is what
    // this test will type — set it to the wrong thing to prove a mistyped
    // confirmation never reaches the server.
    let typeBack = null;
    page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(typeBack ?? '') : d.accept()));

    await page.click('[data-purge="pireps"]');
    await page.waitForTimeout(500);
    ok('deleting by age sends the age', purgeCalls.length === 1 && purgeCalls[0].olderThanDays === 90, JSON.stringify(purgeCalls));
    ok('…and does not send `all`', purgeCalls[0] && !purgeCalls[0].all);
    const note = await page.textContent('#dataManageNote');
    ok('…and says how many went', /Deleted 120 flight reports/.test(note), note);

    purgeCalls = [];
    typeBack = 'events';
    await page.click('[data-wipe="events"]');
    await page.waitForTimeout(500);
    ok('a wipe sends `all` with the typed confirmation',
        purgeCalls.length === 1 && purgeCalls[0].all === true && purgeCalls[0].confirm === 'events',
        JSON.stringify(purgeCalls));

    // A wipe confirmed with the wrong word must not reach the server at all —
    // not be sent and refused, which would rely on the server catching it.
    purgeCalls = [];
    typeBack = 'nope';
    await page.click('[data-wipe="schedules"]');
    await page.waitForTimeout(400);
    ok('a mistyped confirmation deletes nothing', purgeCalls.length === 0, JSON.stringify(purgeCalls));

    await ctx.close();

    // ------------------------------------------------------------------
    head('A panel that throws gives the page back');

    const { ctx: ctx2, page: p2 } = await open();
    await p2.evaluate(() => window.scrollTo(0, 500));

    // Exactly the shape of the reported failure: the page is locked for a panel
    // that then fails to appear. Before the safety net this left the body fixed
    // and out of flow — a white screen with nothing on it and no way back.
    const white = await p2.evaluate(() => {
        window.CrewPanels.lockScroll();
        return { position: getComputedStyle(document.body).position, docHeight: document.documentElement.scrollHeight };
    });
    ok('the lock does collapse the page (the bug is real)', white.position === 'fixed', JSON.stringify(white));

    const recovered = await p2.evaluate(() => {
        const did = window.CrewPanels.recoverScroll();
        return { did, position: getComputedStyle(document.body).position, text: document.body.innerText.trim().length };
    });
    ok('recoverScroll gives it back when nothing is open', recovered.did && recovered.position !== 'fixed', JSON.stringify(recovered));
    ok('…and the dashboard is readable again', recovered.text > 500, `${recovered.text} chars`);

    // It must NOT yank the page out from under a panel that really is open.
    const guarded = await p2.evaluate(() => {
        window.CrewNotices.open();
        const before = getComputedStyle(document.body).position;
        const did = window.CrewPanels.recoverScroll();
        return { before, did, after: getComputedStyle(document.body).position };
    });
    ok('a panel that IS open keeps its lock', guarded.before === 'fixed' && !guarded.did && guarded.after === 'fixed', JSON.stringify(guarded));

    // An uncaught error while locked-with-nothing-open self-heals.
    const healed = await p2.evaluate(async () => {
        window.CrewNotices.close();
        await new Promise((r) => setTimeout(r, 50));
        window.CrewPanels.lockScroll();
        window.dispatchEvent(new ErrorEvent('error', { error: new Error('boom'), message: 'boom' }));
        await new Promise((r) => setTimeout(r, 100));
        return getComputedStyle(document.body).position;
    });
    ok('an uncaught error unlocks a page nothing is holding', healed !== 'fixed', healed);

    await ctx2.close();
    await browser.close();
    server.close();

    console.log(`\n${fail ? `${fail} failed, ` : ''}${pass} passed.`);
    process.exit(fail ? 1 : 0);
})();
