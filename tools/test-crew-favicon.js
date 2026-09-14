/*
 * tools/test-crew-favicon.js — `npm run test:favicon`
 *
 * THE TAB.
 *
 * A pilot leaves their crew centre open all day, next to their airline's
 * website and half a dozen other tabs. Both of ours carried no icon at all, so
 * the browser drew its own placeholder globe — the same globe as every other
 * unbranded page — and the one tab the airline most wants recognised was the
 * one tab you could not pick out of a row of them.
 *
 * The airline's uploaded logo is the icon now, and where there is none, its
 * initials on its own accent. This drives the REAL crew centre pages in a real
 * browser and reads what ended up in the head; the website half of the same
 * change is covered in test-crew-data-feed.js, which runs crew-feed.js against
 * a stub DOM.
 *
 * Run:  node tools/test-crew-favicon.js
 */
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? '/crew-dashboard.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

const LOGO = 'https://cdn.example/ova.png';
const WITH_LOGO = { name: 'Ocean Virtual', code: 'OVA', logo: LOGO, accent: '#0EA5A0' };
const NO_LOGO = { name: 'Ocean Virtual', code: 'OVA', accent: '#0EA5A0' };

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log('  ✗ ' + n + (x ? '  (' + x + ')' : '')); fail++; } };

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    /* The three third-party hosts the crew pages load are all unreachable from
       a test runner, and none of them is what is under test. Lucide is stubbed
       rather than blocked because the pages call it by name. */
    const open = async (page_, brand) => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await ctx.newPage();
        const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.route('**/api/**', (route) => {
            const p = new URL(route.request().url()).pathname;
            const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
            if (p.includes('/va-ads/by-slug/') || p.endsWith('/branding')) return json(brand);
            if (p.endsWith('/me')) return json({ role: 'owner', capabilities: ['routes.manage'], name: 'Owner' });
            return json({});
        });
        await page.addInitScript(() => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' }));
            localStorage.setItem('crew:tour:staff:testva', '1');
        });
        await page.goto(`http://127.0.0.1:${port}/${page_}?va=testva`);
        await page.waitForTimeout(2200);
        return { ctx, page, errs };
    };

    const read = (page) => page.evaluate(() => {
        const ic = document.querySelector('link[rel~="icon"]');
        const at = document.querySelector('link[rel="apple-touch-icon"]');
        const href = ic ? ic.getAttribute('href') : '';
        let svgOk = null;
        if (/^data:image\/svg\+xml,/.test(href)) {
            const body = decodeURIComponent(href.replace(/^data:image\/svg\+xml,/, ''));
            const d = new DOMParser().parseFromString(body, 'image/svg+xml');
            svgOk = !d.querySelector('parsererror') && d.documentElement.tagName === 'svg';
        }
        return {
            href,
            decoded: href ? decodeURIComponent(href) : '',
            icons: document.querySelectorAll('link[rel~="icon"]').length,
            apple: at ? at.getAttribute('href') : null,
            svgOk,
        };
    });

    /* =====================================================================
     * 1. THE AIRLINE'S OWN LOGO
     * ================================================================== */
    for (const page_ of ['crew-dashboard.html', 'crew-pilot.html', 'crew-status.html']) {
        console.log('\n' + page_ + ' — an airline with a logo');
        const { ctx, page, errs } = await open(page_, WITH_LOGO);
        const s = await read(page);
        ok('the logo is the tab’s icon', s.href === LOGO, s.href);
        ok('…exactly one of them', s.icons === 1, String(s.icons));
        ok('…and iOS gets one it can put on a home screen', s.apple === LOGO, String(s.apple));
        ok('no page errors', errs.length === 0, errs.join('|'));
        await ctx.close();
    }

    /* =====================================================================
     * 2. AN AIRLINE THAT HAS NEVER UPLOADED ONE
     *
     * The monogram, not the globe — and not, as the first cut of this did, the
     * page's own HTML document: `new URL('', location.href)` resolves to the
     * current page, so an empty logo hung crew-dashboard.html itself in the
     * head as the icon. It drew the globe anyway and said nothing about it.
     * ================================================================== */
    for (const page_ of ['crew-dashboard.html', 'crew-status.html']) {
        console.log('\n' + page_ + ' — an airline with no logo');
        const { ctx, page, errs } = await open(page_, NO_LOGO);
        const s = await read(page);
        ok('the tab still carries a mark', /^data:image\/svg\+xml,/.test(s.href), s.href.slice(0, 60));
        ok('…which is a drawing, not the page itself', !/\.html/.test(s.decoded), s.decoded.slice(0, 80));
        ok('…that a browser can actually parse', s.svgOk === true, String(s.svgOk));
        ok('…carrying the airline’s initials', /<text[^>]*>OV<\/text>/.test(s.decoded), s.decoded.slice(0, 200));
        ok('…in the airline’s own accent', /fill="#0EA5A0"/.test(s.decoded), s.decoded.slice(0, 120));
        // iOS ignores SVG for a home-screen tile, so the monogram never
        // becomes one — the page keeps the Inflight bitmap it shipped with,
        // which is a real picture rather than a square iOS would draw itself.
        ok('and the home-screen icon stays a real picture', s.apple === '/Images/inflight.png', String(s.apple));
        ok('no page errors', errs.length === 0, errs.join('|'));
        await ctx.close();
    }

    /* =====================================================================
     * 3. AN AIRLINE WE KNOW NOTHING ABOUT
     *
     * A backend that answers with nothing must leave the page as it found it
     * rather than hanging an empty square in the head — which since the pages
     * ship with Inflight's own icon means that icon, and never the globe.
     * ================================================================== */
    {
        console.log('\nA record with no airline in it');
        const { ctx, page, errs } = await open('crew-dashboard.html', {});
        const s = await read(page);
        ok('the page keeps the icon it shipped with', s.href === '/Images/inflightIcon.ico', s.href);
        ok('…and still only one of them', s.icons === 1, String(s.icons));
        ok('no page errors', errs.length === 0, errs.join('|'));
        await ctx.close();
    }

    /* =====================================================================
     * 4. BEFORE THE RECORD ARRIVES
     *
     * The logo is a fetch away, and what the tab shows for the length of that
     * fetch is what these pages used to show for ever: nothing, and therefore
     * the browser's grey globe. They ship with Inflight's mark instead.
     * ================================================================== */
    {
        console.log('\nThe tab before the airline’s record lands');
        for (const page_ of ['crew-dashboard.html', 'crew-pilot.html', 'crew-join.html',
                             'crew-status.html', 'crew.html', 'crew-website.html', 'crew-terms.html']) {
            const html = fs.readFileSync(path.join(ROOT, page_), 'utf8');
            ok(page_ + ' opens on a mark rather than the globe',
                /<link rel="icon"[^>]+href="\/Images\/inflightIcon\.ico"/.test(html));
        }
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})();
