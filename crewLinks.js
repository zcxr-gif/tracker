/* ============================================================================
   crewLinks.js — the VA's quick-links board.

   WHAT THIS IS FOR

   Every VA has a handful of places their pilots need constantly: the Discord,
   the IFC thread, SimBrief, the charts site, the livery pack, the leave form.
   Today that is a Discord pinned message — invisible to anyone who has not
   joined Discord, invisible to a pilot reading the crew center on the web,
   scrolled past within a week, and kept current by hand or by a bot the VA has
   to run and host.

   A crew center is already where pilots go. So this is a board of tiles on the
   page they are on, and there is no bot anywhere in it.

   THE BOARD IS THE FEATURE, THE PANEL IS ADMIN

   Unlike the library and the inbox, the main surface here is NOT a slide-over —
   it is `renderBoard(el)`, a grid painted straight into the page. A quick link
   you have to open a panel to reach is not quick. The panel exists for staff to
   curate: add, edit, reorder, remove.

   WHAT THIS FILE DOES NOT DECIDE

   Whether a URL is safe. That is settled on the backend by crewLinks.safeUrl,
   which parses every URL and stores the parser's normalised href — http and
   https only. A `javascript:` URL never reaches this file. The belt-and-braces
   check in `httpUrl` below is a second pair of eyes on a value that has already
   been through the first, not the guard itself.

   Nor the rank gate. A locked tile arrives with its `url` already removed, so
   this file draws the padlock over an address it was never given.

   COUNTING OPENS

   Each tile records that it was used, so staff can tell a curated resource from
   dead weight — the number that says the charts link nobody clicks should go and
   the leave form should be pinned. Sent with `keepalive` so it survives the tab
   losing focus, and never allowed to get in the way of the navigation: the link
   is a plain <a href> that works whether or not the tally lands.

   WHAT IT NEEDS FROM ITS HOST

       CrewLinks.mount({ backend: BACKEND, slug: getSlug(), token: sessionToken });
       CrewLinks.renderBoard(document.getElementById('links'));

   Then CrewLinks.open() from a button, for staff.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewLinks: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText } = P;

    const S = {
        api: null,
        slug: '',
        links: [],
        sections: [],
        summary: { total: 0, locked: 0, pinned: 0, opens: 0 },
        categories: [],
        canManage: false,
        loaded: false,
        error: null,
        ranks: [],
        editing: null,
        busy: false,
    };

    let panel = null;

    /* ---------------------------------------------------------------------
     * How each section reads.
     *
     * The order is the backend's (crewLinks.CATEGORIES) — community first,
     * because the Discord is what most pilots came looking for.
     * ------------------------------------------------------------------- */
    const SECTIONS = {
        community: { label: 'Community',  icon: 'users' },
        tools:     { label: 'Tools',      icon: 'wrench' },
        charts:    { label: 'Charts',     icon: 'map' },
        downloads: { label: 'Downloads',  icon: 'download' },
        training:  { label: 'Training',   icon: 'graduation-cap' },
        forms:     { label: 'Forms',      icon: 'clipboard-pen' },
        social:    { label: 'Social',     icon: 'share-2' },
        other:     { label: 'Links',      icon: 'link' },
    };
    const sectionOf = (c) => SECTIONS[c] || SECTIONS.other;

    /**
     * A second look at a URL that has already been checked.
     *
     * The backend is the guard — it parses and normalises every URL before
     * storing it, and refuses everything but http and https. This is here
     * because the cost of being wrong is an <a href> on every pilot's dashboard,
     * and a value that has been through two independent checks is worth the
     * three lines. Deliberately NOT P.safeUrl, which rejects http: — plenty of
     * the tools a VA links to are not on https, and silently dropping those
     * would look like the board losing links at random.
     */
    function httpUrl(u) {
        try {
            const url = new URL(u, location.href);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch { return false; }
    }

    /* =====================================================================
     * DATA
     * =================================================================== */

    async function load() {
        try {
            const d = await S.api('/links');
            S.links = Array.isArray(d.links) ? d.links : [];
            S.sections = Array.isArray(d.sections) ? d.sections : [];
            S.summary = d.summary || { total: S.links.length, locked: 0, pinned: 0, opens: 0 };
            S.categories = Array.isArray(d.categories) ? d.categories : Object.keys(SECTIONS);
            S.canManage = !!d.canManage;
            S.error = null;
        } catch (err) {
            S.error = err;
            S.links = [];
            S.sections = [];
            S.summary = { total: 0, locked: 0, pinned: 0, opens: 0 };
        }
        S.loaded = true;
        paintAll();
        return S.links;
    }

    /**
     * Record that a tile was used.
     *
     * `keepalive` so the request is not cancelled when the tab goes to the
     * background, which is exactly what happens the instant the link opens.
     * Failure is swallowed: the pilot has already gone where they were going,
     * and a usage counter is not worth a toast.
     */
    function noteOpen(id) {
        if (!id || !S.slug) return;
        try {
            fetch(`${S.base}/api/crew/${encodeURIComponent(S.slug)}/links/${encodeURIComponent(id)}/open`, {
                method: 'POST',
                headers: S.token() ? { Authorization: 'Bearer ' + S.token() } : {},
                keepalive: true,
            }).then(() => {
                // Bumped locally so a staff member watching the board sees their
                // own click land, without re-fetching the whole thing.
                S.links = S.links.map((l) => (l.id === id ? { ...l, opens: (l.opens || 0) + 1 } : l));
            }).catch(() => {});
        } catch { /* no fetch, no tally */ }
    }

    /* =====================================================================
     * THE BOARD — the main surface
     * =================================================================== */

    const boardHosts = new Map();

    function tileHtml(l, { compact = false } = {}) {
        const s = sectionOf(l.category);
        const icon = l.icon || s.icon;

        if (l.locked) {
            // No <a>: there is no address, and a link that looks clickable and
            // does nothing is worse than one that says why.
            return `<div class="cl-tile cl-tile-locked" title="Opens at ${esc(l.minRank)}">
                <span class="cl-tile-icon"><i data-lucide="lock"></i></span>
                <span class="cl-tile-text">
                    <span class="cl-tile-title">${esc(l.title)}</span>
                    <span class="cl-tile-sub">Opens at ${esc(l.minRank)}${
                        l.hoursUntilUnlock > 0
                            ? ` · ${esc(String(Math.round(l.hoursUntilUnlock * 10) / 10))}h to go`
                            : ''}</span>
                </span>
            </div>`;
        }

        if (!httpUrl(l.url)) {
            // Should not happen — the backend normalises and refuses anything
            // else. Drawn as unopenable rather than skipped, so a VA whose row
            // somehow has a bad address can see which tile to fix.
            return `<div class="cl-tile cl-tile-locked">
                <span class="cl-tile-icon"><i data-lucide="triangle-alert"></i></span>
                <span class="cl-tile-text">
                    <span class="cl-tile-title">${esc(l.title)}</span>
                    <span class="cl-tile-sub">This link’s address isn’t valid.</span>
                </span>
            </div>`;
        }

        return `<a class="cl-tile" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer"
                   data-cl-open="${esc(l.id)}">
            <span class="cl-tile-icon"><i data-lucide="${esc(icon)}"></i></span>
            <span class="cl-tile-text">
                <span class="cl-tile-title">${esc(l.title)}${
                    l.pinned ? ' <i data-lucide="pin" class="cl-pin"></i>' : ''}</span>
                <span class="cl-tile-sub">${esc(
                    (!compact && l.description) ? l.description : (l.host || ''))}</span>
            </span>
            <span class="cl-tile-go"><i data-lucide="arrow-up-right"></i></span>
        </a>`;
    }

    function paintBoard(el, opts) {
        if (!el) return;
        // Nothing until the fetch lands. A board that renders empty and then
        // fills is read as "this VA has no links", which is the invented-data
        // bug crewNotices was written to remove.
        if (!S.loaded) { el.innerHTML = ''; return; }

        if (S.error) {
            el.innerHTML = `<p class="cl-note cp-faint">${esc(
                P.isSchemaGap(S.error)
                    ? 'Your database needs updating before the crew center can keep a links board.'
                    : 'Couldn’t load the links.')}</p>`;
            return;
        }

        if (!S.links.length) {
            el.innerHTML = S.canManage
                ? `<p class="cl-note">No quick links yet.
                       <button class="cl-inline-btn" data-cl-manage>Add the Discord, SimBrief and the livery pack</button>
                       and they’ll be one tap from every pilot.</p>`
                : '';
            icons();
            return;
        }

        const limit = opts && opts.limit ? opts.limit : 0;
        const shown = limit ? S.links.slice(0, limit) : S.links;
        const more = limit && S.links.length > limit ? S.links.length - limit : 0;

        // Flat when limited (a dashboard strip), sectioned when showing the lot.
        const body = limit
            ? `<div class="cl-grid">${shown.map((l) => tileHtml(l, { compact: true })).join('')}</div>`
            : S.sections.map((sec) => {
                const meta = sectionOf(sec.category);
                return `<section class="cl-section">
                    <h3 class="cl-section-head"><i data-lucide="${esc(meta.icon)}"></i> ${esc(meta.label)}</h3>
                    <div class="cl-grid">${sec.links.map((l) => tileHtml(l)).join('')}</div>
                </section>`;
            }).join('');

        el.innerHTML = `${body}
            ${more ? `<button class="cl-inline-btn cl-more" data-cl-manage>${more} more…</button>` : ''}`;
        icons();
    }

    function paintAll() {
        boardHosts.forEach((opts, el) => {
            if (!el.isConnected) { boardHosts.delete(el); return; }
            paintBoard(el, opts);
        });
        if (panel && panel.isOpen()) renderPanel();
    }

    /* =====================================================================
     * THE MANAGER — staff only
     * =================================================================== */

    function editorHtml(l) {
        const isNew = !l.id;
        const rungs = (S.ranks || []).map((r) => r && r.name).filter(Boolean);
        const cats = S.categories.length ? S.categories : Object.keys(SECTIONS);
        return `<form class="cl-edit" data-cl-form>
            <div>
                <label class="cp-label" for="cl-url">Link</label>
                <input class="cp-input" id="cl-url" name="url" maxlength="2000" required
                       value="${esc(l.url || '')}" placeholder="discord.gg/yourva">
                <p class="cp-faint cl-hint">Paste it as it is — https:// is added if you leave it off.
                   The kind and the icon are guessed from the address.</p>
            </div>
            <div>
                <label class="cp-label" for="cl-title">Label</label>
                <input class="cp-input" id="cl-title" name="title" maxlength="80"
                       value="${esc(l.title || '')}" placeholder="Leave blank to use the website’s name">
            </div>
            <div>
                <label class="cp-label" for="cl-description">Note (optional)</label>
                <input class="cp-input" id="cl-description" name="description" maxlength="240"
                       value="${esc(l.description || '')}" placeholder="Where to get our liveries">
            </div>
            <div class="cp-grid2">
                <div>
                    <label class="cp-label" for="cl-category">Section</label>
                    <select class="cp-select" id="cl-category" name="category">
                        <option value=""${!l.category ? ' selected' : ''}>Guess from the address</option>
                        ${cats.map((c) => `<option value="${esc(c)}"${l.category === c ? ' selected' : ''}>${
                            esc(sectionOf(c).label)}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="cp-label" for="cl-minRank">Opens at</label>
                    <select class="cp-select" id="cl-minRank" name="minRank">
                        <option value=""${!l.minRank ? ' selected' : ''}>Everyone</option>
                        ${rungs.map((r) => `<option value="${esc(r)}"${l.minRank === r ? ' selected' : ''}>${esc(r)}</option>`).join('')}
                    </select>
                    <p class="cp-faint cl-hint">A gated link is hidden from the public and shown to
                       pilots below the rung without its address.</p>
                </div>
            </div>
            <div class="cp-grid2">
                <div>
                    <label class="cp-label" for="cl-icon">Icon (optional)</label>
                    <input class="cp-input" id="cl-icon" name="icon" maxlength="40"
                           value="${esc(l.icon || '')}" placeholder="Guessed from the address">
                </div>
                <div>
                    <label class="cp-label" for="cl-status">Status</label>
                    <select class="cp-select" id="cl-status" name="status">
                        <option value="published"${(l.status || 'published') === 'published' ? ' selected' : ''}>Published</option>
                        <option value="draft"${l.status === 'draft' ? ' selected' : ''}>Draft — staff only</option>
                    </select>
                </div>
            </div>
            <label class="cl-check">
                <input type="checkbox" name="pinned"${l.pinned ? ' checked' : ''}>
                Pin to the top of the board
            </label>
            <div class="cl-edit-actions">
                <button class="cp-btn cp-btn-primary" type="submit"${S.busy ? ' disabled' : ''}>
                    <i data-lucide="check"></i> ${isNew ? 'Add link' : 'Save'}
                </button>
                <button class="cp-btn" type="button" data-cl-cancel>Cancel</button>
                ${isNew ? '' : `<button class="cp-btn cp-btn-bad" type="button" data-cl-del="${esc(l.id)}">
                    <i data-lucide="trash-2"></i> Remove
                </button>`}
            </div>
        </form>`;
    }

    function rowHtml(l, i, total) {
        const s = sectionOf(l.category);
        return `<article class="cp-card cl-row" data-cl-row="${esc(l.id)}">
            <span class="cl-row-icon"><i data-lucide="${esc(l.icon || s.icon)}"></i></span>
            <span class="cl-row-text">
                <span class="cl-row-title">${esc(l.title)}
                    ${l.pinned ? '<i data-lucide="pin" class="cl-pin"></i>' : ''}
                    ${l.status === 'draft' ? '<span class="cp-chip cp-chip-warn">Draft</span>' : ''}
                    ${l.minRank ? `<span class="cp-chip cp-chip-mute"><i data-lucide="lock"></i> ${esc(l.minRank)}</span>` : ''}
                </span>
                <span class="cl-row-sub cp-faint">${esc(l.host || l.url)}</span>
                <span class="cl-row-sub cp-faint">${esc(sectionOf(l.category).label)}
                    ${l.opens ? ` · opened ${l.opens} ${l.opens === 1 ? 'time' : 'times'}` : ' · never opened'}
                    ${l.lastOpenedAt ? ` · last ${esc(relativeText(l.lastOpenedAt))}` : ''}</span>
            </span>
            <span class="cl-row-tools">
                <button class="cp-icon-btn" data-cl-up="${esc(l.id)}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>
                    <i data-lucide="chevron-up"></i></button>
                <button class="cp-icon-btn" data-cl-down="${esc(l.id)}" aria-label="Move down"${i === total - 1 ? ' disabled' : ''}>
                    <i data-lucide="chevron-down"></i></button>
                <button class="cp-btn cp-btn-sm" data-cl-edit="${esc(l.id)}">
                    <i data-lucide="pencil"></i> Edit</button>
            </span>
        </article>`;
    }

    function renderPanel() {
        const body = panel.body;

        if (S.editing) { body.innerHTML = editorHtml(S.editing); icons(); return; }
        if (!S.loaded) { body.innerHTML = '<div class="cp-empty">Loading the links…</div>'; return; }
        if (S.error && P.isSchemaGap(S.error)) { body.innerHTML = P.schemaGapHtml(S.error); icons(); return; }
        if (S.error) {
            body.innerHTML = `<div class="cp-empty"><i data-lucide="triangle-alert"></i>
                ${esc(S.error.message || 'Couldn’t load the links.')}</div>`;
            icons();
            return;
        }

        const newBtn = S.canManage
            ? `<button class="cp-btn cp-btn-primary cl-new" data-cl-new><i data-lucide="plus"></i> Add a link</button>`
            : '';

        if (!S.links.length) {
            body.innerHTML = `${newBtn}
                <div class="cp-empty">
                    <i data-lucide="link"></i>
                    ${S.canManage
                        ? 'Nothing here yet. The Discord, the IFC thread, SimBrief and the livery pack are the usual four.'
                        : 'Your airline hasn’t added any links yet.'}
                </div>`;
            icons();
            return;
        }

        // Staff see one flat, reorderable list — the sections are how the BOARD
        // reads, and arranging tiles inside eight separate lists would make
        // "move this to the top" mean eight different things.
        body.innerHTML = `${newBtn}
            ${S.canManage && S.summary.opens
                ? `<p class="cp-note">Opened ${S.summary.opens}
                   ${S.summary.opens === 1 ? 'time' : 'times'} in total — the tiles nobody opens are
                   worth replacing.</p>`
                : ''}
            <div class="cl-rows">${S.links.map((l, i) => rowHtml(l, i, S.links.length)).join('')}</div>`;
        icons();
    }

    /* =====================================================================
     * ACTIONS
     * =================================================================== */

    async function save(form) {
        if (S.busy) return;
        const fd = new FormData(form);
        const payload = {
            url: String(fd.get('url') || '').trim(),
            title: String(fd.get('title') || '').trim(),
            description: String(fd.get('description') || '').trim(),
            category: String(fd.get('category') || ''),
            minRank: String(fd.get('minRank') || ''),
            icon: String(fd.get('icon') || '').trim(),
            status: String(fd.get('status') || 'published'),
            pinned: fd.get('pinned') === 'on',
        };
        if (!payload.url) { P.toast('Paste a link.', 'bad'); return; }
        S.busy = true;
        const id = S.editing && S.editing.id;
        try {
            const out = id
                ? await S.api(`/links/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
                : await S.api('/links', { method: 'POST', body: payload });
            P.toast(id ? 'Saved.' : 'Link added.', 'ok');
            if (out.warning) P.toast(out.warning, 'bad');
            S.editing = null;
            await load();
        } catch (err) {
            // The backend's reason is the useful one here — "links have to start
            // with http://" versus "that doesn't look like a link" are different
            // mistakes and it knows which.
            P.toast(err.message || 'Could not save the link.', 'bad');
        } finally {
            S.busy = false;
            if (panel && panel.isOpen()) renderPanel();
        }
    }

    async function remove(id) {
        const l = S.links.find((x) => x.id === id);
        if (!window.confirm(`Remove “${(l && l.title) || 'this link'}” from the board?`)) return;
        try {
            await S.api(`/links/${encodeURIComponent(id)}`, { method: 'DELETE' });
            P.toast('Link removed.', 'ok');
            S.editing = null;
            await load();
        } catch (err) { P.toast(err.message || 'Could not remove the link.', 'bad'); }
    }

    /**
     * Move a tile one place.
     *
     * Sends the WHOLE order rather than the moved tile's new position, because
     * that is what the endpoint takes — dragging one tile renumbers everything
     * below it, and one request keeps the board from ending up half-arranged.
     */
    async function move(id, delta) {
        const from = S.links.findIndex((l) => l.id === id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= S.links.length) return;
        const next = S.links.slice();
        const [row] = next.splice(from, 1);
        next.splice(to, 0, row);
        // Painted first: a reorder the reader can see happening is worth more
        // than one that waits for a round trip, and `load()` below is what makes
        // it true.
        S.links = next;
        renderPanel();
        try {
            await S.api('/links/order', { method: 'POST', body: { ids: next.map((l) => l.id) } });
            await load();
        } catch (err) {
            P.toast(err.message || 'Could not save the order.', 'bad');
            await load();
        }
    }

    /* =====================================================================
     * THE PANEL
     * =================================================================== */

    function ensurePanel() {
        if (panel) return;
        panel = P.sheet({ id: 'cl-panel', title: 'Quick links', icon: 'link' });

        panel.el.addEventListener('click', (ev) => {
            const t = ev.target;
            if (t.closest('[data-cl-cancel]')) { S.editing = null; renderPanel(); return; }
            if (t.closest('[data-cl-new]')) { S.editing = {}; renderPanel(); return; }
            const del = t.closest('[data-cl-del]');
            if (del) { remove(del.getAttribute('data-cl-del')); return; }
            const up = t.closest('[data-cl-up]');
            if (up) { move(up.getAttribute('data-cl-up'), -1); return; }
            const down = t.closest('[data-cl-down]');
            if (down) { move(down.getAttribute('data-cl-down'), 1); return; }
            const edit = t.closest('[data-cl-edit]');
            if (edit) {
                const id = edit.getAttribute('data-cl-edit');
                S.editing = S.links.find((l) => l.id === id) || null;
                renderPanel();
            }
        });

        panel.el.addEventListener('submit', (ev) => {
            const form = ev.target.closest('[data-cl-form]');
            if (!form) return;
            ev.preventDefault();
            save(form);
        });
    }

    function injectStyles() {
        P.baseStyles();
        P.style('cl-styles', `
        .cl-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(13rem,1fr)); gap:.5rem; }
        .cl-tile{ display:flex; align-items:center; gap:.6rem; text-decoration:none;
            padding:.7rem .8rem; border-radius:.6rem; border:1px solid var(--line,#e5e5e5);
            background:var(--surface,#fff); color:var(--ink,#1C1A16); min-width:0; }
        .cl-tile:hover{ border-color:var(--accent,#1C1A16); }
        .cl-tile-locked{ opacity:.6; cursor:default; }
        .cl-tile-locked:hover{ border-color:var(--line,#e5e5e5); }
        .cl-tile-icon{ display:grid; place-items:center; width:2rem; height:2rem; flex:0 0 auto;
            border-radius:.45rem; background:var(--line,#e5e5e5); color:var(--muted,#736E64); }
        .cl-tile-icon i{ width:1rem; height:1rem; }
        .cl-tile:hover .cl-tile-icon{ background:var(--accent,#1C1A16); color:#fff; }
        .cl-tile-locked:hover .cl-tile-icon{ background:var(--line,#e5e5e5); color:var(--muted,#736E64); }
        .cl-tile-text{ min-width:0; display:grid; }
        .cl-tile-title{ font-size:.87rem; font-weight:650; letter-spacing:-.01em;
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cl-tile-sub{ font-size:.72rem; color:var(--muted,#736E64);
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cl-tile-go{ margin-left:auto; flex:0 0 auto; color:var(--faint,#A8A296); }
        .cl-tile-go i{ width:.9rem; height:.9rem; }
        .cl-pin{ width:.8rem; height:.8rem; color:var(--accent,#1C1A16); vertical-align:-.05em; }

        .cl-section{ display:grid; gap:.5rem; }
        .cl-section + .cl-section{ margin-top:.9rem; }
        .cl-section-head{ display:flex; align-items:center; gap:.4rem; margin:0;
            font-size:.7rem; font-weight:800; text-transform:uppercase; letter-spacing:.05em;
            color:var(--faint,#A8A296); }
        .cl-section-head i{ width:.85rem; height:.85rem; }

        .cl-note{ font-size:.82rem; color:var(--muted,#736E64); margin:0; }
        .cl-inline-btn{ background:none; border:0; padding:0; font:inherit; cursor:pointer;
            color:var(--accent,#1C1A16); font-weight:650; text-decoration:underline; }
        .cl-more{ margin-top:.6rem; }

        .cl-rows{ display:grid; gap:.5rem; }
        .cl-row{ display:flex; align-items:center; gap:.7rem; }
        .cl-row-icon{ display:grid; place-items:center; width:2rem; height:2rem; flex:0 0 auto;
            border-radius:.45rem; background:var(--line,#e5e5e5); color:var(--muted,#736E64); }
        .cl-row-icon i{ width:1rem; height:1rem; }
        .cl-row-text{ min-width:0; display:grid; gap:.1rem; }
        .cl-row-title{ display:flex; align-items:center; gap:.35rem; flex-wrap:wrap;
            font-size:.88rem; font-weight:650; }
        .cl-row-sub{ font-size:.72rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cl-row-tools{ margin-left:auto; display:flex; align-items:center; gap:.2rem; flex:0 0 auto; }
        .cl-row-tools .cp-icon-btn:disabled{ opacity:.3; cursor:default; }

        .cl-edit{ display:grid; gap:.8rem; }
        .cl-edit-actions{ display:flex; gap:.5rem; flex-wrap:wrap; }
        .cl-hint{ font-size:.72rem; margin-top:.25rem; }
        .cl-check{ display:inline-flex; align-items:center; gap:.45rem; font-size:.85rem;
            color:var(--ink,#1C1A16); cursor:pointer; }
        .cl-new{ justify-self:start; }
        @media (max-width:40rem){
            .cl-grid{ grid-template-columns:1fr; }
            .cl-row-tools{ gap:.1rem; }
        }`);
    }

    /* =====================================================================
     * PUBLIC
     * =================================================================== */

    function open() {
        ensurePanel();
        S.editing = null;
        panel.open();
        renderPanel();
        load();
    }

    function mount({ backend, slug, token, ranks }) {
        injectStyles();
        S.base = String(backend || '').replace(/\/+$/, '');
        S.token = typeof token === 'function' ? token : () => String(token || '');
        S.api = P.api({ backend, slug, token });
        S.slug = String(slug || '').toLowerCase();
        S.ranks = Array.isArray(ranks) ? ranks : [];
        if (!S.slug) return Promise.resolve([]);

        // One listener for every board on the page, on the document, because a
        // board is painted into a host this module does not own and may be
        // re-rendered by its host at any time. Delegation survives that; a
        // listener per tile does not.
        if (!S.wired) {
            S.wired = true;
            document.addEventListener('click', (ev) => {
                const manage = ev.target.closest('[data-cl-manage]');
                if (manage) { ev.preventDefault(); open(); return; }
                const tile = ev.target.closest('[data-cl-open]');
                // Only tiles in a board this module painted, and only a real
                // navigation — a middle-click or ctrl-click still counts, which
                // is right, but a right-click to copy the address does not.
                if (tile && ev.button !== 2) noteOpen(tile.getAttribute('data-cl-open'));
            });
        }
        return load();
    }

    /**
     * Paint the board into a host element, and keep it painted.
     *
     * `limit` gives a compact strip for a dashboard (flat, most important first,
     * with a "3 more" that opens the panel). Without it the board is sectioned
     * and complete.
     */
    function renderBoard(el, { limit = 0 } = {}) {
        if (!el) return;
        injectStyles();
        boardHosts.set(el, { limit });
        paintBoard(el, { limit });
    }

    function setRanks(ranks) {
        S.ranks = Array.isArray(ranks) ? ranks : [];
        if (panel && panel.isOpen() && S.editing) renderPanel();
    }

    window.CrewLinks = {
        mount, open, renderBoard, setRanks,
        close: () => panel && panel.close(),
        reload: () => load(),
        get canManage() { return S.canManage; },
        get links() { return S.links.slice(); },
        get summary() { return { ...S.summary }; },
    };
})();
