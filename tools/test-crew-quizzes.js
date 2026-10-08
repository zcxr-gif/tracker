// test-crew-quizzes.js
// Drives the REAL crew-dashboard.html and crew-pilot.html to prove the four
// things the quizzes claim:
//
//   * Recruitment is its own place. Joining moved out of Settings, and the
//     quiz builder, the queue and the reminders are in there with it.
//   * a quiz saves what the screen says it says — the right answer included,
//     and only to the server
//   * the quiz "door" is gone: a pilot with a login is never held at a quiz;
//     the one test is the entrance test, before they are accepted
//   * Applications is one road: every applicant on one step, one message to
//     paste for it, the overrides on every card — and no login switch, no
//     tests floating with nobody's application behind them
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

// The road in, as the applications list hands it to the dashboard.
const RULES = { auto: false, test: { id: 'sop', title: 'SOP induction', passMark: 60 }, viaDiscord: true, viaDiscordWanted: true, discordInvite: 'https://discord.gg/tva' };
const PENDING = [
    { _id: 'r1', ifcName: 'Ready_Rae', status: 'pending', stage: 'review', answers: [], callsign: 'TVA 101',
      test: { id: 't1', quizTitle: 'SOP induction', status: 'passed', score: 2, total: 2, percent: 100, passMark: 60, live: false },
      applicant: { message: 'IFC: with the team', plainMessage: 'with the team' } },
    { _id: 'd1', ifcName: 'Discord_Dan', status: 'pending', stage: 'discord', code: 'ABCD-1234', answers: [],
      applicant: { message: 'IFC: join https://discord.gg/tva code ABCD-1234', plainMessage: 'join code ABCD-1234' } },
    { _id: 't2', ifcName: 'Testing_Tia', status: 'pending', stage: 'test', inTicket: true, answers: [],
      test: { id: 't3', quizTitle: 'SOP induction', status: 'issued', passMark: 60, live: true, link: 'https://x/test?t=1', message: 'IFC: test link' },
      applicant: { message: 'IFC: test link', plainMessage: 'test link' } },
];
const ACCEPTED = [
    { _id: 'i1', ifcName: 'Invited_Ivy', status: 'accepted', stage: 'invited', reviewedAt: new Date().toISOString(),
      invite: { state: 'live', kind: 'link', username: 'invited.ivy', link: 'https://x/crew/tva?setup=abc', expiresAt: new Date(Date.now() + 864e6).toISOString(),
        message: 'IFC welcome https://x/crew/tva?setup=abc', plainMessage: 'welcome https://x/crew/tva?setup=abc' } },
];
let reviews = [];       // PATCH /applications/:id bodies
let sentMarks = [];     // POST /applications/:id/invite/sent

let saved = [];         // POST /quizzes bodies
let sent = [];          // POST /quiz-attempts bodies
let handedIn = [];      // POST /quiz/:token bodies
let servedToPilot = []; // every payload the pilot's page was given
// What the server says about the retired door: always open.
const gate = { enabled: false, locked: false, quizId: '', quizTitle: '', message: '', allowSelfStart: false, token: '', status: '', canStart: false, attemptsLeft: 0 };

function api(route, { staff }) {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.endsWith('/quizzes') && method === 'POST') {
        const posted = route.request().postDataJSON() || {};
        saved.push(posted);
        // Echoed back the way the server would: what it kept, and how many.
        const kept = (posted.quizzes || [QUIZ]).map((q) => {
            const qs = (q.questions || []).filter((qq) => qq.text && (qq.options || []).filter(Boolean).length >= 2);
            return { ...q, questions: qs, questionCount: qs.length, ready: q.active !== false && qs.length > 0 };
        });
        return json({ quizzes: kept, banners: { apply: '', quiz: '' }, gateConfig: {}, reminders: {} });
    }
    if (p.endsWith('/quizzes') && method === 'GET') {
        return json({
            quizzes: [staff ? QUIZ : stripKey(QUIZ)],
            banners: { apply: '', quiz: '' },
            gate,
            gateConfig: staff ? { enabled: false, quizId: '', message: '', allowSelfStart: false } : null,
            entranceQuizId: staff ? 'sop' : '',
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
        return json({ attempt: { id: 'a1', status: passed ? 'passed' : 'failed' },
            score: right, total: QUIZ.questions.length, percent, passed, passMark: QUIZ.passMark,
            attemptsLeft: passed ? 0 : 2, gate });
    }
    if (p.endsWith('/staff-reminders/preview')) return json({ lines: ['**2** membership applications waiting — the oldest for 3 days.'], skipped: '', rules: {} });
    if (p.endsWith('/applications') && method === 'GET') {
        return json({ applications: url.searchParams.get('status') === 'accepted' ? ACCEPTED : PENDING, rules: RULES, waitingTests: [] });
    }
    if (/\/applications\/[^/]+\/invite\/sent$/.test(p)) { sentMarks.push(p.split('/')[5]); return json({ invite: { ...ACCEPTED[0].invite, sentAt: new Date().toISOString(), sentBy: 'Owner' } }); }
    if (/\/applications\/[^/]+$/.test(p) && method === 'PATCH') {
        reviews.push({ id: p.split('/').pop(), body: route.request().postDataJSON() || {} });
        return json({ status: 'accepted', stage: 'invited', emailed: false, email: '', invite: { ...ACCEPTED[0].invite, username: 'ready.rae' }, account: { username: 'ready.rae', kind: 'link', created: true } });
    }
    if (p.endsWith('/entrance-tests') && method === 'GET') {
        return json({ tests: [], quizzes: [{ id: 'sop', title: 'SOP induction', passMark: 60, retakeHours: 0 }] });
    }
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
    ok('…marked as the entrance test', (await page.textContent('#quizBuildHost')).includes('Entrance test'));
    ok('…and there is no door any more', !(await page.textContent('#quizBuildHost')).includes('Keep the crew centre shut'));
    ok('…nor a way to send a test to somebody who never applied', !(await page.$('#quizBuildHost [data-qa-entrance]')));

    await clickIn(page, '[data-qa-edit="sop"]');
    await page.waitForTimeout(250);
    const checkedIsFirst = await page.evaluate(() => {
        const q = document.querySelector('#quizBuildHost [data-qa-qi="0"]');
        return [...q.querySelectorAll('[data-qa-correct]')].findIndex((r) => r.checked);
    });
    ok('the right answer is the one the server sent', checkedIsFirst === 0, String(checkedIsFirst));

    ok('there is no Save button — it saves itself', !(await page.$('#quizBuildHost [data-qa-save]')));

    // Change the right answer to the second option, and do nothing else.
    await page.evaluate(() => {
        const q = document.querySelector('#quizBuildHost [data-qa-qi="0"]');
        const radios = q.querySelectorAll('[data-qa-correct]');
        radios[1].checked = true;
        radios[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(800);
    const body = saved[saved.length - 1] || {};
    ok('ticking an answer saves the quizzes', Array.isArray(body.quizzes) && body.quizzes.length === 1, String(saved.length));
    ok('…carrying the answer key the screen shows', body.quizzes && body.quizzes[0].questions[0].correct === 1,
        JSON.stringify(body.quizzes && body.quizzes[0].questions[0]));
    ok('…and no door with it', body.gate === undefined, JSON.stringify(body.gate || null));
    ok('…and says so', /All changes saved/.test(await page.textContent('#quizBuildHost [data-qa-status]')));

    // Type a question in and walk away. Typing saves after a pause; Done used
    // to fold the editor away without reading it, throwing out what was typed.
    await clickIn(page, '[data-qa-addq]');
    await page.waitForTimeout(400);
    const typeInto = (sel, value) => page.evaluate(([s, v]) => {
        const all = document.querySelectorAll('#quizBuildHost [data-qa-qi]');
        const q = all[all.length - 1];
        const [field, i] = s.split('#');
        const el = q.querySelectorAll(field)[Number(i || 0)];
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [sel, value]);
    await typeInto('[data-qa-qtext]', 'Which runway is in use?');
    await typeInto('[data-qa-opt]#0', '27L');
    await page.waitForTimeout(1200);
    ok('a half-written question is flagged, not silently dropped',
        /question 3/.test(await page.textContent('#quizBuildHost [data-qa-status]')),
        await page.textContent('#quizBuildHost [data-qa-status]'));
    ok('…and stays on screen while it is finished',
        await page.evaluate(() => [...document.querySelectorAll('#quizBuildHost [data-qa-qtext]')].some((e) => e.value === 'Which runway is in use?')));
    await typeInto('[data-qa-opt]#1', '09R');
    await page.evaluate(() => {
        const all = document.querySelectorAll('#quizBuildHost [data-qa-qi]');
        const r = all[all.length - 1].querySelectorAll('[data-qa-correct]')[1];
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(800);
    const typedSave = (saved[saved.length - 1] || {}).quizzes || [];
    const typed = typedSave[0] && typedSave[0].questions[2];
    ok('finishing it saves it, with no button pressed', !!typed && typed.text === 'Which runway is in use?'
        && typed.options.join() === '27L,09R' && typed.correct === 1, JSON.stringify(typedSave[0] && typedSave[0].questions));

    await clickIn(page, '[data-qa-collapse]');
    await page.waitForTimeout(600);
    ok('Done keeps what was typed', (await page.textContent('#quizBuildHost')).includes('3 questions'),
        (await page.textContent('#quizBuildHost')).replace(/\s+/g, ' ').slice(0, 200));

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

    // ------------------------------------------------------------------
    head('Joining says what happens to a new pilot');

    await page.evaluate(() => window.setRecruitCat('joining'));
    await page.waitForTimeout(700);
    ok('there is no “create a login” switch', !(await page.$('#joinCreatesLogin')));
    const opts = await page.$$eval('#joinEntranceQuiz option', (os) => os.map((o) => o.textContent));
    ok('the entrance test is picked from the airline’s quizzes', opts.some((o) => /SOP induction/.test(o)) && opts[0] === 'No entrance test', opts.join('|'));
    await page.evaluate(() => {
        const sel = document.getElementById('joinEntranceQuiz'); sel.value = 'sop'; sel.dispatchEvent(new Event('change'));
        document.getElementById('joinDiscord').value = 'https://discord.gg/tva';
        const vd = document.getElementById('joinViaDiscord'); vd.checked = true; vd.dispatchEvent(new Event('change'));
    });
    await page.waitForTimeout(200);
    const road = (await page.textContent('#joinRoad')).replace(/\s+/g, ' ');
    ok('…and the road is drawn under the settings', /Apply.*Discord ticket.*Entrance test · SOP induction.*You accept.*They choose a password/.test(road), road);

    head('Applications: one road, one step each');

    await page.evaluate(() => { window.openRoster && window.openRoster(); window.switchRosterView('apps'); });
    await page.waitForTimeout(1200);
    const apps = (await page.textContent('#appsList')).replace(/\s+/g, ' ');
    ok('the road is at the top', /How people join/.test(apps) && /Discord ticket/.test(apps), apps.slice(0, 200));
    ok('ready ones first, then the ones waiting on themselves, then invited',
        apps.indexOf('Ready for you') < apps.indexOf('Waiting on them') && apps.indexOf('Waiting on them') < apps.indexOf('Invited'), apps.slice(0, 400));
    ok('a Discord applicant shows their code', /ABCD-1234/.test(apps));
    ok('there is no login switch on any card', !(await page.$('#appsList [data-mkacct]')) && !(await page.$('#appsMkacctAll')));
    ok('nobody is listed without an application', !/Passed an entrance test — not added yet/.test(apps));
    ok('every waiting card can be accepted now (override)', (await page.$$('#appsList [data-app] [data-accept]')).length === 3);
    ok('each card has one message for its step', (await page.$$('#appsList [data-app] [data-app-copy]')).length === 3);

    await clickIn(page, '#appsList [data-app="r1"] [data-accept]');
    await page.waitForTimeout(700);
    ok('accepting sends no login switch — the login is always made', reviews[0] && reviews[0].body.action === 'accept' && reviews[0].body.createAccount === undefined, JSON.stringify(reviews[0] || null));
    ok('…and offers the welcome to copy', /Copy welcome for IFC/.test(await page.textContent('#appsList [data-app="r1"]')));
    ok('an invited pilot’s card offers their link to copy', !!(await page.$('#appsList [data-invite-app="i1"] [data-invite-copy]')));

    await sctx.close();

    // ------------------------------------------------------------------
    head('A pilot is never held at a door');

    const { ctx: pctx, page: pilot } = await open('crew-pilot.html', { staff: false });
    await pilot.waitForTimeout(600);
    ok('the crew centre is open', await pilot.evaluate(() => !document.querySelector('.qz-lock')));

    // ------------------------------------------------------------------
    head('Sitting the paper');

    await pilot.evaluate(() => window.openQuizzes('tok123'));
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

    // Now pass it.
    await clickIn(pilot, '[data-qz-again]');
    await pilot.waitForTimeout(700);
    await clickIn(pilot, '#crewQuiz [data-qz-pick="0"][value="0"]');
    await clickIn(pilot, '#crewQuiz [data-qz-pick="1"][value="0"]');
    await pilot.waitForTimeout(200);
    await clickIn(pilot, '[data-qz-send]');
    await pilot.waitForTimeout(800);
    ok('a pass is reported', (await pilot.textContent('#crewQuiz')).includes('That’s a pass'));
    ok('…and nothing locks', await pilot.evaluate(() => !document.querySelector('.qz-lock')));

    head('Nothing threw on the way');
    ok('no page errors', errors.length === 0, errors.join(' | '));

    await pctx.close();
    await browser.close();
    server.close();

    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})();
