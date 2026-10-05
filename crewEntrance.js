/* ============================================================================
   crewEntrance.js — entrance tests, on the staff side.

   WHY THIS EXISTS

   VAs were running their entrance test in a Google Form: paste the link into
   an IFC message ("Welcome to …! Before you take to the virtual skies, please
   complete our Entrance Test…"), wait, open the spreadsheet, work out who
   passed, and only then go back to the crew center and accept them. Three tools
   and a spreadsheet for one question — did they pass?

   Now the test is a quiz the airline builds in Recruitment → Quizzes, and this
   is where it is sent and read:

     · on an APPLICATION card — send the test, see how they did, accept them
       (which makes their login and the welcome message) once they pass;
     · in the ENTRANCE TESTS panel — every test sent, and a form to send one to
       somebody who never applied (a pilot met on the IFC). A pass there gets
       "Add & invite", which puts them on the roster and opens their invitation.

   The taker needs no login — the link is the key (crew-test.html). The server
   marks the paper, enforces the retake wait and hands out the study material;
   nothing on this screen decides a result.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewEntrance: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText } = P;

    const S = {
        api: null,
        tests: [],          // GET /entrance-tests
        quizzes: [],        // the ready quizzes a test can be
        loaded: false,
        error: null,
        panel: null,
        onChange: null,     // the dashboard redraws its application cards
        lastSent: null,     // the test just sent from the panel, to copy
    };

    const STATE = {
        issued: ['Sent', 'cp-chip-warn'],
        started: ['Opened', 'cp-chip-accent'],
        passed: ['Passed', 'cp-chip-ok'],
        failed: ['Not passed', 'cp-chip-mute'],
        revoked: ['Withdrawn', 'cp-chip-mute'],
    };

    function styles() {
        P.baseStyles();
        P.style('crew-entrance', `
        .et-box{ border:1px solid var(--line,#e5e5e5); border-radius:.7rem; padding:.7rem .8rem; display:grid; gap:.5rem; }
        .et-head{ display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
        .et-title{ font-size:.72rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--faint,#A8A296); }
        .et-line{ font-size:.8125rem; color:var(--muted,#736E64); }
        .et-acts{ display:flex; gap:.4rem; flex-wrap:wrap; }
        .et-row{ border:1px solid var(--line,#e5e5e5); border-radius:.8rem; padding:.7rem .8rem; display:grid; gap:.45rem; }
        .et-name{ font-weight:700; letter-spacing:-.01em; }
        .et-form{ display:grid; gap:.5rem; grid-template-columns:1fr 1fr; }
        .et-form .et-wide{ grid-column:1 / -1; }
        @media (max-width:34rem){ .et-form{ grid-template-columns:1fr; } }
        .et-pass{ color:#16A34A; font-weight:700; }
        `);
    }

    /* =====================================================================
     * DATA
     * =================================================================== */

    async function load() {
        try {
            const d = await S.api('/entrance-tests');
            S.tests = Array.isArray(d.tests) ? d.tests : [];
            S.quizzes = Array.isArray(d.quizzes) ? d.quizzes : [];
            S.error = null;
        } catch (err) {
            S.error = err;
            S.tests = [];
        }
        S.loaded = true;
        paint();
        return S.tests;
    }

    const byApplication = (id) => S.tests.find((t) => String(t.applicationId || '') === String(id)) || null;

    function changed() {
        paint();
        if (typeof S.onChange === 'function') { try { S.onChange(); } catch { /* the cards redraw next load */ } }
    }

    async function copy(text) {
        try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
        try {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch { return false; }
    }

    /* =====================================================================
     * ON AN APPLICATION CARD
     * =================================================================== */

    /**
     * The entrance-test strip for one application. `app.test` is what the
     * applications list carried; a test sent since then is in S.tests.
     */
    function cardHtml(app) {
        styles();
        const id = String(app._id || app.id);
        const t = byApplication(id) || app.test || null;
        if (!t) {
            if (!S.quizzes.length) {
                return S.loaded
                    ? `<div class="et-box"><div class="et-line">Want them to sit an entrance test first? Build one in <b>Recruitment → Quizzes</b> and it shows up here.</div></div>`
                    : '';
            }
            return `<div class="et-box" data-et-app="${esc(id)}">
                <div class="et-head"><span class="et-title">Entrance test</span></div>
                <div class="et-acts">
                    <select class="cp-select" data-et-quiz style="flex:1;min-width:10rem">${S.quizzes.map((q) => `<option value="${esc(q.id)}">${esc(q.title)} · ${q.passMark}% to pass</option>`).join('')}</select>
                    <button class="cp-btn cp-btn-primary cp-btn-sm" data-et-send><i data-lucide="send"></i> Send test</button>
                </div>
                <div class="et-line">They get a link — no account needed. You’ll see their score here before you accept them.</div>
            </div>`;
        }
        return `<div class="et-box" data-et-app="${esc(id)}" data-et-id="${esc(t.id)}">${testBody(t, { onCard: true })}</div>`;
    }

    /** What a test says about itself, and what can be done with it. */
    function testBody(t, { onCard = false } = {}) {
        const [label, cls] = STATE[t.status] || ['', 'cp-chip-mute'];
        const bits = [];
        if (t.total) bits.push(`${t.score}/${t.total} · <span class="${t.status === 'passed' ? 'et-pass' : ''}">${t.percent}%</span> against ${t.passMark}%`);
        if (t.attemptsUsed) bits.push(`${t.attemptsUsed} go${t.attemptsUsed === 1 ? '' : 'es'}${t.maxAttempts ? ` of ${t.maxAttempts}` : ''}`);
        if (t.retryAt) bits.push(`next go ${esc(relativeText(t.retryAt))}`);
        else if (t.submittedAt) bits.push(`handed in ${esc(relativeText(t.submittedAt))}`);
        else if (t.createdAt) bits.push(`sent ${esc(relativeText(t.createdAt))}${t.issuedBy ? ` by ${esc(t.issuedBy)}` : ''}`);
        const passedNext = t.status === 'passed'
            ? (onCard
                ? '<div class="et-line et-pass">Passed — accept them below to send their crew center invite.</div>'
                : (t.applicationId
                    ? '<div class="et-line">Passed — accept their application to send the invite.</div>'
                    : `<div class="et-acts"><button class="cp-btn cp-btn-primary cp-btn-sm" data-et-add><i data-lucide="user-plus"></i> Add &amp; invite</button></div>`))
            : '';
        return `
            <div class="et-head">
                <span class="et-title">${esc(t.quizTitle || 'Entrance test')}</span>
                ${label ? `<span class="cp-chip ${cls}">${esc(label)}</span>` : ''}
            </div>
            ${bits.length ? `<div class="et-line">${bits.join(' · ')}</div>` : ''}
            ${passedNext}
            <div class="et-acts">
                ${t.total && window.CrewAnswers ? '<button class="cp-btn cp-btn-sm" data-et-answers aria-expanded="false" title="Every question — what they picked and what was right"><i data-lucide="list-checks"></i> See answers</button>' : ''}
                ${t.message ? `<button class="cp-btn cp-btn-sm" data-et-copy><i data-lucide="clipboard-copy"></i> Copy for IFC</button>
                    <button class="cp-btn cp-btn-sm" data-et-copy-plain title="The same words with no pictures — for Discord"><i data-lucide="text"></i> Plain text</button>` : ''}
                ${t.status !== 'passed' ? `<button class="cp-btn cp-btn-sm" data-et-reissue title="A fresh link and a clean slate — the old link stops working"><i data-lucide="refresh-cw"></i> ${t.live ? 'New link' : 'Another go'}</button>` : ''}
                ${t.live ? '<button class="cp-btn cp-btn-sm" data-et-revoke><i data-lucide="x"></i> Withdraw</button>' : ''}
            </div>`;
    }

    /* =====================================================================
     * ACTIONS — shared by the cards and the panel
     * =================================================================== */

    async function send(body, btn) {
        if (btn) btn.disabled = true;
        try {
            const d = await S.api('/entrance-tests', { method: 'POST', body });
            const t = d.test;
            S.tests.unshift(t);
            S.lastSent = t;
            const copied = t && t.message ? await copy(t.message) : false;
            P.toast(copied
                ? `Test sent — the welcome message is on your clipboard. Paste it into their IFC message.${d.emailed ? ' It was emailed too.' : ''}`
                : 'Test sent. Copy the message to send it.', 'ok');
            changed();
            return t;
        } catch (err) {
            if (err.code === 'already_issued' || err.code === 'already_passed') await load();
            P.toast(err.message || 'Could not send that test.', 'bad');
            if (typeof S.onChange === 'function') S.onChange();
            return null;
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function act(t, action, btn) {
        if (action === 'revoke' && !(await P.ask({
            title: 'Withdraw this test?', confirm: 'Withdraw it', danger: true,
            body: 'The link stops working. You can send a new one later.',
        }))) return;
        if (btn) btn.disabled = true;
        try {
            const d = await S.api(`/quiz-attempts/${encodeURIComponent(t.id)}`, { method: 'PATCH', body: { action } });
            if (d.test) {
                const i = S.tests.findIndex((x) => String(x.id) === String(t.id));
                if (i >= 0) S.tests[i] = d.test;
                if (d.test.message && await copy(d.test.message)) P.toast('A fresh link — the new message is on your clipboard.', 'ok');
                else P.toast('Done.', 'ok');
            } else {
                await load();
                P.toast(action === 'revoke' ? 'Withdrawn.' : 'Done.', 'ok');
            }
            changed();
        } catch (err) {
            P.toast(err.message || 'That didn’t work.', 'bad');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    /* A pass from somebody who never applied: on the roster, with a login and
       the welcome message to send — the same "Add & invite" the roster form
       does, so there is one way a pilot gets a login from here. */
    async function addAndInvite(t, btn) {
        if (btn) btn.disabled = true;
        try {
            const d = await S.api('/roster', { method: 'POST', body: { name: t.pilotName || t.ifcName, ifcName: t.ifcName || '', invite: true } });
            const inv = d.invite || null;
            const r = inv && Array.isArray(inv.results) ? inv.results.find((x) => x.message) : null;
            if (r && await copy(r.message)) P.toast(`${t.pilotName || t.ifcName} is on the roster — their welcome message is on your clipboard.`, 'ok');
            else P.toast(`${t.pilotName || t.ifcName} is on the roster. Send their invitation from Roster → Logins.`, 'ok');
            if (typeof window.openLoginSetup === 'function' && inv && Array.isArray(inv.results)) {
                if (S.panel) S.panel.close();
                window.openRoster && window.openRoster();
                window.openLoginSetup(inv);
            }
        } catch (err) {
            P.toast(err.message || 'Could not add them.', 'bad');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    /** One click handler for wherever a test is drawn. */
    async function onClick(ev) {
        const box = ev.target.closest('[data-et-app], [data-et-id]');
        if (!box) return;
        const id = box.getAttribute('data-et-id');
        const t = id ? (S.tests.find((x) => String(x.id) === String(id)) || null) : null;
        const fallback = !t && id ? findOnCard(box) : null;
        const test = t || fallback;

        const sendBtn = ev.target.closest('[data-et-send]');
        if (sendBtn) {
            const quizId = (box.querySelector('[data-et-quiz]') || {}).value || '';
            return send({ quizId, applicationId: box.getAttribute('data-et-app') }, sendBtn);
        }
        if (!test) return;
        const ans = ev.target.closest('[data-et-answers]');
        if (ans) {
            if (window.CrewAnswers && S.api) window.CrewAnswers.toggle(ans, { api: S.api, id: test.id });
            return;
        }
        if (ev.target.closest('[data-et-copy]')) {
            const ok = await copy(test.message || '');
            return P.toast(ok ? 'Copied — paste it into their IFC message.' : 'Couldn’t copy that.', ok ? 'ok' : 'bad');
        }
        if (ev.target.closest('[data-et-copy-plain]')) {
            const ok = await copy(test.plainMessage || test.message || '');
            return P.toast(ok ? 'Copied as plain text.' : 'Couldn’t copy that.', ok ? 'ok' : 'bad');
        }
        const re = ev.target.closest('[data-et-reissue]');
        if (re) return act(test, 'reissue', re);
        const rv = ev.target.closest('[data-et-revoke]');
        if (rv) return act(test, 'revoke', rv);
        const add = ev.target.closest('[data-et-add]');
        if (add) return addAndInvite(test, add);
    }

    // A card drawn from the applications list before S.tests had it.
    const CARD_TESTS = new Map();
    function findOnCard(box) { return CARD_TESTS.get(String(box.getAttribute('data-et-id'))) || null; }

    /* =====================================================================
     * THE PANEL — every test, and one for somebody new
     * =================================================================== */

    function panelHtml() {
        if (!S.loaded) return '<div class="cp-empty">Loading…</div>';
        if (S.error) {
            if (P.isSchemaGap(S.error)) return P.schemaGapHtml(S.error);
            return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>${esc(S.error.message || 'Could not load the tests.')}</div>`;
        }
        const form = S.quizzes.length
            ? `<div class="et-box">
                <div class="et-head"><span class="et-title">Send a test to someone new</span></div>
                <div class="et-line">Somebody you met on the IFC who hasn’t applied. They sit it with no account; pass, and you add them with one press.</div>
                <form class="et-form" data-et-new>
                    <input class="cp-input" name="name" placeholder="Their name" maxlength="80" autocomplete="off">
                    <input class="cp-input" name="ifcName" placeholder="IFC username" maxlength="60" autocomplete="off" spellcheck="false">
                    <select class="cp-select et-wide" name="quizId">${S.quizzes.map((q) => `<option value="${esc(q.id)}">${esc(q.title)} · ${q.passMark}% to pass${q.retakeHours ? ` · retake after ${q.retakeHours}h` : ''}</option>`).join('')}</select>
                    <input class="cp-input et-wide" name="note" placeholder="A line of your own for the message (optional)" maxlength="500">
                    <button class="cp-btn cp-btn-primary et-wide" type="submit"><i data-lucide="send"></i> Send test &amp; copy the message</button>
                </form>
            </div>`
            : `<div class="et-box"><div class="et-line">There’s no test to send yet. Build one in <b>Recruitment → Quizzes</b> — questions, a pass mark, how long to wait before a retake, and what to study.</div></div>`;
        const rows = S.tests.length
            ? S.tests.map((t) => `<div class="et-row" data-et-id="${esc(t.id)}">
                <div class="et-name">${esc(t.pilotName || t.ifcName || 'Somebody')}${t.ifcName && t.ifcName !== t.pilotName ? ` <span class="cp-note">@${esc(t.ifcName)}</span>` : ''}${t.applicationId ? ' <span class="cp-chip cp-chip-mute">Applied</span>' : ''}</div>
                ${testBody(t)}
            </div>`).join('')
            : '<div class="cp-empty">No entrance tests sent yet.</div>';
        return `<div style="display:grid;gap:.9rem">${form}<div style="display:grid;gap:.6rem">${rows}</div></div>`;
    }

    function paint() {
        if (!S.panel || !S.panel.isOpen()) return;
        P.keepPlace(S.panel.body, () => { S.panel.body.innerHTML = panelHtml(); });
        try { icons(); } catch { /* a missing glyph is not worth a blank panel */ }
    }

    function open() {
        styles();
        // Opened from the quiz builder before the applications were ever
        // looked at: borrow the dashboard's own API binding.
        if (!S.api && typeof window.crewApi === 'function') S.api = window.crewApi();
        if (!S.api) return;
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewEntrance', title: 'Entrance tests', icon: 'file-pen-line' });
            S.panel.body.addEventListener('click', onClick);
            S.panel.body.addEventListener('submit', async (ev) => {
                const form = ev.target.closest('[data-et-new]');
                if (!form) return;
                ev.preventDefault();
                const f = new FormData(form);
                const name = String(f.get('name') || '').trim();
                const ifcName = String(f.get('ifcName') || '').trim();
                if (!name && !ifcName) { P.toast('Who is it for? Type their name or IFC username.', 'bad'); return; }
                const t = await send({ quizId: f.get('quizId'), name, ifcName, note: String(f.get('note') || '').trim() }, form.querySelector('button[type=submit]'));
                if (t) form.reset();
            });
        }
        S.panel.open();
        paint();
        load();
    }

    function mount({ api, onChange } = {}) {
        styles();
        S.api = api;
        S.onChange = onChange || null;
        return load();
    }

    /** Wire the application list's clicks to this module (call once). */
    function wire(el) {
        if (!el || el.dataset.etWired) return;
        el.dataset.etWired = '1';
        el.addEventListener('click', onClick);
    }

    /** Remember the tests the applications list carried, for its cards. */
    function noteCards(apps) {
        (apps || []).forEach((a) => { if (a && a.test && a.test.id) CARD_TESTS.set(String(a.test.id), a.test); });
    }

    window.CrewEntrance = {
        mount, open, wire, cardHtml, noteCards,
        reload: () => load(),
        get quizzes() { return S.quizzes.slice(); },
        get tests() { return S.tests.slice(); },
    };
})();
