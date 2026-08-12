/*
 * test-crew-panel-render.js — does the Infinite Flight panel ever open blank?
 *
 * Run with: node tools/test-crew-panel-render.js
 * Needs Playwright and a Chromium. Skips cleanly (exit 0) when neither is
 * present, so it never breaks a machine that has not got them.
 *
 * WHY THIS TEST EXISTS
 *
 * Reported as "the window doesn't load, the whole page just goes white" — and
 * on the app's dark overlay, black. That symptom is not an empty panel. An
 * empty panel still leaves the dashboard visible behind it. It is the SCROLL
 * LOCK left on: opening a sheet sets `position:fixed; top:-<scrollY>px` on the
 * body, which collapses the document to nothing, and if the render then throws,
 * the lock is never released. What is left is the page background with an empty
 * sheet over it. No content, no error, nothing to click.
 *
 * That failure is invisible to every other kind of test we have. A unit test
 * calls the render function and sees it throw — which is the correct behaviour
 * of a broken function. What matters is what the READER is left looking at, and
 * that is a question about a real layout in a real browser.
 *
 * So each case below breaks the panel a different way and asserts the same
 * three things every time:
 *
 *   1. the panel body is not empty        — there is something to read
 *   2. the body is not scroll-locked      — the page underneath is intact
 *   3. the panel can still be closed      — the reader is not trapped
 *
 * The cases are the failure modes this integration actually has: a backend that
 * 500s, one that returns nonsense, one that hangs, an expired grant, and a
 * response shaped nothing like what the panel expects. The last is the one that
 * matters most, because PublicApi v3 is a preview whose response shape is
 * explicitly allowed to change under us.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHROMIUM_CANDIDATES = [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    process.env.CHROMIUM_PATH,
].filter(Boolean);

function findChromium() {
    for (const p of CHROMIUM_CANDIDATES) if (fs.existsSync(p)) return p;
    return null;
}

let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { try { ({ chromium } = require('playwright')); } catch { chromium = null; } }

const exe = findChromium();
if (!chromium || !exe) {
    console.log('test-crew-panel-render: no Playwright/Chromium here — skipping.');
    process.exit(0);
}

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* Each case: how the backend misbehaves, and what we call it. */
const CASES = [
    {
        name: 'the backend is down (500)',
        handler: 'return { status: 500, body: { error: "Internal error." } };',
    },
    {
        name: 'the backend returns HTML instead of JSON',
        handler: 'return { status: 200, raw: "<!doctype html><h1>Gateway</h1>" };',
    },
    {
        name: 'the grant has expired (409 if_reconnect)',
        handler: 'return { status: 409, body: { error: "Reconnect.", code: "if_reconnect" } };',
    },
    {
        name: 'the VA’s database is on an old schema (409 _missing)',
        handler: 'return { status: 409, body: { error: "Tables missing.", code: "store_schedules_missing" } };',
    },
    {
        // The one the preview API makes likely: everything answers, nothing is
        // the shape the panel expects.
        name: 'the response is a shape the panel has never seen',
        handler: 'return { status: 200, body: { connected: true, scopes: null, enums: null, organization: 7, client: "nope" } };',
    },
    {
        name: 'connected, but every follow-up call fails',
        handler: `
            if (url.endsWith('/if')) {
                return { status: 200, body: {
                    connected: true, failed: false, scopes: ['live:aircraft.read','live:schedules.read','live:schedules.write'],
                    canReadAircraft: true, canReadSchedules: true, canWrite: true,
                    organization: { id: 'o1', name: 'PacificJet', world: { label: 'Expert' } },
                    sync: { enabled: false, aircraftId: '', syncedAt: null },
                    client: { configured: true, source: 'va', type: 'public', canStoreSecret: true },
                    enums: { flightType: [] }, limits: {}, scopeCatalog: {},
                    you: { owner: true, canManageSchedules: true },
                } };
            }
            return { status: 502, body: { error: 'Upstream failed.' } };`,
    },
    {
        // A healthy panel, to prove the assertions can pass at all — a test that
        // only ever sees failures cannot tell "handled well" from "never ran".
        name: 'everything works (control)',
        handler: `
            if (url.endsWith('/if')) {
                return { status: 200, body: {
                    connected: true, failed: false, scopes: ['live:aircraft.read','live:schedules.read'],
                    canReadAircraft: true, canReadSchedules: true, canWrite: false,
                    organization: { id: 'o1', name: 'PacificJet', world: { label: 'Expert' } },
                    sync: { enabled: false, aircraftId: '', syncedAt: null },
                    client: { configured: true, source: 'va', type: 'public', canStoreSecret: true },
                    enums: { flightType: [] }, limits: {}, scopeCatalog: {},
                    you: { owner: true, canManageSchedules: false },
                } };
            }
            if (url.includes('/if/fleet')) {
                return { status: 200, body: {
                    organizationId: 'o1',
                    aircraft: [
                        { id: 'a1', registration: 'N682XL', storage: 'active', fleetRank: 1,
                          type: { name: 'Boeing 787-10 Dreamliner', livery: 'PacificJet' },
                          visibility: { name: 'Visible', label: 'Visible' },
                          position: { hasFix: true, stale: false, state: { name: 'InFlight', label: 'In flight' },
                                      altitude: 34750, speed: 451, heading: 83, updatedAt: new Date().toISOString() } },
                        { id: 'a2', registration: '', storage: 'storage', fleetRank: 2, type: null, position: null },
                    ],
                    summary: { total: 2, active: 1, storage: 1, hangared: 0, airborne: 1 },
                    readAt: new Date().toISOString(),
                } };
            }
            return { status: 200, body: {} };`,
        expectAircraftImages: 2,
    },
];

(async () => {
    const panels = read('crewPanels.js');
    const image = read('crewAircraftImage.js');
    const module_ = read('crewInfiniteFlight.js');

    const browser = await chromium.launch({ executablePath: exe });
    let failures = 0;

    for (const c of CASES) {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e && e.message)));

        // A page with enough height to scroll, so the scroll lock has something
        // to do — the bug only shows itself on a page that was scrolled.
        await page.setContent(
            '<body style="margin:0"><div style="height:4000px">dashboard</div></body>',
        );
        await page.addScriptTag({ content: panels });
        await page.addScriptTag({ content: image });
        await page.addScriptTag({ content: module_ });

        // A throw out of open() is itself one of the outcomes under test — it is
        // the direct cause of the blank panel — so it is CAUGHT and reported
        // rather than allowed to end the run. A harness that dies on the first
        // broken case cannot tell you which of seven broke.
        let threw = '';
        try {
            await page.evaluate(async ({ handler }) => {
                window.scrollTo(0, 500);
                // Stand in for the backend. Deliberately not Playwright's route
                // interception: the panel talks to an absolute URL through
                // CrewPanels.api, and replacing fetch is both simpler and closer to
                // what the module actually experiences.
                // eslint-disable-next-line no-new-func
                const respond = new Function('url', handler);
                window.fetch = async (url) => {
                    const r = respond(String(url)) || { status: 200, body: {} };
                    const text = r.raw !== undefined ? r.raw : JSON.stringify(r.body ?? {});
                    return {
                        ok: r.status >= 200 && r.status < 300,
                        status: r.status,
                        text: async () => text,
                        json: async () => JSON.parse(text),
                    };
                };
                    await window.CrewIF.mount({ backend: 'https://example.invalid', slug: 'demo', token: 't' });
                    window.CrewIF.open();
            }, { handler: c.handler });
        } catch (err) {
            threw = String((err && err.message) || err).split('\n')[0];
        }

        // Let the panel's own follow-up loads land.
        await page.waitForTimeout(350);

        const state = await page.evaluate(() => {
            const el = document.getElementById('cif-panel');
            const body = el && el.querySelector('.cp-body');
            return {
                exists: !!el,
                visible: !!el && !el.classList.contains('cp-hidden'),
                text: body ? body.textContent.trim() : '',
                nodes: body ? body.children.length : 0,
                bodyPosition: getComputedStyle(document.body).position,
                images: document.querySelectorAll('#cif-panel img[data-cai-reg]').length,
                // Are all the aircraft images real, painted pixels?
                brokenImages: [...document.querySelectorAll('#cif-panel img')]
                    .filter((i) => i.complete && i.naturalWidth === 0).length,
            };
        });

        // Now close it, and confirm the page is genuinely handed back.
        const afterClose = await page.evaluate(() => {
            window.CrewIF.close();
            return {
                bodyPosition: getComputedStyle(document.body).position,
                hidden: !!document.getElementById('cif-panel')?.classList.contains('cp-hidden'),
            };
        });

        const problems = [];
        // The direct cause of the blank panel. Reported first, because every
        // other symptom below is downstream of it.
        if (threw) problems.push(`open() threw — ${threw}`);
        if (!state.exists || !state.visible) problems.push('the panel never opened');
        if (!state.text) problems.push('the panel opened BLANK — nothing to read');
        if (state.nodes === 0) problems.push('the panel body has no elements');
        if (afterClose.bodyPosition === 'fixed') problems.push('the page was left scroll-locked — this is the white/black screen');
        if (!afterClose.hidden) problems.push('the panel would not close');
        if (state.brokenImages) problems.push(`${state.brokenImages} broken image(s)`);
        if (c.expectAircraftImages !== undefined && state.images !== c.expectAircraftImages) {
            problems.push(`expected ${c.expectAircraftImages} aircraft images, found ${state.images}`);
        }

        if (problems.length) {
            failures++;
            console.log('  FAIL', c.name);
            for (const p of problems) console.log('        ·', p);
            if (errors.length) console.log('        · page errors:', errors.join(' | '));
        } else {
            console.log('  ok  ', c.name, `— ${state.nodes} node(s), lock released`);
        }
        await page.close();
    }

    await browser.close();
    console.log(failures
        ? `\n${failures} case(s) leave the reader looking at nothing\n`
        : '\nThe panel always opens with something in it, and always gives the page back\n');
    process.exit(failures ? 1 : 0);
})();
