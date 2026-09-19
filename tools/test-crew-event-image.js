/*
 * tools/test-crew-event-image.js — `npm run test:event-image`
 *
 * THE EVENT PICTURE IS UPLOADED, NOT LINKED.
 *
 * This box used to ask for an https URL, so every airline went and hosted its
 * banner somewhere else — a Discord CDN link, an imgur page, a Drive share —
 * and a good half of those were dead by the time anyone scrolled back to the
 * event. Now the file goes to us. The properties worth protecting are the ones
 * that make that swap safe rather than the happy path:
 *
 *   * the URL box is GONE. Leaving it beside a file picker would mean two ways
 *     to set one thing, and the one that rots would still be the easier.
 *   * the upload is sent AFTER the event is saved, addressed at the id that
 *     came back. A new event has no id until then, and an upload aimed at ''
 *     is a 404 the staff member cannot do anything about.
 *   * a save that works and an upload that fails is reported as exactly that.
 *     Saying "couldn't save" about an event that IS saved sends somebody back
 *     to retype it.
 *   * picking a file writes nothing until save, so cancelling out of the
 *     editor cannot leave an image on an event nobody changed.
 *   * Remove takes the picture off through its own endpoint, rather than by
 *     sending an empty string in the event body — the row is not where the
 *     bucket is tidied.
 *   * an absurd file is refused in the browser, so nobody waits out an upload
 *     that was always going to be rejected.
 *
 * No framework and no database: `node tools/test-crew-event-image.js`, exits
 * non-zero on a failure, needs nothing running.
 */
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

// A real one-pixel PNG. Playwright's setInputFiles wants bytes, and the page
// calls URL.createObjectURL on whatever it is handed — so a text file dressed
// up as a .png would prove the wrong thing about the preview.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

const HOSTED = 'https://bucket.s3.eu-west-2.amazonaws.com/va-ads/banner/x-1.webp';

let events = [{
    id: 'ev1', title: 'Maple Milk Run', origin: 'CYUL', destination: 'CYYZ',
    startsAt: new Date(Date.now() + 2 * 86400e3).toISOString(), slots: 0,
    gatesOpen: true, gatesLocked: false, gateIcao: 'CYUL', status: 'published',
    locked: false, going: 7, waitlisted: 0, seatsLeft: null, full: false, canManage: true,
    aircraft: '', server: '', description: '', bannerUrl: HOSTED, minRank: '',
}];

// Every write the page attempts, in order — the central assertion of this file
// is about what is in here and WHEN.
let writes = [];
// Set to a status to make the next banner upload fail.
let uploadFails = 0;

async function api(route) {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const method = req.method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (/\/events\/[^/]+\/banner$/.test(p) && method === 'POST') {
        // multipart: what matters is the field name and that bytes arrived.
        const raw = req.postData() || '';
        writes.push({ what: 'upload', id: p.split('/')[p.split('/').length - 2],
            field: /name="image"/.test(raw), bytes: raw.length });
        if (uploadFails) { const s = uploadFails; uploadFails = 0; return json({ error: 'That file could not be read as an image. Try a JPG, PNG or GIF.' }, s); }
        const ev = { ...events[0], bannerUrl: HOSTED };
        return json({ url: HOSTED, event: ev });
    }
    if (/\/events\/[^/]+\/banner$/.test(p) && method === 'DELETE') {
        writes.push({ what: 'drop', id: p.split('/')[p.split('/').length - 2] });
        return json({ event: { ...events[0], bannerUrl: '' } });
    }
    if (p.endsWith('/events') && method === 'GET') {
        return json({ events, mine: [], canManage: true,
            ranks: [{ name: 'Cadet', minHours: 0 }, { name: 'Captain', minHours: 300 }] });
    }
    if (p.endsWith('/events') && method === 'POST') {
        const body = req.postDataJSON();
        writes.push({ what: 'create', body });
        const ev = { ...events[0], ...body, id: 'ev2', bannerUrl: '', going: null, canManage: true };
        events = [...events, ev];
        return json({ event: ev }, 201);
    }
    if (/\/events\/[^/]+$/.test(p) && method === 'PATCH') {
        const body = req.postDataJSON();
        writes.push({ what: 'patch', body });
        return json({ event: { ...events[0], ...body } });
    }
    if (/\/events\/[^/]+$/.test(p) && method === 'GET') {
        const ev = events.find(e => p.endsWith(e.id)) || events[0];
        return json({ event: ev, attending: [], mine: null, canManage: true });
    }
    if (p.endsWith('/routes')) return json({ routes: [], counts: {}, partners: [], ranks: [] });
    if (p.endsWith('/roster')) return json({ roster: [] });
    if (p.includes('/api/va-ads/by-slug/')) return json({ name: 'Test VA', code: 'TST' });
    if (p.endsWith('/me')) return json({ role: 'owner', caps: [], capabilities: [], staffRoles: [], staffAssignments: [] });
    if (p.endsWith('/stats')) return json({ ok: true, connected: true, stats: {} });
    return json({});
}

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log('  ✗ ' + n + (x ? '  (' + x + ')' : '')); fail++; } };

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    /* Open the editor for one event, through the module's own API.
     *
     * Not by clicking the card: the detail view sits over the calendar once
     * anything has been opened, so a click aimed at the list behind it hits
     * the overlay instead. Going through openEvent + the detail's own Edit
     * button is the same path a person takes, without racing the layout. */
    const openEditorFor = async (id) => {
        await page.evaluate((x) => window.CrewEvents.openEvent(x), id);
        await page.waitForTimeout(500);
        await page.evaluate(() => document.querySelector('#cevDetail [data-act="edit"]').click());
        await page.waitForSelector('#cevfArt', { timeout: 5000 });
        await page.waitForTimeout(150);
    };

    await page.route('**/api/**', api);
    await page.addInitScript(() => {
        localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner' }));
        localStorage.setItem('crew:tour:staff:testva', '99');
    });
    await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.CrewEvents && CrewEvents.open());
    await page.waitForSelector('#cevPanel:not(.cev-hidden)', { timeout: 5000 });

    /* ------------------------------------------------------- the URL is gone */
    console.log('\n the box that used to ask for a link');
    await page.click('#cevNewBtn');
    await page.waitForSelector('#cevfTitle', { timeout: 5000 });
    ok('the editor no longer asks for a banner URL',
        !(await page.$('#cevfBanner')));
    ok('…it offers a file picker instead', !!(await page.$('#cevfArt')));
    ok('…and says plainly that we take it down after the event',
        /take it down about a week after the event/i.test(await page.textContent('#cevArtNote')));
    ok('a new event starts with no picture',
        /no image yet/i.test(await page.textContent('#cevArtShot')));

    /* ------------------------------------------------ picking writes nothing */
    console.log('\n picking a file');
    writes = [];
    await page.setInputFiles('#cevfArt', { name: 'flyin.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForTimeout(250);
    ok('the chosen file is previewed before it goes anywhere',
        (await page.$$('#cevArtShot img')).length === 1);
    ok('…and says it is waiting for the save',
        /when you save/i.test(await page.textContent('#cevArtNote')));
    ok('nothing has been written by picking it', writes.length === 0, JSON.stringify(writes));

    /* --------------------------------------- created first, uploaded second */
    console.log('\n creating an event with a picture');
    await page.fill('#cevfTitle', 'Pacífico Nocturno');
    await page.fill('#cevfOrigin', 'mmmx');
    await page.fill('#cevfDest', 'rjaa');
    await page.fill('#cevfStarts', '2026-09-26T04:00');
    await page.click('#cevSaveBtn');
    await page.waitForTimeout(1200);

    ok('the event was created', writes[0] && writes[0].what === 'create', JSON.stringify(writes));
    ok('…without a bannerUrl in its body, because that is not a field any more',
        writes[0] && !('bannerUrl' in writes[0].body), JSON.stringify(writes[0] && writes[0].body));
    ok('the picture went second', writes[1] && writes[1].what === 'upload', JSON.stringify(writes));
    ok('…addressed at the id the create came back with',
        writes[1] && writes[1].id === 'ev2', writes[1] && writes[1].id);
    ok('…as multipart under the field the backend reads',
        writes[1] && writes[1].field, JSON.stringify(writes[1]));
    ok('…carrying the actual bytes', writes[1] && writes[1].bytes > PNG.length, writes[1] && String(writes[1].bytes));
    ok('and nothing else was sent', writes.length === 2, JSON.stringify(writes.map(w => w.what)));

    /* ----------------------------------------------- an event that has one */
    console.log('\n editing an event that already has a picture');
    writes = [];
    await openEditorFor('ev1');
    ok('the editor opens showing the picture it has',
        (await page.$$('#cevArtShot img')).length === 1);
    ok('…and offers to remove it', await page.isVisible('#cevArtDrop'));

    await page.click('#cevArtDrop');
    await page.waitForTimeout(150);
    ok('removing clears the preview', /no image yet/i.test(await page.textContent('#cevArtShot')));
    ok('…but has not written anything yet', writes.length === 0, JSON.stringify(writes));

    await page.click('#cevSaveBtn');
    await page.waitForTimeout(1200);
    ok('saving sends the edit', writes[0] && writes[0].what === 'patch', JSON.stringify(writes));
    ok('…then takes the picture off through its own endpoint',
        writes[1] && writes[1].what === 'drop' && writes[1].id === 'ev1', JSON.stringify(writes));
    ok('…rather than by blanking a field in the event body',
        writes[0] && !('bannerUrl' in writes[0].body), JSON.stringify(writes[0] && writes[0].body));

    /* ------------------------------------------- a file nobody should wait on */
    console.log('\n a file that is never going to work');
    writes = [];
    await openEditorFor('ev1');
    await page.setInputFiles('#cevfArt', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await page.waitForTimeout(200);
    ok('a file that is not an image is refused in the browser',
        /not an image/i.test(await page.textContent('#cevArtNote')));
    await page.setInputFiles('#cevfArt', { name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(13 * 1024 * 1024, 1) });
    await page.waitForTimeout(300);
    ok('…and so is one far too big to be a banner',
        /too big|over \d+ MB/i.test(await page.textContent('#cevArtNote')),
        await page.textContent('#cevArtNote'));
    await page.click('#cevSaveBtn');
    await page.waitForTimeout(1000);
    ok('neither one was uploaded', !writes.some(w => w.what === 'upload'), JSON.stringify(writes.map(w => w.what)));

    /* ------------------------------- saved, but the picture did not make it */
    console.log('\n when the upload is the thing that fails');
    writes = [];
    uploadFails = 400;
    await openEditorFor('ev1');
    await page.setInputFiles('#cevfArt', { name: 'flyin.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForTimeout(200);
    await page.click('#cevSaveBtn');
    await page.waitForTimeout(1200);
    const toasts = await page.$$eval('#cev-toasts .cev-toast', els => els.map(e => e.textContent));
    ok('the edit itself still went', writes.some(w => w.what === 'patch'), JSON.stringify(writes.map(w => w.what)));
    ok('the staff member is told the event saved and the image did not',
        toasts.some(t => /saved, but the image/i.test(t)), toasts.join(' | '));
    ok('…and is never told the save failed, because it did not',
        !toasts.some(t => /couldn.t save|could not save/i.test(t)), toasts.join(' | '));
    ok('…and the editor closed, rather than trapping them in it',
        await page.isHidden('#cevEdit'));

    const ours = errors.filter(e => !/Failed to load resource|tailwind is not defined|lucide/i.test(e));
    ok('no page errors of our own', ours.length === 0, ours.join(' | '));

    await browser.close();
    server.close();
    console.log(`\n${fail ? `${fail} failed, ` : ''}all ${pass} checks passed`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
