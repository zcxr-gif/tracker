/* ============================================================================
   crewLiveOps.js — the airline Infinite Flight holds, inside the crew center.

   WHAT THIS IS FOR

   Every other panel in this product draws the airline the VA INVENTED: routes
   somebody typed, a schedule somebody published, a roster somebody added pilots
   to. None of it exists inside Infinite Flight. A VA that also runs a real Live
   organization — with airframes registered to it, and schedules sitting on each
   one — has been keeping two airlines in step by hand, in two tabs.

   This is the second tab, brought inside. It shows the organization's real
   fleet, where each aeroplane last was, and the schedules Infinite Flight is
   actually holding against it — and, for staff the VA has trusted with it,
   edits those schedules in place.

   WHOSE ACCESS THIS IS, AND WHY THE BUTTONS COME AND GO

   Nothing here is reached with our platform API key. It rides on ONE Infinite
   Flight account that the VA's owner connected once, and there are therefore
   two independent questions behind every control:

     · may THIS PERSON write?   the crew center's own `live.manage` capability,
                                answered by the backend as `canManage`.
     · may THE CONNECTION write? whether Infinite Flight granted
                                `live:schedules.write` when the account was
                                connected, answered as `canWrite`.

   An editor is offered only when both are true, and when only one is the panel
   says WHICH — because "you don't have permission" and "the connected account
   isn't an admin of that organization" send somebody to two different people.

   PREVIEW API, DRAWN DEFENSIVELY

   PublicApi v3 is explicitly under development. Every enum arrives decoded by
   the backend as { value, name, label }, an unrecognised one arrives as
   "Unknown (13)", and this file renders the label it is given rather than
   switching on numbers. A status Infinite Flight adds next month shows up as a
   grey chip with an honest name instead of a blank cell or a crash.

   WHAT IT NEVER DOES

   Draw a position as current without saying how old it is. The API is clear
   that this is the last PERSISTED state and can be stale — an airframe parked
   three days ago still reports coordinates. A board that painted that as "in
   flight" would be lying, so age is on every row and a stale one is dimmed.

   Nor invent an order. Reordering re-reads the list from the API rather than
   assuming the drag took, because only Scheduled and InFlight rows are moved
   upstream and a sequence that disagrees with the server is the one thing a
   sequence must never be.

   WHAT IT NEEDS FROM ITS HOST

       CrewLiveOps.mount({ backend: BACKEND, slug: getSlug(), token: sessionToken });
       CrewLiveOps.consumeCallback();          // once, on boot
       CrewLiveOps.open();                     // from a button

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewLiveOps: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText, timeText, durationText } = P;

    /* ---------------------------------------------------------------------
     * State
     *
     * `view` is the whole navigation model: a fleet list, or one aircraft's
     * schedules. Two screens rather than a tree, because that is the actual
     * shape of the data — an organization has aircraft, an aircraft has a
     * schedule list, and there is nothing below that to drill into.
     * ------------------------------------------------------------------- */
    const S = {
        api: null,
        slug: '',
        status: null,          // the connection, as the backend reports it
        organizations: [],
        orgId: '',
        fleet: [],             // [{ ...aircraft, position }]
        truncated: false,
        total: 0,
        aircraft: null,        // the airframe whose schedules are open
        schedules: [],
        view: 'fleet',         // 'fleet' | 'schedules'
        loading: false,
        error: null,
        busy: '',              // id of the row a request is in flight for
    };

    let panel = null;
    let editorOpen = false;

    /** Both halves of "may this be edited?", asked together because they always are. */
    const canEdit = () => !!(S.status && S.status.canManage && S.status.canWrite);

    /* ---------------------------------------------------------------------
     * Formatting
     * ------------------------------------------------------------------- */

    /** An enum as the backend decoded it. Never a bare number. */
    const enumLabel = (e) => (e && (e.label || e.name)) || '';

    /**
     * Which colour a schedule status is.
     *
     * Keyed on the enum NAME rather than its number: the numbers are documented
     * as changeable and the names are what the documentation calls them, so a
     * renumbering upstream leaves this working. Anything unrecognised falls
     * through to a neutral chip, which is the right answer for a state we have
     * never heard of.
     */
    function statusTone(name) {
        switch (name) {
            case 'InFlight': case 'TaxiingToRunway': case 'TaxiingToParking': return 'accent';
            case 'Arrived': return 'ok';
            case 'Boarding': case 'Boarded': case 'Delayed': return 'warn';
            case 'Cancelled': case 'Diverted': return 'bad';
            default: return 'mute';
        }
    }

    function stateTone(name) {
        switch (name) {
            case 'InFlight': return 'accent';
            case 'OnGround': return 'ok';
            case 'Maintenance': case 'Stopped': return 'warn';
            case 'Cancelled': return 'bad';
            default: return 'mute';
        }
    }

    /** "27.317, 48.679" — six decimals is centimetres, which nobody needs. */
    const coords = (p) => (p && p.latitude != null && p.longitude != null)
        ? `${Number(p.latitude).toFixed(3)}, ${Number(p.longitude).toFixed(3)}`
        : '';

    const feet = (v) => (v == null ? '' : `${Math.round(Number(v)).toLocaleString()} ft`);
    const knots = (v) => (v == null ? '' : `${Math.round(Number(v))} kt`);

    /**
     * An ISO instant as a UTC clock, for a board whose whole subject is UTC.
     *
     * Deliberately NOT the local-time helpers CrewPanels provides and every
     * other panel uses. Those are right there and wrong here: a schedule in
     * Infinite Flight is stored, displayed and flown in Z, and quietly showing
     * a VA their departure in Melbourne time — next to fields they will type Z
     * into — is how a leg goes out eleven hours wrong. Everything on this
     * screen is labelled Z and is Z.
     */
    function utcText(iso, { withDate = true } = {}) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const s = d.toISOString();
        const clock = `${s.slice(11, 16)}Z`;
        if (!withDate) return clock;
        return `${s.slice(8, 10)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${clock}`;
    }

    /** ISO instant → the value a <input type="datetime-local"> wants, in UTC. */
    const toUtcInput = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16);
    };

    /**
     * The reverse, and the reason the fields say Z.
     *
     * A datetime-local input has no timezone, and the browser's instinct is to
     * mean local. We append the Z explicitly so what somebody typed next to a
     * "UTC" label is the instant that gets stored. Read this and toUtcInput as
     * a pair — changing one without the other silently shifts every schedule.
     */
    const fromUtcInput = (v) => {
        const s = String(v || '').trim();
        if (!s) return '';
        const d = new Date(`${s.length === 16 ? `${s}:00` : s}Z`);
        return Number.isNaN(d.getTime()) ? '' : d.toISOString();
    };

    /* ---------------------------------------------------------------------
     * Loading
     * ------------------------------------------------------------------- */

    async function loadStatus() {
        if (!S.api) return null;
        try {
            S.status = await S.api('/if/status');
            S.error = null;
            if (!S.orgId) S.orgId = S.status.organizationId || '';
        } catch (err) {
            S.status = null;
            S.error = err;
        }
        return S.status;
    }

    async function loadOrganizations() {
        const data = await S.api('/if/organizations');
        S.organizations = data.organizations || [];
        // Nothing chosen and exactly one to choose from is not a choice. The
        // backend already picks it at connect time; this covers a VA whose
        // second organization was removed after they connected.
        if (!S.orgId && S.organizations.length === 1) S.orgId = S.organizations[0].id;
        if (S.orgId && !S.organizations.some((o) => o.id === S.orgId)) S.orgId = '';
        return S.organizations;
    }

    async function loadFleet() {
        if (!S.orgId) { S.fleet = []; return; }
        const data = await S.api(`/if/organizations/${encodeURIComponent(S.orgId)}/fleet`);
        S.fleet = data.fleet || [];
        S.truncated = !!data.truncated;
        S.total = Number(data.total) || S.fleet.length;
    }

    async function loadSchedules(aircraftId) {
        const data = await S.api(`/if/aircraft/${encodeURIComponent(aircraftId)}/schedules`);
        S.schedules = data.schedules || [];
    }

    /**
     * Reload whatever the panel is currently showing.
     *
     * One entry point rather than a refresh per screen, so every write path ends
     * the same way and no screen can be left holding a list the server has since
     * changed under it.
     */
    async function refresh() {
        if (!S.api) return;
        S.loading = true;
        render();
        try {
            await loadStatus();
            if (S.status && S.status.connected && !S.status.failed) {
                await loadOrganizations();
                if (S.view === 'schedules' && S.aircraft) await loadSchedules(S.aircraft.id);
                else await loadFleet();
            }
            S.error = null;
        } catch (err) {
            S.error = err;
        } finally {
            S.loading = false;
            render();
        }
    }

    /* ---------------------------------------------------------------------
     * Rendering
     * ------------------------------------------------------------------- */

    function render() {
        if (!panel || !panel.isOpen()) return;
        panel.body.innerHTML = bodyHtml();
        icons();
    }

    function bodyHtml() {
        if (S.loading && !S.status) return spinner('Reading the connection…');
        if (S.error && !S.status) return errorHtml(S.error);
        if (!S.status) return spinner('Reading the connection…');
        if (!S.status.available) return unavailableHtml();
        if (!S.status.connected) return disconnectedHtml();
        if (S.status.failed) return brokenHtml();

        return [
            connectionStrip(),
            S.error ? errorHtml(S.error) : '',
            S.loading ? spinner('Loading…') : (S.view === 'schedules' ? schedulesHtml() : fleetHtml()),
        ].filter(Boolean).join('');
    }

    const spinner = (msg) => `<div class="cp-empty"><i data-lucide="loader"></i>${esc(msg)}</div>`;

    function errorHtml(err) {
        const code = (err && err.code) || '';
        // The two upstream refusals worth a sentence of their own, because both
        // have a specific fix and neither is "try again".
        const hint = code === 'if_reconnect_required' || code === 'if_unauthorized'
            ? 'The owner can reconnect the account below.'
            : code === 'if_forbidden'
                ? 'This is Infinite Flight’s answer, not ours — the connected account may not have the role this needs.'
                : code === 'if_rate_limited'
                    ? 'Infinite Flight limits how often we may ask. Give it a moment.'
                    : '';
        return `<div class="cp-card clo-error">
            <p class="cp-note cp-note-bad">${esc((err && err.message) || 'That didn’t work.')}</p>
            ${hint ? `<p class="cp-note" style="margin-top:.35rem">${esc(hint)}</p>` : ''}
            <div style="margin-top:.8rem"><button class="cp-btn cp-btn-sm" data-clo-refresh>Try again</button></div>
        </div>`;
    }

    /** This deployment has no OAuth client, or nowhere safe to keep the tokens. */
    function unavailableHtml() {
        return `<div class="cp-empty">
            <i data-lucide="plug-zap"></i>
            Infinite Flight Live ops isn’t switched on for this installation.
            ${S.status.unavailableReason ? `<p class="cp-note" style="margin-top:.6rem">${esc(S.status.unavailableReason)}</p>` : ''}
        </div>`;
    }

    function disconnectedHtml() {
        // All of them are requested in one go, so the consent screen is seen
        // once — but the editing one is marked, because a user may approve the
        // reads and decline it, and this is where they find out that the board
        // will still work if they do.
        const scopes = (S.status.scopeCatalog || [])
            .map((s) => `<li>${esc(s.label)}${s.required === false ? ' <span class="cp-faint">— optional</span>' : ''}</li>`)
            .join('');
        return `<div class="cp-card">
            <h3 class="cp-card-title">Connect your Infinite Flight account</h3>
            <p class="cp-note" style="margin-top:.5rem">
                Your crew center can read the Live organization you belong to — its aircraft, where each one
                last was, and the schedules on them — and, if you allow it, edit those schedules from here.
            </p>
            <p class="cp-note" style="margin-top:.5rem">
                This uses one account for the whole crew center. What it may do inside Infinite Flight is
                decided by Infinite Flight: reading needs organization membership, and editing schedules needs
                the connected account to be an owner or admin of the organization.
            </p>
            <ul class="clo-scopes">${scopes}</ul>
            ${S.status.canConnect
                ? `<div style="margin-top:.9rem"><button class="cp-btn cp-btn-primary" data-clo-connect>
                       <i data-lucide="link"></i> Connect Infinite Flight</button></div>
                   <p class="cp-note cp-faint" style="margin-top:.5rem">
                       You’ll sign in at Infinite Flight and approve the list above. You can disconnect at any time.</p>`
                : `<p class="cp-note cp-note-warn" style="margin-top:.9rem">
                       Only the crew center’s owner can connect an Infinite Flight account.</p>`}
        </div>`;
    }

    /** Connected once, and Infinite Flight has since refused it. */
    function brokenHtml() {
        return `<div class="cp-card">
            <h3 class="cp-card-title">This connection has stopped working</h3>
            <p class="cp-note cp-note-bad" style="margin-top:.5rem">${esc(S.status.error || 'Infinite Flight refused the stored connection.')}</p>
            <p class="cp-note" style="margin-top:.5rem">
                It was connected ${esc(relativeText(S.status.connectedAt))}${S.status.connectedBy ? ` by ${esc(S.status.connectedBy)}` : ''}.
                Reconnecting asks Infinite Flight for a fresh authorization.
            </p>
            ${S.status.canConnect
                ? `<div style="margin-top:.9rem" class="clo-actions">
                       <button class="cp-btn cp-btn-primary" data-clo-connect><i data-lucide="refresh-cw"></i> Reconnect</button>
                       <button class="cp-btn cp-btn-bad" data-clo-disconnect>Disconnect</button>
                   </div>`
                : '<p class="cp-note cp-note-warn" style="margin-top:.9rem">The crew center’s owner can reconnect it.</p>'}
        </div>`;
    }

    /**
     * The strip above every connected screen: whose account, which organization,
     * and what this connection is allowed to do.
     *
     * The read-only warning is stated once, here, rather than repeated on every
     * row that lacks a button — and it names which of the two gates is shut.
     */
    function connectionStrip() {
        const orgs = S.organizations;
        const picker = orgs.length > 1
            ? `<select class="cp-select clo-org" data-clo-org>
                   ${orgs.map((o) => `<option value="${esc(o.id)}"${o.id === S.orgId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}
               </select>`
            : `<span class="clo-orgname">${esc((orgs[0] && orgs[0].name) || S.status.organizationName || 'No organization')}</span>`;

        const why = !S.status.canWrite
            ? 'This connection is read-only — schedule editing wasn’t granted when the account was connected.'
            : (!S.status.canManage ? 'You can look, but editing Live schedules isn’t part of your role here.' : '');

        return `<div class="cp-card clo-strip">
            <div class="clo-strip-row">
                <div class="clo-strip-who">
                    <i data-lucide="badge-check"></i>
                    <span>Connected${S.status.username ? ` as <strong>${esc(S.status.username)}</strong>` : ''}</span>
                </div>
                <div class="clo-strip-actions">
                    <button class="cp-icon-btn" data-clo-refresh title="Refresh"><i data-lucide="refresh-cw"></i></button>
                    ${S.status.canConnect ? '<button class="cp-btn cp-btn-sm cp-btn-bad" data-clo-disconnect>Disconnect</button>' : ''}
                </div>
            </div>
            <div class="clo-strip-row">
                <label class="cp-label" style="margin:0">Organization</label>
                ${picker}
            </div>
            ${why ? `<p class="cp-note cp-note-warn" style="margin-top:.5rem">${esc(why)}</p>` : ''}
        </div>`;
    }

    /* ---- Fleet ---------------------------------------------------------- */

    function fleetHtml() {
        if (!S.orgId) {
            return `<div class="cp-empty"><i data-lucide="building-2"></i>
                Pick the organization this crew center flies for.</div>`;
        }
        if (!S.fleet.length) {
            return `<div class="cp-empty"><i data-lucide="plane"></i>
                This organization has no aircraft yet.</div>`;
        }
        return `
            <div class="clo-list">${S.fleet.map(aircraftCard).join('')}</div>
            ${S.truncated
                ? `<p class="cp-note cp-faint" style="margin-top:.6rem">Showing the first ${S.fleet.length} of ${S.total} aircraft.</p>`
                : ''}`;
    }

    function aircraftCard(a) {
        const p = a.position;
        const chips = [
            a.visibility && a.visibility.name === 'Hangared' ? '<span class="cp-chip">Hangared</span>' : '',
            a.inStorage ? '<span class="cp-chip cp-chip-mute">Storage</span>' : '',
            p && p.state && p.state.name && p.state.name !== 'Unknown'
                ? `<span class="cp-chip cp-chip-${stateTone(p.state.name)}">${esc(enumLabel(p.state))}</span>` : '',
        ].filter(Boolean).join('');

        // A position with no coordinates is not a position. Rendered as the
        // sentence it is, rather than as "0.000, 0.000" off the Gulf of Guinea.
        const where = p && coords(p)
            ? `<div class="clo-pos${p.stale ? ' clo-stale' : ''}">
                   <span class="cp-fact"><i data-lucide="map-pin"></i> ${esc(coords(p))}</span>
                   ${p.isOnGround ? '<span class="cp-fact"><i data-lucide="anchor"></i> On the ground</span>'
                       : `<span class="cp-fact"><i data-lucide="gauge"></i> ${esc(feet(p.altitude))} · ${esc(knots(p.speed))}</span>`}
                   <span class="cp-fact"><i data-lucide="clock"></i> ${esc(relativeText(p.updatedAt))}${p.stale ? ' · stale' : ''}</span>
                   ${p.lastPilotUsername ? `<span class="cp-fact"><i data-lucide="user"></i> ${esc(p.lastPilotUsername)}</span>` : ''}
               </div>`
            : '<div class="clo-pos cp-faint"><span class="cp-fact">Infinite Flight has no stored position for this airframe.</span></div>';

        return `<article class="cp-card clo-ac" data-clo-aircraft="${esc(a.id)}" role="button" tabindex="0">
            <div class="clo-ac-head">
                <h3 class="cp-card-title">${esc(a.registration || 'Unregistered')}</h3>
                <div class="clo-chips">${chips}</div>
            </div>
            ${where}
            <div class="clo-ac-foot">
                <span class="cp-fact"><i data-lucide="list-ordered"></i> Fleet rank ${esc(String(a.fleetRank == null ? '—' : a.fleetRank))}</span>
                <span class="cp-fact clo-go"><i data-lucide="calendar-clock"></i> Schedules</span>
            </div>
        </article>`;
    }

    /* ---- Schedules ------------------------------------------------------ */

    /**
     * Which rows may be moved.
     *
     * Only Scheduled and InFlight are reordered upstream, so the arrows are
     * drawn against THIS list rather than the full one — otherwise "move up"
     * past a cancelled row would send a request the API quietly ignores, and the
     * board would appear to have lost the click.
     */
    const movableRows = () => S.schedules.filter((s) => s.status
        && (s.status.name === 'Scheduled' || s.status.name === 'InFlight'));

    function schedulesHtml() {
        const a = S.aircraft || {};
        const editable = canEdit();
        const rows = S.schedules.length
            ? S.schedules.map(scheduleRow).join('')
            : `<div class="cp-empty"><i data-lucide="calendar-off"></i>
                   Nothing scheduled on ${esc(a.registration || 'this airframe')}.</div>`;

        return `
            <div class="clo-subhead">
                <button class="cp-btn cp-btn-sm" data-clo-back><i data-lucide="arrow-left"></i> Fleet</button>
                <div class="clo-subhead-title">
                    <strong>${esc(a.registration || 'Aircraft')}</strong>
                    <span class="cp-sub">${S.schedules.length} scheduled flight${S.schedules.length === 1 ? '' : 's'} · all times UTC</span>
                </div>
                ${editable ? '<button class="cp-btn cp-btn-primary cp-btn-sm" data-clo-add><i data-lucide="plus"></i> Add flight</button>' : ''}
            </div>
            <div class="clo-list">${rows}</div>`;
    }

    function scheduleRow(s, i) {
        const editable = canEdit();
        const movable = movableRows();
        const at = movable.findIndex((m) => m.id === s.id);
        const busy = S.busy === s.id;

        const times = [
            s.scheduledDepartureUtc ? `${esc(s.originIcao || '???')} ${esc(utcText(s.scheduledDepartureUtc))}` : esc(s.originIcao || '???'),
            s.scheduledArrivalUtc ? `${esc(s.destinationIcao || '???')} ${esc(utcText(s.scheduledArrivalUtc))}` : esc(s.destinationIcao || '???'),
        ].join(' <i data-lucide="arrow-right"></i> ');

        const actions = editable ? `
            <div class="clo-row-actions">
                ${at > 0 ? '<button class="cp-btn cp-btn-sm" data-clo-up="' + esc(s.id) + '" title="Move up"><i data-lucide="chevron-up"></i></button>' : ''}
                ${at >= 0 && at < movable.length - 1 ? '<button class="cp-btn cp-btn-sm" data-clo-down="' + esc(s.id) + '" title="Move down"><i data-lucide="chevron-down"></i></button>' : ''}
                <button class="cp-btn cp-btn-sm" data-clo-edit="${esc(s.id)}"><i data-lucide="pencil"></i> Edit</button>
                <button class="cp-btn cp-btn-sm" data-clo-fp="${esc(s.id)}"><i data-lucide="route"></i> Flight plan</button>
                <button class="cp-btn cp-btn-sm cp-btn-bad" data-clo-delete="${esc(s.id)}"><i data-lucide="trash-2"></i></button>
            </div>` : '';

        return `<article class="cp-card clo-row${busy ? ' clo-busy' : ''}">
            <div class="clo-row-head">
                <div class="clo-row-title">
                    <span class="clo-seq">${esc(String(i + 1))}</span>
                    <strong>${esc(s.callsign || '—')}</strong>
                    <span class="cp-chip cp-chip-${statusTone(s.status && s.status.name)}">${esc(enumLabel(s.status) || 'Unknown')}</span>
                </div>
                ${s.flightType && s.flightType.value ? `<span class="cp-chip">${esc(enumLabel(s.flightType))}</span>` : ''}
            </div>
            <p class="clo-leg">${times}</p>
            <div class="cp-facts clo-row-facts">
                ${s.blockMinutes ? `<span class="cp-fact"><i data-lucide="timer"></i> ${esc(durationText(s.blockMinutes))}</span>` : ''}
                ${s.actualDepartureUtc ? `<span class="cp-fact"><i data-lucide="plane-takeoff"></i> Off ${esc(utcText(s.actualDepartureUtc, { withDate: false }))}</span>` : ''}
                ${s.actualArrivalUtc ? `<span class="cp-fact"><i data-lucide="plane-landing"></i> On ${esc(utcText(s.actualArrivalUtc, { withDate: false }))}</span>` : ''}
                ${s.flightPlan ? '<span class="cp-fact"><i data-lucide="route"></i> Flight plan set</span>' : ''}
            </div>
            ${s.briefing ? `<p class="clo-brief">${esc(s.briefing)}</p>` : ''}
            ${actions}
        </article>`;
    }

    /* ---------------------------------------------------------------------
     * Writes
     *
     * Each of these does the same three things and it matters that they all do:
     * mark the row busy so a double press cannot fire twice, re-read from the
     * API rather than patching the local list, and report the server's own
     * message on failure. The API is the only thing that knows what happened.
     * ------------------------------------------------------------------- */

    async function withBusy(id, run, okMessage) {
        if (S.busy) return;
        S.busy = id || 'panel';
        render();
        try {
            await run();
            if (okMessage) P.toast(okMessage, 'ok');
        } catch (err) {
            P.toast((err && err.message) || 'That didn’t work.', 'bad');
        } finally {
            S.busy = '';
            // Re-read rather than patch. Every write here can move rows the
            // caller did not touch — a reorder renumbers the list, a delete
            // closes a gap — and the API's copy is the only one that is right.
            if (S.aircraft) {
                try { await loadSchedules(S.aircraft.id); } catch { /* the toast already said */ }
            }
            render();
        }
    }

    const reorder = (scheduleId, afterId) => withBusy(scheduleId, () => S.api(
        `/if/aircraft/${encodeURIComponent(S.aircraft.id)}/schedules/reorder`,
        { method: 'PUT', body: { scheduleId, afterId } },
    ), 'Order saved.');

    function moveUp(id) {
        const movable = movableRows();
        const at = movable.findIndex((m) => m.id === id);
        if (at <= 0) return;
        // One step up is "place me after the row two above" — and at the second
        // position that row does not exist, which is the null the API reads as
        // "put it on top".
        reorder(id, at === 1 ? null : movable[at - 2].id);
    }

    function moveDown(id) {
        const movable = movableRows();
        const at = movable.findIndex((m) => m.id === id);
        if (at < 0 || at >= movable.length - 1) return;
        reorder(id, movable[at + 1].id);
    }

    function removeSchedule(id) {
        const s = S.schedules.find((x) => x.id === id);
        const what = s ? `${s.callsign || 'this flight'} ${s.originIcao || ''}–${s.destinationIcao || ''}`.trim() : 'this flight';
        // Deleting writes into the VA's real organization and everyone in it
        // sees the result, so it asks — the same rule the events panel follows
        // for anything a pilot has already been told about.
        if (!window.confirm(`Remove ${what} from Infinite Flight? This cannot be undone.`)) return;
        withBusy(id, () => S.api(`/if/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }), 'Flight removed.');
    }

    /* ---- The editor ----------------------------------------------------- */

    function openEditor(existing) {
        if (editorOpen) return;
        editorOpen = true;
        const isNew = !existing;
        const s = existing || {};
        const types = (S.status && S.status.flightTypes) || [];
        const currentType = (s.flightType && s.flightType.value) != null ? s.flightType.value : 1;

        const modal = dialog(isNew ? `Add a flight to ${S.aircraft.registration || 'this airframe'}` : 'Edit flight', `
            <form class="clo-form" data-clo-form>
                <div>
                    <label class="cp-label" for="cloCallsign">Callsign</label>
                    <input id="cloCallsign" class="cp-input" name="callsign" maxlength="32" required
                        value="${esc(s.callsign || '')}" placeholder="PJX421">
                </div>
                <div>
                    <label class="cp-label" for="cloType">Flight type</label>
                    <select id="cloType" class="cp-select" name="flightType">
                        ${types.map((t) => `<option value="${esc(String(t.value))}"${t.value === currentType ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}
                    </select>
                </div>
                <div class="cp-grid2">
                    <div>
                        <label class="cp-label" for="cloFrom">From</label>
                        <input id="cloFrom" class="cp-input" name="originIcao" maxlength="8" required
                            value="${esc(s.originIcao || '')}" placeholder="KLAX" style="text-transform:uppercase">
                    </div>
                    <div>
                        <label class="cp-label" for="cloTo">To</label>
                        <input id="cloTo" class="cp-input" name="destinationIcao" maxlength="8" required
                            value="${esc(s.destinationIcao || '')}" placeholder="KJFK" style="text-transform:uppercase">
                    </div>
                </div>
                <div class="cp-grid2">
                    <div>
                        <label class="cp-label" for="cloDep">Departure (UTC)</label>
                        <input id="cloDep" class="cp-input" name="scheduledDepartureUtc" type="datetime-local" required
                            value="${esc(toUtcInput(s.scheduledDepartureUtc))}">
                    </div>
                    <div>
                        <label class="cp-label" for="cloArr">Arrival (UTC)</label>
                        <input id="cloArr" class="cp-input" name="scheduledArrivalUtc" type="datetime-local" required
                            value="${esc(toUtcInput(s.scheduledArrivalUtc))}">
                    </div>
                </div>
                <p class="cp-note cp-faint">Both times are Zulu, the way Infinite Flight stores them — not your local clock.</p>
                <div>
                    <label class="cp-label" for="cloBrief">Briefing <span class="cp-faint">optional</span></label>
                    <textarea id="cloBrief" class="cp-textarea" name="briefing" maxlength="4000"
                        placeholder="Anything the pilot should know before they push.">${esc(s.briefing || '')}</textarea>
                </div>
                <div>
                    <label class="cp-label" for="cloFp">Flight plan <span class="cp-faint">optional</span></label>
                    <textarea id="cloFp" class="cp-textarea" name="flightPlan" maxlength="16000"
                        placeholder="KLAX DCT KJFK">${esc(s.flightPlan || '')}</textarea>
                </div>
                <p class="cp-note cp-note-bad clo-form-error" hidden></p>
                <div class="clo-form-foot">
                    <button type="button" class="cp-btn" data-clo-dialog-close>Cancel</button>
                    <button type="submit" class="cp-btn cp-btn-primary">${isNew ? 'Add flight' : 'Save'}</button>
                </div>
            </form>`);

        modal.el.addEventListener('close-dialog', () => { editorOpen = false; });

        const form = modal.el.querySelector('[data-clo-form]');
        const errorEl = modal.el.querySelector('.clo-form-error');
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const submit = form.querySelector('button[type="submit"]');
            const body = {
                callsign: form.callsign.value.trim(),
                flightType: Number(form.flightType.value),
                originIcao: form.originIcao.value.trim().toUpperCase(),
                destinationIcao: form.destinationIcao.value.trim().toUpperCase(),
                scheduledDepartureUtc: fromUtcInput(form.scheduledDepartureUtc.value),
                scheduledArrivalUtc: fromUtcInput(form.scheduledArrivalUtc.value),
                briefing: form.briefing.value,
                flightPlan: form.flightPlan.value,
            };
            // Checked here as well as on both servers, because it is the one
            // rule somebody breaks by accident every time — and finding out
            // after a round trip is worse than finding out on the field.
            if (body.scheduledArrivalUtc && body.scheduledDepartureUtc
                && new Date(body.scheduledArrivalUtc) <= new Date(body.scheduledDepartureUtc)) {
                errorEl.textContent = 'The arrival has to be after the departure.';
                errorEl.hidden = false;
                return;
            }
            submit.disabled = true;
            errorEl.hidden = true;
            try {
                if (isNew) {
                    await S.api(`/if/aircraft/${encodeURIComponent(S.aircraft.id)}/schedules`, { method: 'POST', body });
                } else {
                    await S.api(`/if/schedules/${encodeURIComponent(s.id)}`, { method: 'PUT', body });
                }
                modal.close();
                P.toast(isNew ? 'Flight added.' : 'Flight saved.', 'ok');
                await loadSchedules(S.aircraft.id);
                render();
            } catch (err) {
                errorEl.textContent = (err && err.message) || 'That didn’t work.';
                errorEl.hidden = false;
                submit.disabled = false;
            }
        });
    }

    /**
     * The flight plan on its own.
     *
     * A separate dialog because it is a separate endpoint, and for the reason
     * that endpoint exists: pasting a route into a schedule should not mean
     * resending the callsign, the airports and both times — which would
     * overwrite whatever somebody else changed in between.
     */
    function openFlightPlan(id) {
        if (editorOpen) return;
        const s = S.schedules.find((x) => x.id === id);
        if (!s) return;
        editorOpen = true;

        const modal = dialog(`Flight plan · ${s.callsign || ''}`, `
            <form class="clo-form" data-clo-fp-form>
                <div>
                    <label class="cp-label" for="cloFpText">Flight plan</label>
                    <textarea id="cloFpText" class="cp-textarea" name="flightPlan" rows="8" maxlength="16000"
                        placeholder="KLAX DCT LAS DCT KJFK">${esc(s.flightPlan || '')}</textarea>
                </div>
                <p class="cp-note cp-faint">Leave it empty to clear the stored flight plan.</p>
                <p class="cp-note cp-note-bad clo-form-error" hidden></p>
                <div class="clo-form-foot">
                    <button type="button" class="cp-btn" data-clo-dialog-close>Cancel</button>
                    <button type="submit" class="cp-btn cp-btn-primary">Save</button>
                </div>
            </form>`);

        modal.el.addEventListener('close-dialog', () => { editorOpen = false; });
        const form = modal.el.querySelector('[data-clo-fp-form]');
        const errorEl = modal.el.querySelector('.clo-form-error');
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const submit = form.querySelector('button[type="submit"]');
            submit.disabled = true;
            errorEl.hidden = true;
            try {
                await S.api(`/if/schedules/${encodeURIComponent(id)}/flightplan`, {
                    method: 'PUT',
                    // Empty means clear, and the backend turns '' into the null
                    // the API documents for that.
                    body: { flightPlan: form.flightPlan.value },
                });
                modal.close();
                P.toast('Flight plan saved.', 'ok');
                await loadSchedules(S.aircraft.id);
                render();
            } catch (err) {
                errorEl.textContent = (err && err.message) || 'That didn’t work.';
                errorEl.hidden = false;
                submit.disabled = false;
            }
        });
    }

    /* ---------------------------------------------------------------------
     * Connecting
     * ------------------------------------------------------------------- */

    /**
     * Send the owner to Infinite Flight.
     *
     * A full-page navigation, not a popup: the redirect back is a top-level GET
     * to our backend, and a popup would land the dashboard's callback in a
     * window the dashboard cannot see. The panel state is rebuilt from the
     * server on return, so there is nothing here worth preserving.
     */
    async function connect() {
        try {
            const { url } = await S.api('/if/connect');
            if (!url) throw new Error('Infinite Flight didn’t give us somewhere to send you.');
            window.location.href = url;
        } catch (err) {
            P.toast((err && err.message) || 'Could not start the connection.', 'bad');
        }
    }

    async function disconnect() {
        if (!window.confirm('Disconnect this Infinite Flight account? The Live fleet and its schedules will stop loading here.')) return;
        try {
            const out = await S.api('/if/disconnect', { method: 'POST' });
            P.toast(out.note || 'Disconnected.', 'ok');
            S.orgId = ''; S.fleet = []; S.schedules = []; S.aircraft = null; S.view = 'fleet';
            await refresh();
        } catch (err) {
            P.toast((err && err.message) || 'Could not disconnect.', 'bad');
        }
    }

    async function chooseOrganization(id) {
        S.orgId = id;
        try {
            await S.api('/if/organization', { method: 'POST', body: { organizationId: id } });
        } catch (err) {
            // Remembering the choice is a convenience; showing the fleet is the
            // feature. A failure to store it must not stop the board loading.
            console.warn('crewLiveOps: could not remember the organization —', err);
        }
        await refresh();
    }

    async function openAircraft(id) {
        const a = S.fleet.find((x) => x.id === id);
        if (!a) return;
        S.aircraft = a;
        S.view = 'schedules';
        S.schedules = [];
        S.loading = true;
        render();
        try { await loadSchedules(id); S.error = null; }
        catch (err) { S.error = err; }
        finally { S.loading = false; render(); }
    }

    function backToFleet() {
        S.view = 'fleet';
        S.aircraft = null;
        S.schedules = [];
        render();
        // The fleet may be stale by now — an airframe's position moves while a
        // schedule list is open — so it is re-read rather than redrawn.
        refresh();
    }

    /* ---------------------------------------------------------------------
     * The panel shell
     * ------------------------------------------------------------------- */

    function ensurePanel() {
        if (panel) return panel;
        injectStyles();
        panel = P.sheet({ id: 'clo-panel', title: 'Live ops', icon: 'radio-tower', wide: true });

        panel.body.addEventListener('click', (ev) => {
            const hit = (attr) => {
                const el = ev.target.closest(`[${attr}]`);
                return el ? el.getAttribute(attr) : null;
            };
            if (ev.target.closest('[data-clo-refresh]')) { refresh(); return; }
            if (ev.target.closest('[data-clo-connect]')) { connect(); return; }
            if (ev.target.closest('[data-clo-disconnect]')) { disconnect(); return; }
            if (ev.target.closest('[data-clo-back]')) { backToFleet(); return; }
            if (ev.target.closest('[data-clo-add]')) { openEditor(null); return; }

            const up = hit('data-clo-up'); if (up) { moveUp(up); return; }
            const down = hit('data-clo-down'); if (down) { moveDown(down); return; }
            const edit = hit('data-clo-edit');
            if (edit) { openEditor(S.schedules.find((x) => x.id === edit)); return; }
            const fp = hit('data-clo-fp'); if (fp) { openFlightPlan(fp); return; }
            const del = hit('data-clo-delete'); if (del) { removeSchedule(del); return; }

            // Last, because an aircraft card CONTAINS the controls above and a
            // click on one of them would otherwise also open the airframe.
            const ac = hit('data-clo-aircraft'); if (ac) { openAircraft(ac); }
        });

        // Keyboard parity for the aircraft cards, which are divs behaving as
        // buttons. Without this the fleet is unreachable without a mouse.
        panel.body.addEventListener('keydown', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ') return;
            const card = ev.target.closest('[data-clo-aircraft]');
            if (!card) return;
            ev.preventDefault();
            openAircraft(card.getAttribute('data-clo-aircraft'));
        });

        panel.body.addEventListener('change', (ev) => {
            const sel = ev.target.closest('[data-clo-org]');
            if (sel) chooseOrganization(sel.value);
        });

        return panel;
    }

    function open() {
        ensurePanel().open();
        render();
        refresh();
    }

    /* ---------------------------------------------------------------------
     * Coming back from Infinite Flight
     *
     * The backend's callback redirects here with ?if=connected or ?if=error.
     * Handled in this module rather than by the host page, because the host has
     * no idea what those mean and every page that mounts this one would
     * otherwise need its own copy.
     *
     * The parameters are stripped afterwards: leaving them in the URL means a
     * refresh re-announces a connection that happened ten minutes ago, and a
     * shared link carries somebody else's success message.
     * ------------------------------------------------------------------- */
    function consumeCallback() {
        const qs = new URLSearchParams(window.location.search);
        const outcome = qs.get('if');
        if (!outcome) return false;

        const reason = qs.get('reason') || '';
        qs.delete('if'); qs.delete('reason');
        const clean = `${window.location.pathname}${qs.toString() ? `?${qs}` : ''}${window.location.hash}`;
        try { window.history.replaceState({}, '', clean); } catch { /* not worth failing over */ }

        if (outcome === 'connected') {
            P.toast('Infinite Flight connected.', 'ok');
            open();
        } else {
            P.toast(reason || 'The Infinite Flight connection didn’t complete.', 'bad');
            open();
        }
        return true;
    }

    /* ---------------------------------------------------------------------
     * A small modal. Same shape as crewSchedule's, and deliberately its own:
     * these two panels are dropped into different pages and neither may depend
     * on the other having loaded.
     * ------------------------------------------------------------------- */
    function dialog(title, html) {
        const el = document.createElement('div');
        el.className = 'cp-panel clo-dialog cp-dialog';
        el.innerHTML = `
            <div class="cp-scrim" data-clo-dialog-close></div>
            <div class="clo-dialog-card">
                <header class="cp-head">
                    <div class="cp-head-title"><span>${esc(title)}</span></div>
                    <button class="cp-icon-btn" data-clo-dialog-close aria-label="Close"><i data-lucide="x"></i></button>
                </header>
                <div class="clo-dialog-body">${html}</div>
            </div>`;
        document.body.appendChild(el);
        P.lockScroll();
        icons();

        let closed = false;
        const close = () => {
            if (closed) return;              // the scroll lock is counted
            closed = true;
            el.dispatchEvent(new CustomEvent('close-dialog'));
            el.remove();
            document.removeEventListener('keydown', onKey);
            P.unlockScroll();
        };
        function onKey(ev) { if (ev.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        el.addEventListener('click', (ev) => { if (ev.target.closest('[data-clo-dialog-close]')) close(); });
        return { el, close };
    }

    /* ---------------------------------------------------------------------
     * Styles. Every colour is a var() off the host page, so a VA's brand theme
     * themes this too — the rule crewPanels.js sets and every panel keeps.
     * ------------------------------------------------------------------- */
    function injectStyles() {
        P.baseStyles();
        P.style('clo-styles', `
        .clo-list{ display:grid; gap:.7rem; }
        .clo-chips{ display:flex; flex-wrap:wrap; gap:.3rem; }

        .clo-strip{ display:grid; gap:.6rem; }
        .clo-strip-row{ display:flex; align-items:center; justify-content:space-between; gap:.75rem; flex-wrap:wrap; }
        .clo-strip-who{ display:inline-flex; align-items:center; gap:.45rem; font-size:.88rem;
            color:var(--ink,#1C1A16); min-width:0; }
        .clo-strip-who i{ width:1.05em; height:1.05em; color:#16A34A; }
        .clo-strip-actions{ display:inline-flex; align-items:center; gap:.4rem; }
        .clo-org{ max-width:18rem; }
        .clo-orgname{ font-weight:600; font-size:.9rem; color:var(--ink,#1C1A16); }
        .clo-scopes{ margin:.7rem 0 0; padding-left:1.1rem; display:grid; gap:.2rem;
            font-size:.82rem; color:var(--muted,#736E64); }
        .clo-actions{ display:flex; flex-wrap:wrap; gap:.5rem; }
        .clo-error{ border-color:#DC2626; }

        .clo-ac{ cursor:pointer; display:grid; gap:.55rem; }
        .clo-ac:hover{ border-color:var(--ink,#1C1A16); }
        .clo-ac:focus-visible{ outline:2px solid var(--accent,#1C1A16); outline-offset:2px; }
        .clo-ac-head{ display:flex; align-items:center; justify-content:space-between; gap:.6rem; flex-wrap:wrap; }
        .clo-ac-foot{ display:flex; align-items:center; justify-content:space-between; gap:.6rem;
            flex-wrap:wrap; padding-top:.55rem; border-top:1px solid var(--line,#e5e5e5); }
        .clo-go{ color:var(--accent,#1C1A16); font-weight:600; }
        .clo-pos{ display:flex; flex-wrap:wrap; gap:.3rem .85rem; }
        /* A stale position is still worth showing — it is where the aeroplane
           was — but it must not read as where it is. */
        .clo-stale{ opacity:.55; }

        .clo-subhead{ display:flex; align-items:center; gap:.6rem; flex-wrap:wrap;
            padding-bottom:.7rem; border-bottom:1px solid var(--line,#e5e5e5); margin-bottom:.2rem; }
        .clo-subhead-title{ flex:1; min-width:8rem; }
        .clo-subhead-title strong{ display:block; letter-spacing:-.01em; }

        .clo-row{ display:grid; gap:.5rem; }
        .clo-busy{ opacity:.55; pointer-events:none; }
        .clo-row-head{ display:flex; align-items:center; justify-content:space-between; gap:.5rem; flex-wrap:wrap; }
        .clo-row-title{ display:inline-flex; align-items:center; gap:.45rem; flex-wrap:wrap; min-width:0; }
        .clo-seq{ display:inline-grid; place-items:center; width:1.5rem; height:1.5rem; border-radius:.35rem;
            background:var(--line,#e5e5e5); color:var(--muted,#736E64); font-size:.72rem; font-weight:700; }
        .clo-leg{ margin:0; font-size:.9rem; color:var(--ink,#1C1A16);
            display:flex; align-items:center; gap:.4rem; flex-wrap:wrap; }
        .clo-leg i{ width:.95em; height:.95em; color:var(--faint,#A8A296); }
        .clo-row-facts{ font-size:.82rem; }
        .clo-brief{ margin:0; font-size:.82rem; color:var(--muted,#736E64); white-space:pre-wrap; }
        .clo-row-actions{ display:flex; flex-wrap:wrap; gap:.4rem; padding-top:.55rem;
            border-top:1px solid var(--line,#e5e5e5); }

        .clo-dialog{ z-index:90; }
        .clo-dialog-card{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
            width:min(94vw,36rem); max-height:88vh; overflow-y:auto; border-radius:.9rem;
            background:var(--surface,#fff); border:1px solid var(--line,#e5e5e5);
            box-shadow:0 24px 60px rgba(0,0,0,.28); }
        .clo-dialog-body{ padding:1rem; }
        .clo-form{ display:grid; gap:.8rem; }
        .clo-form-foot{ display:flex; gap:.5rem; }
        .clo-form-foot .cp-btn{ flex:1; justify-content:center; }

        @media (max-width:40rem){
            .clo-dialog-card{
                left:0; right:0; top:auto; bottom:0; transform:none;
                width:100%; max-height:92vh; max-height:92dvh;
                border-radius:1.1rem 1.1rem 0 0;
                padding-bottom:env(safe-area-inset-bottom,0px);
            }
            .clo-dialog-card .cp-head{ padding-top:.75rem; border-radius:1.1rem 1.1rem 0 0; }
            .clo-dialog-card .cp-head::before{
                content:''; position:absolute; top:.4rem; left:50%; transform:translateX(-50%);
                width:2.25rem; height:.25rem; border-radius:999px; background:var(--line,#e5e5e5);
            }
            .clo-dialog-body{ padding:.85rem; }
            .clo-org{ max-width:none; width:100%; }
        }`);
    }

    /* ---------------------------------------------------------------------
     * Mount
     * ------------------------------------------------------------------- */

    function mount({ backend, slug, token }) {
        injectStyles();
        S.api = P.api({ backend, slug, token });
        S.slug = String(slug || '').toLowerCase();
        if (!S.slug) return Promise.resolve(null);
        // The status is read at mount so a host can decide whether to show its
        // tile at all, without opening the panel. Everything heavier waits until
        // somebody actually looks.
        return loadStatus();
    }

    window.CrewLiveOps = {
        mount, open, consumeCallback,
        close: () => panel && panel.close(),
        reload: () => refresh(),
        get status() { return S.status ? { ...S.status } : null; },
        get available() { return !!(S.status && S.status.available); },
        get connected() { return !!(S.status && S.status.connected); },
    };
})();
