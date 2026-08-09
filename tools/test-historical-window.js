// test-historical-window.js
// Global playback opens the app's own flight window for a flight that stopped
// flying days ago. Three things have to hold, and none of them is visible by
// reading the code:
//
//   * it opens in the look the PILOT chose — Card, Simple or the legacy window
//     — and not in whichever one this module finds convenient;
//   * it is fed the recorded track up to the replay clock and no further, or
//     the window shows a flight that has already landed while the replay is
//     still mid-ocean;
//   * it never claims a filed plan it does not have. Origin and destination
//     are not recorded, and a guessed ICAO in a window read as fact is worse
//     than an honest blank.
//
// Run:  node tools/test-historical-window.js
// Needs: playwright-core, and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
//        pre-installed /opt/pw-browsers/chromium).
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' });
    fs.createReadStream(p).pipe(res);
});

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ''}`); }
};

(async () => {
    await new Promise(r => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium'
    });
    const page = await browser.newPage();
    page.on('pageerror', e => { fail++; console.log('  PAGEERROR:', e.message); });
    await page.goto(`${base}/tools/gpb-chrome-harness.html`);

    const run = (mode, mobile) => page.evaluate(async ({ mode, mobile, base }) => {
        const { createHistoricalFlightWindow } = await import(`${base}/historicalFlightWindow.js`);

        document.querySelectorAll('#aircraft-info-window').forEach(e => e.remove());
        const el = document.createElement('div');
        el.id = 'aircraft-info-window';
        document.body.appendChild(el);

        const calls = { legacy: [], simple: [], mobileOpen: 0, closed: 0, phases: [] };
        let current = null;
        const w = createHistoricalFlightWindow({
            windowEl: () => el,
            getFlightWindowMode: () => mode,
            setCurrentFlight: (id) => { current = id; },
            getCurrentFlight: () => current,
            isMobile: () => mobile,
            ui: {
                primeSimpleWindowPeekHeight: () => {},
                applySimpleWindowPhase: (p) => calls.phases.push(p),
                setInfoWindowContent: (host, html) => { host.innerHTML = html; },
                formatDataForSimpleWindow: (fp, plan, rp) => {
                    calls.simple.push({ plan, points: rp.length, historical: fp.isHistorical,
                                        livery: fp.aircraft.liveryName, vs: fp.position.vs_fpm,
                                        lastDate: rp.length ? rp[rp.length - 1].date : null });
                    return { ok: true };
                },
                populateAircraftInfoWindow: (fp, plan, rp) => {
                    calls.legacy.push({ plan, points: rp.length, historical: fp.isHistorical,
                                        livery: fp.aircraft.liveryName,
                                        lastDate: rp.length ? rp[rp.length - 1].date : null });
                },
                openMobileWindow: () => { calls.mobileOpen++; },
                closeAircraftWindow: () => { calls.closed++; el.classList.remove('visible'); }
            }
        });

        // A one-hour track at one point a minute.
        const t0 = Date.UTC(2026, 7, 1, 12, 0, 0);
        const track = [];
        for (let i = 0; i <= 60; i++) {
            track.push({ t: t0 + i * 60000, lat: 40 + i * 0.02, lon: -70 + i * 0.16,
                         alt: 1000 + i * 600, gs: 250 + i * 4, hdg: 80 });
        }
        const at = t0 + 20 * 60000;          // twenty minutes into the flight
        const data = {
            flightId: 'f1', callsign: 'BAW117', username: 'PilotOne', userId: 'u1',
            aircraftName: 'Boeing 777-300ER', liveryName: 'British Airways',
            atMs: at, track,
            position: { lat: 40.4, lon: -66.8, alt_ft: 13000, gs_kt: 330, heading_deg: 80, vs_fpm: 600 }
        };

        const opened = w.open(data);
        const iframe = document.getElementById('simple-flight-window-frame');
        const afterOpen = {
            opened,
            marked: el.classList.contains('historical-flight'),
            visible: el.classList.contains('visible'),
            iframeSrc: iframe ? iframe.getAttribute('src') : null,
            legacyCalls: calls.legacy.length,
            current
        };

        // Advance the clock ten minutes and update.
        const updated = w.update({ ...data, atMs: at + 10 * 60000 });
        const closed = w.close();

        return { afterOpen, updated, closed, calls,
                 stillMarked: el.classList.contains('historical-flight'), current };
    }, { mode, mobile, base });

    console.log('\nHistorical flight window\n');

    // ---- the pilot's chosen look ----
    const embed = await run('embed', false);
    ok('Card mode opens the card page, in its desktop layout',
        embed.afterOpen.iframeSrc === 'embed-flight.html?desktop=1',
        `src was ${embed.afterOpen.iframeSrc}`);

    const embedMobile = await run('embed', true);
    ok('...and on a phone opens it as the peek sheet instead',
        embedMobile.afterOpen.iframeSrc === 'embed-flight.html'
        && embedMobile.calls.phases[0] === 'collapsed'
        && embedMobile.calls.mobileOpen === 1,
        `src ${embedMobile.afterOpen.iframeSrc}, phase ${embedMobile.calls.phases[0]}`);

    const simple = await run('simple', false);
    ok('Simple mode opens the full flight information page',
        simple.afterOpen.iframeSrc === 'flightinfo.html',
        `src was ${simple.afterOpen.iframeSrc}`);

    const legacy = await run('legacy', false);
    ok('the legacy window is populated directly, with no iframe at all',
        legacy.afterOpen.iframeSrc === null && legacy.afterOpen.legacyCalls === 1,
        `${legacy.afterOpen.legacyCalls} legacy call(s) on open, iframe ${legacy.afterOpen.iframeSrc}`);

    // ---- honest about what a recording holds ----
    ok('the window is told this is not a live flight',
        legacy.calls.legacy[0].historical === true && simple.calls.simple[0].historical === true);

    ok('no filed plan is invented for a flight that never recorded one',
        legacy.calls.legacy[0].plan === null && simple.calls.simple[0].plan === null);

    ok('the livery the payload already carried reaches the window',
        legacy.calls.legacy[0].livery === 'British Airways');

    // ---- the clock ----
    ok('the track stops at the replay clock, not at the end of the flight',
        legacy.calls.legacy[0].points === 21,
        `${legacy.calls.legacy[0].points} points for a 20-minute-in clock (expected 21)`);

    ok('advancing the clock extends the track rather than replacing the window',
        simple.updated === true && simple.calls.simple.length === 2
        && simple.calls.simple[1].points === 31,
        `${simple.calls.simple.length} pushes, second had ${simple.calls.simple[1]?.points} points`);

    ok('vertical speed differenced by the caller is passed through',
        simple.calls.simple[0].vs === 600);

    // ---- teardown ----
    ok('closing clears the mark, the selection and the window',
        legacy.closed === true && legacy.stillMarked === false
        && legacy.current === null && legacy.calls.closed === 1);

    const stale = await page.evaluate(async (base) => {
        const { createHistoricalFlightWindow } = await import(`${base}/historicalFlightWindow.js`);
        const el = document.createElement('div');
        el.id = 'aircraft-info-window-2';
        document.body.appendChild(el);
        let current = 'f1';
        let pushes = 0;
        const w = createHistoricalFlightWindow({
            windowEl: () => el, getFlightWindowMode: () => 'legacy',
            setCurrentFlight: (id) => { current = id; }, getCurrentFlight: () => current,
            isMobile: () => false,
            ui: { primeSimpleWindowPeekHeight(){}, applySimpleWindowPhase(){},
                  setInfoWindowContent(){}, formatDataForSimpleWindow: () => ({}),
                  populateAircraftInfoWindow: () => { pushes++; },
                  openMobileWindow(){}, closeAircraftWindow(){} }
        });
        el.classList.add('historical-flight');
        // An update for an aircraft that is no longer the one on screen.
        const accepted = w.update({ flightId: 'f2', track: [], atMs: 0, position: {} });
        return { accepted, pushes };
    }, base);

    ok('an update for a different aircraft is refused, not drawn over the open one',
        stale.accepted === false && stale.pushes === 0);

    await browser.close();
    server.close();
    console.log(`\n${pass} passing${fail ? `, ${fail} failing` : ''}`);
    process.exit(fail ? 1 : 0);
})();
