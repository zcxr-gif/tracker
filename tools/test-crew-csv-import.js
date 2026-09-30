// test-crew-csv-import.js
// Drives the REAL crew-dashboard.html through a route import from a VA's own
// spreadsheet — a multi-tab .xlsx in their column names, not ours — and back
// out again in the same shape:
//
//   * a workbook's tabs are all read, and a cover tab is skipped, not failed
//   * "routeNumber / depICAO / arrICAO / rank" are recognised as ours
//   * a column we have nowhere for can be pointed at the notes, and the
//     preview re-plans when it is
//   * a bad row can be skipped on purpose, and only on purpose
//   * the export offers the VA's own columns once a file has been read
//
// The backend is stubbed with the backend's own planner (crewCsv.js from the
// sibling `database` checkout, or CREW_BACKEND=/path/to/database), so the plan
// the page renders is the plan the server would really make.
//
//   npm i --no-save playwright-core xlsx@0.18.5
//   node tools/test-crew-csv-import.js
const { chromium } = require('playwright-core');
const XLSX = require('xlsx');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = process.env.CREW_BACKEND || path.resolve(ROOT, '..', 'database');
const crewCsv = require(path.join(BACKEND_DIR, 'crewCsv.js'));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? '/crew-dashboard.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
const TAILWIND = fs.readFileSync(path.join(__dirname, 'crew-tailwind.css'), 'utf8');
const TW = `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);window.tailwind={config:{}};})();`;
const SHEETJS = fs.readFileSync(require.resolve('xlsx/dist/xlsx.full.min.js'), 'utf8');

// The workbook: a cover tab, the network in the VA's own columns (one row
// with an airport nobody can read), and a second region with a title above
// its table.
const OUT = path.join(require('os').tmpdir(), 'crew-csv-import-test.xlsx');
{
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Etihad Virtual — network'], ['Updated weekly']]), 'Cover');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['routeNumber', 'depICAO', 'arrICAO', 'aircraft', 'routeType', 'estFlightTime', 'rank', 'notes'],
        ['EY101', 'OMAA', 'KJFK', 'B787-9 , A380, A350-1000', 'Passenger', '13:40', 'Cadets', ''],
        ['EY102', 'KJFK', 'OMAA', 'B787-9 , A380, A350-1000', 'Passenger', '12:20', 'Cadets', ''],
        ['EY63', 'OMAA', 'LPPT', 'B787-9', 'Passenger', '7:50', 'Cadets', ''],
        ['EY63', 'LPPT', 'OMAA', 'B787-9', 'Passenger', '7:30', 'Cadets', ''],
        ['EY99', 'OMAA', 'Tokyo', 'B787-9', 'Passenger', '9:30', 'Cadets', ''],
    ]), 'Sheet5');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Europe'], [],
        ['routeNumber', 'depICAO', 'arrICAO', 'aircraft', 'routeType', 'estFlightTime', 'rank', 'notes'],
        ['EY11', 'OMAA', 'EGLL', 'B777-300ER , B787-9', 'Passenger', '7:30', 'Cadets', ''],
    ]), 'Europe');
    XLSX.writeFile(wb, OUT);
}

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log('  ✗ ' + n + (x ? '  (' + x + ')' : '')); fail++; } };

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));

    const stored = [];
    const calls = [];
    await page.route('**/cdn.tailwindcss.com**', r => r.fulfill({ contentType: 'application/javascript', body: TW }));
    await page.route('**/unpkg.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/cdnjs.cloudflare.com/ajax/libs/xlsx/**', r => r.fulfill({ contentType: 'application/javascript', body: SHEETJS }));
    await page.route('**/api/**', async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const p = u.pathname;
        const json = (x, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
        if (p.endsWith('/routes/import')) {
            const b = JSON.parse(req.postData() || '{}');
            calls.push(b);
            const plan = crewCsv.planImport(crewCsv.ROUTES_SPEC, b.sheets, stored, { mapping: b.mapping });
            const fields = crewCsv.ROUTES_SPEC.columns.map(c => ({ key: c.key, header: c.header, required: !!c.required }));
            if (plan.error) return json({ error: plan.error, sheets: plan.sheets, fields }, 400);
            const summary = { kind: 'routes', create: plan.create.length, update: plan.update.length, unchanged: plan.unchanged,
                errors: plan.errors.slice(0, 50), errorCount: plan.errors.length, warningCount: plan.warningCount || 0, matchedOn: plan.matchedOn,
                columns: plan.columns, missing: plan.missing, sheets: plan.sheets, layout: plan.layout, fields };
            if (b.dryRun !== false) return json({ dryRun: true, ...summary });
            if (plan.errors.length && !(b.skipErrors === true && b.expectErrors === plan.errors.length)) {
                return json({ error: 'Fix the problem rows', ...summary }, 400);
            }
            plan.create.forEach((r, i) => stored.push({ id: 'r' + (stored.length + i), ...r.values }));
            return json({ dryRun: false, ...summary, created: plan.create.length, updated: 0, failures: [], skipped: plan.errors.length });
        }
        if (p.endsWith('/routes.csv')) {
            calls.push({ export: u.search });
            let layout = null; try { layout = JSON.parse(u.searchParams.get('layout') || 'null'); } catch {}
            return route.fulfill({ status: 200, contentType: 'text/csv',
                headers: { 'Content-Disposition': 'attachment; filename="testva-routes.csv"' },
                body: crewCsv.toCsv(crewCsv.ROUTES_SPEC, stored, layout, { includeId: u.searchParams.get('id') !== '0' }) });
        }
        if (p.endsWith('/routes')) return json({ routes: [], ranks: [] });
        if (p.endsWith('/route-map')) return json({ routes: [], airports: [], stats: {} });
        if (p.includes('/va-ads/by-slug/') || p.endsWith('/branding')) return json({ name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial'], fleet: [] });
        if (p.endsWith('/me')) return json({ role: 'owner', capabilities: ['routes.manage'], name: 'Owner' });
        return json({});
    });

    await page.addInitScript(() => localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })));
    await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
    await page.waitForTimeout(1100);
    await page.evaluate(() => {
        try { if (window.CrewTour && CrewTour.close) CrewTour.close(); } catch {}
        document.querySelectorAll('.ctour-mask, .ctour-pop, .ctour').forEach(e => e.remove());
    });

    console.log('\n before any file');
    await page.evaluate(() => openCsv('routes'));
    await page.waitForTimeout(200);
    ok('the export offers only our columns', await page.evaluate(() => document.getElementById('csvLayoutPick').classList.contains('hidden')));
    ok('the picker takes several files and workbooks',
        await page.evaluate(() => { const f = document.getElementById('csvFile'); return f.multiple && /\.xlsx/.test(f.accept); }));

    console.log('\n a workbook in the VA’s own columns');
    await page.setInputFiles('#csvFile', OUT);
    await page.waitForTimeout(900);
    const first = calls[0] || {};
    ok('every tab was sent', (first.sheets || []).map(s => s.name).join() === 'Cover,Sheet5,Europe', (first.sheets || []).map(s => s.name).join());
    ok('…and it was only a dry run', first.dryRun === true);
    const preview = await page.evaluate(() => document.getElementById('csvPreview').innerText);
    ok('the cover tab is skipped, and says so', /Cover — skipped/.test(preview), preview.slice(0, 200));
    ok('the title above a table is stepped over', /headings on row 3/.test(preview));
    ok('a return leg under the same number is its own route', /5 new routes/.test(preview), preview.slice(0, 120));
    ok('the unreadable airport is reported by tab and row', /Sheet5 · row 6/.test(preview));
    ok('Apply waits until the bad row is fixed or skipped',
        await page.evaluate(() => document.getElementById('csvCommitBtn').disabled));
    ok('their headers are mapped to ours',
        await page.evaluate(() => document.querySelector('select[data-h="depICAO"]').value === 'origin'
            && document.querySelector('select[data-h="rank"]').value === 'minRank'));
    ok('columns we have nowhere for start out unimported',
        await page.evaluate(() => document.querySelector('select[data-h="estFlightTime"]').value === ''));
    await page.evaluate(() => {
        document.querySelectorAll('.ctour-mask, .ctour-pop, .ctour').forEach(e => e.remove());
        document.querySelector('#csvPreview details').scrollIntoView({ block: 'start' });
    });
    await page.screenshot({ path: path.join(require('os').tmpdir(), 'crew-csv-preview.png'), fullPage: false });
    ok('the column pickers fit a phone', await page.evaluate(() => {
        const m = document.querySelector('#csvModal > div:last-child').getBoundingClientRect();
        return [...document.querySelectorAll('#csvPreview select')].every(s => s.getBoundingClientRect().right <= m.right);
    }));

    console.log('\n what it looks like');
    ok('the table shows the tab’s own headings, and what each became',
        await page.evaluate(() => /depICAO/.test(document.querySelector('#csvTable thead').innerText)
            && /Departure airport/.test(document.querySelector('#csvTable thead').innerText)));
    ok('each row says what will happen to it',
        await page.evaluate(() => [...document.querySelectorAll('#csvTable tbody tr')].map(tr => tr.cells[0].innerText.split('\n')[1]).join()) === 'New,New,New,New,Problem');
    ok('the bad cell is marked with its reason',
        await page.evaluate(() => /arrICAO “Tokyo” is not an airport code/.test(document.querySelector('#csvTable tbody tr:last-child').innerText)));
    await page.check('#csvTable input[type=checkbox]');
    ok('“only rows to fix” narrows it to the problem',
        await page.evaluate(() => document.querySelectorAll('#csvTable tbody tr').length) === 1);
    await page.click('#csvTable button:has-text("Europe")');
    ok('another tab can be looked at', await page.evaluate(() => /EY11/.test(document.getElementById('csvTable').innerText) || /Nothing to fix/.test(document.getElementById('csvTable').innerText)));
    await page.click('#csvTable input[type=checkbox]');
    ok('…and shows its rows', await page.evaluate(() => /EY11/.test(document.getElementById('csvTable').innerText)));
    await page.click('#csvTable button:has-text("Sheet5")');
    await page.evaluate(() => {
        // The first-visit tour is not what this screenshot is of.
        document.querySelectorAll('[class*="tour"], [id*="tour"], [id*="Tour"]').forEach(e => { if (!e.closest('#csvModal')) e.remove(); });
        document.getElementById('csvTable').scrollIntoView({ block: 'start' });
    });
    await page.screenshot({ path: path.join(require('os').tmpdir(), 'crew-csv-table.png'), fullPage: false });

    console.log('\n correcting a column');
    await page.selectOption('select[data-h="estFlightTime"]', '+notes');
    await page.waitForTimeout(500);
    ok('the preview is re-planned with the choice', (calls[calls.length - 1].mapping || {}).estFlightTime === '+notes');
    ok('…and the choice is remembered',
        await page.evaluate(() => JSON.parse(localStorage.getItem('crew:csv:map:testva:routes') || '{}').estFlightTime === '+notes'));

    console.log('\n applying');
    await page.check('#csvSkipErrors');
    ok('skipping the bad row enables Apply', await page.evaluate(() => !document.getElementById('csvCommitBtn').disabled));
    await page.evaluate(() => commitCsv());
    await page.waitForTimeout(500);
    const commit = calls[calls.length - 1];
    ok('the commit says how many rows it agreed to skip', commit.dryRun === false && commit.skipErrors === true && commit.expectErrors === 1);
    ok('five routes landed', stored.length === 5, String(stored.length));
    ok('the flight time went into the notes', stored[0].notes === 'estFlightTime: 13:40', stored[0].notes);

    console.log('\n exporting it back');
    await page.evaluate(() => openCsv('routes'));
    await page.waitForTimeout(200);
    ok('the export now offers the VA’s columns',
        await page.evaluate(() => !document.getElementById('csvLayoutPick').classList.contains('hidden')
            && /routeNumber, depICAO, arrICAO/.test(document.getElementById('csvLayoutCols').textContent)));
    const dl = page.waitForEvent('download');
    await page.evaluate(() => exportCsv());
    const file = await dl;
    const text = fs.readFileSync(await file.path(), 'utf8').replace(/^﻿/, '');
    ok('the file goes out under their headers', text.split('\r\n')[0] === 'routeNumber,depICAO,arrICAO,aircraft,rank,notes,id', text.split('\r\n')[0]);

    console.log('\n a sheet with no headings, in IATA codes');
    const bare = path.join(require('os').tmpdir(), 'crew-csv-bare.csv');
    fs.writeFileSync(bare, 'EY201,AUH-CDG,A380\nEY202,CDG-AUH,A380\n');
    await page.evaluate(() => openCsv('routes'));
    await page.setInputFiles('#csvFile', bare);
    await page.waitForTimeout(700);
    const t = await page.evaluate(() => document.getElementById('csvTable').innerText);
    ok('its columns are named like a spreadsheet’s', /Column A/.test(t) && /Column B/.test(t));
    ok('the leg column is read as both airports, in ICAO', /OMAA → LFPG/.test(t) && /from “AUH-CDG”/.test(t), t.slice(0, 300));
    ok('the first row is kept as a route', /2 new routes/.test(await page.evaluate(() => document.getElementById('csvPreview').innerText)));

    ok('no page errors', errs.length === 0, errs.join(' | '));
    console.log(`\n${pass} passed, ${fail} failed\n`);
    await browser.close(); server.close();
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
