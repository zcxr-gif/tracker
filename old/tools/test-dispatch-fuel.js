// test-dispatch-fuel.js
// The Block Fuel field on the dispatch form shipped labelled "(Future Update)"
// with the help text "Fuel telemetry will be fully integrated in an upcoming
// update", and the quick guide promised "Fuel calculations coming soon!". So
// the one number on that form nobody can work out in their head was the one the
// form declined to work out for them.
//
// This drives the REAL module to prove the plan is arithmetic a pilot can
// follow rather than a figure they have to trust:
//
//   * block fuel is taxi + trip + contingency + alternate + reserve, and the
//     parts add up to the total that lands in the field
//   * a bigger aeroplane burns more and carries more — the plan is a function
//     of the type, not a constant
//   * EET uses the type's own cruise speed, so a Q400 and an A350 no longer
//     file the same time for the same route
//   * a figure the pilot typed is never overwritten, except on a type change,
//     which is the one edit that invalidates it
//   * none of the "coming soon" copy survives
//
// Run:  node tools/test-dispatch-fuel.js
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/blank') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<!doctype html><meta charset="utf-8"><body></body>');
    }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${extra !== undefined ? `  (${extra})` : ''}`); fail++; }
};
const head = (s) => console.log(`\n${s}`);

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { console.log(`  ! page error: ${e.message}`); fail++; });
    await page.goto(`http://127.0.0.1:${port}/blank`);

    // Load the real module and hand it a host carrying profileUI's burn table,
    // which is the table it is supposed to defer to.
    await page.evaluate(async (p) => {
        const mod = await import(`http://127.0.0.1:${p}/FlightDispatchUI.js`);
        window.FDU = mod.FlightDispatchUI;
        window.FDU._host = {
            // The real function, copied verbatim from profileUI so this test
            // fails if the dispatch panel stops asking for it.
            _fuelBurnKgPerHr(name) {
                const n = String(name || '').toLowerCase();
                const has = (...k) => k.some(s => n.includes(s));
                if (has('a380')) return 11500;
                if (has('747')) return 10500;
                if (has('777')) return 7400;
                if (has('787', 'dreamliner')) return 5300;
                if (has('737', 'max')) return 2500;
                if (has('a320', 'a321', 'a319', 'a318')) return 2400;
                if (has('crj', 'e175', 'e190', 'q400', 'dash')) return 1700;
                return 2200;
            },
        };
    }, port);

    // ------------------------------------------------------------------
    head('The block fuel adds up');

    const plan = await page.evaluate(() => window.FDU._planFuel('B77W', 600));
    ok('a plan has every part of a release, not one number',
        ['taxi', 'trip', 'contingency', 'alternate', 'reserve', 'block'].every((k) => typeof plan[k] === 'number'),
        JSON.stringify(plan));
    ok('…and the parts add up to the block',
        plan.block === plan.taxi + plan.trip + plan.contingency + plan.alternate + plan.reserve,
        JSON.stringify(plan));
    ok('trip fuel is the burn over the EET',
        plan.trip === Math.round(plan.burn * 10), `${plan.trip} vs ${plan.burn * 10}`);
    ok('contingency is 5% of the trip',
        plan.contingency === Math.round(plan.trip * 0.05), `${plan.contingency}`);
    ok('the 777 burn comes from profileUI\'s table, converted to lbs',
        plan.burn === Math.round(7400 * 2.20462), `${plan.burn}`);

    // ------------------------------------------------------------------
    head('The plan is a function of the aeroplane');

    const cmp = await page.evaluate(() => ({
        heavy: window.FDU._planFuel('B77W', 120),
        light: window.FDU._planFuel('CRJ9', 120),
        heavyLoad: window.FDU._planPayload('B77W'),
        lightLoad: window.FDU._planPayload('CRJ9'),
        unknown: window.FDU._planPayload('ZZZZ'),
    }));
    ok('a 777 burns more than a CRJ over the same leg',
        cmp.heavy.block > cmp.light.block * 2, `${cmp.heavy.block} vs ${cmp.light.block}`);
    ok('…and carries more people', cmp.heavyLoad.pax > cmp.lightLoad.pax,
        `${cmp.heavyLoad.pax} vs ${cmp.lightLoad.pax}`);
    ok('the load is 85% of the seats, not a sold-out aeroplane',
        cmp.heavyLoad.pax === Math.round(cmp.heavyLoad.seats * 0.85), JSON.stringify(cmp.heavyLoad));
    ok('an aircraft nobody added performance for still plans a usable flight',
        cmp.unknown.pax > 0 && cmp.unknown.seats > 0, JSON.stringify(cmp.unknown));

    // ------------------------------------------------------------------
    head('EET knows what it is flying');

    // Stub the airports fetch so the maths is the only thing under test:
    // EGLL → KJFK, a leg whose real distance is ~2,990 NM.
    const eet = await page.evaluate(async () => {
        window.FDU._host._airportCache = {
            EGLL: { lat: 51.4706, lon: -0.461941 },
            KJFK: { lat: 40.639751, lon: -73.778925 },
        };
        return {
            dash: await window.FDU._autoCalculateRouteEET('EGLL', 'KJFK', 'DH8D'),
            jet: await window.FDU._autoCalculateRouteEET('EGLL', 'KJFK', 'A359'),
            untyped: await window.FDU._autoCalculateRouteEET('EGLL', 'KJFK'),
        };
    });
    ok('a turboprop is given longer than a widebody for the same route',
        eet.dash > eet.jet, JSON.stringify(eet));
    ok('…by an amount that matters, not a rounding difference',
        eet.dash - eet.jet > 60, `${eet.dash - eet.jet} min`);
    ok('an unspecified type still gets a usable time', eet.untyped > 0, `${eet.untyped}`);

    // ------------------------------------------------------------------
    head('The form fills itself in, and leaves typed figures alone');

    await page.evaluate(() => {
        document.body.innerHTML = window.FDU.getTabHTML(window.FDU._host);
    });
    ok('the form no longer promises fuel "in an upcoming update"',
        !/upcoming update|coming soon|Future Update/i.test(await page.innerText('body')),
        (await page.innerText('body')).match(/upcoming update|coming soon|Future Update/i) || '');

    const filled = await page.evaluate(async () => {
        document.getElementById('pui-new-aircraft').value = 'B789';
        document.getElementById('pui-new-dep').value = 'EGLL';
        document.getElementById('pui-new-arr').value = 'KJFK';
        await window.FDU._recalculateLoad();
        return {
            fuel: document.getElementById('pui-new-fuel').value,
            pax: document.getElementById('pui-new-pax').value,
            eet: document.getElementById('pui-new-duration').value,
            plan: document.getElementById('pui-load-plan').innerText,
        };
    });
    ok('block fuel lands in the field', Number(filled.fuel) > 0, filled.fuel);
    ok('…as does a sensible pax load', Number(filled.pax) > 0, filled.pax);
    ok('…and the EET it was planned against', Number(filled.eet) > 0, filled.eet);
    ok('the breakdown is shown, so the number can be checked',
        /Taxi/.test(filled.plan) && /Contingency/.test(filled.plan) && /Final reserve/.test(filled.plan),
        filled.plan.slice(0, 120));

    // A figure the pilot typed is theirs.
    const kept = await page.evaluate(async () => {
        document.getElementById('pui-new-fuel').value = '12345';
        document.getElementById('pui-new-pax').value = '7';
        await window.FDU._recalculateLoad();
        return {
            fuel: document.getElementById('pui-new-fuel').value,
            pax: document.getElementById('pui-new-pax').value,
        };
    });
    ok('a fuel figure the pilot entered is not overwritten', kept.fuel === '12345', kept.fuel);
    ok('…nor is their pax count', kept.pax === '7', kept.pax);

    // …except when they change what they are flying, which invalidates it.
    const forced = await page.evaluate(async () => {
        document.getElementById('pui-new-aircraft').value = 'A388';
        await window.FDU._recalculateLoad({ force: true });
        return document.getElementById('pui-new-fuel').value;
    });
    ok('changing the aircraft does replan, because the old figure was for another aeroplane',
        forced !== '12345' && Number(forced) > 0, forced);

    await ctx.close();
    await browser.close();
    server.close();

    console.log(`\n${fail ? `${fail} failed, ` : ''}${pass} passed.`);
    process.exit(fail ? 1 : 0);
})();
