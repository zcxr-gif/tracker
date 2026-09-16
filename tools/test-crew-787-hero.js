// test-crew-787-hero.js
// The 787 behind the crew center's sign-in card (crew787Hero.js).
//
// WHAT THIS IS GUARDING. The hero is a decoration on the one page in the
// product that has to work: if it cannot sign a pilot in, nothing else in the
// crew center matters. So the assertions are mostly about what it must NOT do —
// throw, block, take the click, or turn up on a phone where the card leaves it
// nowhere to be.
//
//   * it renders on a desktop width, into #backdrop, under the card
//   * it takes no pointer events
//   * ?hero= picks the variant, and an unknown value falls back rather than 404s
//   * ?hero=off leaves the page exactly as it was
//   * under 900px it does not render — and does not download three.js either
//   * no page errors on any of the above
//
// Run:  node tools/test-crew-787-hero.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const TAILWIND = fs.readFileSync(path.join(__dirname, 'crew-tailwind.css'), 'utf8');
const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.glb': 'model/gltf-binary', '.png': 'image/png', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? '/index.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

let failures = 0;
const check = (name, ok, extra) => {
    if (ok) console.log('  ✓ ' + name);
    else { failures++; console.log(`  ✗ ${name}${extra === undefined ? '' : ' — ' + JSON.stringify(extra).slice(0, 220)}`); }
};

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    // SwiftShader, because a headless runner has no GPU and the whole point of
    // this file is to exercise the path that DOES render.
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
        args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });

    const open = async (query = '', vp = { width: 1280, height: 860 }) => {
        const page = await browser.newPage({ viewport: vp });
        const errors = [];
        const asked = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('request', (r) => asked.push(r.url()));
        await page.route('**/api/va-ads/by-slug/**', (r) => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ name: 'Meridian Virtual', code: 'MER', accent: '#14375e', loginBackdrop: 'grid' }),
        }));
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({
            contentType: 'text/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});`,
        }));
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.goto(`http://127.0.0.1:${port}/crew.html?va=testva${query}`);
        // The model is fetched and decoded before anything is added to the DOM.
        await page.waitForTimeout(2500);
        return { page, errors, asked };
    };

    const state = (page) => page.evaluate(() => {
        const host = document.querySelector('#backdrop .bd-787');
        const canvas = host && host.querySelector('canvas');
        return {
            hasHost: !!host,
            painted: !!canvas && canvas.width > 0 && canvas.height > 0,
            inBackdrop: !!host && host.parentElement.id === 'backdrop',
            pointer: host ? getComputedStyle(host).pointerEvents : null,
            hidden: host ? getComputedStyle(host).display === 'none' : null,
            variant: window.Crew787Hero ? window.Crew787Hero.variant : null,
            file: window.Crew787Hero ? window.Crew787Hero.file : null,
        };
    });

    /* ---- 1. THE DEFAULT ------------------------------------------------- */
    console.log('\nOn a desktop width');
    {
        const { page, errors } = await open();
        const s = await state(page);
        check('an aircraft is rendered into the backdrop', s.hasHost && s.painted && s.inBackdrop, s);
        check('it is the 787-9 by default', s.variant === 'Boeing 787-9', s);

        /* THE ONE THAT MATTERS. The layer covers the viewport; if it ate clicks
           the sign-in form would be unreachable and the page would be broken in
           a way no screenshot shows. */
        check('it takes no pointer events', s.pointer === 'none', s);

        /* And it must stay UNDER the card rather than over it. */
        const under = await page.evaluate(() => {
            const card = document.querySelector('.look-center .surface');
            if (!card) return null;
            const r = card.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !!(top && top.closest('.look-center'));
        });
        check('the sign-in card is on top of it', under === true, { under });

        check('no page errors', errors.length === 0, errors);
        await page.close();
    }

    /* ---- 2. PICKING ONE -------------------------------------------------- */
    console.log('\n?hero=');
    for (const [q, want] of [['787-8', 'Boeing 787-8'], ['787-10', 'Boeing 787-10'], ['nonsense', 'Boeing 787-9']]) {
        const { page, errors } = await open(`&hero=${q}`);
        const s = await state(page);
        check(`${q} → ${want}`, s.variant === want && s.painted, s);
        /* A variant that resolved to a file that is not there would paint
           nothing and say nothing; the 404 is the symptom to catch. */
        check(`${q} loads a model that exists`, errors.length === 0, errors);
        await page.close();
    }

    /* ---- 3. OFF ---------------------------------------------------------- */
    console.log('\n?hero=off');
    {
        const { page, errors, asked } = await open('&hero=off');
        const s = await state(page);
        check('nothing is added to the backdrop', !s.hasHost && s.variant === null, s);
        check('three.js is never fetched', !asked.some(u => u.includes('/vendor/three/')), asked.filter(u => u.includes('three')));
        check('no page errors', errors.length === 0, errors);
        await page.close();
    }

    /* ---- 4. PHONES ------------------------------------------------------- */
    console.log('\nUnder 900px');
    {
        const { page, errors, asked } = await open('', { width: 390, height: 800 });
        const s = await state(page);
        check('no aircraft, because the card takes the width', !s.hasHost, s);

        /* The saving that makes the width check worth having: a phone should
           not pay 660 KB and a WebGL context for something it cannot see. */
        check('three.js is never fetched', !asked.some(u => u.includes('/vendor/three/')), asked.filter(u => u.includes('three')));
        check('no model is fetched either', !asked.some(u => u.includes('.glb')), asked.filter(u => u.includes('.glb')));
        check('no page errors', errors.length === 0, errors);
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
})();
