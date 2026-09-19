// test-crew-quizzes.js
// Drives the REAL crew-dashboard.html and crew-pilot.html to prove the four
// things the quizzes claim:
//
//   * Recruitment is its own place. Joining moved out of Settings, and the
//     quiz builder, the queue and the reminders are in there with it.
//   * a quiz saves what the screen says it says — the right answer included,
//     and only to the server
//   * a pilot held at the door cannot get past it by reloading, gets the
//     airline's own words, and is through the moment the server says they
//     passed
//   * the paper is marked BY THE SERVER: nothing the page received ever
//     carried a right answer, and what it posts is positional
//
// Run:  node tools/test-crew-quizzes.js
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

// The airline's own quizzes, as the server would hand them back. The staff
// copy carries `correct`; the pilot's must not, and that is checked below.
const QUIZ = {
    id: 'sop', title: 'SOP induction', blurb: 'Read before your first flight.', banner: '',
    passMark: 60, maxAttempts: 3, open: false, active: true, ready: true, questionCount: 2,
    questions: [
        { id: 'q1', text: 'Cruise altitude is given in?', options: ['Feet', 'Metres'], correct: 0 },
        { id: 'q2', text: 'Who files the PIREP?', options: ['The pilot', 'Nobody'], correct: 0 },
    ],
};
const stripKey = (q) => ({ ...q, questions: q.questions.map(({ correct, ...rest }) => rest) });

let saved = [];         // POST /quizzes bodies
let sent = [];          // POST /quiz-attempts bodies
let handedIn = [];      // POST /quiz/:token bodies
let servedToPilot = []; // every payload the pilot's page was given
let gate = { enabled: true, locked: true, quizId: 'sop', quizTitle: 'SOP induction',
    message: 'Welcome aboard. Sit the induction and the crew centre opens.',
    allowSelfStart: false, token: 'tok123', status: 'issued', canStart: true, attemptsLeft: 3 };

function api(route, { staff }) {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.endsWith('/quizzes') && method === 'POST') {
        saved.push(route.request().postDataJSON() || {});
        return json({ quizzes: [QUIZ], banners: { apply: '', quiz: '' }, gateConfig: {}, reminders: {} });
    }
    if (p.endsWith('/quizzes') && method === 'GET') {
        return json({
            quizzes: [staff ? QUIZ : stripKey(QUIZ)],
            banners: { apply: '', quiz: '' },
            gate: staff ? { enabled: true, locked: false } : gate,
            gateConfig: staff ? { enabled: true, quizId: 'sop', message: '', allowSelfStart: false } : null,
            reminders: staff ? { enabled: false, everyHours: 24, afterHours: 24,
                applications: true, staffApplications: true, quizzes: true } : null,
            canBuild: staff, canReview: staff, canManage: staff, supported: true, isStaff: staff,
            mine: staff ? [] : [{ id: 'a1', quizId: 'sop', quizTitle: 'SOP induction', status: 'issued',
                token: 'tok123', score: 0, total: 0, passMark: 60, percent: 0,
                attemptsUsed: 0, maxAttempts: 3, createdAt: new Date().toISOString() }],
            outstanding: 1,
        });
    }
    if (p.endsWith('/quiz-attempts') && method === 'POST') {
        sent.push(route.request().postDataJSON() || {});
        return json({ attempt: { id: 'a2', quizId: 'sop', status: 'issued' }, link: 'https://example.test/crew/tva?quiz=tok999' }, 201);
    }
    if (p.endsWith('/quiz-attempts') && method === 'GET') {
        return json({ attempts: [{ id: 'a1', quizId: 'sop', quizTitle: 'SOP induction', pilotName: 'Rae Okafor',
            callsign: 'TVA101', status: 'issued', gate: true, score: 0, total: 0, passMark: 60, percent: 0,
            attemptsUsed: 0, maxAttempts: 3, createdAt: new Date().toISOString(),
            link: 'https://example.test/crew/tva?quiz=tok123' }] });
    }
    if (/\/quiz\/[^/]+$/.test(p) && method === 'GET') {
        const paper = { quiz: stripKey(QUIZ), banner: '', refusal: '',
            attempt: { id: 'a1', status: 'started', maxAttempts: 3, attemptsUsed: 0, token: 'tok123' } };
        if (!staff) servedToPilot.push(paper);
        return json(paper);
    }
    if (/\/quiz\/[^/]+$/.test(p) && method === 'POST') {
        const body = route.request().postDataJSON() || {};
        handedIn.push(body);
        // Marked here, as the server does. The page is told a result, never
        // given the means to work one out.
        const right = (body.answers || []).filter((a, i) => a === QUIZ.questions[i].correct).length;
        const percent = Math.floor((right / QUIZ.questions.length) * 100);
        const passed = percent >= QUIZ.passMark;
        if (passed) gate = { ...gate, locked: false, status: 'passed', canStart: false };
        return json({ attempt: { id: 'a1', status: passed ? 'passed' : 'failed' },
            score: right, total: QUIZ.questions.length, percent, passed, passMark: QUIZ.passMark,
            attemptsLeft: passed ? 0 : 2, gate });
    }
    if (p.endsWith('/staff-reminders/preview')) return json({ lines: ['**2** membership applications waiting — the oldest for 3 days.'], skipped: '', rules: {} });
    if (p.endsWith('/roster')) return json({ roster: [{ id: 'm1', name: 'Rae Okafor', callsign: 'TVA101' }] });
    if (p.endsWith('/me')) {
        return json(staff
            ? { role: 'owner', caps: [], capabilities: [], name: 'Owner', quizGate: { enabled: true, locked: false } }
            : { role: 'pilot', caps: [], capabilities: [], name: 'Rae Okafor',
                mustChangePassword: false, canChangePassword: true,
                terms: { applies: false, accepted: true }, quizGate: gate });
    }
    if (p.endsWith('/branding')) return json({ name: 'Test VA', code: 'TVA', layout: 'editorial', allowedLayouts: ['editorial'] });
    if (p.endsWith('/announcements')) return json({ announcements: [], canManage: true });
    if (p.endsWith('/me/pilot')) return json({ pilot: null, linkable: false });
    if (p.endsWith('/schedules')) return json({ schedules: [], mine: [], canManage: true, rules: { enabled: true }, ranks: [] });
    if (p.endsWith('/events')) return json({ events: [], canManage: true, mine: [], ranks: [] });
    if (p.endsWith('/staff-openings')) return json({ openings: [], banner: '', canHire: false, supported: true, mine: [], hours: 0 });
    return json({});
}

// A click through the DOM rather than Playwright's own.
//
// These controls live inside a `position:fixed` drawer that is translated into
// place, and Chromium reports them as "outside of the viewport" to the
// automation click even while they are plainly on screen and hittable. The
// event this dispatches is the one the page's own delegated handlers listen
// for, which is what is being tested.
const clickIn = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error('nothing matched ' + s);
    el.click();
}, sel);

let errors = [];
let pass = 0; let fail = 0;
const ok = (name, cond, extra) => {
    if (cond) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${extra ? `  (${extra})` : ''}`); fail++; }
};
const head = (s) => console.log(`\n${s}`);

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    const open = async (page_, { staff }) => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
        await ctx.addInitScript(([slug, who]) => {
            localStorage.setItem('crew:session:' + slug, JSON.stringify({
                token: 'test-token', role: who, name: who === 'owner' ? 'Owner' : 'Rae Okafor', slug,
            }));
        }, ['tva', staff ? 'owner' : 'pilot']);
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
        await page.route('**/api/**', (r) => api(r, { staff }));
        await page.goto(`http://127.0.0.1:${port}/${page_}?va=tva`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        return { ctx, page };
    };

    // ------------------------------------------------------------------
    head('Recruitment is its own place');

    const { ctx: sctx, page } = await open('crew-dashboard.html', { staff: true });

    const tileLabels = await page.$$eval('#toolGrid .font-semibold', (els) => els.map((e) => e.textContent.trim()));
    ok('there is a Recruitment tile', tileLabels.includes('Recruitment'), tileLabels.join('/'));

    await page.evaluate(() => window.openRecruit());
    await page.waitForTimeout(500);
    ok('the drawer opens', await page.evaluate(() => !document.getElementById('recruit').classList.contains('hidden')));
    ok('joining lives in it', await page.evaluate(() => !!document.querySelector('#recruit #joinDiscord')));

    const rtabs = await page.$$eval('#recruitTabs .recruit-tab:not(.hidden)', (els) => els.map((e) => e.textContent.trim()));
    ok('…with the quizzes beside it', rtabs.join(',') === 'Joining,Quizzes,Sent,Nudges', rtabs.join(','));

    // ------------------------------------------------------------------
    head('Building a quiz');

    await page.evaluate(() => window.setRecruitCat('quizzes'));
    await page.waitForTimeout(400);
    ok('the airline’s quiz is listed', (await page.textContent('#quizBuildHost')).includes('SOP induction'));
    ok('…and so is the door', (await page.textContent('#quizBuildHost')).includes('Keep the crew centre shut'));

    await clickIn(page, '[data-qa-edit="sop"]');
    await page.waitForTimeout(250);
    const checkedIsFirst = await page.evaluate(() => {
        const q = document.querySelector('#quizBuildHost [data-qa-qi="0"]');
        return [...q.querySelectorAll('[data-qa-correct]')].findIndex((r) => r.checked);
    });
    ok('the right answer is the one the server sent', checkedIsFirst === 0, String(checkedIsFirst));

    // Change the right answer to the second option and save.
    await page.evaluate(() => {
        const q = document.querySelector('#quizBuildHost [data-qa-qi="0"]');
        const radios = q.querySelectorAll('[data-qa-correct]');
        radios[1].checked = true;
    });
    await clickIn(page, '[data-qa-save]');
    await page.waitForTimeout(500);
    const body = saved[0] || {};
    ok('a save posts the quizzes', Array.isArray(body.quizzes) && body.quizzes.length === 1);
    ok('…carrying the answer key the screen shows', body.quizzes && body.quizzes[0].questions[0].correct === 1,
        JSON.stringify(body.quizzes && body.quizzes[0].questions[0]));
    ok('…and the door with it', !!body.gate, JSON.stringify(body.gate || null));

    // ------------------------------------------------------------------
    head('Sending one out');

    await page.evaluate(() => window.setRecruitCat('sent'));
    await page.waitForTimeout(400);
    ok('the queue lists who has one', (await page.textContent('#quizSentHost')).includes('Rae Okafor'));
    await page.evaluate(() => {
        const sel = document.querySelector('[data-qa-sendwho]');
        sel.value = 'm1';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await clickIn(page, '[data-qa-send]');
    await page.waitForTimeout(500);
    ok('sending names the pilot and the quiz', sent[0] && sent[0].memberId === 'm1' && sent[0].quizId === 'sop',
        JSON.stringify(sent[0] || null));

    await sctx.close();

    // ------------------------------------------------------------------
    head('A pilot at the door');

    const { ctx: pctx, page: pilot } = await open('crew-pilot.html', { staff: false });
    await pilot.waitForTimeout(600);

    ok('the crew centre is covered', await pilot.evaluate(() => !!document.querySelector('.qz-lock')));
    ok('…in the airline’s own words',
        (await pilot.textContent('.qz-lock')).includes('Sit the induction'));
    ok('…and the page underneath cannot be scrolled', await pilot.evaluate(() => document.body.style.overflow === 'hidden'));

    // A reload must not get anybody past it: the state comes back from /me.
    await pilot.reload({ waitUntil: 'domcontentloaded' });
    await pilot.waitForTimeout(1200);
    ok('a reload does not open it', await pilot.evaluate(() => !!document.querySelector('.qz-lock')));

    // ------------------------------------------------------------------
    head('Sitting the paper');

    await clickIn(pilot, '[data-qz-gate-open]');
    await pilot.waitForTimeout(700);
    const paper = await pilot.textContent('#crewQuiz');
    ok('the questions are on screen', paper.includes('Cruise altitude is given in?'));
    // The half this whole feature rests on: nothing the pilot's page was ever
    // handed carried a right answer, and nothing on screen marks one.
    ok('the answer key is not', servedToPilot.length > 0
        && !JSON.stringify(servedToPilot).includes('"correct"'));
    ok('…and nothing on screen marks the right option',
        !(await pilot.innerHTML('#crewQuiz')).includes('qz-right'));

    // Answer the second one only, and hand it in — a blank must count as wrong.
    await clickIn(pilot, '#crewQuiz [data-qz-pick="1"][value="0"]');
    await pilot.waitForTimeout(200);
    await clickIn(pilot, '[data-qz-send]');
    await pilot.waitForTimeout(300);
    // It asks before handing in a half-finished paper.
    const asked = await pilot.evaluate(() => !!document.querySelector('.cp-ask'));
    ok('it warns about the blank one', asked);
    if (asked) { await clickIn(pilot, '.cp-ask [data-ok], .cp-ask .cp-btn-primary'); await pilot.waitForTimeout(600); }

    ok('what is posted is positional, with -1 for the blank',
        handedIn[0] && JSON.stringify(handedIn[0].answers) === '[-1,0]', JSON.stringify(handedIn[0] || null));
    ok('the pilot is told the score', (await pilot.textContent('#crewQuiz')).includes('50%'));
    ok('…and is still held, because 50% is not 60%', await pilot.evaluate(() => !!document.querySelector('.qz-lock')));

    // Now pass it.
    await clickIn(pilot, '[data-qz-again]');
    await pilot.waitForTimeout(700);
    await clickIn(pilot, '#crewQuiz [data-qz-pick="0"][value="0"]');
    await clickIn(pilot, '#crewQuiz [data-qz-pick="1"][value="0"]');
    await pilot.waitForTimeout(200);
    await clickIn(pilot, '[data-qz-send]');
    await pilot.waitForTimeout(800);
    ok('a pass is reported', (await pilot.textContent('#crewQuiz')).includes('That’s a pass'));
    ok('…and the door lifts without a reload', await pilot.evaluate(() => !document.querySelector('.qz-lock')));
    ok('…and the page scrolls again', await pilot.evaluate(() => document.body.style.overflow !== 'hidden'));

    head('Nothing threw on the way');
    ok('no page errors', errors.length === 0, errors.join(' | '));

    await pctx.close();
    await browser.close();
    server.close();

    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})();
