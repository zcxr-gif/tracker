// test-global-playback-chrome.js
// Mounts the real replay chrome — picker and transport — at four viewports and
// checks nothing lands outside the screen, then leaves a screenshot of each so
// the layout can actually be looked at.
//
// The chrome is most of what this module is judged on and the part no unit test
// can reach: it needs a Mapbox context, an API and an hour of recorded traffic
// to appear. GlobalPlayback._internals.__mountChromeForTest exists so it can be
// stood up against none of those, and tools/gpb-chrome-harness.html is the page
// that does it.
//
// The one thing checked automatically is overflow, because it is the one thing
// with an unambiguous answer: an element outside the viewport, or a scroller
// clipped so its contents can never be reached, is a bug at any size. Colour
// and spacing are for the eye, and that is what the PNGs are for.
//
// Run:  node tools/test-global-playback-chrome.js [outdir]
// Needs: playwright-core, and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
//        pre-installed /opt/pw-browsers/chromium).
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
});

const VIEWPORTS = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'iphone-se', width: 375, height: 667 },
    { name: 'iphone-pro', width: 390, height: 844 },
    { name: 'landscape', width: 844, height: 390 },
    // A small phone on its side, where the narrow rules and the short rules
    // both apply and have to agree.
    { name: 'phone-landscape', width: 667, height: 375 }
];

let failures = 0;

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    await new Promise(r => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}/tools/gpb-chrome-harness.html`;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium'
    });

    for (const vp of VIEWPORTS) {
        for (const mode of ['picker', 'panel', 'panel-card']) {
            const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
            page.on('pageerror', e => console.error(`  [${vp.name}/${mode}]`, e.message));
            await page.goto(base);
            await page.waitForFunction(() => window.__ready);
            await page.evaluate((m) => window.mount(
                m === 'picker' ? { picker: true } : m === 'panel-card' ? { select: 'f3' } : {}
            ), mode);
            await page.waitForTimeout(350);
            const file = path.join(OUT, `gpb-${vp.name}-${mode}.png`);
            await page.screenshot({ path: file });

            // Anything outside the viewport is an overflow — except inside a
            // scroller, where being below the fold is the whole point. The two
            // deliberate ones are the filter rail and the picker's body.
            const spill = await page.evaluate(() => {
                const SCROLLERS = '.gpb-rail-track, .gpb-picker-body';
                const bad = [];
                document.querySelectorAll('.gpb-ui *, .gpb-picker *').forEach(el => {
                    if (el.closest(SCROLLERS)) return;
                    const r = el.getBoundingClientRect();
                    if (r.width === 0) return;
                    if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) {
                        bad.push(`${el.className || el.tagName} L${Math.round(r.left)} R${Math.round(r.right)} T${Math.round(r.top)} B${Math.round(r.bottom)}`);
                    }
                });
                // A scroller that scrolls the wrong way is still a bug.
                document.querySelectorAll(SCROLLERS).forEach(el => {
                    if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).overflowY === 'hidden') {
                        bad.push(`${el.className} clipped vertically`);
                    }
                });
                return { bad: bad.slice(0, 8), scrollW: document.documentElement.scrollWidth };
            });
            const wide = spill.scrollW > vp.width;
            const ok = !wide && !spill.bad.length;
            if (!ok) failures++;
            console.log(`  ${ok ? '✓' : '✗'} ${vp.name} / ${mode}${wide ? `  — page scrolls sideways (${spill.scrollW} > ${vp.width})` : ''}`);
            spill.bad.forEach(b => console.log('      outside the viewport:', b));
            await page.close();
        }
    }

    await browser.close();
    server.close();

    console.log(`\n${failures ? `${failures} viewport(s) overflow` : 'nothing overflows at any viewport'}`);
    console.log('shots in', OUT);
    process.exit(failures ? 1 : 0);
})();
