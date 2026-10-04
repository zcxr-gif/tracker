/* test-crew-view-switch.js — the Pilot view ⇄ Admin view button, in Chromium.
 *
 * What it defends:
 *   · owner and staff get the button; a pilot never does (the dashboard sends a
 *     pilot straight back, so "Admin view" would be a door onto itself)
 *   · the address keeps the crew center and the app's embed flag
 *   · pressing it remembers the choice, which is what crew.html's landing reads
 *
 * Needs: playwright-core, and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
 *        pre-installed /opt/pw-browsers/chromium). Skips cleanly without one.
 *
 * Run:  node tools/test-crew-view-switch.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { console.log('skip — playwright-core is not installed'); process.exit(0); }
const exePath = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
if (!fs.existsSync(exePath)) { console.log('skip — no Chromium'); process.exit(0); }

let pass = 0; const fails = [];
const check = (what, ok, saw) => { if (ok) pass++; else fails.push(what + (saw === undefined ? '' : `  (saw ${JSON.stringify(saw)})`)); };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'crewViewSwitch.js'), 'utf8');
const page = (view) => `<!doctype html><html><head><script src="/crewViewSwitch.js"></script></head>
    <body><header><span data-view-switch="${view}" hidden></span></header></body></html>`;

(async () => {
    const browser = await chromium.launch({ executablePath: exePath });
    const ctx = await browser.newContext();
    await ctx.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.pathname === '/crewViewSwitch.js') return route.fulfill({ contentType: 'text/javascript', body: SRC });
        if (u.pathname === '/crew-dashboard.html') return route.fulfill({ contentType: 'text/html', body: page('pilot') });
        if (u.pathname === '/crew-pilot.html') return route.fulfill({ contentType: 'text/html', body: page('admin') });
        return route.fulfill({ status: 404, body: '' });
    });
    const p = await ctx.newPage();
    const as = async (sess) => {
        await p.goto('http://crew.test/crew-dashboard.html?va=ba');
        await p.evaluate((s) => { localStorage.clear(); if (s) localStorage.setItem('crew:session:ba', JSON.stringify(s)); }, sess);
    };

    await as({ token: 't', role: 'owner', name: 'Chris' });
    await p.goto('http://crew.test/crew-dashboard.html?va=ba&embed=1');
    const href = await p.getAttribute('[data-view-go="pilot"]', 'href').catch(() => null);
    check('an owner on the dashboard gets "Pilot view"', !!href, href);
    check('…to this crew center’s pilot home, still embedded', href === '/crew-pilot.html?va=ba&embed=1', href);
    await p.click('[data-view-go="pilot"]');
    await p.waitForURL('**/crew-pilot.html**');
    check('pressing it remembers the pilot view', await p.evaluate(() => localStorage.getItem('crew:view:ba')) === 'pilot');
    const back = await p.getAttribute('[data-view-go="admin"]', 'href').catch(() => null);
    check('…and the pilot home offers the way back', back === '/crew-pilot.html?va=ba&embed=1'.replace('crew-pilot', 'crew-dashboard'), back);

    await as({ token: 't', role: 'staff', name: 'Robin' });
    await p.goto('http://crew.test/crew-pilot.html?va=ba');
    check('staff get it too', await p.locator('[data-view-go="admin"]').count() === 1);

    await as({ token: 't', role: 'pilot', name: 'Rae' });
    await p.goto('http://crew.test/crew-pilot.html?va=ba');
    check('a pilot never does', await p.locator('[data-view-go]').count() === 0);
    check('…and the host stays hidden', await p.locator('[data-view-switch]').evaluate((el) => el.hidden) === true);

    await as(null);
    await p.goto('http://crew.test/crew-dashboard.html?va=ba');
    check('nobody signed in, no button', await p.locator('[data-view-go]').count() === 0);

    await browser.close();
    console.log(`${pass} passed, ${fails.length} failed`);
    if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
})().catch((err) => { console.error(err); process.exit(1); });
