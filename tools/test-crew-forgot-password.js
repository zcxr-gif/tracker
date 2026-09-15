/*
 * tools/test-crew-forgot-password.js — `npm run test:forgot`
 *
 * GETTING BACK IN WITHOUT ASKING A HUMAN.
 *
 * A pilot who forgot their password had exactly one route: message the
 * airline, and wait for whoever next opened the dashboard to find them, issue
 * a temporary password, copy the message and send it. It is the commonest
 * piece of admin a VA does and the slowest thing that happens to a pilot.
 *
 * The thing that makes this hard to build honestly is that the obvious answer
 * — email a reset link — does nothing for most VAs: email is a
 * bring-your-own-provider setting that is off by default, and a pilot only has
 * an address on file if they gave one. So there are three ways back, the
 * server picks whichever this airline can support, and THIS PAGE IS NOT TOLD
 * WHICH. That last part is the property most worth a test: a page that says
 * "check your email" for one username and "we have told your staff" for
 * another is a page that tells a stranger which usernames exist.
 *
 * No framework and no database: `node tools/test-crew-forgot-password.js`,
 * exits non-zero on a failure, needs nothing running.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, p === '/' ? '/crew.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(''); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

const TAILWIND = fs.readFileSync(path.join(__dirname, 'crew-tailwind.css'), 'utf8');

let state = null;
const freshState = () => ({
    discordLogin: false,
    resetsSupported: true,      // the VA's database knows about resets
    asked: [],                  // every POST /forgot-password body
    token: 'good-token',
    tokenSpent: false,
    newPasswords: [],           // every POST /password-reset/<token> body
    requests: [],               // what staff see under Logins
    acted: [],                  // every POST /password-requests/<id>
});

function api(route) {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });

    if (p.includes('/api/va-ads/by-slug/')) {
        return json({ name: 'Test VA', code: 'TST', accent: '#1d4ed8', discordLogin: state.discordLogin });
    }
    if (p.endsWith('/forgot-password') && method === 'POST') {
        state.asked.push(route.request().postDataJSON() || {});
        if (!state.resetsSupported) return json({ error: 'not found' }, 404);
        /* THE WHOLE POINT. The server answers the same for an account that
           exists, one that does not, one with an email address and one
           without — so there is nothing here for the page to leak. */
        return json({ ok: true });
    }
    if (/\/password-reset\//.test(p) && method === 'GET') {
        const t = decodeURIComponent(p.split('/password-reset/')[1] || '');
        if (t !== state.token || state.tokenSpent) return json({ error: 'That link has been used already, or it has expired. Ask for another one.' }, 410);
        return json({ ok: true, name: 'Sam Reyes' });
    }
    if (/\/password-reset\//.test(p) && method === 'POST') {
        const t = decodeURIComponent(p.split('/password-reset/')[1] || '');
        state.newPasswords.push({ token: t, ...(route.request().postDataJSON() || {}) });
        if (t !== state.token || state.tokenSpent) return json({ error: 'That link has been used already.' }, 410);
        state.tokenSpent = true;                 // single use, as the real one is
        return json({ ok: true, username: 'sreyes' });
    }
    if (p.endsWith('/password-requests') && method === 'GET') {
        if (!state.resetsSupported) return json({ error: 'not found' }, 404);
        return json({ requests: state.requests });
    }
    if (/\/password-requests\//.test(p) && method === 'POST') {
        const id = decodeURIComponent(p.split('/password-requests/')[1] || '');
        const body = route.request().postDataJSON() || {};
        state.acted.push({ id, ...body });
        if (body.action === 'dismiss') return json({ ok: true });
        return json({ request: { id, name: 'Sam Reyes', username: 'sreyes', password: 'TST-9K4Z',
            message: 'Your new password is TST-9K4Z', emailed: false } });
    }
    if (p.endsWith('/me')) return json({ role: 'owner', caps: [], capabilities: [], staffRoles: [], staffAssignments: [], rolePresets: [] });
    if (p.endsWith('/branding')) return json({ name: 'Test VA', code: 'TST' });
    if (p.endsWith('/applications')) return json({ applications: [] });
    if (p.endsWith('/roster')) return json({ roster: [] });
    if (p.endsWith('/stats')) return json({ ok: true, connected: true, stats: {} });
    return json({});
}

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { console.log('  ✓ ' + n); pass++; } else { console.log(`  ✗ ${n}${x !== undefined ? '  (' + x + ')' : ''}`); fail++; } };

(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });

    const open = async (qs = '', file = 'crew.html') => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
        const page = await ctx.newPage();
        const errs = []; page.on('pageerror', e => errs.push(String(e)));
        await page.route('**/api/**', api);
        await page.route(/cdn\.tailwindcss\.com/, r => r.fulfill({
            contentType: 'application/javascript',
            body: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(TAILWIND)};document.head.appendChild(s);});window.tailwind={config:{}};`,
        }));
        await page.route(/unpkg\.com/, r => r.fulfill({ contentType: 'application/javascript', body: 'window.lucide={createIcons:function(){}};' }));
        await page.route(/fonts\.googleapis\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));
        await page.addInitScript(() => {
            localStorage.setItem('crew:session:testva', JSON.stringify({ token: 'tok', name: 'Owner', role: 'owner' }));
            localStorage.setItem('crew:tour:staff:testva', '99');
        });
        await page.goto(`http://127.0.0.1:${port}/${file}?va=testva${qs}`);
        await page.waitForTimeout(1200);
        return { ctx, page, errs };
    };

    // Whichever look is on, only one pane is on screen at a time.
    const shown = (page, sel) => page.$$eval(sel, els => els.some(e => !e.classList.contains('hidden')));
    // The roster drawer slides in from off-screen and Playwright rightly
    // refuses to click something outside the viewport. These are our own
    // buttons inside our own drawer; what is under test is what they DO.
    const press = (page, sel) => page.$eval(sel, el => el.click());

    /* ==================================================================
     * 1. ASKING
     * ================================================================ */
    console.log('\nAsking for a way back in');
    state = freshState();
    let { ctx, page, errs } = await open();

    ok('the sign-in card offers a way out of a forgotten password',
        await shown(page, '.forgotLink'));
    ok('…and does not start on it', await shown(page, '.authForm') && !(await shown(page, '.forgotForm')));

    await page.click('.forgotLink:visible');
    await page.waitForTimeout(250);
    ok('pressing it swaps the card over', await shown(page, '.forgotForm'));
    ok('…and takes the sign-in form away rather than stacking two',
        !(await shown(page, '.authForm')));

    await page.fill('.forgotForm:visible [name="who"]', 'sreyes');
    await page.click('.forgotForm:visible .forgotBtn');
    await page.waitForTimeout(600);
    ok('it asks the server, with what they typed',
        state.asked.length === 1 && state.asked[0].who === 'sreyes', JSON.stringify(state.asked));
    const saidForReal = (await page.textContent('.forgotForm:visible .forgotNote')).trim();
    ok('…and says what happens next', /on its way/i.test(saidForReal), saidForReal);
    ok('…covering every way it could arrive, because it is not told which',
        /inbox/i.test(saidForReal) && /staff/i.test(saidForReal), saidForReal);
    ok('…and clears the box, so a second press is deliberate',
        (await page.inputValue('.forgotForm:visible [name="who"]')) === '');

    /* THE PROPERTY THIS WHOLE DESIGN RESTS ON.
     * A different answer for a username that exists is an oracle for which
     * usernames exist. The server gives one answer; the page must not add a
     * second one by being clever about the first. */
    await page.fill('.forgotForm:visible [name="who"]', 'nobody-at-all');
    await page.click('.forgotForm:visible .forgotBtn');
    await page.waitForTimeout(600);
    const saidForNobody = (await page.textContent('.forgotForm:visible .forgotNote')).trim();
    ok('an account that does not exist is told exactly the same thing',
        saidForNobody === saidForReal, `${saidForNobody}\n vs \n${saidForReal}`);

    await page.click('.forgotForm:visible .backLink');
    await page.waitForTimeout(250);
    ok('there is a way back to signing in', await shown(page, '.authForm') && !(await shown(page, '.forgotForm')));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();

    /* A crew centre whose database predates resets is the ONE case that gets
     * its own words, because it is the difference between waiting for an email
     * that is coming and waiting for one that is not. */
    console.log('\nWhen the crew centre cannot do resets yet');
    state = freshState(); state.resetsSupported = false;
    ({ ctx, page, errs } = await open());
    await page.click('.forgotLink:visible');
    await page.fill('.forgotForm:visible [name="who"]', 'sreyes');
    await page.click('.forgotForm:visible .forgotBtn');
    await page.waitForTimeout(600);
    const said404 = (await page.textContent('.forgotForm:visible .forgotNote')).trim();
    ok('it says so rather than promising an email that is not coming',
        /needs updating/i.test(said404) && !/on its way/i.test(said404), said404);
    ok('…and says what to do instead', /staff/i.test(said404), said404);
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();

    /* Discord is a reset nobody has to issue — but WHO has linked it is not
     * this page's to give away, so it is said to everybody or to nobody. */
    console.log('\nWhere Discord is on offer');
    state = freshState(); state.discordLogin = true;
    ({ ctx, page, errs } = await open());
    await page.click('.forgotLink:visible');
    await page.waitForTimeout(250);
    ok('the panel points at the door that needs no reset at all',
        await shown(page, '.forgotDiscord'));
    await ctx.close();

    state = freshState(); state.discordLogin = false;
    ({ ctx, page, errs } = await open());
    await page.click('.forgotLink:visible');
    await page.waitForTimeout(250);
    ok('…and says nothing about it where the VA does not offer it',
        !(await shown(page, '.forgotDiscord')));
    await ctx.close();

    /* ==================================================================
     * 2. THE OTHER END OF THE LINK
     * ================================================================ */
    console.log('\nChoosing a new one');
    state = freshState();
    ({ ctx, page, errs } = await open('&reset=good-token'));
    ok('a reset link opens the choose-a-password pane', await shown(page, '.resetForm'));
    ok('…on the airline’s own sign-in page, not a bare one',
        (await page.textContent('.brand-name')).includes('Test VA'));
    ok('…and names who it is for',
        /Sam Reyes/.test(await page.textContent('.resetForm:visible .resetWho')));

    await page.fill('.resetForm:visible [name="newPassword"]', 'correct horse');
    await page.fill('.resetForm:visible [name="confirm"]', 'correct hose');
    await page.click('.resetForm:visible .resetBtn');
    await page.waitForTimeout(400);
    ok('two that do not match are refused here, not at the server',
        state.newPasswords.length === 0
        && /do not match/i.test(await page.textContent('.resetForm:visible .resetNote')));

    await page.fill('.resetForm:visible [name="newPassword"]', 'short');
    await page.fill('.resetForm:visible [name="confirm"]', 'short');
    await page.click('.resetForm:visible .resetBtn');
    await page.waitForTimeout(400);
    ok('…and so is one too short to be worth having',
        state.newPasswords.length === 0,
        JSON.stringify(state.newPasswords));

    await page.fill('.resetForm:visible [name="newPassword"]', 'correct horse battery');
    await page.fill('.resetForm:visible [name="confirm"]', 'correct horse battery');
    await page.click('.resetForm:visible .resetBtn');
    await page.waitForTimeout(700);
    ok('a good one is sent with the token from the link',
        state.newPasswords.length === 1 && state.newPasswords[0].token === 'good-token'
        && state.newPasswords[0].newPassword === 'correct horse battery', JSON.stringify(state.newPasswords));
    ok('…and lands back on signing in', await shown(page, '.authForm') && !(await shown(page, '.resetForm')));
    ok('…with the username already in the box',
        (await page.inputValue('.authForm:visible [name="username"]')) === 'sreyes');
    ok('…and a line saying it worked',
        /your password now/i.test(await page.textContent('.authForm:visible .authNote')));
    // A spent token in the address bar turns a refresh into "that link has
    // been used", which is a lie about what just happened.
    ok('…and the spent token out of the address bar',
        !(await page.evaluate(() => location.search)).includes('reset='),
        await page.evaluate(() => location.search));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();

    console.log('\nA link that has been used already');
    state = freshState(); state.tokenSpent = true;
    ({ ctx, page, errs } = await open('&reset=good-token'));
    ok('does not offer a form that cannot work', !(await shown(page, '.resetForm')));
    ok('…and says so on the sign-in card, which is where they are going anyway',
        await shown(page, '.authForm')
        && /used already|expired/i.test(await page.textContent('.authForm:visible .authNote')));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();

    /* The markup is duplicated across the two looks — that is how every
     * control on this page spans them, because they share class names and not
     * one style. Duplicated markup drifts, so both looks are opened. */
    console.log('\nThe other look');
    state = freshState();
    ({ ctx, page, errs } = await open('&look=split'));
    ok('the split look offers it too', await shown(page, '.forgotLink'));
    await page.click('.forgotLink:visible');
    await page.waitForTimeout(250);
    ok('…and swaps the same way', await shown(page, '.forgotForm') && !(await shown(page, '.authForm')));
    await page.fill('.forgotForm:visible [name="who"]', 'sreyes');
    await page.click('.forgotForm:visible .forgotBtn');
    await page.waitForTimeout(600);
    ok('…and asks the same server the same thing',
        state.asked.length === 1 && state.asked[0].who === 'sreyes', JSON.stringify(state.asked));
    await ctx.close();

    state = freshState();
    ({ ctx, page, errs } = await open('&look=split&reset=good-token'));
    ok('…and takes a reset link', await shown(page, '.resetForm')
        && /Sam Reyes/.test(await page.textContent('.resetForm:visible .resetWho')));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();

    /* ==================================================================
     * 3. THE HALF THAT STILL REACHES STAFF
     * ================================================================ */
    console.log('\nWhat lands in the crew centre');
    state = freshState();
    state.requests = [{ id: 'rq1', name: 'Sam Reyes', username: 'sreyes', email: '', askedAt: new Date(Date.now() - 4 * 60000).toISOString() }];
    ({ ctx, page, errs } = await open('', 'crew-dashboard.html'));
    await page.evaluate(() => { openRoster(); switchRosterView('invites'); });
    await page.waitForTimeout(900);

    const card = await page.textContent('[data-reset="rq1"]');
    ok('a pilot who asked is waiting where logins are handed over', !!card, card);
    ok('…named, and marked as what it is', /Sam Reyes/.test(card) && /Forgot password/i.test(card), card);
    ok('…with how long they have been waiting', /4 min ago/.test(card), card);
    ok('…and why it reached a human at all', /no email on file/i.test(card), card);
    ok('the tab says something is waiting',
        (await page.textContent('#invitesBadge')) === '1');

    await press(page, '[data-reset="rq1"] [data-reset-issue]');
    await page.waitForTimeout(700);
    ok('one press issues it',
        state.acted.length === 1 && state.acted[0].action === 'issue', JSON.stringify(state.acted));
    const issued = await page.textContent('[data-reset="rq1"]');
    ok('…and the password comes back to be passed on', /Copy message/i.test(issued), issued);
    ok('…hidden until it is asked for',
        (await page.textContent('[data-reset="rq1"] [data-pw]')).startsWith('•'));
    await press(page, '[data-reset="rq1"] [data-reset-reveal]');
    await page.waitForTimeout(200);
    ok('…and readable when it is',
        (await page.textContent('[data-reset="rq1"] [data-pw]')) === 'TST-9K4Z');
    ok('…and the badge stops counting one that has been dealt with',
        (await page.textContent('#invitesBadge')) === '' || await page.$eval('#invitesBadge', el => el.classList.contains('hidden')));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();

    console.log('\nDismissing one');
    state = freshState();
    state.requests = [{ id: 'rq1', name: 'Sam Reyes', username: 'sreyes', askedAt: new Date().toISOString() }];
    ({ ctx, page, errs } = await open('', 'crew-dashboard.html'));
    await page.evaluate(() => { openRoster(); switchRosterView('invites'); });
    await page.waitForTimeout(900);
    await press(page, '[data-reset="rq1"] [data-reset-dismiss]');
    await page.waitForTimeout(400);
    // The dashboard asks with its own dialog rather than the browser's.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(b => /dismiss it/i.test(b.textContent || ''));
        if (btn) btn.click();
    });
    await page.waitForTimeout(700);
    ok('dismissing says so, and says it is a dismissal',
        state.acted.length === 1 && state.acted[0].action === 'dismiss', JSON.stringify(state.acted));
    ok('…and the card goes', !(await page.$('[data-reset="rq1"]')));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();

    /* A crew centre on an older database has one fewer thing in the tab — not
     * an error where the list should be. */
    console.log('\nA dashboard whose database predates all this');
    state = freshState(); state.resetsSupported = false;
    ({ ctx, page, errs } = await open('', 'crew-dashboard.html'));
    await page.evaluate(() => { openRoster(); switchRosterView('invites'); });
    await page.waitForTimeout(900);
    const list = await page.textContent('#invitesList');
    ok('says the tab is empty rather than that something broke',
        /Nothing waiting/i.test(list) && !/error|didn’t work/i.test(list), list.trim().slice(0, 140));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await ctx.close();

    console.log(`\n${pass} passed, ${fail} failed`);
    await browser.close(); server.close();
    process.exit(fail ? 1 : 0);
})();
