// test-crew-blank-screen.js
// Reproduces the crew center's black screen and proves the safety net now
// catches it.
//
// THE BUG
//
// Opening Partnership / Events / Schedules could leave the crew center on a
// black screen with nothing to click. It is not a panel that rendered nothing —
// an empty panel over a normal page still shows the dashboard behind it. It is
// the SCROLL LOCK: opening a panel takes the body out of flow
// (position:fixed; top:-scrollY), which collapses the document to nothing. If
// the render then throws, the lock is never released and what is left is an
// empty sheet over a collapsed page. Framed in the app's Crew Center overlay,
// with the embedded body deliberately transparent, that is a black screen.
//
// crewPanels.js already had a net for this — and it did not fire, because it
// asked "is a panel open?" and an empty shell answers yes. So it concluded the
// reader was looking at something and left the page locked. That is the bug
// this file pins: the question has to be "is anything on SCREEN", not "is
// anything open".
//
// The failure is forced by making a panel's render throw, rather than waiting
// for the payload that happens to do it in production — the net has to hold for
// any of them, not one.
//
// Run:  node tools/test-crew-blank-screen.js
// Needs: playwright-core, and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
//        pre-installed /opt/pw-browsers/chromium). Set PLAYWRIGHT_NO_SANDBOX=1
//        when running as root in a container.
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('');
    }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
    fs.createReadStream(file).pipe(res);
});

let pass = 0; let fail = 0;
const ok = (name) => { pass += 1; console.log(`  ✓ ${name}`); };
const bad = (name, detail) => { fail += 1; console.log(`  ✗ ${name}\n      ${detail}`); };
const eq = (name, actual, expected) => (
    actual === expected ? ok(name) : bad(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
);

// A page carrying only crewPanels.js — the shell every crew panel is built on,
// and where both the lock and the net live.
const HARNESS = `<!doctype html><meta charset="utf-8"><title>panel harness</title>
<body style="min-height:3000px">
<div id="filler">dashboard content</div>
<script src="/crewPanels.js"></script>
</body>`;

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    const explicitChromium = process.env.PLAYWRIGHT_CHROMIUM
        || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
    const browser = await chromium.launch({
        ...(explicitChromium ? { executablePath: explicitChromium } : {}),
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });

    const harnessFile = path.join(ROOT, '__panel-harness.html');
    fs.writeFileSync(harnessFile, HARNESS);

    try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
        await page.goto(`http://127.0.0.1:${port}/__panel-harness.html`);
        await page.waitForFunction(() => !!window.CrewPanels);

        // ── The failure, as it happens in the wild ──────────────────────────
        console.log('\nA panel whose render throws\n');

        // Open a panel, then throw before writing anything into its body —
        // exactly the shape of a render that dies on an unexpected payload.
        await page.evaluate(() => {
            const p = window.CrewPanels.sheet({ id: 'testPanel', title: 'Partnership' });
            p.open();
            window.__panel = p;
            // Thrown asynchronously so it reaches window.onerror the way a real
            // render failure does, rather than being caught by evaluate().
            setTimeout(() => { throw new TypeError("Cannot read properties of undefined (reading 'status')"); }, 0);
        });
        await page.waitForTimeout(500);

        const after = await page.evaluate(() => ({
            bodyText: document.querySelector('#testPanel .cp-body').textContent.trim(),
            locked: document.body.style.position === 'fixed',
            panelShown: !document.getElementById('testPanel').classList.contains('cp-hidden'),
            // What the reader can actually reach.
            clickable: (() => {
                const el = document.elementFromPoint(60, 400);
                return el ? (el.id || el.tagName) : null;
            })(),
        }));

        eq('the panel body is empty, as it was when it threw', after.bodyText, '');
        eq('the page is no longer locked behind it', after.locked, false);
        eq('and the empty shell is taken down', after.panelShown, false);
        (after.clickable && after.clickable !== 'HTML')
            ? ok('the dashboard underneath is reachable again')
            : bad('the dashboard underneath is reachable again', `elementFromPoint gave ${after.clickable}`);

        // ── The part that must NOT change ───────────────────────────────────
        // A panel that rendered something is a panel the reader is using. An
        // unrelated error must never close it or unlock the page under it.
        console.log('\nA panel that rendered, with an error elsewhere\n');

        await page.evaluate(() => {
            const p = window.CrewPanels.sheet({ id: 'goodPanel', title: 'Schedules' });
            p.body.innerHTML = '<p>Tuesday · LHR → JFK</p>';
            p.open();
            setTimeout(() => { throw new Error('something unrelated blew up'); }, 0);
        });
        await page.waitForTimeout(500);

        const good = await page.evaluate(() => ({
            shown: !document.getElementById('goodPanel').classList.contains('cp-hidden'),
            locked: document.body.style.position === 'fixed',
            text: document.querySelector('#goodPanel .cp-body').textContent.trim(),
        }));

        eq('the panel stays open', good.shown, true);
        eq('its content is untouched', good.text, 'Tuesday · LHR → JFK');
        eq('and the page stays locked behind it', good.locked, true);

        await page.close();
    } finally {
        fs.rmSync(harnessFile, { force: true });
        await browser.close();
        server.close();
    }

    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})();
