/* ============================================================================
   crewMyFlying.js — the staff member's own flying, on the staff dashboard.

   WHY THIS EXISTS

   A VA's staff fly. That sounds obvious, and the crew center did not allow for
   it: the management dashboard and the pilot home are two different pages, and
   everything a pilot does — booking a leg, signing up for an event, filing a
   report, seeing their own hours — lived only on the pilot one. Somebody who
   runs the airline AND flies for it had a dashboard that showed them everyone
   else's flying and none of their own.

   Worse for our central accounts: a VA-portal staff login had no roster
   identity at all, so it could publish a schedule and not book off it, open the
   events panel and not sign up, review flight reports and not file one. That is
   fixed on the backend (a portal account can now say which pilot it is); this
   is the surface that makes it usable.

   WHAT IT DRAWS

     · Who this person is on the roster — rank, hours, callsign — or, when the
       account has not been linked yet, a picker to say which pilot they are.
     · What they are flying: their booked departures, soonest first.
     · A way in: file a flight, open the schedule, open the calendar.

   IT IS NOT A SECOND PILOT PAGE. Everything here hands off to the panels that
   already exist — CrewSchedule for booking, CrewEvents for the calendar, the
   dashboard's own PIREP form for filing. This module owns the question "what am
   I flying?" and nothing else, because a second implementation of the pilot
   home would be a second thing to keep in step.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewMyFlying: crewPanels.js must load first'); return; }
    const { esc, icons, whenText, relativeText } = P;

    const S = {
        api: null,
        // Who the signed-in person is on the roster, per GET /me/pilot.
        me: null,            // { memberId, name, callsign, hours } | null
        linkable: false,     // can this account choose its own roster row?
        // v17. The staff member's OWN pilot account, if they have set one up.
        // { applies, ready, discord: { available, linked, name } }
        pilotSide: { applies: false, ready: true, discord: null },
        busy: false,         // a set-up or link round trip is in flight
        loaded: false,
        error: null,
        roster: [],          // only fetched when the picker is actually opened
        bookings: [],        // this person's upcoming departures
    };

    const hosts = new Set();

    /* =====================================================================
     * DATA
     * =================================================================== */

    async function load() {
        try {
            const d = await S.api('/me/pilot');
            S.me = d.pilot || null;
            S.linkable = !!d.linkable;
            S.pilotSide = Object.assign({ applies: false, ready: true, discord: null }, d.pilotSide || {});
            S.error = null;
        } catch (err) {
            S.error = err;
            S.me = null;
        }
        S.loaded = true;
        // Only worth asking what they are flying once we know who they are.
        if (S.me) await loadBookings();
        paintAll();
        return S.me;
    }

    /**
     * What this person is flying.
     *
     * Read off the schedule endpoint's `mine`, which the server already
     * computes for the panel — rather than a second endpoint that would answer
     * the same question from the same rows and could disagree with it.
     */
    async function loadBookings() {
        try {
            const d = await S.api('/schedules?upcoming=1');
            const mine = Array.isArray(d.mine) ? d.mine : [];
            const byId = new Map((d.schedules || []).map((s) => [String(s.id), s]));
            S.bookings = mine
                .map((b) => ({ booking: b, schedule: byId.get(String(b.scheduleId)) }))
                .filter((x) => x.schedule)
                .sort((a, b) => new Date(a.schedule.departsAt || 0) - new Date(b.schedule.departsAt || 0));
        } catch {
            // A VA whose project predates the schedule tables, or a fetch that
            // failed: the identity card is still worth showing on its own.
            S.bookings = [];
        }
    }

    /* =====================================================================
     * RENDER
     * =================================================================== */

    function paint(el) {
        if (!S.loaded) { el.innerHTML = ''; return; }

        // Nothing to say to somebody who is not a pilot and cannot become one
        // here — a store-backed account's link belongs to its own account row.
        if (!S.me && !S.linkable) { el.innerHTML = ''; return; }

        /* NOBODY YET.
         *
         * Two ways out, and the order matters. The first — a pilot record of
         * their OWN — is the one almost everybody wants and is offered as the
         * button: staff who fly should not have to find themselves on a roster
         * they may not be on, and picking somebody else's row is how two people
         * end up sharing one pilot.
         *
         * The second is kept for the case it was built for: a staff member who
         * is ALREADY on the roster, flying under a record with their hours on
         * it. Making them a new one would strand those hours. */
        if (!S.me) {
            el.innerHTML = `
                <div class="mf-link">
                    <div class="mf-link-text">
                        <div class="mf-link-title">Do you fly for this airline too?</div>
                        <p class="cp-note">Set up your own pilot account and you can book legs, sign up
                            for events, file flights and sign in with Discord — without a second password
                            and without borrowing anybody else’s record.</p>
                    </div>
                    <button class="cp-btn cp-btn-primary" data-mf-setup ${S.busy ? 'disabled' : ''}>
                        <i data-lucide="user-plus"></i> ${S.busy ? 'Setting up…' : 'Set up my pilot account'}
                    </button>
                </div>
                <p class="cp-note mf-alt">Already on the roster?
                    <button class="mf-inline" data-mf-pick>Point at your existing record instead</button>.</p>`;
            icons();
            wire(el);
            return;
        }

        const me = S.me;
        const rows = S.bookings.length
            ? S.bookings.slice(0, 4).map(({ booking, schedule }) => `
                <li class="mf-leg">
                    <span class="mf-leg-when">
                        <span class="mf-leg-day">${esc(dayShort(schedule.departsAt))}</span>
                        <span class="mf-leg-time">${esc(timeShort(schedule.departsAt))}</span>
                    </span>
                    <span class="mf-leg-main">
                        <span class="mf-leg-ports">
                            ${schedule.flightNumber ? `<b>${esc(schedule.flightNumber)}</b> ` : ''}
                            ${esc(schedule.origin || '???')} → ${esc(schedule.destination || '???')}
                        </span>
                        <span class="mf-leg-sub">${esc([
                            schedule.aircraft,
                            booking.seat > 1 ? `seat ${booking.seat}` : '',
                            relativeText(schedule.departsAt),
                        ].filter(Boolean).join(' · '))}</span>
                    </span>
                    ${booking.status === 'flown'
                        ? '<span class="cp-chip cp-chip-ok">Flown</span>'
                        : `<button class="cp-btn cp-btn-sm" data-mf-file="${esc(schedule.id)}">File</button>`}
                </li>`).join('')
            : `<li class="mf-none">Nothing booked. <button class="mf-inline" data-mf-schedule>Take a leg
                off the schedule</button>.</li>`;

        el.innerHTML = `
            <div class="mf-head">
                <span class="mf-avatar">${esc(initials(me.name))}</span>
                <span class="mf-who">
                    <span class="mf-name">${esc(me.name)}</span>
                    <span class="cp-note">${esc([me.callsign, hoursText(me.hours)].filter(Boolean).join(' · '))}</span>
                </span>
                ${S.linkable ? '<button class="cp-icon-btn" data-mf-pick title="Change which pilot you are"><i data-lucide="pencil"></i></button>' : ''}
            </div>
            ${discordRow()}
            <ul class="mf-legs">${rows}</ul>
            <div class="mf-actions">
                <button class="cp-btn cp-btn-sm" data-mf-schedule><i data-lucide="calendar-clock"></i> Schedule</button>
                <button class="cp-btn cp-btn-sm" data-mf-events><i data-lucide="calendar-days"></i> Events</button>
                <button class="cp-btn cp-btn-sm" data-mf-file=""><i data-lucide="clipboard-check"></i> File a flight</button>
                ${window.CrewStandings ? '<button class="cp-btn cp-btn-sm" data-mf-standings><i data-lucide="trophy"></i> Standings</button>' : ''}
            </div>`;
        icons();
        wire(el);
    }

    /**
     * Signing in with Discord, for a staff member who has a pilot side.
     *
     * Drawn only when there is a row to write the link on: the backend refuses
     * a link with nothing to hang it on, and a button that always refuses is
     * worse than no button. Nothing is drawn for a store-backed pilot either —
     * they have this on their own account page, and two places to link the same
     * thing is two places for it to disagree.
     */
    function discordRow() {
        const d = S.pilotSide && S.pilotSide.discord;
        if (!S.pilotSide.applies || !S.pilotSide.ready || !d || !d.available) return '';
        return d.linked
            ? `<div class="mf-dc">
                   <i data-lucide="check-circle-2"></i>
                   <span class="mf-dc-text">Discord linked${d.name ? ` — ${esc(d.name)}` : ''}. You can sign in with it.</span>
                   <button class="cp-btn cp-btn-sm" data-mf-dc-unlink ${S.busy ? 'disabled' : ''}>Unlink</button>
               </div>`
            : `<div class="mf-dc">
                   <i data-lucide="link"></i>
                   <span class="mf-dc-text">Link Discord and sign in with one press next time.</span>
                   <button class="cp-btn cp-btn-sm" data-mf-dc-link ${S.busy ? 'disabled' : ''}>Link Discord</button>
               </div>`;
    }

    /**
     * Make this staff member a pilot record of their own.
     *
     * One call. The backend creates the roster row when they have not got one
     * and binds the account to it, so there is nothing to pick and nothing to
     * type — which is the entire point of it existing.
     */
    async function setUpPilotSide() {
        if (S.busy) return;
        S.busy = true; paintAll();
        try {
            const d = await S.api('/me/pilot-side', { method: 'POST', body: {} });
            S.me = d.pilot || null;
            S.pilotSide = Object.assign(S.pilotSide, { applies: true, ready: true, discord: d.discord || S.pilotSide.discord });
            P.toast(d.created ? 'Your pilot account is set up.' : 'You already had one — here it is.', 'ok');
            if (S.me) await loadBookings();
        } catch (err) {
            P.toast(err.message || 'Could not set that up.', 'bad');
        } finally {
            S.busy = false; paintAll();
        }
    }

    /* Linking is a navigation, and the address has to be asked for rather than
       built here: starting the flow needs this session's bearer token, which a
       browser cannot attach to a navigation. Same round trip the pilot page
       makes, for the same reason. */
    async function linkDiscord() {
        if (S.busy) return;
        S.busy = true; paintAll();
        try {
            // So a staff member who linked from inside the app's Crew Center
            // overlay comes back into it, rather than to the standalone
            // dashboard in the overlay's frame. A boolean the backend seals
            // with the rest of the state; it cannot change where they land.
            let embed = '';
            try { embed = new URLSearchParams(window.location.search).get('embed') === '1' ? '1' : ''; } catch { embed = ''; }
            const d = await S.api('/auth/discord/link', { method: 'POST', body: { embed } });
            if (d && d.url) { window.location.href = d.url; return; }
            P.toast('Could not start that.', 'bad');
        } catch (err) {
            P.toast(err.message || 'Could not start that.', 'bad');
        }
        S.busy = false; paintAll();
    }

    async function unlinkDiscord() {
        if (S.busy) return;
        S.busy = true; paintAll();
        try {
            const d = await S.api('/account/discord', { method: 'DELETE' });
            S.pilotSide.discord = Object.assign({}, S.pilotSide.discord, d.discord || { linked: false, name: '' });
            P.toast('Unlinked. Your staff password still works.', 'ok');
        } catch (err) {
            P.toast(err.message || 'Could not unlink that.', 'bad');
        } finally {
            S.busy = false; paintAll();
        }
    }

    function paintAll() {
        hosts.forEach((el) => {
            if (!el.isConnected) { hosts.delete(el); return; }
            paint(el);
        });
    }

    /* ---------------------------------------------------------------------
     * Small formatters. Deliberately terse — this is a sidebar card, not the
     * schedule panel, and a full date on four rows would crowd out the legs.
     * ------------------------------------------------------------------- */
    const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';
    const hoursText = (h) => (Number(h) > 0 ? `${Math.round(Number(h) * 10) / 10}h` : '');
    function dayShort(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    }
    function timeShort(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    /* =====================================================================
     * ACTIONS
     * =================================================================== */

    function wire(el) {
        if (el.dataset.mfWired) return;      // the host element survives repaints
        el.dataset.mfWired = '1';
        el.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-mf-pick]')) return openPicker();
            if (ev.target.closest('[data-mf-setup]')) return setUpPilotSide();
            if (ev.target.closest('[data-mf-dc-link]')) return linkDiscord();
            if (ev.target.closest('[data-mf-dc-unlink]')) return unlinkDiscord();
            if (ev.target.closest('[data-mf-schedule]')) return window.CrewSchedule && CrewSchedule.open();
            // Staff fly, so staff place. The board ranks by flights in a window
            // rather than career hours, which is the only version an owner who
            // flies twice a month does not automatically top.
            if (ev.target.closest('[data-mf-standings]')) {
                return window.CrewStandings && CrewStandings.open({ api: S.api });
            }
            if (ev.target.closest('[data-mf-events]')) return window.CrewEvents && CrewEvents.open();
            const file = ev.target.closest('[data-mf-file]');
            if (file) {
                const id = file.getAttribute('data-mf-file');
                const found = S.bookings.find((x) => String(x.schedule.id) === String(id));
                return openFile(found ? found.schedule : null);
            }
        });
    }

    /**
     * File a flight.
     *
     * Their own Infinite Flight logbook first: staff fly the same aeroplanes as
     * everybody else, and a report read off the record beats one retyped into
     * the dashboard's form — which is a form built for filing on somebody
     * ELSE's behalf, with the whole roster in a dropdown.
     *
     * The booked departure rides along when there is one, so the leg still
     * credits against it and the booking still goes to flown. What happened on
     * the flight comes from Infinite Flight either way.
     *
     * The dashboard form stays as the fallback, for the same reason it does on
     * the pilot home: a flight Infinite Flight never logged still has to be
     * fileable. Its pilot picker is pre-set to this person.
     */
    function openFile(schedule) {
        if (window.CrewFlightPicker && S.api) {
            window.CrewFlightPicker.open({
                api: S.api,
                extra: schedule ? { scheduleId: schedule.id } : null,
                onFiled: () => { loadBookings().then(paintAll); },
                onManual: () => openFileByHand(schedule),
            });
            return;
        }
        openFileByHand(schedule);
    }

    function openFileByHand(schedule) {
        if (typeof window.openPireps !== 'function' || typeof window.openPirepForm !== 'function') {
            P.toast('File this flight from the Flights panel.', 'info');
            return;
        }
        window.openPireps();
        window.openPirepForm({
            memberId: S.me && S.me.memberId,
            scheduleId: schedule ? schedule.id : '',
            origin: schedule ? schedule.origin : '',
            destination: schedule ? schedule.destination : '',
            aircraft: schedule ? schedule.aircraft : '',
            flightNumber: schedule ? schedule.flightNumber : '',
        });
    }

    /**
     * "Which pilot am I?"
     *
     * Only ever sets the CALLER's own link — the endpoint refuses anything
     * else, because claiming to be another pilot would let a staff member book,
     * withdraw and file flights in that pilot's name.
     */
    async function openPicker() {
        if (!S.linkable) return;
        if (!S.roster.length) {
            try {
                const d = await S.api('/roster');
                S.roster = Array.isArray(d.roster) ? d.roster : [];
            } catch (err) {
                P.toast(err.message || 'Could not read the roster.', 'bad');
                return;
            }
        }

        const modal = dialog('Which pilot are you?', `
            <p class="cp-note">Pick your own record on the roster. This only affects what YOU can
                book and file — it does not change anybody’s pilot account. A pilot who already has
                their own crew center login cannot be picked: they are already somebody, and two
                people on one record would each be able to cancel the other’s flying.</p>
            <input id="mfSearch" class="cp-input" placeholder="Search the roster…" autocomplete="off">
            <ul id="mfRoster" class="mf-roster"></ul>
            ${S.me ? '<button class="cp-btn cp-btn-bad cp-btn-sm" id="mfUnlink">I don’t fly for this airline</button>' : ''}
            <p class="cp-note cp-hidden" id="mfPickNote"></p>`);

        const list = modal.el.querySelector('#mfRoster');
        const note = modal.el.querySelector('#mfPickNote');

        const draw = (q) => {
            const needle = String(q || '').trim().toLowerCase();
            const shown = S.roster.filter((m) => !needle
                || String(m.name || '').toLowerCase().includes(needle)
                || String(m.callsign || '').toLowerCase().includes(needle)).slice(0, 40);
            list.innerHTML = shown.length ? shown.map((m) => `
                <li><button class="mf-roster-row${S.me && String(S.me.memberId) === String(m.id) ? ' mf-roster-on' : ''}"
                    data-member="${esc(m.id)}">
                    <span class="mf-avatar mf-avatar-sm">${esc(initials(m.name))}</span>
                    <span class="mf-roster-main">
                        <span class="mf-name">${esc(m.name || 'Unnamed pilot')}</span>
                        <span class="cp-note">${esc([m.callsign, (m.rank && m.rank.name) || '', hoursText(m.hours)].filter(Boolean).join(' · '))}</span>
                    </span>
                    ${S.me && String(S.me.memberId) === String(m.id) ? '<i data-lucide="check"></i>' : ''}
                </button></li>`).join('')
                : '<li class="cp-note">Nobody on the roster matches that.</li>';
            icons();
        };
        draw('');
        modal.el.querySelector('#mfSearch').addEventListener('input', (ev) => draw(ev.target.value));

        const save = async (memberId) => {
            try {
                const d = await S.api('/me/pilot', { method: 'POST', body: { memberId } });
                S.me = d.pilot || null;
                modal.close();
                P.toast(d.linked ? `You’re flying as ${d.pilot.name}.` : 'Unlinked.', 'ok');
                if (S.me) await loadBookings(); else S.bookings = [];
                paintAll();
            } catch (err) {
                note.textContent = err.message || 'Could not save that.';
                note.className = 'cp-note cp-note-bad';
            }
        };

        list.addEventListener('click', (ev) => {
            const row = ev.target.closest('[data-member]');
            if (row) save(row.getAttribute('data-member'));
        });
        const unlink = modal.el.querySelector('#mfUnlink');
        if (unlink) unlink.addEventListener('click', () => save(''));
    }

    /** A small modal, the same shape the schedule's editor uses. */
    function dialog(title, html) {
        const el = document.createElement('div');
        el.className = 'cp-panel mf-dialog';
        el.innerHTML = `
            <div class="cp-scrim" data-mf-close></div>
            <div class="mf-dialog-card">
                <header class="cp-head">
                    <div class="cp-head-title"><span>${esc(title)}</span></div>
                    <button class="cp-icon-btn" data-mf-close aria-label="Close"><i data-lucide="x"></i></button>
                </header>
                <div class="mf-dialog-body">${html}</div>
            </div>`;
        document.body.appendChild(el);
        P.lockScroll();
        // Guarded for the same reason crewPanels guards it in sheet.open(): this
        // runs after the page has been locked, and an icon name lucide dislikes
        // must not strand the reader behind a dialog that never finished.
        try { icons(); } catch (err) { console.warn('crewMyFlying: icons failed', err); }

        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            el.remove();
            document.removeEventListener('keydown', onKey);
            P.unlockScroll();
        };
        function onKey(ev) { if (ev.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        el.addEventListener('click', (ev) => { if (ev.target.closest('[data-mf-close]')) close(); });
        return { el, close };
    }

    /* =====================================================================
     * STYLES
     * =================================================================== */

    function injectStyles() {
        P.baseStyles();
        P.style('mf-styles', `
        .mf-head{ display:flex; align-items:center; gap:.7rem; }
        .mf-avatar{ width:2.4rem; height:2.4rem; border-radius:.7rem; display:grid; place-items:center;
            background:var(--accent,#1C1A16); color:#fff; font-weight:800; font-size:.85rem; flex-shrink:0; }
        .mf-avatar-sm{ width:1.9rem; height:1.9rem; font-size:.7rem; border-radius:.5rem; }
        .mf-who{ min-width:0; flex:1; }
        .mf-name{ display:block; font-weight:700; letter-spacing:-.01em; color:var(--ink,#1C1A16);
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

        .mf-legs{ list-style:none; margin:.9rem 0 0; padding:0; display:grid; gap:.1rem; }
        .mf-leg{ display:flex; align-items:center; gap:.7rem; padding:.55rem 0; }
        .mf-leg + .mf-leg{ border-top:1px solid var(--line-soft,#F0ECE4); }
        .mf-leg-when{ display:grid; text-align:center; flex-shrink:0; width:3.2rem; }
        .mf-leg-day{ font-size:.7rem; font-weight:800; text-transform:uppercase; letter-spacing:.04em;
            color:var(--muted,#736E64); }
        .mf-leg-time{ font-size:.8rem; font-weight:700; color:var(--ink,#1C1A16); }
        .mf-leg-main{ flex:1; min-width:0; }
        .mf-leg-ports{ display:block; font-size:.85rem; font-weight:600; color:var(--ink,#1C1A16); }
        .mf-leg-sub{ display:block; font-size:.75rem; color:var(--muted,#736E64);
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .mf-none{ font-size:.85rem; color:var(--muted,#736E64); padding:.5rem 0; }
        .mf-inline{ background:none; border:0; padding:0; font:inherit; cursor:pointer;
            color:var(--accent,#1C1A16); font-weight:600; text-decoration:underline; }

        .mf-actions{ display:flex; gap:.4rem; margin-top:.9rem; flex-wrap:wrap; }
        .mf-actions .cp-btn{ flex:1 1 auto; justify-content:center; }

        .mf-link{ display:flex; align-items:center; gap:.9rem; flex-wrap:wrap; }
        .mf-link-text{ flex:1; min-width:12rem; }
        .mf-link-title{ font-weight:700; letter-spacing:-.01em; color:var(--ink,#1C1A16); }
        .mf-alt{ margin-top:.55rem; }

        /* The Discord row. Sits between who they are and what they are flying,
           because it is about getting IN rather than about the flying itself. */
        .mf-dc{ display:flex; align-items:center; gap:.55rem; flex-wrap:wrap;
            margin:.6rem 0 .2rem; padding:.55rem .65rem; border-radius:.6rem;
            background:color-mix(in srgb, var(--ink,#1C1A16) 4%, transparent); }
        .mf-dc [data-lucide]{ width:1rem; height:1rem; opacity:.7; }
        .mf-dc-text{ flex:1; min-width:10rem; font-size:.8125rem; color:var(--muted,#6b6b6b); }
        @media (max-width:40rem){ .mf-dc .cp-btn{ width:100%; justify-content:center; } }

        .mf-dialog{ z-index:90; }
        .mf-dialog-card{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
            width:min(94vw,30rem); max-height:88vh; overflow-y:auto; border-radius:.9rem;
            background:var(--surface,#fff); border:1px solid var(--line,#e5e5e5);
            box-shadow:0 24px 60px rgba(0,0,0,.28); }
        .mf-dialog-body{ padding:1rem; display:grid; gap:.7rem; }
        .mf-roster{ list-style:none; margin:0; padding:0; display:grid; gap:.3rem;
            max-height:22rem; overflow-y:auto; }
        .mf-roster-row{ width:100%; display:flex; align-items:center; gap:.6rem; text-align:left;
            padding:.5rem .6rem; border:1px solid var(--line,#e5e5e5); border-radius:.5rem;
            background:var(--surface,#fff); cursor:pointer; font:inherit; color:inherit; }
        .mf-roster-row:hover{ border-color:var(--ink,#1C1A16); }
        .mf-roster-on{ border-color:var(--accent,#1C1A16);
            background:color-mix(in srgb, var(--accent,#1C1A16) 8%, transparent); }
        .mf-roster-main{ flex:1; min-width:0; }

        @media (max-width:40rem){
            .mf-dialog-card{ left:0; right:0; bottom:0; top:auto; transform:none;
                width:100%; max-width:none; max-height:92vh; max-height:92dvh;
                border-radius:1.1rem 1.1rem 0 0;
                padding-bottom:env(safe-area-inset-bottom,0px); }
            .mf-dialog-card .cp-head{ padding-top:.75rem; }
            .mf-dialog-card .cp-head::before{ content:''; position:absolute; top:.4rem; left:50%;
                transform:translateX(-50%); width:2.25rem; height:.25rem; border-radius:999px;
                background:var(--line,#e5e5e5); }
            .mf-actions .cp-btn{ flex:1 1 100%; min-height:2.75rem; }
            .mf-roster-row{ min-height:2.9rem; }
            .mf-link .cp-btn{ width:100%; justify-content:center; min-height:2.75rem; }
        }`);
    }

    /* =====================================================================
     * PUBLIC API
     * =================================================================== */

    /**
     * Coming back from a Discord link round trip.
     *
     * The backend returns a staff member to the dashboard they started from
     * (see crewPageFor in crewAuth.js), with the outcome in the query. Read
     * once and wiped from the address bar, so a reload or a shared link does
     * not replay a message about something that happened minutes ago.
     */
    function readLinkReturn() {
        let q;
        try { q = new URLSearchParams(window.location.search); } catch { return; }
        const said = q.get('discord');
        if (!said) return;
        q.delete('discord');
        try {
            const rest = q.toString();
            window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
        } catch { /* older browser: leaving it in the bar is not worth failing over */ }
        const SAID = {
            linked: ['Discord linked. You can sign in with it from now on.', 'ok'],
            link_taken: ['That Discord account is already linked to somebody else here.', 'bad'],
            link_denied: ['That didn’t work — sign in again and try once more.', 'bad'],
            no_pilot_side: ['Set up your pilot account first, then link Discord.', 'bad'],
            needs_update: ['This crew center’s database needs updating before Discord can be linked.', 'bad'],
            /* THE VA'S DATA STORE, NOT DISCORD. Each of these used to arrive as
               "Discord didn’t answer. Please try again." — which is advice that
               cannot work, because Discord was never the thing that failed. */
            store_offline: ['This crew center’s data store didn’t answer. Try again in a minute.', 'bad'],
            store_denied: ['This crew center’s data store rejected our credentials. Ask your staff to re-copy the service key.', 'bad'],
            store_readonly: ['This crew center’s database is full, so nothing can be saved to it. Ask your staff to make room.', 'bad'],
            /* OUR CONFIGURATION, and the one reason here that names us. Trying
               again cannot fix it, so it does not ask anybody to. */
            discord_setup: ['Discord turned us away — this is our end, not yours. It has been logged; please tell your staff.', 'bad'],
            unavailable: ['Signing in with Discord isn’t switched on here.', 'bad'],
            cancelled: ['', ''],
            failed: ['Discord didn’t answer. Please try again.', 'bad'],
        };
        const hit = SAID[said];
        if (hit && hit[0]) P.toast(hit[0], hit[1]);
    }

    function mount({ backend, slug, token }) {
        injectStyles();
        S.api = P.api({ backend, slug, token });
        if (!String(slug || '')) return Promise.resolve(null);
        readLinkReturn();
        return load();
    }

    /** Paint into a host element, and keep it painted. */
    function render(el) {
        if (!el) return;
        injectStyles();
        hosts.add(el);
        paint(el);
    }

    window.CrewMyFlying = {
        mount, render,
        reload: () => load(),
        get pilot() { return S.me ? { ...S.me } : null; },
    };
})();
