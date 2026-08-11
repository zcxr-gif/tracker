/* ============================================================================
   crewInfiniteFlight.js — the crew center's window onto Infinite Flight Live.

   WHAT THIS IS FOR

   A VA runs two things that have never been able to see each other. One is this
   crew center: the roster, the route network, the week's departures, the flight
   reports. The other is their Live ORGANIZATION inside Infinite Flight — the
   aircraft they actually own, in fleet order, each with a rota of flights it is
   really going to operate, and a last-known position for every one of them.

   Until PublicApi v3 there was no way to look at the second from the first. So
   staff kept the week in two places by hand, and a pilot asking "which aircraft
   is free on Friday?" was asking a question the crew center could not answer
   about the fleet it was ostensibly running.

   This is the whole of that API wired into the crew center: the organizations
   the connected account belongs to, the aircraft in them, where each one last
   was, and full read/write on their schedules — add a leg, edit it, re-plan it,
   reorder the rota, remove one — plus a bridge in both directions to the crew
   center's own schedule.

   FOUR THINGS THIS FILE IS CAREFUL ABOUT

   1. IT NEVER HOLDS A TOKEN. Every call goes to our backend, which holds the
      sealed OAuth grant and talks to Infinite Flight itself. Nothing in this
      file has ever seen an access token and nothing should: a browser is not a
      place to keep somebody's Infinite Flight credential, and the preview says
      as much about public clients.

   2. IT OFFERS ONLY WHAT THE GRANT ALLOWS. `canWrite` comes from the scopes
      Infinite Flight actually GRANTED, not from what we asked for. A VA who
      declined schedule writes on the consent screen gets a read-only board,
      not a save button that fails.

   3. IT DOES NOT INVENT. A position that is stale says so; a position at 0,0 is
      treated as "we have never had one" rather than drawn in the Gulf of
      Guinea; a fleet count is blank until it is known. The backend computes
      these (ifLive.publicPosition, ifFleetSummary) so all three front-ends
      agree about what "in storage" and "in flight" mean.

   4. IT SURVIVES AN API THAT MOVES. Infinite Flight ships v3 as a preview and
      says its fields, enums and rules may change. So every enum arrives already
      decoded, with a label the backend produced — including for values it does
      not recognise — and this file never switches on a raw number.

   WHAT IT NEEDS FROM ITS HOST

       CrewIF.mount({ backend: BACKEND, slug: getSlug(), token: sessionToken });
       CrewIF.open();                       // staff: the full panel
       CrewIF.renderBoard(el);              // anyone: the fleet, painted in place

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewInfiniteFlight: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText, whenText, timeText, toast } = P;

    const S = {
        api: null,
        slug: '',
        // The connection, as the backend describes it. Null until the first
        // fetch lands — and deliberately not {} , because "we do not know yet"
        // and "not connected" are different screens.
        status: null,
        organizations: null,
        fleet: null,             // { aircraft, summary, organizationId, readAt }
        fleetAt: 0,
        aircraftId: '',          // whose rota the schedule tab is showing
        schedules: null,
        linked: {},
        // The fleet's workload — which aeroplanes are idle. Its own tab because
        // it costs a call per aircraft; kept once loaded.
        use: null,
        useError: null,
        // Which of the fleet are airborne in multiplayer right now, keyed by the
        // persistent aircraft id. Separate from the fleet because it comes from
        // a different service and is allowed to be absent.
        live: {},
        tab: 'fleet',
        busy: false,
        error: null,
        editing: null,           // a schedule being added or changed
        planning: null,          // a schedule whose flight plan is being edited
        loaded: false,
        // Mounted for a pilot: the read-only board, and no route into the staff
        // panel. See mount().
        boardOnly: false,
        // Where the live-traffic service is, for the "flying now" lookup. Empty
        // is a supported configuration: the board simply never shows a green
        // dot, which is a board.
        liveBase: '',
    };

    let panel = null;

    /* =====================================================================
     * Styles
     *
     * Everything is a var() off the host page, like crewPanels itself, so this
     * sits inside the owner dashboard, the pilot home and a VA's own brand
     * theme without three stylesheets.
     * ================================================================== */
    function injectStyles() {
        P.style('cif-styles', `
        .cif-tabs{ display:flex; gap:.25rem; padding:.25rem; border-radius:.6rem;
            background:color-mix(in srgb, var(--ink,#1C1A16) 6%, transparent); }
        .cif-tab{ flex:1; padding:.45rem .5rem; border:0; border-radius:.45rem; cursor:pointer;
            background:transparent; color:var(--muted,#736E64); font:inherit; font-size:.82rem; font-weight:600; }
        .cif-tab[aria-selected="true"]{ background:var(--surface,#fff); color:var(--ink,#1C1A16);
            box-shadow:0 1px 2px rgba(0,0,0,.06); }

        .cif-stats{ display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:.5rem; }
        @media (max-width:34rem){ .cif-stats{ grid-template-columns:repeat(3,minmax(0,1fr)); } }
        .cif-stat{ border:1px solid var(--line,#e5e5e5); border-radius:.6rem; padding:.55rem .6rem; }
        .cif-stat b{ display:block; font-size:1.15rem; letter-spacing:-.02em; color:var(--ink,#1C1A16); }
        .cif-stat span{ font-size:.66rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em;
            color:var(--faint,#A8A296); }

        .cif-ac{ display:grid; gap:.5rem; }
        .cif-row{ border:1px solid var(--line,#e5e5e5); border-radius:.7rem; padding:.7rem .8rem;
            display:grid; gap:.45rem; }
        /* The aircraft picture. Fixed box with object-fit so a Planespotters
           photo (any aspect ratio) and the silhouette (120x72) occupy exactly
           the same space — otherwise the list reflows as photos arrive, which
           is the jump this module's synchronous-first design exists to avoid. */
        .cai{ width:3.75rem; height:2.25rem; border-radius:.35rem; object-fit:cover;
            background:var(--line,#e5e5e5); flex:0 0 auto; display:block; }
        .cif-idrow{ display:flex; align-items:center; gap:.6rem; min-width:0; }
        .cif-row-top{ display:flex; align-items:center; justify-content:space-between; gap:.6rem; }
        .cif-reg{ font-weight:700; letter-spacing:-.01em; color:var(--ink,#1C1A16); }
        .cif-rank{ font-size:.7rem; color:var(--faint,#A8A296); font-weight:600; }
        .cif-acts{ display:flex; flex-wrap:wrap; gap:.35rem; }

        /* The rota. Numbered, because sequence is the whole point of the list —
           an aircraft flies these in order and a reader has to be able to see
           which is next without counting rows. */
        .cif-leg{ display:grid; grid-template-columns:1.6rem 1fr auto; gap:.6rem; align-items:start;
            border:1px solid var(--line,#e5e5e5); border-radius:.7rem; padding:.65rem .75rem; }
        .cif-seq{ font-size:.75rem; font-weight:800; color:var(--faint,#A8A296); padding-top:.1rem; }
        .cif-leg-main{ min-width:0; display:grid; gap:.25rem; }
        .cif-route{ font-weight:700; letter-spacing:-.01em; color:var(--ink,#1C1A16);
            display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; }
        .cif-times{ font-size:.78rem; color:var(--muted,#736E64); }
        .cif-plan{ font-size:.72rem; color:var(--faint,#A8A296); word-break:break-word;
            font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
        .cif-leg-acts{ display:flex; flex-direction:column; gap:.25rem; align-items:flex-end; }
        .cif-mv{ display:flex; gap:.15rem; }
        .cif-mv button{ width:1.8rem; height:1.8rem; display:grid; place-items:center; border-radius:.35rem;
            border:1px solid var(--line,#e5e5e5); background:var(--surface,#fff);
            color:var(--muted,#736E64); cursor:pointer; }
        .cif-mv button:disabled{ opacity:.35; cursor:default; }
        .cif-mv button i{ width:.85rem; height:.85rem; }

        .cif-scopes{ display:flex; flex-wrap:wrap; gap:.3rem; }
        .cif-steps{ counter-reset:cif; display:grid; gap:.6rem; margin:0; padding:0; list-style:none; }
        .cif-steps li{ counter-increment:cif; display:grid; grid-template-columns:1.4rem 1fr; gap:.55rem;
            font-size:.85rem; color:var(--muted,#736E64); }
        .cif-steps li::before{ content:counter(cif); display:grid; place-items:center; width:1.4rem; height:1.4rem;
            border-radius:999px; background:var(--line,#e5e5e5); color:var(--ink,#1C1A16);
            font-size:.7rem; font-weight:800; }
        .cif-steps a{ color:var(--accent,#1C1A16); font-weight:600; }

        /* The in-page board. Same rule the quick-links board follows: nothing is
           painted until the fetch lands, because an empty board that fills in
           reads as "this VA has no fleet". */
        .cif-board{ display:grid; gap:.6rem; }
        .cif-board-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(11rem,1fr)); gap:.5rem; }
        .cif-tile{ border:1px solid var(--line,#e5e5e5); border-radius:.7rem; padding:.6rem .7rem;
            display:grid; gap:.2rem; background:var(--surface,#fff); }
        .cif-tile .cai{ width:100%; height:3.25rem; margin-bottom:.35rem; }
        .cif-tile b{ font-size:.9rem; letter-spacing:-.01em; }
        .cif-tile small{ font-size:.72rem; color:var(--muted,#736E64); }
        .cif-dot{ width:.5rem; height:.5rem; border-radius:999px; display:inline-block; }
        .cif-dot-air{ background:#16A34A; }
        .cif-dot-gnd{ background:#D97706; }
        .cif-dot-off{ background:var(--line,#e5e5e5); }`);
    }

    /* =====================================================================
     * Small helpers
     * ================================================================== */

    /**
     * A decoded enum from the backend, as a chip.
     *
     * Takes the whole { value, name, label } rather than a number, because this
     * file must never map numbers to words itself — that mapping lives in
     * ifLive.js so it can be corrected in one place when the preview moves.
     */
    const enumLabel = (e) => (e && e.label ? e.label : '');

    /**
     * The aircraft's picture — always something, never a broken image.
     *
     * crewAircraftImage.js guarantees a synchronous, self-contained silhouette
     * and upgrades it to a real photograph where one exists. This wrapper exists
     * so a page that has not loaded that module still renders a fleet: an empty
     * string is a missing thumbnail, which is a cosmetic loss, where an
     * exception inside a row renderer is a blank panel.
     */
    const picture = (a) => (window.CrewAircraftImage
        ? window.CrewAircraftImage.img(a || {})
        : '');

    const chip = (text, tone) => (text
        ? `<span class="cp-chip${tone ? ' cp-chip-' + tone : ''}">${esc(text)}</span>` : '');

    /** How a schedule's status should read on the board. */
    function statusTone(status) {
        switch (status && status.name) {
            case 'InFlight': return 'ok';
            case 'Arrived': return 'mute';
            case 'Cancelled': return 'bad';
            case 'Delayed':
            case 'Diverted': return 'warn';
            case 'Boarding':
            case 'Boarded':
            case 'TaxiingToRunway':
            case 'TaxiingToParking': return 'accent';
            default: return '';
        }
    }

    /**
     * A stored position, in one line.
     *
     * Says nothing at all when there is no fix, and says how old the reading is
     * whenever it is stale. That second part is the important one: the API
     * documents this as the LAST PERSISTED state, and a fleet board that prints
     * an altitude with no age next to it is claiming the aeroplane is there now.
     */
    function positionLine(pos) {
        if (!pos) return '';
        if (!pos.hasFix) return '<span class="cp-faint">No position reported</span>';
        const bits = [];
        const state = enumLabel(pos.state);
        if (state) bits.push(esc(state));
        if (pos.altitude !== null && pos.altitude !== undefined) bits.push(`${Math.round(pos.altitude).toLocaleString()} ft`);
        if (pos.speed !== null && pos.speed !== undefined) bits.push(`${Math.round(pos.speed)} kt`);
        if (pos.heading !== null && pos.heading !== undefined) bits.push(`${Math.round(pos.heading)}°`);
        const who = pos.lastPilotUsername ? ` · ${esc(pos.lastPilotUsername)}` : '';
        const age = pos.updatedAt
            ? ` · <span class="${pos.stale ? 'cp-note-warn' : 'cp-faint'}">${esc(relativeText(pos.updatedAt))}</span>`
            : '';
        return bits.join(' · ') + who + age;
    }

    /** UTC, always, and labelled as such — every time in this API is Zulu. */
    function utcLine(schedule) {
        const dep = schedule.scheduledDepartureUtc;
        const arr = schedule.scheduledArrivalUtc;
        if (!dep) return '';
        const block = schedule.blockMinutes
            ? ` · ${Math.floor(schedule.blockMinutes / 60)}h ${String(schedule.blockMinutes % 60).padStart(2, '0')}m`
            : '';
        return `${esc(whenText(dep))} ${esc(timeText(dep))}Z${arr ? ' → ' + esc(timeText(arr)) + 'Z' : ''}${block}`;
    }

    /** An <input type="datetime-local"> value from a UTC instant, kept in UTC. */
    function toLocalInput(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        // The API's fields are all named `...Utc` and mean Zulu. A
        // datetime-local bound to the browser's timezone would silently move a
        // departure by the reader's offset, so the field is fed UTC parts and
        // labelled Z in the form. A VA scheduling 18:30Z types 18:30.
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
            + `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }
    /** The inverse: what the form shows is Zulu, so it goes back as Zulu. */
    const fromLocalInput = (v) => (v ? `${v}:00Z` : '');

    /* =====================================================================
     * The backend
     * ================================================================== */

    /**
     * Take a status payload as the new truth, without letting it forget things
     * it was not asked about.
     *
     * Every save here answers with the connection's new state, and the panel
     * repaints from that answer rather than re-fetching — which is right, and
     * which also means a reply that omits a field silently unsets it. Two
     * fields make that dangerous rather than cosmetic: `you`, which says
     * whether the person looking is the owner, and `redirectUri`, which is the
     * value they are being told to register. Losing either mid-session
     * replaces a working setup screen with "only the VA owner can connect an
     * account" — addressed to the owner, immediately after they saved
     * something.
     *
     * The server sends both on every one of these routes now. This keeps the
     * panel from depending on that: facts about the CALLER do not change
     * because a client id was saved, so a payload that is quiet about them is
     * treated as quiet, not as a denial.
     */
    function applyStatus(out) {
        if (!out || typeof out !== 'object') return S.status;
        const prev = S.status || {};
        S.status = {
            ...out,
            you: out.you || prev.you || null,
            redirectUri: out.redirectUri || prev.redirectUri || '',
        };
        return S.status;
    }

    /**
     * May this person maintain the Infinite Flight connection?
     *
     * `you.canManage` is the answer, and it comes from a backend that knows
     * about integrations.manage. FALLING BACK TO `you.owner` is not belt and
     * braces — it is the deploy-order guarantee. This panel ships separately
     * from the API it talks to, and a backend that predates the capability
     * sends `you` WITHOUT `canManage`; read plainly, that undefined is falsy
     * and every owner is told to go and ask the VA owner for permission. On
     * the setup screen. Which is the bug this panel was just fixed for.
     *
     * So: the new answer when there is one, the old one when there isn't.
     * `??` rather than `||` — an explicit `false` from a new backend is a real
     * refusal and must not fall through to ownership.
     */
    const mayManage = (st) => {
        const you = st && st.you;
        if (!you) return false;
        return you.canManage ?? !!you.owner;
    };

    async function load({ quiet = false } = {}) {
        if (!S.slug) return null;
        try {
            // A full load is the one place the previous status is NOT carried
            // over: GET /if is authoritative about the caller, so a demotion
            // between page loads has to be able to land.
            S.status = await S.api('/if');
            S.error = null;
        } catch (err) {
            S.status = null;
            S.error = err;
        }
        S.loaded = true;
        if (!quiet) render();
        return S.status;
    }

    async function loadFleet({ force = false } = {}) {
        if (!S.status || !S.status.organization) return;
        // The backend caches these for five seconds of its own; this stops a
        // panel that repaints from asking again inside one interaction.
        if (!force && S.fleet && Date.now() - S.fleetAt < 4000) return;
        S.fleet = await S.api('/if/fleet');
        S.fleetAt = Date.now();
        loadLive(S.fleet.aircraft);   // fire and forget — see the note in loadLive
    }

    /**
     * Ask the live tracker which of these aircraft are actually airborne.
     *
     * The v3 docs say to do exactly this: the stored position "can be stale when
     * the aircraft is not actively reporting", and the way to know is to compare
     * the aircraft id with the v2 multiplayer feed. The tracker service already
     * holds that feed, so this costs Infinite Flight nothing.
     *
     * Never awaited by anything that matters and never allowed to fail loudly.
     * It ADDS a green dot; a board without one is a board, and a tracker having
     * a bad minute must not take the fleet view down with it.
     */
    async function loadLive(aircraft) {
        const ids = (aircraft || []).map((a) => a.id).filter(Boolean);
        if (!ids.length || !S.liveBase) return;
        try {
            const res = await fetch(`${S.liveBase}/api/live/aircraft-active`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
            });
            if (!res.ok) return;
            const data = await res.json();
            S.live = (data && data.active) || {};
            if (panel && panel.isOpen()) render();
            paintBoards();
        } catch { /* the dot is a bonus, never a dependency */ }
    }

    /**
     * The fleet's workload.
     *
     * Costs one call per aircraft on the backend, which is why it is its own tab
     * loaded on demand rather than part of the fleet board's refresh — and why
     * the result is kept until somebody asks for it again.
     *
     * A refused scope is not a failure worth an error box: the panel says the
     * connection was not granted schedule access and leaves it there, because
     * reconnecting is the fix and the Connection tab is where that lives.
     */
    async function loadUtilisation() {
        S.useError = null;
        try {
            S.use = await S.api('/if/utilisation');
        } catch (err) {
            S.use = null;
            S.useError = (err && err.message) || 'Could not work out the fleet’s workload.';
        }
    }

    async function loadSchedules(aircraftId, { force = false } = {}) {
        if (!aircraftId) return;
        if (!force && S.aircraftId === aircraftId && S.schedules) return;
        S.aircraftId = aircraftId;
        const data = await S.api(`/if/aircraft/${encodeURIComponent(aircraftId)}/schedules`);
        S.schedules = data.schedules || [];
        S.linked = data.linked || {};
    }

    /**
     * Run something that talks to Infinite Flight, with the panel's busy state
     * and one place that turns a failure into a sentence.
     *
     * Every write in this file goes through here, so there is exactly one
     * implementation of "disable the buttons, do the thing, say what happened".
     */
    async function act(fn, { done = '' } = {}) {
        if (S.busy) return null;
        S.busy = true;
        render();
        try {
            const out = await fn();
            if (done) toast(done, 'ok');
            return out;
        } catch (err) {
            // 409 with if_reconnect means the grant is finished — a different
            // problem from "that request was refused", and the only one where
            // the fix is to go and sign in again.
            if (err && err.code === 'if_reconnect') {
                toast(err.message || 'Reconnect your Infinite Flight account.', 'bad');
                await load({ quiet: true });
            } else {
                toast((err && err.message) || 'That didn’t work.', 'bad');
            }
            return null;
        } finally {
            S.busy = false;
            render();
        }
    }

    /* =====================================================================
     * The panel
     * ================================================================== */

    function ensurePanel() {
        if (panel) return panel;
        injectStyles();
        panel = P.sheet({ id: 'cif-panel', title: 'Infinite Flight', icon: 'plane', wide: true });
        panel.body.addEventListener('click', onClick);
        panel.body.addEventListener('submit', onSubmit);
        panel.body.addEventListener('change', onChange);
        return panel;
    }

    /**
     * Paint the panel.
     *
     * THE TRY/CATCH IS THE POINT, and it is worth being explicit about why,
     * because "wrap it in a try/catch" is usually a smell and here it is the
     * fix for a specific, reported failure.
     *
     * Opening a sheet takes the scroll lock, which sets `position:fixed` on the
     * body and collapses the document to nothing. If the render then throws,
     * `innerHTML` is never assigned, the lock is never released, and what is
     * left on screen is the page background with an empty sheet over it —
     * white on the crew center, black inside the app's overlay. No content, no
     * error, nothing to click, and Escape the only way out. crewPanels.js
     * carries a safety net for exactly this, but a net is a last resort: the
     * right answer is not to fall.
     *
     * So a view that throws paints an honest failure instead of nothing. The
     * panel stays usable, the reader can close it, and the console gets the
     * actual error.
     *
     * Every escape hatch below is deliberately unable to throw in turn: no
     * template interpolation of live data, no icon pass, plain text only.
     */
    function render() {
        if (!panel || !panel.isOpen()) return;
        let html;
        try {
            html = view();
        } catch (err) {
            console.error('crewInfiniteFlight: render failed —', err);
            html = '<div class="cp-empty">Something went wrong drawing this panel. '
                + 'Close it and try again — your fleet and schedules are unaffected.</div>';
        }
        try {
            panel.body.innerHTML = html;
        } catch (err) {
            // Assigning innerHTML can itself throw on a detached node. Better a
            // panel that says nothing than a page locked behind one.
            console.error('crewInfiniteFlight: could not paint —', err);
            return;
        }
        // Neither of these may take the panel down. Icons throw on a name
        // lucide does not know; the picture upgrade touches the network.
        try { icons(); } catch { /* a missing glyph is not worth a blank panel */ }
        try {
            if (window.CrewAircraftImage) window.CrewAircraftImage.upgrade(panel.body);
        } catch { /* photographs are decoration */ }
    }

    function view() {
        if (!S.loaded) return '<div class="cp-empty">Loading…</div>';
        if (S.error) {
            if (P.isSchemaGap(S.error)) return P.schemaGapHtml(S.error);
            return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>${esc(S.error.message || 'Could not load the connection.')}</div>`;
        }
        const st = S.status;
        if (!st) return '<div class="cp-empty">Could not load the connection.</div>';
        if (!st.connected) return setupView(st);

        return `
            ${connectionHeader(st)}
            <div class="cif-tabs" role="tablist">
                ${tabButton('fleet', 'Fleet')}
                ${tabButton('schedule', 'Schedules')}
                ${tabButton('use', 'Utilisation')}
                ${tabButton('setup', 'Connection')}
            </div>
            ${S.tab === 'fleet' ? fleetView(st) : ''}
            ${S.tab === 'schedule' ? scheduleView(st) : ''}
            ${S.tab === 'use' ? utilisationView(st) : ''}
            ${S.tab === 'setup' ? connectionView(st) : ''}`;
    }

    const tabButton = (id, label) => `<button class="cif-tab" role="tab" data-cif-tab="${id}"
        aria-selected="${S.tab === id}">${esc(label)}</button>`;

    /* --------------------------------------------------------------------
     * Not connected yet
     *
     * The screen a VA sees once, and the one that decides whether they ever
     * see the rest. It is long on purpose: OAuth against a preview API with a
     * client the VA has to create themselves is genuinely several steps, and
     * the alternative to explaining them is a Connect button that produces a
     * 403 nobody can diagnose.
     * ----------------------------------------------------------------- */
    function setupView(st) {
        // `canManage`, not `owner`. Connecting the account is gated on
        // integrations.manage, which an owner holds implicitly and can grant to
        // whoever actually keeps the integrations working — so the question the
        // screen asks is "may you do this", not "is your name on the airline".
        const owner = mayManage(st);
        if (!owner) {
            return `<div class="cp-empty">
                <i data-lucide="plane"></i>
                This crew center isn’t connected to Infinite Flight yet.
                <div class="cp-note" style="margin-top:.5rem">Ask the VA owner, or someone with permission to manage integrations, to connect an account.</div>
            </div>`;
        }
        const c = st.client || {};
        const failed = st.failed
            ? `<p class="cp-note cp-note-bad">The connection made ${esc(relativeText(st.connectedAt))} stopped working${st.error ? ' — ' + esc(st.error) : ''}.</p>`
            : '';

        return `
        <div class="cp-card">
            <h3 class="cp-card-title">Connect your Live organization</h3>
            <p class="cp-note" style="margin:.4rem 0 .8rem">
                Infinite Flight’s API can show this crew center the aircraft your VA actually owns,
                where each one is, and the schedule each one is going to fly — and let your staff
                build that schedule from here.
            </p>
            ${failed}
            ${c.configured ? '' : `
            <p class="cp-note cp-note-bad" style="margin-top:.6rem">
                Infinite Flight sign-in isn’t configured on this server yet. An Inflight
                administrator needs to set the platform OAuth client — there’s nothing for
                you to do here until they have.
            </p>`}
        </div>
        ${clientCard(st, c)}
        ${signInCard(st, c)}`;
    }

    /**
     * The OAuth client card.
     *
     * Signing in runs on Inflight's own client, so for almost everybody this is
     * not a step — it is a fact about how the connection works, and a form they
     * should never have to open. It used to be the first thing on the screen,
     * with a four-step walkthrough of registering an application on Infinite
     * Flight's developer page, because the platform client could not be used
     * yet. That is over; a sign-in button that begins "first, create an OAuth2
     * client" is not a sign-in button.
     *
     * So the form is folded away unless it is actually load-bearing:
     *
     *   • platform client in use  → one sentence, form collapsed behind a
     *     disclosure for the VA who has a reason to use their own
     *   • the VA's own in use     → open, because it is theirs to maintain and
     *     hiding the field they are responsible for would be worse
     *   • nothing configured      → open, with the registration steps, since on
     *     that deployment their own client is the only thing that can work
     */
    function clientCard(st, c) {
        const usingOwn = c.source === 'va';
        const platform = c.configured && c.source === 'platform';
        const steps = `
            <ol class="cif-steps">
                <li>Open <a href="https://infiniteflight.com/account/api-keys" target="_blank" rel="noopener noreferrer">infiniteflight.com/account/api-keys</a> and create an OAuth2 client.</li>
                <li>Set its redirect URI to exactly:<br><code class="cif-plan">${esc(st.redirectUri || '')}</code></li>
                <li>Choose <b>confidential</b> if you can keep a secret, or <b>public</b> if not — either works.</li>
                <li>Paste the client ID below.</li>
            </ol>`;

        const form = `
        <form data-cif-form="client">
            ${platform ? '' : steps}
            <div style="margin-top:.6rem">
                <label class="cp-label" for="cif-client-id">Client ID</label>
                <input class="cp-input" id="cif-client-id" name="clientId" placeholder="ifc_…"
                       value="${esc(c.source === 'va' ? (c.id || '') : '')}" autocomplete="off">
            </div>
            <div style="margin-top:.6rem">
                <label class="cp-label" for="cif-client-secret">Client secret <span class="cp-faint">— confidential clients only</span></label>
                <input class="cp-input" id="cif-client-secret" name="clientSecret" type="password"
                       placeholder="${c.secretHint ? esc(c.secretHint) + ' — leave blank to keep' : 'Leave blank for a public (PKCE) client'}"
                       autocomplete="off" ${c.canStoreSecret ? '' : 'disabled'}>
                ${c.canStoreSecret ? '' : `<p class="cp-note cp-note-warn" style="margin-top:.35rem">${esc(c.storeSecretReason || '')} You can still connect with a public client.</p>`}
                ${c.secretUnavailable ? '<p class="cp-note cp-note-bad" style="margin-top:.35rem">The saved secret can’t be read on this server any more. Paste it again, or switch the client to public.</p>' : ''}
            </div>
            <div class="cif-acts" style="margin-top:.7rem">
                <button class="cp-btn cp-btn-primary" type="submit" ${S.busy ? 'disabled' : ''}>Save client</button>
                ${usingOwn ? '<button class="cp-btn cp-btn-bad" type="button" data-cif="client-clear">Remove</button>' : ''}
            </div>
        </form>`;

        if (!platform) {
            return `<div class="cp-card">
            <h3 class="cp-card-title">OAuth client</h3>
            ${usingOwn ? `<p class="cp-note" style="margin-top:.4rem">
                This crew center signs in with its own OAuth client. Remove it to go back to
                Inflight’s, which needs no setup.${st.connected ? ' Your current connection stays on this client until you disconnect.' : ''}
            </p>` : ''}
            ${form}
        </div>`;
        }

        return `<div class="cp-card">
            <h3 class="cp-card-title">OAuth client</h3>
            <p class="cp-note" style="margin-top:.4rem">
                Signing in uses Inflight’s own Infinite Flight app — there’s nothing to register
                and nothing to paste here.
            </p>
            <details style="margin-top:.6rem">
                <summary class="cp-note" style="cursor:pointer">Use your own OAuth client instead</summary>
                <p class="cp-note" style="margin:.5rem 0 .2rem">
                    Only if you need the connection to run under credentials your VA owns. Most
                    crew centers should leave this alone.
                </p>
                ${steps}
                ${form}
            </details>
        </div>`;
    }

    /** The sign-in card — the part that is actually a button. */
    function signInCard(st, c) {
        return `
        <div class="cp-card">
            <h3 class="cp-card-title">Sign in</h3>
            <p class="cp-note" style="margin:.4rem 0 .6rem">
                You’ll be sent to Infinite Flight to approve this. It connects <b>your</b> account —
                what this crew center can do is exactly what you can do in the Live portal, no more.
            </p>
            <div class="cif-scopes" style="margin-bottom:.7rem">
                ${Object.entries(st.scopeCatalog || {}).map(([k, v]) => `<span class="cp-chip" title="${esc(k)}">${esc(v)}</span>`).join('')}
            </div>
            <label class="cp-note" style="display:flex;gap:.45rem;align-items:center;margin-bottom:.5rem">
                <input type="checkbox" data-cif-opt="readOnly"> Read-only — don’t let this crew center change my schedules
            </label>
            <label class="cp-note" style="display:flex;gap:.45rem;align-items:center;margin-bottom:.8rem">
                <input type="checkbox" data-cif-opt="forceConsent"> Always show the approval screen
            </label>
            <button class="cp-btn cp-btn-primary" data-cif="connect" ${c.configured && !S.busy ? '' : 'disabled'}>
                <i data-lucide="log-in"></i> Connect Infinite Flight
            </button>
            ${c.configured ? '' : '<p class="cp-note" style="margin-top:.5rem">Waiting on the server’s OAuth client.</p>'}
        </div>`;
    }

    /* --------------------------------------------------------------------
     * Connected
     * ----------------------------------------------------------------- */

    function connectionHeader(st) {
        const org = st.organization;
        const write = st.canWrite && st.you && st.you.canManageSchedules;
        return `<div class="cp-card">
            <div class="cif-row-top">
                <div style="min-width:0">
                    <div class="cif-reg">${esc(org ? org.name : 'No organization selected')}</div>
                    <div class="cp-note">
                        ${org && org.world && org.world.label ? esc(org.world.label) + ' · ' : ''}
                        Connected${st.connectedBy ? ' by ' + esc(st.connectedBy) : ''} ${esc(relativeText(st.connectedAt))}
                    </div>
                </div>
                <div style="display:flex;gap:.3rem;flex-wrap:wrap;justify-content:flex-end">
                    ${st.failed ? chip('Needs reconnecting', 'bad') : chip('Connected', 'ok')}
                    ${write ? chip('Can edit schedules', 'accent') : chip('Read only', 'mute')}
                </div>
            </div>
            ${st.failed && st.error ? `<p class="cp-note cp-note-bad" style="margin-top:.5rem">${esc(st.error)}</p>` : ''}
        </div>`;
    }

    function fleetView(st) {
        if (!st.organization) {
            return `<div class="cp-empty"><i data-lucide="building-2"></i>
                Pick which Live organization this crew center is for.
                <div style="margin-top:.8rem"><button class="cp-btn cp-btn-primary" data-cif-tab="setup">Choose organization</button></div>
            </div>`;
        }
        if (!S.fleet) return '<div class="cp-empty">Loading the fleet…</div>';
        const list = S.fleet.aircraft || [];
        if (!list.length) {
            return '<div class="cp-empty"><i data-lucide="plane"></i>This organization has no aircraft.</div>';
        }
        const s = S.fleet.summary || {};
        const num = (v) => (v === undefined || v === null ? '—' : Number(v).toLocaleString());
        return `
        <div class="cif-stats">
            <div class="cif-stat"><b>${num(s.total)}</b><span>Aircraft</span></div>
            <div class="cif-stat"><b>${num(s.active)}</b><span>In fleet</span></div>
            <div class="cif-stat"><b>${num(s.storage)}</b><span>Storage</span></div>
            <div class="cif-stat"><b>${num(s.hangared)}</b><span>Hangared</span></div>
            <div class="cif-stat"><b>${num(s.airborne)}</b><span>Airborne</span></div>
        </div>
        <div class="cif-ac">${list.map(aircraftRow).join('')}</div>
        <p class="cp-note cp-faint">
            Positions are Infinite Flight’s last stored reading, not a live feed — each row says how old its own is.
            ${S.fleet.readAt ? 'Read ' + esc(relativeText(S.fleet.readAt)) + '.' : ''}
            <button class="cp-btn cp-btn-sm" data-cif="fleet-refresh" style="margin-left:.4rem">Refresh</button>
        </p>`;
    }

    function aircraftRow(a) {
        const liveNow = S.live[a.id];
        const storageChip = a.storage === 'active' ? chip('In fleet', 'ok')
            : a.storage === 'hangared' ? chip('Hangared', 'mute') : chip('Storage', 'warn');
        return `<div class="cif-row" data-cif-ac="${esc(a.id)}">
            <div class="cif-row-top">
                <div class="cif-idrow">
                    ${picture(a)}
                    <div style="min-width:0">
                        <span class="cif-reg">${esc(a.registration || 'Unregistered')}</span>
                        ${a.fleetRank ? `<span class="cif-rank"> · #${esc(String(a.fleetRank))} in fleet</span>` : ''}
                        ${a.type && a.type.name ? `<div class="cp-note cp-faint">${esc(a.type.name)}${a.type.livery ? ' · ' + esc(a.type.livery) : ''}</div>` : ''}
                    </div>
                </div>
                <div style="display:flex;gap:.3rem;flex-wrap:wrap;justify-content:flex-end">
                    ${liveNow ? chip('Flying now', 'ok') : ''}
                    ${storageChip}
                </div>
            </div>
            <div class="cif-times">${positionLine(a.position)}</div>
            ${liveNow ? `<div class="cp-note">
                On ${esc(liveNow.server || 'Live')}${liveNow.callsign ? ' as ' + esc(liveNow.callsign) : ''}${liveNow.username ? ' · ' + esc(liveNow.username) : ''}
                ${liveNow.departureIcao || liveNow.arrivalIcao
                    ? ' · ' + esc(liveNow.departureIcao || '?') + ' → ' + esc(liveNow.arrivalIcao || '?') : ''}
            </div>` : ''}
            <div class="cif-acts">
                <button class="cp-btn cp-btn-sm" data-cif="open-schedule" data-id="${esc(a.id)}">
                    <i data-lucide="calendar-clock"></i> Schedule
                </button>
            </div>
        </div>`;
    }

    /* --------------------------------------------------------------------
     * The rota
     * ----------------------------------------------------------------- */

    function scheduleView(st) {
        if (!st.canReadSchedules) {
            return `<div class="cp-empty"><i data-lucide="lock"></i>
                This connection wasn’t granted permission to read schedules. Reconnect and approve schedule access.
            </div>`;
        }
        const fleet = (S.fleet && S.fleet.aircraft) || [];
        const picker = `<div>
            <label class="cp-label" for="cif-ac-pick">Aircraft</label>
            <select class="cp-select" id="cif-ac-pick" data-cif-pick="aircraft">
                <option value="">Choose an aircraft…</option>
                ${fleet.map((a) => `<option value="${esc(a.id)}" ${a.id === S.aircraftId ? 'selected' : ''}>
                    ${esc(a.registration || a.id)}${a.storage === 'active' ? '' : ' — ' + esc(a.storage)}
                </option>`).join('')}
            </select>
        </div>`;

        if (!S.aircraftId) return `<div class="cp-card">${picker}</div>`;
        if (S.editing) return `<div class="cp-card">${picker}</div>${legForm(st)}`;
        if (S.planning) return `<div class="cp-card">${picker}</div>${planForm(st)}`;

        const write = st.canWrite && st.you && st.you.canManageSchedules;
        const legs = S.schedules || [];
        return `
        <div class="cp-card">${picker}</div>
        ${write ? `<div class="cif-acts">
            <button class="cp-btn cp-btn-primary" data-cif="leg-new"><i data-lucide="plus"></i> Add flight</button>
            <button class="cp-btn" data-cif="push"><i data-lucide="upload"></i> Push crew schedule</button>
            <button class="cp-btn" data-cif="pull"><i data-lucide="download"></i> Import to crew center</button>
        </div>` : ''}
        ${legs.length
            ? `<div class="cif-ac">${legs.map((s, i) => legRow(s, i, legs.length, write)).join('')}</div>`
            : '<div class="cp-empty"><i data-lucide="calendar-x"></i>Nothing scheduled on this aircraft.</div>'}
        ${legs.length ? '<p class="cp-note cp-faint">All times are UTC. The order here is the order the aircraft flies them.</p>' : ''}`;
    }

    function legRow(s, index, total, write) {
        const link = S.linked[s.id];
        return `<div class="cif-leg" data-cif-leg="${esc(s.id)}">
            <div class="cif-seq">${index + 1}</div>
            <div class="cif-leg-main">
                <div class="cif-route">
                    <span>${esc(s.callsign || '—')}</span>
                    <span class="cp-muted">${esc(s.originIcao || '?')} → ${esc(s.destinationIcao || '?')}</span>
                    ${chip(enumLabel(s.status), statusTone(s.status))}
                    ${s.flightType && s.flightType.label ? chip(s.flightType.label) : ''}
                    ${link ? chip('In crew center', 'mute') : ''}
                </div>
                <div class="cif-times">${utcLine(s)}</div>
                ${s.flightPlan ? `<div class="cif-plan">${esc(s.flightPlan.slice(0, 220))}${s.flightPlan.length > 220 ? '…' : ''}</div>` : ''}
                ${s.briefing ? `<div class="cp-note">${esc(s.briefing.slice(0, 200))}${s.briefing.length > 200 ? '…' : ''}</div>` : ''}
            </div>
            ${write ? `<div class="cif-leg-acts">
                <div class="cif-mv">
                    <button data-cif="move-top" data-id="${esc(s.id)}" title="Move to top" ${index === 0 ? 'disabled' : ''}><i data-lucide="chevrons-up"></i></button>
                    <button data-cif="move-up" data-id="${esc(s.id)}" title="Move up" ${index === 0 ? 'disabled' : ''}><i data-lucide="chevron-up"></i></button>
                    <button data-cif="move-down" data-id="${esc(s.id)}" title="Move down" ${index === total - 1 ? 'disabled' : ''}><i data-lucide="chevron-down"></i></button>
                </div>
                <div class="cif-mv">
                    <button data-cif="leg-edit" data-id="${esc(s.id)}" title="Edit"><i data-lucide="pencil"></i></button>
                    <button data-cif="leg-plan" data-id="${esc(s.id)}" title="Flight plan"><i data-lucide="route"></i></button>
                    <button data-cif="leg-delete" data-id="${esc(s.id)}" title="Remove"><i data-lucide="trash-2"></i></button>
                </div>
            </div>` : '<div></div>'}
        </div>`;
    }

    /**
     * Add or edit a leg.
     *
     * Every field the documented ScheduleRequest carries, with the API's own
     * limits counted down against — the backend sends them (ifLive.LIMITS)
     * rather than this file guessing, so a limit that moves in the preview moves
     * here too.
     */
    function legForm(st) {
        const e = S.editing;
        const lim = st.limits || {};
        const types = (st.enums && st.enums.flightType) || [];
        return `<form class="cp-card" data-cif-form="leg">
            <h3 class="cp-card-title">${e.id ? 'Edit flight' : 'Add a flight'}</h3>
            <div class="cp-grid2" style="margin-top:.7rem">
                <div>
                    <label class="cp-label" for="cif-callsign">Callsign</label>
                    <input class="cp-input" id="cif-callsign" name="callsign" required
                           maxlength="${esc(String(lim.callsign || 32))}" value="${esc(e.callsign || '')}">
                </div>
                <div>
                    <label class="cp-label" for="cif-type">Flight type</label>
                    <select class="cp-select" id="cif-type" name="flightType">
                        ${types.map((t) => `<option value="${esc(String(t.value))}" ${Number(e.flightType) === t.value ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="cp-label" for="cif-origin">From</label>
                    <input class="cp-input" id="cif-origin" name="originIcao" required
                           maxlength="${esc(String(lim.icao || 8))}" placeholder="KLAX"
                           value="${esc(e.originIcao || '')}" style="text-transform:uppercase">
                </div>
                <div>
                    <label class="cp-label" for="cif-dest">To</label>
                    <input class="cp-input" id="cif-dest" name="destinationIcao" required
                           maxlength="${esc(String(lim.icao || 8))}" placeholder="KJFK"
                           value="${esc(e.destinationIcao || '')}" style="text-transform:uppercase">
                </div>
                <div>
                    <label class="cp-label" for="cif-dep">Departure (UTC)</label>
                    <input class="cp-input" id="cif-dep" name="scheduledDepartureUtc" type="datetime-local" required
                           value="${esc(toLocalInput(e.scheduledDepartureUtc))}">
                </div>
                <div>
                    <label class="cp-label" for="cif-arr">Arrival (UTC)</label>
                    <input class="cp-input" id="cif-arr" name="scheduledArrivalUtc" type="datetime-local" required
                           value="${esc(toLocalInput(e.scheduledArrivalUtc))}">
                </div>
            </div>
            <div style="margin-top:.6rem">
                <label class="cp-label" for="cif-brief">Briefing <span class="cp-faint">— optional, up to ${esc(String((lim.briefing || 4000).toLocaleString()))} characters</span></label>
                <textarea class="cp-textarea" id="cif-brief" name="briefing" maxlength="${esc(String(lim.briefing || 4000))}">${esc(e.briefing || '')}</textarea>
            </div>
            <div style="margin-top:.6rem">
                <label class="cp-label" for="cif-plan">Flight plan <span class="cp-faint">— optional</span></label>
                <textarea class="cp-textarea" id="cif-plan" name="flightPlan" maxlength="${esc(String(lim.flightPlan || 16000))}" placeholder="KLAX DCT KJFK">${esc(e.flightPlan || '')}</textarea>
            </div>
            <div class="cif-acts" style="margin-top:.8rem">
                <button class="cp-btn cp-btn-primary" type="submit" ${S.busy ? 'disabled' : ''}>${e.id ? 'Save' : 'Add flight'}</button>
                <button class="cp-btn" type="button" data-cif="cancel">Cancel</button>
            </div>
            <p class="cp-note cp-faint" style="margin-top:.5rem">Times are UTC — type Zulu, not your local clock.</p>
        </form>`;
    }

    /**
     * The flight plan on its own.
     *
     * Its own endpoint upstream and its own form here, deliberately: re-planning
     * through the full edit would mean sending every other field back, and one
     * of them being slightly wrong would silently move the departure time while
     * somebody changed a route.
     */
    function planForm() {
        const s = S.planning;
        return `<form class="cp-card" data-cif-form="plan">
            <h3 class="cp-card-title">Flight plan — ${esc(s.callsign || '')} ${esc(s.originIcao || '')} → ${esc(s.destinationIcao || '')}</h3>
            <textarea class="cp-textarea" name="flightPlan" style="min-height:9rem;font-family:ui-monospace,Menlo,monospace"
                      placeholder="KLAX DCT LAS DCT KJFK">${esc(s.flightPlan || '')}</textarea>
            <div class="cif-acts" style="margin-top:.7rem">
                <button class="cp-btn cp-btn-primary" type="submit" ${S.busy ? 'disabled' : ''}>Save plan</button>
                <button class="cp-btn" type="button" data-cif="cancel">Cancel</button>
            </div>
            <p class="cp-note cp-faint" style="margin-top:.5rem">Clearing this removes the stored plan.</p>
        </form>`;
    }

    /* --------------------------------------------------------------------
     * Utilisation
     *
     * The one question a fleet board could not answer by scrolling: which of
     * these aeroplanes is nobody using? An airframe unflown for three weeks
     * that everybody assumes somebody else is on is invisible in a rota read
     * one aircraft at a time.
     *
     * The backend does the arithmetic (ifLive.fleetUtilisation) so this and any
     * later surface cannot disagree about what "idle" means. Note what is drawn
     * for an aircraft whose rota could not be read: "not read", not "nothing
     * scheduled". Reporting a failed read as an empty rota would send a VA
     * looking for a problem that is not there, which is worse than saying
     * nothing.
     * ----------------------------------------------------------------- */
    function utilisationView(st) {
        if (!st.canReadSchedules) {
            return `<div class="cp-empty"><i data-lucide="lock"></i>
                This connection wasn’t granted permission to read schedules, so the fleet’s workload can’t be worked out.
            </div>`;
        }
        if (S.useError) {
            return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>${esc(S.useError)}</div>`;
        }
        if (!S.use) return '<div class="cp-empty">Reading every aircraft’s schedule…</div>';

        const s = S.use.summary || {};
        const hours = (mins) => (mins ? `${Math.round(mins / 60).toLocaleString()}h` : '0h');
        const num = (v) => (v === undefined || v === null ? '—' : Number(v).toLocaleString());
        return `
        <div class="cif-stats">
            <div class="cif-stat"><b>${num(s.idle)}</b><span>Idle</span></div>
            <div class="cif-stat"><b>${num(s.upcomingLegs)}</b><span>Legs booked</span></div>
            <div class="cif-stat"><b>${esc(hours(s.scheduledMinutes))}</b><span>Block scheduled</span></div>
            <div class="cif-stat"><b>${s.longestIdleDays ? num(s.longestIdleDays) + 'd' : '—'}</b><span>Longest idle</span></div>
            <div class="cif-stat"><b>${num(s.neverFlown)}</b><span>Never flown</span></div>
        </div>
        ${s.unknown ? `<p class="cp-note cp-note-warn">${esc(String(s.unknown))} aircraft’s schedules couldn’t be read — they’re listed but not counted above.</p>` : ''}
        <div class="cif-ac">${(S.use.aircraft || []).map(utilisationRow).join('')}</div>
        <p class="cp-note cp-faint">
            “Flown” counts legs Infinite Flight recorded an actual arrival for — a schedule in the past
            that nobody flew doesn’t count.
            ${S.use.readAt ? 'Read ' + esc(relativeText(S.use.readAt)) + '.' : ''}
            <button class="cp-btn cp-btn-sm" data-cif="use-refresh" style="margin-left:.4rem">Refresh</button>
        </p>`;
    }

    function utilisationRow(r) {
        const idleFor = r.daysSinceFlown === null
            ? 'never flown'
            : `last flew ${r.daysSinceFlown === 0 ? 'today' : r.daysSinceFlown + ' day' + (r.daysSinceFlown === 1 ? '' : 's') + ' ago'}`;
        return `<div class="cif-row">
            <div class="cif-row-top">
                <div class="cif-idrow">
                    ${picture(r)}
                    <div style="min-width:0">
                        <span class="cif-reg">${esc(r.registration || 'Unregistered')}</span>
                        ${r.fleetRank ? `<span class="cif-rank"> · #${esc(String(r.fleetRank))}</span>` : ''}
                        ${r.type && r.type.name ? `<div class="cp-note cp-faint">${esc(r.type.name)}</div>` : ''}
                    </div>
                </div>
                <div style="display:flex;gap:.3rem;flex-wrap:wrap;justify-content:flex-end">
                    ${r.rotaUnknown ? chip('Not read', 'mute')
                        : r.idle ? chip('Idle', 'warn')
                        : chip(`${r.upcoming} booked`, 'ok')}
                    ${r.storage !== 'active' ? chip(r.storage === 'hangared' ? 'Hangared' : 'Storage', 'mute') : ''}
                </div>
            </div>
            <div class="cif-times">
                ${r.rotaUnknown
                    ? '<span class="cp-faint">Its schedule couldn’t be read just now.</span>'
                    : `${esc(idleFor)}${r.flownLegs ? ` · ${r.flownLegs} leg${r.flownLegs === 1 ? '' : 's'} flown` : ''}${
                        r.nextDepartureUtc ? ` · next out ${esc(whenText(r.nextDepartureUtc))} ${esc(timeText(r.nextDepartureUtc))}Z` : ''}`}
            </div>
            ${!r.rotaUnknown && r.scheduledMinutes
                ? `<div class="cp-note cp-faint">${Math.round(r.scheduledMinutes / 60)}h block scheduled</div>` : ''}
            <div class="cif-acts">
                <button class="cp-btn cp-btn-sm" data-cif="open-schedule" data-id="${esc(r.id)}">
                    <i data-lucide="calendar-clock"></i> Schedule
                </button>
            </div>
        </div>`;
    }

    /* --------------------------------------------------------------------
     * The connection tab
     * ----------------------------------------------------------------- */

    function connectionView(st) {
        // Same as setupView: picking the organization, reconnecting and
        // disconnecting are all "manage the connection", not "own the airline".
        const owner = mayManage(st);
        const orgs = S.organizations;
        const fleet = (S.fleet && S.fleet.aircraft) || [];
        return `
        <div class="cp-card">
            <h3 class="cp-card-title">Organization</h3>
            ${orgs === null ? '<p class="cp-note" style="margin-top:.5rem">Loading…</p>' : ''}
            ${Array.isArray(orgs) ? (orgs.length ? `
                <div style="margin-top:.6rem;display:grid;gap:.4rem">
                    ${orgs.map((o) => `<label class="cp-note" style="display:flex;gap:.5rem;align-items:flex-start">
                        <input type="radio" name="cif-org" value="${esc(o.id)}" ${st.organization && st.organization.id === o.id ? 'checked' : ''} ${owner ? '' : 'disabled'}>
                        <span>
                            <b style="color:var(--ink,#1C1A16)">${esc(o.name)}</b>
                            ${o.worldType && o.worldType.label ? ' · ' + esc(o.worldType.label) : ''}
                            ${o.operationType && o.operationType.label ? ' · ' + esc(o.operationType.label) : ''}
                            ${o.description ? `<br><span class="cp-faint">${esc(o.description.slice(0, 160))}</span>` : ''}
                        </span>
                    </label>`).join('')}
                </div>
                ${owner ? '<div class="cif-acts" style="margin-top:.7rem"><button class="cp-btn cp-btn-primary" data-cif="org-save" ' + (S.busy ? 'disabled' : '') + '>Use this organization</button></div>' : ''}
            ` : '<p class="cp-note" style="margin-top:.5rem">This account isn’t in any Live organization.</p>') : ''}
        </div>

        <div class="cp-card">
            <h3 class="cp-card-title">Crew schedule sync</h3>
            <p class="cp-note" style="margin:.4rem 0 .7rem">
                With this on, publishing a departure in the crew center puts it on that aircraft’s
                Infinite Flight rota, edits follow it, and cancelling or deleting it takes it back off.
                Assigning an aircraft to a departure says <b>which</b> aeroplane; this switch says
                <b>whether</b> we write to it.
            </p>
            <p class="cp-note cp-faint" style="margin:0 0 .7rem">
                Leave it off and the aircraft is only a label — pilots still see the registration they’re
                on, and your Infinite Flight rota is untouched until you press Push.
            </p>
            <div>
                <label class="cp-label" for="cif-sync-ac">Default aircraft <span class="cp-faint">— for departures with none assigned</span></label>
                <select class="cp-select" id="cif-sync-ac" ${st.canWrite ? '' : 'disabled'}>
                    <option value="">Not set</option>
                    ${fleet.map((a) => `<option value="${esc(a.id)}" ${st.sync && st.sync.aircraftId === a.id ? 'selected' : ''}>${esc(a.registration || a.id)}</option>`).join('')}
                </select>
            </div>
            <label class="cp-note" style="display:flex;gap:.45rem;align-items:center;margin-top:.6rem">
                <input type="checkbox" id="cif-sync-on" ${st.sync && st.sync.enabled ? 'checked' : ''} ${st.canWrite ? '' : 'disabled'}>
                Keep Infinite Flight in step with the crew schedule, automatically
            </label>
            ${st.sync && st.sync.syncedAt ? `<p class="cp-note cp-faint" style="margin-top:.4rem">Last pushed ${esc(relativeText(st.sync.syncedAt))}.</p>` : ''}
            <div class="cif-acts" style="margin-top:.7rem">
                <button class="cp-btn cp-btn-primary" data-cif="sync-save" ${st.canWrite && !S.busy ? '' : 'disabled'}>Save</button>
            </div>
        </div>

        <div class="cp-card">
            <h3 class="cp-card-title">Access</h3>
            <div class="cif-scopes" style="margin-top:.5rem">
                ${(st.scopes || []).map((s) => chip((st.scopeCatalog && st.scopeCatalog[s]) || s)).join('') || '<span class="cp-note">None recorded.</span>'}
            </div>
            ${st.expiresAt ? `<p class="cp-note cp-faint" style="margin-top:.5rem">The current access token renews itself; it expires ${esc(relativeText(st.expiresAt))}.</p>` : ''}
            ${owner ? `<div class="cif-acts" style="margin-top:.8rem">
                <button class="cp-btn" data-cif="connect"><i data-lucide="refresh-cw"></i> Reconnect</button>
                <button class="cp-btn cp-btn-bad" data-cif="disconnect">Disconnect</button>
            </div>
            <p class="cp-note cp-faint" style="margin-top:.5rem">
                Disconnecting removes our copy of the authorization. To withdraw it at Infinite Flight as well,
                remove this app from your Infinite Flight account.
            </p>` : ''}
        </div>`;
    }

    /* =====================================================================
     * Events
     * ================================================================== */

    async function onClick(ev) {
        const tab = ev.target.closest('[data-cif-tab]');
        if (tab) {
            S.tab = tab.getAttribute('data-cif-tab');
            S.editing = null; S.planning = null;
            render();
            if (S.tab === 'fleet' || S.tab === 'schedule') act(() => loadFleet());
            if (S.tab === 'use' && !S.use) act(() => loadUtilisation());
            if (S.tab === 'setup' && S.organizations === null) {
                act(async () => {
                    const d = await S.api('/if/organizations');
                    S.organizations = d.organizations || [];
                    await loadFleet();
                });
            }
            return;
        }

        const btn = ev.target.closest('[data-cif]');
        if (!btn) return;
        const what = btn.getAttribute('data-cif');
        const id = btn.getAttribute('data-id') || '';
        ev.preventDefault();

        if (what === 'connect') return startConnect();
        if (what === 'client-clear') {
            return act(async () => {
                applyStatus(await S.api('/if/client', { method: 'DELETE' }));
            }, { done: 'Client removed.' });
        }
        if (what === 'disconnect') {
            if (!window.confirm('Disconnect this crew center from Infinite Flight?')) return;
            return act(async () => {
                const out = await S.api('/if/connection', { method: 'DELETE' });
                applyStatus(out); S.fleet = null; S.schedules = null; S.organizations = null;
                S.aircraftId = '';
            }, { done: 'Disconnected.' });
        }
        if (what === 'fleet-refresh') return act(() => loadFleet({ force: true }));
        if (what === 'use-refresh') { S.use = null; return act(() => loadUtilisation()); }

        if (what === 'org-save') {
            const picked = panel.body.querySelector('input[name="cif-org"]:checked');
            if (!picked) return toast('Pick an organization first.', 'bad');
            return act(async () => {
                const out = await S.api('/if/organization', { method: 'POST', body: { organizationId: picked.value } });
                applyStatus(out);
                S.fleet = null; S.aircraftId = ''; S.schedules = null;
                await loadFleet({ force: true });
            }, { done: 'Organization set.' });
        }

        if (what === 'sync-save') {
            const ac = panel.body.querySelector('#cif-sync-ac');
            const on = panel.body.querySelector('#cif-sync-on');
            return act(async () => {
                const out = await S.api('/if/sync', {
                    method: 'POST',
                    body: { enabled: !!(on && on.checked), aircraftId: ac ? ac.value : '' },
                });
                applyStatus(out);
                // "On, but only for departures you've assigned an aircraft to"
                // is a real configuration and also what a half-finished one
                // looks like. The server says which; pass it on rather than
                // letting the VA discover it by publishing something.
                if (out.notice) toast(out.notice, 'bad');
            }, { done: 'Saved.' });
        }

        if (what === 'open-schedule') {
            S.tab = 'schedule';
            return act(() => loadSchedules(id, { force: true }));
        }

        if (what === 'leg-new') {
            S.editing = { flightType: 1 };
            return render();
        }
        if (what === 'leg-edit') {
            const leg = (S.schedules || []).find((s) => s.id === id);
            if (!leg) return;
            S.editing = { ...leg, flightType: leg.flightType ? leg.flightType.value : 1 };
            return render();
        }
        if (what === 'leg-plan') {
            S.planning = (S.schedules || []).find((s) => s.id === id) || null;
            return render();
        }
        if (what === 'cancel') {
            S.editing = null; S.planning = null;
            return render();
        }
        if (what === 'leg-delete') {
            const leg = (S.schedules || []).find((s) => s.id === id);
            const name = leg ? `${leg.callsign} ${leg.originIcao}–${leg.destinationIcao}` : 'this flight';
            if (!window.confirm(`Remove ${name} from this aircraft’s schedule in Infinite Flight?`)) return;
            return act(async () => {
                await S.api(`/if/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
                await loadSchedules(S.aircraftId, { force: true });
            }, { done: 'Removed.' });
        }

        if (what === 'move-top' || what === 'move-up' || what === 'move-down') {
            return reorder(id, what);
        }

        if (what === 'push') {
            if (!window.confirm('Push this crew center’s published upcoming departures onto this aircraft’s Infinite Flight schedule?')) return;
            return act(async () => {
                const out = await S.api('/if/push', { method: 'POST', body: { aircraftId: S.aircraftId } });
                await loadSchedules(S.aircraftId, { force: true });
                reportPush(out);
            });
        }
        if (what === 'pull') {
            if (!window.confirm('Import this aircraft’s Infinite Flight schedule into the crew center as draft departures?')) return;
            return act(async () => {
                const out = await S.api('/if/pull', { method: 'POST', body: { aircraftId: S.aircraftId } });
                await loadSchedules(S.aircraftId, { force: true });
                toast(`${out.imported} imported, ${out.updated} updated${out.skipped ? `, ${out.skipped} skipped` : ''}.`, 'ok');
                if (out.warning) toast(out.warning, 'bad');
            });
        }
    }

    /**
     * The result of a push, said honestly.
     *
     * Three separate numbers because they mean three separate things, and one of
     * them — `skipped` — is the one a VA has to act on: a crew departure with no
     * arrival time is fine here and is not something Infinite Flight will take.
     */
    function reportPush(out) {
        if (!out) return;
        const parts = [];
        if (out.pushed) parts.push(`${out.pushed} added`);
        if (out.updated) parts.push(`${out.updated} updated`);
        if (!parts.length) parts.push('nothing to send');
        toast(parts.join(', ') + '.', 'ok');
        if (out.skipped && out.skipped.length) {
            toast(`${out.skipped.length} couldn’t be sent — ${esc(out.skipped[0].reason || '')}`, 'bad');
        }
        if (out.failures && out.failures.length) {
            toast(`${out.failures.length} refused by Infinite Flight.`, 'bad');
        }
        if (out.warning) toast(out.warning, 'bad');
    }

    /**
     * Move one leg, by sending the whole arrangement.
     *
     * The list is reordered locally first and the WHOLE order is sent, rather
     * than one relative move: the backend turns an arrangement into the moves
     * the API takes, and stating the absolute intention means a lost call leaves
     * the rota closer to right rather than shuffled.
     */
    function reorder(id, direction) {
        const legs = (S.schedules || []).slice();
        const from = legs.findIndex((s) => s.id === id);
        if (from < 0) return null;
        const to = direction === 'move-top' ? 0 : direction === 'move-up' ? from - 1 : from + 1;
        if (to < 0 || to >= legs.length) return null;
        legs.splice(to, 0, legs.splice(from, 1)[0]);
        return act(async () => {
            const out = await S.api(`/if/aircraft/${encodeURIComponent(S.aircraftId)}/schedules/order`, {
                method: 'POST', body: { ids: legs.map((s) => s.id) },
            });
            // Painted from what the server says the order now is, not from what
            // we hoped it would be.
            S.schedules = out.schedules || S.schedules;
            if (out.failures && out.failures.length) {
                toast(`${out.failures.length} of ${out.planned} moves were refused.`, 'bad');
            }
        });
    }

    function onSubmit(ev) {
        const form = ev.target.closest('[data-cif-form]');
        if (!form) return;
        ev.preventDefault();
        const kind = form.getAttribute('data-cif-form');
        const data = Object.fromEntries(new FormData(form).entries());

        if (kind === 'client') {
            return act(async () => {
                const body = { clientId: String(data.clientId || '').trim() };
                // An untouched secret field must not blank a saved secret, so it
                // is only sent when something was typed.
                if (String(data.clientSecret || '')) body.clientSecret = String(data.clientSecret);
                const out = await S.api('/if/client', { method: 'POST', body });
                applyStatus(out);
                if (out.warning) toast(out.warning, 'bad');
                if (out.notice) toast(out.notice, 'bad');
            }, { done: 'Client saved.' });
        }

        if (kind === 'leg') {
            const body = {
                callsign: data.callsign,
                flightType: Number(data.flightType),
                originIcao: String(data.originIcao || '').toUpperCase(),
                destinationIcao: String(data.destinationIcao || '').toUpperCase(),
                scheduledDepartureUtc: fromLocalInput(data.scheduledDepartureUtc),
                scheduledArrivalUtc: fromLocalInput(data.scheduledArrivalUtc),
                briefing: data.briefing || null,
                flightPlan: data.flightPlan || null,
            };
            const editingId = S.editing && S.editing.id;
            return act(async () => {
                if (editingId) {
                    await S.api(`/if/schedules/${encodeURIComponent(editingId)}`, { method: 'PUT', body });
                } else {
                    await S.api(`/if/aircraft/${encodeURIComponent(S.aircraftId)}/schedules`, { method: 'POST', body });
                }
                S.editing = null;
                await loadSchedules(S.aircraftId, { force: true });
            }, { done: editingId ? 'Saved.' : 'Flight added.' });
        }

        if (kind === 'plan') {
            const scheduleId = S.planning && S.planning.id;
            return act(async () => {
                await S.api(`/if/schedules/${encodeURIComponent(scheduleId)}/flightplan`, {
                    method: 'PUT', body: { flightPlan: data.flightPlan || null },
                });
                S.planning = null;
                await loadSchedules(S.aircraftId, { force: true });
            }, { done: 'Flight plan saved.' });
        }
        return null;
    }

    function onChange(ev) {
        const pick = ev.target.closest('[data-cif-pick="aircraft"]');
        if (!pick) return;
        const id = pick.value;
        if (!id) { S.aircraftId = ''; S.schedules = null; return render(); }
        return act(() => loadSchedules(id, { force: true }));
    }

    /**
     * Send the owner off to Infinite Flight.
     *
     * A full navigation rather than a popup: a popup is blocked as often as not
     * when it follows an await, and the flow comes back to a URL on our own site
     * which this module picks up on load (see `noteReturn`).
     */
    function startConnect() {
        const readOnly = !!panel.body.querySelector('[data-cif-opt="readOnly"]:checked');
        const forceConsent = !!panel.body.querySelector('[data-cif-opt="forceConsent"]:checked');
        return act(async () => {
            const out = await S.api('/if/connect', { method: 'POST', body: { readOnly, forceConsent } });
            if (out && out.url) window.location.href = out.url;
        });
    }

    /**
     * Did we just come back from Infinite Flight?
     *
     * The backend's callback redirects here with ?if=connected or ?if=failed.
     * Read once, said out loud, and then removed from the address bar — a
     * reload that re-announced "connected" would be claiming something happened
     * that did not.
     */
    function noteReturn() {
        let params;
        try { params = new URLSearchParams(location.search); } catch { return false; }
        const result = params.get('if');
        if (!result) return false;
        const org = params.get('org') || '';
        const reason = params.get('reason') || '';
        if (result === 'connected') {
            toast(org ? `Connected to ${org}.` : 'Connected to Infinite Flight.', 'ok');
        } else {
            const why = {
                denied: 'You didn’t approve the request.',
                expired: 'That sign-in took too long — try again.',
                client_changed: 'The OAuth client changed while you were signing in. Try again.',
                exchange: 'Infinite Flight refused the sign-in.',
                state: 'That sign-in couldn’t be verified.',
            }[reason] || 'The Infinite Flight sign-in didn’t complete.';
            toast(why, 'bad');
        }
        params.delete('if'); params.delete('org'); params.delete('reason');
        const rest = params.toString();
        try {
            history.replaceState({}, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
        } catch { /* a browser that will not rewrite the URL is not worth failing over */ }
        return result === 'connected';
    }

    /* =====================================================================
     * The in-page board
     *
     * The fleet, painted straight into a host element — for the dashboard, and
     * for the pilot page where there is no panel at all. Reads /if/board, which
     * is the pilot-safe view: no fleet priorities, no connection state, no
     * controls, and nothing at all when the VA has not connected one.
     * ================================================================== */

    const boardHosts = new Map();
    let boardData = null;
    let boardLoaded = false;

    async function loadBoard() {
        try {
            boardData = await S.api('/if/board');
        } catch {
            // A pilot cannot fix a broken connection, so a failure here is
            // "there is no board", not an error over the rest of their page.
            boardData = { connected: false };
        }
        boardLoaded = true;
        paintBoards();
        // The pilot board never loads the staff fleet, so its green dots have to
        // be asked for from here as well. Fire and forget, like the other one.
        if (boardData && boardData.connected) loadLive(boardData.aircraft);
        return boardData;
    }

    function paintBoards() {
        for (const [el, opts] of boardHosts) paintBoard(el, opts);
    }

    /**
     * Paint one in-page board.
     *
     * Same reasoning as render(), with one difference that matters: this host
     * belongs to somebody else's page — the dashboard's Manage section, the
     * pilot page's Fleet section — and it is painted during THEIR boot. An
     * exception escaping here does not just blank a board, it aborts whatever
     * ran after it in the host's init. So it fails to an empty host, which the
     * host already treats as "nothing to show" and hides.
     */
    function paintBoard(el, opts) {
        try {
            paintBoardInner(el, opts || {});
        } catch (err) {
            console.error('crewInfiniteFlight: board render failed —', err);
            try { el.innerHTML = ''; } catch { /* nothing further to do */ }
        }
    }

    function paintBoardInner(el, { limit = 0, departures = true } = {}) {
        // Nothing until the fetch lands. An empty board that fills in a moment
        // later reads as "this VA has no aircraft", which is the invented-data
        // failure the rest of this crew center was rewritten to remove.
        if (!boardLoaded) { el.innerHTML = ''; return; }
        const d = boardData;
        if (!d || !d.connected) { el.innerHTML = ''; return; }
        const all = d.aircraft || [];
        const list = limit ? all.slice(0, limit) : all;
        if (!list.length) { el.innerHTML = ''; return; }

        const s = d.summary || {};
        const next = departures ? (d.departures || []).slice(0, 4) : [];
        el.innerHTML = `
        <div class="cif-board">
            <div class="cif-row-top">
                <div class="cif-reg">${esc(d.organization ? d.organization.name : 'Fleet')}</div>
                <span class="cp-note cp-faint">${esc(String(s.airborne || 0))} of ${esc(String(s.total || all.length))} flying</span>
            </div>
            <div class="cif-board-grid">
                ${list.map(boardTile).join('')}
            </div>
            ${all.length > list.length ? `<p class="cp-note cp-faint">and ${all.length - list.length} more</p>` : ''}
            ${next.length ? `<div style="display:grid;gap:.35rem">
                ${next.map((n) => `<div class="cp-note">
                    <b style="color:var(--ink,#1C1A16)">${esc(n.callsign || '')}</b>
                    ${esc(n.originIcao || '?')} → ${esc(n.destinationIcao || '?')}
                    · ${esc(n.registration || '')}
                    · ${esc(timeText(n.scheduledDepartureUtc))}Z
                    ${chip(enumLabel(n.status), statusTone(n.status))}
                </div>`).join('')}
            </div>` : ''}
        </div>`;
        try { icons(); } catch { /* ignore */ }
        try {
            if (window.CrewAircraftImage) window.CrewAircraftImage.upgrade(el);
        } catch { /* photographs are decoration */ }
    }

    function boardTile(a) {
        const live = S.live[a.id];
        const p = a.position;
        const dot = live || (p && p.state && p.state.name === 'InFlight' && !p.stale) ? 'air'
            : (p && p.hasFix && !p.stale) ? 'gnd' : 'off';
        return `<div class="cif-tile">
            ${picture(a)}
            <b>${esc(a.registration || 'Unregistered')}</b>
            <small><span class="cif-dot cif-dot-${dot}"></span>
                ${live ? esc(live.callsign || 'Flying now')
                    : p && p.hasFix ? esc(enumLabel(p.state) || 'Last seen')
                    : 'No position'}</small>
            ${p && p.hasFix && p.updatedAt ? `<small class="cp-faint">${esc(relativeText(p.updatedAt))}</small>` : ''}
        </div>`;
    }

    /* =====================================================================
     * Public API
     * ================================================================== */

    /**
     * @param liveBase   where the live-traffic service is, for the "flying now"
     *                   cross-reference. Optional — without it the board simply
     *                   never shows a green dot, which is a board.
     * @param boardOnly  mount for a PILOT: the read-only board and nothing else.
     *
     * boardOnly exists because the two audiences here are genuinely different,
     * not because the panel needs hiding. Setting up the fleet — connecting the
     * account, picking the organization, building an aircraft's rota — is staff
     * work, and the endpoints behind it refuse a pilot's session anyway. Without
     * this flag a pilot page would still ASK (`GET /if`), collect a 403 in every
     * pilot's console on every load, and learn nothing it could use. So the
     * pilot mount skips straight to the one endpoint that is theirs to read.
     */
    function mount({ backend, slug, token, liveBase, boardOnly = false }) {
        injectStyles();
        S.api = P.api({ backend, slug, token });
        S.slug = String(slug || '').toLowerCase();
        S.liveBase = String(liveBase || '').replace(/\/+$/, '');
        S.boardOnly = !!boardOnly;
        if (!S.slug) return Promise.resolve(null);
        if (S.boardOnly) {
            // No status fetch, and open() is a no-op from here on — a pilot page
            // that somehow called it would otherwise get an empty staff panel.
            S.loaded = true;
            return Promise.resolve(null);
        }
        const returned = noteReturn();
        // Coming back from a successful connect: open the panel on the
        // organization picker, because that is the next thing to do and making
        // somebody find it again is a step for nothing.
        return load({ quiet: true }).then((st) => {
            if (returned && st && st.connected && !st.organization) {
                S.tab = 'setup';
                open();
            }
            return st;
        });
    }

    function open() {
        // The staff panel is staff-only by capability on the server; this is the
        // matching refusal on the page, so a pilot-mounted module has no route
        // into it at all rather than one that opens and then 403s.
        if (S.boardOnly) return;
        ensurePanel();
        panel.open();
        render();
        if (!S.loaded) { load(); return; }
        if (S.status && S.status.connected) {
            if (S.tab === 'setup' && S.organizations === null) {
                act(async () => {
                    const d = await S.api('/if/organizations');
                    S.organizations = d.organizations || [];
                    await loadFleet();
                });
            } else {
                act(() => loadFleet());
            }
        }
    }

    /** Paint the fleet into a host element, and keep it painted. */
    function renderBoard(el, opts = {}) {
        if (!el) return;
        injectStyles();
        boardHosts.set(el, opts);
        if (!boardLoaded) loadBoard(); else paintBoard(el, opts);
    }

    window.CrewIF = {
        mount, open, renderBoard,
        close: () => panel && panel.close(),
        reload: () => load(),
        reloadBoard: () => loadBoard(),
        get connected() { return !!(S.status && S.status.connected); },
        get status() { return S.status ? { ...S.status } : null; },
    };
})();
