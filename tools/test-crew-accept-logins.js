// test-crew-accept-logins.js
// "Create a crew center login" on accept, as one choice for every application.
//
//   * the crew's saved default decides how every card starts
//   * the switch at the top of Applications flips every waiting card at once
//     and saves the choice for the crew (acceptCreatesLogin)
//   * one card can still be changed on its own, and what that card says is
//     what the accept sends
//   * the same setting sits in Recruitment → Joining and is saved with it
//
// Run:  node tools/test-crew-accept-logins.js
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

const APPS = [
    { _id: 'a1', ifcName: 'Rae Okafor', status: 'pending', answers: [] },
    { _id: 'a2', ifcName: 'Sam Park', status: 'pending', answers: [] },
];
let savedDefault = false;
const settingsPosts = [];
const accepts = [];
function api(route) {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('/api/va-ads/by-slug/')) {
        return json({ name: 'Meridian Virtual', code: 'MRD', slug: 'testva', accent: '#14375E', ranks: [], roles: [], fleet: [],
            join: { mode: 'application', createsLogin: savedDefault, discordInvite: '', form: [], requirements: [] } });
    }
    if (p.endsWith('/settings') && method === 'POST') { settingsPosts.push(req.postDataJSON()); return json({}); }
    if (p.endsWith('/applications') && url.searchParams.get('status') === 'pending') return json({ applications: APPS });
    if (/\/applications\/[^/]+$/.test(p) && method !== 'GET') { accepts.push({ id: p.split('/').pop(), body: req.postDataJSON() }); return json({ ok: true, application: { status: 'accepted' } }); }
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
    await page.addInitScript(() => {
        localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' }));
        localStorage.setItem('crew:tour:staff:testva', '1');
    });
    await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
    await page.waitForTimeout(1500);

    console.log('\nThe crew’s default');
    await page.evaluate(async () => { await fetchApps(); window.openRoster && openRoster(); switchRosterView('apps'); renderApps(); });
    await page.waitForSelector('#appsMkacctAll', { timeout: 5000 });
    const cards = () => page.$$eval('#appsList [data-mkacct]', (bs) => bs.map((b) => b.checked));
    check('saved as off, the switch starts off', !(await page.isChecked('#appsMkacctAll')));
    check('…and so does every card', (await cards()).every((c) => !c) && (await cards()).length === 2, JSON.stringify(await cards()));

    console.log('\nOne switch for all of them');
    await page.check('#appsMkacctAll');
    await page.waitForTimeout(300);
    check('every waiting card follows it', (await cards()).every((c) => c), JSON.stringify(await cards()));
    check('…and it is saved for the crew', settingsPosts.some((b) => b.acceptCreatesLogin === true && Object.keys(b).length === 1), JSON.stringify(settingsPosts));
    await page.uncheck('#appsMkacctAll');
    await page.waitForTimeout(300);
    check('turning it off unticks them all again', (await cards()).every((c) => !c), JSON.stringify(await cards()));
    check('…and saves that too', settingsPosts[settingsPosts.length - 1].acceptCreatesLogin === false);

    console.log('\nOne card on its own');
    await page.check('[data-app="a2"] [data-mkacct]');
    check('a single card can still be ticked', JSON.stringify(await cards()) === '[false,true]', JSON.stringify(await cards()));
    await page.click('[data-app="a1"] [data-accept]');
    await page.waitForTimeout(500);
    const a1 = accepts.find((a) => a.id === 'a1');
    check('accepting an unticked card sends no login', a1 && a1.body && a1.body.createAccount === false, JSON.stringify(accepts));

    console.log('\nRecruitment → Joining');
    const joining = await page.evaluate(() => document.getElementById('joinCreatesLogin').checked);
    check('the Joining setting mirrors the switch', joining === false);
    await page.evaluate(() => { document.getElementById('joinCreatesLogin').checked = true; });
    await page.evaluate(() => saveRecruitment(document.createElement('button')));
    await page.waitForTimeout(300);
    check('saving recruitment sends it', settingsPosts[settingsPosts.length - 1].acceptCreatesLogin === true, JSON.stringify(settingsPosts[settingsPosts.length - 1]));

    check('no page errors', errors.length === 0, errors.join(' | '));
    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} failing` : '\nall passing');
    process.exit(failures ? 1 : 0);
})();
