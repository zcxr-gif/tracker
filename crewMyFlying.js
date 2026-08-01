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

        if (!S.me) {
            el.innerHTML = `
                <div class="mf-link">
                    <div class="mf-link-text">
                        <div class="mf-link-title">Do you fly for this airline too?</div>
                        <p class="cp-note">Point your staff account at your own pilot record and you can
                            book legs, sign up for events and file flights from here.</p>
                    </div>
                    <button class="cp-btn cp-btn-primary" data-mf-pick>
                        <i data-lucide="user-check"></i> That’s me
                    </button>
                </div>`;
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
            <ul class="mf-legs">${rows}</ul>
            <div class="mf-actions">
                <button class="cp-btn cp-btn-sm" data-mf-schedule><i data-lucide="calendar-clock"></i> Schedule</button>
                <button class="cp-btn cp-btn-sm" data-mf-events><i data-lucide="calendar-days"></i> Events</button>
                <button class="cp-btn cp-btn-sm" data-mf-file=""><i data-lucide="clipboard-check"></i> File a flight</button>
            </div>`;
        icons();
        wire(el);
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
            if (ev.target.closest('[data-mf-schedule]')) return window.CrewSchedule && CrewSchedule.open();
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
     * File a flight, prefilled from the departure when there is one.
     *
     * Hands off to the dashboard's own PIREP form rather than growing a second
     * one. The pilot picker in that form is pre-set to this person, which is the
     * whole point — a staff member filing their own flight should not have to
     * find themselves in a dropdown of the entire roster.
     */
    function openFile(schedule) {
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
                book and file — it does not change anybody’s pilot account.</p>
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

    function mount({ backend, slug, token }) {
        injectStyles();
        S.api = P.api({ backend, slug, token });
        if (!String(slug || '')) return Promise.resolve(null);
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
