// test-crew-login-look.js
// The sign-in page's backdrops, and the banner.
//
// THE BUG THIS EXISTS FOR could not be seen in the markup: the banner was set
// as an <img class="w-full h-full object-cover"> inside a full-viewport box,
// which is correct CSS and the wrong picture. A VA banner is three to one; a
// phone is one to two; covering one with the other scales it about six times
// and shows a slice of sky. So the assertion that matters is a MEASUREMENT —
// how much the browser actually had to scale the image to fill its box.
//
//   * the banner is never covered into a box taller than it is wide
//   * every backdrop paints something, and the drawn ones need no picture
//   * a VA with no banner gets no empty band, and their logo is not clipped
//   * an unknown or stale stored backdrop falls back rather than painting void
//
// Run:  node tools/test-crew-login-look.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
// A stand-in banner at a REAL banner's shape. 3:1 is the shape the bug was
// about; a square test image would have hidden it completely.
const BANNER_W = 1500, BANNER_H = 500;
const BANNER = `<svg xmlns="http://www.w3.org/2000/svg" width="${BANNER_W}" height="${BANNER_H}">
  <rect width="${BANNER_W}" height="${BANNER_H}" fill="#12406e"/>
  <circle cx="1180" cy="130" r="46" fill="#fff"/></svg>`;

const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/banner.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(BANNER); }
    const f = path.join(ROOT, p === '/' ? '/crew.html' : p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
});
const TAILWIND = fs.readFileSync(path.join(__dirname, 'crew-tailwind.css'), 'utf8');

const BACKDROPS = ['auto', 'banner', 'aurora', 'grid', 'horizon', 'paper'];

let failures = 0;
const check = (name, ok, extra) => {
    if (ok) console.log('  ✓ ' + name);
    else { failures++; console.log(`  ✗ ${name}${extra === undefined ? '' : ' — ' + JSON.stringify(extra).slice(0, 220)}`); }
};

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    const open = async ({ look = 'center', bg = 'auto', banner = true, vp } = {}) => {
        const page = await browser.newPage({ viewport: vp || { width: 1200, height: 860 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/va-ads/by-slug/**', (r) => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                name: 'Meridian Virtual', code: 'MER', accent: '#14375e',
                loginLook: look, loginBackdrop: bg, discordLogin: true,
                banner: banner ? `http://127.0.0.1:${port}/banner.svg` : '',
            }),
        }));
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({
            contentType: 'text/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});`,
        }));
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.goto(`http://127.0.0.1:${port}/crew.html?va=testva`);
        await page.waitForTimeout(900);
        return { page, errors };
    };

    /* ---- 1. THE BANNER, WHERE IT IS LOOKED AT ---------------------------- */
    console.log('\nThe banner');
    for (const vp of [{ width: 390, height: 800 }, { width: 1200, height: 860 }]) {
        const { page, errors } = await open({ bg: 'banner', vp });

        const band = await page.evaluate(() => {
            const el = [...document.querySelectorAll('.bannerBand')].find(e => e.offsetParent !== null);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const img = el.querySelector('img');
            return { w: r.width, h: r.height, natW: img.naturalWidth, natH: img.naturalHeight };
        });
        check(`@${vp.width} the banner is shown in a band`, !!band && band.w > 0 && band.h > 0, band);

        /* THE RULE: never cover a banner into a box taller than it is wide.
           The old full-viewport backdrop broke it on every phone. */
        check(`@${vp.width} the band is wider than it is tall`, band.w > band.h, band);

        /* AND THE SCALE. object-cover scales by whichever axis needs more, so
           the zoom is max(boxW/imgW, boxH/imgH) against the source. A band at
           16:6 over a 3:1 source is a crop of about a tenth and no meaningful
           zoom; the old treatment was six times on a phone. */
        const zoom = Math.max(band.w / band.natW, band.h / band.natH) / Math.min(band.w / band.natW, band.h / band.natH);
        check(`@${vp.width} the picture is barely cropped to fit`, zoom < 1.35, { zoom: Math.round(zoom * 100) / 100 });
        check(`@${vp.width} no page errors`, errors.length === 0, errors[0]);
        await page.close();
    }

    /* ---- 2. A VA WITH NO BANNER ------------------------------------------ */
    console.log('\nAn airline with no banner');
    {
        const { page, errors } = await open({ bg: 'auto', banner: false });
        check('no empty band is drawn',
            (await page.evaluate(() => [...document.querySelectorAll('.bannerBand')].every(e => e.offsetParent === null))) === true);
        check('…and the backdrop falls back to a drawn one',
            (await page.evaluate(() => document.body.getAttribute('data-bg'))) === 'aurora');

        /* THE SELECTOR BUG. `display:none` does not remove an element, so
           `.bannerBand + .cardHead` went on matching and pulled the card's head
           up under its own clipped top edge — cutting the logo in half for
           every VA who had never uploaded a banner. */
        const clipped = await page.evaluate(() => {
            const card = document.querySelector('.look-center .surface');
            const mark = document.querySelector('.look-center .brand-mono-box');
            if (!card || !mark) return null;
            return { cardTop: card.getBoundingClientRect().top, markTop: mark.getBoundingClientRect().top };
        });
        check('…and the logo is inside the card, not clipped by its top edge',
            clipped && clipped.markTop >= clipped.cardTop, clipped);
        check('no page errors', errors.length === 0, errors[0]);
        await page.close();
    }
    {
        // Asking for the banner backdrop without a banner must not paint a void.
        const { page } = await open({ bg: 'banner', banner: false });
        check('asking for the banner without one falls back rather than going black',
            (await page.evaluate(() => document.body.getAttribute('data-bg'))) === 'aurora');
        await page.close();
    }

    /* ---- 3. EVERY BACKDROP PAINTS SOMETHING ------------------------------ */
    console.log('\nThe backdrops');
    for (const bg of BACKDROPS) {
        const { page, errors } = await open({ bg, banner: bg !== 'aurora' });
        const got = await page.evaluate(() => {
            const art = document.querySelector('.bd-art');
            const ban = document.querySelector('.bd-banner');
            const vis = (el) => el && getComputedStyle(el).display !== 'none';
            return {
                bg: document.body.getAttribute('data-bg'),
                art: vis(art) ? getComputedStyle(art).backgroundImage : '',
                banner: vis(ban),
            };
        });
        check(`${bg} resolves to a known backdrop`, BACKDROPS.includes(got.bg) && got.bg !== 'auto', got);
        check(`…and paints one`, (got.art && got.art !== 'none') || got.banner, got);
        check(`…with no page errors`, errors.length === 0, errors[0]);
        await page.close();
    }
    {
        // A value saved before a backdrop was renamed, or typed into the query.
        const { page } = await open({ bg: 'nonsense' });
        check('an unknown stored backdrop falls back to automatic',
            ['banner', 'aurora'].includes(await page.evaluate(() => document.body.getAttribute('data-bg'))));
        await page.close();
    }

    /* ---- 4. BOTH LOOKS, EVERY BACKDROP ----------------------------------- */
    console.log('\nBoth looks');
    for (const look of ['center', 'split']) {
        const { page, errors } = await open({ look, bg: 'grid' });
        check(`${look} shows its own layout`,
            (await page.evaluate((l) => {
                const el = document.querySelector('.look-' + l);
                return el && getComputedStyle(el).display !== 'none';
            }, look)) === true);
        /* The split look's two panels cover the window, so the backdrop is only
           ever seen if the brand panel lets it through. A panel painted opaque
           would make the whole choice meaningless on half the looks. */
        if (look === 'split') {
            check('…and its brand panel lets the backdrop through',
                (await page.evaluate(() => {
                    const el = document.querySelector('.splitPanel');
                    const bgc = getComputedStyle(el).backgroundColor;
                    return bgc === 'rgba(0, 0, 0, 0)' || bgc === 'transparent';
                })) === true);
        }
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(`${look} does not scroll sideways`, wide <= 1, wide);
        check(`${look} has no page errors`, errors.length === 0, errors[0]);
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed\n` : '\nAll checks passed\n');
    process.exit(failures ? 1 : 0);
})();
