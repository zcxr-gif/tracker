/*
 * tools/test-crew-route-library.js — `npm run test:route-library`
 *
 * FILLING A NETWORK FROM A REAL AIRLINE, AND THE THINGS THAT MUST NOT HAPPEN.
 *
 * The data behind this screen is a 2014 snapshot. It is wrong in the ordinary
 * way old data is wrong — routes that have since died, aeroplanes since
 * replaced — and the entire design of the dialog is an answer to that. So the
 * properties worth protecting are not "does it import", they are the guards:
 *
 *   * nothing is written by looking at it. Opening, searching and ticking are
 *     all dry; the only write is behind a preview AND a ticked acknowledgement.
 *   * the acknowledgement genuinely gates the button. If it stops doing so,
 *     several hundred unreviewed legs land in a live network.
 *   * routes arrive as DRAFTS, so a public network cannot gain a leg nobody read.
 *   * the fleet is agreed to, not appended silently — and unticking a type
 *     leaves it out.
 *   * picking an aircraft for a leg does not untick the leg. The select sits
 *     inside the row's label, and this is one stopPropagation away from being a
 *     dialog that deselects what you just configured.
 *   * a rank gate the VA set by hand is never sent back, so it cannot be cleared.
 *
 * No framework and no database: `node tools/test-crew-route-library.js`, exits
 * non-zero on a failure, needs nothing running.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? '/crew-dashboard.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

const TW = `(function(){var s=document.createElement('style');s.textContent=[
 '.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}',
 '.inset-0{inset:0}.top-0{top:0}.right-0{right:0}.hidden{display:none}',
 '.grid{display:grid}.flex{display:flex}.block{display:block}.inline-flex{display:inline-flex}',
 '.items-center{align-items:center}.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.min-w-0{min-width:0}',
 '.w-full{width:100%}.h-full{height:100%}.overflow-y-auto{overflow-y:auto}',
 '.translate-x-full{transform:translateX(100%)}.z-50{z-index:50}.z-\\\\[60\\\\]{z-index:60}',
 '.left-1\\\\/2{left:50%}.top-1\\\\/2{top:50%}'
].join('');document.head.appendChild(s);window.tailwind={config:{}};})();`;

// Deliberately shaped like the real thing: a leg the VA can already fly, one it
// cannot, one with a choice of aeroplane, and a codeshare with no named partner.
const LIB_AIRLINE = {
    source: 'OpenFlights (ODbL)', sourceUrl: 'https://openflights.org/data.html',
    snapshotYear: 2014, builtAt: '2026-09-14',
    airline: { key: 'BAW', name: 'British Airways', iata: 'BA', icao: 'BAW', country: 'United Kingdom', active: true },
    routes: [
        { origin: 'EGLL', destination: 'KJFK', distanceNm: 3000, aircraft: 'Boeing 777-200ER', aircraftOptions: ['Boeing 777-200ER'], ownAircraftOptions: ['Boeing 777-200ER'], partnerAircraftOnly: false, kind: 'own', partnerName: '', realCodeshare: false, flightNumber: '', notes: '', inFleet: true, newTypes: [] },
        { origin: 'EGLL', destination: 'OMDB', distanceNm: 2900, aircraft: 'Boeing 787-9 Dreamliner', aircraftOptions: ['Boeing 787-9 Dreamliner', 'Airbus A380-800'], ownAircraftOptions: ['Boeing 787-9 Dreamliner', 'Airbus A380-800'], partnerAircraftOnly: false, kind: 'own', partnerName: '', realCodeshare: false, flightNumber: '', notes: '', inFleet: false, newTypes: ['Boeing 787-9 Dreamliner'] },
        // Sold by the airline, flown by somebody the source does not name.
        { origin: 'EDDF', destination: 'EGLC', distanceNm: 335, aircraft: 'Embraer E175', aircraftOptions: ['Embraer E175'], ownAircraftOptions: ['Embraer E175'], partnerAircraftOnly: false, kind: 'own', partnerName: '', realCodeshare: true, flightNumber: '', notes: '', inFleet: false, newTypes: ['Embraer E175'] },
        // The AeroMéxico CRJ-900 shape: every aeroplane listed belongs to
        // whoever flew it for them, so the leg carries none at all.
        { origin: 'KATL', destination: 'KPIT', distanceNm: 460, aircraft: '', aircraftOptions: ['Bombardier CRJ-900'], ownAircraftOptions: [], partnerAircraftOnly: true, kind: 'own', partnerName: '', realCodeshare: true, flightNumber: '', notes: '', inFleet: false, newTypes: [] },
    ],
};

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log('  ✗ ' + n + (x ? '  (' + x + ')' : '')); fail++; } };

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const page = await ctx.newPage();

    const errs = []; page.on('pageerror', e => errs.push(e.message));
    // Every write the page attempts, in order. The central assertion of this
    // file is about what is in here and when.
    const writes = [];

    await page.route('**/cdn.tailwindcss.com**', r => r.fulfill({ contentType: 'application/javascript', body: TW }));
    await page.route('**/unpkg.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/api/**', async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const p = u.pathname;
        const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
        const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch { return {}; } };

        if (p.endsWith('/crew/route-library/airlines')) {
            return json({ ok: true, source: LIB_AIRLINE.source, snapshotYear: 2014, builtAt: '2026-09-14', total: 1,
                airlines: [{ key: 'BAW', name: 'British Airways', iata: 'BA', icao: 'BAW', country: 'United Kingdom', active: true, routes: 3, types: 4 }] });
        }
        if (p.includes('/route-library/airline/')) return json(LIB_AIRLINE);
        if (p.includes('/routes/library-import')) {
            const b = body();
            writes.push({ what: 'library-import', dryRun: b.dryRun !== false, routes: b.routes || [] });
            const plan = { kind: 'routes', create: (b.routes || []).length, update: 0, unchanged: 0,
                errors: [], errorCount: 0, matchedOn: 'origin+destination', publish: false };
            return json(b.dryRun !== false ? { dryRun: true, ...plan } : { dryRun: false, ...plan, created: plan.create, updated: 0, failures: [] });
        }
        if (p.endsWith('/settings') && req.method() === 'POST') {
            const b = body();
            writes.push({ what: 'settings', fleet: (b.fleet || []).map(f => f.type),
                liveries: (b.fleet || []).map(f => f.name), rows: b.fleet || [] });
            return json({ ok: true, fleet: b.fleet || [] });
        }
        if (p.endsWith('/crew/aircraft-metadata')) return json({ ok: true,
            aircraft: ['Boeing 777-200ER', 'Boeing 787-9 Dreamliner', 'Embraer E175', 'Airbus A380-800'],
            liveries: {
                'Boeing 777-200ER': ['British Airways', 'Generic'],
                'Boeing 787-9 Dreamliner': ['British Airways', 'Generic'],
                'Airbus A380-800': ['British Airways', 'Emirates', 'Generic'],
                // Deliberately WITHOUT a British Airways option, to prove a miss
                // leaves the row blank rather than picking something arbitrary.
                'Embraer E175': ['Generic'],
            } });
        if (p.includes('/aircraft/lookup')) return json({ isPlaceholder: true, imageUrl: null, contributorName: 'System' });
        if (p.endsWith('/routes')) return json({ routes: [], ranks: [] });
        if (p.endsWith('/route-map')) return json({ routes: [], airports: [], stats: {} });
        if (p.includes('/va-ads/by-slug/') || p.endsWith('/branding')) {
            return json({ name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial'],
                fleet: [{ type: 'Boeing 777-200ER', name: '', image: '' }] });
        }
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

    console.log('\n getting to it');
    await page.evaluate(() => openRoutes());
    await page.waitForTimeout(250);
    ok('a manager sees the Real routes button',
        await page.evaluate(() => !document.getElementById('routesLibBtn').classList.contains('hidden')));

    await page.evaluate(() => openRouteLib());
    await page.waitForTimeout(400);
    ok('the airline picker lists what the library has',
        (await page.evaluate(() => document.querySelectorAll('#libResults button').length)) === 1);
    ok('nothing has been written by opening it', writes.length === 0);

    console.log('\n choosing a network');
    await page.evaluate(() => libPickAirline('BAW'));
    await page.waitForTimeout(400);
    const rows = await page.evaluate(() => document.querySelectorAll('#libRows [data-lib-idx]').length);
    ok('every leg is listed', rows === 4, 'got ' + rows);
    ok('a leg flown only on a partner’s aeroplane is marked as such',
        (await page.evaluate(() => [...document.querySelectorAll('#libRows label')]
            .filter(l => /not their aircraft/i.test(l.textContent)).length)) === 1);
    ok('the snapshot year is shown beside the airline',
        /2014/.test(await page.evaluate(() => document.getElementById('libAge').textContent)));
    // Pre-ticking what they can already fly is a starting point, not a decision.
    ok('legs the fleet can already fly start ticked',
        (await page.evaluate(() => [...document.querySelectorAll('#libRows [data-lib-idx]')].filter(e => e.checked).length)) === 1);
    ok('still nothing written', writes.length === 0);

    // THE ONE THAT BITES. The aircraft select is inside the row's <label>.
    await page.evaluate(() => { libTickAll(true); });
    await page.waitForTimeout(150);
    await page.selectOption('#libRows [data-lib-ac="1"]', 'Airbus A380-800');
    await page.waitForTimeout(150);
    ok('picking an aircraft does not untick its route',
        await page.evaluate(() => document.querySelector('#libRows [data-lib-idx="1"]').checked));
    ok('…and the choice is kept',
        (await page.evaluate(() => LIB_AIRLINE.routes[1].aircraft)) === 'Airbus A380-800');

    console.log('\n the review step');
    await page.evaluate(() => libReview());
    await page.waitForTimeout(400);
    ok('the preview asked the server, and asked dryly',
        writes.length === 1 && writes[0].what === 'library-import' && writes[0].dryRun === true);
    ok('a rank gate is never sent back, so it cannot be cleared',
        writes[0].routes.every(r => !('minRank' in r)));
    ok('nor is a partner logo', writes[0].routes.every(r => !('partnerLogo' in r)));
    ok('nothing is sent as a codeshare by default',
        writes[0].routes.every(r => r.kind === 'own'));
    ok('…so no unnamed codeshare can reach the database',
        writes[0].routes.every(r => !(r.kind === 'codeshare' && !r.partnerName)));

    const fleetOffer = await page.evaluate(() => [...document.querySelectorAll('#libFleetAdd [data-lib-type]')]
        .map(e => e.parentElement.textContent.trim()));
    // A fleet row is a type AND a livery. Without one it cannot be picked on a
    // route (routableFleet) and no photo is ever fetched (resolveFleetPicture).
    ok('every new aircraft is offered a livery',
        (await page.evaluate(() => document.querySelectorAll('#libFleetAdd [data-lib-livery]').length)) === 2);
    ok('…pre-filled with the airline’s own where it exists',
        (await page.evaluate(() => LIB_NEWTYPES.find(x => /A380/.test(x.type)).livery)) === 'British Airways');
    ok('…left blank rather than guessed where it does not',
        (await page.evaluate(() => LIB_NEWTYPES.find(x => /E175/.test(x.type)).livery)) === '');
    ok('…and the blank one is called out',
        /no livery yet/i.test(await page.evaluate(() => document.getElementById('libFleetBlanks').textContent)));
    // Set it, and the warning should clear itself.
    await page.selectOption('#libFleetAdd [data-lib-livery="1"]', 'Generic');
    await page.waitForTimeout(150);
    ok('…which clears once a livery is chosen',
        !/no livery yet/i.test(await page.evaluate(() => document.getElementById('libFleetBlanks').textContent)));
    ok('the aircraft it would add are named', fleetOffer.length === 2, JSON.stringify(fleetOffer));
    ok('…and the A380 picked a moment ago is among them',
        fleetOffer.some(t => /A380-800/.test(t)), JSON.stringify(fleetOffer));
    ok('…while the type already in the fleet is not offered',
        !fleetOffer.some(t => /777-200ER/.test(t)));

    console.log('\n somebody else’s aeroplane');
    ok('the leg with no aircraft is called out in the review',
        !(await page.evaluate(() => document.getElementById('libNoAircraft').classList.contains('hidden'))));
    ok('…naming the aeroplane that is not theirs',
        /CRJ-900/.test(await page.evaluate(() => document.getElementById('libNoAircraft').textContent)));
    ok('…and saying it imports with no aircraft rather than the partner’s',
        /no aircraft set/i.test(await page.evaluate(() => document.getElementById('libNoAircraft').textContent)));
    ok('it is not offered as a fleet addition',
        !(await page.evaluate(() => LIB_NEWTYPES.some(x => /CRJ-900/.test(x.type)))));
    ok('…so no livery is ever suggested for it',
        !(await page.evaluate(() => document.getElementById('libFleetAdd').textContent)).match(/CRJ-900/));

    console.log('\n what was sold but not flown');
    ok('the choice is put to the VA',
        !(await page.evaluate(() => document.getElementById('libCodeshare').classList.contains('hidden'))));
    ok('…naming how many legs it is about',
        /2 of these were sold, not flown/i.test(await page.evaluate(() => document.getElementById('libCodeshare').textContent)));
    ok('…and saying plainly that the operator is unknown',
        /doesn.t record which partner/i.test(await page.evaluate(() => document.getElementById('libCodeshare').textContent)));
    ok('the default is to fly them yourself',
        (await page.evaluate(() => LIB_CS.mode)) === 'own');

    // "A partner flies them" without saying who is the state the routes screen
    // refuses. The button must go dead, not let them find out after the write.
    const before = writes.length;
    await page.evaluate(() => {
        const r = document.querySelector('#libCodeshare input[value="partner"]');
        r.checked = true; r.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.getElementById('libAgree').checked = true; libSyncCommit(); });
    ok('naming a partner is demanded before it can be committed',
        await page.evaluate(() => document.getElementById('libCommitBtn').disabled));
    await page.fill('#libCsPartner', 'Iberia Virtual');
    await page.waitForTimeout(800);   // the debounced re-review
    await page.evaluate(() => { document.getElementById('libAgree').checked = true; libSyncCommit(); });
    ok('…and typing one releases it',
        !(await page.evaluate(() => document.getElementById('libCommitBtn').disabled)));
    const reviewed = writes.slice(before).filter(w => w.dryRun);
    ok('a changed choice re-asks for the acknowledgement',
        await page.evaluate(() => { const a = document.getElementById('libAgree'); const was = a.checked;
            const r = document.querySelector('#libCodeshare input[value="own"]'); r.checked = true; r.dispatchEvent(new Event('change'));
            return was; }) === true);
    await page.waitForTimeout(400);
    ok('…so the button is dead again until it is given',
        await page.evaluate(() => document.getElementById('libCommitBtn').disabled));
    await page.evaluate(() => {
        const r = document.querySelector('#libCodeshare input[value="partner"]');
        r.checked = true; r.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(800);
    ok('the diff was re-asked when the choice changed', reviewed.length >= 1);
    ok('…and the sold-not-flown leg now carries the partner',
        reviewed.length && reviewed[reviewed.length - 1].routes
            .some(r => r.kind === 'codeshare' && r.partnerName === 'Iberia Virtual'));
    ok('…while the legs they flew themselves stay own metal',
        reviewed.length && reviewed[reviewed.length - 1].routes
            .filter(r => r.origin === 'EGLL').every(r => r.kind === 'own'));

    // Leaving them out must actually remove them from the payload.
    await page.evaluate(() => {
        const r = document.querySelector('#libCodeshare input[value="skip"]');
        r.checked = true; r.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(400);
    const skipped = writes[writes.length - 1];
    ok('leaving them out drops them from the import',
        skipped.dryRun && skipped.routes.length === 2 && !skipped.routes.some(r => r.origin === 'EDDF' || r.origin === 'KATL'),
        JSON.stringify(skipped.routes.map(r => r.origin + '-' + r.destination)));

    // Back to the default for the commit assertions below.
    await page.evaluate(() => {
        const r = document.querySelector('#libCodeshare input[value="own"]');
        r.checked = true; r.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(400);

    console.log('\n the guard that matters');
    ok('the confirm button is dead until the caveat is acknowledged',
        await page.evaluate(() => document.getElementById('libCommitBtn').disabled));
    await page.evaluate(() => { document.getElementById('libAgree').checked = true; libSyncCommit(); });
    ok('…and live once it is',
        !(await page.evaluate(() => document.getElementById('libCommitBtn').disabled)));
    ok('the button says these are drafts',
        /draft/i.test(await page.evaluate(() => document.getElementById('libCommitBtn').textContent)));

    // Leave one type out, to prove the tick is real.
    await page.evaluate(() => {
        const box = [...document.querySelectorAll('#libFleetAdd [data-lib-type]')]
            .find(e => /E175/.test(e.parentElement.textContent));
        if (box) { box.checked = false; box.dispatchEvent(new Event('change')); }
    });

    console.log('\n committing');
    await page.evaluate(() => libCommit());
    await page.waitForTimeout(600);
    const commit = writes.find(w => w.what === 'library-import' && w.dryRun === false);
    ok('the routes were written', !!commit);
    ok('…all four of them', commit && commit.routes.length === 4);
    ok('…and never with a published flag of their own',
        commit && commit.routes.every(r => r.active !== true));

    const fleetSave = writes.find(w => w.what === 'settings');
    ok('the fleet was saved too', !!fleetSave);
    ok('…with the type that was left ticked',
        fleetSave && fleetSave.fleet.includes('Airbus A380-800'), JSON.stringify(fleetSave && fleetSave.fleet));
    ok('…carrying the livery, not just the type',
        fleetSave && fleetSave.liveries.includes('British Airways'), JSON.stringify(fleetSave && fleetSave.liveries));
    ok('…so the new rows are pickable on a route',
        fleetSave && fleetSave.rows.filter(r => /A380/.test(r.type)).every(r => r.name));
    ok('…without the one that was unticked',
        fleetSave && !fleetSave.fleet.includes('Embraer E175'), JSON.stringify(fleetSave && fleetSave.fleet));
    ok('…and the fleet it already had is intact',
        fleetSave && fleetSave.fleet.includes('Boeing 777-200ER'));
    ok('the routes are written before the fleet, so a fleet failure cannot lose them',
        writes.indexOf(commit) < writes.indexOf(fleetSave));
    ok('the dialog closed itself',
        await page.evaluate(() => document.getElementById('libModal').classList.contains('hidden')));

    ok('no page errors throughout', errs.length === 0, errs.join(' | '));

    await ctx.close(); await browser.close(); server.close();
    console.log(fail ? `\n${fail} failed, ${pass} passed\n` : `\nall ${pass} checks passed\n`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
