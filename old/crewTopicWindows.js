/* ============================================================================
   crewTopicWindows.js — let the owner choose how a topic opens.

   WHY THIS EXISTS

   Every topic in the crew center — the roster, the schedule, events, the
   noticeboard, embeds, statistics, settings — opens the same way: a sheet
   slides in from the right over a dimmed dashboard. That is the right shape
   for a glance and the wrong shape for a session. An owner reconciling a
   month of flight reports, or laying out next week's departures, is not
   glancing; they are working in one topic for twenty minutes, in a column
   half the width of their screen, with the dashboard greyed out behind it
   doing nothing except taking up the other half.

   So the presentation becomes a choice the owner makes once:

     Slide-over (default)  what shipped. A sheet over the dashboard.
     Full page             the topic IS the page. Full width, no scrim, its
                           own URL, and a burger for moving between topics.

   WHAT "ITS OWN URL" BUYS

   In full-page mode a topic writes `#/schedule` onto the address bar. That is
   not decoration — it is the whole reason this is worth building rather than
   just widening the sheet:

     · Back closes the topic instead of leaving the crew center.
     · Reload lands you back where you were, not on the dashboard.
     · A topic can be opened in a genuinely separate browser window — which is
       what an owner with two monitors actually wants when they are checking
       the roster against the schedule. Every row in the burger menu offers it.

   HOW IT IS BUILT

   Deliberately as a re-skin, not a rewrite. There are three unrelated panel
   shells in this product — crewPanels' `cp-` sheets, crewEvents' older `cev-`
   sheet, and the dashboard's own Tailwind drawers — and rewriting all three
   to share a presentation mode would be a large change to a lot of working
   code. Instead every one of them is already a full-viewport fixed layer with
   a scrim and a panel inside it. Full-page mode hides the scrim, drops the
   width cap and cancels the slide transform. The open/close logic each panel
   already has keeps working, untouched, in both modes.

   That is also why the mode lives on <html> as a data attribute: it is CSS,
   so it applies to a panel that has not been built yet, and switching it is
   instant with nothing to re-render.

   Loaded as a classic script after crewPanels.js. Owns nothing until the host
   page calls configure() and register().
   ========================================================================== */

(function () {
    'use strict';

    const MODES = ['sheet', 'page'];
    const DEFAULT_MODE = 'sheet';

    const MODE_META = {
        sheet: {
            name: 'Slide-over',
            desc: 'Topics slide in over the dashboard. Quick to open, quick to dismiss.',
        },
        page: {
            name: 'Full page',
            desc: 'Each topic takes the whole window and gets its own link, so you can open one per browser window. A menu button moves between them.',
        },
    };

    /* State. SLUG is only used for the per-device preference key — the
       crew-wide value arrives from the server through configure(). */
    let MODE = DEFAULT_MODE;
    let SLUG = '';
    let TOPICS = [];
    let VA_NAME = '';

    let burgerEl = null;
    let navEl = null;
    let observer = null;
    let chooseHook = null;
    const modeListeners = [];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    const icons = () => { try { if (window.lucide) lucide.createIcons(); } catch { /* an icon is not worth an exception */ } };

    const prefKey = () => 'crew:topics:' + (SLUG || '-');

    /* =====================================================================
     * STYLES
     *
     * Two blocks. The first is the mode itself: what `data-topic-mode="page"`
     * does to the three panel families. The second is this module's own
     * furniture — the burger and its drawer — which exists in page mode only.
     * =================================================================== */

    function injectStyles() {
        if (document.getElementById('ctw-styles')) return;
        const el = document.createElement('style');
        el.id = 'ctw-styles';
        el.textContent = `
        /* ---------------------------------------------------------------
           FULL-PAGE MODE

           Three shells, one idea: kill the scrim, drop the max-width, cancel
           the slide. The !important on the transform is not laziness — the
           dashboard's drawers carry Tailwind's translate-x-full as a class
           that its own open/close code adds and removes, and that class must
           keep being added and removed (it is how those panels know their
           own state) while doing nothing visible.
           ------------------------------------------------------------- */

        /* crewPanels sheets: notices, schedule, embeds, partnership, statistics */
        :root[data-topic-mode="page"] .cp-scrim{ display:none; }
        :root[data-topic-mode="page"] .cp-sheet,
        :root[data-topic-mode="page"] .cp-sheet-wide{
            inset:0; width:100%; max-width:none;
            border-left:0; border-radius:0; box-shadow:none;
        }
        /* crewEvents' own older shell, including its detail layer */
        :root[data-topic-mode="page"] .cev-scrim{ display:none; }
        :root[data-topic-mode="page"] .cev-sheet,
        :root[data-topic-mode="page"] .cev-detail{
            inset:0; width:100%; max-width:none;
            border-left:0; border-radius:0; box-shadow:none;
        }
        /* The dashboard's own drawers: settings, roster, routes, flights.
           Marked with data-topic in the markup so this does not have to match
           on Tailwind utility classes, which are not a contract. */
        :root[data-topic-mode="page"] [data-topic] > .ctw-scrim{ display:none; }
        :root[data-topic-mode="page"] [data-topic] > .panel{
            left:0; right:0; width:100%; max-width:none;
            transform:none !important;
            border-left:0; border-radius:0; box-shadow:none;
        }

        /* Room for the burger, which floats over the top-left corner of
           whatever is open. Every one of these shells puts its title in the
           same place, so every one of them needs the same gap. */
        :root[data-topic-mode="page"] .cp-head,
        :root[data-topic-mode="page"] .cev-head,
        :root[data-topic-mode="page"] [data-topic] > .panel > .sticky{
            padding-left:3.9rem;
        }

        /* Content in a full-width topic. The panel bodies were written for a
           column and centre well enough at width; what they must not do is
           run a table of pilots to 2,000px on an ultrawide. */
        :root[data-topic-mode="page"] .cp-body{
            max-width:80rem; margin-inline:auto; width:100%;
        }

        /* ---------------------------------------------------------------
           THE BURGER + DRAWER

           Above the panels (70) and below the dialogs they stack on top of
           themselves (80/90) — a confirm dialog must not have a menu button
           floating over its corner.
           ------------------------------------------------------------- */

        .ctw-hidden{ display:none !important; }

        .ctw-burger{
            position:fixed; z-index:75;
            top:calc(.75rem + env(safe-area-inset-top,0px)); left:.75rem;
            width:2.75rem; height:2.75rem; display:grid; place-items:center;
            border-radius:.7rem; cursor:pointer;
            background:var(--surface,#fff); color:var(--ink,#1C1A16);
            border:1px solid var(--line,#e5e5e5);
            box-shadow:0 1px 3px rgba(0,0,0,.08);
        }
        .ctw-burger:hover{ border-color:var(--ink,#1C1A16); }
        .ctw-burger i{ width:1.15rem; height:1.15rem; }

        .ctw-nav{ position:fixed; inset:0; z-index:76; }
        .ctw-nav-scrim{ position:absolute; inset:0; background:rgba(0,0,0,.45); }
        /* From the left, on purpose: the topics themselves come from the
           right, and a menu that arrives from the same edge as the thing it
           opens reads as the same object moving. */
        .ctw-nav-panel{
            position:absolute; left:0; top:0; height:100%;
            width:100%; max-width:20rem;
            background:var(--surface,#fff); border-right:1px solid var(--line,#e5e5e5);
            display:flex; flex-direction:column; overflow-y:auto;
            padding-bottom:env(safe-area-inset-bottom,0px);
        }
        .ctw-nav-head{
            display:flex; align-items:center; justify-content:space-between; gap:.75rem;
            padding:0 .85rem; height:3.75rem; flex:0 0 auto;
            border-bottom:1px solid var(--line,#e5e5e5);
        }
        .ctw-nav-title{
            font-weight:700; letter-spacing:-.01em; min-width:0;
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
            color:var(--ink,#1C1A16);
        }
        .ctw-icon-btn{
            width:2.25rem; height:2.25rem; display:grid; place-items:center;
            border-radius:.5rem; border:0; background:transparent; cursor:pointer;
            color:var(--muted,#736E64); flex:0 0 auto;
        }
        .ctw-icon-btn:hover{ color:var(--ink,#1C1A16); }
        .ctw-icon-btn i{ width:1.05rem; height:1.05rem; }

        .ctw-nav-list{ padding:.6rem; display:grid; gap:.15rem; align-content:start; flex:1 1 auto; }
        .ctw-nav-row{ display:flex; align-items:center; gap:.15rem; }
        .ctw-nav-link{
            flex:1 1 auto; min-width:0;
            display:flex; align-items:center; gap:.65rem;
            padding:.6rem .65rem; border-radius:.55rem;
            border:0; background:transparent; cursor:pointer; text-align:left;
            font-size:.9rem; font-weight:600; color:var(--ink,#1C1A16);
        }
        .ctw-nav-link:hover{ background:color-mix(in srgb, var(--ink,#1C1A16) 6%, transparent); }
        .ctw-nav-link i{ width:1.05rem; height:1.05rem; color:var(--muted,#736E64); flex:0 0 auto; }
        .ctw-nav-link span{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ctw-nav-link[aria-current="true"]{
            background:color-mix(in srgb, var(--accent,#1C1A16) 12%, transparent);
        }
        .ctw-nav-link[aria-current="true"] i{ color:var(--accent,#1C1A16); }
        .ctw-nav-sep{ height:1px; background:var(--line,#e5e5e5); margin:.45rem .65rem; }
        .ctw-nav-foot{
            flex:0 0 auto; padding:.85rem;
            border-top:1px solid var(--line,#e5e5e5);
        }
        .ctw-nav-foot p{ font-size:.72rem; color:var(--muted,#736E64); margin:.4rem 0 0; }
        .ctw-nav-btn{
            width:100%; display:inline-flex; align-items:center; justify-content:center; gap:.4rem;
            padding:.55rem .9rem; border-radius:.5rem; cursor:pointer;
            font-size:.85rem; font-weight:600;
            background:var(--surface,#fff); color:var(--ink,#1C1A16);
            border:1px solid var(--line,#e5e5e5);
        }
        .ctw-nav-btn:hover{ border-color:var(--ink,#1C1A16); }
        .ctw-nav-btn i{ width:1rem; height:1rem; }

        /* Phones. The drawer is full width, and the pop-out button goes: a
           second browser window is not a thing that exists on a phone, and a
           44px target that does nothing is worse than no target. */
        @media (max-width:40rem){
            .ctw-nav-panel{ max-width:none; }
            .ctw-nav-pop{ display:none; }
            .ctw-nav-link{ padding:.75rem .65rem; }
            :root[data-topic-mode="page"] .cp-head,
            :root[data-topic-mode="page"] .cev-head,
            :root[data-topic-mode="page"] [data-topic] > .panel > .sticky{
                padding-left:3.6rem;
            }
            /* crewPanels drops its sheets to the bottom of the screen on a
               phone, where a full-page topic wants the whole screen instead. */
            :root[data-topic-mode="page"] .cp-sheet{
                top:0; bottom:0; height:auto; max-height:none;
                border-top:0; border-radius:0;
            }
            :root[data-topic-mode="page"] .cp-head{ border-radius:0; }
            :root[data-topic-mode="page"] .cp-head::before{ display:none; }
        }`;
        document.head.appendChild(el);
    }

    /* =====================================================================
     * WHICH TOPIC IS ON SCREEN
     *
     * Answered by looking, not by remembering. Every panel here can be closed
     * by something this module never hears about — its own X, its scrim, the
     * Escape handler in crewPanels, the page's own keydown listener — and a
     * remembered "current topic" would go stale on the first one of those.
     * =================================================================== */

    const HIDDEN_CLASSES = ['hidden', 'cp-hidden', 'cev-hidden', 'ctw-hidden'];

    function isShowing(topic) {
        if (!topic || !topic.root) return false;
        const el = document.querySelector(topic.root);
        if (!el) return false;                       // never opened, so never built
        return !HIDDEN_CLASSES.some((c) => el.classList.contains(c));
    }

    function currentTopic() {
        return TOPICS.find(isShowing) || null;
    }

    /* =====================================================================
     * OPENING AND CLOSING
     * =================================================================== */

    function byId(id) {
        return TOPICS.find((t) => t.id === id) || null;
    }

    /** Close everything except `keep`. Panels that were never opened have no
     *  DOM and no close() worth calling, hence the isShowing() guard. */
    function closeOthers(keep) {
        for (const t of TOPICS) {
            if (t === keep) continue;
            if (typeof t.close !== 'function') continue;
            if (!isShowing(t)) continue;
            try { t.close(); } catch (err) { console.warn('crewTopicWindows: close failed', t.id, err); }
        }
    }

    /**
     * Open a topic. Safe to call for one that is already open — the burger
     * menu highlights the current topic and pressing it should just close the
     * menu, not tear the panel down and rebuild it.
     */
    function go(id) {
        const t = byId(id);
        if (!t) return false;
        if (typeof t.available === 'function' && !t.available()) return false;
        closeOthers(t);
        if (!isShowing(t)) {
            try { t.open(); } catch (err) { console.error('crewTopicWindows: open failed', id, err); return false; }
        }
        writeHash(id);
        renderNav();
        return true;
    }

    /** Back to the dashboard: close whatever is open and clear the route. */
    function home() {
        closeOthers(null);
        writeHash('');
        renderNav();
    }

    /* =====================================================================
     * ROUTING
     *
     * `#/schedule`. A hash, not a path, because the crew center is one static
     * page served for every VA and a real route would need the server to know
     * about topics — which is a lot of machinery to buy a link.
     *
     * The address bar is written in page mode only. In slide-over mode a
     * sheet is an overlay on the dashboard, not a place, and giving it a URL
     * would make Back close a panel the reader does not think of as a page.
     * An incoming link is still honoured in either mode (see start()), since
     * somebody following one has asked for that topic however it presents.
     * =================================================================== */

    const hashTopic = () => {
        const m = String(location.hash || '').match(/^#\/([a-z0-9_-]+)$/i);
        return m ? m[1].toLowerCase() : '';
    };

    let writingHash = false;

    function writeHash(id) {
        if (MODE !== 'page') return;
        const want = id ? '#/' + id : '';
        const have = location.hash || '';
        if (have === want || (!id && (have === '' || have === '#'))) return;
        writingHash = true;
        try {
            // replaceState for the clear, pushState for the open: a topic is
            // somewhere you went and Back should return from it, but closing
            // one must not leave a "nothing open" entry that Back walks into.
            if (id) history.pushState(null, '', location.pathname + location.search + want);
            else history.replaceState(null, '', location.pathname + location.search);
        } catch {
            // A page framed cross-origin can be refused history access. The
            // mode still works; only the address bar is lost.
            location.hash = want;
        } finally {
            // The flag survives to the end of the task rather than being
            // cleared here: pushState does not fire hashchange, but the
            // location.hash fallback does, one tick later.
            setTimeout(() => { writingHash = false; }, 0);
        }
    }

    function onRoute() {
        if (writingHash) return;
        const id = hashTopic();
        if (!id) { closeOthers(null); renderNav(); return; }
        const t = byId(id);
        if (!t || isShowing(t)) { renderNav(); return; }
        closeOthers(t);
        try { t.open(); } catch (err) { console.error('crewTopicWindows: open failed', id, err); }
        renderNav();
    }

    /**
     * Keep the address bar honest when a panel is closed by its own controls.
     *
     * Watching the DOM rather than wrapping every close() because there are
     * four ways to dismiss a panel and three of them are in other files. The
     * observer is only attached in page mode, and only acts on nodes that are
     * actually panel roots, so the class churn everywhere else on the
     * dashboard costs one matches() call.
     */
    function watchPanels() {
        if (observer || typeof MutationObserver === 'undefined') return;
        observer = new MutationObserver((records) => {
            if (MODE !== 'page') return;
            const touched = records.some((r) => r.target instanceof Element
                && r.target.matches('.cp-panel, .cev-panel, [data-topic]'));
            if (!touched) return;
            const open = currentTopic();
            writeHash(open ? open.id : '');
            renderNav();
        });
        observer.observe(document.body, {
            subtree: true, attributes: true, attributeFilter: ['class'],
        });
    }

    function unwatchPanels() {
        if (!observer) return;
        observer.disconnect();
        observer = null;
    }

    /* =====================================================================
     * THE BURGER AND ITS DRAWER
     * =================================================================== */

    function buildChrome() {
        injectStyles();
        if (burgerEl) return;

        burgerEl = document.createElement('button');
        burgerEl.id = 'ctwBurger';
        burgerEl.className = 'ctw-burger';
        burgerEl.type = 'button';
        burgerEl.setAttribute('aria-label', 'Topics menu');
        burgerEl.setAttribute('aria-expanded', 'false');
        burgerEl.innerHTML = '<i data-lucide="menu"></i>';
        burgerEl.addEventListener('click', toggleNav);
        document.body.appendChild(burgerEl);

        navEl = document.createElement('div');
        navEl.id = 'ctwNav';
        navEl.className = 'ctw-nav ctw-hidden';
        navEl.innerHTML = `
            <div class="ctw-nav-scrim" data-ctw-close></div>
            <aside class="ctw-nav-panel" role="dialog" aria-label="Topics">
                <div class="ctw-nav-head">
                    <span class="ctw-nav-title" id="ctwNavTitle">Crew Center</span>
                    <button class="ctw-icon-btn" type="button" data-ctw-close aria-label="Close menu"><i data-lucide="x"></i></button>
                </div>
                <div class="ctw-nav-list" id="ctwNavList"></div>
                <div class="ctw-nav-foot">
                    <button class="ctw-nav-btn" type="button" id="ctwNavSheet"><i data-lucide="panel-right"></i> Back to slide-over topics</button>
                    <p>Topics open as full pages. Each one has its own link, so you can keep one open per window.</p>
                </div>
            </aside>`;
        navEl.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-ctw-close]')) closeNav();
        });
        navEl.querySelector('#ctwNavSheet').addEventListener('click', () => {
            closeNav();
            choose('sheet');
        });
        document.body.appendChild(navEl);

        document.addEventListener('keydown', onNavKey);
        renderNav();
        icons();
    }

    function destroyChrome() {
        if (!burgerEl) return;
        document.removeEventListener('keydown', onNavKey);
        burgerEl.remove(); burgerEl = null;
        navEl.remove(); navEl = null;
    }

    function onNavKey(ev) {
        if (ev.key !== 'Escape' || !navEl || navEl.classList.contains('ctw-hidden')) return;
        // Taken before the panel behind it sees the key, or dismissing the
        // menu would also close the topic the reader opened it from.
        ev.stopPropagation();
        closeNav();
    }

    function openNav() {
        if (!navEl) return;
        renderNav();
        navEl.classList.remove('ctw-hidden');
        burgerEl.setAttribute('aria-expanded', 'true');
        icons();
    }

    function closeNav() {
        if (!navEl) return;
        navEl.classList.add('ctw-hidden');
        burgerEl.setAttribute('aria-expanded', 'false');
    }

    function toggleNav() {
        if (!navEl) return;
        if (navEl.classList.contains('ctw-hidden')) openNav(); else closeNav();
    }

    /** The URL that opens one topic on its own — what the pop-out button and
     *  a copied link both point at. */
    function topicUrl(id) {
        return location.origin + location.pathname + location.search + '#/' + id;
    }

    function renderNav() {
        if (!navEl) return;
        const list = navEl.querySelector('#ctwNavList');
        const title = navEl.querySelector('#ctwNavTitle');
        if (title) title.textContent = VA_NAME || 'Crew Center';

        const open = currentTopic();
        // A topic whose tile the signed-in member cannot see must not be in
        // the menu either — the menu is a second door to the same rooms, and
        // it would be an odd kind of gate that only covered one of them.
        const shown = TOPICS.filter((t) => typeof t.available !== 'function' || t.available());

        const rows = shown.map((t) => `
            <div class="ctw-nav-row">
                <button class="ctw-nav-link" type="button" data-ctw-go="${esc(t.id)}"
                        aria-current="${open && open.id === t.id ? 'true' : 'false'}">
                    <i data-lucide="${esc(t.icon || 'panel-top')}"></i><span>${esc(t.label || t.id)}</span>
                </button>
                <button class="ctw-icon-btn ctw-nav-pop" type="button" data-ctw-pop="${esc(t.id)}"
                        title="Open in a new window" aria-label="Open ${esc(t.label || t.id)} in a new window">
                    <i data-lucide="external-link"></i>
                </button>
            </div>`).join('');

        list.innerHTML = `
            <div class="ctw-nav-row">
                <button class="ctw-nav-link" type="button" data-ctw-home
                        aria-current="${open ? 'false' : 'true'}">
                    <i data-lucide="layout-dashboard"></i><span>Dashboard</span>
                </button>
            </div>
            <div class="ctw-nav-sep"></div>
            ${rows}`;

        list.querySelectorAll('[data-ctw-go]').forEach((b) => b.addEventListener('click', () => {
            closeNav();
            go(b.getAttribute('data-ctw-go'));
        }));
        list.querySelectorAll('[data-ctw-pop]').forEach((b) => b.addEventListener('click', () => {
            closeNav();
            window.open(topicUrl(b.getAttribute('data-ctw-pop')), '_blank', 'noopener');
        }));
        list.querySelector('[data-ctw-home]').addEventListener('click', () => {
            closeNav();
            home();
        });
        icons();
    }

    /* =====================================================================
     * THE MODE ITSELF
     * =================================================================== */

    function normalise(m) {
        const v = String(m || '').toLowerCase();
        return MODES.includes(v) ? v : '';
    }

    /**
     * Resolve the mode the same way the layout is resolved: an explicit
     * ?topics= wins (that is how a preview shows one), then this device's own
     * choice, then what the owner saved for the crew, then the default.
     */
    function resolve(crewValue) {
        const q = normalise(new URLSearchParams(location.search).get('topics'));
        if (q) return q;
        let stored = '';
        try { stored = normalise(localStorage.getItem(prefKey())); } catch { /* private mode */ }
        return stored || normalise(crewValue) || DEFAULT_MODE;
    }

    /**
     * A mode picked deliberately, from this module's own menu.
     *
     * Routed through the host rather than applied here, because "the reader
     * chose this" and "the mode changed" are different events and only the
     * first one should reach the server. The host's handler is the same one
     * behind the radio in Settings, so a choice made in the menu is saved
     * exactly like a choice made there — the menu was writing this device's
     * preference and quietly leaving the crew's default behind.
     */
    function choose(mode) {
        if (typeof chooseHook === 'function') {
            try { chooseHook(mode); return; } catch (err) { console.warn('crewTopicWindows: choice handler failed', err); }
        }
        setMode(mode, { persist: true });
    }

    function setMode(mode, { persist = false, silent = false } = {}) {
        const next = normalise(mode) || DEFAULT_MODE;
        const changed = next !== MODE;
        MODE = next;
        document.documentElement.setAttribute('data-topic-mode', MODE);

        if (MODE === 'page') {
            buildChrome();
            watchPanels();
            // Whatever is already open now has a place in the address bar.
            //
            // Only ever WRITTEN here, never cleared: entering page mode is the
            // first thing that happens on a visit, and clearing at that point
            // threw away the `#/schedule` the visitor arrived on — the link
            // was gone before start() got to read it.
            const open = currentTopic();
            if (open) writeHash(open.id);
        } else {
            destroyChrome();
            unwatchPanels();
            // Leaving page mode leaves the route behind with it, or a reload
            // would reopen a topic as a sheet the reader never asked for.
            try { history.replaceState(null, '', location.pathname + location.search); } catch { /* framed */ }
        }

        if (persist) {
            try { localStorage.setItem(prefKey(), MODE); } catch { /* private mode */ }
        }
        if (changed && !silent) modeListeners.forEach((fn) => { try { fn(MODE); } catch { /* a listener is not our problem */ } });
        return MODE;
    }

    /* =====================================================================
     * SETUP
     * =================================================================== */

    /**
     * Tell the module which crew center it is in and what the owner saved.
     * Called once the VA record has landed; safe to call again if it lands
     * twice (branding is applied from cache and then from the server).
     */
    function configure({ slug, name, mode } = {}) {
        if (slug !== undefined) SLUG = String(slug || '').toLowerCase();
        if (name !== undefined) VA_NAME = String(name || '');
        setMode(resolve(mode), { silent: true });
        renderNav();
        return MODE;
    }

    /**
     * The topics, in menu order. Each one is:
     *
     *   id         the URL fragment: `#/roster`
     *   label      what the menu calls it
     *   icon       a lucide name
     *   root       CSS selector for the panel's outermost element — how this
     *              module tells whether the topic is on screen without asking
     *              the module that owns it
     *   open()     the host page's existing opener, unchanged
     *   close()    ditto (optional; a topic with no closer is just never
     *              closed on this module's behalf)
     *   available()  optional gate, so the menu shows what the tiles show
     */
    function register(list) {
        TOPICS = (Array.isArray(list) ? list : []).filter((t) => t && t.id && typeof t.open === 'function');
        renderNav();
    }

    /**
     * Honour an incoming link. Called by the host once its topics are
     * registered and it is ready for one of them to open — which is later
     * than script load, because opening the roster before the session is read
     * would open it signed out.
     */
    function start() {
        const id = hashTopic();
        window.addEventListener('hashchange', onRoute);
        window.addEventListener('popstate', onRoute);
        if (!id) return;
        const t = byId(id);
        if (!t) return;
        if (typeof t.available === 'function' && !t.available()) return;
        try { t.open(); } catch (err) { console.error('crewTopicWindows: open failed', id, err); }
        renderNav();
    }

    window.CrewTopics = {
        MODES,
        MODE_META,
        configure,
        register,
        start,
        go,
        home,
        setMode,
        mode: () => MODE,
        topicUrl,
        refresh: renderNav,
        onModeChange: (fn) => { if (typeof fn === 'function') modeListeners.push(fn); },
        // Where a mode picked from the burger menu goes. One handler, not a
        // list: this is the host saying "I own saving this", and two owners
        // would be two writes.
        onModeChoice: (fn) => { chooseHook = typeof fn === 'function' ? fn : null; },
    };
})();
