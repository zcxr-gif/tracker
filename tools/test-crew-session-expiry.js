// test-crew-session-expiry.js
// An expired crew sign-in goes back to the sign-in page — it does not draw the
// crew center from the stored name and leave every button dead — and the
// sign-in page offers "Stay signed in" and sends the choice to the backend.
//
// Run:  node tools/test-crew-session-expiry.js
// Needs: playwright-core and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
//        pre-installed /opt/pw-browsers/chromium).
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TAILWIND = fs.readFileSync(path.join(__dirname, 'crew-tailwind.css'), 'utf8');

const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    // /crew/<slug> is a 200 rewrite to the sign-in page in production.
    const f = /^\/crew\/[^/]+$/.test(p) ? path.join(ROOT, 'crew.html') : path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    fs.createReadStream(f).pipe(res);
});

let failures = 0;
const check = (label, ok, extra) => {
    if (ok) { console.log('  ✓ ' + label); return; }
    failures++;
    console.log(`  ✗ ${label}${extra ? '\n      ' + extra : ''}`);
};

// A token whose payload says when it runs out. The signature is never checked
// on this side; only `exp` is read.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (expSecs) => `${b64({ alg: 'HS256' })}.${b64({ sub: 'p1', exp: expSecs })}.sig`;
const now = () => Math.floor(Date.now() / 1000);

let meStatus = 200;
let loginBody = null;
function api(route) {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('/api/va-ads/by-slug/')) {
        return json({ name: 'Meridian Virtual', code: 'MRD', slug: 'testva', accent: '#14375E', ranks: [], roles: [], fleet: [], join: {} });
    }
    if (p.endsWith('/login')) {
        loginBody = JSON.parse(req.postData() || '{}');
        return json({ token: jwt(now() + 3600), view: 'pilot', role: 'pilot', name: 'Rae Okafor', username: 'rae',
            remember: loginBody.remember !== false, expiresAt: (now() + 3600) * 1000 });
    }
    if (p.endsWith('/me')) {
        if (meStatus !== 200) return json({ error: 'Invalid session.' }, meStatus);
        return json({ role: 'pilot', view: 'pilot', caps: [], capabilities: [], rolePresets: [], discord: { available: false } });
    }
    if (p.endsWith('/me/flying')) {
        if (meStatus !== 200) return json({ error: 'Invalid session.' }, meStatus);
        return json({ hours: 0, flights: 0, logbook: [] });
    }
    return json({});
}

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });

    const newPage = async (session) => {
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        const errors = [];
        page.on('pageerror', (e) => { if (!/tailwind is not defined/.test(String(e))) errors.push(String(e)); });
        await page.route('**/api/**', api);
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({
            contentType: 'text/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});`,
        }));
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.goto(base + '/crew-terms.html');   // any page on this origin, to seed storage
        await page.evaluate((s) => { localStorage.clear(); if (s) localStorage.setItem('crew:session:testva', JSON.stringify(s)); }, session);
        return { page, errors };
    };
    const session = (exp) => ({ token: jwt(exp), name: 'Rae Okafor', role: 'pilot', view: 'pilot', at: Date.now() });

    for (const file of ['crew-pilot.html', 'crew-dashboard.html']) {
        console.log(`\n${file} — expired token`);
        meStatus = 200;
        const { page } = await newPage(session(now() - 60));
        await page.goto(`${base}/${file}?va=testva`);
        await page.waitForURL(/\/crew\/testva/, { timeout: 5000 }).catch(() => {});
        check('lands on the sign-in page', /\/crew\/testva/.test(page.url()), page.url());
        check('the stored session is gone', await page.evaluate(() => localStorage.getItem('crew:session:testva')) === null);
        await page.waitForSelector('.authNote:not(.hidden)', { timeout: 5000 }).catch(() => {});
        const note = await page.evaluate(() => [...document.querySelectorAll('.authNote')].map(n => n.textContent).join(' '));
        check('says the session expired', /expired/i.test(note), note);
        check('the expired flag is cleaned out of the address', !/expired=1/.test(page.url()), page.url());
        await page.close();
    }

    console.log('\ncrew-pilot.html — token in date but revoked on the server');
    meStatus = 401;
    {
        const { page } = await newPage(session(now() + 3600));
        await page.goto(`${base}/crew-pilot.html?va=testva`);
        await page.waitForURL(/\/crew\/testva/, { timeout: 5000 }).catch(() => {});
        check('lands on the sign-in page', /\/crew\/testva/.test(page.url()), page.url());
        await page.close();
    }

    console.log('\ncrew-pilot.html — a good session stays put');
    meStatus = 200;
    {
        const { page, errors } = await newPage(session(now() + 3600));
        await page.goto(`${base}/crew-pilot.html?va=testva`);
        await page.waitForTimeout(1500);
        check('still on the pilot home', /crew-pilot\.html/.test(page.url()), page.url());
        check('no page errors', errors.length === 0, errors.join(' | '));
        await page.close();
    }

    console.log('\ncrew.html — Stay signed in');
    {
        const { page, errors } = await newPage(null);
        await page.goto(`${base}/crew/testva`);
        await page.waitForSelector('body.ready');
        const boxes = await page.$$eval('.rememberBox', bs => bs.map(b => b.checked));
        check('both looks have the box, off by default', boxes.length === 2 && boxes.every(b => !b), JSON.stringify(boxes));
        const form = page.locator('.authForm:visible').first();
        await form.locator('input[name=remember]').check();
        check('the choice is remembered on this device', await page.evaluate(() => localStorage.getItem('crew:remember')) === '1');
        await form.locator('input[name=username]').fill('rae');
        await form.locator('input[name=password]').fill('pw');
        await form.locator('button[type=submit]').click();
        await page.waitForURL(/crew-pilot\.html/, { timeout: 5000 }).catch(() => {});
        check('sends remember:true with the login', loginBody && loginBody.remember === true, JSON.stringify(loginBody));
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('crew:session:testva') || 'null'));
        check('stores when the session runs out', stored && typeof stored.expiresAt === 'number', JSON.stringify(stored));
        check('no page errors', errors.length === 0, errors.join(' | '));
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} failing` : '\nall passing');
    process.exit(failures ? 1 : 0);
})();
