/* ============================================================================
   crewTraining.js — the ladder, and how a pilot actually climbs it.

   WHY THIS EXISTS

   A VA's ranks are a list of names with an hours figure beside each. That is
   enough to DISPLAY a rank and nothing like enough to award one. Every airline
   on this platform runs the same process in Discord instead:

     a pilot asks whether they are ready → somebody checks their hours by hand →
     a date is agreed → an examiner flies with them → a message says "passed" →
     somebody remembers to change their rank

   Six steps, none of them recorded, and the last one is the one that gets
   forgotten. Pilots who passed a check-ride in March are still First Officers
   in June, and the only evidence it happened is a message in a channel that
   has scrolled.

   WHAT THIS IS

   The same six steps, written down. A pilot sees exactly what stands between
   them and the next seat, asks when they are ready, and the request is a row
   rather than a message. Staff schedule it, fly it, and record the result —
   and recording a pass is the same act as the promotion, so it cannot be the
   step that gets forgotten.

   THE LADDER IS THE VA'S OWN

   Ranks come from the crew record, which the owner already edits in Settings.
   This adds a second, optional requirement per rank — flights, and a note in
   the VA's own words ("must have flown a transatlantic") — and nothing else.
   A training system that needs its own copy of the ranks is a training system
   that disagrees with the roster by the second month.

   WHAT THE CLIENT DOES NOT DECIDE

   Whether a pilot is eligible. It shows the gap between what they have and
   what the rank asks — which is worth showing even when they are short, and is
   the whole point of the pilot's half of this screen — but the server decides
   what a request is allowed to be, and the server moves the rank.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewTraining: crewPanels.js must load first'); return; }
    const { esc, icons, whenText, relativeText, durationText } = P;

    const S = {
        api: null,
        panel: null,
        view: 'me',          // me | queue | setup
        data: null,          // GET /training
        loading: false,
        error: null,
        editing: null,
    };

    const STATE = {
        requested: ['Requested', 'cp-chip-warn'],
        scheduled: ['Scheduled', 'cp-chip-accent'],
        passed: ['Passed', 'cp-chip-ok'],
        failed: ['Not yet', 'cp-chip-mute'],
        withdrawn: ['Withdrawn', 'cp-chip-mute'],
    };

    const hrs = (h) => `${Math.round(Number(h) || 0).toLocaleString()}h`;

    /**
     * When the check-ride is, in the examiner's own words where there are any.
     *
     * The prompt invites a sentence — "Saturday 19:00Z, KJFK → EGLL" — and a
     * date formatter throws away the half of that the pilot actually needs, so
     * `scheduledText` wins over the parsed instant. The instant is what the
     * server sorts and reminds by; this is what a person reads.
     */
    function scheduleLine(r) {
        const when = (r && r.scheduledText) || whenText(r && r.scheduledAt);
        if (!when) return 'Your staff will pick a time with you.';
        return `With ${esc((r && r.examinerName) || 'an examiner')} · ${esc(when)}`;
    }

    function styles() {
        P.baseStyles();
        P.style('crew-training', `
        .tr-tabs{ display:flex; gap:.35rem; padding:.25rem; border-radius:999px;
            background:color-mix(in srgb, var(--ink,#1C1A16) 6%, transparent); margin-bottom:.4rem; }
        .tr-tab{ flex:1; border:0; background:none; cursor:pointer; font:inherit; font-size:.8rem;
            font-weight:700; padding:.45rem .7rem; border-radius:999px; color:var(--muted,#736E64); }
        .tr-tab-on{ background:var(--surface,#fff); color:var(--ink,#1C1A16); box-shadow:0 1px 2px rgb(0 0 0 / .12); }

        /* ---- The ladder -------------------------------------------------
           A vertical spine with a node per rank. Where the pilot is now is
           filled; everything above is an outline. It is the one drawing that
           answers "how far" without anybody reading a number. */
        .tr-ladder{ display:grid; gap:0; margin:.2rem 0 .6rem; }
        .tr-step{ display:grid; grid-template-columns:1.6rem 1fr; gap:.75rem; align-items:start; }
        .tr-spine{ position:relative; display:flex; justify-content:center; }
        .tr-spine::before{ content:''; position:absolute; top:1.1rem; bottom:-.2rem; width:2px;
            background:var(--line,#e5e5e5); }
        .tr-step:last-child .tr-spine::before{ display:none; }
        .tr-node{ position:relative; z-index:1; width:.85rem; height:.85rem; margin-top:.35rem;
            border-radius:50%; border:2px solid var(--line,#e5e5e5); background:var(--surface,#fff); }
        .tr-done .tr-node{ background:var(--accent); border-color:var(--accent); }
        .tr-here .tr-node{ background:var(--accent); border-color:var(--accent);
            box-shadow:0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent); }
        .tr-done .tr-spine::before{ background:color-mix(in srgb, var(--accent) 55%, transparent); }
        .tr-body{ padding-bottom:.9rem; min-width:0; }
        .tr-name{ font-size:.92rem; font-weight:700; letter-spacing:-.01em; }
        .tr-here .tr-name{ color:var(--accent); }
        .tr-need{ font-size:.78rem; color:var(--muted,#736E64); margin-top:.1rem; }
        .tr-note{ font-size:.78rem; color:var(--muted,#736E64); margin-top:.25rem; }

        /* The bar under the next rank. Shows the shortfall, never a full bar
           on a rank that has not been awarded — the gap IS the message. */
        .tr-bar{ height:.4rem; border-radius:999px; background:color-mix(in srgb, var(--ink,#1C1A16) 8%, transparent);
            overflow:hidden; margin-top:.45rem; }
        .tr-bar span{ display:block; height:100%; border-radius:999px; background:var(--accent);
            transition:width .6s cubic-bezier(.22,1.12,.36,1); }
        .tr-gap{ font-size:.74rem; color:var(--muted,#736E64); margin-top:.3rem; }
        .tr-gap b{ color:var(--ink,#1C1A16); }

        .tr-req{ display:flex; gap:.5rem; align-items:center; font-size:.8rem; padding:.25rem 0; }
        .tr-req i{ width:.95rem; height:.95rem; flex:none; }
        .tr-met{ color:var(--ink,#1C1A16); } .tr-met i{ color:#16A34A; }
        .tr-unmet{ color:var(--muted,#736E64); } .tr-unmet i{ color:var(--faint,#A8A296); }

        .tr-row{ display:flex; gap:.75rem; align-items:center; padding:.7rem .8rem;
            border:1px solid var(--line,#e5e5e5); border-radius:.8rem; background:var(--surface,#fff); }
        .tr-row-main{ min-width:0; flex:1; }
        .tr-row-name{ font-size:.88rem; font-weight:700; letter-spacing:-.01em; }
        .tr-row-sub{ font-size:.75rem; color:var(--muted,#736E64); margin-top:.1rem; }
        .tr-row-act{ display:flex; gap:.35rem; flex:none; }
        .tr-sec{ display:grid; gap:.55rem; }
        .tr-h{ font-size:.72rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
            color:var(--faint,#A8A296); }
        `);
    }

    /* =====================================================================
     * READING
     * =================================================================== */

    async function load() {
        S.loading = true; S.error = null;
        draw();
        try { S.data = await S.api('/training'); }
        catch (err) { S.error = err; }
        S.loading = false;
        draw();
    }

    const ranks = () => (S.data && S.data.ranks) || [];
    const me = () => (S.data && S.data.me) || null;

    /** Where this pilot sits on the ladder, by name. -1 when unranked. */
    function myIndex() {
        const m = me();
        if (!m || !m.rank) return -1;
        return ranks().findIndex((r) => r.name === m.rank);
    }

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
        if (!S.data && S.loading) return `<p class="cp-note" style="text-align:center;padding:2rem 0">Reading the ladder…</p>`;
        if (S.error && !S.data) {
            // Two different absences, told apart. A 409 with a *_missing code
            // is the VA's project being behind, and the update button fixes it.
            // A 404 is this crew center's server having no training routes —
            // which no database update can touch, and which used to be reported
            // as a schema gap, sending VAs to press a button against a perfectly
            // healthy project.
            if (S.error.status === 404) return P.notBuiltHtml('Check-rides');
            if (P.isSchemaGap(S.error)) return P.schemaGapHtml(S.error);
            return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>
                ${esc(S.error.message || 'The ladder could not be read.')}
                <div style="margin-top:.9rem"><button class="cp-btn" data-tr-retry>Try again</button></div></div>`;
        }
        if (!S.data) return '';
        if (!ranks().length) {
            return `<div class="cp-empty"><i data-lucide="signpost"></i>
                This airline has not set out its ranks yet. An owner adds them in Settings → Crew.</div>`;
        }

        const canManage = !!S.data.canManage;
        const tabs = [['me', 'Where you stand']];
        if (canManage) { tabs.push(['queue', queueLabel()]); tabs.push(['setup', 'Requirements']); }
        const bar = tabs.length > 1
            ? `<div class="tr-tabs">${tabs.map(([k, l]) =>
                `<button class="tr-tab ${S.view === k ? 'tr-tab-on' : ''}" data-tr-view="${k}">${esc(l)}</button>`).join('')}</div>`
            : '';

        if (S.view === 'queue' && canManage) return bar + queueHtml();
        if (S.view === 'setup' && canManage) return bar + setupHtml();
        return bar + meHtml();
    }

    function queueLabel() {
        const open = (S.data.requests || []).filter((r) => r.status === 'requested' || r.status === 'scheduled').length;
        return open ? `Check-rides · ${open}` : 'Check-rides';
    }

    /* ---- A pilot's own half --------------------------------------------- */

    function meHtml() {
        const m = me();
        const list = ranks();
        const here = myIndex();
        const next = here + 1 < list.length ? list[here + 1] : null;
        const mine = (S.data.requests || []).filter((r) => r.mine);
        const openReq = mine.find((r) => r.status === 'requested' || r.status === 'scheduled');

        const ladder = `<div class="tr-ladder">${list.map((r, i) => {
            const cls = i < here ? 'tr-done' : i === here ? 'tr-here tr-done' : '';
            const bits = [];
            if (r.minHours) bits.push(`${hrs(r.minHours)} logged`);
            if (r.minFlights) bits.push(`${r.minFlights} flights`);
            if (r.checkride) bits.push('check-ride');
            return `<div class="tr-step ${cls}">
                <div class="tr-spine"><span class="tr-node"></span></div>
                <div class="tr-body">
                    <div class="tr-name">${esc(r.name)}${i === here ? ' · you' : ''}</div>
                    ${bits.length ? `<div class="tr-need">${esc(bits.join(' · '))}</div>` : ''}
                    ${r.note ? `<div class="tr-note">${esc(r.note)}</div>` : ''}
                    ${next && i === here + 1 ? progressHtml(m, r) : ''}
                </div>
            </div>`;
        }).join('')}</div>`;

        let action;
        if (!m) {
            action = `<p class="cp-note">Sign in as a pilot of this airline to see where you stand.</p>`;
        } else if (openReq) {
            action = `<div class="tr-row">
                <div class="tr-row-main">
                    <div class="tr-row-name">${esc(STATE[openReq.status][0])} · ${esc(openReq.forRank || '')}</div>
                    <div class="tr-row-sub">${scheduleLine(openReq)}</div>
                </div>
                <div class="tr-row-act"><button class="cp-btn cp-btn-sm cp-btn-bad" data-tr-withdraw="${esc(openReq.id)}">Withdraw</button></div>
            </div>`;
        } else if (!next) {
            action = `<p class="cp-note">You are at the top of the ladder.</p>`;
        } else if (next.checkride === false) {
            action = `<p class="cp-note">${esc(next.name)} is awarded on hours — no check-ride needed. Keep flying.</p>`;
        } else {
            action = `<button class="cp-btn cp-btn-primary" data-tr-request="${esc(next.name)}" style="width:100%;justify-content:center">
                <i data-lucide="graduation-cap"></i> Ask for a ${esc(next.name)} check-ride</button>
                <p class="cp-note" style="margin-top:.5rem">You can ask before you meet everything — staff will tell you what is left.</p>`;
        }

        const past = mine.filter((r) => r.status === 'passed' || r.status === 'failed');
        const history = past.length
            ? `<div class="tr-sec" style="margin-top:1rem"><div class="tr-h">Your check-rides</div>
                ${past.map((r) => `<div class="tr-row">
                    <div class="tr-row-main">
                        <div class="tr-row-name">${esc(r.forRank || '')} <span class="cp-chip ${STATE[r.status][1]}">${STATE[r.status][0]}</span></div>
                        <div class="tr-row-sub">${esc([r.examinerName, r.decidedAt ? relativeText(r.decidedAt) : ''].filter(Boolean).join(' · '))}${r.notes ? ` — ${esc(r.notes)}` : ''}</div>
                    </div></div>`).join('')}</div>`
            : '';

        return ladder + action + history;
    }

    /** The gap to the next rank, drawn. Never a full bar on a rank not held. */
    function progressHtml(m, next) {
        if (!m) return '';
        const need = Number(next.minHours) || 0;
        const have = Number(m.hours) || 0;
        const needF = Number(next.minFlights) || 0;
        const haveF = Number(m.flights) || 0;
        const pct = need ? Math.min(100, Math.round((have / need) * 100)) : (needF ? Math.min(100, Math.round((haveF / needF) * 100)) : 0);
        const gaps = [];
        if (need && have < need) gaps.push(`<b>${hrs(need - have)}</b> more`);
        if (needF && haveF < needF) gaps.push(`<b>${needF - haveF}</b> more flight${needF - haveF === 1 ? '' : 's'}`);
        const reqs = [];
        if (need) reqs.push([have >= need, `${hrs(need)} logged`, `${hrs(have)} so far`]);
        if (needF) reqs.push([haveF >= needF, `${needF} flights`, `${haveF} so far`]);
        if (next.checkride !== false) reqs.push([false, 'A check-ride', 'flown with an examiner']);
        return `<div class="tr-bar"><span style="width:${pct}%"></span></div>
            ${gaps.length ? `<div class="tr-gap">${gaps.join(' and ')} to go.</div>` : ''}
            <div style="margin-top:.4rem">${reqs.map(([met, label, sub]) =>
                `<div class="tr-req ${met ? 'tr-met' : 'tr-unmet'}">
                    <i data-lucide="${met ? 'circle-check' : 'circle-dashed'}"></i>
                    <span>${esc(label)} <span class="cp-faint">· ${esc(sub)}</span></span>
                </div>`).join('')}</div>`;
    }

    /* ---- The staff queue ------------------------------------------------
       Three things happen to a request and they happen in order, so the row
       offers exactly the next one rather than a menu of all of them. */

    function queueHtml() {
        const reqs = (S.data.requests || []).filter((r) => r.status !== 'withdrawn');
        if (!reqs.length) {
            return `<div class="cp-empty"><i data-lucide="graduation-cap"></i>
                Nobody has asked for a check-ride. Pilots ask from their own page.</div>`;
        }
        const open = reqs.filter((r) => r.status === 'requested' || r.status === 'scheduled');
        const done = reqs.filter((r) => r.status === 'passed' || r.status === 'failed');
        return `<div class="tr-sec">
            ${open.length ? `<div class="tr-h">Waiting on you</div>${open.map(reqRowHtml).join('')}` : ''}
            ${done.length ? `<div class="tr-h" style="margin-top:.7rem">Done</div>${done.map(reqRowHtml).join('')}` : ''}
        </div>`;
    }

    function reqRowHtml(r) {
        const [label, chip] = STATE[r.status] || STATE.requested;
        const sub = [];
        if (r.hours != null) sub.push(hrs(r.hours));
        if (r.flights != null) sub.push(`${r.flights} flights`);
        // The examiner's own words where there are any, and the parsed instant
        // otherwise. A scheduled row with neither falls back to how long the
        // pilot has been waiting, same as an unscheduled one.
        const when = r.status === 'scheduled' ? (r.scheduledText || whenText(r.scheduledAt)) : '';
        if (when) sub.push(when);
        else if (r.createdAt) sub.push(`asked ${relativeText(r.createdAt)}`);
        if (r.notes) sub.push(r.notes);

        let actions = '';
        if (r.status === 'requested') {
            actions = `<button class="cp-btn cp-btn-sm cp-btn-primary" data-tr-schedule="${esc(r.id)}">Schedule</button>
                       <button class="cp-btn cp-btn-sm cp-btn-bad" data-tr-decline="${esc(r.id)}">Not yet</button>`;
        } else if (r.status === 'scheduled') {
            actions = `<button class="cp-btn cp-btn-sm cp-btn-primary" data-tr-pass="${esc(r.id)}">Passed</button>
                       <button class="cp-btn cp-btn-sm cp-btn-bad" data-tr-fail="${esc(r.id)}">Not yet</button>`;
        }
        return `<div class="tr-row" data-tr-req="${esc(r.id)}">
            <div class="tr-row-main">
                <div class="tr-row-name">${esc(r.pilotName || r.callsign || 'Pilot')} → ${esc(r.forRank || '')}
                    <span class="cp-chip ${chip}">${label}</span></div>
                <div class="tr-row-sub">${esc(sub.join(' · '))}</div>
            </div>
            <div class="tr-row-act">${actions}</div>
        </div>`;
    }

    /* ---- What each rank asks for ---------------------------------------
       The ranks themselves are edited in Settings → Crew, where they already
       were. This screen adds only what the ladder did not carry: a flights
       figure, whether the rank needs a check-ride at all, and a line in the
       VA's own words. Renaming a rank stays in one place. */

    function setupHtml() {
        return `<div class="tr-sec">
            <p class="cp-note">Ranks, their names and their hours live in Settings → Crew. This is what
                each one asks for <em>beyond</em> the hours.</p>
            ${ranks().map((r, i) => `<div class="tr-row" style="align-items:flex-start;flex-direction:column;gap:.5rem">
                <div class="tr-row-name" style="width:100%">${esc(r.name)}
                    <span class="cp-faint" style="font-weight:500">· ${esc(hrs(r.minHours || 0))}</span></div>
                <div class="cp-grid2" style="width:100%">
                    <label class="cp-label">Flights
                        <input class="cp-input" type="number" min="0" step="1" inputmode="numeric"
                            data-tr-f="minFlights" data-tr-i="${i}" value="${Math.max(0, Math.round(Number(r.minFlights) || 0))}"></label>
                    <label class="cp-label" style="display:flex;flex-direction:column;gap:.35rem">Check-ride
                        <label class="cp-note" style="display:flex;align-items:center;gap:.45rem;text-transform:none;letter-spacing:0;font-weight:500">
                            <input type="checkbox" data-tr-f="checkride" data-tr-i="${i}" ${r.checkride === false ? '' : 'checked'}>
                            Needs one</label></label>
                </div>
                <label class="cp-label" style="width:100%">In your words
                    <input class="cp-input" data-tr-f="note" data-tr-i="${i}" maxlength="140"
                        value="${esc(r.note || '')}" placeholder="e.g. one transatlantic sector, no violations"></label>
            </div>`).join('')}
            <div><button class="cp-btn cp-btn-primary" data-tr-saveranks>Save what each rank asks</button></div>
        </div>`;
    }

    /* =====================================================================
     * WRITING
     * =================================================================== */

    async function request(rankName, btn) {
        const done = P.busy(btn, 'Asking…');
        try {
            await S.api('/training/requests', { method: 'POST', body: { forRank: rankName } });
            await load();
            P.toast('Asked. Your staff will pick a time with you.', 'ok');
        } catch (err) { P.toast(err && err.message || 'That didn’t send.', 'bad'); }
        finally { done(); }
    }

    async function act(id, patch, okMsg, btn) {
        const done = P.busy(btn, false);
        try {
            await S.api(`/training/requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
            await load();
            if (okMsg) P.toast(okMsg, 'ok');
        } catch (err) { P.toast(err && err.message || 'That didn’t work.', 'bad'); }
        finally { done(); }
    }

    /**
     * Scheduling and recording both need a sentence from the examiner, and
     * both are one question — so they reuse the panel chrome's own prompt
     * rather than growing a form. `ask` returns false on cancel, which is the
     * same as changing nothing.
     */
    async function schedule(id, btn) {
        const when = await promptFor({
            title: 'When is the check-ride?',
            body: 'The pilot sees this on their own page. A date and a time in your own words is fine.',
            placeholder: 'Saturday 19:00Z, KJFK → EGLL',
            confirm: 'Schedule it',
        });
        if (when === null) return;
        await act(id, { action: 'schedule', at: when }, 'Scheduled — the pilot has been told.', btn);
    }

    async function decide(id, passed, btn) {
        const notes = await promptFor({
            title: passed ? 'Record a pass' : 'Record “not yet”',
            body: passed
                ? 'The rank moves as soon as you save this. Anything you type is kept with it.'
                : 'Nothing changes about their rank. What you type is what they read, so say what to work on.',
            placeholder: passed ? 'Flew it well — cleared.' : 'Approach was rushed; try again after five more sectors.',
            confirm: passed ? 'Pass and promote' : 'Save',
            danger: !passed,
        });
        if (notes === null) return;
        await act(id, { action: passed ? 'pass' : 'fail', notes },
            passed ? 'Passed — their rank has moved.' : 'Saved, and the pilot has been told.', btn);
    }

    /**
     * A one-line prompt, drawn the way the panel chrome draws its questions.
     *
     * CrewPanels.ask is a yes/no; this is the same object with a field in it,
     * kept here rather than added to the shared chrome because one module
     * needing an input is not yet a pattern.
     */
    function promptFor({ title, body, placeholder, confirm, danger }) {
        return new Promise((resolve) => {
            P.baseStyles();
            const host = document.createElement('div');
            host.className = 'cp-ask';
            host.innerHTML = `<div class="cp-ask-scrim" data-x></div>
                <div class="cp-ask-box">
                    <h3 class="cp-ask-title">${esc(title)}</h3>
                    <p class="cp-ask-body">${esc(body || '')}</p>
                    <input class="cp-input" data-v placeholder="${esc(placeholder || '')}" maxlength="160">
                    <div class="cp-ask-row">
                        <button class="cp-btn" data-x>Cancel</button>
                        <button class="cp-btn ${danger ? 'cp-btn-danger' : 'cp-btn-primary'}" data-ok>${esc(confirm || 'Save')}</button>
                    </div>
                </div>`;
            document.body.appendChild(host);
            const field = host.querySelector('[data-v]');
            const shut = (val) => { host.remove(); document.removeEventListener('keydown', key); resolve(val); };
            const key = (ev) => {
                if (ev.key === 'Escape') shut(null);
                if (ev.key === 'Enter' && document.activeElement === field) shut(field.value.trim());
            };
            document.addEventListener('keydown', key);
            host.addEventListener('click', (ev) => {
                if (ev.target.closest('[data-x]')) shut(null);
                if (ev.target.closest('[data-ok]')) shut(field.value.trim());
            });
            requestAnimationFrame(() => field.focus());
        });
    }

    async function saveRanks(btn) {
        const body = S.panel.body;
        const next = ranks().map((r) => ({ ...r }));
        body.querySelectorAll('[data-tr-f]').forEach((el) => {
            const i = Number(el.getAttribute('data-tr-i'));
            const f = el.getAttribute('data-tr-f');
            if (!next[i]) return;
            if (f === 'checkride') next[i].checkride = el.checked;
            else if (f === 'minFlights') next[i].minFlights = Math.max(0, Math.round(Number(el.value) || 0));
            else next[i][f] = el.value.trim();
        });
        const done = P.busy(btn, 'Saving…');
        try {
            await S.api('/training/settings', { method: 'POST', body: { ranks: next } });
            await load();
            P.toast('Saved for your crew.', 'ok');
        } catch (err) { P.toast(err && err.message || 'That didn’t save.', 'bad'); }
        finally { done(); }
    }

    /* =====================================================================
     * WIRING
     * =================================================================== */

    function wire(panel) {
        if (panel.el.dataset.trWired) return;
        panel.el.dataset.trWired = '1';
        panel.el.addEventListener('click', (ev) => {
            const t = ev.target;
            const v = t.closest('[data-tr-view]');
            if (v) { S.view = v.getAttribute('data-tr-view'); draw(); return; }
            if (t.closest('[data-tr-retry]')) { load(); return; }
            const req = t.closest('[data-tr-request]');
            if (req) { request(req.getAttribute('data-tr-request'), req); return; }
            const wd = t.closest('[data-tr-withdraw]');
            if (wd) { act(wd.getAttribute('data-tr-withdraw'), { action: 'withdraw' }, 'Withdrawn.', wd); return; }
            const sc = t.closest('[data-tr-schedule]');
            if (sc) { schedule(sc.getAttribute('data-tr-schedule'), sc); return; }
            const dec = t.closest('[data-tr-decline]');
            if (dec) { decide(dec.getAttribute('data-tr-decline'), false, dec); return; }
            const pass = t.closest('[data-tr-pass]');
            if (pass) { decide(pass.getAttribute('data-tr-pass'), true, pass); return; }
            const fail = t.closest('[data-tr-fail]');
            if (fail) { decide(fail.getAttribute('data-tr-fail'), false, fail); return; }
            if (t.closest('[data-tr-saveranks]')) { saveRanks(t.closest('[data-tr-saveranks]')); return; }
        });
    }

    function open({ api, view } = {}) {
        if (typeof api !== 'function') { console.warn('crewTraining: needs an api function'); return; }
        styles();
        S.api = api;
        if (view) S.view = view;
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewTraining', title: 'Training', icon: 'graduation-cap' });
            wire(S.panel);
        }
        S.panel.open();
        draw();
        load();
    }

    window.CrewTraining = { open, close: () => S.panel && S.panel.close() };
})();
