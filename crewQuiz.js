/* ============================================================================
   crewQuiz.js — a pilot sitting a quiz, and the door some airlines put in
   front of their crew centre.

   WHY THIS EXISTS

   Airlines ask their pilots to read things — an SOP, a handbook, the rules
   about which callsigns are reserved — and then have no way at all of knowing
   whether anybody did. The usual substitute is a question in Discord and a
   thumbs-up, which records nothing and proves less.

   WHAT THIS IS

   Two screens, and they are deliberately the same screen twice:

     THE PAPER       multiple choice, one question after another, marked the
                     moment it is handed in. A pilot is told what they scored
                     and whether it was enough — never which ones they got
                     wrong, because with a second attempt in hand that is the
                     answer key read backwards.

     THE LOCKED DOOR the whole crew centre, covered, when the airline has said
                     nobody comes in until they have passed. It is the same
                     paper behind it; what is different is that there is
                     nowhere else to go.

   WHAT THIS SCREEN DOES NOT DECIDE

   Anything at all. It never sees a right answer — the server strips them — it
   cannot mark a paper, and it cannot open the door: `locked` comes back from
   /me on every load, so a reload does not get anybody past it and a pass does
   not need one.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewQuiz: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText } = P;

    const S = {
        api: null,
        panel: null,
        view: 'list',        // list | paper | result
        data: null,          // GET /quizzes
        paper: null,         // GET /quiz/:token
        result: null,        // what the server said about the last hand-in
        answers: {},         // question index -> option index, this sitting only
        loading: false,
        error: null,
        sending: false,
        gate: null,          // the last gate state we were told about
        lockEl: null,
    };

    const STATE = {
        issued: ['Waiting for you', 'cp-chip-warn'],
        started: ['Started', 'cp-chip-accent'],
        passed: ['Passed', 'cp-chip-ok'],
        failed: ['Not yet', 'cp-chip-mute'],
        revoked: ['Withdrawn', 'cp-chip-mute'],
    };

    function styles() {
        P.baseStyles();
        P.style('crew-quiz', `
        .qz-banner{ width:100%; aspect-ratio:3/1; object-fit:cover; border-radius:.8rem; margin-bottom:.8rem; }
        .qz-sec{ display:grid; gap:.6rem; }
        .qz-h{ font-size:.72rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
            color:var(--faint,#A8A296); }
        .qz-card{ border:1px solid var(--line,#e5e5e5); border-radius:.9rem; background:var(--surface,#fff);
            padding:.85rem .9rem; display:grid; gap:.4rem; }
        .qz-title{ font-size:.95rem; font-weight:800; letter-spacing:-.01em; }
        .qz-sub{ font-size:.78rem; color:var(--muted,#736E64); }
        .qz-blurb{ font-size:.85rem; white-space:pre-wrap; }

        /* THE PAPER.
           One question per card, every option a full-width target. A radio in
           a row of text is a five-millimetre tap on a phone; the whole option
           is the control here, which is also what makes the chosen one
           obvious at a glance. */
        .qz-q{ border:1px solid var(--line,#e5e5e5); border-radius:.9rem; background:var(--surface,#fff);
            padding:.85rem .9rem; display:grid; gap:.5rem; }
        .qz-qn{ font-size:.72rem; font-weight:800; letter-spacing:.12em; text-transform:uppercase;
            color:var(--faint,#A8A296); }
        .qz-qt{ font-size:.92rem; font-weight:700; letter-spacing:-.01em; }
        .qz-opt{ display:flex; gap:.6rem; align-items:flex-start; padding:.6rem .7rem; cursor:pointer;
            border:1px solid var(--line,#e5e5e5); border-radius:.65rem; font-size:.86rem;
            transition:border-color .15s, background .15s; }
        .qz-opt:hover{ border-color:color-mix(in srgb, var(--accent) 50%, transparent); }
        .qz-opt input{ flex:none; margin-top:.15rem; accent-color:var(--accent); }
        .qz-on{ border-color:var(--accent); background:color-mix(in srgb, var(--accent) 8%, transparent); }

        .qz-bar{ height:.4rem; border-radius:999px; overflow:hidden; margin:.2rem 0 .1rem;
            background:color-mix(in srgb, var(--ink,#1C1A16) 8%, transparent); }
        .qz-bar span{ display:block; height:100%; border-radius:999px; background:var(--accent);
            transition:width .5s cubic-bezier(.22,1.12,.36,1); }

        .qz-score{ font-size:2.2rem; font-weight:800; letter-spacing:-.03em; line-height:1.1; }
        .qz-ok{ color:#16A34A; } .qz-no{ color:var(--ink,#1C1A16); }

        /* THE DOOR. Over everything, with no way past it — no scrim to click,
           no escape key, because it is not a dialog. It is the airline saying
           the crew centre is not open to this pilot yet. */
        .qz-lock{ position:fixed; inset:0; z-index:70; display:grid; place-items:center; padding:1.25rem;
            background:color-mix(in srgb, var(--bg,#fff) 92%, transparent); backdrop-filter:blur(8px);
            overflow-y:auto; }
        .qz-lock-box{ width:100%; max-width:26rem; background:var(--surface,#fff); border-radius:1rem;
            border:1px solid var(--line,#e5e5e5); padding:1.4rem; text-align:center;
            box-shadow:0 20px 50px rgb(0 0 0 / .18); }
        .qz-lock-ico{ width:2.6rem; height:2.6rem; border-radius:50%; margin:0 auto .7rem;
            display:grid; place-items:center; background:color-mix(in srgb, var(--accent) 14%, transparent); }
        .qz-lock h2{ font-size:1.1rem; font-weight:800; letter-spacing:-.02em; margin:0 0 .35rem; }
        .qz-lock p{ font-size:.87rem; color:var(--muted,#736E64); margin:0 0 .9rem; white-space:pre-wrap; }
        `);
    }

    /* =====================================================================
     * READING
     * =================================================================== */

    async function load() {
        S.loading = true; S.error = null;
        draw();
        try { S.data = await S.api('/quizzes'); }
        catch (err) { S.error = err; }
        S.loading = false;
        draw();
    }

    async function loadPaper(token) {
        S.loading = true; S.error = null; S.answers = {}; S.result = null;
        S.view = 'paper';
        draw();
        try {
            S.paper = await S.api(`/quiz/${encodeURIComponent(token)}`);
            S.paper.token = token;
        } catch (err) { S.error = err; S.paper = null; }
        S.loading = false;
        draw();
    }

    const mine = () => (S.data && S.data.mine) || [];
    const quizzes = () => (S.data && S.data.quizzes) || [];

    /* =====================================================================
     * DRAWING
     * =================================================================== */

    function draw() {
        if (!S.panel) return;
        P.keepPlace(S.panel.body, () => {
            S.panel.body.innerHTML = bodyHtml();
            try { icons(); } catch (_) {}
        });
    }

    function bodyHtml() {
        if (S.loading && !S.data && !S.paper) return `<p class="cp-note" style="text-align:center;padding:2rem 0">One moment…</p>`;
        if (S.error) {
            if (S.error.status === 404 && !S.paper) return P.notBuiltHtml('Quizzes');
            if (P.isSchemaGap(S.error)) return P.schemaGapHtml(S.error);
            return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>
                ${esc(S.error.message || 'That could not be opened.')}
                <div style="margin-top:.9rem"><button class="cp-btn" data-qz-back>Back</button></div></div>`;
        }
        if (S.view === 'result') return resultHtml();
        if (S.view === 'paper') return paperHtml();
        return listHtml();
    }

    /* ---- What is waiting for me ----------------------------------------- */

    function listHtml() {
        if (!S.data) return '';
        if (!S.data.supported) {
            return P.schemaGapHtml({ code: 'store_quizzes_missing',
                message: 'This crew centre’s database can’t record quiz results yet.' });
        }
        const banner = (S.data.banners && S.data.banners.quiz) || '';
        const live = mine().filter((a) => a.status === 'issued' || a.status === 'started');
        const done = mine().filter((a) => a.status === 'passed' || a.status === 'failed');
        // Ones the airline lets anybody start, that this pilot has no paper for.
        const selfServe = quizzes().filter((q) => q.open && q.ready !== false && q.active !== false
            && !mine().some((a) => a.quizId === q.id && a.status !== 'revoked'));

        if (!live.length && !done.length && !selfServe.length) {
            return `<div class="cp-empty"><i data-lucide="file-question"></i>
                Nothing to sit. Your airline sends a quiz out with a link when it has one for you.</div>`;
        }

        const card = (a) => {
            const [label, chip] = STATE[a.status] || STATE.issued;
            const bits = [];
            if (a.total) bits.push(`${a.score}/${a.total} · ${a.percent}%`);
            if (a.passMark) bits.push(`${a.passMark}% needed`);
            if (a.submittedAt) bits.push(relativeText(a.submittedAt));
            const can = a.status === 'issued' || a.status === 'started'
                || (a.status === 'failed' && (a.maxAttempts === 0 || a.attemptsUsed < a.maxAttempts));
            return `<div class="qz-card">
                <div class="qz-title">${esc(a.quizTitle || 'Quiz')} <span class="cp-chip ${chip}">${esc(label)}</span></div>
                ${bits.length ? `<div class="qz-sub">${esc(bits.join(' · '))}</div>` : ''}
                ${can && a.token ? `<div><button class="cp-btn cp-btn-primary cp-btn-sm" data-qz-open="${esc(a.token)}">
                    ${a.status === 'failed' ? 'Try it again' : 'Open it'}</button></div>` : ''}
            </div>`;
        };

        return `${banner ? `<img class="qz-banner" src="${esc(banner)}" alt="">` : ''}
            <div class="qz-sec">
                ${live.length ? `<div class="qz-h">Waiting for you</div>${live.map(card).join('')}` : ''}
                ${selfServe.length ? `<div class="qz-h" style="margin-top:.5rem">You can start these</div>
                    ${selfServe.map((q) => `<div class="qz-card">
                        <div class="qz-title">${esc(q.title)}</div>
                        ${q.blurb ? `<div class="qz-sub">${esc(q.blurb)}</div>` : ''}
                        <div class="qz-sub">${q.questionCount} question${q.questionCount === 1 ? '' : 's'} · ${q.passMark}% to pass</div>
                        <div><button class="cp-btn cp-btn-primary cp-btn-sm" data-qz-start="${esc(q.id)}">Start it</button></div>
                    </div>`).join('')}` : ''}
                ${done.length ? `<div class="qz-h" style="margin-top:.5rem">Done</div>${done.map(card).join('')}` : ''}
            </div>`;
    }

    /* ---- The paper ------------------------------------------------------ */

    function paperHtml() {
        if (!S.paper) return '';
        const { quiz, attempt, refusal, banner } = S.paper;
        if (refusal || !quiz) {
            return `<div class="cp-empty"><i data-lucide="info"></i>${esc(refusal || 'That quiz is not available.')}
                <div style="margin-top:.9rem"><button class="cp-btn" data-qz-back>Back</button></div></div>`;
        }
        const qs = quiz.questions || [];
        const answered = Object.keys(S.answers).length;
        const left = (attempt && attempt.maxAttempts)
            ? Math.max(0, attempt.maxAttempts - (attempt.attemptsUsed || 0)) : -1;

        return `${banner ? `<img class="qz-banner" src="${esc(banner)}" alt="">` : ''}
            <div class="qz-sec">
                <div>
                    <div class="qz-title">${esc(quiz.title)}</div>
                    ${quiz.blurb ? `<div class="qz-blurb" style="margin-top:.3rem">${esc(quiz.blurb)}</div>` : ''}
                    <div class="qz-sub" style="margin-top:.35rem">
                        ${qs.length} question${qs.length === 1 ? '' : 's'} · ${quiz.passMark}% to pass${
                        left >= 0 ? ` · ${left} attempt${left === 1 ? '' : 's'} left` : ''}</div>
                </div>
                <div class="qz-bar"><span style="width:${qs.length ? (answered / qs.length) * 100 : 0}%"></span></div>
                ${qs.map((q, i) => `
                    <div class="qz-q">
                        <div class="qz-qn">Question ${i + 1}</div>
                        <div class="qz-qt">${esc(q.text)}</div>
                        ${(q.options || []).map((o, oi) => `
                            <label class="qz-opt ${S.answers[i] === oi ? 'qz-on' : ''}">
                                <input type="radio" name="qz-${i}" data-qz-pick="${i}" value="${oi}"
                                    ${S.answers[i] === oi ? 'checked' : ''}>
                                <span>${esc(o)}</span>
                            </label>`).join('')}
                    </div>`).join('')}
                <div>
                    <button class="cp-btn cp-btn-primary" data-qz-send style="width:100%;justify-content:center">
                        Hand it in</button>
                    <p class="cp-note" style="margin-top:.5rem">Anything left blank counts as wrong, so have a go at all of them.</p>
                </div>
                <div><button class="cp-btn cp-btn-sm" data-qz-back>Not now</button></div>
            </div>`;
    }

    /* ---- What it came to ------------------------------------------------ */

    function resultHtml() {
        const r = S.result || {};
        const left = r.attemptsLeft;
        return `<div class="qz-sec" style="text-align:center;padding:1rem 0">
            <div class="qz-score ${r.passed ? 'qz-ok' : 'qz-no'}">${r.percent}%</div>
            <div class="qz-sub">${r.score} of ${r.total} right · ${r.passMark}% needed</div>
            <div style="margin-top:.6rem">
                ${r.passed
                    ? `<p class="qz-blurb"><b>That’s a pass.</b>${(r.gate && !r.gate.locked) ? ' The crew centre is open to you.' : ''}</p>`
                    : `<p class="qz-blurb">Not this time.${left === 0
                        ? ' That was your last attempt — your staff can give you another go.'
                        : left > 0 ? ` You have ${left} attempt${left === 1 ? '' : 's'} left.` : ''}</p>`}
            </div>
            <div class="qz-sec" style="margin-top:.4rem">
                ${(!r.passed && left !== 0) ? `<button class="cp-btn cp-btn-primary" data-qz-again>Have another go</button>` : ''}
                <button class="cp-btn" data-qz-back>Done</button>
            </div>
            <p class="cp-note" style="margin-top:.6rem">Which ones you got wrong stays with your staff — ask them if you want to go through it.</p>
        </div>`;
    }

    /* =====================================================================
     * DOING
     * =================================================================== */

    async function send(btn) {
        if (S.sending || !S.paper || !S.paper.quiz) return;
        const qs = S.paper.quiz.questions || [];
        const blank = qs.length - Object.keys(S.answers).length;
        if (blank > 0) {
            const yes = await P.ask({
                title: `Hand it in with ${blank} unanswered?`,
                body: 'A blank counts as wrong. You can go back and fill them in first.',
                confirm: 'Hand it in anyway',
            });
            if (!yes) return;
        }
        // Positional, in the order the questions came: the server pairs the
        // answers against its own copy and never trusts a question sent from
        // here — see the note at the head of crewQuizzes.js.
        const answers = qs.map((_, i) => (i in S.answers ? S.answers[i] : -1));

        S.sending = true;
        const done = P.busy(btn, 'Marking…');
        try {
            const r = await S.api(`/quiz/${encodeURIComponent(S.paper.token)}`, { method: 'POST', body: { answers } });
            S.result = r;
            S.view = 'result';
            // The door is answered by the same reply, so a pass lifts the lock
            // without a reload.
            if (r.gate) applyGate(r.gate);
            draw();
            load();
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t send.', 'bad');
        } finally { S.sending = false; done(); }
    }

    async function startSelf(quizId, btn) {
        const done = P.busy(btn, 'Opening…');
        try {
            const d = await S.api('/quiz-attempts/self', { method: 'POST', body: { quizId } });
            if (d.attempt && d.attempt.token) await loadPaper(d.attempt.token);
        } catch (err) { P.toast((err && err.message) || 'That didn’t open.', 'bad'); }
        finally { done(); }
    }

    /* =====================================================================
     * THE DOOR
     *
     * Drawn from the gate state /me hands back on every load, so it survives a
     * reload and cannot be dismissed by one. Everything about whether it should
     * be up is decided on the server; this only draws it.
     * =================================================================== */

    function applyGate(gate) {
        S.gate = gate || null;
        const locked = !!(gate && gate.locked);
        if (!locked) {
            if (S.lockEl) { S.lockEl.remove(); S.lockEl = null; document.body.style.overflow = ''; }
            return;
        }
        styles();
        if (!S.lockEl) {
            S.lockEl = document.createElement('div');
            S.lockEl.className = 'qz-lock';
            document.body.appendChild(S.lockEl);
            S.lockEl.addEventListener('click', (ev) => {
                const go = ev.target.closest('[data-qz-gate-open]');
                if (go) {
                    const token = go.getAttribute('data-qz-gate-open');
                    if (token) open({ token });
                    else if (S.gate && S.gate.quizId) { open({}); startSelf(S.gate.quizId, go); }
                }
            });
        }
        const canGo = gate.canStart;
        S.lockEl.innerHTML = `<div class="qz-lock-box">
            <div class="qz-lock-ico"><i data-lucide="${canGo ? 'file-pen-line' : 'lock'}" class="w-5 h-5"></i></div>
            <h2>${esc(gate.quizTitle ? `${gate.quizTitle} first` : 'Almost in')}</h2>
            <p>${esc(gate.message || (canGo
                ? 'Your airline asks every pilot to pass this before the crew centre opens.'
                : 'Your airline opens the crew centre once you have passed its quiz. Your staff will send you a link — it also lands in your inbox here.'))}</p>
            ${canGo ? `<button class="cp-btn cp-btn-primary" style="width:100%;justify-content:center"
                data-qz-gate-open="${esc(gate.token || '')}">
                ${gate.status === 'failed' ? 'Have another go' : 'Take the quiz'}</button>` : ''}
            ${(!canGo && gate.status === 'failed') ? `<p class="cp-note" style="margin-top:.7rem">
                You are out of attempts on this one. Ask your staff for another go.</p>` : ''}
        </div>`;
        document.body.style.overflow = 'hidden';
        try { icons(); } catch (_) {}
    }

    /* =====================================================================
     * WIRING
     * =================================================================== */

    function wire(panel) {
        if (panel.el.dataset.qzWired) return;
        panel.el.dataset.qzWired = '1';

        panel.el.addEventListener('change', (ev) => {
            const pick = ev.target.closest('[data-qz-pick]');
            if (!pick) return;
            S.answers[Number(pick.getAttribute('data-qz-pick'))] = Number(pick.value);
            draw();
        });

        panel.el.addEventListener('click', (ev) => {
            const t = ev.target;
            const openIt = t.closest('[data-qz-open]');
            if (openIt) { loadPaper(openIt.getAttribute('data-qz-open')); return; }
            const start = t.closest('[data-qz-start]');
            if (start) { startSelf(start.getAttribute('data-qz-start'), start); return; }
            if (t.closest('[data-qz-send]')) { send(t.closest('[data-qz-send]')); return; }
            if (t.closest('[data-qz-again]')) {
                // The same link: a failed paper with attempts left stays open on
                // the server, so there is nothing to mint.
                if (S.paper && S.paper.token) loadPaper(S.paper.token);
                return;
            }
            if (t.closest('[data-qz-back]')) {
                S.view = 'list'; S.paper = null; S.error = null;
                draw(); load();
                return;
            }
        });
    }

    function open({ api, token } = {}) {
        styles();
        if (typeof api === 'function') S.api = api;
        if (!S.api) { console.warn('crewQuiz: needs an api function'); return; }
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewQuiz', title: 'Quizzes', icon: 'file-pen-line' });
            wire(S.panel);
        }
        S.panel.open();
        if (token) loadPaper(token);
        else { S.view = 'list'; draw(); load(); }
    }

    function mount({ api } = {}) { if (typeof api === 'function') S.api = api; }

    window.CrewQuiz = {
        mount, open, applyGate,
        close: () => S.panel && S.panel.close(),
    };
})();
