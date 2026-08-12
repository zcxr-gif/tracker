/* ============================================================================
   crewFlightPicker.js — file a flight by picking it out of your real logbook.

   WHY THIS EXISTS

   Filing a flight report used to mean typing a flight the API already had in
   full: two ICAOs, an aircraft name spelled the way the fleet happens to spell
   it, and a duration off the top of the pilot's head. Three chances to file
   something that quietly fails to match a route they genuinely flew — and none
   of it verified, because a typed report is a claim about a flight rather than
   the flight.

   The data was never missing. Infinite Flight keeps every pilot's logbook and
   the ACARS backend already proxies it; the crew center only ever read it on
   the STAFF side, as a sweep a manager triggers for the whole roster at once.
   A pilot could not see their own flights, let alone file one.

   So: ask the server for this pilot's flights, show them, let them point at
   one. Everything a report is made of — route, aircraft, livery, duration,
   landings, XP, violations, when it happened — comes from the record rather
   than from a form, which is also why the browser sends nothing but an id. The
   server re-reads the flight from Infinite Flight before it files anything (see
   POST /api/crew/:slug/pireps), so the numbers cannot be edited on the way in.

   WHAT IT DRAWS

     · The pilot's recent Infinite Flight flights, newest first, each already
       judged against THIS airline: filed before, aircraft in the fleet, leg
       matching a published route and which flight number that is.
     · What will be filed, on the flight they picked, before they commit.
     · A way through when the logbook cannot help — no linked account, nothing
       in it, or a flight flown before they joined — which is the typed form,
       kept as the fallback it should always have been.

   Used by the pilot home and by the staff dashboard's "my flying" card. Both
   file the same way; neither owns a second copy of this.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewFlightPicker: crewPanels.js must load first'); return; }
    const { esc, icons, durationText, relativeText, whenText } = P;

    /* State for the panel that is open. Deliberately not a cache across opens:
       a pilot opens this BECAUSE they just landed, and a list that remembers
       what it fetched before their flight is the one list guaranteed to be
       missing the flight they came for. */
    const S = {
        api: null,          // bound fetch, per CrewPanels.api
        panel: null,
        flights: [],
        page: 1,
        hasNextPage: false,
        linked: true,
        loading: false,
        error: null,
        picked: null,       // the flight being confirmed, or null for the list
        filing: false,
        onFiled: null,      // told what came back, so the host can refresh
        onManual: null,     // "file by hand instead", when the host offers one
        extra: null,        // eventId / scheduleId this filing belongs to
    };

    /* =====================================================================
     * STYLES
     * =================================================================== */

    function styles() {
        P.style('crew-flight-picker-css', `
        .fp-list{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
        .fp-row{width:100%;display:flex;align-items:center;gap:.75rem;text-align:left;
            padding:.7rem .8rem;border:1px solid var(--line,#e5e5e5);
            border-radius:.6rem;background:var(--surface,#fff);color:var(--ink,#1C1A16);
            cursor:pointer;font:inherit;transition:border-color .12s,background .12s}
        .fp-row:hover{border-color:var(--ink,#1C1A16)}
        .fp-row[disabled]{cursor:default;opacity:.55}
        .fp-row[disabled]:hover{border-color:var(--line,#e5e5e5)}
        .fp-leg{font-weight:650;letter-spacing:-.01em}
        .fp-main{flex:1;min-width:0;display:grid;gap:.15rem}
        .fp-sub{font-size:.78rem;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .fp-side{display:grid;gap:.2rem;justify-items:end;flex-shrink:0}
        .fp-dur{font-weight:600;font-variant-numeric:tabular-nums}
        .fp-tags{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.1rem}
        .fp-more{display:flex;justify-content:center;margin-top:.9rem}
        `);
    }

    /* =====================================================================
     * DATA
     * =================================================================== */

    async function loadPage(page, { append = false } = {}) {
        S.loading = true;
        S.error = null;
        if (!append) { S.flights = []; S.picked = null; }
        render();
        try {
            const d = await S.api(`/me/if-flights?page=${encodeURIComponent(page)}`);
            S.linked = d.linked !== false;
            S.page = Number(d.page) || page;
            S.hasNextPage = !!d.hasNextPage;
            const rows = Array.isArray(d.flights) ? d.flights : [];
            // Each row remembers the page it arrived on. The server uses it as
            // the hint for where to look the flight up again, which matters
            // exactly when it is deepest in the logbook.
            for (const f of rows) f._page = S.page;
            S.flights = append ? S.flights.concat(rows) : rows;
        } catch (err) {
            S.error = err;
        }
        S.loading = false;
        render();
    }

    /**
     * File the picked flight.
     *
     * Sends the id and the page it was found on — nothing else. Everything that
     * ends up in the report is read back from Infinite Flight server-side, so
     * there is no version of this request that files a different flight than
     * the one on screen.
     */
    async function file() {
        if (!S.picked || S.filing) return;
        S.filing = true;
        render();
        try {
            const d = await S.api('/pireps', {
                method: 'POST',
                // `extra` is why-it-was-flown, never what-happened: an event or
                // a booked departure this leg belongs to. The server takes the
                // numbers from Infinite Flight regardless, so there is nothing
                // here that can contradict the record.
                body: { ...S.extra, flightId: S.picked.flightId, flightPage: S.picked._page || 1 },
            });
            S.filing = false;
            // Mark it filed rather than dropping it: the pilot is about to look
            // back at the list, and a flight that vanished reads as a flight
            // that failed to file.
            const row = S.flights.find((f) => f.flightId === S.picked.flightId);
            if (row) row.filed = true;
            S.picked = null;
            S.panel.close();
            P.toast(fileMessage(d), 'ok');
            if (typeof S.onFiled === 'function') S.onFiled(d);
        } catch (err) {
            S.filing = false;
            // 409 means somebody — or the staff sync — got there first. That is
            // not a failure to report, it is the list being out of date, so say
            // so and mark the row.
            if (err && err.status === 409) {
                const row = S.flights.find((f) => f.flightId === S.picked.flightId);
                if (row) row.filed = true;
                S.picked = null;
            }
            S.error = err;
            render();
        }
    }

    function fileMessage(d) {
        if (d && d.autoApproved) return 'Filed and approved — your hours are updated.';
        if (d && d.routeMatched === false) return 'Filed — staff will review it. It didn’t match a published route.';
        return 'Filed. Staff will review it.';
    }

    /* =====================================================================
     * RENDER
     * =================================================================== */

    function render() {
        if (!S.panel || !S.panel.isOpen()) return;
        const body = S.panel.body;

        if (S.error && P.isSchemaGap(S.error)) { body.innerHTML = P.schemaGapHtml(S.error); icons(); return; }
        if (S.picked) { body.innerHTML = confirmHtml(S.picked); wireConfirm(); icons(); return; }

        if (S.loading && !S.flights.length) {
            body.innerHTML = '<div class="cp-empty">Reading your Infinite Flight logbook…</div>';
            icons();
            return;
        }
        if (S.error && !S.flights.length) { body.innerHTML = errorHtml(S.error); wireList(); icons(); return; }
        if (!S.linked) { body.innerHTML = unlinkedHtml(); wireList(); icons(); return; }
        if (!S.flights.length) { body.innerHTML = emptyHtml(); wireList(); icons(); return; }

        body.innerHTML = `
            <p class="cp-note">Your recent Infinite Flight flights. Pick the one you flew for
                this airline and everything about it is filed as it happened — nothing to type.</p>
            <ul class="fp-list">${S.flights.map(rowHtml).join('')}</ul>
            ${S.hasNextPage ? `<div class="fp-more">
                <button class="cp-btn cp-btn-sm" data-fp-more ${S.loading ? 'disabled' : ''}>
                    ${S.loading ? 'Loading…' : 'Older flights'}</button></div>` : ''}
            ${manualHtml()}`;
        wireList();
        icons();
    }

    function rowHtml(f) {
        const leg = `${esc(f.origin || '????')} → ${esc(f.destination || '????')}`;
        const sub = [f.aircraftName, f.liveryName, f.callsign].filter(Boolean).join(' · ');
        return `<li><button class="fp-row" data-fp-pick="${esc(f.flightId)}" ${f.filed ? 'disabled' : ''}>
            <span class="fp-main">
                <span class="fp-leg">${leg}</span>
                <span class="fp-sub">${esc(sub) || '&nbsp;'}</span>
                <span class="fp-tags">${tagsHtml(f)}</span>
            </span>
            <span class="fp-side">
                <span class="fp-dur">${esc(durationText(f.durationMin) || '—')}</span>
                <span class="fp-sub">${esc(relativeText(f.flownAt) || '')}</span>
            </span>
        </button></li>`;
    }

    /* The three things a pilot cannot work out by looking at their own flight,
       because all three are facts about the AIRLINE: has this been filed, does
       the aircraft count, and is this leg on the network. */
    function tagsHtml(f) {
        const t = [];
        if (f.filed) t.push('<span class="cp-chip cp-chip-mute">Already filed</span>');
        if (f.routeMatched) {
            t.push(`<span class="cp-chip cp-chip-accent">${esc(f.flightNumber || 'On the network')}</span>`);
        }
        if (f.inFleet) t.push('<span class="cp-chip cp-chip-ok">Fleet aircraft</span>');
        else if (f.aircraftName) t.push('<span class="cp-chip cp-chip-warn">Not in the fleet</span>');
        return t.join('');
    }

    function confirmHtml(f) {
        const fact = (label, value) => value
            ? `<div class="cp-fact"><span class="cp-faint">${esc(label)}</span> ${esc(value)}</div>` : '';
        return `<div class="cp-card">
            <div class="cp-card-title">${esc(f.origin || '????')} → ${esc(f.destination || '????')}</div>
            <div class="fp-tags" style="margin:.15rem 0 .6rem">${tagsHtml(f)}</div>
            <div class="cp-facts">
                ${fact('Aircraft', f.aircraftName || 'Unknown')}
                ${fact('Livery', f.liveryName)}
                ${fact('Time', durationText(f.durationMin) || '—')}
                ${fact('Landings', String(f.landings || 0))}
                ${fact('Callsign', f.callsign)}
                ${fact('Server', f.server)}
                ${fact('Flown', whenText(f.flownAt))}
                ${f.violations ? fact('Violations', String(f.violations)) : ''}
            </div>
            <p class="cp-note">This is filed exactly as Infinite Flight recorded it${
                f.routeMatched ? ` and credited against ${esc(f.flightNumber || 'the published route')}` : ''}.
                ${f.inFleet ? '' : 'The aircraft isn’t in this airline’s fleet, so staff may not credit it. '}Staff review it either way.</p>
            <div style="display:flex;gap:.5rem;margin-top:.2rem">
                <button class="cp-btn cp-btn-primary" data-fp-file ${S.filing ? 'disabled' : ''}>
                    <i data-lucide="send"></i> ${S.filing ? 'Filing…' : 'File this flight'}</button>
                <button class="cp-btn" data-fp-back ${S.filing ? 'disabled' : ''}>Back</button>
            </div>
            ${S.error ? `<p class="cp-note cp-note-bad">${esc(S.error.message || 'Could not file that.')}</p>` : ''}
        </div>`;
    }

    function unlinkedHtml() {
        return `<div class="cp-empty">
            <i data-lucide="unlink"></i>
            Your pilot record isn’t linked to an Infinite Flight account, so we can’t read your
            flights. Ask your staff to link it — they do it from the roster.
            ${manualHtml()}
        </div>`;
    }

    function emptyHtml() {
        return `<div class="cp-empty">
            <i data-lucide="plane"></i>
            Infinite Flight has no recent flights for your account. A flight shows up here once
            it lands and the servers have logged it, which can take a few minutes.
            <div class="fp-more"><button class="cp-btn cp-btn-sm" data-fp-retry><i data-lucide="refresh-cw"></i> Check again</button></div>
            ${manualHtml()}
        </div>`;
    }

    function errorHtml(err) {
        return `<div class="cp-empty">
            <i data-lucide="cloud-off"></i>
            ${esc((err && err.message) || 'Could not read your Infinite Flight logbook.')}
            <div class="fp-more"><button class="cp-btn cp-btn-sm" data-fp-retry><i data-lucide="refresh-cw"></i> Try again</button></div>
            ${manualHtml()}
        </div>`;
    }

    // The typed form, offered only where the host actually has one. A flight
    // flown before the pilot joined, or one Infinite Flight never logged, still
    // has to be fileable — the picker is the better path, not the only one.
    function manualHtml() {
        if (typeof S.onManual !== 'function') return '';
        return `<p class="cp-note" style="margin-top:.9rem">
            Flew it somewhere we can’t see? <button class="cp-btn cp-btn-sm" data-fp-manual>File by hand</button></p>`;
    }

    /* =====================================================================
     * WIRING
     *
     * Delegated off the panel body, which is replaced wholesale on every
     * render — a listener bound to a row would not survive the next one.
     * =================================================================== */

    function wireList() {
        const body = S.panel.body;
        if (body.dataset.fpWired) return;
        body.dataset.fpWired = '1';
        body.addEventListener('click', (ev) => {
            const pick = ev.target.closest('[data-fp-pick]');
            if (pick) {
                const id = pick.getAttribute('data-fp-pick');
                S.picked = S.flights.find((f) => String(f.flightId) === String(id)) || null;
                S.error = null;
                return render();
            }
            if (ev.target.closest('[data-fp-more]')) return loadPage(S.page + 1, { append: true });
            if (ev.target.closest('[data-fp-retry]')) return loadPage(1);
            if (ev.target.closest('[data-fp-file]')) return file();
            if (ev.target.closest('[data-fp-back]')) { S.picked = null; S.error = null; return render(); }
            if (ev.target.closest('[data-fp-manual]')) {
                S.panel.close();
                if (typeof S.onManual === 'function') S.onManual();
            }
        });
    }
    const wireConfirm = wireList;   // one delegated listener covers both views

    /* =====================================================================
     * PUBLIC
     * =================================================================== */

    /**
     * Open the picker.
     *
     * `api` is a CrewPanels.api-shaped call — the host already has one bound to
     * its own backend, slug and token, and taking it means this module never
     * has to know how the page it is on stores a session.
     *
     * `onFiled(result)` is how the host refreshes; `onManual()` is optional and
     * its absence is what hides the by-hand fallback. `extra` carries an
     * eventId or scheduleId when the flight is being filed against one.
     */
    function open({ api, onFiled, onManual, title, extra } = {}) {
        if (typeof api !== 'function') { console.warn('crewFlightPicker: needs an api function'); return; }
        styles();
        S.api = api;
        S.onFiled = onFiled || null;
        S.onManual = onManual || null;
        S.extra = extra && typeof extra === 'object' ? extra : null;
        S.picked = null;
        S.error = null;
        S.filing = false;
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewFlightPicker', title: title || 'File a flight', icon: 'clipboard-pen' });
        } else if (title) {
            S.panel.setTitle(title);
        }
        S.panel.open();
        loadPage(1);
    }

    window.CrewFlightPicker = { open, close: () => S.panel && S.panel.close() };
})();
