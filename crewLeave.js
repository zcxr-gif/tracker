/* ============================================================================
   crewLeave.js — being away, and noticing before it is too late.

   WHY THIS EXISTS

   The crew center already sweeps the roster: pilots who stop flying stop
   counting as active, and eventually come off it. That is the right rule and
   it has one hole in it — it cannot tell the difference between a pilot who
   has lost interest and a pilot who is sitting an exam, on a ship, or in
   hospital. Both go quiet. Only one of them should be removed, and the sweep
   removes whichever it reaches first.

   So: a pilot can say they are away. One sentence, a date they expect to be
   back, and the sweep leaves them alone until it passes.

   THE OTHER HALF IS THE HARDER ONE

   By the time the sweep removes somebody, the airline has already lost them.
   The useful moment was three weeks earlier, when a pilot who flew twice a
   week flew nothing — and nobody noticed, because nothing on the dashboard is
   shaped like "who is slipping away".

   The crew-health board is that shape. Four groups, each of which is a
   different conversation:

     Going quiet    flew regularly, has not lately. The one worth a message.
     Never started  joined, never filed. A recruitment problem, not a retention
                    one — and the fix is usually that nobody told them how.
     Nearly out     inside the sweep's window. Last chance to ask.
     Away           on leave, with a date. Here so nobody chases them.

   AND THE POINT IS THE MESSAGE, NOT THE LIST

   Every row has one button, and it sends a note to that pilot through the
   inbox the crew center already has. A board that only shows you who is
   leaving is a board that makes you feel bad on a schedule.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewLeave: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText, whenText } = P;

    const S = {
        api: null,
        panel: null,
        view: 'me',        // me | health
        data: null,        // GET /leave  → { mine, canManage, sweep }
        health: null,      // GET /crew-health
        loading: false,
        error: null,
    };

    const GROUPS = [
        ['quiet', 'Going quiet', 'flew regularly, and has not lately', 'message-circle-warning'],
        ['never', 'Never started', 'joined, never filed a flight', 'user-round-x'],
        ['edge', 'Nearly out', 'inside the sweep’s window', 'clock-alert'],
        ['away', 'Away', 'on leave, with a date to come back', 'palmtree'],
    ];

    function styles() {
        P.baseStyles();
        P.style('crew-leave', `
        .lv-tabs{ display:flex; gap:.35rem; padding:.25rem; border-radius:999px;
            background:color-mix(in srgb, var(--ink,#1C1A16) 6%, transparent); margin-bottom:.5rem; }
        .lv-tab{ flex:1; border:0; background:none; cursor:pointer; font:inherit; font-size:.8rem;
            font-weight:700; padding:.45rem .7rem; border-radius:999px; color:var(--muted,#736E64); }
        .lv-tab-on{ background:var(--surface,#fff); color:var(--ink,#1C1A16); box-shadow:0 1px 2px rgb(0 0 0 / .12); }

        .lv-card{ border:1px solid var(--line,#e5e5e5); border-radius:.9rem; padding:.9rem;
            background:var(--surface,#fff); display:grid; gap:.6rem; }
        .lv-on{ border-color:color-mix(in srgb, var(--accent) 45%, transparent);
            background:color-mix(in srgb, var(--accent) 7%, var(--surface,#fff)); }
        .lv-title{ font-size:.95rem; font-weight:700; letter-spacing:-.015em; }
        .lv-sub{ font-size:.8rem; color:var(--muted,#736E64); }

        .lv-group{ display:grid; gap:.45rem; margin-bottom:.9rem; }
        .lv-gh{ display:flex; align-items:center; gap:.45rem; }
        .lv-gh i{ width:.95rem; height:.95rem; color:var(--muted,#736E64); }
        .lv-gh-name{ font-size:.72rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
            color:var(--faint,#A8A296); }
        .lv-gh-n{ margin-left:auto; font-size:.72rem; font-weight:800; color:var(--muted,#736E64); }
        .lv-gh-why{ font-size:.75rem; color:var(--muted,#736E64); margin:-.15rem 0 .15rem; }

        .lv-row{ display:flex; align-items:center; gap:.7rem; padding:.6rem .75rem;
            border:1px solid var(--line,#e5e5e5); border-radius:.75rem; background:var(--surface,#fff); }
        .lv-row-main{ min-width:0; flex:1; }
        .lv-row-name{ font-size:.86rem; font-weight:650; letter-spacing:-.01em; }
        .lv-row-sub{ font-size:.74rem; color:var(--muted,#736E64); margin-top:.05rem; }
        /* A spark of their last eight weeks. Eight bars is not a chart, it is
           a shape — and the shape is the whole reason this row is on a list
           called "going quiet". */
        .lv-spark{ display:flex; align-items:flex-end; gap:2px; height:1.5rem; flex:none; }
        .lv-spark i{ width:.28rem; border-radius:1px; background:color-mix(in srgb, var(--accent) 55%, transparent);
            min-height:2px; display:block; }
        .lv-spark i.lv-zero{ background:color-mix(in srgb, var(--ink,#1C1A16) 12%, transparent); }
        `);
    }

    /* =====================================================================
     * READING
     * =================================================================== */

    async function load() {
        S.loading = true; S.error = null;
        draw();
        try { S.data = await S.api('/leave'); }
        catch (err) { S.error = err; }
        S.loading = false;
        draw();
    }

    async function loadHealth() {
        try { S.health = await S.api('/crew-health'); }
        catch (err) { S.health = { error: err }; }
        draw();
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
        if (!S.data && S.loading) return `<p class="cp-note" style="text-align:center;padding:2rem 0">One moment…</p>`;
        if (S.error && !S.data) {
            if (P.isSchemaGap(S.error) || S.error.status === 404) {
                return P.schemaGapHtml(S.error.status === 404
                    ? { message: 'Leave needs your crew center’s database brought up to date.' }
                    : S.error);
            }
            return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>
                ${esc(S.error.message || 'That could not be read.')}</div>`;
        }
        if (!S.data) return '';

        const canManage = !!S.data.canManage;
        const bar = canManage
            ? `<div class="lv-tabs">
                <button class="lv-tab ${S.view === 'me' ? 'lv-tab-on' : ''}" data-lv-view="me">My leave</button>
                <button class="lv-tab ${S.view === 'health' ? 'lv-tab-on' : ''}" data-lv-view="health">Crew health</button>
               </div>` : '';
        return bar + (S.view === 'health' && canManage ? healthHtml() : meHtml());
    }

    /* ---- A pilot saying they are away ----------------------------------- */

    function meHtml() {
        const mine = S.data.mine;
        const sweep = S.data.sweep || {};
        const why = sweep.enabled
            ? `Your airline sweeps its roster: pilots who stop flying stop counting as active${
                sweep.quietDays ? ` after ${sweep.quietDays} days` : ''}. Telling it you are away stops that clock.`
            : 'Your airline does not sweep its roster, but staff can still see who is away — so nobody wonders where you went.';

        if (mine) {
            return `<div class="lv-card lv-on">
                <div>
                    <div class="lv-title">You are away</div>
                    <div class="lv-sub">${mine.until
                        ? `Back on ${esc(whenText(mine.until, { withYear: true }).split(',')[0] || mine.until)}`
                        : 'No date given'}${mine.reason ? ` — ${esc(mine.reason)}` : ''}</div>
                </div>
                <div class="cp-facts"><span class="cp-fact">Told your staff ${esc(relativeText(mine.createdAt))}</span></div>
                <button class="cp-btn" data-lv-end="${esc(mine.id || '')}">I’m back</button>
            </div>
            <p class="cp-note">Coming back early is fine — press that and the clock starts again.</p>`;
        }

        const today = new Date();
        const min = today.toISOString().slice(0, 10);
        const soon = new Date(today.getTime() + 14 * 86400000).toISOString().slice(0, 10);
        return `<div class="lv-card">
            <div>
                <div class="lv-title">Going to be away?</div>
                <div class="lv-sub">${esc(why)}</div>
            </div>
            <label class="cp-label">Back on
                <input class="cp-input" type="date" data-lv-f="until" min="${min}" value="${soon}"></label>
            <label class="cp-label">Anything you want to say <span class="cp-faint" style="text-transform:none;letter-spacing:0">(optional)</span>
                <input class="cp-input" data-lv-f="reason" maxlength="120" placeholder="Exams until the 14th"></label>
            <button class="cp-btn cp-btn-primary" data-lv-start>Tell my staff I’m away</button>
        </div>
        <p class="cp-note">Only your staff see this. It does not cancel legs you have already booked —
            do that in the schedule if you need to.</p>`;
    }

    /* ---- The board ------------------------------------------------------ */

    function healthHtml() {
        if (!S.health) { loadHealth(); return `<p class="cp-note" style="text-align:center;padding:2rem 0">Reading the roster…</p>`; }
        if (S.health.error) {
            const e = S.health.error;
            if (P.isSchemaGap(e) || e.status === 404) return P.schemaGapHtml(
                e.status === 404 ? { message: 'The crew-health board needs your database brought up to date.' } : e);
            return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>${esc(e.message || 'That could not be read.')}</div>`;
        }
        const groups = S.health.groups || {};
        const total = GROUPS.reduce((n, [k]) => n + ((groups[k] || []).length), 0);
        if (!total) {
            return `<div class="cp-empty"><i data-lucide="heart-pulse"></i>
                Everybody on your roster is flying. Nothing here needs you today.</div>`;
        }
        return GROUPS.map(([key, name, why, icon]) => {
            const rows = groups[key] || [];
            if (!rows.length) return '';
            return `<div class="lv-group">
                <div class="lv-gh"><i data-lucide="${icon}"></i>
                    <span class="lv-gh-name">${esc(name)}</span>
                    <span class="lv-gh-n">${rows.length}</span></div>
                <div class="lv-gh-why">${esc(why)}</div>
                ${rows.map((p) => pilotRow(p, key)).join('')}
            </div>`;
        }).join('');
    }

    function pilotRow(p, group) {
        const bits = [];
        if (p.callsign) bits.push(p.callsign);
        if (group === 'away') bits.push(p.until ? `back ${relativeText(p.until)}` : 'no date');
        else if (p.lastFlightAt) bits.push(`last flew ${relativeText(p.lastFlightAt)}`);
        else if (p.joinedAt) bits.push(`joined ${relativeText(p.joinedAt)}`);
        if (group === 'edge' && p.removedInDays != null) bits.push(`out in ${p.removedInDays}d`);

        const spark = Array.isArray(p.weeks) && p.weeks.length
            ? `<span class="lv-spark">${p.weeks.slice(-8).map((n) => {
                const h = Math.max(2, Math.min(24, Math.round((Number(n) || 0) * 6)));
                return `<i class="${n ? '' : 'lv-zero'}" style="height:${h}px"></i>`;
            }).join('')}</span>` : '';

        return `<div class="lv-row">
            <div class="lv-row-main">
                <div class="lv-row-name">${esc(p.name || p.callsign || 'Pilot')}</div>
                <div class="lv-row-sub">${esc(bits.join(' · '))}</div>
            </div>
            ${spark}
            ${group === 'away' ? '' :
                `<button class="cp-btn cp-btn-sm" data-lv-nudge="${esc(p.id || '')}" data-lv-name="${esc(p.name || '')}">Say hello</button>`}
        </div>`;
    }

    /* =====================================================================
     * WRITING
     * =================================================================== */

    async function start(btn) {
        const body = S.panel.body;
        const until = (body.querySelector('[data-lv-f="until"]') || {}).value || '';
        const reason = ((body.querySelector('[data-lv-f="reason"]') || {}).value || '').trim();
        const done = P.busy(btn, 'Saving…');
        try {
            await S.api('/leave', { method: 'POST', body: { until, reason } });
            await load();
            P.toast('Your staff know. Fly safe when you’re back.', 'ok');
        } catch (err) { P.toast(err && err.message || 'That didn’t save.', 'bad'); }
        finally { done(); }
    }

    async function end(id, btn) {
        const done = P.busy(btn, 'Saving…');
        try {
            await S.api(`/leave/${encodeURIComponent(id)}`, { method: 'DELETE' });
            await load();
            P.toast('Welcome back.', 'ok');
        } catch (err) { P.toast(err && err.message || 'That didn’t work.', 'bad'); }
        finally { done(); }
    }

    /**
     * The nudge.
     *
     * A message, in the staff member's own words, through the inbox the crew
     * center already has — not a templated "we miss you" that every pilot in
     * the group receives identically and recognises as automated. A default is
     * offered because a blank box is what stops people sending anything.
     */
    async function nudge(id, name, btn) {
        const first = String(name || '').split(/\s+/)[0] || 'there';
        const text = await ask({
            title: `Send ${esc(first)} a note`,
            body: 'It arrives in their crew center inbox, from you.',
            value: `Hi ${first} — not seen you on the roster for a bit. Everything alright? There is a spot on the schedule whenever you fancy it.`,
        });
        if (text === null) return;
        const done = P.busy(btn, 'Sending…');
        try {
            await S.api('/crew-health/nudge', { method: 'POST', body: { pilotId: id, message: text } });
            P.toast('Sent.', 'ok');
        } catch (err) { P.toast(err && err.message || 'That didn’t send.', 'bad'); }
        finally { done(); }
    }

    /** A multi-line prompt, drawn like the panel chrome's own questions. */
    function ask({ title, body, value }) {
        return new Promise((resolve) => {
            P.baseStyles();
            const host = document.createElement('div');
            host.className = 'cp-ask';
            host.innerHTML = `<div class="cp-ask-scrim" data-x></div>
                <div class="cp-ask-box">
                    <h3 class="cp-ask-title">${title}</h3>
                    <p class="cp-ask-body">${esc(body || '')}</p>
                    <textarea class="cp-textarea" data-v maxlength="600">${esc(value || '')}</textarea>
                    <div class="cp-ask-row">
                        <button class="cp-btn" data-x>Cancel</button>
                        <button class="cp-btn cp-btn-primary" data-ok>Send it</button>
                    </div>
                </div>`;
            document.body.appendChild(host);
            const field = host.querySelector('[data-v]');
            const shut = (v) => { host.remove(); document.removeEventListener('keydown', key); resolve(v); };
            const key = (ev) => { if (ev.key === 'Escape') shut(null); };
            document.addEventListener('keydown', key);
            host.addEventListener('click', (ev) => {
                if (ev.target.closest('[data-x]')) shut(null);
                if (ev.target.closest('[data-ok]')) {
                    const v = field.value.trim();
                    if (v) shut(v);
                }
            });
            requestAnimationFrame(() => field.focus());
        });
    }

    /* =====================================================================
     * WIRING
     * =================================================================== */

    function wire(panel) {
        if (panel.el.dataset.lvWired) return;
        panel.el.dataset.lvWired = '1';
        panel.el.addEventListener('click', (ev) => {
            const t = ev.target;
            const v = t.closest('[data-lv-view]');
            if (v) { S.view = v.getAttribute('data-lv-view'); draw(); return; }
            if (t.closest('[data-lv-start]')) { start(t.closest('[data-lv-start]')); return; }
            const e = t.closest('[data-lv-end]');
            if (e) { end(e.getAttribute('data-lv-end'), e); return; }
            const n = t.closest('[data-lv-nudge]');
            if (n) { nudge(n.getAttribute('data-lv-nudge'), n.getAttribute('data-lv-name'), n); return; }
        });
    }

    function open({ api, view } = {}) {
        if (typeof api !== 'function') { console.warn('crewLeave: needs an api function'); return; }
        styles();
        S.api = api;
        if (view) S.view = view;
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewLeave', title: 'Leave & crew health', icon: 'heart-pulse' });
            wire(S.panel);
        }
        S.panel.open();
        draw();
        load();
    }

    window.CrewLeave = { open, close: () => S.panel && S.panel.close() };
})();
