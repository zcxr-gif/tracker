/*
 * tools/test-crew-design.js — `npm run test:design`
 *
 * THE AIRLINE'S OWN LOOK, AND THE LAYOUTS IT SITS IN.
 *
 * Drives the REAL crew-dashboard.html and crew-pilot.html against a faked
 * backend:
 *
 *   * no layout stretches a block: every card is as tall as its contents, and
 *     the live map keeps a map-sized height (it used to reach ~2,650px)
 *   * the showcase shows the FEATURED artwork, credits the artist, and opens a
 *     gallery that Escape closes
 *   * the hero picture stands in for the banner; section covers land on the
 *     tiles they name, on both pages
 *   * the designer's CSS is applied as text in one <style>, with the scope
 *     attribute on <html>
 *   * the Airline interface draws the departures board, the pilot's own next
 *     boarding pass (their booking, not somebody else's) and their crew ID —
 *     and draws them the moment a reader switches to it
 *   * the Design studio sends what it says: an upload as multipart, a cover as
 *     art.sections, a theme with its CSS, an imported theme after a preview,
 *     and the interface for the whole crew
 *
 * `node tools/test-crew-design.js` — exits non-zero on a failure.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const TAILWIND = fs.readFileSync(path.join(__dirname, 'crew-tailwind.css'), 'utf8');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

const svg = (label) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="700"><rect width="100%" height="100%" fill="#c8102e"/><text x="50%" y="50%" fill="#fff" font-size="120" text-anchor="middle">${label}</text></svg>`;
const hrs = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const ARTWORK = [
    { id: 'a1', url: 'https://cdn.test/a350.svg', title: 'A350 in our colours', kind: 'livery', credit: 'Mo Designs', creditUrl: 'https://mo.test', featured: true, width: 1600, height: 700 },
    { id: 'a2', url: 'https://cdn.test/poster.svg', title: 'Winter schedule', kind: 'poster', credit: 'Kai', featured: true, width: 800, height: 1100 },
    { id: 'a3', url: 'https://cdn.test/hidden.svg', title: 'Not in the showcase', kind: 'photo', featured: false },
];
const CSS = 'html[data-crew-css] #idName{letter-spacing:.3em}';

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log('  ✗ ' + n + (x ? '  (' + x + ')' : '')); fail++; } };

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
    const errs = [];
    const sent = [];
    let DESIGN = {
        theme: { light: { accent: '#c8102e' }, css: CSS }, ui: 'essential', artwork: ARTWORK.slice(),
        art: { hero: 'https://cdn.test/a350.svg', backdrop: '', backdropOpacity: 0.12, sections: { routes: 'https://cdn.test/a350.svg', events: 'https://cdn.test/poster.svg', logbook: 'https://cdn.test/poster.svg' }, showcase: { enabled: true, interval: 0, title: 'Aurora gallery' } },
        limits: { artwork: 60, css: 24576 },
    };

    async function fake(page, { role, ui = 'essential', layout = 'editorial', social = false }) {
        page.on('pageerror', (e) => errs.push(e.message));
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({ contentType: 'text/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});` }));
        await page.route('**/unpkg.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
        await page.route('**/embed.html**', (r) => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#9cc3e6"></body>' }));
        await page.route('https://cdn.test/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: svg('ART') }));
        await page.route('**/instagram.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<div style="height:900px">post</div>' }));
        await page.route('**/api/**', async (route) => {
            const req = route.request();
            const p = new URL(req.url()).pathname;
            const m = req.method();
            const json = (x, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
            let body = {};
            const ct = req.headers()['content-type'] || '';
            if (m !== 'GET') {
                if (/multipart/.test(ct)) body = { multipart: true, raw: (req.postData() || '').slice(0, 400) };
                else { try { body = JSON.parse(req.postData() || '{}'); } catch { body = {}; } }
                sent.push({ m, p, body });
            }
            if (p.includes('/va-ads/by-slug/') || p.endsWith('/branding')) {
                return json({ name: 'Aurora Virtual', code: 'AUR', layout, allowedLayouts: ['editorial', 'console', 'split', 'classic'], accent: '#c8102e',
                    banner: 'https://cdn.test/directory-banner.svg', ...DESIGN, ui,
                    social: social ? { handle: 'aurora', posts: [{ kind: 'p', code: 'AAA' }, { kind: 'p', code: 'BBB' }] } : { handle: '', posts: [] } });
            }
            if (p.endsWith('/design/export')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Content-Disposition': 'attachment; filename="aurora.crewtheme.json"' }, body: JSON.stringify({ kind: 'inflight-crew-theme', version: 1, theme: DESIGN.theme }) });
            if (p.endsWith('/design/import')) {
                if (body.dryRun) return json({ dryRun: true, theme: { light: { accent: '#0055ff' }, css: '.x{color:red}' }, art: null, ui: 'airline', dropped: ['@import url(x)'] });
                DESIGN = { ...DESIGN, theme: { light: { accent: '#0055ff' }, css: '.x{color:red}' }, ui: 'airline' };
                return json({ ...DESIGN, dropped: [] });
            }
            if (p.endsWith('/design') && m === 'GET') return json(DESIGN);
            if (p.endsWith('/design') && m === 'PUT') {
                if (body.art) DESIGN = { ...DESIGN, art: body.art };
                if (body.theme) DESIGN = { ...DESIGN, theme: body.theme };
                if (body.ui) DESIGN = { ...DESIGN, ui: body.ui };
                return json({ ...DESIGN, dropped: body.theme && /@import/.test(body.theme.css || '') ? ['@import url(x)'] : [] });
            }
            if (p.endsWith('/artwork') && m === 'POST') { const a = { id: 'new1', url: 'https://cdn.test/new.svg', title: 'upload', kind: 'livery', featured: true }; DESIGN.artwork.push(a); return json({ artwork: a }, 201); }
            if (p.endsWith('/artwork/link')) { const a = { id: 'new2', url: body.url, title: '', kind: 'other', featured: true }; DESIGN.artwork.push(a); return json({ artwork: a }, 201); }
            if (p.endsWith('/me/badges')) return json({ badges: [{ kind: 'rank', name: 'First Officer' }], pilot: { memberId: 'm-7f3a91c2', name: 'Rae Okafor', callsign: 'AUR142', hours: 312.4 } });
            if (p.endsWith('/me')) return json(role === 'pilot' ? { role: 'pilot', name: 'Rae Okafor', mustChangePassword: false } : { role: 'owner', capabilities: ['settings.branding', 'routes.manage'], name: 'Owner' });
            if (p.endsWith('/schedules')) return json({ schedules: [
                { id: 's1', routeId: 'r1', flightNumber: 'AUR101', origin: 'EGLL', destination: 'KJFK', departsAt: hrs(0.4), status: 'published' },
                { id: 's2', routeId: 'r2', flightNumber: 'AUR204', origin: 'EGLL', destination: 'LFPG', departsAt: hrs(2), status: 'published', full: true },
                { id: 's3', routeId: 'r3', flightNumber: 'AUR330', origin: 'EGLL', destination: 'EDDF', aircraft: 'Airbus A321', departsAt: hrs(5), status: 'published' },
            ], mine: [{ scheduleId: 's3', status: 'booked' }] });
            if (p.endsWith('/routes')) return json({ routes: [{ id: 'r3', flightNumber: 'AUR330', origin: 'EGLL', destination: 'EDDF', departureGate: 'A12', active: true }], partners: [] });
            if (p.endsWith('/stats')) return json({ pilots: 42, flights30d: 120, hours: 3400, pireps: 800 });
            return json({});
        });
        await page.addInitScript((r) => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'X', role: r }));
            localStorage.setItem('crew:tour:staff:testva', '1');
            localStorage.setItem('crew:tour:pilot:testva', '1');
        }, role);
    }
    const last = (re) => [...sent].reverse().find((s) => re.test(s.p));

    // ================= layouts =================
    console.log('\n the layouts do not stretch');
    for (const layout of ['editorial', 'console', 'split', 'classic']) {
        for (const social of [false, true]) {
            const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
            const page = await ctx.newPage();
            await fake(page, { role: 'owner', layout, social });
            await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva&layout=${layout}`);
            await page.waitForTimeout(1500);
            const m = await page.evaluate(() => [...document.querySelectorAll('#grid section[class*="r-"]')].filter((s) => s.offsetParent && !s.classList.contains('r-tools')).map((s) => {
                const r = s.getBoundingClientRect();
                const bottom = [...s.children].reduce((mx, c) => Math.max(mx, c.getBoundingClientRect().bottom), r.top);
                const pad = parseFloat(getComputedStyle(s).paddingBottom) || 0;
                return { k: s.className.split(' ')[0], h: Math.round(r.height), slack: Math.round(r.bottom - bottom - pad) };
            }));
            const stretched = m.filter((x) => x.slack > 30 && x.k !== 'r-live');
            const live = m.find((x) => x.k === 'r-live');
            ok(`${layout}${social ? ' + Instagram' : ''}: no block stretched past its contents`, !stretched.length, JSON.stringify(stretched));
            ok(`${layout}${social ? ' + Instagram' : ''}: the live map keeps a map-sized height`, live && live.h < 700, live && String(live.h));
            await ctx.close();
        }
    }

    // ================= the dashboard, essential =================
    console.log('\n the airline’s artwork');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const page = await ctx.newPage();
    await fake(page, { role: 'owner' });
    await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
    await page.waitForTimeout(1500);
    ok('the showcase shows only the featured pictures', await page.evaluate(() => document.querySelectorAll('#showcaseCard .sc-slide').length) === 2);
    ok('…under the airline’s own heading', /Aurora gallery/.test(await page.textContent('#showcaseCard')));
    ok('…crediting the artist, with their link', await page.evaluate(() => !!document.querySelector('#showcaseCard .sc-c a[href="https://mo.test"]')));
    await page.click('#showcaseCard .sc-open');
    ok('pressing it opens the gallery', await page.isVisible('.lb'));
    ok('…with every featured picture in the strip', await page.evaluate(() => document.querySelectorAll('.lb-strip button').length) === 2);
    await page.keyboard.press('Escape');
    ok('Escape closes it', !(await page.$('.lb')));
    ok('the hero picture stands in for the directory banner', (await page.getAttribute('#identityBg', 'src')) === 'https://cdn.test/a350.svg');
    ok('a section cover lands on the tile it names', await page.evaluate(() => !!document.querySelector('#toolGrid .tile[data-action="routes"].has-cover img[src="https://cdn.test/a350.svg"]')));
    ok('…and only there', await page.evaluate(() => !document.querySelector('#toolGrid .tile[data-action="roster"].has-cover')));
    ok('the designer’s CSS is applied, as text', await page.evaluate((css) => { const s = document.getElementById('crew-design-css'); return !!s && s.textContent === css && document.documentElement.hasAttribute('data-crew-css'); }, CSS));
    ok('the departures board is not drawn outside the Airline interface', !(await page.isVisible('#departuresBoard')));

    console.log('\n switching to Airline');
    await page.evaluate(() => CrewSkin.set('airline', { animate: false }));
    await page.waitForTimeout(700);
    ok('the board draws the moment it is switched on', await page.evaluate(() => document.querySelectorAll('#departuresBoard .alb tbody tr').length) === 3);
    ok('…with a status for each departure', /BOARDING/.test(await page.textContent('#departuresBoard')) && /FULL/.test(await page.textContent('#departuresBoard')));

    console.log('\n the design studio');
    await page.evaluate(() => CrewSkin.set('essential', { animate: false }));
    await page.evaluate(() => openDesign());
    await page.waitForSelector('#crewDesignStudio [data-ds-drop]');
    await page.setInputFiles('#crewDesignStudio [data-ds-file]', { name: 'a320-livery.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
    await page.waitForTimeout(600);
    const up = last(/\/artwork$/);
    ok('an upload goes up as a file, and guesses its kind from the name', up && up.body.multipart && /livery/.test(up.body.raw), JSON.stringify(up && up.body).slice(0, 200));
    await page.fill('#crewDesignStudio [data-ds-link]', 'https://imgur.test/poster.png');
    await page.click('#crewDesignStudio [data-ds-link-add]');
    await page.waitForTimeout(400);
    ok('a picture hosted elsewhere is added by link', (last(/artwork\/link$/) || {}).body.url === 'https://imgur.test/poster.png');

    await page.click('#crewDesignStudio [data-ds-tab="placement"]');
    await page.selectOption('#crewDesignStudio [data-ds-section="fleet"]', 'https://cdn.test/poster.svg');
    await page.click('#crewDesignStudio [data-ds-save-art]');
    await page.waitForTimeout(400);
    const art = last(/\/design$/);
    ok('a section cover saves as art.sections', art && art.body.art && art.body.art.sections.fleet === 'https://cdn.test/poster.svg' && art.body.art.sections.routes === 'https://cdn.test/a350.svg', JSON.stringify(art && art.body.art));
    ok('…and appears on the tile straight away', await page.evaluate(() => !!document.querySelector('#toolGrid .tile[data-action="fleet"].has-cover')));

    await page.click('#crewDesignStudio [data-ds-tab="theme"]');
    await page.fill('#crewDesignStudio [data-ds-hex="light.accent"]', '#123456');
    await page.fill('#crewDesignStudio [data-ds-t="css"]', '@import url(x); .tile{border-radius:18px}');
    await page.click('#crewDesignStudio [data-ds-save-theme]');
    await page.waitForTimeout(400);
    const th = last(/\/design$/);
    ok('the theme saves its colours and its CSS', th && th.body.theme && th.body.theme.light.accent === '#123456' && /border-radius:18px/.test(th.body.theme.css));
    ok('…and the studio says what the server removed', /Removed:/.test(await page.textContent('#crewDesignStudio [data-ds-dropped]')));

    await page.setInputFiles('#crewDesignStudio [data-ds-import-file]', { name: 'brand.crewtheme.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ kind: 'inflight-crew-theme', theme: { light: { accent: '#0055ff' } } })) });
    await page.waitForSelector('.cp-ask-box, .cp-ask');
    ok('an uploaded theme is previewed before anything changes', (last(/design\/import$/) || {}).body.dryRun === true);
    ok('…saying what it sets, and what was unsafe', /light colours/.test(await page.textContent('.cp-ask-box, .cp-ask')) && /unsafe/.test(await page.textContent('.cp-ask-box, .cp-ask')));
    await page.click('.cp-ask button.cp-btn-primary, .cp-ask-box button.cp-btn-primary');
    await page.waitForTimeout(500);
    ok('…and applied once confirmed', (last(/design\/import$/) || {}).body.dryRun === undefined);

    await page.click('#crewDesignStudio [data-ds-tab="ui"]');
    await page.click('#crewDesignStudio [data-ds-ui="airline"]');
    await page.waitForTimeout(500);
    ok('the interface is chosen for the whole crew', (last(/\/design$/) || {}).body.ui === 'airline');
    ok('…and switched here at once', (await page.getAttribute('html', 'data-skin')) === 'airline');
    await ctx.close();

    // ================= the pilot page, airline =================
    console.log('\n a pilot, on the Airline interface');
    const pctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const pilot = await pctx.newPage();
    await fake(pilot, { role: 'pilot', ui: 'airline' });
    await pilot.goto(`http://127.0.0.1:${port}/crew-pilot.html?va=testva&ui=airline`);
    await pilot.waitForTimeout(2000);
    ok('their boarding pass is their own next booking', /AUR330/.test(await pilot.textContent('#boardingPass')) && /EDDF/.test(await pilot.textContent('#boardingPass')));
    ok('…with the gate off the route', /A12/.test(await pilot.textContent('#boardingPass')));
    ok('their crew ID carries name, rank and callsign', /Rae Okafor/.test(await pilot.textContent('#crewIdCard')) && /First Officer/i.test(await pilot.textContent('#crewIdCard')) && /AUR142/.test(await pilot.textContent('#crewIdCard')));
    // (The studio above added two pictures to the shared library, so count
    // what matters: it is there, and the one left out of it stays out.)
    ok('the showcase is on their home too', await pilot.evaluate(() => document.querySelectorAll('#showcase .sc-slide').length >= 2
        && !document.querySelector('#showcase img[src*="hidden.svg"]')));
    ok('…and a section cover on their tile', await pilot.evaluate(() => !!document.querySelector('#quickGrid .tile[data-action="logbook"].has-cover')));
    ok('the airline hero replaces the directory banner', (await pilot.getAttribute('#heroImg', 'src')) === 'https://cdn.test/a350.svg');
    await pctx.close();

    const real = errs.filter((e) => !/lucide|Tailwind|tailwind|ResizeObserver/.test(e));
    ok('no page errors', !real.length, real.join(' | '));

    await browser.close();
    server.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
