/* ============================================================================
   crewEntrance.js — entrance tests, on the staff side.

   WHY THIS EXISTS

   VAs were running their entrance test in a Google Form: paste the link into
   an IFC message ("Welcome to …! Before you take to the virtual skies, please
   complete our Entrance Test…"), wait, open the spreadsheet, work out who
   passed, and only then go back to the crew center and accept them. Three tools
   and a spreadsheet for one question — did they pass?

   Now the test is a quiz the airline builds in Recruitment → Quizzes and picks
   as its entrance test in Recruitment → Joining. It goes out BY ITSELF the
   moment somebody applies (or opens their Discord ticket) — see crewRecruit.js
   on the server. This is the strip on each APPLICATION card that says how they
   did, with the overrides: send it now, resend, withdraw, or send a test when
   the airline does not require one.

   A test only ever belongs to an application. Somebody met on the IFC is sent
   the join link; the test follows when they apply.

   The taker needs no login — the link is the key (crew-test.html). The server
   marks the paper, enforces the retake wait and hands out the study material;
   nothing on this screen decides a result.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewEntrance: crewPanels.js must load first'); return; }
    const { esc, relativeText } = P;

    const S = {
        api: null,
        tests: [],          // GET /entrance-tests
        quizzes: [],        // the ready quizzes a test can be
        loaded: false,
        error: null,
        onChange: null,     // the dashboard redraws its application cards
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
        .et-pass{ color:#16A34A; font-weight:700; }
        .et-more summary{ cursor:pointer; font-size:.8125rem; color:var(--muted,#736E64); }
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
        return S.tests;
    }

    const byApplication = (id) => S.tests.find((t) => String(t.applicationId || '') === String(id)) || null;

    function changed() {
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
     * `rules` is the airline's road (the list's `rules`): whether a test is
     * required, and which.
     */
    function cardHtml(app, rules) {
        styles();
        const id = String(app._id || app.id);
        const t = byApplication(id) || app.test || null;
        if (t) return `<div class="et-box" data-et-app="${esc(id)}" data-et-id="${esc(t.id)}">${testBody(t)}</div>`;
        const required = rules && rules.test;
        if (!S.quizzes.length && !required) return '';
        const pick = (selected) => `<select class="cp-select" data-et-quiz style="flex:1;min-width:10rem">${S.quizzes.map((q) => `<option value="${esc(q.id)}"${q.id === selected ? ' selected' : ''}>${esc(q.title)} · ${q.passMark}% to pass</option>`).join('')}</select>`;
        if (required) {
            const when = app.stage === 'discord'
                ? 'It goes out by itself when they open their Discord ticket.'
                : 'It hasn’t gone out yet.';
            return `<div class="et-box" data-et-app="${esc(id)}">
                <div class="et-head"><span class="et-title">${esc(required.title || 'Entrance test')}</span><span class="cp-chip cp-chip-mute">Not sent yet</span></div>
                <div class="et-line">${esc(when)} Send it now if you reach them another way.</div>
                <div class="et-acts"><input type="hidden" data-et-quiz value="${esc(required.id)}">
                    <button class="cp-btn cp-btn-sm" data-et-send><i data-lucide="send"></i> Send it now</button></div>
            </div>`;
        }
        // No test required: sending one is an override, so it stays tucked away.
        return `<details class="et-box et-more" data-et-app="${esc(id)}">
            <summary>Send an entrance test anyway</summary>
            <div class="et-acts">${pick('')}<button class="cp-btn cp-btn-sm" data-et-send><i data-lucide="send"></i> Send test</button></div>
            <div class="et-line">They get a link — no account needed. Their score lands on this card.</div>
        </details>`;
    }

    /** What a test says about itself, and what can be done with it. */
    function testBody(t) {
        const [label, cls] = STATE[t.status] || ['', 'cp-chip-mute'];
        const bits = [];
        if (t.total) bits.push(`${t.score}/${t.total} · <span class="${t.status === 'passed' ? 'et-pass' : ''}">${t.percent}%</span> against ${t.passMark}%`);
        if (t.attemptsUsed) bits.push(`${t.attemptsUsed} go${t.attemptsUsed === 1 ? '' : 'es'}${t.maxAttempts ? ` of ${t.maxAttempts}` : ''}`);
        if (t.retryAt) bits.push(`next go ${esc(relativeText(t.retryAt))}`);
        else if (t.submittedAt) bits.push(`handed in ${esc(relativeText(t.submittedAt))}`);
        else if (t.createdAt) bits.push(`sent ${esc(relativeText(t.createdAt))}${t.issuedBy ? ` by ${esc(t.issuedBy)}` : ''}`);
        const passedNext = t.status === 'passed'
            ? '<div class="et-line et-pass">Passed.</div>'
            : '';
        return `
            <div class="et-head">
                <span class="et-title">${esc(t.quizTitle || 'Entrance test')}</span>
                ${label ? `<span class="cp-chip ${cls}">${esc(label)}</span>` : ''}
            </div>
            ${bits.length ? `<div class="et-line">${bits.join(' · ')}</div>` : ''}
            ${passedNext}
            <div class="et-acts">
                ${t.status !== 'passed' ? `<button class="cp-btn cp-btn-sm" data-et-reissue title="A fresh link and a clean slate — the old link stops working"><i data-lucide="refresh-cw"></i> ${t.live ? 'New link' : 'Another go'}</button>` : ''}
                ${t.live ? '<button class="cp-btn cp-btn-sm" data-et-revoke><i data-lucide="x"></i> Withdraw</button>' : ''}
            </div>`;
    }

    /* =====================================================================
     * ACTIONS
     * =================================================================== */

    async function send(body, btn) {
        if (btn) btn.disabled = true;
        try {
            const d = await S.api('/entrance-tests', { method: 'POST', body });
            const t = d.test;
            S.tests.unshift(t);
            const copied = t && t.message ? await copy(t.message) : false;
            P.toast(copied
                ? `Test sent — it’s on their status page${d.emailed ? ', emailed' : ''}, and the message is on your clipboard for the IFC.`
                : 'Test sent — it’s on their status page.', 'ok');
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
        const re = ev.target.closest('[data-et-reissue]');
        if (re) return act(test, 'reissue', re);
        const rv = ev.target.closest('[data-et-revoke]');
        if (rv) return act(test, 'revoke', rv);
    }

    // A card drawn from the applications list before S.tests had it.
    const CARD_TESTS = new Map();
    function findOnCard(box) { return CARD_TESTS.get(String(box.getAttribute('data-et-id'))) || null; }

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
        mount, wire, cardHtml, noteCards,
        reload: () => load(),
        get quizzes() { return S.quizzes.slice(); },
        get tests() { return S.tests.slice(); },
    };
})();
