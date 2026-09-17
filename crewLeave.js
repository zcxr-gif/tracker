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
        // The other kind of leaving. Read lazily — nobody should pay a round
        // trip for the exit on their way to saying they are on holiday — and
        // only when the section is opened. See quitHtml.
        quit: null,        // GET /me/leave → { canLeave, expects, takes }
        quitOpen: false,
        quitAsked: false,
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

        /* ---- THE OTHER KIND OF LEAVING ----------------------------------
           Going away and going for good are the same question with two
           answers, so a pilot looking for the exit looks here — but they are
           not the same WEIGHT, and a panel that drew them as two equal cards
           would be offering "delete everything I have ever flown" as a
           sibling of "I have exams until the 14th".

           So it is a disclosure, shut by default, below a rule, in red, and
           the button inside it does not appear until a name has been typed.
           Every one of those is a small piece of friction and all of them
           together are the point: this is the only irreversible thing a pilot
           can do to themselves in this product. */
        .lv-quit{ margin-top:1.6rem; border-top:1px solid var(--line,#e5e5e5); padding-top:1rem; }
        .lv-quit-open{ display:inline-flex; align-items:center; gap:.4rem; background:none; border:0;
            cursor:pointer; font:inherit; font-size:.78rem; font-weight:700; color:var(--muted,#736E64);
            padding:.2rem 0; }
        .lv-quit-open i{ width:.9rem; height:.9rem; }
        .lv-quit-open:hover{ color:#DC2626; }
        .lv-quit-box{ margin-top:.8rem; border:1px solid color-mix(in srgb, #DC2626 40%, var(--line,#e5e5e5));
            border-radius:.9rem; padding:1rem; background:color-mix(in srgb, #DC2626 5%, transparent); }
        .lv-quit-t{ font-size:.98rem; font-weight:800; letter-spacing:-.02em; color:#B91C1C; }
        .lv-quit-p{ font-size:.82rem; line-height:1.5; color:var(--ink,#1C1A16); margin-top:.4rem; }
        /* Their own flying, itemised. A warning that says "everything will be
           wiped" is a form of words; a warning that says "your 214 hours and
           your 96 flights" is the same sentence with the person in it. */
        .lv-quit-list{ list-style:none; margin:.7rem 0 0; padding:0; display:grid; gap:.3rem; }
        .lv-quit-list li{ display:flex; align-items:center; gap:.5rem; font-size:.82rem; }
        .lv-quit-list i{ width:.9rem; height:.9rem; color:#DC2626; flex:none; }
        .lv-quit-note{ font-size:.75rem; line-height:1.45; color:var(--muted,#736E64); margin-top:.7rem; }
        .lv-quit-danger{ background:#DC2626; border-color:#DC2626; color:#fff; }
        .lv-quit-danger:hover{ background:#B91C1C; border-color:#B91C1C; }
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

    async function loadQuit() {
        try { S.quit = await S.api('/me/leave'); }
        catch (err) { S.quit = { error: err }; }
        draw();
    }

    /**
     * Leave, for good.
     *
     * The server asks for the username again and checks it again — this is not
     * the gate, it is the warning. The gate is in the route, because a
     * confirmation a browser enforces is a confirmation anybody can skip.
     */
    async function quit(btn) {
        const box = S.panel && S.panel.body.querySelector('[data-lv-quit-confirm]');
        const typed = box ? String(box.value || '').trim() : '';
        if (!typed) return;
        const done = P.busy(btn, 'Leaving…');
        try {
            await S.api('/me/leave', { method: 'POST', body: { confirm: typed } });
            // No toast and no repaint: there is nothing left behind this panel
            // for this person to look at, and a crew centre that sat there
            // with their name still in the top bar would be the last thing
            // they saw of it. Out, to the sign-in page, with the session gone.
            let slug = '';
            try {
                slug = (location.pathname.match(/\/crew\/([^/?#]+)/i) || [])[1] || '';
                slug = slug ? decodeURIComponent(slug).trim().toLowerCase() : '';
                if (slug) localStorage.removeItem('crew:session:' + slug);
            } catch (_) { /* private window: the redirect still ends the visit */ }
            // Back to this airline's own sign-in page rather than to /crew,
            // which is the bare one and would ask them which crew centre they
            // meant. They know which one they just left.
            location.href = slug ? `/crew/${encodeURIComponent(slug)}` : '/crew';
        } catch (err) {
            // The one error worth keeping them here for: they typed it wrong.
            P.toast((err && err.message) || 'That did not work.', 'bad');
            done();
        }
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
            // 404 is "not built here", not "your database is behind" — see
            // CrewPanels.notBuiltHtml.
            if (S.error.status === 404) return P.notBuiltHtml('Leave');
            if (P.isSchemaGap(S.error)) return P.schemaGapHtml(S.error);
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
            <p class="cp-note">Coming back early is fine — press that and the clock starts again.</p>
            ${quitHtml()}`;
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
            do that in the schedule if you need to.</p>
        ${quitHtml()}`;
    }

    /* =====================================================================
     * LEAVING FOR GOOD
     *
     * WHY IT IS IN THIS PANEL
     *
     * "I am going away" and "I am going away for good" are the same question
     * with two answers, and a pilot who wants out looks where the going-away
     * thing is. Putting the exit in a settings screen a pilot does not have —
     * they do not have one — or nowhere at all, which is where it was, means
     * the only way to leave a virtual airline is to ask permission and wait.
     * In practice people stop signing in instead, and sit on the roster
     * forever as somebody the sweep keeps nagging.
     *
     * WHY IT LOOKS LIKE THIS
     *
     * It is shut by default, under a rule, in red, and the button does not
     * exist until the pilot has typed their own username. Every one of those
     * is a small piece of friction and all of them together are the point:
     * this deletes their flying, and nobody can undo it afterwards.
     *
     * AND IT ITEMISES WHAT GOES. "Everything will be wiped" is a form of
     * words that a person skims. "Your 214 hours, your 96 flights, your Gold
     * card and the three things you have claimed" is the same sentence with
     * their own life in it, and it is the difference between a dialog that is
     * dismissed and one that is read. The figures come from the server, which
     * is the only thing that actually knows them.
     * =================================================================== */

    function quitHtml() {
        if (!S.quitOpen) {
            return `<div class="lv-quit">
                <button type="button" class="lv-quit-open" data-lv-quit-open>
                    <i data-lucide="chevron-right"></i> Leave this airline for good
                </button>
            </div>`;
        }
        // Asked for lazily the first time the section is opened, so a pilot
        // reporting a fortnight's holiday never pays for this round trip.
        if (!S.quit) {
            if (!S.quitAsked) { S.quitAsked = true; loadQuit(); }
            return `<div class="lv-quit"><p class="cp-note">One moment…</p></div>`;
        }
        if (S.quit.error) {
            const e = S.quit.error;
            if (e.status === 404) return `<div class="lv-quit">${P.notBuiltHtml('Leaving')}</div>`;
            return `<div class="lv-quit"><div class="cp-empty"><i data-lucide="triangle-alert"></i>
                ${esc(e.message || 'That could not be read.')}</div></div>`;
        }
        // A staff account cannot leave through this door — the route cannot
        // reach a central login, so it says so rather than pretending.
        if (S.quit.canLeave === false) {
            return `<div class="lv-quit">
                <div class="lv-quit-t">Staff leave a different way</div>
                <p class="lv-quit-p">This is a staff account, so it is not ours to close from here.
                    Take your staff role off first, or ask another owner to take you off the roster.</p>
            </div>`;
        }

        const t = S.quit.takes || {};
        const items = [];
        if (t.linked) {
            if (t.hours) items.push(['clock', `${Number(t.hours).toLocaleString()} hours of flying`]);
            // `null` means we could not read it — see the route. Only a number
            // is stated, because a zero here is a claim about somebody's
            // logbook and this is the worst screen to be wrong on.
            if (Number.isFinite(t.reports) && t.reports) {
                items.push(['notebook-tabs', `${Number(t.reports).toLocaleString()} flight report${t.reports === 1 ? '' : 's'}`]);
            }
            if (t.rank) items.push(['award', `Your rank — ${t.rank}`]);
            if (t.club) items.push(['gem', `Your ${t.club} card`]);
            if (Number.isFinite(t.held) && t.held) {
                items.push(['gift', `${t.held} thing${t.held === 1 ? '' : 's'} you have claimed from the shop`]);
            }
            items.push(['calendar-x', 'Any flights you have booked, and your event signups']);
        }
        items.push(['user-x', 'Your login, and every message in your inbox']);

        return `<div class="lv-quit">
            <button type="button" class="lv-quit-open" data-lv-quit-open aria-expanded="true">
                <i data-lucide="chevron-down"></i> Leave this airline for good
            </button>
            <div class="lv-quit-box">
                <div class="lv-quit-t">This cannot be undone</div>
                <p class="lv-quit-p">Leaving does not hide you or mark you inactive — it removes you.
                    Everything below is deleted from this airline's records, and neither you nor your
                    staff can bring any of it back.</p>
                <ul class="lv-quit-list">
                    ${items.map(([icon, text]) => `<li><i data-lucide="${esc(icon)}"></i>${esc(text)}</li>`).join('')}
                </ul>
                <p class="lv-quit-note">Your hours at this airline are not your hours in Infinite Flight —
                    your IF logbook is untouched. If you only want a break, use the box above instead.</p>
                <label class="cp-label" style="margin-top:.9rem">Type <b>${esc(S.quit.expects || '')}</b> to confirm
                    <input class="cp-input" data-lv-quit-confirm autocomplete="off"
                        placeholder="${esc(S.quit.expects || 'your username')}"></label>
                <button class="cp-btn lv-quit-danger" data-lv-quit-go disabled>Leave ${esc(
                    (S.quit.pilot && S.quit.pilot.name) ? 'this airline' : 'this airline')}</button>
            </div>
        </div>`;
    }

    /* ---- The board ------------------------------------------------------ */

    function healthHtml() {
        if (!S.health) { loadHealth(); return `<p class="cp-note" style="text-align:center;padding:2rem 0">Reading the roster…</p>`; }
        if (S.health.error) {
            const e = S.health.error;
            if (e.status === 404) return P.notBuiltHtml('The crew-health board');
            if (P.isSchemaGap(e)) return P.schemaGapHtml(e);
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
            if (t.closest('[data-lv-quit-open]')) { S.quitOpen = !S.quitOpen; draw(); return; }
            const q = t.closest('[data-lv-quit-go]');
            if (q && !q.disabled) { quit(q); return; }
        });

        /* THE BUTTON DOES NOT EXIST UNTIL THE NAME IS RIGHT.
         *
         * Disabled rather than hidden, so somebody who has read the list can
         * see what they are being asked for before they decide — and enabled
         * only on an exact match, trimmed and case-insensitively, because
         * asking a person to reproduce capitalisation under a red banner is a
         * puzzle rather than a check. The server checks it again; this is the
         * warning, not the gate. */
        panel.el.addEventListener('input', (ev) => {
            if (!ev.target.matches('[data-lv-quit-confirm]')) return;
            const go = panel.body.querySelector('[data-lv-quit-go]');
            if (!go) return;
            const want = String((S.quit && S.quit.expects) || '').trim().toLowerCase();
            go.disabled = !want || String(ev.target.value || '').trim().toLowerCase() !== want;
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
        // Shut again on every open. Somebody who looked at the exit last week
        // and closed the panel should not find it sitting open, with their
        // flying itemised under a red heading, when they come back to report a
        // fortnight's holiday.
        S.quitOpen = false; S.quitAsked = false; S.quit = null;
        S.panel.open();
        draw();
        load();
    }

    window.CrewLeave = { open, close: () => S.panel && S.panel.close() };
})();
