// test-weather-popover.js
// Drives the REAL weatherWidget.js against real METAR strings to prove the
// expanded panel says true things:
//
//   * the headline names the station, its temperature and what it is like —
//     and present weather beats cloud cover, so a station reporting
//     thunderstorms under a broken sky does not read "Broken"
//   * the flight category is derived from ceiling and visibility at the
//     published thresholds, across all four rungs
//   * humidity is computed from temperature and dewpoint rather than left out
//   * the route strip carries departure, nearest and arrival, and pressing one
//     moves the headline to it
//   * a station with no report says so instead of rendering an empty headline
//   * nothing is invented: there is no forecast in a METAR, so no high, no low
//
// Run:  node tools/test-weather-popover.js
// Needs: playwright-core, and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
//        pre-installed /opt/pw-browsers/chromium). Set PLAYWRIGHT_NO_SANDBOX=1
//        when running as root in a container.
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// A bare page carrying only what the widget needs: the flight window element it
// mirrors its visibility from, and the theme variables it paints with.
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>
  :root{ --iw-bg-start:rgba(28,28,32,.92); --iw-bg-end:rgba(38,38,44,.92);
         --border-glass:rgba(255,255,255,.1); --border-highlight:rgba(255,255,255,.16);
         --text-primary:#fafafa; --text-secondary:#a1a1aa; --text-dim:#94a3b8;
         --radius-lg:16px; --font-data:ui-monospace,monospace; }
  html,body{ margin:0; height:100%; background:#111827; }
  #aircraft-info-window{ position:fixed; right:0; top:0; width:1px; height:1px; }
</style></head><body>
<div id="aircraft-info-window" class="visible"></div>
<script src="/weather.js"></script>
<script src="/weatherWidget.js"></script>
</body></html>`;

const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(PAGE);
    }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

// Real METARs. Each one is here for a reading it forces.
const METARS = {
    //                                          vis      ceiling      → category
    EGLL: 'EGLL 011750Z 25008KT 9999 FEW040 22/12 Q1018',        // 10 km, none  → VFR
    KJFK: 'KJFK 011751Z 18012G20KT 10SM SCT250 27/18 A3002',     // 10 mi, none  → VFR
    EINN: 'EINN 011800Z 24010KT 9999 SCT035 16/11 Q1015',        // 10 km, none  → VFR
    KATL: 'KATL 011752Z 09014G24KT 2SM +TSRA BKN008 OVC020CB 24/23 A2985', // 2 mi, 800 ft → IFR
    KORD: 'KORD 011751Z 36006KT 4SM -RA BKN012 OVC030 19/17 A2996',        // 4 mi, 1200 ft → MVFR
    KBNA: 'KBNA 011753Z 12008KT 6SM TSRA BKN009 OVC025 23/22 A2988',       // 6 mi, 900 ft  → IFR
    EGPH: 'EGPH 011750Z 00000KT 0300 FG VV001 08/08 Q1024',      // 300 m, 100 ft → LIFR
    ENGM: 'ENGM 011750Z 05004KT 1200 BR OVC003 03/03 Q1021',     // 1200 m, 300 ft → LIFR
};

const NAMES = {
    EGLL: 'London Heathrow', KJFK: 'John F Kennedy Intl', EINN: 'Shannon',
    KATL: 'Hartsfield–Jackson Atlanta Intl', KORD: "Chicago O'Hare Intl",
    KBNA: 'Nashville Intl', EGPH: 'Edinburgh', ENGM: 'Oslo Gardermoen',
};

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });

    let failures = 0;
    const check = (label, ok, extra) => {
        if (!ok) { failures++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); } else console.log('  ✓ ' + label);
    };

    /** Open the pill's panel for one flight and hand back the page. */
    const open = async ({ dep, arr, near }) => {
        const page = await browser.newPage({ viewport: { width: 520, height: 900 } });
        page.on('pageerror', (e) => { failures++; console.log('  ✗ page error — ' + String(e).split('\n')[0]); });
        await page.route('**/functions/sigmets**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"features":[]}' }));
        await page.route('https://metar.vatsim.net/**', (route) => {
            const id = (new URL(route.request().url()).searchParams.get('id') || '').toUpperCase();
            return route.fulfill({ status: 200, contentType: 'text/plain', body: METARS[id] || '' });
        });
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.evaluate(({ dep, arr, near, names }) => {
            // Stand in for flight.js: the two accessors the widget reads, and
            // the nearest-station search it resolves NOW from.
            window.getAirportCoords = () => ({ lat: 51.5, lon: -0.45 });
            window.getAirportName = (i) => names[i] || '';
            window.findNearestAirports = () => (near ? [{ icao: near, km: 42 }] : []);
            window.dispatchEvent(new CustomEvent('flight-window-weather', {
                detail: { flightId: 'f' + Math.random(), depIcao: dep, arrIcao: arr, lat: 51.5, lon: -0.45 },
            }));
        }, { dep, arr, near, names: NAMES });
        await page.waitForTimeout(900);
        await page.click('#wx-pill');
        await page.waitForSelector('#wx-widget-root.wx-open', { timeout: 5000 });
        return page;
    };

    const heroOf = (page) => page.evaluate(() => ({
        place: (document.querySelector('.wx-hero-place') || {}).textContent || '',
        sub: (document.querySelector('.wx-hero-sub') || {}).textContent || '',
        temp: ((document.querySelector('.wx-hero-temp') || {}).textContent || '').trim(),
        cond: (document.querySelector('.wx-hero-cond') || {}).textContent || '',
        cat: (document.querySelector('.wx-hero-cat .key') || {}).textContent || '',
    }));

    // ---- 1. The headline ---------------------------------------------------
    console.log('\nThe headline');
    let page = await open({ dep: 'KATL', arr: 'KORD', near: 'KBNA' });
    let hero = await heroOf(page);
    check('names the station', hero.place === 'KBNA', hero.place);
    check('…and the airport behind the code', /Nashville/.test(hero.sub), hero.sub);
    check('carries the temperature', hero.temp === '23°', hero.temp);
    // conditionLabel only ever describes cloud cover; a station reporting a
    // thunderstorm under a broken sky used to read "Broken".
    check('present weather beats cloud cover', hero.cond === 'Thunderstorms', hero.cond);

    // A METAR has no forecast in it, so the panel must not grow one.
    const body = await page.textContent('#wx-popover');
    check('no high/low is invented from a single observation',
        !/H:\s*-?\d/.test(body) && !/\bL:\s*-?\d/.test(body), body.slice(0, 80));

    // ---- 2. The flight category -------------------------------------------
    console.log('\nThe flight category');
    check('a ceiling of 900 ft reads IFR', hero.cat === 'IFR', hero.cat);

    const catFor = async (icao) => {
        const p = await open({ dep: icao, arr: null, near: null });
        const h = await heroOf(p);
        await p.close();
        return h.cat;
    };
    check('10 km and no ceiling reads VFR', (await catFor('EGLL')) === 'VFR');
    check('4 mi under a 1,200 ft ceiling reads MVFR', (await catFor('KORD')) === 'MVFR');
    check('300 m in fog reads LIFR', (await catFor('EGPH')) === 'LIFR');
    // The worse of the two decides: 1,200 m visibility is IFR on its own, but
    // the 300 ft ceiling underneath it is LIFR, and that is what must show.
    check('the worse of ceiling and visibility decides', (await catFor('ENGM')) === 'LIFR');

    // ---- 3. Derived readings ----------------------------------------------
    console.log('\nWhat the panel works out for itself');
    const tiles = await page.$$eval('.wx-tile', (els) => els.map((e) => ({
        k: e.querySelector('.k').textContent.trim(),
        v: e.querySelector('.v').textContent.trim(),
        s: (e.querySelector('.s') || {}).textContent || '',
    })));
    const tile = (k) => (tiles.find((t) => t.k.toLowerCase() === k) || {});
    // 23°C over a 22°C dewpoint — Magnus-Tetens, not a guess.
    check('humidity is derived from temperature and dewpoint', tile('humidity').v === '94%', tile('humidity').v);
    check('pressure keeps both units without wrapping the tile',
        tile('pressure').v === '29.88 inHg' && /1012 hPa/.test(tile('pressure').s),
        `${tile('pressure').v} / ${tile('pressure').s}`);
    check('the ceiling is named as a ceiling', tile('clouds').v === 'Ceiling 900 ft', tile('clouds').v);
    check('the raw report is still there to read',
        /KBNA 011753Z/.test(await page.textContent('.wx-raw')));

    // ---- 4. The route strip ------------------------------------------------
    console.log('\nThe route strip');
    const strip = await page.$$eval('.wx-strip-item', (els) => els.map((e) => e.getAttribute('data-wx-station')));
    check('carries departure, nearest and arrival', strip.join(',') === 'KATL,KBNA,KORD', strip.join(','));
    check('the one being shown is the one marked',
        (await page.getAttribute('.wx-strip-item.is-on', 'data-wx-station')) === 'KBNA');

    await page.click('.wx-strip-item[data-wx-station="KATL"]');
    await page.waitForTimeout(250);
    hero = await heroOf(page);
    check('pressing another station moves the headline to it', hero.place === 'KATL', hero.place);
    check('…with that station’s own reading', hero.temp === '24°' && hero.cat === 'IFR', `${hero.temp} ${hero.cat}`);
    check('…and its own detail tiles',
        /2 mi/.test(await page.textContent('.wx-tiles')), await page.textContent('.wx-tiles'));
    await page.close();

    // ---- 5. Nothing to report ---------------------------------------------
    console.log('\nA station with nothing to report');
    // ZZZZ is not in the fixture, so the fetch comes back empty — the same
    // shape a real station with no current METAR produces.
    page = await open({ dep: 'EGLL', arr: 'ZZZZ', near: null });
    await page.click('.wx-strip-item[data-wx-station="ZZZZ"]');
    await page.waitForTimeout(250);
    check('says so rather than rendering an empty headline',
        /No report from this station/.test(await page.textContent('.wx-hero')));
    check('and offers no tiles it cannot fill', (await page.$$('.wx-tile')).length === 0);
    await page.close();

    // ---- 6. One station only ----------------------------------------------
    console.log('\nA flight with one known airport');
    page = await open({ dep: 'EGLL', arr: null, near: null });
    check('no strip is drawn for a single station', (await page.$$('.wx-strip-item')).length === 0);
    check('the headline still renders', (await heroOf(page)).place === 'EGLL');
    await page.close();

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} failed.` : '\nAll good.');
    process.exit(failures ? 1 : 0);
})();
