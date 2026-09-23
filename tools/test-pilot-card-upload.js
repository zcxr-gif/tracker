/*
 * tools/test-pilot-card-upload.js — `node tools/test-pilot-card-upload.js`
 *
 * PICTURE AND BANNER UPLOADS FROM THE WEBSITE, ON A DESKTOP AND ON A PHONE.
 *
 * The Settings card (pilotCardEditor.js) is mounted by both dashboards — the
 * desktop one as a pui-card, the mobile one as an iOS-style section — and
 * both post to the profile-image function. What this pins down:
 *
 *   * picking a picture sends a real JPEG, scaled to the app's sizes, with the
 *     apikey and bearer token, and the card says it worked
 *   * a Pro account can do the same for a banner
 *   * both go through the move-and-scale frame first: dragging moves the
 *     picture, the upload is the framed square / 3:1 strip, cancel sends nothing
 *   * a phone without createImageBitmap (older iOS Safari) still uploads
 *   * a request the browser refuses to send (a failed CORS preflight, a
 *     dropped connection) is reported as that, not as a vague failure
 *
 * No framework and no network: exits non-zero on a failure.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const FN = '**/functions/v1/profile-image';

const HARNESS = `<!doctype html><html><body><div id="host"></div>
<script type="module">
import { PilotCardEditor } from '/pilotCardEditor.js';
const row = { user_id: 'u1', handle: 'tester', display_name: 'Test Pilot', if_username: 'Tester', banner_preset: 'dusk', avatar_path: null, banner_path: null };
const q = { select() { return q; }, eq() { return q; }, limit() { return q; }, maybeSingle: async () => ({ data: row, error: null }) };
const supabase = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok', user: { id: 'u1' } } } }) },
    from: () => q,
};
const params = new URLSearchParams(location.search);
if (params.get('nobitmap')) delete window.createImageBitmap;
PilotCardEditor.mount(document.getElementById('host'), {
    supabase, isPro: true, user: { id: 'u1' }, variant: params.get('variant') || 'desktop',
});
</script></body></html>`;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/harness.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(HARNESS);
    }
    const file = path.join(ROOT, path.normalize(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log('  ✗ ' + n + (x ? '  (' + x + ')' : '')); fail++; } };

function jpegSize(b64) {
    const b = Buffer.from(b64, 'base64');
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
            return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        }
        i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
}

const DEVICES = {
    desktop: { viewport: { width: 1280, height: 900 } },
    mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
};

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    // A 1200x900 PNG, bigger than the avatar cap so the scale-down shows.
    const shot = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await shot.setContent('<body style="margin:0;background:linear-gradient(#2b336b,#eb8c5c)"></body>');
    const PNG = await shot.screenshot();
    await shot.close();

    const cases = [
        ['desktop', 'desktop', ''],
        ['mobile', 'mobile', ''],
        ['mobile, no createImageBitmap', 'mobile', '&nobitmap=1'],
    ];
    for (const [label, device, extra] of cases) {
        console.log(`\n ${label}`);
        const ctx = await browser.newContext(DEVICES[device]);
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        const sent = [];
        await page.route(FN, route => {
            const req = route.request();
            sent.push({ headers: req.headers(), body: req.postDataJSON() });
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: 'u1/x.jpg' }) });
        });
        await page.goto(`http://127.0.0.1:${port}/harness.html?variant=${device}${extra}`);
        await page.waitForSelector('input[data-upload="avatar"]', { state: 'attached', timeout: 5000 });
        ok(`the ${device} card is drawn`, !!(await page.$(device === 'mobile' ? '.pce-mobile' : '.pui-card.pce')));

        // Cancelling the move-and-scale frame uploads nothing.
        sent.length = 0;
        await page.setInputFiles('input[data-upload="avatar"]', { name: 'photo.png', mimeType: 'image/png', buffer: PNG });
        await page.waitForSelector('.iadj-stage', { timeout: 5000 });
        await page.click('.iadj [data-act="cancel"]');
        await page.waitForTimeout(200);
        ok('cancelling the frame closes it and sends nothing', !(await page.$('.iadj-overlay')) && sent.length === 0, sent.length);

        for (const kind of ['avatar', 'banner']) {
            sent.length = 0;
            await page.setInputFiles(`input[data-upload="${kind}"]`, { name: 'photo.png', mimeType: 'image/png', buffer: PNG });
            await page.waitForSelector('.iadj-stage', { timeout: 5000 });
            // Zoom in with the slider, then drag the picture about.
            await page.$eval('.iadj-zoom', el => { el.value = '2'; el.dispatchEvent(new Event('input')); });
            const box = await page.locator('.iadj-stage').boundingBox();
            if (device === 'mobile') {
                // A touch drag, through pointer events as a phone sends them.
                await page.dispatchEvent('.iadj-stage', 'pointerdown', { pointerId: 7, pointerType: 'touch', clientX: box.x + 60, clientY: box.y + 40 });
                await page.dispatchEvent('.iadj-stage', 'pointermove', { pointerId: 7, pointerType: 'touch', clientX: box.x + 20, clientY: box.y + 10 });
                await page.dispatchEvent('.iadj-stage', 'pointerup', { pointerId: 7, pointerType: 'touch', clientX: box.x + 20, clientY: box.y + 10 });
            } else {
                await page.mouse.move(box.x + 60, box.y + 40);
                await page.mouse.down();
                await page.mouse.move(box.x + 20, box.y + 10, { steps: 4 });
                await page.mouse.up();
            }
            const moved = await page.$eval('.iadj-img', el => el.style.transform);
            ok(`${kind}: dragging moves the picture in the frame`, /translate\(-/.test(moved), moved);
            await page.click('.iadj [data-act="save"]');
            await page.waitForFunction(() => /updated/.test(document.querySelector('#pce-msg')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
            const msg = await page.textContent('#pce-msg');
            ok(`${kind}: the card says it was saved`, /updated/i.test(msg), msg);
            const req = sent[0];
            ok(`${kind}: one request to profile-image`, sent.length === 1, sent.length);
            if (!req) continue;
            ok(`${kind}: it carries the apikey and the bearer token`,
                !!req.headers.apikey && req.headers.authorization === 'Bearer tok');
            const size = jpegSize(req.body.data || '');
            const longest = kind === 'avatar' ? 720 : 1800;
            ok(`${kind}: the payload is a JPEG no bigger than ${longest}px`,
                req.body.kind === kind && req.body.contentType === 'image/jpeg' && size && Math.max(size.w, size.h) <= longest,
                JSON.stringify(size));
            const aspect = kind === 'avatar' ? 1 : 3;
            ok(`${kind}: the upload is the framed ${aspect}:1 crop`,
                size && Math.abs(size.w / size.h - aspect) < 0.02, JSON.stringify(size));
        }

        // What a refused CORS preflight looks like from inside the page.
        await page.unroute(FN);
        await page.route(FN, route => route.abort('failed'));
        await page.setInputFiles('input[data-upload="avatar"]', { name: 'photo.png', mimeType: 'image/png', buffer: PNG });
        await page.waitForSelector('.iadj-stage', { timeout: 5000 });
        await page.click('.iadj [data-act="save"]');
        await page.waitForFunction(() => document.querySelector('#pce-msg')?.classList.contains('is-error'), null, { timeout: 5000 }).catch(() => {});
        ok('a request that never leaves the browser is reported as a connection problem',
            /couldn.t reach/i.test(await page.textContent('#pce-msg')));
        ok('no page errors', errors.length === 0, errors.join(' | '));
        await ctx.close();
    }

    await browser.close();
    server.close();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
