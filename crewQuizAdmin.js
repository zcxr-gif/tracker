/* ============================================================================
   crewQuizAdmin.js — the airline's side of the quizzes.

   WHY THIS EXISTS

   An airline that wants to be sure somebody has read the SOP before it hands
   them a callsign has had one way of finding out: ask them in Discord and
   believe the answer. So the induction either happened or it did not, nobody
   can tell which afterwards, and the pilot who did the reading has no way to
   prove it.

   WHAT THIS IS

   Three screens inside the Recruitment drawer, and they are three because an
   airline does three different things here:

     BUILD     what the quiz asks, what it takes to pass, and the picture over
               it. Also the DOOR — whether the crew centre is shut until a
               pilot has passed one.
     SEND      hand a named pilot a link, and read what came back.
     NUDGE     have staff reminded that somebody is waiting.

   WHAT THIS SCREEN DOES NOT DECIDE

   Anything. The answer key is written here and marked on the server; the door
   is described here and enforced in /me; a pilot's result is the server's word
   and this never computes one. Every refusal on this screen comes back from an
   endpoint that would have refused it anyway.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewQuizAdmin: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText } = P;

    const S = {
        api: null,
        cfg: null,           // { backend, slug, token }
        hosts: {},           // cat -> element id
        data: null,          // GET /quizzes
        attempts: null,      // GET /quiz-attempts
        roster: null,        // GET /roster, for the pilot picker
        loading: false,
        error: null,
        open: '',            // the quiz whose editor is expanded
        shown: '',           // the tab currently on screen
        preview: null,       // what the reminder would say
        link: '',            // the link just minted, so it can be copied
    };

    const STATE = {
        issued: ['Sent', 'cp-chip-warn'],
        started: ['Opened', 'cp-chip-accent'],
        passed: ['Passed', 'cp-chip-ok'],
        failed: ['Not yet', 'cp-chip-mute'],
        revoked: ['Withdrawn', 'cp-chip-mute'],
    };

    function styles() {
        P.baseStyles();
        P.style('crew-quiz-admin', `
        .qa-sec{ display:grid; gap:.6rem; }
        .qa-h{ font-size:.72rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
            color:var(--faint,#A8A296); }
        .qa-card{ border:1px solid var(--line,#e5e5e5); border-radius:.9rem; background:var(--surface,#fff);
            padding:.8rem .85rem; display:grid; gap:.55rem; }
        .qa-row{ display:flex; gap:.6rem; align-items:center; }
        .qa-row-main{ min-width:0; flex:1; }
        .qa-name{ font-size:.9rem; font-weight:700; letter-spacing:-.01em; }
        .qa-sub{ font-size:.75rem; color:var(--muted,#736E64); margin-top:.1rem; }
        .qa-acts{ display:flex; gap:.35rem; flex-wrap:wrap; }

        /* A BANNER IS SHOWN AT THE SHAPE IT WILL BE SHOWN AT.
           A VA choosing a picture for the top of a screen is choosing a crop,
           and a square thumbnail of it answers a question nobody asked. */
        .qa-banner{ width:100%; aspect-ratio:3/1; object-fit:cover; border-radius:.7rem;
            border:1px solid var(--line,#e5e5e5); background:color-mix(in srgb, var(--ink,#1C1A16) 4%, transparent); }
        .qa-drop{ display:grid; gap:.4rem; }

        /* The questions. An option is a radio and a text box on one line,
           because "which of these is right" is the whole of what the radio
           means and a separate control for it would be a second thing to
           explain. */
        .qa-q{ border:1px dashed var(--line,#e5e5e5); border-radius:.7rem; padding:.6rem .65rem; display:grid; gap:.45rem; }
        .qa-opt{ display:flex; gap:.5rem; align-items:center; }
        .qa-opt input[type="radio"]{ flex:none; width:1rem; height:1rem; accent-color:var(--accent); }
        .qa-opt .cp-input{ flex:1; min-width:0; }
        .qa-x{ flex:none; border:0; background:none; cursor:pointer; color:var(--faint,#A8A296);
            font-size:1rem; line-height:1; padding:.25rem; }
        .qa-x:hover{ color:#DC2626; }

        .qa-link{ font-size:.75rem; word-break:break-all; padding:.5rem .6rem; border-radius:.55rem;
            background:color-mix(in srgb, var(--ink,#1C1A16) 4%, transparent); }
        .qa-gate{ border:1px solid var(--line,#e5e5e5); border-radius:.9rem; padding:.8rem .85rem;
            display:grid; gap:.55rem; background:color-mix(in srgb, var(--accent) 5%, transparent); }
        .qa-check{ display:flex; align-items:flex-start; gap:.5rem; font-size:.82rem; }
        .qa-check input{ margin-top:.15rem; flex:none; accent-color:var(--accent); }
        .qa-check b{ display:block; }
        .qa-check span{ display:block; font-size:.75rem; color:var(--muted,#736E64); }
        `);
    }

    /* =====================================================================
     * READING
     * =================================================================== */

    async function load() {
        S.loading = true; S.error = null;
        draw();
        try {
            S.data = await S.api('/quizzes');
            // The queue and the roster are only the Send screen's business, and
            // only when somebody may work it. An owner who never opens that tab
            // never asks their database for it.
            if (S.data.canReview) {
                S.attempts = await S.api('/quiz-attempts').then(d => d.attempts || []).catch(() => []);
                if (!S.roster) S.roster = await rosterFetch().catch(() => []);
            }
        } catch (err) { S.error = err; }
        S.loading = false;
        draw();
    }

    // The roster comes off the public endpoint the dashboard already uses —
    // names and callsigns, which is all a "who is this for" picker needs.
    async function rosterFetch() {
        const base = String(S.cfg.backend || '').replace(/\/+$/, '');
        const res = await fetch(`${base}/api/crew/${encodeURIComponent(S.cfg.slug)}/roster`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return [];
        const d = await res.json();
        return Array.isArray(d.roster) ? d.roster : [];
    }

    const quizzes = () => (S.data && S.data.quizzes) || [];
    const gateCfg = () => (S.data && S.data.gateConfig) || { enabled: false, quizId: '', message: '', allowSelfStart: false };
    const banners = () => (S.data && S.data.banners) || { apply: '', quiz: '' };
    const reminders = () => (S.data && S.data.reminders) || {};

    /* =====================================================================
     * DRAWING
     * =================================================================== */

    function host(cat) {
        const id = S.hosts[cat];
        return id ? document.getElementById(id) : null;
    }

    function draw() {
        ['quizzes', 'sent', 'nudges'].forEach((cat) => {
            const el = host(cat);
            if (!el) return;
            // Only the screen on show is redrawn: the other two are behind a
            // hidden parent, and rewriting them would throw away a half-typed
            // question every time somebody pressed Send.
            if (S.shown && cat !== S.shown) return;
            P.keepPlace(el, () => {
                el.innerHTML = gateHtml() || bodyFor(cat);
                try { icons(); } catch (_) {}
            });
        });
    }

    /** The one answer that replaces every screen: nothing to draw against. */
    function gateHtml() {
        if (!S.data && S.loading) return `<p class="cp-note" style="text-align:center;padding:2rem 0">Reading your quizzes…</p>`;
        if (S.error && !S.data) {
            // Two absences, told apart, exactly as the training and hiring
            // panels do it: a 404 is this crew centre's server having no quiz
            // routes, which no database update can fix; a *_missing code is the
            // VA's own project being behind, and the button fixes it.
            if (S.error.status === 404) return P.notBuiltHtml('Quizzes');
            if (P.isSchemaGap(S.error)) return P.schemaGapHtml(S.error);
            return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>
                ${esc(S.error.message || 'The quizzes could not be read.')}
                <div style="margin-top:.9rem"><button class="cp-btn" data-qa-retry>Try again</button></div></div>`;
        }
        if (!S.data) return '';
        if (!S.data.supported) {
            return P.schemaGapHtml({ code: 'store_quizzes_missing',
                message: 'This crew centre’s database can’t record quiz results yet.' });
        }
        return '';
    }

    function bodyFor(cat) {
        if (cat === 'sent') return sentHtml();
        if (cat === 'nudges') return nudgeHtml();
        return buildHtml();
    }

    /* ---- Build ---------------------------------------------------------- */

    function bannerHtml(slot, label, note, url) {
        return `<div class="qa-drop">
            <div class="qa-h">${esc(label)}</div>
            ${url ? `<img class="qa-banner" src="${esc(url)}" alt="">` : ''}
            <p class="cp-note">${esc(note)}</p>
            <div class="qa-acts">
                <label class="cp-btn cp-btn-sm" style="cursor:pointer">
                    <i data-lucide="image-up"></i> ${url ? 'Replace' : 'Upload'}
                    <input type="file" accept="image/*" style="display:none" data-qa-upload="${esc(slot)}">
                </label>
                ${url ? `<button class="cp-btn cp-btn-sm cp-btn-bad" data-qa-unbanner="${esc(slot)}">Remove</button>` : ''}
            </div>
            <label class="cp-label">…or paste a link
                <input class="cp-input" data-qa-bannerurl="${esc(slot)}" value="${esc(url || '')}"
                    placeholder="https://…" spellcheck="false"></label>
        </div>`;
    }

    function questionHtml(q, qi, quizId) {
        return `<div class="qa-q" data-qa-qi="${qi}">
            <div class="qa-row">
                <input class="cp-input qa-row-main" data-qa-qtext="${qi}" value="${esc(q.text || '')}"
                    placeholder="What do you want them to know?" maxlength="300">
                <button class="qa-x" title="Remove this question" data-qa-delq="${qi}">✕</button>
            </div>
            ${(q.options || []).map((o, oi) => `
                <div class="qa-opt">
                    <input type="radio" name="qa-correct-${esc(quizId)}-${qi}" data-qa-correct="${oi}"
                        ${Number(q.correct) === oi ? 'checked' : ''} title="This is the right one">
                    <input class="cp-input" data-qa-opt="${oi}" value="${esc(o)}" maxlength="200" placeholder="An answer">
                    <button class="qa-x" title="Remove this answer" data-qa-delopt="${oi}">✕</button>
                </div>`).join('')}
            <div class="qa-acts">
                <button class="cp-btn cp-btn-sm" data-qa-addopt="${qi}"><i data-lucide="plus"></i> Answer</button>
                <span class="cp-note" style="align-self:center">The filled circle is the right one.</span>
            </div>
        </div>`;
    }

    function quizHtml(q) {
        const isOpen = S.open === q.id;
        const bits = [`${q.questionCount} question${q.questionCount === 1 ? '' : 's'}`, `${q.passMark}% to pass`];
        if (q.maxAttempts) bits.push(`${q.maxAttempts} attempt${q.maxAttempts === 1 ? '' : 's'}`);
        else bits.push('unlimited attempts');
        if (q.open) bits.push('anyone can start it');
        if (!q.active) bits.push('off');

        if (!isOpen) {
            return `<div class="qa-card" data-qa-quiz="${esc(q.id)}">
                <div class="qa-row">
                    <div class="qa-row-main">
                        <div class="qa-name">${esc(q.title)}${q.ready ? '' : ' <span class="cp-chip cp-chip-warn">No questions yet</span>'}</div>
                        <div class="qa-sub">${esc(bits.join(' · '))}</div>
                    </div>
                    <div class="qa-acts"><button class="cp-btn cp-btn-sm" data-qa-edit="${esc(q.id)}">Edit</button></div>
                </div>
            </div>`;
        }

        return `<div class="qa-card" data-qa-quiz="${esc(q.id)}">
            <label class="cp-label">Name
                <input class="cp-input" data-qa-f="title" value="${esc(q.title)}" maxlength="120"></label>
            <label class="cp-label">What it is for
                <textarea class="cp-textarea" rows="2" data-qa-f="blurb" maxlength="600"
                    placeholder="Read before your first flight with us.">${esc(q.blurb || '')}</textarea></label>
            <div class="cp-grid2">
                <label class="cp-label">Pass mark (%)
                    <input class="cp-input" type="number" min="1" max="100" inputmode="numeric"
                        data-qa-f="passMark" value="${Number(q.passMark) || 80}"></label>
                <label class="cp-label">Attempts (0 = unlimited)
                    <input class="cp-input" type="number" min="0" max="20" inputmode="numeric"
                        data-qa-f="maxAttempts" value="${Number(q.maxAttempts) || 0}"></label>
            </div>
            <label class="qa-check"><input type="checkbox" data-qa-f="open" ${q.open ? 'checked' : ''}>
                <b>Any pilot can start this one<span>Otherwise it only opens for somebody staff have sent a link to.</span></b></label>
            <label class="qa-check"><input type="checkbox" data-qa-f="active" ${q.active ? 'checked' : ''}>
                <b>In use<span>Switch it off to keep it without anybody being able to sit it.</span></b></label>
            ${bannerHtml('quiz:' + q.id, 'Its own picture', 'Shown at the top of this quiz. Without one, your quiz banner below is used.', q.banner)}
            <div class="qa-h" style="margin-top:.3rem">Questions</div>
            ${(q.questions || []).map((qq, qi) => questionHtml(qq, qi, q.id)).join('')
                || '<p class="cp-note">No questions yet. A quiz with none cannot be sent out.</p>'}
            <div class="qa-acts">
                <button class="cp-btn cp-btn-sm" data-qa-addq><i data-lucide="plus"></i> Question</button>
                <button class="cp-btn cp-btn-sm cp-btn-bad" data-qa-delquiz="${esc(q.id)}">Delete quiz</button>
                <button class="cp-btn cp-btn-sm" data-qa-collapse>Done</button>
            </div>
        </div>`;
    }

    function buildHtml() {
        if (!S.data.canBuild) {
            return `<div class="cp-empty"><i data-lucide="lock"></i>
                Building quizzes is somebody else's job here. You can still send them out and read what came back.</div>`;
        }
        const g = gateCfg();
        const ready = quizzes().filter((q) => q.ready);

        const gate = `<div class="qa-gate">
            <div class="qa-h">The door</div>
            <label class="qa-check"><input type="checkbox" data-qa-g="enabled" ${g.enabled ? 'checked' : ''}>
                <b>Keep the crew centre shut until a pilot passes a quiz<span>Staff are never held at it, and nor is anybody who has already passed.</span></b></label>
            <label class="cp-label">Which quiz
                <select class="cp-select" data-qa-g="quizId">
                    <option value="">— pick one —</option>
                    ${ready.map((q) => `<option value="${esc(q.id)}" ${g.quizId === q.id ? 'selected' : ''}>${esc(q.title)}</option>`).join('')}
                </select></label>
            ${ready.length ? '' : '<p class="cp-note">Add a quiz with at least one question first — the door needs something to open with.</p>'}
            <label class="cp-label">What they read on the locked screen
                <textarea class="cp-textarea" rows="2" data-qa-g="message" maxlength="400"
                    placeholder="Welcome aboard. Your staff will send you the induction quiz shortly.">${esc(g.message || '')}</textarea></label>
            <label class="qa-check"><input type="checkbox" data-qa-g="allowSelfStart" ${g.allowSelfStart ? 'checked' : ''}>
                <b>Let pilots start it themselves<span>Off means it only opens when staff send somebody a link — which is what most airlines want.</span></b></label>
        </div>`;

        return `<div class="qa-sec">
            <p class="cp-note">A quiz is multiple-choice questions with a pass mark. Nothing here is on until you
                switch it on, and a VA that never opens this screen is unaffected.</p>
            ${quizzes().map(quizHtml).join('')}
            <div class="qa-acts">
                <button class="cp-btn" data-qa-newquiz><i data-lucide="plus"></i> New quiz</button>
            </div>
            ${gate}
            <div class="qa-h" style="margin-top:.4rem">Your pictures</div>
            ${bannerHtml('apply', 'Applications', 'Shown over your join form and your jobs board.', banners().apply)}
            ${bannerHtml('quiz', 'Quizzes', 'Shown over any quiz that has not got a picture of its own.', banners().quiz)}
            <div class="qa-acts" style="margin-top:.5rem">
                <button class="cp-btn cp-btn-primary" data-qa-save>Save</button>
            </div>
        </div>`;
    }

    /* ---- Send ----------------------------------------------------------- */

    function sentHtml() {
        if (!S.data.canReview) {
            return `<div class="cp-empty"><i data-lucide="lock"></i>
                Sending quizzes out goes with reviewing applications, and that is not one of your permissions.</div>`;
        }
        const ready = quizzes().filter((q) => q.ready && q.active);
        const rows = S.attempts || [];

        const send = `<div class="qa-card">
            <div class="qa-h">Send somebody a quiz</div>
            ${ready.length ? `
                <label class="cp-label">Quiz
                    <select class="cp-select" data-qa-sendquiz>
                        ${ready.map((q) => `<option value="${esc(q.id)}">${esc(q.title)}</option>`).join('')}
                    </select></label>
                <label class="cp-label">Pilot
                    <select class="cp-select" data-qa-sendwho>
                        <option value="">— pick a pilot —</option>
                        ${(S.roster || []).map((m) => `<option value="${esc(m.id)}">${esc(m.name || 'A pilot')}${m.callsign ? ` · ${esc(m.callsign)}` : ''}</option>`).join('')}
                    </select></label>
                <label class="cp-label">A word with it (optional)
                    <input class="cp-input" data-qa-sendnote maxlength="500" placeholder="Have a read of the SOP first."></label>
                <div class="qa-acts"><button class="cp-btn cp-btn-primary cp-btn-sm" data-qa-send>
                    <i data-lucide="send"></i> Send the link</button></div>
                <p class="cp-note">It lands in their inbox here as well, so a link pasted in Discord is not the only copy.</p>
                ${S.link ? `<div class="qa-link">${esc(S.link)}</div>
                    <div class="qa-acts"><button class="cp-btn cp-btn-sm" data-qa-copy="${esc(S.link)}">Copy it</button></div>` : ''}
            ` : '<p class="cp-note">Nothing to send yet. Build a quiz with at least one question first.</p>'}
        </div>`;

        const open = rows.filter((a) => a.status === 'issued' || a.status === 'started');
        const done = rows.filter((a) => a.status !== 'issued' && a.status !== 'started');

        const list = rows.length ? `
            ${open.length ? `<div class="qa-h">Out there</div>${open.map(attemptHtml).join('')}` : ''}
            ${done.length ? `<div class="qa-h" style="margin-top:.6rem">Marked</div>${done.map(attemptHtml).join('')}` : ''}`
            : `<div class="cp-empty"><i data-lucide="file-question"></i>
                Nobody has been sent one yet.</div>`;

        return `<div class="qa-sec">${send}${list}</div>`;
    }

    function attemptHtml(a) {
        const [label, chip] = STATE[a.status] || STATE.issued;
        const sub = [];
        if (a.total) sub.push(`${a.score}/${a.total} · ${a.percent}% against ${a.passMark}%`);
        if (a.attemptsUsed) sub.push(`${a.attemptsUsed} go${a.attemptsUsed === 1 ? '' : 'es'}${a.maxAttempts ? ` of ${a.maxAttempts}` : ''}`);
        if (a.submittedAt) sub.push(`handed in ${relativeText(a.submittedAt)}`);
        else if (a.createdAt) sub.push(`sent ${relativeText(a.createdAt)}`);
        if (a.gate) sub.push('this is the door');

        const acts = [];
        if (a.link) acts.push(`<button class="cp-btn cp-btn-sm" data-qa-copy="${esc(a.link)}">Copy link</button>`);
        if (a.status === 'issued' || a.status === 'started') {
            acts.push(`<button class="cp-btn cp-btn-sm cp-btn-bad" data-qa-revoke="${esc(a.id)}">Withdraw</button>`);
        }
        if (a.status === 'failed' || a.status === 'revoked') {
            acts.push(`<button class="cp-btn cp-btn-sm" data-qa-reissue="${esc(a.id)}">Another go</button>`);
        }
        if (a.status !== 'passed') {
            acts.push(`<button class="cp-btn cp-btn-sm" data-qa-unlock="${esc(a.id)}">Clear them</button>`);
        }

        return `<div class="qa-card">
            <div class="qa-row">
                <div class="qa-row-main">
                    <div class="qa-name">${esc(a.pilotName || 'A pilot')}${a.callsign ? ` · ${esc(a.callsign)}` : ''}
                        <span class="cp-chip ${chip}">${esc(label)}</span></div>
                    <div class="qa-sub">${esc(a.quizTitle)}${sub.length ? ` — ${esc(sub.join(' · '))}` : ''}</div>
                </div>
            </div>
            <div class="qa-acts">${acts.join('')}</div>
        </div>`;
    }

    /* ---- Nudge ---------------------------------------------------------- */

    function nudgeHtml() {
        if (!S.data.canBuild) {
            return `<div class="cp-empty"><i data-lucide="lock"></i>
                Setting up reminders goes with editing how people join, and that is not one of your permissions.</div>`;
        }
        const r = reminders();
        return `<div class="qa-sec">
            <p class="cp-note">What actually goes wrong at a volunteer airline is not that staff refuse the work —
                it is that nothing says the work is there. This posts a short digest to the channel your
                applications already go to, and only when something has been waiting.</p>
            <div class="qa-card">
                <label class="qa-check"><input type="checkbox" data-qa-r="enabled" ${r.enabled ? 'checked' : ''}>
                    <b>Remind my team<span>Nothing waiting, nothing sent.</span></b></label>
                <div class="cp-grid2">
                    <label class="cp-label">At most every (hours)
                        <input class="cp-input" type="number" min="1" max="168" inputmode="numeric"
                            data-qa-r="everyHours" value="${Number(r.everyHours) || 24}"></label>
                    <label class="cp-label">Once it has waited (hours)
                        <input class="cp-input" type="number" min="1" max="336" inputmode="numeric"
                            data-qa-r="afterHours" value="${Number(r.afterHours) || 24}"></label>
                </div>
                <label class="qa-check"><input type="checkbox" data-qa-r="applications" ${r.applications !== false ? 'checked' : ''}>
                    <b>Pilots waiting to be let in</b></label>
                <label class="qa-check"><input type="checkbox" data-qa-r="staffApplications" ${r.staffApplications !== false ? 'checked' : ''}>
                    <b>Pilots waiting on a staff job</b></label>
                <label class="qa-check"><input type="checkbox" data-qa-r="quizzes" ${r.quizzes !== false ? 'checked' : ''}>
                    <b>Quiz links sent and never handed in</b></label>
                <div class="qa-acts">
                    <button class="cp-btn cp-btn-primary cp-btn-sm" data-qa-savenudge>Save</button>
                    <button class="cp-btn cp-btn-sm" data-qa-preview>What would it say?</button>
                    <button class="cp-btn cp-btn-sm" data-qa-sendnudge>Send one now</button>
                </div>
                ${S.preview ? (S.preview.lines && S.preview.lines.length
                    ? `<div class="qa-link">${S.preview.lines.map(l => esc(l.replace(/\*\*/g, ''))).join('<br>')}</div>`
                    : `<p class="cp-note">Nothing is waiting${S.preview.skipped ? ` — ${esc(S.preview.skipped)}` : ''}. Nothing would be sent.</p>`) : ''}
                <p class="cp-note">It goes to your recruitment webhook — the one under Settings → Alerts.</p>
            </div>
        </div>`;
    }

    /* =====================================================================
     * WRITING
     *
     * The builder reads the DOM back rather than keeping a model in step with
     * it: one save, one read, and nothing to drift. The server sanitises
     * everything anyway, so what is sent is a proposal rather than a record.
     * =================================================================== */

    function readQuizzes(root) {
        return quizzes().map((q) => {
            const card = root.querySelector(`[data-qa-quiz="${CSS.escape(q.id)}"]`);
            // A quiz whose editor is collapsed is sent back as it came: it was
            // not on screen to be edited, and rebuilding it from nothing would
            // lose its questions.
            if (!card || S.open !== q.id) return q;
            const val = (f) => {
                const el = card.querySelector(`[data-qa-f="${f}"]`);
                if (!el) return q[f];
                return el.type === 'checkbox' ? el.checked : el.value;
            };
            const questions = [...card.querySelectorAll('[data-qa-qi]')].map((qel) => ({
                id: '',
                text: (qel.querySelector('[data-qa-qtext]') || {}).value || '',
                options: [...qel.querySelectorAll('[data-qa-opt]')].map((o) => o.value),
                correct: [...qel.querySelectorAll('[data-qa-correct]')].findIndex((r) => r.checked),
            }));
            return {
                ...q,
                title: val('title'), blurb: val('blurb'),
                passMark: Number(val('passMark')) || 80,
                maxAttempts: Number(val('maxAttempts')) || 0,
                open: !!val('open'), active: !!val('active'),
                questions,
            };
        });
    }

    function readGate(root) {
        const val = (f) => {
            const el = root.querySelector(`[data-qa-g="${f}"]`);
            if (!el) return gateCfg()[f];
            return el.type === 'checkbox' ? el.checked : el.value;
        };
        return {
            enabled: !!val('enabled'), quizId: val('quizId') || '',
            message: val('message') || '', allowSelfStart: !!val('allowSelfStart'),
        };
    }

    // Found by reading the attribute back rather than by selector: a slot is
    // `quiz:<id>`, and a colon inside an attribute selector is one escaping
    // rule nobody should have to remember correctly.
    function bannerField(root, slot) {
        return [...root.querySelectorAll('[data-qa-bannerurl]')]
            .find((el) => el.getAttribute('data-qa-bannerurl') === slot) || null;
    }

    function readBanners(root) {
        const out = { ...banners() };
        root.querySelectorAll('[data-qa-bannerurl]').forEach((el) => {
            const slot = el.getAttribute('data-qa-bannerurl');
            if (slot === 'apply' || slot === 'quiz') out[slot] = el.value.trim();
        });
        return out;
    }

    async function save(btn) {
        const root = host('quizzes');
        if (!root) return;
        // A quiz banner typed into a per-quiz box rides on the quiz itself.
        const list = readQuizzes(root).map((q) => {
            const el = bannerField(root, 'quiz:' + q.id);
            return el ? { ...q, banner: el.value.trim() } : q;
        });
        const done = P.busy(btn, 'Saving…');
        try {
            await S.api('/quizzes', { method: 'POST', body: {
                quizzes: list, gate: readGate(root), banners: readBanners(root),
            } });
            S.open = '';
            await load();
            P.toast('Saved for your crew.', 'ok');
        } catch (err) { P.toast((err && err.message) || 'That didn’t save.', 'bad'); }
        finally { done(); }
    }

    async function saveNudges(btn) {
        const root = host('nudges');
        if (!root) return;
        const val = (f) => {
            const el = root.querySelector(`[data-qa-r="${f}"]`);
            if (!el) return undefined;
            return el.type === 'checkbox' ? el.checked : Number(el.value);
        };
        const done = P.busy(btn, 'Saving…');
        try {
            await S.api('/quizzes', { method: 'POST', body: { reminders: {
                enabled: val('enabled'), everyHours: val('everyHours'), afterHours: val('afterHours'),
                applications: val('applications'), staffApplications: val('staffApplications'),
                quizzes: val('quizzes'),
            } } });
            await load();
            P.toast('Saved for your crew.', 'ok');
        } catch (err) { P.toast((err && err.message) || 'That didn’t save.', 'bad'); }
        finally { done(); }
    }

    /**
     * A banner, off the staff member's own computer.
     *
     * Sent as multipart rather than through the JSON api helper, because it is
     * a file — same upload path as the event picture, so a VA gets the same
     * resizing and the same bucket.
     */
    async function upload(slot, file, input) {
        if (!file) return;
        const base = String(S.cfg.backend || '').replace(/\/+$/, '');
        const form = new FormData();
        form.append('image', file);
        form.append('slot', slot);
        P.toast('Uploading…', 'info');
        try {
            const res = await fetch(`${base}/api/crew/${encodeURIComponent(S.cfg.slug)}/quizzes/banner`, {
                method: 'POST',
                headers: { Accept: 'application/json', Authorization: 'Bearer ' + (S.cfg.token || '') },
                body: form,
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'That didn’t upload.');
            await load();
            P.toast('Picture saved.', 'ok');
        } catch (err) { P.toast((err && err.message) || 'That didn’t upload.', 'bad'); }
        finally { if (input) input.value = ''; }
    }

    async function send(btn) {
        const root = host('sent');
        const quizId = (root.querySelector('[data-qa-sendquiz]') || {}).value || '';
        const memberId = (root.querySelector('[data-qa-sendwho]') || {}).value || '';
        const note = (root.querySelector('[data-qa-sendnote]') || {}).value || '';
        if (!memberId) return P.toast('Pick a pilot first.', 'bad');
        const done = P.busy(btn, 'Sending…');
        try {
            const d = await S.api('/quiz-attempts', { method: 'POST', body: { quizId, memberId, note } });
            S.link = d.link || '';
            await load();
            P.toast('Sent. It is in their inbox too.', 'ok');
        } catch (err) {
            // "They already have one" comes back with the existing link on it,
            // because the thing the sender actually wants at that moment is
            // that link rather than an apology.
            if (err && err.code === 'already_issued') { S.link = ''; draw(); }
            P.toast((err && err.message) || 'That didn’t send.', 'bad');
        } finally { done(); }
    }

    async function act(id, body, okMsg, btn) {
        const done = P.busy(btn, false);
        try {
            await S.api(`/quiz-attempts/${encodeURIComponent(id)}`, { method: 'PATCH', body });
            await load();
            if (okMsg) P.toast(okMsg, 'ok');
        } catch (err) { P.toast((err && err.message) || 'That didn’t work.', 'bad'); }
        finally { done(); }
    }

    async function previewNudge(btn) {
        const done = P.busy(btn, 'Looking…');
        try {
            S.preview = await S.api('/staff-reminders/preview');
            draw();
        } catch (err) { P.toast((err && err.message) || 'Could not work that out.', 'bad'); }
        finally { done(); }
    }

    async function sendNudge(btn) {
        const yes = await P.ask({
            title: 'Send the reminder now?',
            body: 'It posts to your recruitment channel, the same as the scheduled one would.',
            confirm: 'Send it',
        });
        if (!yes) return;
        const done = P.busy(btn, 'Sending…');
        try {
            const d = await S.api('/staff-reminders/send', { method: 'POST' });
            P.toast(d.sent ? 'Sent to your channel.' : 'Nothing was waiting, so nothing was sent.', d.sent ? 'ok' : 'info');
        } catch (err) { P.toast((err && err.message) || 'That didn’t send.', 'bad'); }
        finally { done(); }
    }

    /* ---- Editing the shape of a quiz, before it is saved ----------------
       These change what is on screen and nothing else. Nothing is written
       until Save, which is why they edit the local copy rather than posting. */

    function patchOpenQuiz(fn) {
        const root = host('quizzes');
        if (!root) return;
        const list = readQuizzes(root);
        const i = list.findIndex((q) => q.id === S.open);
        if (i < 0) return;
        fn(list[i]);
        S.data.quizzes = list;
        draw();
    }

    /* =====================================================================
     * WIRING
     * =================================================================== */

    function wire(el) {
        if (el.dataset.qaWired) return;
        el.dataset.qaWired = '1';

        el.addEventListener('change', (ev) => {
            const up = ev.target.closest('[data-qa-upload]');
            if (up) { upload(up.getAttribute('data-qa-upload'), up.files && up.files[0], up); }
        });

        el.addEventListener('click', (ev) => {
            const t = ev.target;
            if (t.closest('[data-qa-retry]')) { load(); return; }

            const copy = t.closest('[data-qa-copy]');
            if (copy) {
                const text = copy.getAttribute('data-qa-copy');
                navigator.clipboard.writeText(text)
                    .then(() => P.toast('Link copied.', 'ok'))
                    .catch(() => P.toast('Could not copy it — select it by hand.', 'bad'));
                return;
            }

            const edit = t.closest('[data-qa-edit]');
            if (edit) { S.open = edit.getAttribute('data-qa-edit'); draw(); return; }
            if (t.closest('[data-qa-collapse]')) { S.open = ''; draw(); return; }

            if (t.closest('[data-qa-newquiz]')) {
                const n = quizzes().length + 1;
                const fresh = { id: `quiz-${Date.now().toString(36)}`, title: `Quiz ${n}`, blurb: '', banner: '',
                    passMark: 80, maxAttempts: 3, open: false, active: true, ready: false,
                    questionCount: 0, questions: [] };
                S.data.quizzes = [...quizzes(), fresh];
                S.open = fresh.id;
                draw();
                return;
            }

            const delq = t.closest('[data-qa-delquiz]');
            if (delq) {
                const id = delq.getAttribute('data-qa-delquiz');
                P.ask({
                    title: 'Delete this quiz?',
                    body: 'Results already recorded against it stay where they are — they keep their own copy of what was sat.',
                    confirm: 'Delete', danger: true,
                }).then((yes) => {
                    if (!yes) return;
                    S.data.quizzes = quizzes().filter((q) => q.id !== id);
                    S.open = '';
                    draw();
                    P.toast('Removed here. Press Save to make it stick.', 'info');
                });
                return;
            }

            if (t.closest('[data-qa-addq]')) {
                patchOpenQuiz((q) => { q.questions = [...(q.questions || []), { text: '', options: ['', ''], correct: 0 }]; });
                return;
            }
            const delQ = t.closest('[data-qa-delq]');
            if (delQ) {
                const i = Number(delQ.getAttribute('data-qa-delq'));
                patchOpenQuiz((q) => { q.questions = (q.questions || []).filter((_, n) => n !== i); });
                return;
            }
            const addOpt = t.closest('[data-qa-addopt]');
            if (addOpt) {
                const i = Number(addOpt.getAttribute('data-qa-addopt'));
                patchOpenQuiz((q) => {
                    const qq = (q.questions || [])[i];
                    if (qq && qq.options.length < 6) qq.options = [...qq.options, ''];
                });
                return;
            }
            const delOpt = t.closest('[data-qa-delopt]');
            if (delOpt) {
                const oi = Number(delOpt.getAttribute('data-qa-delopt'));
                const qi = Number((delOpt.closest('[data-qa-qi]') || {}).getAttribute('data-qa-qi'));
                patchOpenQuiz((q) => {
                    const qq = (q.questions || [])[qi];
                    if (!qq || qq.options.length <= 2) return P.toast('A question needs at least two answers.', 'bad');
                    qq.options = qq.options.filter((_, n) => n !== oi);
                    if (qq.correct >= qq.options.length) qq.correct = 0;
                });
                return;
            }

            const unb = t.closest('[data-qa-unbanner]');
            if (unb) {
                const slot = unb.getAttribute('data-qa-unbanner');
                const root = host('quizzes');
                const field = root && bannerField(root, slot);
                if (field) field.value = '';
                if (slot.startsWith('quiz:')) patchOpenQuiz((q) => { q.banner = ''; });
                else { S.data.banners = { ...banners(), [slot]: '' }; draw(); }
                P.toast('Removed here. Press Save to make it stick.', 'info');
                return;
            }

            if (t.closest('[data-qa-save]')) { save(t.closest('[data-qa-save]')); return; }
            if (t.closest('[data-qa-savenudge]')) { saveNudges(t.closest('[data-qa-savenudge]')); return; }
            if (t.closest('[data-qa-preview]')) { previewNudge(t.closest('[data-qa-preview]')); return; }
            if (t.closest('[data-qa-sendnudge]')) { sendNudge(t.closest('[data-qa-sendnudge]')); return; }
            if (t.closest('[data-qa-send]')) { send(t.closest('[data-qa-send]')); return; }

            const rev = t.closest('[data-qa-revoke]');
            if (rev) { act(rev.getAttribute('data-qa-revoke'), { action: 'revoke' }, 'Withdrawn.', rev); return; }
            const re = t.closest('[data-qa-reissue]');
            if (re) { act(re.getAttribute('data-qa-reissue'), { action: 'reissue' }, 'A fresh link is on its way to them.', re); return; }
            const un = t.closest('[data-qa-unlock]');
            if (un) {
                P.ask({
                    title: 'Clear this pilot?',
                    body: 'It is recorded as a pass, with your name on it. If the door is on, they are through it.',
                    confirm: 'Clear them',
                }).then((yes) => { if (yes) act(un.getAttribute('data-qa-unlock'), { action: 'unlock' }, 'Cleared.', un); });
                return;
            }
        });
    }

    /* =====================================================================
     * MOUNTING
     * =================================================================== */

    function mount({ backend, slug, token, hosts } = {}) {
        styles();
        S.cfg = { backend, slug, token };
        S.hosts = hosts || {};
        S.api = P.api({ backend, slug, token });
        Object.keys(S.hosts).forEach((cat) => { const el = host(cat); if (el) wire(el); });
        load();
    }

    /** The drawer telling us which screen is up, so only that one is drawn. */
    function show(cat) {
        S.shown = cat;
        if (!S.data && !S.loading) load();
        else draw();
    }

    window.CrewQuizAdmin = { mount, show, reload: load };
})();
