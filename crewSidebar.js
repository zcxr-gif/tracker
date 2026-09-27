/* ============================================================================
   crewSidebar.js — the Navigator interface's sidebar and burger.

   WHY THIS EXISTS

   The crew center had two looks, and both of them were the same page: every
   part of the airline laid out at once as a wall of blocks, with twenty tiles
   in the middle of it that each open a sheet over the wall. That is a fine
   shape for a glance. It is a poor one for the owner who runs the place every
   evening, and it is the reason "where is the roster?" means scrolling.

   Navigator is the third look, and the first one that is a different SHAPE
   rather than a different coat of paint:

     · a sidebar down the left naming every part of the crew center, grouped,
       always in the same place, with the one you are in lit up
     · a burger in the top bar — on a computer it folds the sidebar down to
       an icon rail; on a phone it slides the sidebar in over the page
     · the overview is split into views ("Overview", "Live map" …) that show
       one at a time instead of stacking
     · a topic opens INSIDE the content pane, beside the sidebar, rather than
       as a sheet over a dimmed dashboard — so moving from the roster to the
       schedule is one click on the left, not close-then-scroll-then-open

   HOW IT IS BUILT

   Like crewTopicWindows.js, as a re-skin rather than a rewrite. The panels
   (crewPanels' cp-*, crewEvents' cev-*, the dashboard's [data-topic] drawers)
   are already full-viewport fixed layers; crewNavigator.css moves their left
   and top edges to the content pane and drops the scrim. Every panel keeps
   its own open/close code.

   The host page hands over two lists:

     views   parts of the page itself. Each names the sections it shows; the
             rest are hidden while it is the current view.
     groups  topics, in sidebar order: { label, items: [{ id, label, icon,
             open(), close?, root?, available?, badge?(host) }] }. `root` is the
             selector of the panel the topic opens, which is how the sidebar
             tells which one is on screen without being told.

   Does nothing at all unless CrewSkin says the interface is `navigator`, and
   undoes itself completely when it stops being — the other two looks are
   byte-for-byte what they were.

   Loaded as a classic script after crewSkin.js and crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const SKIN = 'navigator';
    const DESKTOP = '(min-width: 1024px)';
    const HIDDEN_CLASSES = ['hidden', 'cp-hidden', 'cev-hidden', 'ctw-hidden'];

    const S = {
        mounted: false,
        active: false,
        views: [],
        groups: [],
        home: '',
        view: '',
        brand: { name: 'Crew Center', logo: '', monogram: 'VA', sub: '' },
        aside: null,
        scrim: null,
        burger: null,
        observer: null,
        watched: new Set(),     // view sections whose visibility decides a view's availability
        drawn: '',
        onView: null,
    };

    const root = document.documentElement;
    const mq = window.matchMedia ? window.matchMedia(DESKTOP) : { matches: true, addEventListener() {} };

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
    const icons = () => { try { if (window.lucide) lucide.createIcons(); } catch { /* an icon is not worth an exception */ } };
    const slug = () => (window.CrewSkin && CrewSkin.slug ? CrewSkin.slug() : '') || '-';
    const KEY_COLLAPSED = () => 'crew:nav:collapsed:' + slug();
    const read = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
    const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

    const isOn = () => !!(window.CrewSkin && CrewSkin.current() === SKIN);

    /* =====================================================================
     * WHAT IS ON SCREEN
     * =================================================================== */

    const allItems = () => S.groups.reduce((a, g) => a.concat(g.items || []), []);
    const itemById = (id) => allItems().find((t) => t.id === id) || null;
    const viewById = (id) => S.views.find((v) => v.id === id) || null;
    const offered = (x) => typeof x.available !== 'function' || !!x.available();

    function shown(el) {
        return !!el && !HIDDEN_CLASSES.some((c) => el.classList.contains(c));
    }

    function isShowing(item) {
        if (!item || !item.root) return false;
        return shown(document.querySelector(item.root));
    }

    function currentItem() {
        return allItems().find(isShowing) || null;
    }

    /* =====================================================================
     * OPENING AND CLOSING
     *
     * Everything that can be open is closed before anything else opens, so
     * the pane only ever holds one topic. Registered topics close through
     * their own closer; anything else (a sheet opened from inside another
     * one, the bell) through its own X, which every shell already wires.
     * =================================================================== */

    function closeAll(keep) {
        for (const t of allItems()) {
            if (t === keep || !isShowing(t)) continue;
            if (typeof t.close === 'function') {
                try { t.close(); } catch (err) { console.warn('crewSidebar: close failed', t.id, err); }
            }
        }
        const keepEl = keep && keep.root ? document.querySelector(keep.root) : null;
        document.querySelectorAll('.cp-panel:not(.cp-hidden)').forEach((el) => {
            if (el === keepEl) return;
            const x = el.querySelector('.cp-head [data-cp-close]') || el.querySelector('[data-cp-close]');
            if (x) x.click();
        });
        document.querySelectorAll('.cev-panel:not(.cev-hidden)').forEach((el) => {
            if (el === keepEl) return;
            const x = el.querySelector('.cev-sheet .cev-head [data-cev-close]') || el.querySelector('[data-cev-close]');
            if (x) x.click();
        });
        document.querySelectorAll('[data-topic]:not(.hidden)').forEach((el) => {
            if (el === keepEl) return;
            const x = el.querySelector(':scope > .ctw-scrim');
            if (x) x.click();
        });
    }

    function go(id) {
        const t = itemById(id);
        if (!t || !offered(t)) return false;
        closeAll(t);
        if (!isShowing(t)) {
            try { t.open(); } catch (err) { console.error('crewSidebar: open failed', id, err); return false; }
        }
        // Only a topic that has a place to come back to gets one in the
        // address bar. One with no root cannot be told apart from closed,
        // and a link that reopens it on every reload would be a trap.
        if (t.root) writeHash(t.id);
        closeDrawer();
        render();
        return true;
    }

    function show(viewId, { push = true } = {}) {
        const v = viewById(viewId) || viewById(S.home) || S.views[0];
        if (!v) return;
        closeAll(null);
        S.view = v.id;
        root.setAttribute('data-csb-at', v.id);
        paintView();
        if (push) writeHash(v.id === S.home ? '' : v.id);
        try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch { window.scrollTo(0, 0); }
        closeDrawer();
        render();
        if (typeof S.onView === 'function') { try { S.onView(v.id); } catch { /* host's problem */ } }
    }

    /** Hide the sections that are not in the current view. Undone by clear(). */
    function paintView() {
        const v = viewById(S.view);
        const want = new Set();
        if (v) (v.show || []).forEach((sel) => document.querySelectorAll(sel).forEach((el) => want.add(el)));
        S.views.forEach((x) => (x.show || []).forEach((sel) => document.querySelectorAll(sel).forEach((el) => {
            el.classList.toggle('csb-off', !want.has(el));
        })));
        (S.hide || []).forEach((sel) => document.querySelectorAll(sel).forEach((el) => el.classList.add('csb-off')));
    }

    function clear() {
        document.querySelectorAll('.csb-off').forEach((el) => el.classList.remove('csb-off'));
        root.removeAttribute('data-csb-at');
    }

    /* =====================================================================
     * ROUTING — `#/<view>` or `#/<topic>`, the same shape crewTopicWindows
     * writes, so a link copied from either module means the same thing.
     * =================================================================== */

    const hashId = () => {
        const m = String(location.hash || '').match(/^#\/([a-z0-9_-]+)$/i);
        return m ? m[1].toLowerCase() : '';
    };

    function writeHash(id) {
        const want = id ? '#/' + id : '';
        const have = location.hash || '';
        if (have === want || (!id && (have === '' || have === '#'))) return;
        try {
            history.pushState(null, '', location.pathname + location.search + want);
        } catch { /* framed cross-origin: the sidebar works, only the link is lost */ }
    }

    function replaceHash(id) {
        try { history.replaceState(null, '', location.pathname + location.search + (id ? '#/' + id : '')); } catch { /* framed */ }
    }

    function onRoute() {
        if (!S.active) return;
        const id = hashId();
        if (viewById(id)) { show(id, { push: false }); return; }
        const t = itemById(id);
        if (t) {
            if (!isShowing(t) && offered(t)) {
                closeAll(t);
                try { t.open(); } catch (err) { console.error('crewSidebar: open failed', id, err); }
            }
            render();
            return;
        }
        if (!id) { show(S.home, { push: false }); }
    }

    /* A topic closed by its own X leaves `#/roster` behind; put the view back
     * in the address bar so a reload does not reopen what was just closed. */
    function onPanels() {
        const id = hashId();
        const t = itemById(id);
        if (t && !isShowing(t)) replaceHash(S.view === S.home ? '' : S.view);
        render();
    }

    function watch() {
        if (S.observer || typeof MutationObserver === 'undefined') return;
        let queued = false;
        S.observer = new MutationObserver((records) => {
            if (!S.active) return;
            const touched = records.some((r) => r.target instanceof Element
                && (r.target.matches('.cp-panel, .cev-panel, [data-topic]') || S.watched.has(r.target)));
            if (!touched || queued) return;
            queued = true;
            // Batched to the next frame: a topic opening flips a dozen classes.
            requestAnimationFrame(() => { queued = false; onPanels(); });
        });
        S.observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    /* =====================================================================
     * THE CHROME
     * =================================================================== */

    function build() {
        if (S.aside) return;
        S.aside = document.createElement('aside');
        S.aside.id = 'csbNav';
        S.aside.className = 'csb';
        S.aside.setAttribute('aria-label', 'Crew center');
        document.body.appendChild(S.aside);

        S.scrim = document.createElement('div');
        S.scrim.className = 'csb-scrim';
        S.scrim.addEventListener('click', closeDrawer);
        document.body.appendChild(S.scrim);

        S.aside.addEventListener('click', (ev) => {
            const v = ev.target.closest('[data-csb-view]');
            if (v) { show(v.getAttribute('data-csb-view')); return; }
            const g = ev.target.closest('[data-csb-go]');
            if (g) { go(g.getAttribute('data-csb-go')); return; }
            if (ev.target.closest('[data-csb-fold]')) { toggle(); return; }
            if (ev.target.closest('[data-csb-close]')) closeDrawer();
        });

        // On the window, in the capture phase: Escape with the drawer open
        // belongs to the drawer, and the topic under it must never see it —
        // every panel in the product closes itself on Escape at the document.
        window.addEventListener('keydown', onKey, true);
    }

    function placeBurger() {
        if (S.burger && S.burger.isConnected) return;
        const host = document.querySelector(S.burgerHost || 'body > header > div');
        if (!host) return;
        S.burger = document.createElement('button');
        S.burger.type = 'button';
        S.burger.className = 'csb-burger';
        S.burger.setAttribute('aria-controls', 'csbNav');
        S.burger.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
        S.burger.addEventListener('click', toggle);
        host.insertBefore(S.burger, host.firstChild);
        labelBurger();
    }

    function labelBurger() {
        if (!S.burger) return;
        const desk = mq.matches;
        const open = desk ? !root.classList.contains('csb-collapsed') : root.classList.contains('csb-drawer');
        const label = desk ? (open ? 'Collapse the sidebar' : 'Expand the sidebar') : (open ? 'Close the menu' : 'Open the menu');
        S.burger.setAttribute('aria-label', label);
        S.burger.title = label;
        S.burger.setAttribute('aria-expanded', String(open));
    }

    /** The burger. Folds the rail on a computer, slides the drawer on a phone. */
    function toggle() {
        if (mq.matches) {
            const folded = root.classList.toggle('csb-collapsed');
            write(KEY_COLLAPSED(), folded ? '1' : '');
            render();
        } else if (root.classList.contains('csb-drawer')) {
            closeDrawer();
        } else {
            root.classList.add('csb-drawer');
            render();
            const first = S.aside && S.aside.querySelector('[aria-current="true"], .csb-link');
            if (first) { try { first.focus({ preventScroll: true }); } catch { /* old Safari */ } }
        }
        labelBurger();
    }

    function closeDrawer() {
        if (!root.classList.contains('csb-drawer')) return;
        root.classList.remove('csb-drawer');
        labelBurger();
    }

    function onKey(ev) {
        if (!S.active) return;
        if (ev.key === 'Escape' && root.classList.contains('csb-drawer')) {
            ev.stopImmediatePropagation();
            closeDrawer();
            return;
        }
        // `[` folds the sidebar, the way most app shells do. Never while the
        // reader is typing, and never with a modifier held.
        if (ev.key === '[' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
            const t = ev.target;
            if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
            if (mq.matches) toggle();
        }
    }

    function link({ id, label, icon, current, kind, badge }) {
        const attr = kind === 'view' ? 'data-csb-view' : 'data-csb-go';
        return `<button type="button" class="csb-link" ${attr}="${esc(id)}" aria-current="${current ? 'true' : 'false'}" title="${esc(label)}">`
            + `<i data-lucide="${esc(icon || 'circle')}" data-letter="${esc(String(label || '?').trim().charAt(0).toUpperCase())}"></i><span class="csb-label">${esc(label)}</span>`
            + (badge ? `<span class="csb-badge" data-csb-badge="${esc(id)}"></span>` : '')
            + '</button>';
    }

    function render() {
        if (!S.active || !S.aside) return;
        const open = currentItem();
        const b = S.brand;
        const views = S.views.filter(offered);
        const groups = S.groups.map((g) => ({ label: g.label, items: (g.items || []).filter(offered) }))
            .filter((g) => g.items.length);

        // Rewritten only when what it says has changed. The observer calls
        // this on every panel flip, and rewriting the list would drop focus
        // from the link somebody is arrowing through.
        const key = JSON.stringify([b, S.view, open && open.id, views.map((v) => v.id),
            groups.map((g) => [g.label, g.items.map((t) => t.id)]), root.classList.contains('csb-collapsed')]);
        if (key === S.drawn) return;
        S.drawn = key;

        const folded = root.classList.contains('csb-collapsed');
        const mark = b.logo
            ? `<span class="csb-logo"><img src="${esc(b.logo)}" alt=""></span>`
            : `<span class="csb-mono">${esc(b.monogram || 'VA')}</span>`;

        S.aside.innerHTML = `
            <div class="csb-head">
                ${mark}
                <div class="csb-id"><div class="csb-name">${esc(b.name || 'Crew Center')}</div>${b.sub ? `<div class="csb-sub">${esc(b.sub)}</div>` : ''}</div>
                <button type="button" class="csb-x" data-csb-close aria-label="Close the menu"><i data-lucide="x"></i></button>
            </div>
            <nav class="csb-list">
                ${views.length ? `<div class="csb-group">${views.map((v) => link({
                    id: v.id, label: v.label, icon: v.icon, kind: 'view', current: !open && S.view === v.id,
                })).join('')}</div>` : ''}
                ${groups.map((g) => `
                    <div class="csb-group">
                        <div class="csb-cap">${esc(g.label)}</div>
                        ${g.items.map((t) => link({
                            id: t.id, label: t.label, icon: t.icon, badge: typeof t.badge === 'function',
                            current: !!open && open.id === t.id,
                        })).join('')}
                    </div>`).join('')}
            </nav>
            <div class="csb-foot">
                <button type="button" class="csb-link csb-fold" data-csb-fold title="${folded ? 'Expand' : 'Collapse'} the sidebar  ( [ )">
                    <i data-lucide="${folded ? 'panel-left-open' : 'panel-left-close'}"></i><span class="csb-label">Collapse</span>
                </button>
            </div>`;

        // Badges are painted by the module that owns the count, into a host
        // it keeps up to date — the sidebar never holds a number of its own.
        allItems().forEach((t) => {
            if (typeof t.badge !== 'function') return;
            const host = S.aside.querySelector(`[data-csb-badge="${CSS.escape(t.id)}"]`);
            if (host) { try { t.badge(host); } catch { /* a count is not worth an exception */ } }
        });
        icons();
    }

    /* =====================================================================
     * ON AND OFF
     * =================================================================== */

    function activate() {
        if (S.active) return;
        S.active = true;
        build();
        placeBurger();
        watch();
        if (read(KEY_COLLAPSED()) === '1') root.classList.add('csb-collapsed');
        const id = hashId();
        S.view = viewById(id) ? id : (S.view && viewById(S.view) ? S.view : S.home);
        root.setAttribute('data-csb-at', S.view);
        paintView();
        S.drawn = '';
        render();
        labelBurger();
    }

    function deactivate() {
        if (!S.active) return;
        S.active = false;
        clear();
        closeDrawer();
        root.classList.remove('csb-collapsed');
        // A view in the address bar means nothing to the other two looks.
        if (viewById(hashId())) replaceHash('');
    }

    function sync() { if (isOn()) activate(); else deactivate(); }

    /* =====================================================================
     * THE HOST'S SIDE
     * =================================================================== */

    /**
     * Called once by the page. Safe before the DOM is complete as long as the
     * sections named in `views` exist — both crew pages call it from their
     * boot script, after the markup.
     */
    function mount(opts = {}) {
        S.views = Array.isArray(opts.views) ? opts.views : [];
        S.home = opts.home || (S.views[0] && S.views[0].id) || '';
        S.hide = Array.isArray(opts.hide) ? opts.hide : [];
        S.burgerHost = opts.burgerHost || '';
        S.onView = opts.onView || null;
        if (opts.groups) S.groups = opts.groups;
        if (opts.brand) brand(opts.brand);
        // A view that appears only once its section has something in it (the
        // pilot's quick links, the fleet) re-renders the sidebar when it does.
        S.watched = new Set();
        S.views.forEach((v) => (v.watch || []).forEach((sel) => {
            const el = document.querySelector(sel);
            if (el) S.watched.add(el);
        }));
        if (!S.mounted) {
            S.mounted = true;
            window.addEventListener('popstate', onRoute);
            window.addEventListener('hashchange', onRoute);
            if (mq.addEventListener) mq.addEventListener('change', () => { closeDrawer(); labelBurger(); });
            if (window.CrewSkin) CrewSkin.onChange(sync);
        }
        sync();
        return api;
    }

    /** Replace the topic list — the dashboard does this whenever /me changes what a member may open. */
    function setGroups(groups) {
        S.groups = Array.isArray(groups) ? groups : [];
        render();
    }

    function brand(b = {}) {
        S.brand = Object.assign({}, S.brand, b);
        render();
    }

    const api = {
        mount, setGroups, brand, go, show,
        refresh: () => { S.drawn = ''; render(); },
        view: () => S.view,
        active: () => S.active,
        toggle,
    };
    window.CrewSidebar = api;
})();
