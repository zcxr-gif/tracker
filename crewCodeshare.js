/* ============================================================================
   crewCodeshare.js — codeshares agreed between crew centres, and the hubs.

   WHAT IT DRAWS

     • PARTNERS   every airline this one codeshares with: how much each side
                  flies of the other's network, when it last synced, and the four
                  things a VA does to
                  an agreement — choose routes, sync, download, end.
     • REQUESTS   what other airlines have asked, and what this one has asked
                  them. An incoming request opens a review: tick what they may
                  fly of yours, tick what your pilots will fly of theirs, accept.
     • FIND       every other airline on the platform with a crew centre. Pick
                  one, tick their routes you want your pilots to fly (or "all of them"),
                  offer some of yours back if you like, send.

   And a small second sheet, CrewHubs, for the airports the airline says it is
   based at — beside the codeshares because both are "the shape of the network"
   rather than any one route in it.

   THE ROUTE PICKER IS THE WHOLE UX

   Every screen here ends in the same question: which legs? So there is one
   picker, used five times, and it is built for networks of hundreds:

     All · Choose · None       — most agreements are "all of it", one tap
     a search box              — number, airport or aircraft
     airport chips             — "everything out of Oslo" in one tap
     select shown / clear      — acts on what the search left on screen

   A route the other airline has not allowed is drawn but cannot be ticked, and
   says why, rather than vanishing — "why can't we fly BR12?" has an answer.

   WHAT IT NEEDS FROM ITS HOST

       CrewCodeshare.open({ api, backend, slug, token })
       CrewHubs.open({ api, onSaved })

   `api` is CrewPanels.api(...); backend/slug/token are for the CSV downloads,
   which are files and not JSON. Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewCodeshare: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText } = P;

    const S = {
        api: null, conn: null, panel: null,
        tab: 'partners',
        data: null, loading: false, error: null,
        view: null,            // null = the tabbed list; otherwise { kind, … }
        dir: { q: '', list: null, loading: false, error: null, timer: 0 },
        mine: null,            // my own shareable routes, loaded once per open
        pick: {},              // route-picker state by key
    };

    /* ---------------------------------------------------------------------
     * Styles
     * ------------------------------------------------------------------- */
    function styles() {
        P.baseStyles();
        P.style('crew-codeshare', `
        .cs-tabs{ display:flex; gap:.25rem; padding:.25rem; border:1px solid var(--line,#e5e5e5);
            border-radius:.7rem; background:var(--surface,#fff); }
        .cs-tab{ flex:1; border:0; background:transparent; padding:.5rem .6rem; border-radius:.5rem;
            font-weight:700; font-size:.82rem; color:var(--muted,#736E64); cursor:pointer;
            display:inline-flex; align-items:center; justify-content:center; gap:.35rem; }
        .cs-tab[aria-selected="true"]{ background:var(--accent,#1C1A16); color:#fff; }
        .cs-badge{ min-width:1.15rem; height:1.15rem; padding:0 .3rem; border-radius:999px; font-size:.68rem;
            display:inline-grid; place-items:center; background:#D97706; color:#fff; }
        .cs-tab[aria-selected="true"] .cs-badge{ background:#fff; color:var(--accent,#1C1A16); }
        .cs-logo{ width:2.6rem; height:2.6rem; border-radius:.6rem; overflow:hidden; flex:none;
            border:1px solid var(--line,#e5e5e5); background:var(--surface,#fff); display:grid; place-items:center;
            font-weight:800; font-size:.8rem; }
        .cs-logo img{ width:100%; height:100%; object-fit:contain; border-radius:inherit; }
        .cs-row{ display:flex; align-items:center; gap:.75rem; }
        .cs-grow{ min-width:0; flex:1; }
        .cs-name{ font-weight:700; letter-spacing:-.01em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cs-actions{ display:flex; flex-wrap:wrap; gap:.4rem; margin-top:.75rem; }
        .cs-flow{ display:grid; grid-template-columns:1fr auto 1fr; gap:.5rem; align-items:center; margin-top:.7rem;
            font-size:.8rem; }
        .cs-flow .cs-side{ border:1px solid var(--line,#e5e5e5); border-radius:.6rem; padding:.5rem .6rem; }
        .cs-flow b{ display:block; font-size:1.05rem; letter-spacing:-.02em; }
        .cs-flow i{ width:1rem; height:1rem; color:var(--faint,#A8A296); }
        .cs-msg{ margin-top:.6rem; padding:.55rem .7rem; border-left:3px solid var(--accent,#1C1A16);
            background:color-mix(in srgb, var(--accent,#1C1A16) 6%, transparent); border-radius:.3rem; font-size:.84rem; }
        .cs-dir{ display:grid; gap:.5rem; }
        .cs-air{ width:100%; text-align:left; border:1px solid var(--line,#e5e5e5); border-radius:.75rem; padding:.65rem .75rem;
            background:var(--surface,#fff); cursor:pointer; color:inherit; font:inherit; }
        .cs-air:hover{ border-color:var(--ink,#1C1A16); }
        .cs-air:disabled{ cursor:default; opacity:.7; }
        .cs-back{ border:0; background:transparent; color:var(--muted,#736E64); font-weight:700; font-size:.8rem;
            cursor:pointer; display:inline-flex; align-items:center; gap:.3rem; padding:0; }
        .cs-back i{ width:1rem; height:1rem; }
        .cs-step{ font-size:.7rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--faint,#A8A296); }
        .cs-toggle{ display:flex; align-items:flex-start; gap:.6rem; font-size:.85rem; cursor:pointer; }
        .cs-toggle input{ margin-top:.2rem; accent-color:var(--accent); }

        /* The picker */
        .pk{ border:1px solid var(--line,#e5e5e5); border-radius:.75rem; overflow:hidden; }
        .pk-head{ padding:.7rem .75rem; display:grid; gap:.55rem; border-bottom:1px solid var(--line,#e5e5e5); }
        .pk-title{ font-weight:700; font-size:.9rem; display:flex; justify-content:space-between; gap:.5rem; align-items:baseline; }
        .pk-count{ font-size:.75rem; font-weight:600; color:var(--muted,#736E64); white-space:nowrap; }
        .pk-modes{ display:flex; gap:.25rem; }
        .pk-mode{ flex:1; border:1px solid var(--line,#e5e5e5); background:var(--surface,#fff); color:inherit; border-radius:.5rem;
            padding:.4rem .5rem; font-weight:700; font-size:.78rem; cursor:pointer; }
        .pk-mode[aria-pressed="true"]{ background:var(--accent,#1C1A16); border-color:transparent; color:#fff; }
        .pk-tools{ display:flex; gap:.4rem; align-items:center; flex-wrap:wrap; }
        .pk-tools .cp-input{ flex:1; min-width:9rem; }
        .pk-ports{ display:flex; gap:.3rem; overflow-x:auto; padding-bottom:.1rem; }
        .pk-port{ flex:none; border:1px solid var(--line,#e5e5e5); background:var(--surface,#fff); color:inherit;
            border-radius:999px; padding:.2rem .55rem; font-size:.72rem; font-weight:700; cursor:pointer; }
        .pk-port:hover{ border-color:var(--ink,#1C1A16); }
        .pk-list{ max-height:22rem; overflow-y:auto; }
        .pk-item{ display:flex; align-items:center; gap:.6rem; padding:.45rem .75rem; border-top:1px solid var(--line,#e5e5e5);
            font-size:.84rem; cursor:pointer; }
        .pk-item:first-child{ border-top:0; }
        .pk-item input{ accent-color:var(--accent); width:1rem; height:1rem; flex:none; }
        .pk-item.pk-off{ opacity:.5; cursor:not-allowed; }
        .pk-leg{ font-weight:700; letter-spacing:-.01em; }
        .pk-meta{ font-size:.72rem; color:var(--muted,#736E64); margin-left:auto; text-align:right; white-space:nowrap; }
        .pk-all{ padding:.9rem .75rem; font-size:.84rem; color:var(--muted,#736E64); }
        .pk-more{ padding:.6rem .75rem; font-size:.78rem; color:var(--muted,#736E64); border-top:1px solid var(--line,#e5e5e5); }

        /* Hubs */
        .hb-row{ display:grid; grid-template-columns:5.5rem 1fr 7rem auto; gap:.4rem; align-items:center; }
        @media (max-width:560px){ .hb-row{ grid-template-columns:4.8rem 1fr auto; } .hb-row .cp-select{ grid-column:1 / 3; } }
        `);
    }

    /* ---------------------------------------------------------------------
     * Helpers
     * ------------------------------------------------------------------- */

    const logoHtml = (p) => (p && p.logo && P.safeUrl(p.logo)
        ? `<span class="cs-logo"><img src="${esc(p.logo)}" alt="" loading="lazy"></span>`
        : `<span class="cs-logo">${esc(String((p && p.name) || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</span>`);

    const selText = (sel, total) => {
        if (!sel || sel.mode === 'none') return 'nothing';
        if (sel.mode === 'all') return total != null ? `all ${total}` : 'all routes';
        const n = (sel.routeIds || []).length;
        return `${n} route${n === 1 ? '' : 's'}`;
    };

    const legOf = (r) => `${r.origin || '—'} → ${r.destination || '—'}`;

    async function download(path, { method = 'GET', body = null, name = 'routes.csv' } = {}) {
        const c = S.conn || {};
        const t = typeof c.token === 'function' ? c.token() : String(c.token || '');
        const res = await fetch(`${String(c.backend || '').replace(/\/+$/, '')}/api/crew/${encodeURIComponent(String(c.slug || '').toLowerCase())}${path}`, {
            method,
            headers: { ...(t ? { Authorization: 'Bearer ' + t } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            throw new Error(d.error || 'Could not download that.');
        }
        const blob = await res.blob();
        const m = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = (m && m[1]) || name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async function withBusy(btn, label, fn) {
        const done = P.busy(btn, label);
        try { return await fn(); } catch (err) { P.toast(err.message || 'That didn’t work.', 'bad'); return null; } finally { done(); }
    }

    /* =====================================================================
     * THE ROUTE PICKER
     * =================================================================== */

    const MAX_DRAWN = 300;

    function picker(key, { title, hint = '', routes = [], sel = { mode: 'all', routeIds: [] }, allowed = null, modes = ['all', 'selected', 'none'], labels = {} }) {
        const prev = S.pick[key];
        // A redraw of the same step keeps what the reader has ticked; only a
        // new list of routes (a new step) starts from `sel`.
        const same = prev && prev.routes === routes;
        S.pick[key] = {
            title, hint, routes, allowed, modes, labels,
            sel: same ? prev.sel : { mode: (sel && sel.mode) || 'none', routeIds: [...((sel && sel.routeIds) || [])] },
            q: same ? prev.q : '',
        };
        return `<div class="pk" id="pk-${esc(key)}">${pickerInner(key)}</div>`;
    }

    const allowedSet = (pk) => (pk.allowed && pk.allowed.mode === 'selected' ? new Set(pk.allowed.routeIds) : null);
    const isAllowed = (pk, id) => {
        if (!pk.allowed || pk.allowed.mode === 'all') return true;
        if (pk.allowed.mode === 'none') return false;
        return allowedSet(pk).has(String(id));
    };
    const eligible = (pk) => pk.routes.filter((r) => isAllowed(pk, r.id));

    function shown(pk) {
        const q = pk.q.trim().toLowerCase();
        if (!q) return pk.routes;
        return pk.routes.filter((r) => [r.flightNumber, r.origin, r.destination, r.aircraft]
            .some((v) => String(v || '').toLowerCase().includes(q)));
    }

    function countLine(pk) {
        const total = eligible(pk).length;
        if (pk.sel.mode === 'all') return `${total} of ${total}`;
        if (pk.sel.mode === 'none') return `0 of ${total}`;
        return `${pk.sel.routeIds.length} of ${total}`;
    }

    function pickerInner(key) {
        const pk = S.pick[key];
        const label = (m) => pk.labels[m] || ({ all: 'All of them', selected: 'Choose', none: 'None' }[m]);
        const head = `<div class="pk-head">
            <div class="pk-title"><span>${esc(pk.title)}</span><span class="pk-count" data-pk-count>${esc(countLine(pk))}</span></div>
            ${pk.hint ? `<div class="cp-note">${esc(pk.hint)}</div>` : ''}
            <div class="pk-modes">${pk.modes.map((m) => `<button type="button" class="pk-mode" data-pk="${esc(key)}" data-pk-mode="${m}" aria-pressed="${pk.sel.mode === m}">${esc(label(m))}</button>`).join('')}</div>
            ${pk.sel.mode === 'selected' ? toolsHtml(key, pk) : ''}
        </div>`;
        let body;
        if (!pk.routes.length) body = `<div class="pk-all">No routes to choose from yet.</div>`;
        else if (pk.sel.mode === 'all') {
            body = `<div class="pk-all">Every one of ${eligible(pk).length} route${eligible(pk).length === 1 ? '' : 's'}${pk.allowed && pk.allowed.mode !== 'all' ? ' they allow' : ''} — and any added later${pk.allowed && pk.allowed.mode === 'selected' ? ' that they allow' : ''}.</div>`;
        } else if (pk.sel.mode === 'none') {
            body = `<div class="pk-all">Nothing.</div>`;
        } else {
            body = `<div class="pk-list" data-pk-list="${esc(key)}">${listHtml(key)}</div>`;
        }
        return head + body;
    }

    function toolsHtml(key, pk) {
        // The busiest airports on the list, as one-tap selections.
        const n = new Map();
        for (const r of eligible(pk)) for (const a of [r.origin, r.destination]) if (a) n.set(a, (n.get(a) || 0) + 1);
        const ports = [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
        return `<div class="pk-tools">
                <input class="cp-input" type="search" placeholder="Search number, airport, aircraft" value="${esc(pk.q)}" data-pk-q="${esc(key)}" aria-label="Search routes">
                <button type="button" class="cp-btn cp-btn-sm" data-pk="${esc(key)}" data-pk-shown="1">Tick shown</button>
                <button type="button" class="cp-btn cp-btn-sm" data-pk="${esc(key)}" data-pk-clear="1">Clear</button>
            </div>
            ${ports.length > 1 ? `<div class="pk-ports" aria-label="Tick everything at an airport">${ports.map(([code, c]) => `<button type="button" class="pk-port" data-pk="${esc(key)}" data-pk-port="${esc(code)}" title="Tick every route at ${esc(code)}">${esc(code)} · ${c}</button>`).join('')}</div>` : ''}`;
    }

    function listHtml(key) {
        const pk = S.pick[key];
        const on = new Set(pk.sel.routeIds);
        const list = shown(pk);
        if (!list.length) return `<div class="pk-all">Nothing matches “${esc(pk.q)}”.</div>`;
        return list.slice(0, MAX_DRAWN).map((r) => {
            const ok = isAllowed(pk, r.id);
            return `<label class="pk-item ${ok ? '' : 'pk-off'}" ${ok ? '' : 'title="Not offered to you by this airline"'}>
                <input type="checkbox" data-pk="${esc(key)}" data-pk-id="${esc(r.id)}" ${on.has(String(r.id)) && ok ? 'checked' : ''} ${ok ? '' : 'disabled'}>
                <span class="pk-leg">${esc(legOf(r))}</span>
                <span class="cp-faint" style="font-size:.75rem">${esc(r.flightNumber || '')}</span>
                <span class="pk-meta">${esc(r.aircraft || '')}${r.distanceNm ? ` · ${Math.round(r.distanceNm)} nm` : ''}${ok ? '' : ' · not offered'}</span>
            </label>`;
        }).join('') + (list.length > MAX_DRAWN ? `<div class="pk-more">${list.length - MAX_DRAWN} more — search to narrow the list. “Tick shown” still ticks all ${list.length}.</div>` : '');
    }

    function redrawPicker(key, { listOnly = false } = {}) {
        const host = document.getElementById(`pk-${key}`);
        if (!host) return;
        const pk = S.pick[key];
        const cnt = host.querySelector('[data-pk-count]');
        if (cnt) cnt.textContent = countLine(pk);
        if (listOnly) {
            const l = host.querySelector('[data-pk-list]');
            if (l) { l.innerHTML = listHtml(key); return; }
        }
        host.innerHTML = pickerInner(key);
        try { icons(); } catch (_) {}
    }

    /** A picker's answer, in the shape the server takes. */
    function pickerValue(key) {
        const pk = S.pick[key];
        if (!pk) return { mode: 'none', routeIds: [] };
        if (pk.sel.mode !== 'selected') return { mode: pk.sel.mode, routeIds: [] };
        const ids = pk.sel.routeIds.filter((id) => isAllowed(pk, id));
        return ids.length ? { mode: 'selected', routeIds: ids } : { mode: 'none', routeIds: [] };
    }

    function onPickerClick(ev) {
        const t = ev.target.closest('[data-pk]');
        if (!t || t.matches('input[type="search"]')) return false;
        const key = t.getAttribute('data-pk');
        const pk = S.pick[key];
        if (!pk) return false;
        if (t.hasAttribute('data-pk-mode')) {
            const m = t.getAttribute('data-pk-mode');
            // Switching to "choose" from "all" starts with everything ticked:
            // the common edit is "all of it except these three".
            if (m === 'selected' && pk.sel.mode === 'all') pk.sel.routeIds = eligible(pk).map((r) => String(r.id));
            pk.sel.mode = m;
            redrawPicker(key);
            return true;
        }
        if (t.hasAttribute('data-pk-id')) {
            const id = t.getAttribute('data-pk-id');
            const set = new Set(pk.sel.routeIds);
            if (t.checked) set.add(id); else set.delete(id);
            pk.sel.routeIds = [...set];
            redrawPicker(key, { listOnly: true });
            return true;
        }
        if (t.hasAttribute('data-pk-shown')) {
            const set = new Set(pk.sel.routeIds);
            for (const r of shown(pk)) if (isAllowed(pk, r.id)) set.add(String(r.id));
            pk.sel.routeIds = [...set];
            redrawPicker(key, { listOnly: true });
            return true;
        }
        if (t.hasAttribute('data-pk-clear')) {
            const drop = new Set(shown(pk).map((r) => String(r.id)));
            pk.sel.routeIds = pk.q.trim() ? pk.sel.routeIds.filter((id) => !drop.has(id)) : [];
            redrawPicker(key, { listOnly: true });
            return true;
        }
        if (t.hasAttribute('data-pk-port')) {
            const code = t.getAttribute('data-pk-port');
            const set = new Set(pk.sel.routeIds);
            for (const r of eligible(pk)) if (r.origin === code || r.destination === code) set.add(String(r.id));
            pk.sel.routeIds = [...set];
            redrawPicker(key, { listOnly: true });
            return true;
        }
        return false;
    }

    function onPickerInput(ev) {
        const t = ev.target.closest('[data-pk-q]');
        if (!t) return;
        const key = t.getAttribute('data-pk-q');
        if (!S.pick[key]) return;
        S.pick[key].q = t.value;
        redrawPicker(key, { listOnly: true });
    }

    /* =====================================================================
     * LOADING
     * =================================================================== */

    async function load() {
        S.loading = true; S.error = null;
        draw();
        const [main, ext] = await Promise.all([
            S.api('/codeshare').then((d) => ({ d }), (err) => ({ err })),
            S.api('/codeshare/external').then((d) => ({ d }), (err) => ({ err })),
        ]);
        if (main.err) S.error = main.err; else S.data = main.d;
        S.ext = ext.err ? { list: [], error: ext.err } : { list: ext.d.partners || [], error: null, max: ext.d.max };
        S.loading = false;
        draw();
        P.emit('codeshare:counts', { incoming: S.data ? S.data.incoming : 0 });
    }

    async function myRoutes() {
        if (S.mine) return S.mine;
        const d = await S.api('/routes');
        S.mine = (d.routes || []).filter((r) => r.kind !== 'codeshare' && r.active !== false && r.origin && r.destination);
        return S.mine;
    }

    async function searchDir() {
        const q = S.dir.q;
        S.dir.loading = true; S.dir.error = null;
        drawDirList();
        try {
            const d = await S.api(`/codeshare/directory?q=${encodeURIComponent(q)}`);
            if (q !== S.dir.q) return;
            S.dir.list = d.airlines || [];
        } catch (err) { S.dir.error = err; }
        S.dir.loading = false;
        drawDirList();
    }

    /* =====================================================================
     * DRAWING
     * =================================================================== */

    function draw() {
        if (!S.panel) return;
        P.keepPlace(S.panel.body, () => {
            S.panel.body.innerHTML = S.view ? viewHtml() : listHtmlAll();
            try { icons(); } catch (_) {}
        }, S.view ? S.view.kind : S.tab);
    }

    function listHtmlAll() {
        if (!S.data && S.loading) return `<p class="cp-note" style="text-align:center;padding:2rem 0">Reading your codeshares…</p>`;
        if (S.error && !S.data) {
            if (S.error.status === 404) return P.notBuiltHtml('Codeshare agreements');
            if (P.isSchemaGap(S.error)) return P.schemaGapHtml(S.error);
            return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>${esc(S.error.message || 'Those could not be read.')}</div>`;
        }
        if (!S.data) return '';
        const all = S.data.agreements || [];
        const active = all.filter((a) => a.status === 'active');
        const waiting = all.filter((a) => a.status === 'pending');
        const incoming = waiting.filter((a) => a.canAccept).length;
        const tab = (id, label, icon, badge) => `<button type="button" class="cs-tab" role="tab" data-cs-tab="${id}" aria-selected="${S.tab === id}">
            <i data-lucide="${icon}" style="width:1rem;height:1rem"></i>${esc(label)}${badge ? ` <span class="cs-badge">${badge}</span>` : ''}</button>`;
        let body = '';
        if (S.tab === 'partners') body = partnersHtml(active);
        else if (S.tab === 'requests') body = requestsHtml(all);
        else if (S.tab === 'outside') body = outsideHtml();
        else body = findHtml();
        const outside = (S.ext && S.ext.list) ? S.ext.list.length : 0;
        return `<div class="cs-tabs" role="tablist">
                ${tab('partners', `Partners${active.length ? ` · ${active.length}` : ''}`, 'handshake', 0)}
                ${tab('requests', 'Requests', 'inbox', incoming)}
                ${tab('find', 'Find a partner', 'search', 0)}
                ${tab('outside', `Outside airlines${outside ? ` · ${outside}` : ''}`, 'globe', 0)}
            </div>
            ${S.data.schemaLinks === false ? `<div class="cp-card cp-note cp-note-warn">Your database is on an older version, so codeshares can be added and updated but not tidied away when a partner drops a route. <button class="cp-btn cp-btn-sm" data-cp-fix-store style="margin-left:.4rem">Update my database</button></div>` : ''}
            ${body}`;
    }

    function syncLine(a) {
        const s = a.mySync || {};
        if (s.error) return `<div class="cp-note cp-note-warn" style="margin-top:.5rem"><i data-lucide="triangle-alert" style="width:.9rem;height:.9rem;vertical-align:-2px"></i> ${esc(s.error)}</div>`;
        if (!s.at) return '';
        return `<div class="cp-note" style="margin-top:.5rem">Synced ${esc(relativeText(s.at))}${s.added || s.updated || s.removed ? ` · last time ${[s.added && `${s.added} added`, s.updated && `${s.updated} updated`, s.removed && `${s.removed} removed`].filter(Boolean).join(', ')}` : ''}. Their changes follow on their own.</div>`;
    }

    function partnersHtml(active) {
        const exportRow = `<div class="cp-card">
            <div class="cp-card-title" style="margin-bottom:.35rem">Take it out</div>
            <div class="cp-note" style="margin-bottom:.6rem">A spreadsheet of the partner flights on your network — or one sheet with every airline in it, which imports straight back.</div>
            <div class="cs-actions" style="margin-top:0">
                <button type="button" class="cp-btn cp-btn-sm" data-cs-export="codeshare"><i data-lucide="download"></i> All our codeshares</button>
                <button type="button" class="cp-btn cp-btn-sm" data-cs-export="combined"><i data-lucide="sheet"></i> Combined sheet — every airline</button>
            </div>
        </div>`;
        const settings = `<label class="cs-toggle cp-card"><input type="checkbox" data-cs-open ${S.data.open ? 'checked' : ''}>
            <span><b>Let other airlines ask us</b><br><span class="cp-note">Off hides ${esc((S.data.me && S.data.me.name) || 'your airline')} from the partner search. Agreements you already have carry on.</span></span></label>`;
        if (!active.length) {
            return `<div class="cp-empty"><i data-lucide="handshake"></i>
                    No codeshares yet. Another airline’s routes flown by your pilots — and yours by theirs — kept up to date on their own.
                    <div style="margin-top:.9rem"><button type="button" class="cp-btn cp-btn-primary" data-cs-tab="find"><i data-lucide="search"></i> Find a partner</button></div>
                </div>${settings}${exportRow}`;
        }
        return active.map((a) => `<div class="cp-card" data-cs-id="${esc(a.id)}">
                <div class="cs-row">
                    ${logoHtml(a.partner)}
                    <div class="cs-grow">
                        <div class="cs-name">${esc(a.partner.name)}</div>
                        <div class="cp-note">Partners since ${esc(relativeText(a.decidedAt || a.createdAt))}${a.partner.slug ? ` · <a href="/crew/${encodeURIComponent(a.partner.slug)}" target="_blank" rel="noopener" class="cp-muted">their crew centre ↗</a>` : ''}</div>
                    </div>
                </div>
                <div class="cs-flow">
                    <div class="cs-side"><b>${a.linkedRoutes != null ? a.linkedRoutes : '—'}</b>of their flights on your network <span class="cp-faint">(${esc(selText(a.iTake))})</span></div>
                    <i data-lucide="arrow-left-right"></i>
                    <div class="cs-side"><b>${a.theirSync && a.theirSync.routes != null ? a.theirSync.routes : '—'}</b>of yours on theirs <span class="cp-faint">(${esc(selText(a.theyTake))})</span></div>
                </div>
                ${syncLine(a)}
                <div class="cs-actions">
                    <button type="button" class="cp-btn cp-btn-sm cp-btn-primary" data-cs-edit><i data-lucide="list-checks"></i> Choose routes</button>
                    <button type="button" class="cp-btn cp-btn-sm" data-cs-sync><i data-lucide="refresh-cw"></i> Sync now</button>
                    <button type="button" class="cp-btn cp-btn-sm" data-cs-export="partner" data-name="${esc(a.partner.name)}"><i data-lucide="download"></i> These codeshares</button>
                    <button type="button" class="cp-btn cp-btn-sm cp-btn-bad" data-cs-end><i data-lucide="unlink"></i> End</button>
                </div>
            </div>`).join('') + settings + exportRow;
    }

    function requestsHtml(all) {
        const incoming = all.filter((a) => a.status === 'pending' && a.canAccept);
        const outgoing = all.filter((a) => a.status === 'pending' && !a.canAccept);
        const past = all.filter((a) => ['declined', 'withdrawn', 'ended'].includes(a.status)).slice(0, 20);
        const card = (a, buttons) => `<div class="cp-card" data-cs-id="${esc(a.id)}">
                <div class="cs-row">${logoHtml(a.partner)}
                    <div class="cs-grow"><div class="cs-name">${esc(a.partner.name)}</div>
                        <div class="cp-note">${a.direction === 'incoming' ? 'Asked' : 'You asked'} ${esc(relativeText(a.createdAt))}${a.requestedBy && a.direction === 'incoming' ? ` · ${esc(a.requestedBy)}` : ''}</div></div>
                    ${a.status !== 'pending' ? `<span class="cp-chip cp-chip-mute">${esc(a.status)}</span>` : ''}
                </div>
                <div class="cp-note" style="margin-top:.55rem">${a.direction === 'incoming'
                    ? `Their pilots would fly <b>${esc(selText(a.theyTake))}</b> of yours, and offer you <b>${esc(selText(a.iWant))}</b> of theirs.`
                    : `You asked to fly <b>${esc(selText(a.iWant))}</b> of theirs, and offered <b>${esc(selText(a.iAllowThem))}</b> of yours.`}</div>
                ${a.message ? `<div class="cs-msg">“${esc(a.message)}”</div>` : ''}
                ${a.reply ? `<div class="cs-msg">Reply: “${esc(a.reply)}”</div>` : ''}
                ${buttons ? `<div class="cs-actions">${buttons}</div>` : ''}
            </div>`;
        let html = '';
        html += `<div class="cs-step">Waiting on you</div>`;
        html += incoming.length ? incoming.map((a) => card(a,
            `<button type="button" class="cp-btn cp-btn-sm cp-btn-primary" data-cs-review><i data-lucide="list-checks"></i> Review &amp; accept</button>
             <button type="button" class="cp-btn cp-btn-sm" data-cs-decline>Decline</button>`)).join('')
            : `<p class="cp-note">Nothing waiting. Requests other airlines send you land here, and in your Discord route feed.</p>`;
        html += `<div class="cs-step" style="margin-top:.4rem">Waiting on them</div>`;
        html += outgoing.length ? outgoing.map((a) => card(a, `<button type="button" class="cp-btn cp-btn-sm" data-cs-withdraw>Withdraw</button>`)).join('')
            : `<p class="cp-note">You have no requests out.</p>`;
        if (past.length) {
            html += `<details class="cp-card"><summary class="cp-note" style="cursor:pointer">Earlier (${past.length})</summary><div style="display:grid;gap:.6rem;margin-top:.6rem">${past.map((a) => card(a, '')).join('')}</div></details>`;
        }
        return html;
    }

    function findHtml() {
        return `<div class="cp-card">
                <label class="cp-label" for="csDirQ">Find an airline on Inflight</label>
                <input id="csDirQ" class="cp-input" type="search" placeholder="Name, callsign or crew centre handle" value="${esc(S.dir.q)}" autocomplete="off">
                <div class="cp-note" style="margin-top:.45rem">Every airline with a crew centre that takes requests. You choose which of their routes your pilots would fly; they choose what they allow, and can offer yours back.</div>
            </div>
            <div class="cs-dir" id="csDirList">${dirListHtml()}</div>`;
    }

    function dirListHtml() {
        if (S.dir.loading && !S.dir.list) return `<p class="cp-note" style="text-align:center;padding:1rem 0">Searching…</p>`;
        if (S.dir.error) return `<div class="cp-empty"><i data-lucide="triangle-alert"></i>${esc(S.dir.error.message)}</div>`;
        const list = S.dir.list || [];
        if (!list.length) return `<p class="cp-note" style="text-align:center;padding:1rem 0">${S.dir.q ? 'No airline matches that.' : 'No other airlines are taking requests yet.'}</p>`;
        const tag = { active: ['Partners already', 'cp-chip-ok'], requested: ['Request sent', 'cp-chip-mute'], incoming: ['They asked you', 'cp-chip-warn'] };
        return list.map((a) => `<button type="button" class="cs-air" data-cs-pick="${esc(a.slug)}" ${a.standing === 'active' || a.standing === 'requested' ? 'disabled' : ''}>
                <span class="cs-row">${logoHtml(a)}
                    <span class="cs-grow"><span class="cs-name" style="display:block">${esc(a.name)}</span>
                        <span class="cp-note" style="display:block">${esc([a.callsign, a.country].filter(Boolean).join(' · '))}${a.tagline ? ` — ${esc(a.tagline)}` : ''}</span></span>
                    ${a.standing ? `<span class="cp-chip ${tag[a.standing][1]}">${tag[a.standing][0]}</span>` : '<i data-lucide="chevron-right" style="width:1rem;height:1rem" class="cp-faint"></i>'}
                </span></button>`).join('');
    }

    function drawDirList() {
        const host = S.panel && S.panel.body.querySelector('#csDirList');
        if (!host) return;
        host.innerHTML = dirListHtml();
        try { icons(); } catch (_) {}
    }

    /* =====================================================================
     * OUTSIDE AIRLINES
     *
     * Partners who run their crew centre somewhere else — vAMSYS, phpVMS,
     * VAM, a spreadsheet. There is no request to accept: staff here add them,
     * point at the route list they publish (or upload it), and hand them back
     * a private feed address listing whatever of ours they may fly. Their
     * list is re-read every few hours; a feed that fails or comes back empty
     * removes nothing.
     * =================================================================== */

    const PLATFORM_NAMES = { vamsys: 'vAMSYS', phpvms: 'phpVMS', vam: 'VAM', fsairlines: 'FSAirlines', sheet: 'A spreadsheet', website: 'Their own website', other: 'Somewhere else' };
    const EXT_MAX_BYTES = 4 * 1024 * 1024;
    const extById = (id) => ((S.ext && S.ext.list) || []).find((p) => p.id === id);

    function extSyncLine(p) {
        const s = p.lastSync || {};
        if (!p.active) return `<div class="cp-note" style="margin-top:.5rem">Paused — their flights stay on your network but are not re-read.</div>`;
        if (s.error) return `<div class="cp-note cp-note-warn" style="margin-top:.5rem"><i data-lucide="triangle-alert" style="width:.9rem;height:.9rem;vertical-align:-2px"></i> ${esc(s.error)}${s.at ? ` <span class="cp-faint">(${esc(relativeText(s.at))})</span>` : ''} Nothing was removed.</div>`;
        if (!s.at) return `<div class="cp-note" style="margin-top:.5rem">${p.feedUrl ? 'Not read yet — press Sync now.' : 'No routes yet — upload their spreadsheet, or add the address of their route list.'}</div>`;
        const moved = [s.created && `${s.created} added`, s.updated && `${s.updated} updated`, s.removed && `${s.removed} removed`].filter(Boolean).join(', ');
        return `<div class="cp-note" style="margin-top:.5rem">Read ${esc(relativeText(s.at))}${moved ? ` · ${esc(moved)}` : ''}.${p.feedUrl && p.autoSync ? ' Re-read every 6 hours.' : ''}</div>`;
    }

    function outsideHtml() {
        const E = S.ext || { list: [] };
        const off = E.error && E.error.status === 404;
        const intro = `<div class="cp-card">
            <div class="cs-row"><span class="cs-logo"><i data-lucide="globe" style="width:1.2rem;height:1.2rem"></i></span>
                <div class="cs-grow"><div class="cs-name">Airlines outside Inflight</div>
                <div class="cp-note">For partners whose crew centre is on vAMSYS, phpVMS, VAM, a spreadsheet or their own site. Point at their route list — or upload it — and their flights join your network as codeshares, kept up to date. They get a private address listing the routes of yours they may fly.</div></div></div>
            ${off ? '' : `<div class="cs-actions"><button type="button" class="cp-btn cp-btn-sm cp-btn-primary" data-ext-add ${E.max && E.list.length >= E.max ? 'disabled' : ''}><i data-lucide="plus"></i> Add an outside airline</button></div>`}
        </div>`;
        if (E.error) {
            if (off) return intro + `<p class="cp-note">Outside partners need the latest server — it is not switched on for this crew centre yet.</p>`;
            return intro + `<div class="cp-empty"><i data-lucide="triangle-alert"></i>${esc(E.error.message || 'Those could not be read.')}</div>`;
        }
        if (!E.list.length) return intro;
        return intro + E.list.map((p) => `<div class="cp-card" data-ext-id="${esc(p.id)}">
                <div class="cs-row">
                    ${logoHtml(p)}
                    <div class="cs-grow">
                        <div class="cs-name">${esc(p.name)}</div>
                        <div class="cp-note">${esc(PLATFORM_NAMES[p.platform] || 'Outside Inflight')}${p.website && P.safeUrl(p.website) ? ` · <a href="${esc(p.website)}" target="_blank" rel="noopener" class="cp-muted">their site ↗</a>` : ''}</div>
                    </div>
                    ${p.active ? '' : '<span class="cp-chip cp-chip-mute">Paused</span>'}
                </div>
                <div class="cs-flow">
                    <div class="cs-side"><b>${p.lastSync && p.lastSync.routes != null ? p.lastSync.routes : '—'}</b>of their flights on your network <span class="cp-faint">(${esc(selText(p.take))})</span></div>
                    <i data-lucide="arrow-left-right"></i>
                    <div class="cs-side"><b>${esc(selText(p.share))}</b>of yours in the feed you give them</div>
                </div>
                ${extSyncLine(p)}
                <div class="cp-note" style="margin-top:.55rem;overflow-wrap:anywhere">Reads from: ${p.feedUrl ? `<span class="cp-muted">${esc(p.feedUrl)}</span>` : 'an uploaded spreadsheet'}</div>
                <details style="margin-top:.55rem">
                    <summary class="cp-note" style="cursor:pointer;font-weight:700">Their copy of your routes</summary>
                    <div class="cp-note" style="margin:.45rem 0">Give ${esc(p.name)} one of these. It always lists exactly what you share with them — change the routes and the address stays the same. Most crew centres import the CSV; a Google Sheet pulls it live with <code>=IMPORTDATA("…csv")</code>.</div>
                    <div style="display:grid;gap:.35rem">
                        ${['csv', 'json'].map((f) => `<div class="cs-row" style="gap:.4rem"><input class="cp-input" readonly value="${esc(p.ourFeed[f])}" aria-label="${f.toUpperCase()} feed address" style="font-size:.75rem">
                            <button type="button" class="cp-btn cp-btn-sm" data-ext-copy="${f}"><i data-lucide="clipboard-copy"></i> ${f.toUpperCase()}</button></div>`).join('')}
                    </div>
                </details>
                <input type="file" hidden data-ext-file="sync" accept=".csv,.tsv,.txt,.json,.xlsx,.xlsm,.xls,.ods,text/csv,text/plain,application/json">
                <div class="cs-actions">
                    <button type="button" class="cp-btn cp-btn-sm cp-btn-primary" data-ext-edit><i data-lucide="list-checks"></i> Choose routes &amp; edit</button>
                    ${p.feedUrl ? `<button type="button" class="cp-btn cp-btn-sm" data-ext-sync><i data-lucide="refresh-cw"></i> Sync now</button>` : ''}
                    <button type="button" class="cp-btn cp-btn-sm" data-ext-upload><i data-lucide="upload"></i> Upload their sheet</button>
                    <button type="button" class="cp-btn cp-btn-sm" data-cs-export="partner" data-name="${esc(p.name)}"><i data-lucide="download"></i> These codeshares</button>
                    <button type="button" class="cp-btn cp-btn-sm" data-ext-pause>${p.active ? '<i data-lucide="pause"></i> Pause' : '<i data-lucide="play"></i> Resume'}</button>
                    <button type="button" class="cp-btn cp-btn-sm" data-ext-token title="The old address stops working at once"><i data-lucide="key-round"></i> New feed address</button>
                    <button type="button" class="cp-btn cp-btn-sm cp-btn-bad" data-ext-end><i data-lucide="unlink"></i> End</button>
                </div>
            </div>`).join('');
    }

    function extFormHtml(v) {
        const d = v.draft;
        const pv = v.preview;
        const src = v.upload ? `Uploaded ${esc(v.upload.name)}` : d.feedUrl ? 'Their feed' : '';
        const previewNote = v.previewing ? 'Reading their routes…'
            : v.previewError ? `<span class="cp-note-bad">${esc(v.previewError)}</span>`
                : pv ? `${src} · ${pv.total} route${pv.total === 1 ? '' : 's'} found${pv.errors ? ` · ${pv.errors} row${pv.errors === 1 ? '' : 's'} skipped (no airports)` : ''}.`
                    : v.partner ? 'Press “Check their routes” to choose from their list, or leave it on All.' : 'Add an address or upload a sheet to see their routes.';
        return `<div class="cp-card" style="display:grid;gap:.6rem">
                <div class="cs-row">${logoHtml({ name: d.name || '?', logo: d.logo })}<div class="cs-grow"><div class="cs-name">${esc(v.partner ? v.partner.name : 'A new outside partner')}</div>
                    <div class="cp-note">An airline whose crew centre is not on Inflight.</div></div></div>
                <div><label class="cp-label" for="extName">Airline name</label><input id="extName" class="cp-input" data-ext-f="name" maxlength="80" value="${esc(d.name)}" placeholder="e.g. Nordic Virtual"></div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:.6rem">
                    <div><label class="cp-label" for="extPlatform">Their crew centre runs on</label><select id="extPlatform" class="cp-select" data-ext-f="platform">${Object.entries(PLATFORM_NAMES).map(([k, n]) => `<option value="${k}" ${d.platform === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
                    <div><label class="cp-label" for="extSite">Website (optional)</label><input id="extSite" class="cp-input" data-ext-f="website" value="${esc(d.website)}" placeholder="https://"></div>
                    <div><label class="cp-label" for="extLogo">Logo address (optional)</label><input id="extLogo" class="cp-input" data-ext-f="logo" value="${esc(d.logo)}" placeholder="https://…/logo.png"></div>
                </div>
            </div>
            <div class="cs-step">1 · Where their routes come from</div>
            <div class="cp-card" style="display:grid;gap:.55rem">
                <div><label class="cp-label" for="extFeed">Address of their route list</label>
                    <div class="cs-row" style="gap:.4rem"><input id="extFeed" class="cp-input" data-ext-f="feedUrl" value="${esc(d.feedUrl)}" placeholder="https://… (CSV, JSON or a shared Google Sheet)">
                    <select class="cp-select" data-ext-f="format" aria-label="Format" style="width:auto">${['auto', 'csv', 'json'].map((f) => `<option value="${f}" ${d.format === f ? 'selected' : ''}>${f === 'auto' ? 'Detect' : f.toUpperCase()}</option>`).join('')}</select></div>
                    <div class="cp-note" style="margin-top:.35rem">A route export from their crew centre, or a Google Sheet shared “anyone with the link”. We re-read it every 6 hours.</div></div>
                <label class="cs-toggle"><input type="checkbox" data-ext-f="autoSync" ${d.autoSync ? 'checked' : ''}><span>Keep it up to date on its own</span></label>
                <div class="cs-actions" style="margin-top:0">
                    <button type="button" class="cp-btn cp-btn-sm" data-ext-check><i data-lucide="scan-search"></i> Check their routes</button>
                    <button type="button" class="cp-btn cp-btn-sm" data-ext-pickfile><i data-lucide="upload"></i> Or upload their spreadsheet</button>
                    <input type="file" hidden data-ext-file="form" multiple accept=".csv,.tsv,.txt,.json,.xlsx,.xlsm,.xls,.ods,text/csv,text/plain,application/json">
                </div>
                <div class="cp-note" data-ext-preview>${previewNote}</div>
            </div>
            <div class="cs-step">2 · Their flights your pilots fly</div>
            ${picker('extTake', { title: `${d.name || 'Their'} routes`, routes: pv ? pv.routes : v.noRoutes, sel: (S.pick.extTake && S.pick.extTake.sel) || (v.partner ? v.partner.take : { mode: 'all', routeIds: [] }), hint: '“All of them” keeps up as they add routes.' })}
            <div class="cs-step">3 · Your flights they may fly — optional</div>
            ${picker('extShare', { title: 'Your routes', routes: v.mine, sel: (S.pick.extShare && S.pick.extShare.sel) || (v.partner ? v.partner.share : { mode: 'none', routeIds: [] }), hint: 'These go in the private feed you give them. Only your own published legs — never a draft, never someone else’s codeshare.' })}
            <div><label class="cp-label" for="extNotes">Notes for your staff (optional)</label><textarea id="extNotes" class="cp-textarea" data-ext-f="notes" maxlength="500" placeholder="Who to talk to, what was agreed.">${esc(d.notes)}</textarea></div>
            <button type="button" class="cp-btn cp-btn-primary" data-ext-save style="justify-content:center"><i data-lucide="save"></i> ${v.partner ? 'Save and sync' : 'Add partner'}</button>`;
    }

    async function openExtForm(partner) {
        S.pick = {};
        const p = partner || {};
        S.view = {
            kind: 'ext-form', partner: partner || null, noRoutes: [], mine: [],
            draft: { name: p.name || '', logo: p.logo || '', website: p.website || '', platform: p.platform || 'other', feedUrl: p.feedUrl || '', format: p.format || 'auto', autoSync: p.autoSync !== false, notes: p.notes || '' },
            preview: null, previewing: false, previewError: '', upload: null,
        };
        draw();
        try {
            const mine = await myRoutes();
            if (S.view && S.view.kind === 'ext-form') { S.view.mine = mine; draw(); }
        } catch (_) {}
        // An existing partner opens with their list read, so "Choose" has
        // something in it.
        if (partner && partner.feedUrl) extPreview({ feedUrl: partner.feedUrl, format: partner.format });
    }

    async function extPreview(body, upload = null) {
        const v = S.view;
        if (!v || v.kind !== 'ext-form') return;
        v.previewing = true; v.previewError = '';
        draw();
        try {
            const d = await S.api('/codeshare/external/preview', { method: 'POST', body });
            if (S.view !== v) return;
            v.preview = { routes: d.routes || [], total: d.total || 0, errors: d.errors || 0 };
            v.upload = upload;
        } catch (err) { if (S.view === v) v.previewError = err.message || 'Those routes could not be read.'; }
        if (S.view !== v) return;
        v.previewing = false;
        draw();
    }

    // The same reading as the route import: CSV/JSON as text, every tab of a
    // workbook as a sheet of CSV.
    let xlsxReady = null;
    function loadXlsx() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        if (xlsxReady) return xlsxReady;
        const srcs = ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'];
        xlsxReady = new Promise((ok, no) => {
            const at = (i) => {
                if (i >= srcs.length) { xlsxReady = null; no(new Error('Could not load the spreadsheet reader. Save it as CSV and try again.')); return; }
                const s = document.createElement('script'); s.src = srcs[i]; s.async = true;
                s.onload = () => (window.XLSX ? ok(window.XLSX) : at(i + 1));
                s.onerror = () => { s.remove(); at(i + 1); };
                document.head.appendChild(s);
            };
            at(0);
        });
        return xlsxReady;
    }

    async function readSheetFiles(files) {
        if (!files.length) return null;
        if (files.reduce((n, f) => n + (f.size || 0), 0) > EXT_MAX_BYTES) throw new Error('That is more than 4 MB of spreadsheet — send just the routes tab.');
        const sheets = [];
        for (const file of files) {
            if (/\.(xlsx|xlsm|xls|ods)$/i.test(file.name)) {
                const X = await loadXlsx();
                const wb = X.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
                for (const name of wb.SheetNames) if (wb.Sheets[name] && wb.Sheets[name]['!ref']) sheets.push({ name, csv: X.utils.sheet_to_csv(wb.Sheets[name]) });
            } else sheets.push({ name: file.name, csv: await file.text() });
        }
        const name = files.length > 1 ? `${files.length} files` : files[0].name;
        // One plain file goes as `csv`, so a JSON export is read as JSON.
        return sheets.length === 1 ? { name, body: { csv: sheets[0].csv } } : { name, body: { sheets } };
    }

    function extSyncToast(s, name) {
        if (!s) return;
        if (s.error) { P.toast(s.error, 'bad'); return; }
        const moved = [s.created && `${s.created} added`, s.updated && `${s.updated} updated`, s.removed && `${s.removed} removed`].filter(Boolean).join(', ');
        P.toast(moved ? `${name}: ${moved}. ${s.routes} of their flights on your network.` : `${name} is up to date — ${s.routes} of their flights on your network.`, 'ok');
    }

    async function onExtFile(input) {
        const kind = input.getAttribute('data-ext-file');
        let got;
        try { got = await readSheetFiles([...(input.files || [])]); } catch (err) { P.toast(err.message, 'bad'); return; } finally { input.value = ''; }
        if (!got) return;
        if (kind === 'form') { extPreview(got.body, got); return; }
        const card = input.closest('[data-ext-id]');
        const p = card && extById(card.getAttribute('data-ext-id'));
        if (!p) return;
        const btn = card.querySelector('[data-ext-upload]');
        const res = await withBusy(btn, 'Reading…', () => S.api(`/codeshare/external/${encodeURIComponent(p.id)}/sync`, { method: 'POST', body: got.body }));
        if (!res) return;
        extSyncToast(res.sync, p.name);
        P.emit('routes:changed');
        load();
    }

    async function copyText(text) {
        try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (_) {}
        ta.remove();
        return ok;
    }

    /** Handles every data-ext-* button. True when it was one of them. */
    async function onExtClick(t) {
        if (![...t.attributes].some((a) => a.name.startsWith('data-ext-'))) return false;
        const card = t.closest('[data-ext-id]');
        const p = card ? extById(card.getAttribute('data-ext-id')) : null;
        const v = S.view && S.view.kind === 'ext-form' ? S.view : null;

        if (t.hasAttribute('data-ext-add')) { openExtForm(null); return true; }
        if (t.hasAttribute('data-ext-edit') && p) { openExtForm(p); return true; }
        if (t.hasAttribute('data-ext-copy') && p) {
            const ok = await copyText(p.ourFeed[t.getAttribute('data-ext-copy')]);
            P.toast(ok ? `Copied. Send it to ${p.name}.` : 'Could not copy — select the address and copy it.', ok ? 'ok' : 'bad');
            return true;
        }
        if (t.hasAttribute('data-ext-upload') && card) { const f = card.querySelector('[data-ext-file="sync"]'); if (f) f.click(); return true; }
        if (t.hasAttribute('data-ext-pickfile')) { const f = S.panel.body.querySelector('[data-ext-file="form"]'); if (f) f.click(); return true; }
        if (t.hasAttribute('data-ext-sync') && p) {
            const res = await withBusy(t, 'Reading their routes…', () => S.api(`/codeshare/external/${encodeURIComponent(p.id)}/sync`, { method: 'POST', body: {} }));
            if (!res) return true;
            extSyncToast(res.sync, p.name);
            P.emit('routes:changed');
            load();
            return true;
        }
        if (t.hasAttribute('data-ext-pause') && p) {
            const res = await withBusy(t, p.active ? 'Pausing…' : 'Resuming…', () => S.api(`/codeshare/external/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: { active: !p.active } }));
            if (res) { P.toast(p.active ? `${p.name} paused. Their flights stay; they are no longer re-read.` : `${p.name} resumed.`, 'ok'); load(); }
            return true;
        }
        if (t.hasAttribute('data-ext-token') && p) {
            if (!await P.ask({ title: 'Give them a new feed address?', body: `The address ${p.name} has now stops working at once. Send them the new one.`, confirm: 'New address' })) return true;
            const res = await withBusy(t, 'Working…', () => S.api(`/codeshare/external/${encodeURIComponent(p.id)}/token`, { method: 'POST' }));
            if (res) { P.toast('New address ready — copy it from “Their copy of your routes”.', 'ok'); load(); }
            return true;
        }
        if (t.hasAttribute('data-ext-end') && p) {
            if (!await P.ask({
                title: `End the codeshare with ${p.name}?`,
                body: 'Their flights come off your network and the feed you gave them stops working. Routes you added by hand are not touched.',
                confirm: 'End it', danger: true,
            })) return true;
            const res = await withBusy(t, 'Ending…', () => S.api(`/codeshare/external/${encodeURIComponent(p.id)}`, { method: 'DELETE' }));
            if (!res) return true;
            P.toast(`Ended. ${res.removed || 0} codeshare${res.removed === 1 ? '' : 's'} removed from your network.`, 'ok');
            P.emit('routes:changed');
            load();
            return true;
        }
        if (t.hasAttribute('data-ext-check') && v) {
            const url = v.draft.feedUrl.trim();
            if (!/^https:\/\//i.test(url)) { P.toast('Add the https:// address of their route list first — or upload their spreadsheet.', 'bad'); return true; }
            await extPreview({ feedUrl: url, format: v.draft.format });
            return true;
        }
        if (t.hasAttribute('data-ext-save') && v) {
            const d = v.draft;
            if (!d.name.trim()) { P.toast('Give the airline a name.', 'bad'); return true; }
            if (d.feedUrl.trim() && !/^https:\/\//i.test(d.feedUrl.trim())) { P.toast('Their route list needs an https:// address.', 'bad'); return true; }
            const body = {
                name: d.name.trim(), logo: d.logo.trim(), website: d.website.trim(), platform: d.platform,
                feedUrl: d.feedUrl.trim(), format: d.format, autoSync: d.autoSync, notes: d.notes,
                take: pickerValue('extTake'), share: pickerValue('extShare'),
            };
            let res;
            if (!v.partner) {
                res = await withBusy(t, 'Adding…', () => S.api('/codeshare/external', { method: 'POST', body: { ...body, ...(v.upload ? v.upload.body : {}) } }));
            } else {
                res = await withBusy(t, 'Saving…', async () => {
                    const r = await S.api(`/codeshare/external/${encodeURIComponent(v.partner.id)}`, { method: 'PATCH', body });
                    // A fresh upload, or a new choice of routes with no feed
                    // to re-read, is applied with what was just uploaded.
                    if (v.upload) r.sync = (await S.api(`/codeshare/external/${encodeURIComponent(v.partner.id)}/sync`, { method: 'POST', body: v.upload.body })).sync;
                    return r;
                });
            }
            if (!res) return true;
            if (res.sync) extSyncToast(res.sync, body.name);
            else P.toast(v.partner ? 'Saved.' : `${body.name} added. Upload their spreadsheet or add their route list to bring their flights in.`, 'ok');
            S.view = null; S.pick = {}; S.tab = 'outside';
            P.emit('routes:changed');
            load();
            return true;
        }
        return false;
    }

    function onExtInput(ev) {
        const t = ev.target;
        const v = S.view && S.view.kind === 'ext-form' ? S.view : null;
        if (!v || !t || !t.hasAttribute('data-ext-f')) return;
        const f = t.getAttribute('data-ext-f');
        v.draft[f] = t.type === 'checkbox' ? t.checked : t.value;
        // A new address makes the list read from the old one stale.
        if (f === 'feedUrl' && v.preview && !v.upload) v.preview = null;
    }

    /* ---- The step views ---- */

    function viewHtml() {
        const v = S.view;
        const back = `<button type="button" class="cs-back" data-cs-back><i data-lucide="arrow-left"></i> Back</button>`;
        if (v.kind === 'ext-form') return back + extFormHtml(v);
        if (v.loading) return `${back}<p class="cp-note" style="text-align:center;padding:2rem 0">Reading ${esc(v.partner.name)}’s network…</p>`;
        if (v.error) return `${back}<div class="cp-empty"><i data-lucide="triangle-alert"></i>${esc(v.error.message || 'That could not be read.')}</div>`;
        const head = `<div class="cp-card"><div class="cs-row">${logoHtml(v.partner)}<div class="cs-grow">
            <div class="cs-name">${esc(v.partner.name)}</div>
            <div class="cp-note">${esc(v.theirs.length)} route${v.theirs.length === 1 ? '' : 's'} they fly themselves${v.partner.callsign ? ` · ${esc(v.partner.callsign)}` : ''}</div></div>
            <button type="button" class="cp-btn cp-btn-sm" data-cs-their-csv title="Their own legs, as codeshares, in a spreadsheet"><i data-lucide="download"></i> CSV</button></div></div>`;

        if (v.kind === 'request') {
            return `${back}${head}
                <div class="cs-step">1 · Their flights you want to fly</div>
                ${picker('take', { title: `${v.partner.name}’s routes`, routes: v.theirs, sel: v.take, hint: '“All of them” keeps up as they add routes.' })}
                <div class="cs-step">2 · Your flights you offer them — optional</div>
                ${picker('offer', { title: 'Your routes', routes: v.mine, sel: v.offer, hint: 'Only your own published legs can be shared — never a draft, never a codeshare.' })}
                <div class="cs-step">3 · A word to their staff</div>
                <textarea class="cp-textarea" data-cs-msg maxlength="800" placeholder="Who you are, why they should say yes, how to reach you.">${esc(v.message || '')}</textarea>
                <button type="button" class="cp-btn cp-btn-primary" data-cs-send style="justify-content:center"><i data-lucide="send"></i> Send request</button>`;
        }
        if (v.kind === 'review') {
            const a = v.agreement;
            return `${back}${head}
                ${a.message ? `<div class="cs-msg">“${esc(a.message)}”${a.requestedBy ? ` — ${esc(a.requestedBy)}` : ''}</div>` : ''}
                <div class="cs-step">Your flights they may fly</div>
                ${picker('offer', { title: 'Your routes', routes: v.mine, sel: v.offer, hint: a.theyTake.mode === 'all' ? 'They asked for all of them. Untick anything you would rather keep to yourselves.' : 'Ticked: what they asked for. Anything you untick simply stays yours alone.' })}
                <div class="cs-step">Their flights your pilots will fly</div>
                ${picker('take', { title: `${v.partner.name}’s routes`, routes: v.theirs, sel: v.take, allowed: a.theyAllowMe, hint: a.theyAllowMe.mode === 'none' ? 'They did not offer any of theirs — this can be one-way.' : 'What they offered you. Set it to “None” to let them fly yours without your pilots flying theirs.' })}
                <textarea class="cp-textarea" data-cs-reply maxlength="800" placeholder="A reply (optional)">${esc(v.reply || '')}</textarea>
                <div class="cs-actions">
                    <button type="button" class="cp-btn cp-btn-primary" data-cs-accept><i data-lucide="check"></i> Accept</button>
                    <button type="button" class="cp-btn" data-cs-decline-here>Decline</button>
                </div>`;
        }
        if (v.kind === 'edit') {
            const a = v.agreement;
            return `${back}${head}
                <div class="cs-step">Their flights your pilots fly</div>
                ${picker('take', { title: `${v.partner.name}’s routes`, routes: v.theirs, sel: a.iWant, allowed: a.theyAllowMe, hint: a.theyAllowMe.mode === 'all' ? 'They allow all of them.' : 'Greyed-out legs are ones they have not offered you.' })}
                <div class="cs-step">Your flights they may fly</div>
                ${picker('offer', { title: 'Your routes', routes: v.mine, sel: a.iAllowThem, hint: 'Narrow this and their copies of anything you untick come off their network at once.' })}
                <button type="button" class="cp-btn cp-btn-primary" data-cs-save style="justify-content:center"><i data-lucide="save"></i> Save and sync</button>`;
        }
        return back;
    }

    /* =====================================================================
     * ACTIONS
     * =================================================================== */

    const agreementById = (id) => ((S.data && S.data.agreements) || []).find((a) => a.id === id);

    async function openStep(kind, partner, agreement) {
        S.pick = {};
        S.view = { kind, partner, agreement, loading: true, theirs: [], mine: [], take: { mode: 'all', routeIds: [] }, offer: { mode: 'none', routeIds: [] } };
        draw();
        try {
            const [net, mine] = await Promise.all([S.api(`/codeshare/network/${encodeURIComponent(partner.slug)}`), myRoutes()]);
            const v = S.view;
            if (!v || v.partner.slug !== partner.slug) return;
            v.partner = { ...partner, ...(net.airline || {}) };
            v.theirs = net.routes || [];
            v.mine = mine;
            if (kind === 'review') {
                // Until I answer, my "want" slot holds what they offered me, and
                // what they would fly of mine is exactly what they asked for.
                // Both pickers start there; I only ever narrow.
                v.take = agreement.iWant;
                v.offer = agreement.theyTake;
            }
        } catch (err) { if (S.view) S.view.error = err; }
        if (S.view) S.view.loading = false;
        draw();
    }

    async function onClick(ev) {
        if (onPickerClick(ev)) return;
        // The database update lives in Settings → Data store; this panel does
        // not own that flow, so it hands over to it (as crewNotices does).
        if (ev.target.closest('[data-cp-fix-store]')) {
            S.panel.close();
            if (typeof window.openSettings === 'function') window.openSettings('data');
            else P.toast('Open Settings → Data store to update your database.');
            return;
        }
        const t = ev.target.closest('button, input[type="checkbox"][data-cs-open]');
        if (!t) return;
        const card = t.closest('[data-cs-id]');
        const a = card ? agreementById(card.getAttribute('data-cs-id')) : null;

        if (t.hasAttribute('data-cs-tab')) {
            S.tab = t.getAttribute('data-cs-tab');
            draw();
            if (S.tab === 'find' && !S.dir.list) searchDir();
            if (S.tab === 'find') setTimeout(() => { const q = document.getElementById('csDirQ'); if (q) q.focus(); }, 30);
            return;
        }
        if (t.hasAttribute('data-cs-back')) { S.view = null; S.pick = {}; draw(); return; }
        if (await onExtClick(t)) return;
        if (t.hasAttribute('data-cs-open')) {
            const open = t.checked;
            try { await S.api('/codeshare/settings', { method: 'POST', body: { open } }); S.data.open = open; P.toast(open ? 'Other airlines can find you.' : 'Hidden from the partner search.', 'ok'); } catch (err) { t.checked = !open; P.toast(err.message, 'bad'); }
            return;
        }
        if (t.hasAttribute('data-cs-pick')) {
            const slug = t.getAttribute('data-cs-pick');
            const air = (S.dir.list || []).find((x) => x.slug === slug);
            if (air) openStep('request', air);
            return;
        }
        if (t.hasAttribute('data-cs-their-csv')) {
            const v = S.view;
            await withBusy(t, 'Preparing…', () => download(`/codeshare/network/${encodeURIComponent(v.partner.slug)}?format=csv`, { name: `${v.partner.slug}-network.csv` }));
            return;
        }
        if (t.hasAttribute('data-cs-send')) {
            const v = S.view;
            const take = pickerValue('take');
            const offer = pickerValue('offer');
            if (take.mode === 'none' && offer.mode === 'none') { P.toast('Pick at least one route — theirs to fly, or yours to offer.', 'bad'); return; }
            const message = (S.panel.body.querySelector('[data-cs-msg]') || {}).value || '';
            const ok = await withBusy(t, 'Sending…', () => S.api('/codeshare', { method: 'POST', body: { partner: v.partner.slug, take, offer, message } }));
            if (!ok) return;
            P.toast(`Request sent to ${v.partner.name}.`, 'ok');
            S.view = null; S.pick = {}; S.tab = 'requests'; S.dir.list = null;
            load();
            return;
        }
        if (t.hasAttribute('data-cs-review') && a) { openStep('review', a.partner, a); return; }
        if (t.hasAttribute('data-cs-edit') && a) { openStep('edit', a.partner, a); return; }
        if (t.hasAttribute('data-cs-accept')) {
            const v = S.view;
            const body = { offer: pickerValue('offer'), take: pickerValue('take'), reply: (S.panel.body.querySelector('[data-cs-reply]') || {}).value || '' };
            if (body.offer.mode === 'none' && body.take.mode === 'none') { P.toast('That would share nothing either way. Tick something, or decline.', 'bad'); return; }
            const got = await withBusy(t, 'Accepting and syncing…', () => S.api(`/codeshare/${encodeURIComponent(v.agreement.id)}/accept`, { method: 'POST', body }));
            if (!got) return;
            P.toast(`You now codeshare with ${v.partner.name}. ${got.sync && got.sync.routes ? `${got.sync.routes} of their flights are on your network.` : ''}`, 'ok');
            S.view = null; S.pick = {}; S.tab = 'partners'; S.mine = null;
            P.emit('routes:changed');
            load();
            return;
        }
        if ((t.hasAttribute('data-cs-decline') && a) || t.hasAttribute('data-cs-decline-here')) {
            const ag = a || (S.view && S.view.agreement);
            if (!await P.ask({ title: `Decline ${ag.partner.name}?`, body: 'They will be told. They can ask again later.', confirm: 'Decline' })) return;
            const reply = (S.panel.body.querySelector('[data-cs-reply]') || {}).value || '';
            const ok = await withBusy(t, 'Declining…', () => S.api(`/codeshare/${encodeURIComponent(ag.id)}/decline`, { method: 'POST', body: { reply } }));
            if (!ok) return;
            S.view = null; S.pick = {};
            load();
            return;
        }
        if (t.hasAttribute('data-cs-withdraw') && a) {
            const ok = await withBusy(t, 'Withdrawing…', () => S.api(`/codeshare/${encodeURIComponent(a.id)}/withdraw`, { method: 'POST' }));
            if (ok) load();
            return;
        }
        if (t.hasAttribute('data-cs-save')) {
            const v = S.view;
            const got = await withBusy(t, 'Saving and syncing…', () => S.api(`/codeshare/${encodeURIComponent(v.agreement.id)}`, { method: 'PATCH', body: { take: pickerValue('take'), offer: pickerValue('offer') } }));
            if (!got) return;
            P.toast('Saved. Both networks are up to date.', 'ok');
            S.view = null; S.pick = {};
            P.emit('routes:changed');
            load();
            return;
        }
        if (t.hasAttribute('data-cs-sync') && a) {
            const got = await withBusy(t, 'Syncing…', () => S.api(`/codeshare/${encodeURIComponent(a.id)}/sync`, { method: 'POST' }));
            if (!got) return;
            const s = got.sync || {};
            P.toast(s.error ? s.error : (s.added || s.updated || s.removed) ? `Synced: ${s.added} added, ${s.updated} updated, ${s.removed} removed.` : 'Already up to date.', s.error ? 'bad' : 'ok');
            P.emit('routes:changed');
            load();
            return;
        }
        if (t.hasAttribute('data-cs-end') && a) {
            if (!await P.ask({
                title: `End the codeshare with ${a.partner.name}?`,
                body: `Their flights come off your network and yours off theirs. Routes you added by hand are not touched. They will be told.`,
                confirm: 'End it', danger: true,
            })) return;
            const got = await withBusy(t, 'Ending…', () => S.api(`/codeshare/${encodeURIComponent(a.id)}/end`, { method: 'POST', body: {} }));
            if (!got) return;
            P.toast(`Ended. ${got.removed || 0} codeshare${got.removed === 1 ? '' : 's'} removed from your network.`, 'ok');
            P.emit('routes:changed');
            load();
            return;
        }
        if (t.hasAttribute('data-cs-export')) {
            const what = t.getAttribute('data-cs-export');
            const body = what === 'combined' ? { combined: true }
                : what === 'partner' ? { scope: 'codeshare', partner: t.getAttribute('data-name'), id: false }
                    : { scope: 'codeshare', id: false };
            await withBusy(t, 'Preparing…', () => download('/routes/export', { method: 'POST', body }));
        }
    }

    function onInput(ev) {
        onPickerInput(ev);
        if (ev.target && ev.target.id === 'csDirQ') {
            S.dir.q = ev.target.value;
            clearTimeout(S.dir.timer);
            S.dir.timer = setTimeout(searchDir, 250);
        }
        if (ev.target && ev.target.hasAttribute('data-cs-msg') && S.view) S.view.message = ev.target.value;
        if (ev.target && ev.target.hasAttribute('data-cs-reply') && S.view) S.view.reply = ev.target.value;
        onExtInput(ev);
    }

    function open({ api, backend, slug, token, tab } = {}) {
        if (typeof api !== 'function') { console.warn('crewCodeshare: needs an api function'); return; }
        styles();
        S.api = api;
        S.conn = { backend, slug, token };
        S.mine = null;
        S.view = null;
        S.pick = {};
        if (tab) S.tab = tab;
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewCodeshare', title: 'Codeshare partners', icon: 'handshake', wide: true });
            S.panel.body.addEventListener('click', (ev) => { onClick(ev).catch((err) => P.toast(err.message || 'That didn’t work.', 'bad')); });
            S.panel.body.addEventListener('input', onInput);
            S.panel.body.addEventListener('change', (ev) => {
                if (ev.target && ev.target.matches('[data-ext-file]')) onExtFile(ev.target).catch((err) => P.toast(err.message || 'That didn’t work.', 'bad'));
                else onExtInput(ev);
            });
        }
        S.panel.open();
        draw();
        load();
        if (S.tab === 'find') searchDir();
    }

    /** Just the waiting count, for a badge on the button that opens this. */
    async function incoming(api) {
        try { const d = await api('/codeshare'); return Number(d.incoming) || 0; } catch { return 0; }
    }

    window.CrewCodeshare = { open, close: () => S.panel && S.panel.close(), incoming };

    /* =====================================================================
     * HUBS
     * =================================================================== */

    const H = { api: null, panel: null, rows: [], routes: [], onSaved: null, error: null };

    function hubsDraw() {
        if (!H.panel) return;
        const counts = new Map();
        for (const r of H.routes) for (const a of [r.origin, r.destination]) if (a) counts.set(a, (counts.get(a) || 0) + 1);
        const suggest = [...counts.entries()].sort((a, b) => b[1] - a[1])
            .filter(([code]) => !H.rows.some((h) => h.icao === code)).slice(0, 8);
        P.keepPlace(H.panel.body, () => {
            H.panel.body.innerHTML = `
                <p class="cp-note">Where the airline is based. Your map, your public feed and your website draw these as hubs instead of guessing from whichever airports have the most routes. Leave it empty and they keep guessing.</p>
                ${H.error ? `<div class="cp-note cp-note-bad">${esc(H.error)}</div>` : ''}
                <div style="display:grid;gap:.45rem" id="hbRows">${H.rows.map((h, i) => `<div class="hb-row" data-hb="${i}">
                    <input class="cp-input" data-hb-f="icao" maxlength="4" placeholder="ICAO" value="${esc(h.icao)}" style="text-transform:uppercase" aria-label="Airport code">
                    <input class="cp-input" data-hb-f="name" maxlength="60" placeholder="Name (optional)" value="${esc(h.name)}" aria-label="Hub name">
                    <select class="cp-select" data-hb-f="kind" aria-label="Hub or focus city"><option value="hub" ${h.kind === 'hub' ? 'selected' : ''}>Hub</option><option value="focus" ${h.kind === 'focus' ? 'selected' : ''}>Focus city</option></select>
                    <button type="button" class="cp-icon-btn" data-hb-del title="Remove"><i data-lucide="trash-2"></i></button>
                </div>`).join('') || '<p class="cp-note">No hubs set.</p>'}</div>
                <div class="cs-actions" style="margin-top:0">
                    <button type="button" class="cp-btn cp-btn-sm" data-hb-add><i data-lucide="plus"></i> Add a hub</button>
                </div>
                ${suggest.length ? `<div><div class="cp-label">Busiest on your network — tap to add</div><div class="pk-ports" style="flex-wrap:wrap">${suggest.map(([code, n]) => `<button type="button" class="pk-port" data-hb-suggest="${esc(code)}">${esc(code)} · ${n} routes</button>`).join('')}</div></div>` : ''}
                <button type="button" class="cp-btn cp-btn-primary" data-hb-save style="justify-content:center"><i data-lucide="save"></i> Save hubs</button>`;
            try { icons(); } catch (_) {}
        });
    }

    async function hubsOpen({ api, onSaved } = {}) {
        if (typeof api !== 'function') return;
        styles();
        H.api = api; H.onSaved = onSaved || null; H.error = null;
        if (!H.panel) {
            H.panel = P.sheet({ id: 'crewHubs', title: 'Hubs', icon: 'map-pin' });
            H.panel.body.addEventListener('input', (ev) => {
                const row = ev.target.closest('[data-hb]');
                const f = ev.target.getAttribute('data-hb-f');
                if (!row || !f) return;
                const h = H.rows[Number(row.getAttribute('data-hb'))];
                if (h) h[f] = f === 'icao' ? ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) : ev.target.value;
            });
            H.panel.body.addEventListener('change', (ev) => {
                const row = ev.target.closest('[data-hb]');
                if (row && ev.target.getAttribute('data-hb-f') === 'kind') H.rows[Number(row.getAttribute('data-hb'))].kind = ev.target.value;
            });
            H.panel.body.addEventListener('click', async (ev) => {
                const t = ev.target.closest('button');
                if (!t) return;
                if (t.hasAttribute('data-hb-add')) { H.rows.push({ icao: '', name: '', kind: H.rows.length ? 'focus' : 'hub' }); hubsDraw(); const last = H.panel.body.querySelector('#hbRows .hb-row:last-child input'); if (last) last.focus(); return; }
                if (t.hasAttribute('data-hb-del')) { H.rows.splice(Number(t.closest('[data-hb]').getAttribute('data-hb')), 1); hubsDraw(); return; }
                if (t.hasAttribute('data-hb-suggest')) { H.rows.push({ icao: t.getAttribute('data-hb-suggest'), name: '', kind: H.rows.length ? 'focus' : 'hub' }); hubsDraw(); return; }
                if (t.hasAttribute('data-hb-save')) {
                    const got = await withBusy(t, 'Saving…', () => H.api('/hubs', { method: 'PUT', body: { hubs: H.rows.filter((h) => h.icao) } }));
                    if (!got) return;
                    H.rows = got.hubs || [];
                    P.toast(H.rows.length ? `${H.rows.length} hub${H.rows.length === 1 ? '' : 's'} saved.` : 'Hubs cleared — they will be worked out from your routes.', 'ok');
                    hubsDraw();
                    if (H.onSaved) H.onSaved(H.rows);
                    P.emit('hubs:changed', { hubs: H.rows });
                }
            });
        }
        H.panel.open();
        H.panel.body.innerHTML = `<p class="cp-note" style="text-align:center;padding:2rem 0">Reading your hubs…</p>`;
        try {
            const [h, r] = await Promise.all([H.api('/hubs'), H.api('/routes').catch(() => ({ routes: [] }))]);
            H.rows = (h.hubs || []).map((x) => ({ ...x }));
            H.routes = (r.routes || []).filter((x) => x.kind !== 'codeshare');
        } catch (err) {
            if (err.status === 404) { H.panel.body.innerHTML = P.notBuiltHtml('Hubs'); try { icons(); } catch (_) {} return; }
            H.error = err.message;
        }
        hubsDraw();
    }

    window.CrewHubs = { open: hubsOpen, close: () => H.panel && H.panel.close() };
})();
