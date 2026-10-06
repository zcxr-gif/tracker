// test-crew-invite-check.js
// Inviting a pilot by hand, through the REAL dashboard against a faked backend:
//
//   * "Check" shows their IF account, stats, the airline's requirements pass or
//     fail, and whether they are already here or elsewhere
//   * it fills in the name and the next free callsign, without overwriting
//     anything staff already typed
//   * the saved welcome note is in the form, an edit to it is saved before the
//     invite goes, and the checked IF id goes with the new pilot
//   * an account that does not exist says so
//
// Run:  node tools/test-crew-invite-check.js
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});
// The same stand-in for Tailwind the codeshare test uses: just enough layout
// for the drawers to sit on screen.
const TW = `(function(){var s=document.createElement('style');s.textContent=[
 '.fixed{position:fixed}.absolute{position:absolute}.relative{position:relative}.sticky{position:sticky}',
 '.inset-0{inset:0}.top-0{top:0}.right-0{right:0}.bottom-0{bottom:0}.hidden{display:none}',
 '.grid{display:grid}.flex{display:flex}.block{display:block}.inline-flex{display:inline-flex}',
 '.items-center{align-items:center}.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.min-w-0{min-width:0}',
 '.w-full{width:100%}.h-full{height:100%}.overflow-y-auto{overflow-y:auto}.overflow-hidden{overflow:hidden}',
 '.translate-x-full{transform:translateX(100%)}.z-50{z-index:50}'
].join('');document.head.appendChild(s);window.tailwind={config:{}};})();`;

let failures = 0;
const check = (label, ok, extra) => {
    if (!ok) { failures++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); } else console.log('  ✓ ' + label);
};

const FOUND = {
    available: true, found: true, username: 'SkyFlyer', userId: 'if-123', grade: 3,
    stats: { grade: 3, hours: 220, landings: 410, flights: 300, violations: 4 },
    requirements: [{ label: 'Grade', cmp: 'min', need: 2, have: 3, ok: true }, { label: 'Violations', cmp: 'max', need: 2, have: 4, ok: false }],
    meets: false, onRoster: null, application: { createdAt: '2026-10-01T00:00:00Z' }, otherVas: ['Borealis Virtual'],
    suggestedCallsign: 'AURORA 011AU',
};

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });
    const sent = [];
    const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
    page.on('pageerror', (e) => { failures++; console.log('  ✗ page error — ' + String(e).split('\n')[0]); });
    await page.route('**/cdn.tailwindcss.com**', (r) => r.fulfill({ contentType: 'application/javascript', body: TW }));
    await page.route('**/unpkg.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/api/**', (route) => {
        const req = route.request();
        const p = new URL(req.url()).pathname;
        const m = req.method();
        const json = (x, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(x) });
        const body = () => { try { return JSON.parse(req.postData() || '{}'); } catch { return {}; } };
        if (m !== 'GET') sent.push({ m, p, body: body() });
        if (p.endsWith('/invite-check')) return json(body().ifcName === 'nobody' ? { available: true, found: false } : FOUND);
        if (p.endsWith('/invite-note') && m === 'GET') return json({ note: 'Read the SOP first.' });
        if (p.endsWith('/invite-note') && m === 'PUT') return json({ note: body().note });
        if (p.endsWith('/roster') && m === 'POST') return json({ member: { id: 'm9', name: body().name, callsign: body().callsign }, invite: { results: [] } }, 201);
        if (p.endsWith('/me')) return json({ role: 'owner', caps: ['*'], capabilities: [], rolePresets: [], staffRoles: [], staffAssignments: [] });
        if (p.endsWith('/roster')) return json({ roster: [] });
        return json({});
    });
    await page.addInitScript(() => {
        localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' }));
        localStorage.setItem('crew:tour:staff:testva', '1');
    });
    await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.querySelectorAll('.ctour-mask, .ctour-pop, .ctour').forEach((e) => e.remove()));
    await page.evaluate(() => { openRoster(); openPilotForm(); });
    await page.waitForTimeout(500);

    console.log('\nThe form');
    check('the saved welcome note is already in it', (await page.inputValue('#np_note')) === 'Read the SOP first.');

    console.log('\nThe background check');
    await page.fill('#np_ifc', 'nobody');
    await page.click('#np_ifcCheck');
    await page.waitForTimeout(300);
    check('a name with no IF account says so', /no Infinite Flight account called/.test(await page.textContent('#np_check')));

    await page.fill('#np_callsign', 'AURORA 050AU');   // staff's own choice
    await page.fill('#np_ifc', 'skyflyer');
    await page.click('#np_ifcCheck');
    await page.waitForTimeout(300);
    const txt = await page.textContent('#np_check');
    check('a real account is confirmed', /SkyFlyer.*real Infinite Flight account/.test(txt), txt);
    check('…with their stats', /Hours\s*220/.test(txt) && /Violations\s*4/.test(txt));
    check('…the requirements they meet and miss', /✓ Grade at least 2/.test(txt) && /✗ Violations at most 2/.test(txt));
    check('…a warning that they fall short', /don’t meet everything/.test(txt));
    check('…their waiting application', /application waiting/.test(txt));
    check('…and the other airlines that have them', /Borealis Virtual/.test(txt));
    check('the IFC box takes the account’s own spelling', (await page.inputValue('#np_ifc')) === 'SkyFlyer');
    check('the name is filled in', (await page.inputValue('#np_name')) === 'SkyFlyer');
    check('a callsign staff already typed is left alone', (await page.inputValue('#np_callsign')) === 'AURORA 050AU');

    await page.fill('#np_callsign', '');
    await page.click('#np_ifcCheck');
    await page.waitForTimeout(300);
    check('an empty callsign gets the next free one', (await page.inputValue('#np_callsign')) === 'AURORA 011AU');

    console.log('\nInviting');
    await page.fill('#np_note', 'Welcome! Book your first flight from Routes.');
    await page.click('#pilotSubmitBtn');
    await page.waitForTimeout(500);
    const putAt = sent.findIndex((s) => s.m === 'PUT' && /invite-note$/.test(s.p));
    const postAt = sent.findIndex((s) => s.m === 'POST' && /roster$/.test(s.p));
    check('the edited note is saved', putAt >= 0 && sent[putAt].body.note === 'Welcome! Book your first flight from Routes.');
    check('…before the invite goes, so it is in the message', putAt >= 0 && postAt > putAt);
    const add = sent[postAt] && sent[postAt].body;
    check('the new pilot carries their IFC name and checked IF id', add && add.ifcName === 'SkyFlyer' && add.ifUserId === 'if-123', JSON.stringify(add));
    check('…the callsign and an invite', add && add.callsign === 'AURORA 011AU' && add.invite === true);

    await browser.close(); server.close();
    console.log(failures ? `\n${failures} failed\n` : '\nAll good.\n');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
