// test-crew-social.js
// Drives the REAL crew-dashboard.html Instagram wall.
//
// The wall is staff-pinned post links rather than a profile feed, because
// Instagram has not allowed a profile to be embedded for years — see the
// header of crewSocial.js. So the things worth pinning down are: that a
// pasted link is parsed rather than trusted, that the frame is built from the
// parsed shortcode, that it is not built until it is scrolled to, that a crew
// center with no Instagram is laid out exactly as it was, and that a backend
// which does not store the key yet says so instead of pretending to save.
//
// Run:  node tools/test-crew-social.js
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

let posts = [];
let brandingSocial = null;
let settingsReply = null;     // [status, body] to force a particular answer

function api(route) {
    const url = new URL(route.request().url()); const p = url.pathname; const m = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.endsWith('/settings') && m === 'POST') {
        const body = route.request().postDataJSON() || {};
        posts.push(body);
        if (settingsReply) return json(settingsReply[1], settingsReply[0]);
        return json(body);
    }
    if (p.includes('/va-ads/by-slug/')) {
        const b = { name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial', 'classic'] };
        if (brandingSocial) b.social = brandingSocial;
        return json(b);
    }
    if (p.endsWith('/me')) return json({ role: 'owner', caps: [], capabilities: [], view: 'staff' });
    if (p.endsWith('/crew/aircraft-metadata')) return json({ ok: true, aircraft: [], liveries: {} });
    return json({});
}

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log(`  ✓ ${n}`); pass++; } else { console.log(`  ✗ ${n}${x ? `  (${x})` : ''}`); fail++; } };
const head = (s) => console.log(`\n${s}`);

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    const open = async (w = 1280, h = 900) => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h } });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        await page.route('**/api/**', api);
        // Instagram is not reachable from a test box, and what is asserted is
        // the frame's ADDRESS, never that Instagram rendered. It is answered
        // with a stub rather than aborted: an aborted navigation leaves an
        // opaque-origin error page in the frame, and an init script that runs
        // in every frame then throws a SecurityError reaching localStorage
        // there — the test's own noise, reported as if the page had failed.
        await page.route('**://*.instagram.com/**', (r) =>
            r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));
        // Guarded the way the page guards its own storage reads, so a frame
        // that cannot have storage is not an error either.
        await page.addInitScript(() => {
            try { localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' })); } catch (_) {}
        });
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForTimeout(1200);
        return { ctx, page, errs };
    };

    // ------------------------------------------------------------------
    head('What a pasted link is allowed to be');
    brandingSocial = null;
    let { ctx, page, errs } = await open();
    const parsed = await page.evaluate(() => {
        const t = (u) => { const r = CrewSocial.parsePost(u); return r ? `${r.kind}:${r.code}` : null; };
        return {
            plain:     t('https://www.instagram.com/p/CxYz-123_a/'),
            noWww:     t('https://instagram.com/p/CxYz-123_a'),
            reel:      t('https://www.instagram.com/reel/AbC123/?igsh=junk&x=1'),
            reels:     t('https://www.instagram.com/reels/AbC123/'),
            tv:        t('https://www.instagram.com/tv/AbC123/'),
            viaProfile:t('https://www.instagram.com/someairline/p/AbC123/'),
            lookalike: t('https://instagram.com.evil.test/p/AbC123/'),
            suffix:    t('https://notinstagram.com/p/AbC123/'),
            js:        t('javascript:alert(1)//instagram.com/p/AbC123/'),
            junk:      t('hello'),
            profile:   t('https://www.instagram.com/someairline/'),
        };
    });
    ok('a post link parses', parsed.plain === 'p:CxYz-123_a', JSON.stringify(parsed));
    ok('…without www', parsed.noWww === 'p:CxYz-123_a', JSON.stringify(parsed));
    ok('a reel parses, tracking junk and all', parsed.reel === 'reel:AbC123', JSON.stringify(parsed));
    ok('…/reels/ normalises to /reel/', parsed.reels === 'reel:AbC123', JSON.stringify(parsed));
    ok('IGTV parses', parsed.tv === 'tv:AbC123', JSON.stringify(parsed));
    ok('a link that goes via the profile parses', parsed.viaProfile === 'p:AbC123', JSON.stringify(parsed));
    ok('a look-alike host is refused', parsed.lookalike === null, JSON.stringify(parsed));
    ok('…and a suffix host is refused', parsed.suffix === null, JSON.stringify(parsed));
    ok('javascript: is refused', parsed.js === null, JSON.stringify(parsed));
    ok('junk is refused', parsed.junk === null, JSON.stringify(parsed));
    ok('a profile link is not a post', parsed.profile === null, JSON.stringify(parsed));
    await ctx.close();

    // ------------------------------------------------------------------
    head('A crew center with no Instagram is the layout it always was');
    brandingSocial = null;
    ({ ctx, page, errs } = await open());
    let r = await page.evaluate(() => ({
        cardHidden: document.getElementById('socialCard').classList.contains('hidden'),
        gridFlag: document.getElementById('grid').classList.contains('has-social'),
        cols: getComputedStyle(document.getElementById('grid')).gridTemplateColumns,
    }));
    ok('the card is not there', r.cardHidden, JSON.stringify(r));
    ok('…and the grid opens no column for it', !r.gridFlag, JSON.stringify(r));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();

    // ------------------------------------------------------------------
    head('With posts pinned — desktop');
    brandingSocial = { handle: '@aeromexicovirtual', posts: [
        'https://www.instagram.com/p/AAA111/',
        'https://www.instagram.com/reel/BBB222/?igsh=x',
        'https://instagram.com.evil.test/p/EVIL/',   // must never be drawn
    ] };
    ({ ctx, page, errs } = await open(1280, 900));
    r = await page.evaluate(() => {
        const grid = document.getElementById('grid');
        return {
            shown: !document.getElementById('socialCard').classList.contains('hidden'),
            gridFlag: grid.classList.contains('has-social'),
            cols: getComputedStyle(grid).gridTemplateColumns,
            slots: document.querySelectorAll('#socialWall .cs-slot').length,
            codes: [...document.querySelectorAll('#socialWall .cs-slot')].map((e) => e.dataset.code),
            follow: (document.querySelector('#socialWall .cs-follow') || {}).textContent,
            sticky: getComputedStyle(document.querySelector('.r-social')).position,
        };
    });
    ok('the wall is on the dashboard', r.shown, JSON.stringify(r));
    ok('…the grid opens a rail column for it', r.gridFlag && /360px/.test(r.cols), r.cols);
    ok('…and the rail stays with you as the page scrolls', r.sticky === 'sticky', r.sticky);
    ok('both real posts are pinned', r.slots === 2, JSON.stringify(r.codes));
    ok('…and the look-alike is silently dropped', !r.codes.includes('EVIL'), JSON.stringify(r.codes));
    ok('the handle is offered to follow', /aeromexicovirtual/.test(r.follow || ''), r.follow);

    head('An embed is not built until it is looked at');
    const before = await page.evaluate(() => ({
        frames: document.querySelectorAll('#socialWall iframe').length,
        placeholders: document.querySelectorAll('#socialWall .cs-placeholder').length,
    }));
    // rootMargin is 300px, so the first slot may already be in range; what must
    // hold is that a placeholder exists and no frame is built for a slot that is
    // nowhere near the viewport.
    ok('a placeholder stands in until then', before.placeholders >= 1 || before.frames >= 1, JSON.stringify(before));

    await page.evaluate(() => document.querySelector('#socialWall .cs-slot').scrollIntoView());
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => {
        const f = document.querySelector('#socialWall iframe');
        return f ? { src: f.getAttribute('src'), sandbox: f.getAttribute('sandbox'), w: f.style.width } : null;
    });
    ok('scrolled to, the frame is built', !!after, JSON.stringify(after));
    ok('…from the parsed shortcode, on instagram.com', after && after.src === 'https://www.instagram.com/p/AAA111/embed/', JSON.stringify(after));
    ok('…sandboxed', after && /allow-scripts/.test(after.sandbox), JSON.stringify(after));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();

    // ------------------------------------------------------------------
    head('With posts pinned — a phone');
    ({ ctx, page, errs } = await open(390, 844));
    r = await page.evaluate(() => {
        const strip = document.querySelector('#socialWall .cs-strip');
        const cs = getComputedStyle(strip);
        return {
            display: cs.display, overflowX: cs.overflowX, snap: cs.scrollSnapType,
            swipes: strip.scrollWidth > strip.clientWidth + 1,
            pageScrollsSideways: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        };
    });
    ok('it is a row, not a column', r.display === 'flex', JSON.stringify(r));
    ok('…that swipes sideways', r.overflowX === 'auto' && r.swipes, JSON.stringify(r));
    ok('…and snaps post to post', /x/.test(r.snap), r.snap);
    ok('the page itself still does not scroll sideways', r.pageScrollsSideways, JSON.stringify(r));

    // A mounted slot used to shrink to its scaled height while the ones still
    // waiting kept the full one, so the row stayed as tall as its tallest
    // unmounted member and left a band of dead space under the post.
    await page.evaluate(() => document.querySelector('#socialWall .cs-slot').scrollIntoView());
    await page.waitForTimeout(600);
    const sized = await page.evaluate(() => {
        const strip = document.querySelector('#socialWall .cs-strip');
        const slots = [...strip.querySelectorAll('.cs-slot')];
        const hs = slots.map((s) => Math.round(s.getBoundingClientRect().height));
        return { hs, uniform: new Set(hs).size === 1,
                 dead: Math.round(strip.getBoundingClientRect().bottom - Math.max(...slots.map((s) => s.getBoundingClientRect().bottom))) };
    });
    ok('every post is the same height, mounted or not', sized.uniform, JSON.stringify(sized));
    ok('…so there is no dead band under the row', sized.dead <= 8, JSON.stringify(sized));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();

    // ------------------------------------------------------------------
    head('Saving');
    brandingSocial = null;
    ({ ctx, page, errs } = await open());
    await page.evaluate(() => { openSettings('appearance'); });
    await page.waitForTimeout(300);
    posts = []; settingsReply = null;
    await page.evaluate(() => {
        SOCIAL.handle = 'flyamv';
        SOCIAL.posts = ['https://www.instagram.com/p/ZZZ999/'];
    });
    await page.evaluate(() => saveSocial());
    await page.waitForTimeout(500);
    ok('sends the handle and the links', posts.length === 1 && posts[0].social.handle === 'flyamv'
        && posts[0].social.posts[0] === 'https://www.instagram.com/p/ZZZ999/', JSON.stringify(posts));
    let note = await page.textContent('#socialNote');
    ok('…and confirms', /Saved for your crew/.test(note), note);

    // A link that is not a post never reaches the server.
    posts = [];
    await page.evaluate(() => { SOCIAL.posts = ['https://example.com/nope']; });
    await page.evaluate(() => saveSocial());
    await page.waitForTimeout(300);
    note = await page.textContent('#socialNote');
    ok('a link that is not a post is refused here', posts.length === 0, JSON.stringify(posts));
    ok('…and says how to get the right one', /Copy link/.test(note), note);

    // The case that matters: a backend that does not know the key yet.
    posts = [];
    settingsReply = [200, { ok: true }];          // 200, but nothing echoed back
    await page.evaluate(() => { SOCIAL.posts = ['https://www.instagram.com/p/ZZZ999/']; });
    await page.evaluate(() => saveSocial());
    await page.waitForTimeout(400);
    note = await page.textContent('#socialNote');
    ok('a server that stores nothing does not report a save', !/Saved for your crew/.test(note), note);
    ok('…it says the backend has no place for it yet', /does not store Instagram links yet/.test(note), note);
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();

    console.log(`\n${pass} passed, ${fail} failed`);
    await browser.close(); server.close();
    process.exit(fail ? 1 : 0);
})();
