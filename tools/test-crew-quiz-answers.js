// test-crew-quiz-answers.js
// Staff reading what somebody answered — on a pilot's quiz and on an entrance
// test sat by somebody with no account — and the v26 permission split as the
// dashboard sees it.
//
//   * a marked result has "See answers"; opening it lists every question with
//     what was picked and what was right, and the second press closes it
//   * "only the ones they got wrong" hides the rest
//   * an entrance test (no account) has the same button
//   * somebody holding only tests.manage (an Examiner) gets the Recruitment
//     tile and the quiz screens; somebody with only shop.manage gets the shop
//
// Run:  node tools/test-crew-quiz-answers.js
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

const QUIZ = { id: 'qz', title: 'Entrance test', passMark: 80, maxAttempts: 3, active: true, ready: true, open: false, questionCount: 2,
    questions: [{ id: 'a', text: 'What does QNH set?', options: ['Altitude', 'Height'], correct: 0 }, { id: 'b', text: 'Squawk for radio failure?', options: ['7600', '7700'], correct: 0 }] };
const ATTEMPT = { id: 'att1', quizId: 'qz', quizTitle: 'Entrance test', memberId: 'm1', pilotName: 'Rae Okafor', callsign: 'MRD101',
    status: 'failed', score: 1, total: 2, percent: 50, passMark: 80, attemptsUsed: 1, maxAttempts: 3, submittedAt: new Date().toISOString() };
const TEST = { id: 'att2', quizId: 'qz', quizTitle: 'Entrance test', memberId: null, pilotName: 'Sam Candidate', ifcName: 'samc',
    status: 'passed', score: 2, total: 2, percent: 100, passMark: 80, attemptsUsed: 1, maxAttempts: 3, submittedAt: new Date().toISOString(), live: false };
const ANSWERS = {
    att1: { attempt: ATTEMPT, quizGone: false, answers: [
        { n: 1, id: 'a', gone: false, question: 'What does QNH set?', options: ['Altitude', 'Height'], chosen: 0, chosenText: 'Altitude', correct: 0, correctText: 'Altitude', right: true },
        { n: 2, id: 'b', gone: false, question: 'Squawk for radio failure?', options: ['7600', '7700'], chosen: 1, chosenText: '7700', correct: 0, correctText: '7600', right: false },
    ] },
    att2: { attempt: TEST, quizGone: false, answers: [
        { n: 1, id: 'a', gone: false, question: 'What does QNH set?', options: ['Altitude', 'Height'], chosen: 0, chosenText: 'Altitude', correct: 0, correctText: 'Altitude', right: true },
    ] },
};

let meCaps = [];
let meRole = 'owner';
const answersAsked = [];
function api(route) {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
    if (p.includes('/api/va-ads/by-slug/')) return json({ name: 'Meridian Virtual', code: 'MRD', slug: 'testva', accent: '#14375E', ranks: [], roles: [], fleet: [], join: {}, crewShop: { enabled: false } });
    const m = p.match(/\/quiz-attempts\/([^/]+)\/answers$/);
    if (m) { answersAsked.push(m[1]); return json(ANSWERS[m[1]] || { answers: [] }); }
    if (p.endsWith('/quiz-attempts')) return json({ attempts: [ATTEMPT, { ...TEST, entrance: true }] });
    if (p.endsWith('/quizzes')) return json({ supported: true, quizzes: [QUIZ], canBuild: true, canReview: true, gateConfig: { enabled: false }, banners: {} });
    if (p.endsWith('/entrance-tests')) return json({ tests: [TEST], quizzes: [{ id: 'qz', title: 'Entrance test', ready: true }] });
    if (p.endsWith('/me')) return json({ role: meRole, caps: meCaps, capabilities: [], rolePresets: [], staffRoles: [], staffAssignments: [] });
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
    const open = async (role, caps) => {
        meRole = role; meCaps = caps;
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
        await page.addInitScript((r) => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Jo', role: r }));
            localStorage.setItem('crew:tour:staff:testva', '1');
        }, role);
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForTimeout(1500);
        return { page, errors };
    };

    console.log('\nA pilot’s quiz');
    const { page, errors } = await open('owner', []);
    await page.evaluate(() => window.openRecruit('sent'));
    await page.waitForSelector('[data-qa-answers="att1"]', { timeout: 5000 }).catch(() => {});
    check('a marked result has See answers', await page.isVisible('[data-qa-answers="att1"]'));
    await page.click('[data-qa-answers="att1"]');
    await page.waitForSelector('.ca-q', { timeout: 3000 }).catch(() => {});
    const qs = await page.$$eval('.qa-card .ca-q', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    check('every question is listed', qs.length === 2, JSON.stringify(qs));
    check('…with what they picked and what was right', /7700.*their answer/.test(qs[1] || '') && /7600.*right answer/.test(qs[1] || ''), qs[1]);
    check('the head says how many were wrong', /1 of 2 wrong/.test(await page.textContent('.ca-head')));
    await page.check('[data-ca-wrong]');
    const visible = await page.$$eval('.qa-card .ca-q', (els) => els.filter((e) => e.offsetParent !== null).length);
    check('“only the ones they got wrong” hides the rest', visible === 1, String(visible));
    await page.click('[data-qa-answers="att1"]');
    check('a second press closes it', (await page.$$('.qa-card .ca-wrap')).length === 0);

    console.log('\nAn entrance test (no account)');
    await page.evaluate(() => window.CrewEntrance.open());
    await page.waitForSelector('.et-row [data-et-answers]', { timeout: 5000 }).catch(() => {});
    check('it has See answers too', await page.isVisible('.et-row [data-et-answers]'));
    await page.click('.et-row [data-et-answers]');
    await page.waitForSelector('.et-row .ca-q', { timeout: 3000 }).catch(() => {});
    check('…and they load, for the right test', answersAsked.includes('att2') && (await page.$$('.et-row .ca-q')).length === 1, answersAsked.join());
    check('no page errors', errors.length === 0, errors.join(' | '));
    await page.close();

    console.log('\nThe new permissions on the dashboard');
    {
        const { page: p2 } = await open('staff', ['tests.manage']);
        const tiles = await p2.$$eval('#toolGrid a', (as) => as.map((a) => a.textContent.trim()));
        check('an Examiner gets the Recruitment tile', tiles.some((t) => /Recruitment/.test(t)), tiles.join(' | '));
        check('…and not the Roster', !tiles.some((t) => /^Roster/.test(t)), tiles.join(' | '));
        const tabs = await p2.evaluate(() => { window.openRecruit('quizzes'); return [...document.querySelectorAll('.recruit-tab:not(.hidden)')].map((t) => t.getAttribute('data-rcat')); });
        check('…with the quiz screens open to them', tabs.includes('quizzes') && tabs.includes('sent'), tabs.join());
        check('…but not the join settings', !tabs.includes('joining'), tabs.join());
        await p2.close();
    }
    {
        const { page: p3 } = await open('staff', ['shop.manage']);
        const tiles = await p3.$$eval('#toolGrid a', (as) => as.map((a) => a.textContent.trim()));
        check('a Shop manager gets the shop tile even while the shop is off', tiles.some((t) => /Shop/.test(t)), tiles.join(' | '));
        await p3.close();
    }

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} failing` : '\nall passing');
    process.exit(failures ? 1 : 0);
})();
