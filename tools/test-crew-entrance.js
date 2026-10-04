/* test-crew-entrance.js — the public entrance test page (crew-test.html), in Chromium.
 *
 * What it defends:
 *   · the paper opens from the link alone — no session, no sign-in
 *   · nothing on the page is an answer key (the server never sends one; this
 *     checks the page does not invent a "correct" marker either)
 *   · every question must be answered before it is handed in
 *   · the answers go back positionally — the index picked for each question
 *   · a failed paper shows the score, when the next go is, and the study
 *     material, with only https links made clickable
 *
 * Needs: playwright-core, and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
 *        pre-installed /opt/pw-browsers/chromium). Skips cleanly without one.
 *
 * Run:  node tools/test-crew-entrance.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { console.log('skip — playwright-core is not installed'); process.exit(0); }
const exePath = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
if (!fs.existsSync(exePath)) { console.log('skip — no Chromium'); process.exit(0); }

let pass = 0; const fails = [];
const check = (what, ok, saw) => { if (ok) pass++; else fails.push(what + (saw === undefined ? '' : `  (saw ${JSON.stringify(saw)})`)); };

const ROOT = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (/^\/crew\/[^/]+\/test$/.test(p)) p = '/crew-test.html';      // the _redirects rule
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
    fs.createReadStream(f).pipe(res);
});

const QUIZ = { id: 'e', title: 'Entrance Test', blurb: 'We are thrilled to have you join our flight deck.', passMark: 80, maxAttempts: 0, retakeHours: 24,
    questions: [
        { id: 'q1', text: 'What does PIREP stand for?', options: ['Pilot report', 'Pilot repair'] },
        { id: 'q2', text: 'Cruise altitude is given in?', options: ['Metres', 'Feet'] },
    ] };
const VA = { name: 'Aeroméxico Virtual', accent: '#0b2340', logo: '' };
const TOKEN = 'a'.repeat(32);

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const browser = await chromium.launch({ executablePath: exePath });
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // The CDNs are not what this is about.
    await page.route('**/cdn.tailwindcss.com**', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.tailwind={config:{}};' }));
    await page.route('**/unpkg.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body: 'window.lucide={createIcons(){}};' }));
    let sentAuth = 'unset';
    let posted = null;
    await page.route('**/api/crew/am/test/**', async (route) => {
        const req = route.request();
        sentAuth = req.headers().authorization || '';
        if (req.method() === 'GET') {
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ va: VA, banner: '', quiz: QUIZ,
                attempt: { name: 'Rae_Okafor', status: 'started', score: 0, total: 0, percent: 0, passMark: 80, attemptsUsed: 0, maxAttempts: 0 },
                refusal: '', retryAt: null, study: '' }) });
        }
        posted = req.postDataJSON();
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ va: VA, quiz: QUIZ,
            attempt: { name: 'Rae_Okafor', status: 'failed', score: 1, total: 2, percent: 50, passMark: 80, attemptsUsed: 1, maxAttempts: 0 },
            refusal: 'You can take it again in 24 hours.', retryAt: new Date(Date.now() + 864e5).toISOString(),
            study: 'Read the SOP: https://example.com/sop and not javascript:alert(1)', passed: false, percent: 50 }) });
    });

    await page.goto(`http://127.0.0.1:${server.address().port}/crew/am/test?t=${TOKEN}`);
    await page.waitForSelector('#paper');
    check('the paper opens from the link, with no session sent', sentAuth === '', sentAuth);
    check('it greets the person it was sent to', /Welcome, Rae_Okafor/.test(await page.textContent('#body')));
    check('every question and option is drawn', await page.locator('fieldset[data-q]').count() === 2 && await page.locator('.opt').count() === 4);
    check('nothing on the page marks a right answer', !/correct/i.test(await page.content().then((h) => h.replace(/<script[\s\S]*?<\/script>/g, ''))));

    await page.click('#submitBtn');
    check('an unanswered paper is not handed in', posted === null && /2 still to go/.test(await page.textContent('#note')));
    await page.check('input[name="q0"][value="0"]');
    await page.check('input[name="q1"][value="0"]');
    await page.click('#submitBtn');
    await page.waitForSelector('text=Not this time');
    check('the answers go back by position', posted && JSON.stringify(posted.answers) === '[0,0]', posted);
    const body = await page.textContent('#body');
    check('the score is shown', /50%/.test(body));
    check('…with when the next go is', /Next attempt:/.test(body));
    check('…and the study material', /Read the SOP/.test(body));
    check('only https links are made clickable', await page.locator('#body a[href="https://example.com/sop"]').count() === 1
        && await page.locator('#body a[href^="javascript"]').count() === 0);
    check('no script errors', errors.length === 0, errors);

    const bad = await browser.newPage();
    await bad.route('**/cdn.tailwindcss.com**', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
    await bad.route('**/unpkg.com/**', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
    await bad.goto(`http://127.0.0.1:${server.address().port}/crew/am/test`);
    await bad.waitForTimeout(300);
    check('a link with no token says so', /incomplete/.test(await bad.textContent('#body')));

    await browser.close(); server.close();
    console.log(`${pass} passed, ${fails.length} failed`);
    if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
})().catch((err) => { console.error(err); process.exit(1); });
