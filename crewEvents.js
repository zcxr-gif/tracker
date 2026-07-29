/* ============================================================================
   crewEvents.js — events in the crew center, and the gate board.

   Loaded by both crew-dashboard.html (staff) and crew-pilot.html (pilots) as a
   plain script, like crewBrand.js and crewBridge.js. One module, two audiences:
   what a caller may DO is decided by the backend and reported back as
   `canManage`, so this file never has to be told who it is talking to and can
   never be talked into showing a staff control by a query parameter.

   ── WHAT IT DRAWS ────────────────────────────────────────────────────────────

     • The calendar — a list of the VA's events, each card carrying who is
       going and, for a pilot, whether they are one of them.
     • The event itself — the brief, the attendee list, and the gate board.
     • The GATE BOARD — every stand at the event's airport on a map. Taken
       stands are drawn held and name who has them; free ones are pickable.

   ── THE GATE BOARD IS THE POINT ──────────────────────────────────────────────

   This is the same idea as the map behind the 📍 button on the tracker's
   dispatch form (FlightDispatchUI.js) — the same OpenStreetMap stands, the same
   Leaflet map, the same search box — with the one thing an event needs that
   filing a flight plan does not: occupancy. At an event a stand is not merely a
   place, it is a place somebody else may already be sitting in, and a board
   that does not say so is how twelve aircraft end up spawning on top of each
   other at gate B24.

   Two rules this file follows, and they are worth stating because they are the
   reason it is not simpler:

   1. IT NEVER DECIDES WHETHER A STAND IS FREE. It asks for one and reports
      what the server says. The claim is a unique index in the VA's own
      database; a browser that checked first would still lose the race, and
      would then draw a board that disagrees with the truth. When the answer is
      "that stand has just gone", the board reloads and says so.

   2. IT NEVER INVENTS A FIGURE. An attendance count the server did not send is
      not drawn as 0 — the card simply does not carry one. Same rule the
      dashboard's stat tiles follow, and for the same reason: a plausible
      number is read as a fact.

   ── WHAT IT NEEDS FROM ITS HOST ──────────────────────────────────────────────

   Nothing but a backend origin, a slug and a way to get the session token. It
   brings its own markup, its own styles and its own map, so a page adopts it
   with one call:

       CrewEvents.mount({ backend: BACKEND, slug: getSlug(), token: sessionToken });

   The host can then call CrewEvents.open() from a button, and
   CrewEvents.renderSummary(el) to paint a "next event" card wherever it likes.
   ========================================================================== */

(function () {
    'use strict';

    // Leaflet, from the same CDN and at the same version the dispatch gate
    // picker uses. Loaded on demand: most visits to a crew center never open a
    // gate board, and 150 KB of map library on every page load to serve the
    // ones that do is a bad trade.
    const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

    const S = {
        backend: '',
        slug: '',
        getToken: () => '',
        events: [],
        mine: [],           // this pilot's signups, by event
        ranks: [],
        canManage: false,
        loaded: false,
        openEventId: '',
        leafletReady: false,
    };

    /* ---------------------------------------------------------------------
     * Small helpers. Deliberately local rather than borrowed from the host —
     * this module is dropped into two different pages and must not depend on
     * which of them happens to define escapeHtml.
     * ------------------------------------------------------------------- */
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    // An image URL we are willing to put in an <img>. The backend already
    // refuses anything but https on the way in; this is the second gate, on the
    // way out, because a banner is the one field of an event that renders as
    // something other than text.
    const safeImg = (u) => { try { return new URL(u, location.href).protocol === 'https:'; } catch { return false; } };

    const icons = () => { if (window.lucide) window.lucide.createIcons(); };

    /** A date a human reads, in THEIR timezone — never in Z. */
    function whenText(iso) {
        if (!iso) return 'Date to be confirmed';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return 'Date to be confirmed';
        return d.toLocaleString(undefined, {
            weekday: 'short', day: 'numeric', month: 'short',
            hour: '2-digit', minute: '2-digit',
        });
    }

    /** "in 3 days" / "in 2 hours" / "under way" / "done". */
    function relativeText(iso) {
        if (!iso) return '';
        const ms = new Date(iso).getTime() - Date.now();
        if (Number.isNaN(ms)) return '';
        if (ms < -6 * 3600e3) return 'Flown';
        if (ms < 0) return 'Under way';
        const hours = ms / 3600e3;
        if (hours < 1) return `In ${Math.max(1, Math.round(ms / 60e3))} min`;
        if (hours < 48) return `In ${Math.round(hours)} h`;
        return `In ${Math.round(hours / 24)} days`;
    }

    const legText = (e) => [e.origin, e.destination].filter(Boolean).join(' → ') || 'Route to be confirmed';

    /* ---------------------------------------------------------------------
     * Talking to the backend
     * ------------------------------------------------------------------- */
    async function api(path, { method = 'GET', body = null } = {}) {
        const headers = { Accept: 'application/json' };
        const token = S.getToken();
        if (token) headers.Authorization = 'Bearer ' + token;
        if (body) headers['Content-Type'] = 'application/json';
        const res = await fetch(`${S.backend}/api/crew/${encodeURIComponent(S.slug)}${path}`, {
            method, headers, body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(data.error || 'That didn’t work.');
            err.code = data.code || '';
            err.status = res.status;
            throw err;
        }
        return data;
    }

    /* ---------------------------------------------------------------------
     * Toast. Its own, so the module behaves identically on a page that has no
     * notification system of its own.
     * ------------------------------------------------------------------- */
    function toast(msg, tone) {
        let host = document.getElementById('cev-toasts');
        if (!host) {
            host = document.createElement('div');
            host.id = 'cev-toasts';
            document.body.appendChild(host);
        }
        const el = document.createElement('div');
        el.className = 'cev-toast cev-toast-' + (tone || 'info');
        el.textContent = msg;
        host.appendChild(el);
        setTimeout(() => { el.classList.add('cev-out'); setTimeout(() => el.remove(), 300); }, 4200);
    }

    /* =====================================================================
     * THE CALENDAR
     * =================================================================== */

    async function load({ quiet = false } = {}) {
        try {
            const d = await api('/events');
            S.events = Array.isArray(d.events) ? d.events : [];
            S.mine = Array.isArray(d.mine) ? d.mine : [];
            S.ranks = Array.isArray(d.ranks) ? d.ranks : [];
            S.canManage = !!d.canManage;
            S.loaded = true;
            return null;
        } catch (err) {
            S.loaded = true;
            if (!quiet) toast(err.message, 'bad');
            return err;
        }
    }

    const mySignup = (eventId) => S.mine.find((m) => String(m.eventId) === String(eventId)) || null;

    /**
     * The card for one event.
     *
     * Note what is conditional: "34 going" only appears when the server counted
     * (`going` is a number, not null), and "4 seats left" only when the event
     * actually has a cap. An uncapped event has no seats-left figure to state,
     * and inventing one would turn "come along" into "hurry".
     */
    function eventCard(e) {
        const mine = mySignup(e.id);
        const banner = e.bannerUrl && safeImg(e.bannerUrl)
            ? `<img src="${esc(e.bannerUrl)}" alt="" class="cev-card-art" loading="lazy">`
            : '<div class="cev-card-art cev-card-art-blank"></div>';

        const chips = [];
        if (e.status === 'draft') chips.push('<span class="cev-chip cev-chip-draft">Draft</span>');
        if (e.status === 'cancelled') chips.push('<span class="cev-chip cev-chip-off">Cancelled</span>');
        if (e.locked) chips.push(`<span class="cev-chip cev-chip-lock">Opens at ${esc(e.minRank)}</span>`);
        if (mine) {
            chips.push(mine.status === 'waitlist'
                ? '<span class="cev-chip cev-chip-wait">You’re on the waitlist</span>'
                : `<span class="cev-chip cev-chip-in">You’re going${mine.gate ? ` · ${esc(mine.gate)}` : ''}</span>`);
        }

        const facts = [
            `<span class="cev-fact"><i data-lucide="map-pin"></i> ${esc(legText(e))}</span>`,
            `<span class="cev-fact"><i data-lucide="calendar-clock"></i> ${esc(whenText(e.startsAt))}</span>`,
            e.aircraft ? `<span class="cev-fact"><i data-lucide="plane"></i> ${esc(e.aircraft)}</span>` : '',
            e.server ? `<span class="cev-fact"><i data-lucide="signal"></i> ${esc(e.server)}</span>` : '',
        ].filter(Boolean).join('');

        // Attendance, only when it was actually counted.
        const going = typeof e.going === 'number'
            ? `${e.going} going${typeof e.seatsLeft === 'number' ? ` · ${e.seatsLeft} left` : ''}`
            : '';

        return `
            <article class="cev-card" data-event="${esc(e.id)}">
                ${banner}
                <div class="cev-card-body">
                    <div class="cev-card-chips">${chips.join('')}</div>
                    <h3 class="cev-card-title">${esc(e.title || 'Untitled event')}</h3>
                    <div class="cev-facts">${facts}</div>
                    <div class="cev-card-foot">
                        <span class="cev-going">${esc(going)}</span>
                        <span class="cev-rel">${esc(relativeText(e.startsAt))}</span>
                    </div>
                </div>
            </article>`;
    }

    function renderList() {
        const host = document.getElementById('cevList');
        if (!host) return;

        if (!S.loaded) {
            host.innerHTML = '<div class="cev-empty">Loading the calendar…</div>';
            return;
        }
        if (!S.events.length) {
            host.innerHTML = S.canManage
                ? `<div class="cev-empty">
                       <p class="cev-empty-title">No events yet</p>
                       <p>Publish one and it appears here, on your pilots’ home page, and on your own website.</p>
                   </div>`
                : `<div class="cev-empty">
                       <p class="cev-empty-title">Nothing on the calendar</p>
                       <p>When your crew schedules a group flight, it turns up here.</p>
                   </div>`;
            return;
        }
        host.innerHTML = S.events.map(eventCard).join('');
        icons();
    }

    /* =====================================================================
     * ONE EVENT — the brief, who is coming, and the board
     * =================================================================== */

    async function openEvent(id) {
        S.openEventId = id;
        const body = document.getElementById('cevDetailBody');
        const panel = document.getElementById('cevDetail');
        panel.classList.remove('cev-hidden');
        body.innerHTML = '<div class="cev-empty">Loading…</div>';

        let d;
        try {
            d = await api(`/events/${encodeURIComponent(id)}`);
        } catch (err) {
            body.innerHTML = `<div class="cev-empty"><p class="cev-empty-title">Couldn’t open that event</p><p>${esc(err.message)}</p></div>`;
            return;
        }

        const e = d.event;
        const attending = d.attending || [];
        const mine = d.mine;
        const going = attending.filter((a) => a.status === 'going');
        const waiting = attending.filter((a) => a.status === 'waitlist');

        document.getElementById('cevDetailTitle').textContent = e.title || 'Event';

        const banner = e.bannerUrl && safeImg(e.bannerUrl)
            ? `<img src="${esc(e.bannerUrl)}" alt="" class="cev-hero">` : '';

        // What the pilot can do about it, in one row. A cancelled event offers
        // nothing — there is nothing to join — and a locked one says what it is
        // waiting for rather than presenting a button that will refuse.
        let actions = '';
        if (e.status === 'cancelled') {
            actions = '<p class="cev-note cev-note-off">This event has been cancelled.</p>';
        } else if (e.locked) {
            actions = `<p class="cev-note">This event opens at <strong>${esc(e.minRank)}</strong>${
                e.hoursUntilUnlock ? ` — ${Math.round(e.hoursUntilUnlock)} more hours to go` : ''}.</p>`;
        } else if (mine) {
            actions = `
                <div class="cev-actions">
                    ${e.gatesOpen && !e.gatesLocked && mine.status === 'going'
                        ? `<button class="cev-btn cev-btn-primary" data-act="gates">
                               <i data-lucide="map-pinned"></i> ${mine.gate ? 'Change my stand' : 'Pick my stand'}
                           </button>`
                        : ''}
                    <button class="cev-btn" data-act="withdraw"><i data-lucide="user-minus"></i> Withdraw</button>
                </div>`;
        } else if (S.getToken()) {
            actions = `
                <div class="cev-actions">
                    <button class="cev-btn cev-btn-primary" data-act="join">
                        <i data-lucide="user-plus"></i> ${e.full ? 'Join the waitlist' : 'Sign up'}
                    </button>
                    ${e.gatesOpen && !e.gatesLocked
                        ? '<button class="cev-btn" data-act="gates"><i data-lucide="map-pinned"></i> See the gate board</button>'
                        : ''}
                </div>`;
        } else {
            actions = `
                <div class="cev-actions">
                    ${e.gatesOpen ? '<button class="cev-btn" data-act="gates"><i data-lucide="map-pinned"></i> See the gate board</button>' : ''}
                    <p class="cev-note">Sign in to your crew center to join.</p>
                </div>`;
        }

        // Staff get the board and the roll even when they are not flying it —
        // running an event is mostly knowing who has turned up.
        const staffBar = e.canManage ? `
            <div class="cev-actions cev-staff">
                <button class="cev-btn" data-act="edit"><i data-lucide="pencil"></i> Edit</button>
                <button class="cev-btn" data-act="gates"><i data-lucide="map-pinned"></i> Gate board</button>
                <button class="cev-btn" data-act="lock">
                    <i data-lucide="${e.gatesLocked ? 'lock-open' : 'lock'}"></i> ${e.gatesLocked ? 'Unlock stands' : 'Lock stands'}
                </button>
                ${e.status === 'published'
                    ? '<button class="cev-btn" data-act="cancel"><i data-lucide="ban"></i> Cancel event</button>'
                    : '<button class="cev-btn cev-btn-primary" data-act="publish"><i data-lucide="megaphone"></i> Publish</button>'}
                <button class="cev-btn cev-btn-bad" data-act="delete"><i data-lucide="trash-2"></i> Delete</button>
            </div>` : '';

        const row = (a) => `
            <li class="cev-att">
                <span class="cev-att-name">${esc(a.pilotName || 'A pilot')}</span>
                ${a.callsign ? `<span class="cev-att-cs">${esc(a.callsign)}</span>` : ''}
                ${a.aircraft ? `<span class="cev-att-ac">${esc(a.aircraft)}</span>` : ''}
                ${a.gate ? `<span class="cev-att-gate">${esc(a.gate)}</span>` : '<span class="cev-att-nogate">no stand yet</span>'}
                ${e.canManage ? `<button class="cev-att-x" data-remove="${esc(a.id)}" title="Remove from the event"><i data-lucide="x"></i></button>` : ''}
            </li>`;

        body.innerHTML = `
            ${banner}
            <div class="cev-detail-facts">
                <span class="cev-fact"><i data-lucide="map-pin"></i> ${esc(legText(e))}</span>
                <span class="cev-fact"><i data-lucide="calendar-clock"></i> ${esc(whenText(e.startsAt))}</span>
                ${e.aircraft ? `<span class="cev-fact"><i data-lucide="plane"></i> ${esc(e.aircraft)}</span>` : ''}
                ${e.server ? `<span class="cev-fact"><i data-lucide="signal"></i> ${esc(e.server)}</span>` : ''}
                ${e.flightNumber ? `<span class="cev-fact"><i data-lucide="hash"></i> ${esc(e.flightNumber)}</span>` : ''}
            </div>
            ${e.description ? `<p class="cev-desc">${esc(e.description)}</p>` : ''}
            ${actions}
            ${staffBar}

            <section class="cev-section">
                <h4 class="cev-h4">
                    Who’s attending
                    <span class="cev-count">${going.length}${e.slots ? ` of ${e.slots}` : ''}</span>
                </h4>
                ${going.length
                    ? `<ul class="cev-atts">${going.map(row).join('')}</ul>`
                    : '<p class="cev-quiet">Nobody yet — be the first.</p>'}
                ${waiting.length ? `
                    <h4 class="cev-h4 cev-h4-sub">Waitlist <span class="cev-count">${waiting.length}</span></h4>
                    <ul class="cev-atts cev-atts-wait">${waiting.map(row).join('')}</ul>` : ''}
            </section>`;

        icons();
        wireDetail(e, mine);
    }

    function wireDetail(e, mine) {
        const body = document.getElementById('cevDetailBody');
        body.querySelectorAll('[data-act]').forEach((btn) => {
            btn.addEventListener('click', () => runAction(btn.dataset.act, e, mine, btn));
        });
        body.querySelectorAll('[data-remove]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    await api(`/events/${encodeURIComponent(e.id)}/signups/${encodeURIComponent(btn.dataset.remove)}`, { method: 'DELETE' });
                    toast('Taken off the event.', 'ok');
                    await refreshAll(e.id);
                } catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
            });
        });
    }

    async function runAction(act, e, mine, btn) {
        const busy = (on) => { if (btn) btn.disabled = on; };
        try {
            if (act === 'gates') { await openGateBoard(e); return; }
            if (act === 'edit') { openEditor(e); return; }

            if (act === 'join') {
                busy(true);
                const d = await api(`/events/${encodeURIComponent(e.id)}/signup`, { method: 'POST', body: {} });
                toast(d.waitlisted
                    ? 'You’re on the waitlist — we’ll move you up if a place frees.'
                    : 'You’re signed up. Pick a stand next.', 'ok');
                await refreshAll(e.id);
                // Straight on to the board: signing up and then hunting for the
                // stand button is two steps for one intention.
                if (!d.waitlisted && e.gatesOpen && !e.gatesLocked) {
                    const fresh = S.events.find((x) => x.id === e.id) || e;
                    await openGateBoard(fresh);
                }
                return;
            }
            if (act === 'withdraw') {
                if (!confirm('Withdraw from this event? Your stand goes back on the board.')) return;
                busy(true);
                await api(`/events/${encodeURIComponent(e.id)}/signup`, { method: 'DELETE' });
                toast('Withdrawn.', 'ok');
                await refreshAll(e.id);
                return;
            }
            if (act === 'publish' || act === 'cancel') {
                busy(true);
                await api(`/events/${encodeURIComponent(e.id)}`, {
                    method: 'PATCH', body: { status: act === 'publish' ? 'published' : 'cancelled' },
                });
                toast(act === 'publish' ? 'Published — your crew can see it now.' : 'Cancelled. Everyone signed up keeps the notice.', 'ok');
                await refreshAll(e.id);
                return;
            }
            if (act === 'lock') {
                busy(true);
                await api(`/events/${encodeURIComponent(e.id)}`, { method: 'PATCH', body: { gatesLocked: !e.gatesLocked } });
                toast(e.gatesLocked ? 'Stands are open again.' : 'Stands locked — pilots can’t move now, you still can.', 'ok');
                await refreshAll(e.id);
                return;
            }
            if (act === 'delete') {
                if (!confirm('Delete this event? Everyone signed up loses their place, and it cannot be undone.')) return;
                busy(true);
                await api(`/events/${encodeURIComponent(e.id)}`, { method: 'DELETE' });
                toast('Event deleted.', 'ok');
                closeDetail();
                await refreshAll();
            }
        } catch (err) {
            toast(err.message, 'bad');
            busy(false);
        }
    }

    async function refreshAll(reopenId) {
        await load({ quiet: true });
        renderList();
        paintSummaries();
        if (reopenId) await openEvent(reopenId);
    }

    function closeDetail() {
        S.openEventId = '';
        document.getElementById('cevDetail').classList.add('cev-hidden');
    }

    /* =====================================================================
     * THE GATE BOARD
     *
     * Every stand at the airport on a map: held ones drawn as held and naming
     * who has them, free ones pickable. The list beside it is the same data in
     * the form you use when you already know the stand you want.
     * =================================================================== */

    async function ensureLeaflet() {
        if (S.leafletReady && window.L) return;
        if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = LEAFLET_CSS;
            document.head.appendChild(link);
        }
        if (!window.L) {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = LEAFLET_JS;
                s.onload = resolve;
                s.onerror = () => reject(new Error('Couldn’t load the map.'));
                document.head.appendChild(s);
            });
        }
        S.leafletReady = true;
    }

    let boardMap = null;
    let boardLayer = null;

    async function openGateBoard(e) {
        const modal = document.getElementById('cevGates');
        modal.classList.remove('cev-hidden');
        document.getElementById('cevGatesTitle').textContent = `Gate board · ${e.gateIcao || '—'}`;
        document.getElementById('cevGatesSub').textContent = 'Loading stands…';
        document.getElementById('cevGateList').innerHTML = '';

        let d;
        try {
            d = await api(`/events/${encodeURIComponent(e.id)}/gates`);
        } catch (err) {
            document.getElementById('cevGatesSub').textContent = err.message;
            return;
        }

        const gates = d.gates || [];
        const free = gates.filter((g) => !g.taken).length;
        const mine = mySignup(e.id);

        // What the strip under the title says. It is doing real work: "23 free"
        // is the number a pilot opening this actually wants, and the locked /
        // unavailable states explain a board they cannot pick from rather than
        // leaving them tapping dead markers.
        let sub = `${gates.length} stands · ${free} free`;
        if (d.source === 'unavailable') {
            sub = gates.length
                ? 'OpenStreetMap is unreachable — showing only the stands already taken.'
                : 'OpenStreetMap is unreachable, so the stands can’t be drawn. Try again shortly.';
        } else if (d.gatesLocked) {
            sub += ' · stands are locked';
        }
        document.getElementById('cevGatesSub').textContent = sub;

        // Who may take a stand off this board.
        //
        // Anyone signed in, not just someone already on the attendee list:
        // opening the board is how a pilot decides to come, and "See the gate
        // board" is offered before signing up on purpose. Tapping a free stand
        // signs them up onto it (see claimGate) rather than telling them the
        // stand is free and leaving them to work out the order of operations.
        //
        // A waitlisted pilot cannot, because they hold no stand until a place
        // frees. Staff can even when the board is locked, since locking is what
        // stops PILOTS shuffling and the person doing the final allocation is
        // exactly who needs to move people then. Both rules are the server's;
        // these mirror them so the board does not offer a tap that will fail.
        const boardLive = d.gatesOpen && !d.gatesLocked;
        const asPilot = !!S.getToken() && boardLive && (!mine || mine.status === 'going');
        const asStaff = !!e.canManage && d.gatesOpen;
        const pickable = asPilot || asStaff;

        // The list first, and on its own. It is the half that needs nothing but
        // the data we already have, so a pilot can find and take a stand before
        // — or entirely without — the map library arriving. The map is the nicer
        // way to do it, not the only way.
        drawGateList(gates, mine, e, pickable);
        drawGateMap(gates, mine, e, pickable);
    }

    const isMineGate = (g, mine) => !!(mine && mine.gate
        && String(g.ref).toUpperCase() === String(mine.gate).toUpperCase());

    /**
     * The stand list.
     *
     * Ordered so the ones you can actually have come first: a board at a big
     * field is two hundred stands, and scrolling past everybody else's to find
     * a free one is not a search.
     */
    function drawGateList(gates, mine, e, pickable) {
        const sorted = gates.slice().sort((a, b) => {
            if (a.taken !== b.taken) return a.taken ? 1 : -1;
            return String(a.ref).localeCompare(String(b.ref), undefined, { numeric: true });
        });
        document.getElementById('cevGateList').innerHTML = sorted.map((g) => `
            <li class="cev-gate ${g.taken ? 'cev-gate-taken' : 'cev-gate-free'} ${isMineGate(g, mine) ? 'cev-gate-mine' : ''}"
                data-gate="${esc(g.ref)}">
                <span class="cev-gate-ref">${esc(g.ref)}</span>
                <span class="cev-gate-who">${g.taken
                    ? esc(g.takenBy) + (g.takenByAircraft ? ` · ${esc(g.takenByAircraft)}` : '')
                    : 'Free'}</span>
                ${g.unmapped ? '<span class="cev-gate-tag" title="Not on the map at this airport">off-map</span>' : ''}
            </li>`).join('');

        const byRef = new Map(gates.map((g) => [String(g.ref).toUpperCase(), g]));
        document.querySelectorAll('#cevGateList [data-gate]').forEach((li) => {
            li.addEventListener('click', () => {
                const g = byRef.get(li.dataset.gate.toUpperCase());
                if (!g) return;
                // `animate: false` on purpose. Claiming this stand redraws the
                // board, and Leaflet's zoom animation queues an end-handler
                // that fires after the map is gone — a jump with no transition
                // has nothing left pending, and for "show me this stand" an
                // instant move is what you want anyway.
                if (boardMap && Number.isFinite(g.lat) && Number.isFinite(g.lon)) {
                    boardMap.setView([g.lat, g.lon], 18, { animate: false });
                }
                // Same deferral as the map pins: a claim redraws the board, and
                // the map must not be destroyed mid-pan.
                setTimeout(() => claimGate(g, e, mine, pickable), 0);
            });
        });

        const search = document.getElementById('cevGateSearch');
        search.value = '';
        search.oninput = () => {
            const q = search.value.trim().toUpperCase();
            document.querySelectorAll('#cevGateList [data-gate]').forEach((li) => {
                li.style.display = !q || li.dataset.gate.toUpperCase().includes(q) ? '' : 'none';
            });
            filterMarkers(q);
        };
    }

    let boardMarkers = [];

    /**
     * Tear the board's map down.
     *
     * `stop()` before `remove()` is the whole point of having this in one
     * place. Panning to a stand starts an animation, and claiming that stand
     * redraws the board — so without it the animation's next frame lands on a
     * map whose panes have already been removed, and Leaflet throws from
     * somewhere that has nothing to do with events.
     */
    function destroyBoardMap() {
        if (!boardMap) return;
        try { boardMap.stop(); } catch { /* older builds: nothing to stop */ }
        boardMap.remove();
        boardMap = null;
        boardLayer = null;
        boardMarkers = [];
    }

    /** Narrow the map to what the search box says, when there is a map. */
    function filterMarkers(q) {
        if (!boardMap || !boardLayer) return;
        boardLayer.clearLayers();
        const hits = q ? boardMarkers.filter((m) => m.options.gateRef.toUpperCase().includes(q)) : boardMarkers;
        hits.forEach((m) => boardLayer.addLayer(m));
        // Unanimated for the same reason as the list jump above: a search that
        // lands on one stand is usually one tap away from claiming it.
        if (hits.length === 1) boardMap.setView(hits[0].getLatLng(), 18, { animate: false });
    }

    async function drawGateMap(gates, mine, e, pickable) {
        const host = document.getElementById('cevGateMap');

        // Leaflet keeps state on the container, so a re-open has to start from
        // a clean map rather than a second one bound to the same element.
        destroyBoardMap();
        host.innerHTML = '';

        try {
            await ensureLeaflet();
        } catch {
            // The list is still there and still works, so say what is missing
            // rather than leaving an empty grey rectangle that looks broken.
            host.innerHTML = '<p class="cev-map-fallback">The map didn’t load — pick a stand from the list.</p>';
            return;
        }
        // The board can be reopened while this was loading; if a newer draw has
        // already taken the container, leave it alone.
        if (document.getElementById('cevGates').classList.contains('cev-hidden')) return;

        const L = window.L;
        const placed = gates.filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon));
        // Held in a local as well as the module slot: the deferred fitBounds
        // below must act on THIS map, not on whichever one exists by the time
        // the frame runs.
        const map = L.map(host, { zoomControl: true, attributionControl: true });
        boardMap = map;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, attribution: '© OpenStreetMap contributors',
        }).addTo(map);

        if (placed.length) {
            const lats = placed.map((g) => g.lat);
            const lons = placed.map((g) => g.lon);
            // Deferred so the modal has its final size first; guarded because a
            // board closed inside that frame leaves a map with no container.
            requestAnimationFrame(() => {
                if (boardMap !== map) return;
                map.fitBounds([
                    [Math.min(...lats), Math.min(...lons)],
                    [Math.max(...lats), Math.max(...lons)],
                ], { padding: [40, 40], animate: false });
            });
        } else {
            map.setView([0, 0], 2);
        }

        boardMarkers = placed.map((g) => {
            const state = isMineGate(g, mine) ? 'mine' : g.taken ? 'taken' : 'free';
            const icon = L.divIcon({
                className: `cev-pin cev-pin-${state}`,
                html: `<span>${esc(g.ref)}</span>`,
                iconSize: null,
            });
            const m = L.marker([g.lat, g.lon], { icon, gateRef: g.ref });
            m.bindTooltip(
                g.taken
                    ? `${esc(g.ref)} — ${esc(g.takenBy)}${g.takenByAircraft ? ` · ${esc(g.takenByAircraft)}` : ''}`
                    : `${esc(g.ref)} — free`,
                { direction: 'top', offset: [0, -8] },
            );
            // Handed off to a later tick on purpose. Claiming a stand redraws
            // the board, which destroys this map — and destroying a map from
            // inside its own click dispatch leaves Leaflet reaching for state
            // it has just torn down. Letting the dispatch finish first costs
            // nothing and is the whole fix.
            m.on('click', () => setTimeout(() => claimGate(g, e, mine, pickable), 0));
            return m;
        });
        boardLayer = L.layerGroup(boardMarkers).addTo(map);
    }

    /**
     * Take a stand.
     *
     * The optimism here is deliberate and bounded: we send the claim and let
     * the server settle it. A `gate_taken` back means somebody won the race in
     * the seconds since the board was drawn — so we say exactly that and redraw
     * from the truth, rather than leaving a marker looking claimed.
     */
    async function claimGate(g, e, mine, pickable) {
        if (!pickable) {
            toast(g.taken ? `${g.ref} — ${g.takenBy}` : `${g.ref} is free.`, 'info');
            return;
        }
        if (g.taken && !(mine && mine.gate && g.ref.toUpperCase() === String(mine.gate).toUpperCase())) {
            toast(`${g.ref} is taken — ${g.takenBy}.`, 'info');
            return;
        }
        try {
            const payload = { gate: g.ref, gateLat: g.lat, gateLon: g.lon, gateKind: g.kind };
            if (mine) {
                await api(`/events/${encodeURIComponent(e.id)}/signup`, { method: 'PATCH', body: payload });
            } else {
                // Staff claiming on the board without being signed up would be
                // claiming for nobody. Sign them up and give them the stand in
                // one move, which is what tapping a free marker means.
                await api(`/events/${encodeURIComponent(e.id)}/signup`, { method: 'POST', body: payload });
            }
            toast(`Stand ${g.ref} is yours.`, 'ok');
            await refreshAll(e.id);
            const fresh = S.events.find((x) => x.id === e.id) || e;
            await openGateBoard(fresh);
        } catch (err) {
            toast(err.message, err.code === 'gate_taken' ? 'bad' : 'bad');
            // Somebody else got there first: the board on screen is stale, so
            // redraw it rather than leaving a stand that looks available.
            if (err.code === 'gate_taken') {
                const fresh = S.events.find((x) => x.id === e.id) || e;
                await openGateBoard(fresh);
            }
        }
    }

    /* =====================================================================
     * THE EDITOR (staff)
     * =================================================================== */

    function openEditor(e) {
        const isNew = !e;
        const modal = document.getElementById('cevEdit');
        modal.classList.remove('cev-hidden');
        document.getElementById('cevEditTitle').textContent = isNew ? 'New event' : 'Edit event';

        // A datetime-local input wants the LOCAL wall clock, not an ISO string
        // in Z — feeding it the latter silently shifts the event by the staff
        // member's offset, every time they open the form.
        const localValue = (iso) => {
            if (!iso) return '';
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return '';
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        };

        const v = e || {};
        document.getElementById('cevEditBody').innerHTML = `
            <label class="cev-label">Title
                <input id="cevfTitle" class="cev-input" maxlength="120" placeholder="Transcon Group Flight" value="${esc(v.title || '')}">
            </label>
            <div class="cev-grid2">
                <label class="cev-label">From
                    <input id="cevfOrigin" class="cev-input cev-icao" maxlength="4" placeholder="CYYZ" value="${esc(v.origin || '')}">
                </label>
                <label class="cev-label">To
                    <input id="cevfDest" class="cev-input cev-icao" maxlength="4" placeholder="KLAX" value="${esc(v.destination || '')}">
                </label>
            </div>
            <div class="cev-grid2">
                <label class="cev-label">Departs (your local time)
                    <input id="cevfStarts" type="datetime-local" class="cev-input" value="${localValue(v.startsAt)}">
                </label>
                <label class="cev-label">Slots <span class="cev-hint">0 = no limit</span>
                    <input id="cevfSlots" type="number" min="0" max="5000" class="cev-input" value="${Number(v.slots) || 0}">
                </label>
            </div>
            <div class="cev-grid2">
                <label class="cev-label">Aircraft
                    <input id="cevfAircraft" class="cev-input" maxlength="60" placeholder="Boeing 787-9" value="${esc(v.aircraft || '')}">
                </label>
                <label class="cev-label">Server
                    <input id="cevfServer" class="cev-input" maxlength="30" placeholder="Expert" value="${esc(v.server || '')}">
                </label>
            </div>
            <label class="cev-label">Briefing
                <textarea id="cevfDesc" class="cev-input cev-area" maxlength="4000" rows="4"
                    placeholder="Where to spawn, when to push, what the ATC plan is…">${esc(v.description || '')}</textarea>
            </label>

            <div class="cev-fieldset">
                <div class="cev-fieldset-head">Gate board</div>
                <label class="cev-check">
                    <input type="checkbox" id="cevfGates" ${v.gatesOpen === false ? '' : 'checked'}>
                    <span>Let pilots pick a stand</span>
                </label>
                <label class="cev-label">Stands are at
                    <input id="cevfGateIcao" class="cev-input cev-icao" maxlength="4"
                        placeholder="defaults to the departure airport" value="${esc(v.gateIcao && v.gateIcao !== v.origin ? v.gateIcao : '')}">
                    <span class="cev-hint">Set this to the ARRIVAL airport for a fly-in.</span>
                </label>
            </div>

            <div class="cev-fieldset">
                <div class="cev-fieldset-head">Who it’s for</div>
                <label class="cev-label">Opens at rank
                    <select id="cevfRank" class="cev-input">
                        <option value="">Everyone</option>
                        ${S.ranks.map((r) => `<option value="${esc(r.name)}" ${v.minRank === r.name ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
                    </select>
                </label>
            </div>

            <label class="cev-label">Banner image URL <span class="cev-hint">optional · https only</span>
                <input id="cevfBanner" class="cev-input" maxlength="600" placeholder="https://…" value="${esc(v.bannerUrl || '')}">
            </label>

            <div class="cev-edit-foot">
                <button class="cev-btn cev-btn-primary" id="cevSaveBtn">
                    ${isNew ? 'Create as draft' : 'Save changes'}
                </button>
                ${isNew ? '<button class="cev-btn" id="cevSavePubBtn">Create &amp; publish</button>' : ''}
                <span id="cevEditNote" class="cev-note"></span>
            </div>`;

        const collect = (status) => {
            const val = (id) => (document.getElementById(id).value || '').trim();
            const startsRaw = val('cevfStarts');
            const body = {
                title: val('cevfTitle'),
                origin: val('cevfOrigin'),
                destination: val('cevfDest'),
                // The input gives us local wall-clock time; new Date() reads it
                // in the staff member's own zone and toISOString sends the
                // instant. Pilots elsewhere then see their own clock, which is
                // the only reading of "22:00" everybody agrees on.
                startsAt: startsRaw ? new Date(startsRaw).toISOString() : null,
                slots: Number(val('cevfSlots')) || 0,
                aircraft: val('cevfAircraft'),
                server: val('cevfServer'),
                description: val('cevfDesc'),
                gatesOpen: document.getElementById('cevfGates').checked,
                gateIcao: val('cevfGateIcao'),
                minRank: val('cevfRank'),
                bannerUrl: val('cevfBanner'),
            };
            if (status) body.status = status;
            else if (!isNew) body.status = v.status;
            return body;
        };

        const save = async (status, btn) => {
            const note = document.getElementById('cevEditNote');
            const body = collect(status);
            if (!body.title) { note.textContent = 'Give it a title.'; return; }
            btn.disabled = true;
            try {
                const out = isNew
                    ? await api('/events', { method: 'POST', body })
                    : await api(`/events/${encodeURIComponent(e.id)}`, { method: 'PATCH', body });
                // A write that landed but could not hold everything says so —
                // the VA's database is behind and there is a button for that.
                if (out.warning) toast(out.warning, 'info');
                else toast(isNew ? 'Event created.' : 'Saved.', 'ok');
                modal.classList.add('cev-hidden');
                await refreshAll(out.event ? out.event.id : S.openEventId);
            } catch (err) {
                note.textContent = err.message;
                btn.disabled = false;
            }
        };

        document.getElementById('cevSaveBtn').onclick = (ev) => save(isNew ? 'draft' : null, ev.currentTarget);
        const pub = document.getElementById('cevSavePubBtn');
        if (pub) pub.onclick = (ev) => save('published', ev.currentTarget);
        icons();
    }

    /* =====================================================================
     * SUMMARY CARDS — the host's "next event" slot
     * =================================================================== */

    const summaryHosts = new Set();

    /**
     * Paint the next event into an element the host owns.
     *
     * `soonest` is the first PUBLISHED event still ahead of us. A draft is
     * staff's working copy and a cancelled one is not happening — neither is
     * "what's next", even on the dashboard of the person who wrote them.
     */
    function paintSummary(el) {
        const next = S.events
            .filter((e) => e.status === 'published' && e.startsAt && new Date(e.startsAt).getTime() > Date.now() - 6 * 3600e3)
            .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0];

        if (!S.loaded) { el.innerHTML = '<p class="cev-quiet">Loading…</p>'; return; }
        if (!next) {
            el.innerHTML = S.canManage
                ? `<p class="cev-quiet">Nothing scheduled.</p>
                   <button class="cev-btn cev-btn-primary cev-w-full" data-cev-new>Plan one</button>`
                : '<p class="cev-quiet">Nothing scheduled yet.</p>';
            el.querySelectorAll('[data-cev-new]').forEach((b) => b.addEventListener('click', () => { open(); openEditor(null); }));
            icons();
            return;
        }

        const mine = mySignup(next.id);
        el.innerHTML = `
            <div class="cev-sum-title">${esc(next.title || 'Untitled event')}</div>
            <div class="cev-sum-facts">
                <span class="cev-fact"><i data-lucide="map-pin"></i> ${esc(legText(next))}</span>
                <span class="cev-fact"><i data-lucide="calendar-clock"></i> ${esc(whenText(next.startsAt))}</span>
                ${typeof next.going === 'number'
                    ? `<span class="cev-fact"><i data-lucide="users"></i> ${next.going} signed up</span>` : ''}
                ${mine ? `<span class="cev-fact cev-fact-in"><i data-lucide="check"></i> You’re going${mine.gate ? ` · stand ${esc(mine.gate)}` : ''}</span>` : ''}
            </div>
            <button class="cev-btn cev-btn-primary cev-w-full" data-cev-open="${esc(next.id)}">
                ${S.canManage ? 'Manage event' : mine ? 'View the brief' : 'Sign up'}
            </button>`;
        el.querySelectorAll('[data-cev-open]').forEach((b) => b.addEventListener('click', () => {
            open();
            openEvent(b.dataset.cevOpen);
        }));
        icons();
    }

    // Hosts that want the whole calendar rather than just the next thing — the
    // pilot home's "Upcoming events" strip, mainly.
    const cardHosts = new Map();    // el -> { limit }

    /**
     * Paint upcoming events as cards into an element the host owns.
     *
     * Published only, and only what is still ahead: a pilot's home page is a
     * list of things they can still turn up to, not an archive. Staff see their
     * drafts in the panel, where the draft chip explains what they are looking
     * at — a draft on the pilot home would just be a broken promise.
     */
    function paintCards(el, limit) {
        const upcoming = S.events
            .filter((e) => e.status === 'published' && e.startsAt
                && new Date(e.startsAt).getTime() > Date.now() - 6 * 3600e3)
            .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
            .slice(0, limit || 3);

        if (!S.loaded) { el.innerHTML = '<p class="cev-quiet">Loading the calendar…</p>'; return; }
        if (!upcoming.length) {
            el.innerHTML = '<p class="cev-quiet">Nothing scheduled yet — check back soon.</p>';
            return;
        }
        el.innerHTML = upcoming.map(eventCard).join('');
        el.querySelectorAll('[data-event]').forEach((card) => {
            card.addEventListener('click', () => { open(); openEvent(card.dataset.event); });
        });
        icons();
    }

    function paintSummaries() {
        summaryHosts.forEach((el) => { if (el.isConnected) paintSummary(el); });
        cardHosts.forEach((opts, el) => { if (el.isConnected) paintCards(el, opts.limit); });
    }

    /* =====================================================================
     * SHELL — the panel this module lives in, and its styles
     * =================================================================== */

    function buildShell() {
        if (document.getElementById('cevPanel')) return;

        const wrap = document.createElement('div');
        wrap.innerHTML = `
            <div id="cevPanel" class="cev-panel cev-hidden">
                <div class="cev-scrim" data-cev-close></div>
                <div class="cev-sheet">
                    <header class="cev-head">
                        <div class="cev-head-title"><i data-lucide="calendar-days"></i> <span>Events</span></div>
                        <div class="cev-head-actions">
                            <button class="cev-btn cev-btn-primary cev-new" id="cevNewBtn"><i data-lucide="plus"></i> New event</button>
                            <button class="cev-icon-btn" data-cev-close aria-label="Close"><i data-lucide="x"></i></button>
                        </div>
                    </header>
                    <div id="cevList" class="cev-list"></div>
                </div>

                <div id="cevDetail" class="cev-detail cev-hidden">
                    <header class="cev-head">
                        <div class="cev-head-title">
                            <button class="cev-icon-btn" id="cevBackBtn" aria-label="Back"><i data-lucide="arrow-left"></i></button>
                            <span id="cevDetailTitle">Event</span>
                        </div>
                        <button class="cev-icon-btn" data-cev-close aria-label="Close"><i data-lucide="x"></i></button>
                    </header>
                    <div id="cevDetailBody" class="cev-detail-body"></div>
                </div>
            </div>

            <div id="cevGates" class="cev-modal cev-hidden">
                <div class="cev-scrim" data-cev-gates-close></div>
                <div class="cev-modal-card cev-modal-wide">
                    <header class="cev-head">
                        <div class="cev-head-title">
                            <i data-lucide="map-pinned"></i>
                            <span>
                                <span id="cevGatesTitle">Gate board</span>
                                <small id="cevGatesSub" class="cev-sub"></small>
                            </span>
                        </div>
                        <button class="cev-icon-btn" data-cev-gates-close aria-label="Close"><i data-lucide="x"></i></button>
                    </header>
                    <div class="cev-board">
                        <div class="cev-board-map"><div id="cevGateMap"></div></div>
                        <div class="cev-board-side">
                            <input id="cevGateSearch" class="cev-input" placeholder="Find a stand (e.g. B24)…">
                            <ul id="cevGateList" class="cev-gates"></ul>
                            <div class="cev-legend">
                                <span><i class="cev-dot cev-dot-free"></i> Free</span>
                                <span><i class="cev-dot cev-dot-taken"></i> Taken</span>
                                <span><i class="cev-dot cev-dot-mine"></i> Yours</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div id="cevEdit" class="cev-modal cev-hidden">
                <div class="cev-scrim" data-cev-edit-close></div>
                <div class="cev-modal-card">
                    <header class="cev-head">
                        <div class="cev-head-title"><i data-lucide="calendar-plus"></i> <span id="cevEditTitle">New event</span></div>
                        <button class="cev-icon-btn" data-cev-edit-close aria-label="Close"><i data-lucide="x"></i></button>
                    </header>
                    <div id="cevEditBody" class="cev-edit-body"></div>
                </div>
            </div>`;
        while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);

        document.querySelectorAll('[data-cev-close]').forEach((el) => el.addEventListener('click', close));
        document.querySelectorAll('[data-cev-gates-close]').forEach((el) => el.addEventListener('click', () => {
            document.getElementById('cevGates').classList.add('cev-hidden');
            destroyBoardMap();
        }));
        document.querySelectorAll('[data-cev-edit-close]').forEach((el) => el.addEventListener('click', () => {
            document.getElementById('cevEdit').classList.add('cev-hidden');
        }));
        document.getElementById('cevBackBtn').addEventListener('click', closeDetail);
        document.getElementById('cevNewBtn').addEventListener('click', () => openEditor(null));

        document.getElementById('cevList').addEventListener('click', (ev) => {
            const card = ev.target.closest('[data-event]');
            if (card) openEvent(card.dataset.event);
        });

        // Escape closes the topmost thing, not everything. Someone who opened a
        // gate board from an event wants the board closed, not the panel.
        document.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Escape') return;
            const gates = document.getElementById('cevGates');
            const edit = document.getElementById('cevEdit');
            if (!edit.classList.contains('cev-hidden')) { edit.classList.add('cev-hidden'); return; }
            if (!gates.classList.contains('cev-hidden')) {
                gates.classList.add('cev-hidden');
                destroyBoardMap();
                return;
            }
            if (S.openEventId) { closeDetail(); return; }
            if (!document.getElementById('cevPanel').classList.contains('cev-hidden')) close();
        });

        injectStyles();
    }

    function injectStyles() {
        if (document.getElementById('cev-styles')) return;
        const css = document.createElement('style');
        css.id = 'cev-styles';
        // Every colour here is a var() off the host page's tokens, with a
        // fallback. That is what lets one module sit inside the owner
        // dashboard, the pilot home and a VA's own brand theme without three
        // stylesheets — a VA who themes their crew center themes this too.
        css.textContent = `
        .cev-hidden{ display:none !important; }
        #cev-toasts{ position:fixed; bottom:1rem; left:50%; transform:translateX(-50%);
            z-index:120; display:flex; flex-direction:column; gap:.5rem; pointer-events:none; }
        .cev-toast{ background:var(--ink,#1C1A16); color:var(--bg,#fff); padding:.6rem 1rem;
            border-radius:.6rem; font-size:.85rem; font-weight:500; box-shadow:0 8px 24px rgba(0,0,0,.18);
            max-width:min(90vw,26rem); transition:opacity .3s, transform .3s; }
        .cev-toast-ok{ background:#16A34A; color:#fff; }
        .cev-toast-bad{ background:#DC2626; color:#fff; }
        .cev-toast.cev-out{ opacity:0; transform:translateY(6px); }

        .cev-panel,.cev-modal{ position:fixed; inset:0; z-index:70; }
        .cev-scrim{ position:absolute; inset:0; background:rgba(0,0,0,.45); }
        .cev-sheet,.cev-detail{ position:absolute; right:0; top:0; height:100%; width:100%;
            max-width:46rem; background:var(--surface,#fff); border-left:1px solid var(--line,#e5e5e5);
            overflow-y:auto; display:flex; flex-direction:column; }
        .cev-detail{ z-index:2; }
        .cev-head{ position:sticky; top:0; z-index:3; display:flex; align-items:center; justify-content:space-between;
            gap:.75rem; padding:0 1rem; height:3.75rem; background:var(--surface,#fff);
            border-bottom:1px solid var(--line,#e5e5e5); }
        .cev-head-title{ display:flex; align-items:center; gap:.6rem; font-weight:700;
            letter-spacing:-.01em; min-width:0; color:var(--ink,#1C1A16); }
        .cev-head-title>span{ min-width:0; }
        .cev-sub{ display:block; font-size:.72rem; font-weight:500; color:var(--muted,#736E64); }
        .cev-head-actions{ display:flex; align-items:center; gap:.5rem; }
        .cev-icon-btn{ width:2.25rem; height:2.25rem; display:grid; place-items:center; border-radius:.5rem;
            color:var(--muted,#736E64); background:transparent; border:0; cursor:pointer; }
        .cev-icon-btn:hover{ color:var(--ink,#1C1A16); }

        .cev-btn{ display:inline-flex; align-items:center; gap:.4rem; padding:.55rem .9rem;
            border-radius:.5rem; font-size:.85rem; font-weight:600; cursor:pointer;
            background:var(--surface,#fff); color:var(--ink,#1C1A16);
            border:1px solid var(--line,#e5e5e5); }
        .cev-btn:hover{ border-color:var(--ink,#1C1A16); }
        .cev-btn:disabled{ opacity:.55; cursor:default; }
        .cev-btn-primary{ background:var(--accent,#1C1A16); color:#fff; border-color:transparent; }
        .cev-btn-primary:hover{ opacity:.9; border-color:transparent; }
        .cev-btn-bad{ color:#DC2626; }
        .cev-w-full{ width:100%; justify-content:center; margin-top:.75rem; }
        .cev-btn i,.cev-fact i{ width:1em; height:1em; }

        .cev-list{ padding:1rem; display:grid; gap:.9rem; }
        @media (min-width:40rem){ .cev-list{ grid-template-columns:1fr 1fr; } }
        .cev-card{ border:1px solid var(--line,#e5e5e5); border-radius:.75rem; overflow:hidden;
            background:var(--surface,#fff); cursor:pointer; transition:border-color .2s, transform .2s; }
        .cev-card:hover{ border-color:var(--ink,#1C1A16); transform:translateY(-2px); }
        .cev-card-art{ width:100%; height:6.5rem; object-fit:cover; display:block; }
        .cev-card-art-blank{ background:var(--accent,#1C1A16); opacity:.12; }
        .cev-card-body{ padding:.9rem 1rem 1rem; }
        .cev-card-chips{ display:flex; flex-wrap:wrap; gap:.35rem; }
        .cev-card-chips:not(:empty){ margin-bottom:.45rem; }
        .cev-chip{ font-size:.68rem; font-weight:700; letter-spacing:.03em; text-transform:uppercase;
            padding:.15rem .45rem; border-radius:.3rem; border:1px solid var(--line,#e5e5e5);
            color:var(--muted,#736E64); }
        .cev-chip-in{ background:#16A34A; color:#fff; border-color:transparent; }
        .cev-chip-wait{ background:#D97706; color:#fff; border-color:transparent; }
        .cev-chip-off{ background:#DC2626; color:#fff; border-color:transparent; }
        .cev-chip-draft{ background:var(--line,#e5e5e5); color:var(--muted,#736E64); }
        .cev-card-title{ font-size:1rem; font-weight:700; letter-spacing:-.01em; margin:0 0 .4rem;
            color:var(--ink,#1C1A16); }
        .cev-facts,.cev-detail-facts,.cev-sum-facts{ display:flex; flex-wrap:wrap; gap:.35rem .9rem; }
        .cev-fact{ display:inline-flex; align-items:center; gap:.35rem; font-size:.82rem;
            color:var(--muted,#736E64); }
        .cev-fact-in{ color:#16A34A; font-weight:600; }
        .cev-card-foot{ display:flex; justify-content:space-between; align-items:center;
            margin-top:.7rem; font-size:.78rem; color:var(--faint,#A8A296); }
        .cev-going{ font-weight:600; color:var(--muted,#736E64); }

        .cev-detail-body{ padding:1rem 1.15rem 3rem; }
        .cev-hero{ width:100%; border-radius:.6rem; margin-bottom:1rem; display:block; }
        .cev-detail-facts{ margin-bottom:.9rem; }
        .cev-desc{ font-size:.9rem; line-height:1.55; color:var(--ink,#1C1A16);
            white-space:pre-wrap; margin:0 0 1rem; }
        .cev-actions{ display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; margin-bottom:1rem; }
        .cev-staff{ padding-top:.85rem; border-top:1px dashed var(--line,#e5e5e5); }
        .cev-note{ font-size:.82rem; color:var(--muted,#736E64); margin:0; }
        .cev-note-off{ color:#DC2626; font-weight:600; }

        .cev-section{ margin-top:1.25rem; }
        .cev-h4{ display:flex; align-items:center; gap:.5rem; font-size:.95rem; font-weight:700;
            margin:0 0 .5rem; color:var(--ink,#1C1A16); }
        .cev-h4-sub{ margin-top:1.1rem; }
        .cev-count{ font-size:.75rem; font-weight:600; color:var(--muted,#736E64);
            border:1px solid var(--line,#e5e5e5); border-radius:1rem; padding:.05rem .5rem; }
        .cev-atts{ list-style:none; margin:0; padding:0; }
        .cev-att{ display:flex; align-items:center; gap:.6rem; padding:.5rem 0;
            border-top:1px solid var(--line-soft,#f0ece4); font-size:.86rem; }
        .cev-atts-wait .cev-att{ opacity:.75; }
        .cev-att-name{ font-weight:600; color:var(--ink,#1C1A16); }
        .cev-att-cs,.cev-att-ac{ color:var(--muted,#736E64); font-size:.8rem; }
        .cev-att-gate{ margin-left:auto; font-weight:700; font-variant-numeric:tabular-nums;
            background:var(--accent,#1C1A16); color:#fff; border-radius:.3rem; padding:.1rem .45rem; font-size:.78rem; }
        .cev-att-nogate{ margin-left:auto; font-size:.75rem; color:var(--faint,#A8A296); }
        .cev-att-x{ background:transparent; border:0; color:var(--faint,#A8A296); cursor:pointer; padding:.2rem; }
        .cev-att-x:hover{ color:#DC2626; }
        .cev-quiet{ font-size:.85rem; color:var(--muted,#736E64); margin:0; }
        .cev-empty{ padding:2.5rem 1rem; text-align:center; color:var(--muted,#736E64); font-size:.88rem;
            grid-column:1/-1; }
        .cev-empty-title{ font-weight:700; color:var(--ink,#1C1A16); margin:0 0 .25rem; }

        .cev-modal{ z-index:80; display:grid; place-items:center; padding:1rem; }
        .cev-modal-card{ position:relative; z-index:1; background:var(--surface,#fff);
            border:1px solid var(--line,#e5e5e5); border-radius:.9rem; width:100%; max-width:34rem;
            max-height:92vh; overflow-y:auto; }
        .cev-modal-wide{ max-width:66rem; }
        .cev-board{ display:grid; grid-template-rows:20rem auto; }
        @media (min-width:52rem){ .cev-board{ grid-template-rows:none; grid-template-columns:1fr 17rem; height:32rem; } }
        .cev-board-map{ position:relative; }
        #cevGateMap{ position:absolute; inset:0; }
        .cev-map-fallback{ position:absolute; inset:0; display:grid; place-items:center; margin:0;
            padding:1.5rem; text-align:center; font-size:.85rem; color:var(--muted,#736E64); }
        @media (max-width:52rem){ .cev-board-map{ height:20rem; } }
        .cev-board-side{ border-left:1px solid var(--line,#e5e5e5); padding:.75rem;
            display:flex; flex-direction:column; gap:.6rem; min-height:0; }
        .cev-gates{ list-style:none; margin:0; padding:0; overflow-y:auto; flex:1; min-height:8rem; }
        .cev-gate{ display:flex; align-items:center; gap:.5rem; padding:.4rem .5rem; border-radius:.4rem;
            font-size:.82rem; cursor:pointer; }
        .cev-gate:hover{ background:var(--line-soft,#f0ece4); }
        .cev-gate-ref{ font-weight:700; font-variant-numeric:tabular-nums; min-width:3rem; }
        .cev-gate-who{ color:var(--muted,#736E64); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cev-gate-free .cev-gate-who{ color:#16A34A; font-weight:600; }
        .cev-gate-mine{ outline:2px solid var(--accent,#1C1A16); outline-offset:-2px; }
        .cev-gate-tag{ margin-left:auto; font-size:.65rem; text-transform:uppercase; letter-spacing:.04em;
            color:var(--faint,#A8A296); }
        .cev-legend{ display:flex; gap:.85rem; font-size:.72rem; color:var(--muted,#736E64); }
        .cev-dot{ display:inline-block; width:.6rem; height:.6rem; border-radius:50%; margin-right:.25rem; }
        .cev-dot-free{ background:#16A34A; } .cev-dot-taken{ background:#DC2626; }
        .cev-dot-mine{ background:var(--accent,#1C1A16); }

        /* Map pins. Sized by their label so a stand called "R12A" is not
           clipped, and coloured by the one thing that matters at a glance. */
        .cev-pin{ background:transparent; border:0; }
        .cev-pin span{ display:inline-block; padding:.1rem .35rem; border-radius:.3rem;
            font:600 11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace; color:#fff;
            white-space:nowrap; box-shadow:0 1px 3px rgba(0,0,0,.35); }
        .cev-pin-free span{ background:#16A34A; }
        .cev-pin-taken span{ background:#DC2626; }
        .cev-pin-mine span{ background:#1D4ED8; outline:2px solid #fff; }

        .cev-edit-body{ padding:1rem 1.15rem 1.5rem; display:grid; gap:.8rem; }
        .cev-label{ display:block; font-size:.78rem; font-weight:600; color:var(--muted,#736E64); }
        .cev-hint{ font-weight:500; color:var(--faint,#A8A296); }
        .cev-input{ display:block; width:100%; margin-top:.3rem; padding:.55rem .7rem; font-size:.88rem;
            font-family:inherit; color:var(--ink,#1C1A16); background:var(--surface,#fff);
            border:1px solid var(--line,#e5e5e5); border-radius:.5rem; }
        .cev-input:focus{ outline:none; border-color:var(--ink,#1C1A16); }
        .cev-icao{ text-transform:uppercase; }
        .cev-area{ resize:vertical; }
        .cev-grid2{ display:grid; gap:.8rem; grid-template-columns:1fr 1fr; }
        .cev-fieldset{ border:1px solid var(--line,#e5e5e5); border-radius:.6rem; padding:.8rem;
            display:grid; gap:.6rem; }
        .cev-fieldset-head{ font-size:.72rem; font-weight:700; text-transform:uppercase;
            letter-spacing:.06em; color:var(--faint,#A8A296); }
        .cev-check{ display:flex; align-items:center; gap:.5rem; font-size:.85rem;
            color:var(--ink,#1C1A16); font-weight:500; }
        .cev-edit-foot{ display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; margin-top:.4rem; }
        .cev-sum-title{ font-weight:700; font-size:1rem; margin-bottom:.5rem; color:var(--ink,#1C1A16); }
        .cev-sum-facts{ flex-direction:column; gap:.4rem; }

        @media (prefers-reduced-motion:reduce){ .cev-card,.cev-toast{ transition:none; } }`;
        document.head.appendChild(css);
    }

    /* =====================================================================
     * PUBLIC API
     * =================================================================== */

    function open() {
        buildShell();
        document.getElementById('cevPanel').classList.remove('cev-hidden');
        document.getElementById('cevNewBtn').classList.toggle('cev-hidden', !S.canManage);
        renderList();
        icons();
        // Always re-read on open. A calendar is exactly the thing somebody else
        // changed while this tab sat there.
        load({ quiet: true }).then(() => {
            document.getElementById('cevNewBtn').classList.toggle('cev-hidden', !S.canManage);
            renderList();
            paintSummaries();
        });
    }

    function close() {
        closeDetail();
        document.getElementById('cevPanel').classList.add('cev-hidden');
    }

    /**
     * Wire the module to a page.
     *
     * `token` is taken as a FUNCTION, not a string: a session can be replaced
     * mid-visit (a pilot changes their password and gets a fresh one) and a
     * token captured at mount time would go stale in a way that looks like a
     * random sign-out.
     */
    function mount({ backend, slug, token }) {
        S.backend = String(backend || '').replace(/\/+$/, '');
        S.slug = String(slug || '').toLowerCase();
        S.getToken = typeof token === 'function' ? token : () => String(token || '');
        buildShell();
        if (!S.slug) return Promise.resolve();
        return load({ quiet: true }).then(() => {
            renderList();
            paintSummaries();
        });
    }

    /** Paint the next event into a host element, and keep it painted. */
    function renderSummary(el) {
        if (!el) return;
        summaryHosts.add(el);
        paintSummary(el);
    }

    /** Paint upcoming events as cards into a host element, and keep them painted. */
    function renderCards(el, { limit = 3 } = {}) {
        if (!el) return;
        cardHosts.set(el, { limit });
        paintCards(el, limit);
    }

    window.CrewEvents = {
        mount, open, close, renderSummary, renderCards,
        openEvent: (id) => { open(); return openEvent(id); },
        newEvent: () => { open(); openEditor(null); },
        reload: () => refreshAll(),
        get canManage() { return S.canManage; },
        get events() { return S.events.slice(); },
    };
})();
