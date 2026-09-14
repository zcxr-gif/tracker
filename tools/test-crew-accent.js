// test-crew-accent.js
// The airline's accent, measured for readability on the pages that use it.
//
// THE BUG
//
// Every crew centre page highlights things two ways — a block of the airline's
// accent with white text on it, and text in the accent itself — and neither
// ever checked whether the colour could carry it. An airline whose brand is
// cream, pale gold or white got white-on-nearly-white buttons: highlights with
// nothing readable in them. The same assumption in reverse broke the dark
// interface, where the stock accent is nearly black and every accent-coloured
// link disappeared into the page.
//
// crewAccent.js derives two properties from the accent — the ink that sits ON
// it, and a version of it readable AS text on this page — and the stylesheets
// read those instead of assuming. This file measures the result the way a
// reader meets it: computed colours off real elements on the real pages, with
// the contrast ratio worked out from them.
//
// Run:  node tools/test-crew-accent.js
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
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); return res.end('');
    }
    res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    fs.createReadStream(file).pipe(res);
});

let failures = 0;
const check = (label, ok, extra) => {
    if (ok) { console.log('  ✓ ' + label); return; }
    failures++;
    console.log(`  ✗ ${label}${extra ? '\n      ' + extra : ''}`);
};

// ---- Contrast, worked out here so the assertions are about READABILITY ------
// rather than about which hex came back. Same formula crewAccent.js uses, and
// deliberately a second implementation: a test that reuses the code under test
// to grade the code under test cannot fail.
function parse(css) {
    const s = String(css || '').trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (hex) {
        let h = hex[1];
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
/** The same colour, whichever notation it came back in. */
function same(a, b) {
    const x = parse(a), y = parse(b);
    return !!x && !!y && x.every((v, i) => Math.abs(v - y[i]) <= 1);
}
function lum(c) {
    const a = c.map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function ratio(a, b) {
    const x = parse(a), y = parse(b);
    if (!x || !y) return 0;
    const la = lum(x), lb = lum(y);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The accents that broke it. Each is a real airline's kind of colour, not a
// contrived one: a cream, a pale gold, a white, the stock near-black, and a
// mid navy that was always fine and must stay untouched.
const ACCENTS = [
    { hex: '#FFFFFF', label: 'white' },
    { hex: '#F4E3B2', label: 'pale gold' },
    { hex: '#FFD100', label: 'yellow' },
    { hex: '#1C1A16', label: 'the stock near-black' },
    { hex: '#14375E', label: 'navy' },
];

function api(route, accent) {
    const p = new URL(route.request().url()).pathname;
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('/api/va-ads/by-slug/')) {
        return json({ name: 'Test VA', code: 'TST', slug: 'testva', accent, ranks: [], roles: [], fleet: [], join: {} });
    }
    if (p.endsWith('/me')) {
        return json({ role: 'owner', caps: [], capabilities: [], rolePresets: [], staffRoles: [], staffAssignments: [] });
    }
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: true });
    if (p.endsWith('/stats')) return json({ ok: true, connected: true, stats: { pilots: 12, hours: 400 } });
    return json({});
}

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });

    const open = async (page_, { accent, scheme, signedIn = true }) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, colorScheme: scheme });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/**', (r) => api(r, accent));
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({
            contentType: 'text/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});`,
        }));
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        if (signedIn) {
            await page.addInitScript(() => {
                localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' }));
            });
        }
        await page.goto(`http://127.0.0.1:${port}/${page_}?va=testva`);
        await page.waitForTimeout(1500);
        return { page, errors };
    };

    /* What a reader actually sees on a filled highlight and on accent text.
       Measured off real elements rather than off the custom properties: a
       property nothing reads is a property that fixes nothing. */
    const measure = (page) => page.evaluate(() => {
        const out = { filled: null, text: null, bg: getComputedStyle(document.documentElement).backgroundColor };
        const body = getComputedStyle(document.body).backgroundColor;
        const fill = document.querySelector('.accent-bg');
        if (fill) {
            const s = getComputedStyle(fill);
            out.filled = { bg: s.backgroundColor, ink: s.color, tag: fill.tagName };
        }
        const txt = document.querySelector('.accent-text');
        if (txt) out.text = { color: getComputedStyle(txt).color };
        out.page = body;
        out.props = {
            accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
            ink: getComputedStyle(document.documentElement).getPropertyValue('--accent-ink').trim(),
            on: getComputedStyle(document.documentElement).getPropertyValue('--accent-on').trim(),
        };
        return out;
    });

    for (const scheme of ['light', 'dark']) {
        for (const a of ACCENTS) {
            console.log(`\ncrew-dashboard.html · ${a.label} (${a.hex}) · ${scheme}`);
            const { page, errors } = await open('crew-dashboard.html', { accent: a.hex, scheme });
            const m = await measure(page);

            /* The accent is painted as chosen — unless it is so close to the
               page's own background that the button would not be a shape at
               all, which is the one case the fill is allowed to move. Both
               outcomes are asserted rather than one excused: the colour is
               either the airline's, or it is visibly a button. */
            const visible = m.filled ? ratio(m.filled.bg, m.page) : 0;
            const untouched = !!m.filled && same(m.filled.bg, a.hex);
            const wouldVanish = ratio(a.hex, m.page) < 1.6;
            check('the airline gets its own colour on a filled highlight',
                untouched || wouldVanish,
                m.filled ? 'painted ' + m.filled.bg + ', chose ' + a.hex : 'no .accent-bg on the page');
            check('and the highlight is a visible shape on the page', visible >= 1.55,
                m.filled ? `${m.filled.bg} on ${m.page} — ${visible.toFixed(2)}:1` : '');

            const inkRatio = m.filled ? ratio(m.filled.ink, m.filled.bg) : 0;
            check('and its text can be read on it', inkRatio >= 4.5,
                m.filled ? `ink ${m.filled.ink} on ${m.filled.bg} — ${inkRatio.toFixed(2)}:1` : '');

            const textRatio = m.text ? ratio(m.text.color, m.page) : 0;
            check('accent text can be read on the page', textRatio >= 3.4,
                m.text ? `${m.text.color} on ${m.page} — ${textRatio.toFixed(2)}:1` : 'no .accent-text on the page');

            check('nothing threw', errors.length === 0, errors[0]);
            await page.close();
        }
    }

    /* THE COLOUR PICKER. The fix has to hold for a colour chosen a second ago,
       not only for one that arrived with the VA record — the picker writes
       --accent straight onto the document and nothing tells crewAccent.js. */
    console.log('\nPicking a colour in Settings → Appearance');
    {
        const { page } = await open('crew-dashboard.html', { accent: '#14375E', scheme: 'light' });
        await page.evaluate(() => window.applyAccent && window.applyAccent('#FFF8D6'));
        await page.waitForTimeout(300);
        const m = await measure(page);
        const r = m.filled ? ratio(m.filled.ink, m.filled.bg) : 0;
        check('a cream chosen live is legible without a reload', r >= 4.5,
            m.filled ? `ink ${m.filled.ink} on ${m.filled.bg} — ${r.toFixed(2)}:1` : '');
        await page.close();
    }

    /* THE OTHER TWO PAGES THE READER MEETS. The sign-in page is the first
       thing a pilot sees of an airline, and the pilot dashboard is the page
       they live on — both style their highlights the same way. */
    for (const p of ['crew.html', 'crew-pilot.html']) {
        console.log(`\n${p} · pale gold · light`);
        const { page, errors } = await open(p, { accent: '#F4E3B2', scheme: 'light', signedIn: p !== 'crew.html' });
        const m = await measure(page);
        if (m.filled) {
            const r = ratio(m.filled.ink, m.filled.bg);
            check('the filled highlight is readable', r >= 4.5, `${m.filled.ink} on ${m.filled.bg} — ${r.toFixed(2)}:1`);
        } else {
            check('the filled highlight is readable', true, 'no .accent-bg on this page in this state');
        }
        if (m.text) {
            const r = ratio(m.text.color, m.page);
            check('accent text is readable', r >= 3.4, `${m.text.color} on ${m.page} — ${r.toFixed(2)}:1`);
        }
        check('nothing threw', errors.length === 0, errors[0]);
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
