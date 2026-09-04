/* ============================================================================
   crewSchedule.js — the airline's week, and the seat a pilot takes off it.

   WHAT THIS IS FOR

   The crew center shipped with a "Schedule" button on the hero and a
   "Schedules — Rosters & bookings" tile in the Manage grid. Neither did
   anything: no handler, no panel, nothing behind them. This is what they meant.

   A route says the airline flies LHR–JFK. A schedule says it flies at 18:40 on
   Thursday, in a 787, and one pilot puts their name against it. That is the
   difference between a network diagram and an operation, and it is the thing a
   VA's pilots actually open the crew center to look at.

   TWO AUDIENCES, ONE FILE

   Staff build the week; pilots book off it. Which of those a caller may do is
   decided by the BACKEND and reported as `canManage` — this file never has to
   be told who it is talking to, and cannot be talked into showing a staff
   control by a query parameter. Same rule crewEvents.js follows.

   THE SEAT IS NOT DECIDED HERE

   A pilot presses Book; the server picks the seat. This file never sends one
   and never draws a leg as "yours" on the strength of having asked. Publishing
   a fortnight of flying puts every pilot on the same page inside a minute, and
   a browser that decided which seat was free would lose that race and then
   render a schedule that disagrees with the database. When the answer comes
   back "somebody just took that seat", the list reloads and says so.

   WHAT IT NEVER DOES

   Invent a figure. A departure whose bookings the server did not send does not
   render "0 booked" — it renders nothing. Same rule as the dashboard's stat
   tiles and the events cards, and for the same reason: a plausible number is
   read as a fact.

   WHAT IT NEEDS FROM ITS HOST

       CrewSchedule.mount({ backend: BACKEND, slug: getSlug(), token: sessionToken });

   Then CrewSchedule.open() from a button. Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewSchedule: crewPanels.js must load first'); return; }
    const { esc, icons, timeText, dayLabel, dayKey, durationText } = P;

    const S = {
        api: null,
        slug: '',
        schedules: [],
        mine: [],           // this pilot's bookings, by departure
        // How this VA has chosen to run its schedule — whether it is on at all,
        // whether pilots book for themselves, the rank it opens at, the caps.
        // Read for PRESENTATION only: every one of these is enforced by the
        // backend, and each row arrives carrying its own `refusal` when the
        // pilot cannot take it. See the note on rowActions.
        rules: { enabled: true, booking: 'pilots', minRank: '', maxPerPilot: 0, openDaysAhead: 0, cancelHoursBefore: 0 },
        ranks: [],
        routes: [],         // the VA's network, for the editor's route picker
        routesLoaded: false,
        // The VA's real aeroplanes, out of their Infinite Flight organization.
        // Empty for a crew center that has not connected one, which is a
        // supported state and not an error — the editor simply omits the field.
        airframes: [],
        airframesLoaded: false,
        canManage: false,
        loaded: false,
        error: null,
        view: 'upcoming',   // 'upcoming' | 'all' | 'mine'
        fetchedAll: false,  // has a fetch without ?upcoming=1 landed yet?
        busy: '',           // id of the departure a request is in flight for
    };

    let panel = null;
    let editorOpen = false;

    const myBooking = (id) => S.mine.find((m) => String(m.scheduleId) === String(id)) || null;

    /* ---------------------------------------------------------------------
     * Whose copy of the rules is the real one
     *
     * The host page also learns whether the schedule is switched on — its
     * branding fetch carries the same object, and it needs it early to decide
     * whether to draw a Schedule button at all. But that response is cached for
     * five minutes, so an owner who has just turned the feature off would keep
     * seeing the button until the cache expired.
     *
     * This module's copy comes from /schedules, uncached, and is therefore the
     * one to believe. Rather than have the host poll or guess, it is told: any
     * page that cares registers a listener and repaints when the truth arrives.
     * ------------------------------------------------------------------- */
    const ruleListeners = [];

    function setRules(next) {
        const before = JSON.stringify(S.rules);
        S.rules = { ...S.rules, ...next };
        if (JSON.stringify(S.rules) === before) return;
        ruleListeners.forEach((fn) => { try { fn({ ...S.rules }); } catch { /* a host's own bug is not ours to throw */ } });
    }

    /* =====================================================================
     * DATA
     * =================================================================== */

    /**
     * Read the schedule.
     *
     * Asks for UPCOMING departures unless the "Everything" tab is open. A VA a
     * year into running a schedule has hundreds of flown legs, and pulling the
     * lot to render the fortnight a pilot came to look at is a payload nobody
     * asked for — the server's twelve-hour grace means the departure somebody
     * is airborne on is still in the upcoming set.
     */
    async function load() {
        const all = S.view === 'all';
        try {
            const d = await S.api(`/schedules${all ? '' : '?upcoming=1'}`);
            S.schedules = Array.isArray(d.schedules) ? d.schedules : [];
            S.mine = Array.isArray(d.mine) ? d.mine : [];
            S.ranks = Array.isArray(d.ranks) ? d.ranks : [];
            if (d.rules) setRules(d.rules);
            S.canManage = !!d.canManage;
            S.fetchedAll = all;
            S.error = null;
        } catch (err) {
            S.error = err;
            S.schedules = [];
            S.mine = [];
        }
        S.loaded = true;
        if (panel && panel.isOpen() && !editorOpen) render();
        return S.schedules;
    }

    /**
     * The network, for the editor's route picker. Fetched once, on demand.
     *
     * Published legs only. A draft route is one the airline has not started
     * flying; offering it in the picker put it on the schedule — and from
     * there onto every pilot's week and onto the VA's own website — without it
     * ever having been published. Same rule as everywhere else the network is
     * read (crewPanels.isPublishedRoute).
     */
    async function loadRoutes() {
        if (S.routesLoaded) return S.routes;
        try {
            const d = await S.api('/routes');
            S.routes = (Array.isArray(d.routes) ? d.routes : []).filter(P.isPublishedRoute);
        } catch { S.routes = []; }
        S.routesLoaded = true;
        return S.routes;
    }

    /**
     * The "which aeroplane?" field, or nothing at all.
     *
     * Drawn only for a VA that has connected a Live organization AND has
     * aircraft in it. A crew center without one sees the editor exactly as it
     * was — no empty dropdown, no "connect Infinite Flight" prompt in the
     * middle of a schedule form, because the person building next week's flying
     * did not come here to be sold an integration.
     *
     * The aeroplane a departure is already on is kept in the list even when it
     * has since gone into storage: dropping it would silently unassign the
     * departure the moment somebody opened it to change the time.
     */
    function airframeField(v) {
        const assigned = v.airframe || null;
        const list = S.airframes.slice();
        if (assigned && !list.some((a) => a.id === assigned.id)) {
            list.unshift({ id: assigned.id, registration: assigned.registration, storage: 'unknown' });
        }
        if (!list.length) return '';
        const opts = ['<option value="">No specific aircraft</option>']
            .concat(list.map((a) => {
                const label = a.registration || a.id;
                const note = a.storage === 'storage' ? ' — storage'
                    : a.storage === 'hangared' ? ' — hangared' : '';
                return `<option value="${esc(a.id)}" data-reg="${esc(a.registration || '')}"${assigned && assigned.id === a.id ? ' selected' : ''}>${esc(label + note)}</option>`;
            })).join('');
        return `<div>
            <label class="cp-label" for="csAirframe">Aircraft assigned</label>
            <select id="csAirframe" class="cp-select">${opts}</select>
            <p class="cp-note">The actual aeroplane from your Infinite Flight fleet, as opposed to the type above.
                Pilots booking this leg are told which one they are on.</p>
        </div>`;
    }

    /**
     * The aeroplanes this VA could put a departure on.
     *
     * These are real airframes out of the VA's Infinite Flight organization —
     * not the aircraft TYPE, which is the free-text field beside it and has
     * always been there.
     *
     * `/if/airframes` answers 200 with an empty list for a crew center that has
     * not connected an organization, so there is nothing to handle here: no
     * connection means no picker, and the schedule editor is otherwise
     * untouched. That is why this endpoint exists separately from the fleet
     * endpoints, which correctly 409 — a schedule form should not have to
     * understand the Live connection to draw one dropdown.
     */
    async function loadAirframes() {
        if (S.airframesLoaded) return S.airframes;
        try {
            const d = await S.api('/if/airframes');
            S.airframes = Array.isArray(d.airframes) ? d.airframes : [];
        } catch { S.airframes = []; }
        S.airframesLoaded = true;
        return S.airframes;
    }

    /* =====================================================================
     * THE LIST
     * =================================================================== */

    function visible() {
        const now = Date.now();
        if (S.view === 'mine') {
            return S.schedules.filter((s) => myBooking(s.id));
        }
        if (S.view === 'all') return S.schedules;
        // 'upcoming' — the default, and what a pilot wants: what is left to
        // fly. The twelve-hour grace matches the server's own window, so a
        // departure that pushed back an hour ago is still reachable by the
        // pilot who is airborne on it.
        return S.schedules.filter((s) => !s.departsAt
            || new Date(s.departsAt).getTime() > now - 12 * 3600 * 1000);
    }

    /** One row. The unit of this whole panel: a leg, a time, and who has it. */
    function row(s) {
        const mine = myBooking(s.id);
        const cancelled = s.status === 'cancelled';
        const draft = s.status === 'draft';
        const chips = [];

        if (draft) chips.push('<span class="cp-chip cp-chip-mute">Draft</span>');
        if (cancelled) chips.push('<span class="cp-chip cp-chip-bad">Cancelled</span>');
        if (mine) chips.push(`<span class="cp-chip cp-chip-ok"><i data-lucide="check"></i> ${mine.status === 'flown' ? 'Flown' : 'Yours'}</span>`);
        if (s.locked) {
            chips.push(`<span class="cp-chip cp-chip-warn"><i data-lucide="lock"></i> ${esc(s.minRank)}</span>`);
        } else if (s.minRank) {
            chips.push(`<span class="cp-chip">${esc(s.minRank)}+</span>`);
        }
        // Only when the server actually counted. `booked` is null when it did
        // not, and "0 of 1" would then be a number nobody computed.
        if (s.booked != null && !cancelled) {
            chips.push(s.full
                ? '<span class="cp-chip cp-chip-mute">Full</span>'
                : `<span class="cp-chip">${s.seatsLeft} of ${s.seats} open</span>`);
        }

        const block = durationText(s.blockMinutes);
        const facts = [
            s.departsAt ? `<span class="cp-fact"><i data-lucide="clock"></i> ${esc(timeText(s.departsAt))}${s.arrivesAt ? ` → ${esc(timeText(s.arrivesAt))}` : ''}</span>` : '',
            block ? `<span class="cp-fact"><i data-lucide="timer"></i> ${esc(block)}</span>` : '',
            s.aircraft ? `<span class="cp-fact"><i data-lucide="plane"></i> ${esc(s.aircraft)}</span>` : '',
            // The specific aeroplane, when one is assigned. Its own fact rather
            // than appended to the type, because they answer different
            // questions — "what am I flying" and "which one" — and a pilot
            // scanning a week is usually looking for the second.
            s.airframe && s.airframe.registration
                ? `<span class="cp-fact"><i data-lucide="tag"></i> ${esc(s.airframe.registration)}</span>` : '',
            s.seats > 1 ? `<span class="cp-fact"><i data-lucide="users"></i> ${s.seats} crew</span>` : '',
        ].filter(Boolean).join('');

        return `<article class="cs-row${mine ? ' cs-row-mine' : ''}${cancelled ? ' cs-row-off' : ''}" data-id="${esc(s.id)}">
            <div class="cs-row-main" data-detail="${esc(s.id)}" role="button" tabindex="0"
                aria-label="Details for ${esc(legText(s))}">
                <div class="cs-leg">
                    ${s.flightNumber ? `<span class="cs-flightno">${esc(s.flightNumber)}</span>` : ''}
                    <span class="cs-ports">${esc(s.origin || '???')} <i data-lucide="arrow-right"></i> ${esc(s.destination || '???')}</span>
                </div>
                <div class="cp-facts">${facts}</div>
                ${s.notes ? `<p class="cs-notes">${esc(s.notes)}</p>` : ''}
                <div class="cs-chips">${chips.join('')}</div>
            </div>
            <div class="cs-row-side">${rowActions(s, mine)}</div>
        </article>`;
    }

    /**
     * The buttons on a row, which are entirely about who is asking.
     *
     * WHERE THE ANSWER COMES FROM. `s.refusal` is computed by the server and
     * sent with the row — the airline's rules (is the feature on, do pilots
     * book for themselves, has the bidding window opened, is this pilot at
     * their cap) plus the rank ladder, all decided in the one place that also
     * enforces them at POST time. This function renders that sentence; it does
     * not work it out. Two implementations of one rule is how a UI ends up
     * promising something the server refuses.
     */
    function rowActions(s, mine) {
        const busy = S.busy === s.id;
        const out = [];

        if (s.status === 'published' && !s.locked) {
            if (mine) {
                const flown = mine.status === 'flown';
                const late = withinCancelCutoff(s);
                // A leg already flown is a record of what happened; the server
                // refuses to delete it, so the button is not offered. Inside
                // the VA's cutoff it is offered greyed, with the reason —
                // hiding it entirely would read as a missing feature.
                if (!flown) {
                    out.push(`<button class="cp-btn cp-btn-sm" data-cancel="${esc(s.id)}"
                        ${busy || late ? 'disabled' : ''}
                        ${late ? `title="Within ${S.rules.cancelHoursBefore}h of departure — talk to your staff"` : ''}>
                        <i data-lucide="x"></i> Give back</button>`);
                }
                // Filing is the flights panel's job — it already knows how to
                // turn a brief into a flight report, and a second copy of that
                // form here would be a second place for it to drift.
                if (!flown) {
                    out.push(`<button class="cp-btn cp-btn-sm" data-file="${esc(s.id)}"${busy ? ' disabled' : ''}>
                        <i data-lucide="clipboard-check"></i> File flight</button>`);
                }
            } else if (s.refusal) {
                // Greyed with the reason, rather than hidden. A pilot who
                // cannot see WHY a leg is closed to them asks staff instead.
                out.push(`<button class="cp-btn cp-btn-sm" disabled title="${esc(s.refusal.message)}">
                    <i data-lucide="${s.refusal.code === 'not_open_yet' ? 'clock' : 'lock'}"></i>
                    ${esc(refusalChip(s.refusal))}</button>`);
            } else if (!s.full) {
                out.push(`<button class="cp-btn cp-btn-sm cp-btn-primary" data-book="${esc(s.id)}"${busy ? ' disabled' : ''}>
                    <i data-lucide="hand"></i> Book</button>`);
            }
        }
        if (s.locked) {
            out.push(`<span class="cp-fact cs-locked">${s.hoursUntilUnlock
                ? `${Math.ceil(s.hoursUntilUnlock)}h to go` : 'Rank locked'}</span>`);
        }
        if (S.canManage) {
            out.push(`<button class="cp-btn cp-btn-sm cs-tool" data-edit="${esc(s.id)}" title="Edit" aria-label="Edit departure"><i data-lucide="pencil"></i></button>`);
            out.push(`<button class="cp-btn cp-btn-sm cs-tool" data-crew="${esc(s.id)}" title="Who is flying it" aria-label="Who is flying it"><i data-lucide="users"></i></button>`);
            out.push(`<button class="cp-btn cp-btn-sm cp-btn-bad cs-tool" data-del="${esc(s.id)}" title="Remove" aria-label="Remove departure"><i data-lucide="trash-2"></i></button>`);
        }
        return out.join('');
    }

    /** The refusal, short enough to sit on a button. Full text is the title. */
    function refusalChip(r) {
        if (r.code === 'not_open_yet') return 'Opens later';
        if (r.code === 'max_bookings') return 'At your limit';
        if (r.code === 'staff_assigned') return 'Staff assigned';
        if (r.code === 'rank_locked') return 'Rank locked';
        return 'Closed';
    }

    /**
     * Is this departure inside the VA's give-back cutoff?
     *
     * The one rule mirrored in the browser, because it is a clock comparison
     * rather than a policy decision and greying the button needs an answer now.
     * The server refuses regardless — this only decides whether the pilot is
     * told before or after they press.
     */
    function withinCancelCutoff(s) {
        const hrs = Number(S.rules.cancelHoursBefore) || 0;
        if (!hrs || !s.departsAt) return false;
        const dep = new Date(s.departsAt).getTime();
        return Number.isFinite(dep) && dep - Date.now() < hrs * 3600 * 1000;
    }

    /** Rows grouped into days, because that is how a schedule is read. */
    function grouped(list) {
        const days = new Map();
        for (const s of list) {
            const key = s.departsAt ? dayKey(s.departsAt) : 'undated';
            if (!days.has(key)) days.set(key, { label: s.departsAt ? dayLabel(s.departsAt) : 'No date yet', rows: [] });
            days.get(key).rows.push(s);
        }
        return [...days.values()];
    }

    function render() {
        const body = panel.body;

        if (!S.loaded) {
            body.innerHTML = '<div class="cp-empty">Loading the schedule…</div>';
            return;
        }
        if (S.error && P.isSchemaGap(S.error)) {
            body.innerHTML = P.schemaGapHtml(S.error);
            icons();
            wireStoreFix(body);
            return;
        }
        if (S.error) {
            body.innerHTML = `<div class="cp-empty"><i data-lucide="alert-triangle"></i>${esc(S.error.message)}</div>`;
            icons();
            return;
        }

        // The VA has turned the schedule off. Staff are told where the switch
        // is; a pilot is simply told, because "nothing is scheduled" would send
        // them back tomorrow to check again.
        if (!S.rules.enabled) {
            body.innerHTML = `<div class="cp-empty">
                <i data-lucide="calendar-off"></i>
                This crew center doesn’t use the schedule.
                ${S.canManage ? `<div style="margin-top:.9rem">
                    <button class="cp-btn cp-btn-primary" data-cs-settings>Turn it on</button>
                </div>` : ''}
            </div>`;
            icons();
            const on = body.querySelector('[data-cs-settings]');
            if (on) on.addEventListener('click', () => {
                panel.close();
                if (typeof window.openSettings === 'function') window.openSettings('crew');
            });
            return;
        }

        const list = visible();
        const tabs = `<div class="cs-tabs">
            ${['upcoming', 'all', 'mine'].map((v) => `<button class="cs-tab${S.view === v ? ' cs-tab-on' : ''}" data-view="${v}">
                ${v === 'upcoming' ? 'Upcoming' : v === 'all' ? 'Everything' : 'Mine'}</button>`).join('')}
        </div>`;

        // How this airline runs its bidding, stated once at the top rather than
        // discovered one greyed button at a time.
        const notes = [];
        if (S.rules.booking === 'staff') notes.push('Staff assign the flying on this schedule.');
        if (S.rules.minRank) notes.push(`Opens at ${S.rules.minRank}.`);
        if (S.rules.openDaysAhead) notes.push(`Booking opens ${S.rules.openDaysAhead} day${S.rules.openDaysAhead === 1 ? '' : 's'} before departure.`);
        if (S.rules.maxPerPilot) notes.push(`Up to ${S.rules.maxPerPilot} at a time per pilot.`);
        if (S.rules.cancelHoursBefore) notes.push(`Give a leg back at least ${S.rules.cancelHoursBefore}h before departure.`);
        const rulesBar = notes.length
            ? `<p class="cs-rules"><i data-lucide="info"></i> ${esc(notes.join(' '))}</p>`
            : '';

        const content = list.length
            ? grouped(list).map((day) => `
                <section class="cs-day">
                    <h3 class="cs-day-title">${esc(day.label)}
                        <span class="cp-faint">${day.rows.length} departure${day.rows.length === 1 ? '' : 's'}</span>
                    </h3>
                    ${day.rows.map(row).join('')}
                </section>`).join('')
            : `<div class="cp-empty"><i data-lucide="calendar-clock"></i>
                ${S.view === 'mine'
                    ? 'You haven’t booked any flying yet.'
                    : S.canManage
                        ? 'Nothing on the schedule yet. Add a departure — or a whole week of them — above.'
                        : 'Nothing scheduled yet. Your staff will publish the week here.'}</div>`;

        body.innerHTML = tabs + rulesBar + content;
        icons();
        wireList(body);
    }

    /**
     * One delegated click handler for the whole list, attached ONCE.
     *
     * The guard is not tidiness. `panel.body` survives every render — only its
     * innerHTML is replaced — so attaching here on each render stacked handlers:
     * open the panel (one render) and let the fetch land (a second), and a
     * single tap on Book fired POST /book twice. The second request lost the
     * race against its own twin and came back "you are already booked", so a
     * pilot whose booking had in fact succeeded was shown an error.
     *
     * Delegation is what makes the single listener correct — the rows it
     * matches on are replaced under it, and it keeps working.
     */
    function wireList(body) {
        if (body.dataset.csWired) return;
        body.dataset.csWired = '1';

        body.addEventListener('click', (ev) => {
            const tab = ev.target.closest('[data-view]');
            if (tab) {
                S.view = tab.getAttribute('data-view');
                render();
                // "Everything" is the only view that needs rows the upcoming
                // fetch left behind, so it is the only one that refetches.
                if (S.view === 'all' && !S.fetchedAll) load();
                return;
            }
            const el = ev.target.closest(ACTION_SELECTOR);
            if (el) runRowAction(el);
        });

        // A row is role="button", so it has to answer the keyboard like one.
        // Without this it takes focus, announces itself as pressable, and then
        // does nothing when pressed — which is worse than not being focusable.
        body.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            const el = ev.target.closest('[data-detail]');
            if (!el) return;
            ev.preventDefault();
            runRowAction(el);
        });
    }

    /** Everything on a row (or in its detail) that does something when pressed. */
    const ACTION_SELECTOR = '[data-book],[data-cancel],[data-edit],[data-del],[data-crew],[data-file],[data-detail]';

    /**
     * Service one press.
     *
     * Lifted out of the list's delegated handler because the detail dialog
     * carries the same buttons and is appended to <body>, not into panel.body —
     * so the delegation that covers the list cannot reach it. One function, two
     * callers, and the rules stay in one place.
     */
    async function runRowAction(el) {
        const id = el.getAttribute('data-book') || el.getAttribute('data-cancel')
            || el.getAttribute('data-edit') || el.getAttribute('data-del')
            || el.getAttribute('data-crew') || el.getAttribute('data-file')
            || el.getAttribute('data-detail');
        const s = S.schedules.find((x) => String(x.id) === String(id));
        if (!s) return;

        if (el.hasAttribute('data-detail')) return openDetail(s);
        if (el.hasAttribute('data-edit')) return openEditor(s);
        if (el.hasAttribute('data-crew')) return openCrewList(s);
        if (el.hasAttribute('data-file')) return fileFlight(s);

        if (el.hasAttribute('data-del')) {
            if (!window.confirm(`Remove ${legText(s)} from the schedule? Anyone booked on it loses the leg.`)) return;
            try {
                await S.api(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
                P.toast('Removed from the schedule.', 'ok');
                await load();
            } catch (err) { P.toast(err.message || 'Could not remove that.', 'bad'); }
            return;
        }

        S.busy = id;
        render();
        try {
            if (el.hasAttribute('data-book')) {
                await S.api(`/schedules/${encodeURIComponent(id)}/book`, { method: 'POST', body: {} });
                P.toast('Booked. See you at the gate.', 'ok');
            } else {
                await S.api(`/schedules/${encodeURIComponent(id)}/book`, { method: 'DELETE' });
                P.toast('Given back.', 'ok');
            }
        } catch (err) {
            // 'seat_taken' and 'full' are not failures of this browser —
            // they are the schedule having moved underneath it. Say what
            // happened and re-read, so the row the pilot is looking at is
            // the row the database has.
            P.toast(err.message || 'That didn’t work.', 'bad');
        } finally {
            S.busy = '';
            await load();
        }
    }

    const legText = (s) => [s.flightNumber, [s.origin, s.destination].filter(Boolean).join(' → ')]
        .filter(Boolean).join(' · ') || 'this departure';

    /* =====================================================================
     * THE DEPARTURE, IN FULL
     *
     * A row is a scanning shape: it has to stay one line tall so a week of
     * flying reads as a week. That makes it the wrong place to answer the
     * questions a pilot asks about ONE leg — what time do I land, is that the
     * same day, how long am I in the air, what am I flying.
     *
     * So a row opens this, and it is a TIMELINE rather than a second list of
     * facts. The reason is the arrival day. A schedule row shows "23:40 → 07:20"
     * and every reader has to work out for themselves that the second number is
     * tomorrow; a timeline puts the weekday against both ends and the question
     * stops being asked. Long-haul VAs are where the schedule gets used hardest
     * and where that ambiguity bites, which is what makes this worth a view.
     *
     * Presentation only. Every value here is already on the row — nothing new is
     * fetched, nothing new is stored, and a departure with no arrival time still
     * renders honestly rather than inventing one.
     * =================================================================== */

    /** "Wed" — the weekday alone, for pinning a clock time to its day. */
    function weekdayText(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString(undefined, { weekday: 'short' });
    }

    /** "Wed 11 Nov 2026" — the heading a departure is filed under. */
    function fullDateText(iso) {
        if (!iso) return 'Date to be confirmed';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return 'Date to be confirmed';
        return d.toLocaleDateString(undefined, {
            weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
        });
    }

    /**
     * One end of the leg: the mark on the spine, the clock, and the airport.
     *
     * `time` is empty when the VA published only a push-back time. That is a
     * real state — plenty of schedules carry no arrival — and it prints as a
     * dash rather than a guess computed from a block time nobody entered.
     */
    function timelineStop(kind, iso, place) {
        const clock = timeText(iso);
        const day = weekdayText(iso);
        return `<li class="cs-tl-row cs-tl-stop">
            <span class="cs-tl-mark" aria-hidden="true"><i data-lucide="plane-${kind === 'dep' ? 'takeoff' : 'landing'}"></i></span>
            <div class="cs-tl-text">
                <p class="cs-tl-time">${clock ? esc(clock) : '<span class="cp-faint">—</span>'}
                    ${day ? `<span class="cs-tl-day">${esc(day)}</span>` : ''}</p>
                <p class="cs-tl-place">${esc(place || '???')}</p>
            </div>
        </li>`;
    }

    function timelineHtml(s) {
        const block = durationText(s.blockMinutes);
        const mid = [
            s.flightNumber ? `<p class="cs-tl-flightno">${esc(s.flightNumber)}</p>` : '',
            s.aircraft ? `<p class="cs-tl-fact">${esc(s.aircraft)}</p>` : '',
            s.airframe && s.airframe.registration
                ? `<p class="cs-tl-fact">Aircraft ${esc(s.airframe.registration)}</p>` : '',
            block ? `<p class="cs-tl-fact">${esc(block)}</p>` : '',
            s.seats > 1 ? `<p class="cs-tl-fact">${s.seats} crew</p>` : '',
        ].filter(Boolean).join('');

        return `<ol class="cs-tl">
            ${timelineStop('dep', s.departsAt, s.origin)}
            <li class="cs-tl-row cs-tl-seg">
                <span class="cs-tl-mark" aria-hidden="true"></span>
                <div class="cs-tl-text">${mid || '<p class="cs-tl-fact cp-faint">No details published.</p>'}</div>
            </li>
            ${timelineStop('arr', s.arrivesAt, s.destination)}
        </ol>`;
    }

    /**
     * Open the detail for one departure.
     *
     * Carries the row's own actions at the foot rather than being read-only: a
     * pilot who opened this to check the arrival day is exactly the pilot about
     * to decide whether to take the leg, and sending them back to the row to
     * press Book would be a dead end. The markup is rowActions' own, so the
     * rules it encodes — refusals, cutoffs, staff tools — cannot drift from the
     * list's copy.
     */
    function openDetail(s) {
        const mine = myBooking(s.id);
        const block = durationText(s.blockMinutes);
        const chips = [];
        if (s.status === 'draft') chips.push('<span class="cp-chip cp-chip-mute">Draft</span>');
        if (s.status === 'cancelled') chips.push('<span class="cp-chip cp-chip-bad">Cancelled</span>');
        if (mine) chips.push(`<span class="cp-chip cp-chip-ok">${mine.status === 'flown' ? 'Flown' : 'Yours'}</span>`);
        if (s.booked != null && s.status !== 'cancelled') {
            chips.push(s.full
                ? '<span class="cp-chip cp-chip-mute">Full</span>'
                : `<span class="cp-chip">${s.seatsLeft} of ${s.seats} open</span>`);
        }
        if (s.minRank) chips.push(`<span class="cp-chip${s.locked ? ' cp-chip-warn' : ''}">${esc(s.minRank)}${s.locked ? '' : '+'}</span>`);

        const modal = dialog(`Departure ${fullDateText(s.departsAt)}`, `
            <p class="cs-tl-route">${esc([s.origin, s.destination].filter(Boolean).join(' – ') || 'Route to be confirmed')}</p>
            ${block ? `<p class="cs-tl-total">Total duration ${esc(block)}</p>` : ''}
            ${timelineHtml(s)}
            ${s.notes ? `<p class="cs-tl-notes">${esc(s.notes)}</p>` : ''}
            ${chips.length ? `<div class="cs-tl-chips">${chips.join('')}</div>` : ''}
            <div class="cs-tl-actions">${rowActions(s, mine)}</div>`);

        // Closed before the action runs, not after. Every one of these either
        // changes the leg (book, give back, remove) or opens a view of its own
        // (edit, crew, file) — so leaving this dialog up would either show a
        // state the server has already moved past, or stack a second sheet on a
        // first that has nothing left to say.
        modal.el.addEventListener('click', (ev) => {
            const el = ev.target.closest(ACTION_SELECTOR);
            if (!el) return;
            modal.close();
            runRowAction(el);
        });
    }

    /* =====================================================================
     * WHO IS FLYING IT — staff only
     * =================================================================== */

    async function openCrewList(s) {
        let d;
        try {
            d = await S.api(`/schedules/${encodeURIComponent(s.id)}`);
        } catch (err) { return P.toast(err.message || 'Could not load that departure.', 'bad'); }

        const crew = Array.isArray(d.crew) ? d.crew : [];
        const rows = crew.length
            ? crew.map((c) => `<div class="cs-crew-row">
                <span class="cs-seat">${c.seat}</span>
                <span class="cs-crew-name">${esc(c.pilotName)}${c.callsign ? ` <span class="cp-faint">${esc(c.callsign)}</span>` : ''}</span>
                <span class="cp-chip ${c.status === 'flown' ? 'cp-chip-ok' : 'cp-chip-mute'}">${c.status === 'flown' ? 'Flown' : 'Booked'}</span>
                <button class="cp-btn cp-btn-sm cp-btn-bad" data-unassign="${esc(c.id)}"><i data-lucide="x"></i></button>
            </div>`).join('')
            : '<p class="cp-note">Nobody has taken this leg yet.</p>';

        const modal = dialog(`Who is flying ${legText(s)}`, `
            <div class="cs-crew">${rows}</div>
            <form class="cs-assign" id="csAssign">
                <label class="cp-label">Assign somebody</label>
                <div class="cp-grid2">
                    <input id="csAssignName" class="cp-input" placeholder="Pilot name" maxlength="80" required>
                    <input id="csAssignCallsign" class="cp-input" placeholder="Callsign (optional)" maxlength="20">
                </div>
                <button class="cp-btn cp-btn-primary" type="submit"><i data-lucide="user-plus"></i> Assign</button>
                <p class="cp-note cp-hidden" id="csAssignNote"></p>
            </form>`);

        modal.el.querySelector('#csAssign').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const note = modal.el.querySelector('#csAssignNote');
            try {
                await S.api(`/schedules/${encodeURIComponent(s.id)}/bookings`, {
                    method: 'POST',
                    body: {
                        pilotName: modal.el.querySelector('#csAssignName').value.trim(),
                        callsign: modal.el.querySelector('#csAssignCallsign').value.trim(),
                    },
                });
                modal.close();
                P.toast('Assigned.', 'ok');
                await load();
            } catch (err) {
                note.textContent = err.message || 'Could not assign that pilot.';
                note.className = 'cp-note cp-note-bad';
            }
        });

        modal.el.addEventListener('click', async (ev) => {
            const un = ev.target.closest('[data-unassign]');
            if (!un) return;
            try {
                await S.api(`/schedules/${encodeURIComponent(s.id)}/bookings/${encodeURIComponent(un.getAttribute('data-unassign'))}`,
                    { method: 'DELETE' });
                modal.close();
                P.toast('Booking removed.', 'ok');
                await load();
            } catch (err) { P.toast(err.message || 'Could not remove that booking.', 'bad'); }
        });
    }

    /**
     * Filing the flight.
     *
     * Handed to the events module's flight form where there is one, because it
     * already knows how to turn a brief into a PIREP and duplicating it here
     * would give the crew center two flight forms that drift apart. Where there
     * is not, the pilot is pointed at the flights panel, which is the honest
     * answer rather than a half-built third form.
     */
    function fileFlight(s) {
        panel.close();
        if (typeof window.openPireps !== 'function' || typeof window.openPirepForm !== 'function') {
            P.toast('File this flight from the Flights panel.', 'info');
            return;
        }
        window.openPireps();
        window.openPirepForm({
            scheduleId: s.id, origin: s.origin, destination: s.destination,
            aircraft: s.aircraft, flightNumber: s.flightNumber,
        });
    }

    /* =====================================================================
     * THE EDITOR — staff only
     * =================================================================== */

    async function openEditor(s) {
        await Promise.all([loadRoutes(), loadAirframes()]);
        editorOpen = true;
        const isNew = !s;
        const v = s || {};

        const routeOpts = ['<option value="">Ad-hoc leg (not in the network)</option>']
            .concat(S.routes.map((r) => `<option value="${esc(r.id)}"${String(v.routeId || '') === String(r.id) ? ' selected' : ''}>
                ${esc([r.flightNumber, `${r.origin}–${r.destination}`, r.aircraft].filter(Boolean).join(' · '))}
            </option>`)).join('');

        const rankOpts = ['<option value="">Open to everyone</option>']
            .concat(S.ranks.map((r) => `<option value="${esc(r.name)}"${v.minRank === r.name ? ' selected' : ''}>${esc(r.name)}</option>`)).join('');

        const modal = dialog(isNew ? 'Add to the schedule' : 'Edit departure', `
            <form id="csEdit" class="cs-form">
                <div>
                    <label class="cp-label" for="csRoute">Route</label>
                    <select id="csRoute" class="cp-select">${routeOpts}</select>
                    <p class="cp-note">Picking one fills the leg in. The details stay editable —
                        a schedule can carry a charter the network doesn’t.</p>
                </div>
                <div class="cp-grid2">
                    <div><label class="cp-label" for="csOrigin">From</label>
                        <input id="csOrigin" class="cp-input" maxlength="4" placeholder="EGLL" value="${esc(v.origin || '')}" required></div>
                    <div><label class="cp-label" for="csDest">To</label>
                        <input id="csDest" class="cp-input" maxlength="4" placeholder="KJFK" value="${esc(v.destination || '')}" required></div>
                </div>
                <div class="cp-grid2">
                    <div><label class="cp-label" for="csFlightNo">Flight number</label>
                        <input id="csFlightNo" class="cp-input" maxlength="12" placeholder="BA117" value="${esc(v.flightNumber || '')}"></div>
                    <div><label class="cp-label" for="csAircraft">Aircraft</label>
                        <input id="csAircraft" class="cp-input" maxlength="60" placeholder="Boeing 787-9" value="${esc(v.aircraft || '')}"></div>
                </div>
                ${airframeField(v)}
                <div class="cp-grid2">
                    <div><label class="cp-label" for="csDep">Departs</label>
                        <input id="csDep" class="cp-input" type="datetime-local" value="${esc(forInput(v.departsAt))}"></div>
                    <div><label class="cp-label" for="csArr">Arrives (optional)</label>
                        <input id="csArr" class="cp-input" type="datetime-local" value="${esc(forInput(v.arrivesAt))}"></div>
                </div>
                <p class="cp-note">Times are in <b>your</b> timezone. Every pilot sees them in theirs.</p>
                <div class="cp-grid2">
                    <div><label class="cp-label" for="csSeats">Seats</label>
                        <input id="csSeats" class="cp-input" type="number" min="1" max="20" value="${Number(v.seats) || 1}"></div>
                    <div><label class="cp-label" for="csRank">Opens at</label>
                        <select id="csRank" class="cp-select">${rankOpts}</select></div>
                </div>
                ${isNew ? `
                <div class="cp-grid2">
                    <div><label class="cp-label" for="csRepeat">Repeat</label>
                        <select id="csRepeat" class="cp-select">
                            <option value="none">Just this one</option>
                            <option value="daily">Every day</option>
                            <option value="weekly">Every week</option>
                        </select></div>
                    <div><label class="cp-label" for="csCount">How many</label>
                        <input id="csCount" class="cp-input" type="number" min="1" max="60" value="1"></div>
                </div>
                <p class="cp-note">Build a fortnight in one go rather than typing Tuesday out ten times.</p>` : ''}
                <div>
                    <label class="cp-label" for="csNotes">Notes for the crew</label>
                    <textarea id="csNotes" class="cp-textarea" maxlength="2000"
                        placeholder="Anything the pilot flying this should know">${esc(v.notes || '')}</textarea>
                </div>
                <div>
                    <label class="cp-label" for="csStatus">Status</label>
                    <select id="csStatus" class="cp-select">
                        <option value="draft"${v.status === 'draft' || isNew ? ' selected' : ''}>Draft — only staff see it</option>
                        <option value="published"${v.status === 'published' ? ' selected' : ''}>Published — pilots can book</option>
                        <option value="cancelled"${v.status === 'cancelled' ? ' selected' : ''}>Cancelled</option>
                    </select>
                </div>
                <div class="cs-form-foot">
                    <button type="submit" class="cp-btn cp-btn-primary" id="csSave">
                        <i data-lucide="check"></i> ${isNew ? 'Add to schedule' : 'Save'}
                    </button>
                    <button type="button" class="cp-btn" data-cs-dialog-close>Cancel</button>
                </div>
                <p class="cp-note cp-hidden" id="csEditNote"></p>
            </form>`);

        modal.el.addEventListener('close-dialog', () => { editorOpen = false; });

        // Picking a route fills the leg in — without overwriting anything the
        // staff member has already typed over the top of it.
        const routeSel = modal.el.querySelector('#csRoute');
        routeSel.addEventListener('change', () => {
            const r = S.routes.find((x) => String(x.id) === routeSel.value);
            if (!r) return;
            const set = (id, val) => { const el = modal.el.querySelector(id); if (el && !el.value) el.value = val || ''; };
            set('#csOrigin', r.origin);
            set('#csDest', r.destination);
            set('#csFlightNo', r.flightNumber);
            set('#csAircraft', r.aircraft);
        });

        modal.el.querySelector('#csEdit').addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const note = modal.el.querySelector('#csEditNote');
            const btn = modal.el.querySelector('#csSave');
            const q = (id) => modal.el.querySelector(id);

            const body = {
                routeId: routeSel.value || '',
                origin: q('#csOrigin').value.trim().toUpperCase(),
                destination: q('#csDest').value.trim().toUpperCase(),
                flightNumber: q('#csFlightNo').value.trim(),
                aircraft: q('#csAircraft').value.trim(),
                // The registration travels with the id so the schedule can be
                // read without calling Infinite Flight — see the note on
                // crew_schedules.if_registration. Taken off the selected
                // <option> rather than looked up again, so the label stored is
                // exactly the one the person saw when they chose.
                ...(() => {
                    const sel = q('#csAirframe');
                    if (!sel) return {};      // no connection: leave both alone
                    const opt = sel.options[sel.selectedIndex];
                    return {
                        ifAircraftId: sel.value || '',
                        ifRegistration: (sel.value && opt ? opt.getAttribute('data-reg') : '') || '',
                    };
                })(),
                departsAt: fromInput(q('#csDep').value),
                arrivesAt: fromInput(q('#csArr').value),
                seats: Number(q('#csSeats').value) || 1,
                minRank: q('#csRank').value,
                notes: q('#csNotes').value.trim(),
                status: q('#csStatus').value,
            };
            if (isNew) {
                body.repeat = q('#csRepeat').value;
                body.count = Number(q('#csCount').value) || 1;
            }
            if (!body.origin || !body.destination) {
                note.textContent = 'A departure needs both airports.';
                note.className = 'cp-note cp-note-bad';
                return;
            }

            btn.disabled = true;
            try {
                const out = isNew
                    ? await S.api('/schedules', { method: 'POST', body })
                    : await S.api(`/schedules/${encodeURIComponent(s.id)}`, { method: 'PATCH', body });
                modal.close();
                editorOpen = false;
                P.toast(isNew
                    ? (out.created > 1 ? `${out.created} departures added.` : 'Added to the schedule.')
                    : 'Saved.', 'ok');
                await load();
            } catch (err) {
                note.textContent = err.message || 'Could not save that.';
                note.className = 'cp-note cp-note-bad';
                btn.disabled = false;
            }
        });
    }

    /* ---------------------------------------------------------------------
     * datetime-local <-> ISO
     *
     * The input speaks LOCAL time with no zone; the API speaks ISO. Converting
     * through the Date constructor is what makes "18:40" mean 18:40 where the
     * staff member is sitting, which is what they meant, rather than 18:40Z.
     * ------------------------------------------------------------------- */
    function forInput(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    function fromInput(v) {
        if (!v) return null;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }

    /* =====================================================================
     * A small modal, for the editor and the crew list
     * =================================================================== */

    function dialog(title, html) {
        const el = document.createElement('div');
        el.className = 'cp-panel cs-dialog';
        el.innerHTML = `
            <div class="cp-scrim" data-cs-dialog-close></div>
            <div class="cs-dialog-card">
                <header class="cp-head">
                    <div class="cp-head-title"><span>${esc(title)}</span></div>
                    <button class="cp-icon-btn" data-cs-dialog-close aria-label="Close"><i data-lucide="x"></i></button>
                </header>
                <div class="cs-dialog-body">${html}</div>
            </div>`;
        document.body.appendChild(el);
        P.lockScroll();
        icons();

        let closed = false;
        const close = () => {
            if (closed) return;            // the lock is counted; releasing twice unlocks the panel underneath
            closed = true;
            el.dispatchEvent(new CustomEvent('close-dialog'));
            el.remove();
            document.removeEventListener('keydown', onKey);
            P.unlockScroll();
        };
        function onKey(ev) { if (ev.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        el.addEventListener('click', (ev) => { if (ev.target.closest('[data-cs-dialog-close]')) close(); });

        return { el, close };
    }

    function wireStoreFix(root) {
        const btn = root.querySelector('[data-cp-fix-store]');
        if (!btn) return;
        btn.addEventListener('click', () => {
            panel.close();
            if (typeof window.openSettings === 'function') window.openSettings('data');
            else P.toast('Open Settings → Data store to update your database.', 'info');
        });
    }

    /* =====================================================================
     * STYLES
     * =================================================================== */

    function injectStyles() {
        P.baseStyles();
        P.style('cs-styles', `
        .cs-tabs{ display:flex; gap:.25rem; padding:.25rem; border-radius:.6rem;
            background:color-mix(in srgb, var(--ink,#1C1A16) 6%, transparent); }
        .cs-tab{ flex:1; padding:.4rem .6rem; border:0; border-radius:.45rem; cursor:pointer;
            background:transparent; color:var(--muted,#736E64); font-size:.82rem; font-weight:600;
            font-family:inherit; }
        .cs-tab-on{ background:var(--surface,#fff); color:var(--ink,#1C1A16);
            box-shadow:0 1px 2px rgba(0,0,0,.06); }

        .cs-day{ display:grid; gap:.5rem; }
        .cs-day-title{ display:flex; align-items:baseline; justify-content:space-between; gap:.75rem;
            margin:.5rem 0 0; font-size:.82rem; font-weight:700; text-transform:uppercase;
            letter-spacing:.05em; color:var(--muted,#736E64); }
        .cs-day-title span{ font-size:.72rem; font-weight:500; text-transform:none; letter-spacing:0; }

        .cs-row{ display:flex; align-items:flex-start; gap:.75rem; padding:.8rem .9rem;
            border:1px solid var(--line,#e5e5e5); border-radius:.7rem; background:var(--surface,#fff); }
        .cs-row-mine{ border-color:var(--accent,#1C1A16); }
        .cs-row-off{ opacity:.6; }
        .cs-row-main{ flex:1; min-width:0; display:grid; gap:.35rem; }
        .cs-row-side{ display:flex; flex-wrap:wrap; gap:.35rem; justify-content:flex-end;
            align-items:center; flex-shrink:0; max-width:14rem; }
        .cs-leg{ display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
        .cs-flightno{ font-size:.72rem; font-weight:800; letter-spacing:.06em; padding:.1rem .35rem;
            border-radius:.25rem; background:color-mix(in srgb, var(--accent,#1C1A16) 14%, transparent);
            color:var(--accent,#1C1A16); }
        .cs-ports{ display:inline-flex; align-items:center; gap:.4rem; font-size:1rem; font-weight:700;
            letter-spacing:-.01em; color:var(--ink,#1C1A16); }
        .cs-ports i{ width:.9rem; height:.9rem; color:var(--faint,#A8A296); }
        .cs-notes{ margin:0; font-size:.8rem; color:var(--muted,#736E64); white-space:pre-wrap; }
        .cs-chips{ display:flex; flex-wrap:wrap; gap:.3rem; }
        .cs-chips:empty{ display:none; }
        .cs-locked{ font-size:.75rem; }

        /* The row is pressable now — it opens the departure's detail. It has to
           look it, or the affordance is a secret. The cursor and the hover are
           on the main column only, because the action column beside it belongs
           to its own buttons. */
        .cs-row-main{ cursor:pointer; border-radius:.4rem; }
        .cs-row-main:hover .cs-ports{ text-decoration:underline; text-underline-offset:.15em; }
        .cs-row-main:focus-visible{ outline:2px solid var(--accent,#1C1A16); outline-offset:3px; }

        /* ===================================================================
         * THE DEPARTURE TIMELINE
         *
         * Two stops and the sector between them, down a spine. The spine is a
         * border on the mark column rather than a drawn line, so it grows with
         * the middle block's content and never needs a measured height.
         *
         * The weekday next to each clock is the whole point of the shape: an
         * overnight leg's arrival is a different day, and a row that reads
         * "23:40 → 07:20" makes every pilot work that out for themselves.
         * ================================================================= */
        .cs-tl-route{ margin:0; font-size:.9rem; font-weight:600; color:var(--muted,#736E64); }
        .cs-tl-total{ margin:.15rem 0 0; font-size:.82rem; color:var(--muted,#736E64); }
        .cs-tl{ list-style:none; margin:1rem 0 0; padding:0; }
        .cs-tl-row{ display:grid; grid-template-columns:1.5rem 1fr; gap:.75rem; }
        .cs-tl-mark{ position:relative; display:grid; justify-items:center; }
        /* The spine. Drawn on the mark column of every row, then stopped short
           at the two ends so it runs BETWEEN the stops and not past them. */
        .cs-tl-mark::before{ content:''; position:absolute; top:0; bottom:0; left:50%;
            width:2px; margin-left:-1px; border-radius:1px;
            background:color-mix(in srgb, var(--accent,#1C1A16) 35%, transparent); }
        .cs-tl-row:first-child .cs-tl-mark::before{ top:1.1rem; }
        .cs-tl-row:last-child .cs-tl-mark::before{ bottom:calc(100% - 1.1rem); }
        .cs-tl-stop .cs-tl-mark i{ position:relative; width:1.1rem; height:1.1rem; margin-top:.15rem;
            color:var(--accent,#1C1A16); background:var(--surface,#fff); }
        .cs-tl-text{ min-width:0; padding-bottom:1.1rem; }
        .cs-tl-seg .cs-tl-text{ padding-bottom:1.4rem; }
        .cs-tl-time{ margin:0; font-size:.95rem; font-weight:700; color:var(--ink,#1C1A16); }
        .cs-tl-day{ font-size:.8rem; font-weight:600; color:var(--muted,#736E64); margin-left:.3rem; }
        .cs-tl-place{ margin:.1rem 0 0; font-size:.85rem; color:var(--muted,#736E64); }
        .cs-tl-flightno{ margin:0; font-size:.85rem; font-weight:700; color:var(--ink,#1C1A16); }
        .cs-tl-fact{ margin:.1rem 0 0; font-size:.82rem; color:var(--muted,#736E64); }
        .cs-tl-notes{ margin:.4rem 0 0; font-size:.82rem; color:var(--muted,#736E64); white-space:pre-wrap; }
        .cs-tl-chips{ display:flex; flex-wrap:wrap; gap:.3rem; margin-top:.8rem; }
        .cs-tl-actions{ display:flex; flex-wrap:wrap; gap:.5rem; margin-top:1rem;
            padding-top:.9rem; border-top:1px solid var(--line,#e5e5e5); }
        .cs-tl-actions:empty{ display:none; }

        .cs-dialog{ z-index:90; }
        .cs-dialog-card{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
            width:min(94vw,34rem); max-height:88vh; overflow-y:auto; border-radius:.9rem;
            background:var(--surface,#fff); border:1px solid var(--line,#e5e5e5);
            box-shadow:0 24px 60px rgba(0,0,0,.28); }
        .cs-dialog-body{ padding:1rem; }
        .cs-form{ display:grid; gap:.8rem; }
        .cs-form-foot{ display:flex; gap:.5rem; }
        .cs-form-foot .cp-btn{ flex:1; justify-content:center; }

        .cs-crew{ display:grid; gap:.4rem; margin-bottom:1rem; }
        .cs-crew-row{ display:flex; align-items:center; gap:.6rem; padding:.5rem .6rem;
            border:1px solid var(--line,#e5e5e5); border-radius:.5rem; }
        .cs-crew-name{ flex:1; min-width:0; font-size:.85rem; font-weight:600; color:var(--ink,#1C1A16); }
        .cs-seat{ width:1.6rem; height:1.6rem; display:grid; place-items:center; border-radius:.35rem;
            background:color-mix(in srgb, var(--accent,#1C1A16) 14%, transparent);
            color:var(--accent,#1C1A16); font-size:.75rem; font-weight:800; }
        .cs-assign{ display:grid; gap:.6rem; padding-top:.9rem; border-top:1px solid var(--line,#e5e5e5); }

        .cs-rules{ display:flex; align-items:flex-start; gap:.4rem; margin:0; font-size:.78rem;
            color:var(--muted,#736E64); padding:.5rem .65rem; border-radius:.5rem;
            background:color-mix(in srgb, var(--accent,#1C1A16) 7%, transparent); }
        .cs-rules i{ flex-shrink:0; width:.9rem; height:.9rem; margin-top:.1rem; }

        /* ===================================================================
         * MOBILE
         *
         * A schedule row on a phone is not the desktop row wrapped. On the
         * desktop the eye goes left-to-right — leg, times, who has it, buttons.
         * On a phone that becomes four stacked fragments in a column, and the
         * thing a pilot actually scans for (where is it going, when) ends up
         * the same size as the aircraft type.
         *
         * So: the leg gets its own line at a size worth scanning, the facts
         * become one quiet line under it, and the actions become a full-width
         * row of real targets at the bottom — the order a thumb reads in.
         * ================================================================= */
        @media (max-width:40rem){
            .cs-tab{ padding:.55rem .5rem; min-height:2.5rem; }
            .cs-day-title{ position:sticky; top:0; z-index:1; margin:0; padding:.5rem .1rem;
                background:var(--surface,#fff); }
            .cs-row{ flex-direction:column; gap:.6rem; padding:.85rem .9rem; }
            .cs-ports{ font-size:1.05rem; }
            .cs-row-side{
                max-width:none; width:100%; justify-content:stretch;
                padding-top:.6rem; border-top:1px solid var(--line-soft,#F0ECE4);
            }
            /* The text buttons share the row; the icon-only staff controls keep
               a square footprint so they read as tools, not as choices. */
            .cs-row-side .cp-btn{ flex:1 1 0; justify-content:center; min-height:2.6rem; }
            .cs-row-side .cs-tool{ flex:0 0 2.75rem; padding:.5rem; }
            .cs-locked{ flex:1 1 100%; }

            .cs-dialog-card{
                left:0; right:0; bottom:0; top:auto; transform:none;
                width:100%; max-width:none; max-height:92vh; max-height:92dvh;
                border-radius:1.1rem 1.1rem 0 0;
                padding-bottom:env(safe-area-inset-bottom,0px);
            }
            .cs-dialog-card .cp-head{ padding-top:.75rem; }
            .cs-dialog-card .cp-head::before{
                content:''; position:absolute; top:.4rem; left:50%; transform:translateX(-50%);
                width:2.25rem; height:.25rem; border-radius:999px; background:var(--line,#e5e5e5);
            }
            .cs-dialog-body{ padding:.85rem; }
            /* Save stays reachable. The editor is a dozen fields tall on a
               phone, and a submit button at the bottom of it is a scroll away
               from every field you just filled in. */
            .cs-form-foot{
                position:sticky; bottom:0; z-index:2;
                margin:.25rem -.85rem 0; padding:.7rem .85rem;
                padding-bottom:calc(.7rem + env(safe-area-inset-bottom,0px));
                background:var(--surface,#fff); border-top:1px solid var(--line,#e5e5e5);
            }
            .cs-form-foot .cp-btn{ min-height:2.75rem; }
            /* The detail's actions get the same treatment as a row's on a
               phone: real targets, and the icon-only staff tools kept square so
               they stay tools rather than competing with Book. */
            .cs-tl-actions .cp-btn{ flex:1 1 0; justify-content:center; min-height:2.75rem; }
            .cs-tl-actions .cs-tool{ flex:0 0 2.75rem; padding:.5rem; }
            .cs-crew-row{ flex-wrap:wrap; }
            .cs-crew-name{ flex:1 1 60%; }
        }

        /* Between a phone and a desktop the row still works, but the action
           column must not squeeze the leg into two characters a line. */
        @media (min-width:40.0625rem) and (max-width:60rem){
            .cs-row-side{ max-width:11rem; }
        }`);
    }

    /* =====================================================================
     * PUBLIC API
     * =================================================================== */

    function ensurePanel() {
        if (panel) return panel;
        injectStyles();
        panel = P.sheet({
            id: 'csPanel', title: 'Schedule', icon: 'calendar-clock', wide: true,
            actions: '<button class="cp-btn cp-btn-primary cp-hidden" id="csNewBtn"><i data-lucide="plus"></i> Add departure</button>',
        });
        panel.el.querySelector('#csNewBtn').addEventListener('click', () => openEditor(null));
        return panel;
    }

    function open() {
        ensurePanel();
        panel.open();
        panel.el.querySelector('#csNewBtn').classList.toggle('cp-hidden', !S.canManage);
        render();
        // Always re-read on open: a schedule is exactly the thing somebody else
        // changed — or booked out from under this tab — while it sat there.
        load().then(() => {
            panel.el.querySelector('#csNewBtn').classList.toggle('cp-hidden', !S.canManage);
        });
    }

    function mount({ backend, slug, token }) {
        injectStyles();
        S.api = P.api({ backend, slug, token });
        S.slug = String(slug || '').toLowerCase();
        if (!S.slug) return Promise.resolve([]);
        return load();
    }

    window.CrewSchedule = {
        mount, open,
        close: () => panel && panel.close(),
        reload: () => load(),
        newDeparture: () => { open(); openEditor(null); },
        /**
         * Be told when the VA's schedule rules land, and again whenever they
         * change. Called immediately with what is known so a host does not have
         * to handle "before the first fetch" separately.
         */
        onRules(fn) {
            if (typeof fn !== 'function') return;
            ruleListeners.push(fn);
            fn({ ...S.rules });
        },
        get rules() { return { ...S.rules }; },
        get canManage() { return S.canManage; },
        get schedules() { return S.schedules.slice(); },
    };
})();
