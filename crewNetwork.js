/* ============================================================================
   crewNetwork.js — the airline's route network, for the pilots who fly it.

   WHY THIS EXISTS

   crew-pilot.html did not contain the word "routes". The endpoint has always
   been pilot-readable and has always returned everything this needs — the leg,
   the aircraft, the distance, whether it is a codeshare and whose, the rank it
   opens at and how many hours THIS pilot is short of that rank. All of it was
   drawn only on the staff dashboard.

   So a pilot could book a departure somebody had scheduled, and could not
   answer "where does this airline fly?". The network was a thing management
   maintained and pilots discovered one scheduled leg at a time.

   WHAT IT ADDS ON TOP OF THE ENDPOINT

   Which routes this pilot has already flown. The server does not know or care
   — it is a fact about their logbook, not about the network — but "12 of 48
   flown" turns a reference list into something with a shape, and a pilot
   looking for what to fly next is far better served by "not yet flown" than by
   an alphabetical list of everything.

   LOCKED ROUTES ARE SHOWN, NOT HIDDEN

   The server already computes `hoursUntilUnlock` for exactly this reason, and
   its comment says it better than this one could: "unlocks in 12h" is the thing
   that makes a rank ladder worth climbing, where a route that simply is not
   there is indistinguishable from a network that is smaller than advertised.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewNetwork: crewPanels.js must load first'); return; }
    const { esc, icons } = P;

    const FILTERS = [
        { id: 'all', label: 'All' },
        { id: 'todo', label: 'Not yet flown' },
        { id: 'open', label: 'Open to me' },
        { id: 'locked', label: 'Locked' },
        { id: 'codeshare', label: 'Codeshare' },
    ];

    const S = {
        api: null,
        panel: null,
        routes: [],
        flown: new Set(),   // "EGLL-KJFK" for every leg this pilot has flown
        filter: 'all',
        query: '',
        loading: false,
        error: null,
    };

    const legKey = (o, d) => `${String(o || '').toUpperCase()}-${String(d || '').toUpperCase()}`;

    /* =====================================================================
     * STYLES
     * =================================================================== */

    function styles() {
        P.style('crew-network-css', `
        .cn-bar{display:grid;gap:.6rem;margin-bottom:.9rem}
        .cn-filters{display:flex;gap:.35rem;flex-wrap:wrap}
        .cn-filter{font-size:.75rem;font-weight:700;padding:.3rem .7rem;border-radius:999px;
            border:1px solid var(--line,#e5e5e5);background:var(--surface,#fff);
            color:var(--muted,#736E64);cursor:pointer;font-family:inherit}
        .cn-filter[aria-pressed="true"]{background:var(--accent,#1C1A16);color:#fff;border-color:transparent}
        .cn-progress{height:.35rem;border-radius:999px;background:var(--line,#e5e5e5);overflow:hidden}
        .cn-progress span{display:block;height:100%;background:var(--accent,#1C1A16)}
        .cn-list{list-style:none;margin:0;padding:0;display:grid;gap:.4rem}
        .cn-row{display:flex;align-items:center;gap:.75rem;padding:.6rem .75rem;
            border:1px solid var(--line,#e5e5e5);border-radius:.55rem;
            background:var(--surface,#fff)}
        .cn-row-locked{opacity:.62}
        .cn-row-flown{border-color:color-mix(in srgb, var(--accent,#1C1A16) 40%, var(--line,#e5e5e5))}
        .cn-main{flex:1;min-width:0;display:grid;gap:.15rem}
        .cn-leg{font-weight:650;letter-spacing:-.01em}
        .cn-sub{font-size:.75rem;color:var(--muted,#736E64);overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap}
        .cn-tags{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.1rem}
        .cn-dist{font-size:.78rem;font-variant-numeric:tabular-nums;color:var(--faint,#A8A296);
            flex-shrink:0}
        `);
    }

    /* =====================================================================
     * DATA
     * =================================================================== */

    async function load() {
        S.loading = true;
        S.error = null;
        render();
        try {
            const d = await S.api('/routes');
            // Retired routes are the network's history, not its map. A pilot
            // asking where they can fly should not be offered a leg the airline
            // stopped operating.
            S.routes = (Array.isArray(d.routes) ? d.routes : []).filter(P.isPublishedRoute);
        } catch (err) {
            S.error = err;
            S.routes = [];
        }
        S.loading = false;
        render();
    }

    /* =====================================================================
     * RENDER
     * =================================================================== */

    function visible() {
        const q = S.query.trim().toLowerCase();
        return S.routes.filter((r) => {
            if (S.filter === 'todo' && S.flown.has(legKey(r.origin, r.destination))) return false;
            if (S.filter === 'open' && r.locked) return false;
            if (S.filter === 'locked' && !r.locked) return false;
            if (S.filter === 'codeshare' && r.kind !== 'codeshare') return false;
            if (!q) return true;
            return [r.flightNumber, r.origin, r.destination, r.aircraft, r.partnerName]
                .some((v) => String(v || '').toLowerCase().includes(q));
        });
    }

    function render() {
        if (!S.panel || !S.panel.isOpen()) return;
        const body = S.panel.body;

        if (S.error && P.isSchemaGap(S.error)) { body.innerHTML = P.schemaGapHtml(S.error); icons(); return; }
        if (S.loading && !S.routes.length) {
            body.innerHTML = '<div class="cp-empty">Reading the network…</div>'; icons(); return;
        }
        if (S.error) {
            body.innerHTML = `<div class="cp-empty"><i data-lucide="cloud-off"></i>
                ${esc(S.error.message || 'Could not load the network.')}</div>`;
            icons(); return;
        }
        if (!S.routes.length) {
            body.innerHTML = `<div class="cp-empty"><i data-lucide="route"></i>
                This airline hasn’t published any routes yet.</div>`;
            icons(); return;
        }

        const rows = visible();
        body.innerHTML = `
            ${barHtml()}
            ${rows.length
                ? `<ul class="cn-list">${rows.map(rowHtml).join('')}</ul>`
                : `<div class="cp-empty"><i data-lucide="search-x"></i>Nothing in the network matches that.</div>`}`;
        wire();
        icons();
    }

    function barHtml() {
        // Progress counts the whole network, never the filtered view — a bar
        // that moved when you pressed a filter would be measuring the filter.
        const total = S.routes.length;
        const done = S.routes.filter((r) => S.flown.has(legKey(r.origin, r.destination))).length;
        const pct = total ? Math.round((done / total) * 100) : 0;
        return `<div class="cn-bar">
            ${S.flown.size ? `
                <div>
                    <p class="cp-note" style="margin-bottom:.35rem">${done} of ${total} routes flown${pct ? ` · ${pct}%` : ''}</p>
                    <div class="cn-progress"><span style="width:${pct}%"></span></div>
                </div>` : `<p class="cp-note">${total} ${total === 1 ? 'route' : 'routes'} in the network.</p>`}
            <input class="cp-input" id="cnSearch" placeholder="Search a flight number, airport or aircraft…"
                autocomplete="off" value="${esc(S.query)}">
            <div class="cn-filters">${FILTERS.map((f) => `
                <button class="cn-filter" data-cn-filter="${f.id}" aria-pressed="${f.id === S.filter}">${esc(f.label)}</button>`).join('')}</div>
        </div>`;
    }

    function rowHtml(r) {
        const flown = S.flown.has(legKey(r.origin, r.destination));
        const sub = [r.aircraft, r.kind === 'codeshare' ? r.partnerName : '', r.notes]
            .filter(Boolean).join(' · ');
        const tags = [];
        if (flown) tags.push('<span class="cp-chip cp-chip-ok">Flown</span>');
        if (r.kind === 'codeshare') tags.push('<span class="cp-chip cp-chip-mute">Codeshare</span>');
        if (r.locked) {
            // The hours are the point. A locked route with no number beside it
            // is a closed door; with one it is a target.
            const h = Math.round(Number(r.hoursUntilUnlock) || 0);
            tags.push(`<span class="cp-chip cp-chip-warn">${h > 0
                ? `${h}h to ${esc(r.minRank || 'unlock')}`
                : esc(r.minRank ? `${r.minRank} only` : 'Locked')}</span>`);
        }
        return `<li class="cn-row${r.locked ? ' cn-row-locked' : ''}${flown ? ' cn-row-flown' : ''}">
            <span class="cn-main">
                <span class="cn-leg">${esc(r.flightNumber || '')}${r.flightNumber ? ' · ' : ''}${esc(r.origin || '???')} → ${esc(r.destination || '???')}</span>
                <span class="cn-sub">${esc(sub) || '&nbsp;'}</span>
                ${tags.length ? `<span class="cn-tags">${tags.join('')}</span>` : ''}
            </span>
            ${r.distanceNm ? `<span class="cn-dist">${Number(r.distanceNm).toLocaleString()} nm</span>` : ''}
        </li>`;
    }

    /* =====================================================================
     * WIRING — delegated; the body is replaced on every render. The search
     * box is the exception: re-rendering it under the cursor would lose the
     * caret, so it keeps focus and its own listener across renders.
     * =================================================================== */

    function wire() {
        const body = S.panel.body;
        const search = body.querySelector('#cnSearch');
        if (search && body.dataset.cnFocus === '1') {
            search.focus();
            search.setSelectionRange(search.value.length, search.value.length);
        }
        if (body.dataset.cnWired) return;
        body.dataset.cnWired = '1';
        body.addEventListener('click', (ev) => {
            const f = ev.target.closest('[data-cn-filter]');
            if (f) {
                S.filter = f.getAttribute('data-cn-filter');
                body.dataset.cnFocus = '0';
                render();
            }
        });
        body.addEventListener('input', (ev) => {
            if (ev.target.id !== 'cnSearch') return;
            S.query = ev.target.value;
            body.dataset.cnFocus = '1';
            render();
        });
    }

    /* =====================================================================
     * PUBLIC
     * =================================================================== */

    /**
     * Open the network.
     *
     * `flown` is whatever the host already knows about this pilot's flights —
     * the pilot home has them loaded for its own logbook, so asking the server
     * a second time would be a second round trip for a fact already on the
     * page. Anything array-like of `{origin, destination}` works; approved-only
     * filtering is the caller's business, because only the caller knows whether
     * a pending report should count as flown.
     */
    function open({ api, flown, title } = {}) {
        if (typeof api !== 'function') { console.warn('crewNetwork: needs an api function'); return; }
        styles();
        S.api = api;
        S.flown = new Set((flown || []).map((f) => legKey(f.origin, f.destination)));
        S.filter = 'all';
        S.query = '';
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewNetwork', title: title || 'Route network', icon: 'route', wide: true });
        }
        S.panel.open();
        if (S.panel.body) S.panel.body.dataset.cnFocus = '0';
        load();
    }

    window.CrewNetwork = { open, close: () => S.panel && S.panel.close() };
})();
