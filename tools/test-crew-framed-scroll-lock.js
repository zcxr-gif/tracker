// test-crew-framed-scroll-lock.js
// Pins the blank screens the framed crew center showed for every panel.
//
// THE BUG
//
// Reported as: schedules, statistics, announcements, documents and messages
// all open onto a blank screen — but only inside the crew center framed on the
// VA's own website, never at inflight.info directly.
//
// The panels were fine. The PAGE BEHIND THEM was being thrown off the screen.
//
// crewPanels' scroll lock takes the body out of flow to stop the page moving
// under an open sheet:
//
//     body { position: fixed; top: -<scrollY>px }
//
// That is safe while the body keeps its own height. crewBridge's embed shell
// also set `height:100%` on the framed body, and a percentage height does not
// mean the same thing in both states: in normal flow it resolves against
// <html>, which has no height, so it means `auto` and nothing happens. Fixed,
// it resolves against the initial containing block — one screen. So the lock
// collapsed a 2,500px document to one viewport AND parked it 900px above the
// screen. Everything except the sheet itself (which is fixed, and drew fine)
// was gone, and on a phone the sheet is a bottom sheet, so most of the frame
// was empty.
//
// Standalone it never showed, because without the embed shell the body keeps
// its content height while fixed. Hence "only on the Aeromexico website".
//
// WHAT IS PINNED HERE
//
//   1. The embed shell is actually on. Without this the rest of the file
//      passes against a page that was never framed — which is exactly how the
//      first cut of this fix looked correct while doing nothing.
//   2. Framed, opening a panel does not resize the document.
//   3. Framed, the page behind an open panel is still on screen.
//   4. Closing the panel puts the reader back where they were.
//   5. Standalone behaves the same, so the fix did not buy the frame at the
//      cost of the plain page.
//
// Run:  node tools/test-crew-framed-scroll-lock.js
// Needs: playwright-core (or playwright), and a Chromium at
//        $PLAYWRIGHT_CHROMIUM (or the pre-installed /opt/pw-browsers/chromium).
//        Set PLAYWRIGHT_NO_SANDBOX=1 when running as root in a container.
const http = require('http');
const fs = require('fs');
const path = require('path');

// The repo's other tests take playwright-core; fall back to the full package
// so this runs wherever either one is installed.
const { chromium } = (() => {
    try { return require('playwright-core'); } catch (_) { return require('playwright'); }
})();

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

// A crew page: the two modules a framed panel actually runs on, a sticky header
// like the dashboard's, and enough content to scroll past a screen or two —
// which is the state the bug needs, since a page with nothing below the fold
// has nothing to lose when the lock collapses it.
const INNER = `<!doctype html><meta charset="utf-8"><title>crew inner</title>
<style>
  body { margin:0; font-family:sans-serif; }
  header.sticky { position:sticky; top:0; background:#fff; border-bottom:1px solid #ddd; }
  header.sticky > div { height:4rem; }
  .filler { height:1200px; }
  #marker { height:120px; background:#cfe; }
</style>
<body class="min-h-screen">
<header class="sticky"><div>Crew Center</div></header>
<div class="filler">above</div>
<div id="marker">the dashboard behind the panel</div>
<div class="filler">below</div>
<script src="/crewBridge.js"></script>
<script src="/crewPanels.js"></script>
</body>`;

// The VA's own site: one viewport, no scroll of its own, crew center in a frame.
const HOST = (port) => `<!doctype html><meta charset="utf-8"><title>va host</title>
<style>
  body { margin:0; display:flex; flex-direction:column; height:100dvh; overflow:hidden; }
  #main { flex:1 1 auto; min-height:0; }
  .crew-stage { position:relative; height:100%; }
  .crew-stage iframe { width:100%; height:100%; border:0; display:block; }
</style>
<body>
<main id="main"><div class="crew-stage">
  <iframe id="crewFrame" src="http://127.0.0.1:${port}/__crew-inner.html?embed=1"></iframe>
</div></main>
</body>`;

/**
 * Scroll down, open a panel, and report what the reader is left looking at:
 * the document height before and during the lock, whether the page still
 * covers the screen behind the sheet, and where it ends up after closing.
 */
async function measure(target) {
    await target.evaluate(() => window.scrollTo(0, 900));
    await target.evaluate(() => new Promise((r) => setTimeout(r, 100)));

    const before = await target.evaluate(() => ({
        docHeight: Math.round(document.body.getBoundingClientRect().height),
        scrollY: window.scrollY,
    }));

    await target.evaluate(() => {
        const p = window.CrewPanels.sheet({ id: 'framedPanel', title: 'Schedules' });
        p.body.innerHTML = '<p>Tomorrow · MMMX → KLAX</p>';
        p.open();
        window.__framedPanel = p;
    });
    await target.evaluate(() => new Promise((r) => setTimeout(r, 100)));

    const during = await target.evaluate(() => {
        const body = document.body.getBoundingClientRect();
        const sheet = document.querySelector('#framedPanel .cp-sheet').getBoundingClientRect();
        return {
            docHeight: Math.round(body.height),
            // Does the body still cover any of the screen?
            //
            // Measured on the BODY BOX, not on a child's rect. The lock parks
            // the body at top:-<scrollY>, and a child of a collapsed body still
            // reports a rect inside the viewport — it is merely clipped out of
            // sight by the body's own overflow. So a rect check on the content
            // passes while the reader is looking at nothing, which is precisely
            // the screen this test exists for. The body's own box is the thing
            // that gets clipped to, so it is the thing worth asserting on.
            bodyCoversScreen: body.bottom > 0 && body.top < window.innerHeight,
            // The sheet must still be on screen too — a "fix" that pinned the
            // page by breaking the panel would be no fix at all.
            sheetOnScreen: sheet.bottom > 0 && sheet.top < window.innerHeight && sheet.height > 20,
        };
    });

    await target.evaluate(() => window.__framedPanel.close());
    await target.evaluate(() => new Promise((r) => setTimeout(r, 100)));

    const after = await target.evaluate(() => ({
        scrollY: window.scrollY,
        docHeight: Math.round(document.body.getBoundingClientRect().height),
        inlineHeight: document.body.style.height,
    }));

    return { before, during, after };
}

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    const explicitChromium = process.env.PLAYWRIGHT_CHROMIUM
        || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
    const browser = await chromium.launch({
        ...(explicitChromium ? { executablePath: explicitChromium } : {}),
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });

    const innerFile = path.join(ROOT, '__crew-inner.html');
    const hostFile = path.join(ROOT, '__crew-host.html');
    fs.writeFileSync(innerFile, INNER);
    fs.writeFileSync(hostFile, HOST(port));

    try {
        // ── Framed, the way the VA's website frames it ──────────────────────
        console.log('\nFramed on the VA’s own site\n');

        const page = await browser.newPage({ viewport: { width: 390, height: 664 } });
        await page.goto(`http://127.0.0.1:${port}/__crew-host.html`);
        const frame = page.frameLocator('#crewFrame');
        await page.waitForFunction(() => {
            const f = document.getElementById('crewFrame');
            return !!(f && f.contentWindow && f.contentWindow.CrewPanels);
        });
        const inner = page.frames().find((f) => f.url().includes('__crew-inner'));
        void frame;

        // Guard first. Every assertion below is about what the embed shell does,
        // so a page that is not in embed mode must fail loudly rather than pass
        // by not being the case under test.
        const shell = await inner.evaluate(() => ({
            embedClass: document.body.classList.contains('embed'),
            shellStyle: !!document.getElementById('crew-embed-shell'),
        }));
        eq('the embed shell is applied', shell.embedClass && shell.shellStyle, true);

        const framed = await measure(inner);

        eq('the document keeps its height while a panel is open',
            framed.during.docHeight, framed.before.docHeight);
        eq('the page behind the panel is still on screen',
            framed.during.bodyCoversScreen, true);
        eq('and the panel itself is still on screen',
            framed.during.sheetOnScreen, true);
        eq('closing it puts the reader back where they were',
            framed.after.scrollY, framed.before.scrollY);
        eq('and leaves no pinned height behind',
            framed.after.inlineHeight, '');

        await page.close();

        // ── The same page in a plain tab, which never had the bug ──────────
        console.log('\nStandalone, which must not regress\n');

        const plain = await browser.newPage({ viewport: { width: 390, height: 664 } });
        await plain.goto(`http://127.0.0.1:${port}/__crew-inner.html`);
        await plain.waitForFunction(() => !!window.CrewPanels);

        const solo = await measure(plain.mainFrame());

        eq('the document keeps its height while a panel is open',
            solo.during.docHeight, solo.before.docHeight);
        eq('the page behind the panel is still on screen', solo.during.bodyCoversScreen, true);
        eq('and the panel itself is still on screen', solo.during.sheetOnScreen, true);
        eq('closing it puts the reader back where they were',
            solo.after.scrollY, solo.before.scrollY);

        await plain.close();
    } finally {
        fs.rmSync(innerFile, { force: true });
        fs.rmSync(hostFile, { force: true });
        await browser.close();
        server.close();
    }

    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})();
