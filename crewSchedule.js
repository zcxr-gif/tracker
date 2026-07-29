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
        ranks: [],
        routes: [],         // the VA's network, for the editor's route picker
        routesLoaded: false,
        canManage: false,
        loaded: false,
        error: null,
        view: 'upcoming',   // 'upcoming' | 'all' | 'mine'
        busy: '',           // id of the departure a request is in flight for
    };

    let panel = null;
    let editorOpen = false;

    const myBooking = (id) => S.mine.find((m) => String(m.scheduleId) === String(id)) || null;

    /* =====================================================================
     * DATA
     * =================================================================== */

    async function load() {
        try {
            const d = await S.api('/schedules');
            S.schedules = Array.isArray(d.schedules) ? d.schedules : [];
            S.mine = Array.isArray(d.mine) ? d.mine : [];
            S.ranks = Array.isArray(d.ranks) ? d.ranks : [];
            S.canManage = !!d.canManage;
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

    /** The network, for the editor's route picker. Fetched once, on demand. */
    async function loadRoutes() {
        if (S.routesLoaded) return S.routes;
        try {
            const d = await S.api('/routes');
            S.routes = Array.isArray(d.routes) ? d.routes : [];
        } catch { S.routes = []; }
        S.routesLoaded = true;
        return S.routes;
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
            s.seats > 1 ? `<span class="cp-fact"><i data-lucide="users"></i> ${s.seats} crew</span>` : '',
        ].filter(Boolean).join('');

        return `<article class="cs-row${mine ? ' cs-row-mine' : ''}${cancelled ? ' cs-row-off' : ''}" data-id="${esc(s.id)}">
            <div class="cs-row-main">
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

    /** The buttons on a row, which are entirely about who is asking. */
    function rowActions(s, mine) {
        const busy = S.busy === s.id;
        const out = [];

        if (s.status === 'published' && !s.locked) {
            if (mine) {
                out.push(`<button class="cp-btn cp-btn-sm" data-cancel="${esc(s.id)}"${busy ? ' disabled' : ''}>
                    <i data-lucide="x"></i> Give back</button>`);
                // Filing is the events panel's job — it already knows how to
                // turn a brief into a flight report, and a second copy of that
                // form here would be a second place for it to drift.
                out.push(`<button class="cp-btn cp-btn-sm" data-file="${esc(s.id)}"${busy ? ' disabled' : ''}>
                    <i data-lucide="clipboard-check"></i> File flight</button>`);
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
            out.push(`<button class="cp-btn cp-btn-sm" data-edit="${esc(s.id)}"><i data-lucide="pencil"></i></button>`);
            out.push(`<button class="cp-btn cp-btn-sm" data-crew="${esc(s.id)}" title="Who is flying it"><i data-lucide="users"></i></button>`);
            out.push(`<button class="cp-btn cp-btn-sm cp-btn-bad" data-del="${esc(s.id)}"><i data-lucide="trash-2"></i></button>`);
        }
        return out.join('');
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

        const list = visible();
        const tabs = `<div class="cs-tabs">
            ${['upcoming', 'all', 'mine'].map((v) => `<button class="cs-tab${S.view === v ? ' cs-tab-on' : ''}" data-view="${v}">
                ${v === 'upcoming' ? 'Upcoming' : v === 'all' ? 'Everything' : 'Mine'}</button>`).join('')}
        </div>`;

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

        body.innerHTML = tabs + content;
        icons();
        wireList(body);
    }

    function wireList(body) {
        body.addEventListener('click', async (ev) => {
            const tab = ev.target.closest('[data-view]');
            if (tab) { S.view = tab.getAttribute('data-view'); render(); return; }

            const el = ev.target.closest('[data-book],[data-cancel],[data-edit],[data-del],[data-crew],[data-file]');
            if (!el) return;

            const id = el.getAttribute('data-book') || el.getAttribute('data-cancel')
                || el.getAttribute('data-edit') || el.getAttribute('data-del')
                || el.getAttribute('data-crew') || el.getAttribute('data-file');
            const s = S.schedules.find((x) => String(x.id) === String(id));
            if (!s) return;

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
        });
    }

    const legText = (s) => [s.flightNumber, [s.origin, s.destination].filter(Boolean).join(' → ')]
        .filter(Boolean).join(' · ') || 'this departure';

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
        await loadRoutes();
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
        icons();

        const close = () => {
            el.dispatchEvent(new CustomEvent('close-dialog'));
            el.remove();
            document.removeEventListener('keydown', onKey);
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

        @media (max-width:38rem){
            .cs-row{ flex-direction:column; }
            .cs-row-side{ max-width:none; width:100%; justify-content:flex-start; }
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
        get canManage() { return S.canManage; },
        get schedules() { return S.schedules.slice(); },
    };
})();
