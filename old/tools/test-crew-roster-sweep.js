// test-crew-roster-sweep.js
// Drives the REAL crew-dashboard.html against a faked backend to prove the
// roster sweep's settings behave the way a feature that DELETES PILOTS has to:
//
//   * the whole block is owner-only — a staff member who can otherwise change
//     the Crew tab is not offered it at all
//   * it arrives off, with every field disabled behind the master switch
//   * the panel shows who the NEXT RUN WOULD TAKE before anything is committed,
//     read from the server's dry run rather than worked out in the browser
//   * what is typed is what is sent — days, warnings and the action per rule
//   * "Run it now" asks first when the run can delete, and does not when it can
//     only mark somebody inactive
//   * a refusal from the server is shown, not swallowed
//
// Run:  node tools/test-crew-roster-sweep.js
// Needs: playwright-core, and a Chromium at $PLAYWRIGHT_CHROMIUM (or the
//        pre-installed /opt/pw-browsers/chromium). Set PLAYWRIGHT_NO_SANDBOX=1
//        when running as root in a container.
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

const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// The shipped defaults: off, and inert.
const OFF_RULES = {
    enabled: false, firstFlight: false, firstFlightDays: 7, firstFlightAction: 'remove', firstFlightWarnDays: 2,
    inactivity: false, inactivityDays: 30, inactivityAction: 'inactive', inactivityWarnDays: 7, exemptStaff: true,
};

(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
        args: process.env.PLAYWRIGHT_NO_SANDBOX ? ['--no-sandbox'] : [],
    });

    let failures = 0;
    const check = (label, ok, extra) => {
        if (!ok) { failures++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); } else console.log('  ✓ ' + label);
    };

    /**
     * Open the dashboard as `role`, with the sweep answering `rules` / `preview`.
     * Records every settings POST so the test can assert what was sent.
     */
    const open = async ({ role = 'owner', rules = OFF_RULES, preview = null, runReply = null } = {}) => {
        const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
        const sent = [];
        const ran = [];
        // Stateful, because the panel re-reads after every save — deliberately,
        // so what it shows is what the server normalised rather than what was
        // typed. A fake that always answered the same thing would put the form
        // back to the shipped defaults after each save and prove nothing.
        let stored = { ...rules };
        page.on('pageerror', (e) => { failures++; console.log('  ✗ page error — ' + String(e).split('\n')[0]); });
        await page.route('**/api/**', (route) => {
            const u = new URL(route.request().url());
            const p = u.pathname;
            if (p.endsWith('/retention/run')) {
                ran.push(true);
                return runReply
                    ? json(route, runReply.body, runReply.status || 200)
                    : json(route, { ok: true, checked: 3, warned: [], removed: [], deactivated: [], failed: [] });
            }
            if (p.endsWith('/retention')) {
                return json(route, {
                    rules: stored,
                    preview: preview || { checked: 0, skipped: stored.enabled ? '' : 'not enabled', warned: [], removed: [], deactivated: [] },
                });
            }
            if (p.endsWith('/settings') && route.request().method() === 'POST') {
                const b = route.request().postDataJSON();
                sent.push(b);
                if (b && b.retention) stored = { ...stored, ...b.retention };
                return json(route, { ok: true });
            }
            if (p.endsWith('/me')) {
                return json(route, {
                    role,
                    // A staff member who can do everything EXCEPT own the airline.
                    caps: role === 'owner' ? ['*'] : ['settings.branding', 'schedules.manage', 'roster.manage', 'flights.review'],
                    capabilities: [], rolePresets: [], staffRoles: [], staffAssignments: [],
                });
            }
            if (p.endsWith('/roster')) return json(route, { roster: [] });
            return json(route, {});
        });
        await page.addInitScript(([r]) => localStorage.setItem('crew:session:testva',
            JSON.stringify({ token: 'tok', name: 'Owner', role: r })), [role]);
        await page.goto(`http://127.0.0.1:${port}/crew-dashboard.html?va=testva`);
        await page.waitForTimeout(1500);
        await page.evaluate(() => window.openSettings('crew'));
        await page.waitForTimeout(600);
        return { page, sent, ran };
    };

    // ---- 1. Who is offered it at all ---------------------------------------
    console.log('\nWho may reach the sweep');
    let { page } = await open({ role: 'owner' });
    check('the owner gets the block', await page.isVisible('#crewRetentionBlock'));
    await page.close();

    ({ page } = await open({ role: 'staff' }));
    // A staff member with schedules.manage reaches this same tab — and must
    // still not see a control that deletes the roster.
    check('a staff member with the rest of the Crew tab does not',
        !(await page.isVisible('#crewRetentionBlock')));
    check('…but still gets the schedule settings they do own',
        await page.isVisible('#crewScheduleBlock'));
    await page.close();

    // ---- 2. It ships off ---------------------------------------------------
    console.log('\nIt arrives switched off');
    ({ page } = await open({ role: 'owner' }));
    check('the master switch is off', !(await page.isChecked('#ret_enabled')));
    check('both rules are off', !(await page.isChecked('#ret_firstFlight')) && !(await page.isChecked('#ret_inactivity')));
    check('the fields are disabled behind it', await page.isDisabled('#ret_firstFlightDays'));
    check('“Run it now” is disabled too', await page.isDisabled('#ret_runBtn'));
    check('the preview says plainly that nothing happens',
        /sweep is off/i.test(await page.textContent('#ret_preview')), await page.textContent('#ret_preview'));

    await page.check('#ret_enabled');
    await page.waitForTimeout(200);
    check('switching it on enables the fields', !(await page.isDisabled('#ret_firstFlightDays')));
    await page.close();

    // ---- 3. The preview ----------------------------------------------------
    console.log('\nThe preview shows who the next run would take');
    ({ page } = await open({
        role: 'owner',
        rules: { ...OFF_RULES, enabled: true, firstFlight: true, inactivity: true },
        preview: {
            checked: 12, skipped: '',
            removed: [{ id: 'a', name: 'Never Flew', rule: 'first-flight' }],
            deactivated: [{ id: 'b', name: 'Gone Quiet', rule: 'inactivity' }],
            warned: [{ id: 'c', name: 'Nearly There', rule: 'inactivity', days: 3 }],
        },
    }));
    const prev = await page.textContent('#ret_preview');
    check('it names who would be deleted', /Never Flew/.test(prev), prev);
    check('…who would be marked inactive', /Gone Quiet/.test(prev));
    check('…and who would merely be warned', /Nearly There/.test(prev));
    check('it says how many were checked', /12 pilots checked/.test(prev), prev);
    await page.close();

    // A VA with nobody due must be told that, not shown an empty box.
    ({ page } = await open({
        role: 'owner',
        rules: { ...OFF_RULES, enabled: true, inactivity: true },
        preview: { checked: 40, skipped: '', removed: [], deactivated: [], warned: [] },
    }));
    check('a clean roster reads as “nobody”, not as a blank',
        /Nobody\. 40 pilots checked/.test(await page.textContent('#ret_preview')),
        await page.textContent('#ret_preview'));
    await page.close();

    // ---- 4. What is saved --------------------------------------------------
    console.log('\nWhat is typed is what is sent');
    let sent;
    ({ page, sent } = await open({ role: 'owner' }));
    await page.check('#ret_enabled');
    await page.check('#ret_firstFlight');
    await page.fill('#ret_firstFlightDays', '7');
    await page.fill('#ret_firstFlightWarnDays', '2');
    await page.selectOption('#ret_firstFlightAction', 'remove');
    await page.check('#ret_inactivity');
    await page.fill('#ret_inactivityDays', '30');
    await page.selectOption('#ret_inactivityAction', 'inactive');
    await page.click('button:has-text("Save roster sweep")');
    await page.waitForTimeout(600);

    const body = sent.find((s) => s && s.retention);
    check('the settings POST carries a retention block', !!body, JSON.stringify(sent));
    if (body) {
        const r = body.retention;
        check('the first-flight window is 7 days', r.firstFlightDays === 7, String(r.firstFlightDays));
        check('…deleting the account when it lapses', r.firstFlightAction === 'remove', r.firstFlightAction);
        check('the inactivity window is 30 days', r.inactivityDays === 30, String(r.inactivityDays));
        check('…marking rather than deleting', r.inactivityAction === 'inactive', r.inactivityAction);
        check('staff stay exempt', r.exemptStaff === true);
        check('both rules are on', r.firstFlight === true && r.inactivity === true);
    }
    // Out-of-range input is clamped before it leaves, so the screen and the
    // server agree about what was saved.
    await page.fill('#ret_firstFlightDays', '900');
    await page.click('button:has-text("Save roster sweep")');
    await page.waitForTimeout(500);
    const last = sent.filter((s) => s && s.retention).pop();
    check('a wild number is clamped on the way out', last.retention.firstFlightDays === 90, String(last.retention.firstFlightDays));
    await page.close();

    // ---- 5. Running it by hand --------------------------------------------
    console.log('\nRunning it by hand');
    let ran;
    ({ page, ran } = await open({
        role: 'owner',
        rules: { ...OFF_RULES, enabled: true, inactivity: true, inactivityAction: 'inactive' },
        runReply: { body: { ok: true, checked: 9, warned: [], removed: [], deactivated: [{ id: 'b', name: 'Gone Quiet' }], failed: [] } },
    }));
    // Marking somebody inactive is a click to undo, so it does not interrupt.
    page.on('dialog', (d) => d.dismiss());
    await page.click('#ret_runBtn');
    await page.waitForTimeout(700);
    check('a run that can only mark does not stop to ask', ran.length === 1, String(ran.length));
    check('the result is reported', /1 marked inactive/.test(await page.textContent('#ret_note')),
        await page.textContent('#ret_note'));
    await page.close();

    ({ page, ran } = await open({
        role: 'owner',
        rules: { ...OFF_RULES, enabled: true, firstFlight: true, firstFlightAction: 'remove' },
    }));
    // A run that can delete must ask, and taking "cancel" must mean cancel.
    let asked = 0;
    page.on('dialog', (d) => { asked += 1; d.dismiss(); });
    await page.click('#ret_runBtn');
    await page.waitForTimeout(600);
    check('a run that can delete asks first', asked === 1, String(asked));
    check('…and cancelling really cancels it', ran.length === 0, String(ran.length));
    await page.close();

    // ---- 6. A refusal is shown --------------------------------------------
    console.log('\nWhen the server says no');
    ({ page } = await open({
        role: 'owner',
        rules: { ...OFF_RULES, enabled: true, inactivity: true },
        runReply: { status: 400, body: { error: 'The roster sweep is switched off.' } },
    }));
    page.on('dialog', (d) => d.accept());
    await page.click('#ret_runBtn');
    await page.waitForTimeout(700);
    check('the server’s own words are shown, not swallowed',
        /switched off/.test(await page.textContent('#ret_note')), await page.textContent('#ret_note'));
    await page.close();

    await browser.close();
    server.close();
    console.log(failures ? `\n${failures} failed.\n` : '\nAll good.\n');
    process.exit(failures ? 1 : 0);
})();
