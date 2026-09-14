// test-crew-arrival.js
// Arriving at the crew centre: the confirmation over the first paint, and the
// picture on the avatar button.
//
// Both are things a reader meets in the first two seconds of a session and
// neither can be checked by reading the source: the splash is a sequence of
// transitions on a cover that removes itself, and the avatar is an <img> that
// has to fall back to initials when the URL it was given has gone stale.
//
// Run:  node tools/test-crew-arrival.js
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
    // An empty document on this origin, for setting the arrival flag the way
    // the sign-in page does: on the page BEFORE, then navigate.
    if (p === '/__blank') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<!doctype html><title>blank</title>');
    }
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

// A 1×1 PNG, as an avatar that loads.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

let state = null;
const fresh = (over) => Object.assign({ role: 'owner', avatar: '', logo: '' }, over || {});

function api(route) {
    const p = new URL(route.request().url()).pathname;
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('/api/va-ads/by-slug/')) {
        return json({
            name: 'Meridian Virtual', code: 'MRD', slug: 'testva', accent: '#14375E',
            logo: state.logo || '', ranks: [], roles: [], fleet: [], join: {},
        });
    }
    if (p.endsWith('/me')) {
        return json({
            role: state.role, caps: [], capabilities: [], rolePresets: [], staffRoles: [], staffAssignments: [],
            discord: { available: true, linked: !!state.avatar, name: 'ravi', avatar: state.avatar },
        });
    }
    if (p.endsWith('/me/flying')) return json({ hours: 214, flights: 96, rank: { name: 'First Officer' }, logbook: [] });
    if (p.endsWith('/stats')) return json({ ok: true, connected: true, stats: { pilots: 12, hours: 400 } });
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: true });
    return json({});
}

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });

    const open = async (which, { arriving = true, scheme = 'light', avatarStatus = 200 } = {}) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, colorScheme: scheme });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.route('**/api/**', api);
        await page.route('https://cdn.discordapp.com/**', (r) => (avatarStatus === 200
            ? r.fulfill({ status: 200, contentType: 'image/png', body: PNG })
            : r.fulfill({ status: avatarStatus, contentType: 'text/plain', body: 'gone' })));
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({
            contentType: 'text/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});`,
        }));
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.route('**/cdn.example.test/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
        await page.addInitScript((role) => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Ravi Bhatia', role }));
        }, state.role);
        /* The arrival flag is set the way crew.html sets it — on the page
           BEFORE, then navigate — rather than from an init script. An init
           script runs in every frame, and the dashboard's live-map iframe is
           about:blank, which shares this origin's sessionStorage: the flag
           would be written back a moment after the page had spent it, and the
           test would be measuring itself. */
        // An empty document on the same origin, so nothing but the flag is
        // carried into the page under test.
        await page.goto(`http://127.0.0.1:${port}/__blank`);
        if (arriving) await page.evaluate(() => sessionStorage.setItem('crew:welcome:testva', '1'));
        await page.goto(`http://127.0.0.1:${port}/${which}?va=testva`);
        return { page, errors };
    };

    /* ==================================================================
     * 1. ARRIVING FROM THE SIGN-IN PAGE
     * ================================================================ */
    console.log('\nArriving at the staff dashboard, straight from signing in');
    state = fresh({ logo: 'https://cdn.example.test/logo.png' });
    {
        const { page, errors } = await open('crew-dashboard.html');

        // The cover has to be there BEFORE the page is worth looking at —
        // that is the whole job. Caught early rather than after the boot.
        await page.waitForSelector('.csplash', { timeout: 4000 }).catch(() => {});
        const up = await page.evaluate(() => {
            const el = document.querySelector('.csplash');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {
                covers: Math.round(r.width) >= window.innerWidth && Math.round(r.height) >= window.innerHeight,
                turning: !!document.querySelector('.csplash__arc'),
                done: el.classList.contains('is-done'),
                label: el.getAttribute('aria-label') || '',
            };
        });
        check('the cover is up', !!up, 'nothing covering the page');
        check('and covers the page', !!up && up.covers);
        check('with a ring turning on it', !!up && up.turning);
        check('not yet claiming to be finished', !!up && !up.done);
        check('and it says what it is doing', !!up && /signing you in/i.test(up.label), up ? up.label : '');

        // …then the tick, and the airline under it. Caught while it is still
        // up: the point of the mark is that it is SEEN, so a check that would
        // also pass on a cover that had already gone is not a check.
        await page.waitForSelector('.csplash.is-done', { timeout: 8000 }).catch(() => {});
        // The class lands the instant the sequence STARTS; the ring closing,
        // the tick drawing and the mark rising are transitions after it. Give
        // them their run before measuring, or this samples a tick halfway
        // through being drawn and calls it undrawn.
        await page.waitForTimeout(760);
        const shown = await page.evaluate(() => {
            const el = document.querySelector('.csplash.is-done');
            if (!el) return { gone: true };
            const tick = el.querySelector('.csplash__tick path');
            const logo = el.querySelector('.csplash__logo');
            return {
                gone: false,
                // 0 means the whole path is drawn — the tick is complete.
                tickOffset: parseFloat(getComputedStyle(tick).strokeDashoffset),
                logo: !!logo,
                logoSrc: logo ? logo.getAttribute('src') : '',
                mono: !!el.querySelector('.csplash__mono'),
                arc: getComputedStyle(el.querySelector('.csplash__arc')).animationName,
            };
        });
        check('the ring stops turning and closes', !shown.gone && shown.arc === 'none',
            JSON.stringify(shown));
        check('the tick is drawn', !shown.gone && shown.tickOffset < 1,
            'stroke-dashoffset ' + shown.tickOffset);
        check('and the airline\u2019s own logo is under it',
            !shown.gone && shown.logo && /cdn\.example\.test/.test(shown.logoSrc),
            JSON.stringify(shown));

        // And it goes. This is the assertion that matters most: a splash that
        // stays is worse than no splash.
        await page.waitForFunction(() => !document.querySelector('.csplash'), null, { timeout: 8000 })
            .then(() => check('and then it lifts', true))
            .catch(() => check('and then it lifts', false, 'the cover was still there after 8s'));

        check('nothing threw', errors.length === 0, errors[0]);
        await page.close();
    }

    /* An airline that has uploaded no logo is not shown an empty space where
       one would be: its monogram and its name stand in. */
    console.log('\nAn airline with no logo uploaded');
    state = fresh({ logo: '' });
    {
        const { page } = await open('crew-dashboard.html');
        await page.waitForSelector('.csplash.is-done', { timeout: 8000 }).catch(() => {});
        const mark = await page.evaluate(() => {
            const el = document.querySelector('.csplash.is-done');
            if (!el) return null;
            return {
                mono: (el.querySelector('.csplash__mono') || {}).textContent || '',
                name: (el.querySelector('.csplash__name') || {}).textContent || '',
                logo: !!el.querySelector('.csplash__logo'),
            };
        });
        check('its initials stand in for the logo', !!mark && mark.mono === 'MV', JSON.stringify(mark));
        check('with the airline named under them', !!mark && mark.name === 'Meridian Virtual', JSON.stringify(mark));
        check('and no empty picture frame', !!mark && !mark.logo);
        await page.close();
    }

    /* ==================================================================
     * 2. A RELOAD IS NOT AN ARRIVAL
     * ================================================================ */
    console.log('\nReloading the page you are already on');
    state = fresh();
    {
        const { page, errors } = await open('crew-dashboard.html', { arriving: false });
        await page.waitForTimeout(1200);
        check('nothing covers the page', (await page.locator('.csplash').count()) === 0);
        check('nothing threw', errors.length === 0, errors[0]);
        await page.close();
    }

    /* The flag is spent on the way in, so the NEXT load is a reload even
       though the one before it was an arrival. */
    console.log('\nAnd the arrival flag is spent, not left lying around');
    state = fresh();
    {
        const { page } = await open('crew-dashboard.html');
        await page.waitForFunction(() => !document.querySelector('.csplash'), null, { timeout: 9000 }).catch(() => {});
        const left = await page.evaluate(() => sessionStorage.getItem('crew:welcome:testva'));
        check('the flag is cleared as soon as it is read', left === null, 'still set: ' + left);
        await page.reload();
        await page.waitForTimeout(1200);
        check('so a reload shows nothing', (await page.locator('.csplash').count()) === 0);
        await page.close();
    }

    /* ==================================================================
     * 3. THE WALK WAITS FOR IT
     * ================================================================ */
    console.log('\nThe walk around does not open underneath the cover');
    state = fresh();
    {
        const { page } = await open('crew-dashboard.html');
        // While the cover is up, no tour card may exist.
        await page.waitForSelector('.csplash', { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(900);
        const both = await page.evaluate(() => ({
            cover: !!document.querySelector('.csplash'),
            tour: !!document.querySelector('.ctour-card'),
        }));
        check('no tour card while the cover is up', !both.cover || !both.tour, JSON.stringify(both));

        await page.waitForFunction(() => !document.querySelector('.csplash'), null, { timeout: 9000 }).catch(() => {});
        await page.waitForTimeout(1400);
        check('and the walk is offered once it has lifted',
            (await page.locator('.ctour-card').count()) === 1);
        await page.close();
    }

    /* ==================================================================
     * 4. THE PICTURE ON THE AVATAR BUTTON
     * ================================================================ */
    console.log('\nA pilot who has linked Discord');
    state = fresh({ role: 'pilot', avatar: 'https://cdn.discordapp.com/avatars/123/abc.png?size=64' });
    {
        const { page, errors } = await open('crew-pilot.html');
        await page.waitForFunction(() => {
            const el = document.getElementById('meAvatar');
            return el && el.querySelector('img');
        }, null, { timeout: 8000 }).catch(() => {});
        const av = await page.evaluate(() => {
            const el = document.getElementById('meAvatar');
            const img = el && el.querySelector('img');
            return img ? { src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0, text: el.textContent.trim() } : null;
        });
        check('their picture is on the button', !!av && /cdn\.discordapp\.com/.test(av.src), av ? av.src : 'no image');
        check('and it actually loaded', !!av && av.loaded);
        check('with no initials left behind it', !!av && av.text === '');
        check('nothing threw', errors.length === 0, errors[0]);
        await page.close();
    }

    console.log('\nA pilot whose Discord picture has since changed');
    state = fresh({ role: 'pilot', avatar: 'https://cdn.discordapp.com/avatars/123/stale.png?size=64' });
    {
        // The stored avatar hash goes stale the moment somebody changes their
        // picture. What must NOT happen is a broken-image glyph in the corner
        // of every page.
        const { page } = await open('crew-pilot.html', { avatarStatus: 404 });
        await page.waitForTimeout(2500);
        const av = await page.evaluate(() => {
            const el = document.getElementById('meAvatar');
            return { text: el.textContent.trim(), img: !!el.querySelector('img') };
        });
        check('the initials come back', av.text === 'RB', JSON.stringify(av));
        check('and the broken image is gone', !av.img);
        await page.close();
    }

    console.log('\nA pilot who has not linked Discord');
    state = fresh({ role: 'pilot', avatar: '' });
    {
        const { page } = await open('crew-pilot.html');
        await page.waitForTimeout(2000);
        const av = await page.evaluate(() => {
            const el = document.getElementById('meAvatar');
            return { text: el.textContent.trim(), img: !!el.querySelector('img') };
        });
        check('their initials are drawn, as before', av.text === 'RB' && !av.img, JSON.stringify(av));
        await page.close();
    }

    /* ==================================================================
     * 5. LESS MOVEMENT
     * ================================================================ */
    console.log('\nA reader who has asked for less movement');
    state = fresh();
    {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, reducedMotion: 'reduce' });
        await page.route('**/api/**', api);
        await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
        await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
        await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.addInitScript(() => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Ravi Bhatia', role: 'owner' }));
        });
        await page.goto(`http://127.0.0.1:${port}/__blank`);
        await page.evaluate(() => sessionStorage.setItem('crew:welcome:testva', '1'));
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForSelector('.csplash', { timeout: 4000 }).catch(() => {});
        const still = await page.evaluate(() => {
            const arc = document.querySelector('.csplash__arc');
            return arc ? getComputedStyle(arc).animationName : 'no cover';
        });
        check('the ring does not turn', still === 'none', 'animation: ' + still);
        await page.waitForFunction(() => !document.querySelector('.csplash'), null, { timeout: 9000 })
            .then(() => check('and it still lifts', true))
            .catch(() => check('and it still lifts', false, 'the cover stayed up'));
        await page.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
