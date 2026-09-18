/* ============================================================================
   crewStaffApply.js — a pilot putting their name forward for a job on the team.

   WHY THIS EXISTS

   Every airline on this platform recruits its staff the same way:

     the owner decides they need a second PIREP reviewer → says so in Discord →
     three people volunteer in a thread → the owner asks each of them the same
     questions → picks one → remembers, eventually, to give them an account

   None of it is recorded anywhere. The pilot who volunteered in March and
   never heard back does not know whether they were turned down or forgotten,
   and the honest answer is usually the second. The owner, meanwhile, is the
   only person who can see the queue, because there is no queue — so hiring
   stops entirely whenever they are busy, which at a volunteer airline is most
   of the time.

   WHAT THIS IS

   The airline advertises jobs. A pilot reads what the job actually involves —
   in the airline's own words, and including what it would let them DO, which
   is a thing volunteers are rarely told before they say yes — answers the
   questions, and can see afterwards that the ask exists and where it got to.

   WHAT THIS SCREEN DOES NOT DECIDE

   Whether they may apply. It shows the hours bar and how far off they are,
   which is worth showing even when they are short — being told "you need 25
   hours and you have 12" is a reason to keep flying, where a hidden job is
   nothing at all. The server decides what an application is allowed to be, and
   the server is what turns an accepted one into a staff account.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewStaffApply: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText } = P;

    const S = {
        api: null,
        panel: null,
        data: null,        // GET /staff-openings
        loading: false,
        error: null,
        applying: null,    // the opening id whose form is open
        sending: false,
    };

    const STATE = {
        pending: ['Waiting on staff', 'cp-chip-warn'],
        accepted: ['Accepted', 'cp-chip-ok'],
        declined: ['Not this time', 'cp-chip-mute'],
        withdrawn: ['Withdrawn', 'cp-chip-mute'],
    };

    const hrs = (h) => `${Math.round(Number(h) || 0).toLocaleString()}h`;

    function styles() {
        P.baseStyles();
        P.style('crew-staff-apply', `
        .sa-sec{ display:grid; gap:.55rem; }
        .sa-h{ font-size:.72rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
            color:var(--faint,#A8A296); }
        .sa-job{ border:1px solid var(--line,#e5e5e5); border-radius:.9rem; padding:.85rem .9rem;
            background:var(--surface,#fff); }
        .sa-job-head{ display:flex; gap:.6rem; align-items:flex-start; }
        .sa-job-title{ font-size:.95rem; font-weight:800; letter-spacing:-.01em; min-width:0; flex:1; }
        .sa-job-role{ font-size:.75rem; color:var(--muted,#736E64); margin-top:.1rem;
            display:flex; align-items:center; gap:.35rem; }
        .sa-dot{ width:.55rem; height:.55rem; border-radius:50%; flex:none;
            background:var(--accent); }
        .sa-blurb{ font-size:.85rem; margin-top:.5rem; white-space:pre-wrap; }

        /* WHAT THE JOB LETS YOU DO. The half of a volunteer request nobody
           ever states, and the half that decides whether somebody should be
           saying yes to it. */
        .sa-can{ margin-top:.6rem; padding:.55rem .65rem; border-radius:.6rem;
            background:color-mix(in srgb, var(--ink,#1C1A16) 4%, transparent); }
        .sa-can-h{ font-size:.7rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
            color:var(--faint,#A8A296); margin-bottom:.25rem; }
        .sa-can ul{ margin:0; padding-left:1rem; }
        .sa-can li{ font-size:.79rem; padding:.05rem 0; }

        /* The hours bar. Shown short rather than hidden — the gap is the
           message, exactly as it is on the training ladder. */
        .sa-bar{ height:.4rem; border-radius:999px; margin-top:.55rem; overflow:hidden;
            background:color-mix(in srgb, var(--ink,#1C1A16) 8%, transparent); }
        .sa-bar span{ display:block; height:100%; border-radius:999px; background:var(--accent);
            transition:width .6s cubic-bezier(.22,1.12,.36,1); }
        .sa-gap{ font-size:.75rem; color:var(--muted,#736E64); margin-top:.3rem; }
        .sa-gap b{ color:var(--ink,#1C1A16); }

        .sa-act{ display:flex; gap:.4rem; margin-top:.7rem; }
        .sa-form{ margin-top:.7rem; display:grid; gap:.6rem; }
        .sa-q{ display:grid; gap:.25rem; }
        .sa-mine{ border:1px solid var(--line,#e5e5e5); border-radius:.8rem; padding:.7rem .8rem;
            background:var(--surface,#fff); }
        .sa-mine-head{ display:flex; gap:.5rem; align-items:center; }
        .sa-mine-title{ font-size:.88rem; font-weight:700; min-width:0; flex:1; }
        .sa-mine-when{ font-size:.73rem; color:var(--faint,#A8A296); }
        .sa-said{ font-size:.82rem; margin-top:.45rem; padding:.5rem .6rem; border-radius:.55rem;
            background:color-mix(in srgb, var(--ink,#1C1A16) 4%, transparent); white-space:pre-wrap; }
        `);
    }

    /* =====================================================================
     * READING
     * =================================================================== */

    async function load() {
        S.loading = true; S.error = null;
        draw();
        try { S.data = await S.api('/staff-openings'); }
        catch (err) { S.error = err; }
        S.loading = false;
        draw();
    }

    const openings = () => (S.data && S.data.openings) || [];
    const mine = () => (S.data && S.data.mine) || [];
    const myHours = () => Number(S.data && S.data.hours) || 0;

    /** My live ask against this job, if there is one. */
    const askFor = (id) => mine().find((a) => a.openingId === id && a.status === 'pending') || null;

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

    function jobHtml(o) {
        const asked = askFor(o.id);
        const need = Number(o.minHours) || 0;
        const have = myHours();
        const short = need > 0 && have < need;
        const pct = need > 0 ? Math.max(0, Math.min(100, (have / need) * 100)) : 100;

        const can = (o.can || []).length ? `
            <div class="sa-can">
                <div class="sa-can-h">What it lets you do</div>
                <ul>${o.can.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
            </div>` : '';

        const bar = need > 0 ? `
            <div class="sa-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
            <div class="sa-gap">${short
                ? `Asks for <b>${hrs(need)}</b> — you have <b>${hrs(have)}</b>.`
                : `Asks for <b>${hrs(need)}</b>, and you have <b>${hrs(have)}</b>.`}</div>` : '';

        let action;
        if (asked) {
            action = `<span class="cp-chip cp-chip-warn">You’ve applied</span>`;
        } else if (S.data && S.data.isStaff) {
            // Staff never see this panel in practice — the tile is not drawn
            // for them — but a shared link would, and "apply for a job you
            // already have" is a worse answer than saying so.
            action = `<span class="cp-chip cp-chip-mute">You’re already staff</span>`;
        } else if (short) {
            action = `<button class="cp-btn cp-btn-sm" disabled>Keep flying</button>`;
        } else {
            action = `<button class="cp-btn cp-btn-primary cp-btn-sm" data-sa-apply="${esc(o.id)}">Apply</button>`;
        }

        const form = S.applying === o.id ? formHtml(o) : '';

        return `<div class="sa-job" data-sa-job="${esc(o.id)}">
            <div class="sa-job-head">
                <div class="sa-job-title">${esc(o.title)}
                    ${o.roleName ? `<div class="sa-job-role">
                        <span class="sa-dot" style="${o.roleColor ? `background:${esc(o.roleColor)}` : ''}"></span>
                        ${esc(o.roleName)}</div>` : ''}
                </div>
                ${o.open ? '' : '<span class="cp-chip cp-chip-mute">Closed</span>'}
            </div>
            ${o.blurb ? `<div class="sa-blurb">${esc(o.blurb)}</div>` : ''}
            ${can}
            ${bar}
            <div class="sa-act">${action}</div>
            ${form}
        </div>`;
    }

    function formHtml(o) {
        const qs = (o.questions || []);
        return `<div class="sa-form">
            ${qs.length ? qs.map((q, i) => `
                <div class="sa-q">
                    <label class="cp-label" for="sa-q-${esc(o.id)}-${i}">${esc(q)}</label>
                    <textarea class="cp-textarea" rows="3" id="sa-q-${esc(o.id)}-${i}" data-sa-answer="${i}"></textarea>
                </div>`).join('')
                : '<p class="cp-note">No questions — just say yes and the airline will be in touch.</p>'}
            <div class="sa-act">
                <button class="cp-btn cp-btn-primary cp-btn-sm" data-sa-send="${esc(o.id)}">Send it</button>
                <button class="cp-btn cp-btn-sm" data-sa-cancel>Not now</button>
            </div>
        </div>`;
    }

    function mineHtml(a) {
        const [label, chip] = STATE[a.status] || STATE.pending;
        return `<div class="sa-mine">
            <div class="sa-mine-head">
                <div class="sa-mine-title">${esc(a.position || 'A job')}</div>
                <span class="cp-chip ${chip}">${esc(label)}</span>
            </div>
            <div class="sa-mine-when">Applied ${esc(relativeText(a.createdAt) || 'recently')}</div>
            ${a.staffMessage ? `<div class="sa-said">${esc(a.staffMessage)}</div>` : ''}
            ${a.status === 'pending'
                ? `<div class="sa-act"><button class="cp-btn cp-btn-sm" data-sa-withdraw="${esc(a.id)}">Withdraw</button></div>`
                : ''}
        </div>`;
    }

    function bodyHtml() {
        if (!S.data && S.loading) return `<p class="cp-note" style="text-align:center;padding:2rem 0">Looking for openings…</p>`;
        if (S.error && !S.data) {
            // Two different absences, told apart, exactly as the training panel
            // does it. A 409 with a *_missing code is the VA's project being
            // behind and the update button fixes it; a 404 is this crew
            // center's server having no hiring routes at all, which no database
            // update can touch.
            if (S.error.status === 404) return P.notBuiltHtml('Staff applications');
            if (P.isSchemaGap(S.error)) return P.schemaGapHtml(S.error);
            return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>
                ${esc(S.error.message || 'The openings could not be read.')}
                <div style="margin-top:.9rem"><button class="cp-btn" data-sa-retry>Try again</button></div></div>`;
        }
        if (!S.data) return '';

        // A project that has not re-run the SQL can show the jobs but has
        // nowhere to put an application. Saying so is better than a form that
        // throws on send — and the button that fixes it is the one the rest of
        // the crew centre already uses.
        if (!S.data.supported) return P.schemaGapHtml({ code: 'store_staff_apps_missing',
            message: 'This crew centre’s database can’t take staff applications yet.' });

        const jobs = openings().filter((o) => o.open || askFor(o.id));
        const asks = mine();

        const jobsHtml = jobs.length
            ? `<div class="sa-sec">
                   <div class="sa-h">Open positions</div>
                   ${jobs.map(jobHtml).join('')}
               </div>`
            : `<div class="cp-empty"><i data-lucide="user-search"></i>
                   Nothing is being advertised right now. Your airline posts jobs here when it needs a hand —
                   worth checking back, and worth saying so in Discord if you’d like to help.</div>`;

        const mineSection = asks.length
            ? `<div class="sa-sec" style="margin-top:1.2rem">
                   <div class="sa-h">Your applications</div>
                   ${asks.map(mineHtml).join('')}
               </div>`
            : '';

        return jobsHtml + mineSection;
    }

    /* =====================================================================
     * DOING
     * =================================================================== */

    async function send(openingId, btn) {
        if (S.sending) return;
        const job = openings().find((o) => o.id === openingId);
        if (!job) return;
        const box = S.panel.el.querySelector(`[data-sa-job="${CSS.escape(openingId)}"]`);
        // Positional, and deliberately: the server pairs these against ITS copy
        // of the questions, so sending question text from here would be sending
        // something it has no reason to trust and does not read.
        const answers = [...(box ? box.querySelectorAll('[data-sa-answer]') : [])]
            .sort((a, b) => +a.getAttribute('data-sa-answer') - +b.getAttribute('data-sa-answer'))
            .map((el) => el.value.trim());

        S.sending = true;
        const done = P.busy(btn, 'Sending…');
        try {
            await S.api('/staff-applications', { method: 'POST', body: { openingId, answers } });
            S.applying = null;
            await load();
            P.toast('Sent. Your staff will come back to you.', 'ok');
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t send.', 'bad');
        } finally { S.sending = false; done(); }
    }

    async function withdraw(id, btn) {
        const yes = await P.ask({
            title: 'Withdraw this application?',
            body: 'Your staff will no longer see it. You can apply again while the job is still open.',
            confirm: 'Withdraw',
        });
        if (!yes) return;
        const done = P.busy(btn, 'Withdrawing…');
        try {
            await S.api(`/staff-applications/${encodeURIComponent(id)}`, { method: 'PATCH', body: { action: 'withdraw' } });
            await load();
            P.toast('Withdrawn.', 'ok');
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t work.', 'bad');
        } finally { done(); }
    }

    /* =====================================================================
     * WIRING
     * =================================================================== */

    function wire(panel) {
        if (panel.el.dataset.saWired) return;
        panel.el.dataset.saWired = '1';
        panel.el.addEventListener('click', (ev) => {
            const t = ev.target;
            if (t.closest('[data-sa-retry]')) { load(); return; }
            const ap = t.closest('[data-sa-apply]');
            if (ap) { S.applying = ap.getAttribute('data-sa-apply'); draw(); return; }
            if (t.closest('[data-sa-cancel]')) { S.applying = null; draw(); return; }
            const go = t.closest('[data-sa-send]');
            if (go) { send(go.getAttribute('data-sa-send'), go); return; }
            const wd = t.closest('[data-sa-withdraw]');
            if (wd) { withdraw(wd.getAttribute('data-sa-withdraw'), wd); return; }
        });
    }

    function open({ api } = {}) {
        if (typeof api !== 'function') { console.warn('crewStaffApply: needs an api function'); return; }
        styles();
        S.api = api;
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewStaffApply', title: 'Join the team', icon: 'briefcase' });
            wire(S.panel);
        }
        S.panel.open();
        draw();
        load();
    }

    window.CrewStaffApply = { open, close: () => S.panel && S.panel.close() };
})();
