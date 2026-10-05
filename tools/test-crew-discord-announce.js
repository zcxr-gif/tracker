// test-crew-discord-announce.js
// Announcements to Discord from the noticeboard, and the per-feed webhook rows.
//
//   * the composer offers "Also post to Discord" with a banner style, an upload
//     option and who to ping; the choice is sent with the post
//   * the banner preview is the backend's real picture, fetched with the
//     staff session (it is not a public image)
//   * "My own image" uploads first and sends the uploaded URL
//   * an existing staff notice can be posted to Discord from its card
//   * the Alerts settings list the new feeds, and the new automatic ones say
//     "off" rather than "→ main channel" until they have a webhook
//
// Run:  node tools/test-crew-discord-announce.js
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
    const f = path.join(ROOT, p);
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

// A 1×1 PNG, standing in for the drawn banner.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const seen = { posts: [], shares: [], previews: [], uploads: 0 };
const FEEDS = {
    recruitment: { configured: false, hint: '', usingDefault: true, optIn: false },
    pireps: { configured: false, hint: '', usingDefault: true, optIn: false },
    routes: { configured: false, hint: '', usingDefault: true, optIn: false },
    events: { configured: false, hint: '', usingDefault: true, optIn: false },
    retention: { configured: false, hint: '', usingDefault: true, optIn: false },
    announcements: { configured: false, hint: '', usingDefault: true, optIn: false },
    roster: { configured: false, hint: '', usingDefault: false, optIn: true },
    awards: { configured: false, hint: '', usingDefault: false, optIn: true },
    library: { configured: false, hint: '', usingDefault: false, optIn: true },
    shop: { configured: true, hint: '…/webhooks/••••1234/…', usingDefault: false, optIn: true },
};
let notices = [
    { id: 'n1', title: 'July schedule is live', body: '', kind: 'notice', auto: false, pinned: false, createdAt: new Date().toISOString(), authorName: 'Owner' },
    { id: 'n2', title: 'Rae joined the crew', body: '', kind: 'join', auto: true, pinned: false, createdAt: new Date().toISOString() },
];

function api(route) {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('/api/va-ads/by-slug/')) return json({ name: 'Meridian Virtual', code: 'MRD', slug: 'testva', accent: '#14375E', ranks: [], roles: [], fleet: [], join: {} });
    if (p.endsWith('/announcements/banner.png')) {
        seen.previews.push({ auth: req.headers().authorization || '', style: url.searchParams.get('style'), title: url.searchParams.get('title') });
        return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    if (p.endsWith('/announcements/banner') && method === 'POST') { seen.uploads++; return json({ url: 'https://cdn.example.test/banner.png' }); }
    if (/\/announcements\/[^/]+\/discord$/.test(p)) { seen.shares.push({ id: p.split('/').slice(-2)[0], body: req.postDataJSON() }); return json({ ok: true, discord: { sent: true } }); }
    if (p.endsWith('/announcements') && method === 'POST') {
        const b = req.postDataJSON();
        seen.posts.push(b);
        notices = [{ id: 'n' + (notices.length + 1), title: b.title, body: b.body, kind: 'notice', auto: false, createdAt: new Date().toISOString() }, ...notices];
        return json({ announcement: notices[0], ...(b.discord ? { discord: { sent: true } } : {}) }, 201);
    }
    if (p.endsWith('/announcements')) return json({ announcements: notices, canManage: true });
    if (p.endsWith('/webhook')) return json({ configured: true, hint: '…/webhooks/••••9999/…', feeds: FEEDS });
    if (p.endsWith('/me')) return json({ role: 'owner', caps: [], capabilities: [], rolePresets: [], staffRoles: [], staffAssignments: [] });
    if (p.endsWith('/stats')) return json({ ok: true, connected: true, stats: {} });
    return json({});
}

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    const errors = [];
    page.on('pageerror', (e) => { if (!/tailwind is not defined|lucide/i.test(String(e))) errors.push(String(e)); });
    await page.route('**/api/**', api);
    await page.route('https://cdn.tailwindcss.com**', (r) => r.fulfill({
        contentType: 'text/javascript',
        body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});`,
    }));
    await page.route('https://unpkg.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.lucide={createIcons(){}};' }));
    await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('**/cdn.example.test/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await page.addInitScript(() => {
        localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' }));
        localStorage.setItem('crew:tour:staff:testva', '1');
    });
    await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
    await page.waitForTimeout(1500);

    console.log('\nThe composer');
    await page.evaluate(() => window.CrewNotices.open());
    await page.waitForSelector('#cnCompose', { timeout: 5000 });
    check('Discord options start hidden', await page.isHidden('#cnShareOpts'));
    await page.check('#cnDiscord');
    check('ticking the box shows the banner choices', await page.isVisible('#cnShareOpts'));
    const styles = await page.$$eval('[data-style]', (bs) => bs.map((b) => b.getAttribute('data-style')));
    check('four drawn styles, your own image, or none', styles.join() === 'notice,event,celebration,urgent,own,none', styles.join());

    await page.fill('#cnTitle', 'Summer fly-in');
    await page.fill('#cnBody', 'Saturday 18:00Z from EGLL.');
    await page.click('[data-style="celebration"]');
    await page.waitForFunction(() => { const i = document.getElementById('cnPreview'); return i && !i.classList.contains('cp-hidden') && i.src.startsWith('blob:'); }, null, { timeout: 4000 }).catch(() => {});
    const last = seen.previews[seen.previews.length - 1] || {};
    check('the preview is the backend’s picture, for the chosen style', last.style === 'celebration' && last.title === 'Summer fly-in', JSON.stringify(last));
    check('…fetched with the staff session', last.auth === 'Bearer tok', last.auth);
    check('…and shown', await page.evaluate(() => document.getElementById('cnPreview').src.startsWith('blob:')));

    await page.selectOption('#cnPing', 'here');
    await page.click('#cnPost');
    await page.waitForTimeout(600);
    const post = seen.posts[seen.posts.length - 1] || {};
    check('the post carries the Discord choice', post.discord === true && post.bannerStyle === 'celebration' && post.ping === 'here' && post.banner === true, JSON.stringify(post));
    check('the choice is remembered for next time', await page.evaluate(() => localStorage.getItem('crew:notice:discord')) === '1');

    console.log('\nMy own image');
    await page.waitForSelector('#cnCompose');
    check('Discord stays ticked after posting', await page.isChecked('#cnDiscord'));
    await page.click('[data-style="own"]');
    await page.fill('#cnTitle', 'Livery contest');
    await page.click('#cnPost');
    await page.waitForTimeout(300);
    const refused = await page.textContent('#cnNote');
    check('posting with no image chosen is stopped and explained', /Choose your banner image/.test(refused), refused);
    await page.setInputFiles('#cnOwnFile', { name: 'art.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForTimeout(500);
    check('the image is uploaded', seen.uploads === 1);
    await page.click('#cnPost');
    await page.waitForTimeout(600);
    const own = seen.posts[seen.posts.length - 1] || {};
    check('…and its URL is what gets posted', own.bannerImage === 'https://cdn.example.test/banner.png' && own.title === 'Livery contest', JSON.stringify(own));

    console.log('\nAn existing notice');
    await page.waitForSelector('[data-share]');
    const shareable = await page.$$eval('[data-share]', (bs) => bs.map((b) => b.getAttribute('data-share')));
    check('staff notices have a Discord button, generated rows do not', shareable.includes('n1') && !shareable.includes('n2'), shareable.join());
    await page.click('[data-style="event"]');
    page.once('dialog', (d) => d.accept());
    await page.click('[data-share="n1"]');
    await page.waitForTimeout(500);
    const share = seen.shares[0] || {};
    check('it posts that notice with the chosen banner', share.id === 'n1' && share.body && share.body.bannerStyle === 'event', JSON.stringify(share));
    await page.evaluate(() => window.CrewNotices.close());

    console.log('\nAlerts settings');
    await page.evaluate(() => { window.openSettings(); window.setCat('alerts'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { document.getElementById('feedHooks').open = true; });
    const rows = await page.$$eval('#feedHooks [data-feed]', (rs) => rs.map((r) => [r.getAttribute('data-feed'), r.querySelector('[data-feed-status]').textContent.trim()]));
    const st = Object.fromEntries(rows);
    check('every feed has a row', ['recruitment', 'pireps', 'routes', 'events', 'announcements', 'retention', 'roster', 'awards', 'library', 'shop'].every((f) => f in st), Object.keys(st).join());
    check('announcements fall back to the main channel', /main channel/.test(st.announcements), st.announcements);
    check('a new automatic feed with no webhook says off', st.roster === 'off' && st.awards === 'off', JSON.stringify(st));
    check('one with a webhook says so', /own channel/.test(st.shop), st.shop);

    check('no page errors', errors.length === 0, errors.join(' | '));
    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} failing` : '\nall passing');
    process.exit(failures ? 1 : 0);
})();
