/* ============================================================================
   crewCommand.js — the search box, made real.

   WHY THIS EXISTS

   Both crew center pages have had a search field in the top bar since the day
   they shipped. It has never done anything. It takes focus, it takes typing,
   and it answers with nothing — which is worse than not being there, because
   a control that looks like it works teaches a reader that the rest of the
   page might not either.

   It is also, once it works, the fastest thing in the product. A crew center
   is fourteen panels behind fourteen tiles; a staff member looking for one
   pilot currently opens the roster, waits for it, and scrolls. Everything they
   could want is already addressable — pilots, sectors, events, documents, and
   every action the tile grid offers. This puts all of it one keystroke away.

   HOW IT BEHAVES

     ⌘K / Ctrl-K       anywhere
     /                 anywhere outside a field
     clicking the box  the obvious one, and the reason this file exists

   Then: type, ↑/↓ to move, ⏎ to go, Esc to leave. Nothing is ever more than
   two keys from anything.

   WHAT IT SEARCHES

   The four lists the crew center already publishes — the roster, the route
   network, the calendar and the library — read once on the first open and kept
   for the visit. They are the same endpoints the panels use, so nothing here
   is newly public and a crew member sees exactly what they could already see.

   Plus ACTIONS, which the page hands over: the same list it builds its tile
   grid from, already filtered by what this member is allowed to do. The
   palette never invents a door somebody is not allowed through.

   RANKING, AND WHY IT IS NOT A FUZZY MATCHER

   A crew center has hundreds of rows, not millions, and the things people
   search for are short and known: a callsign, an ICAO, a name. So the scoring
   is four rules a reader can predict —

     starts with what you typed  >  a word in it starts with it  >
     contains it  >  the initials match

   — which is the difference between typing "BA" and getting BAW22 first, and
   typing "BA" and getting "Gibraltar" because it contains b…a.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewCommand: crewPanels.js must load first'); return; }
    const { esc, icons } = P;

    const S = {
        api: null,
        actions: [],        // [{ id, label, hint, icon, run }]
        onOpen: null,       // (kind, item) => void
        el: null,
        input: null,
        list: null,
        open: false,
        q: '',
        rows: [],           // what is on screen now, in order
        active: 0,
        data: null,         // { pilots, routes, events, documents }
        loading: false,
        slug: '',
    };

    const KEY_RECENT = () => 'crew:recent:' + S.slug;
    const MAX_RECENT = 6;

    /* =====================================================================
     * SCORING
     * =================================================================== */

    /** Initials of a multi-word name: "Rae Okafor" → "ro". */
    function initialsOf(text) {
        return text.split(/[\s\-/]+/).filter(Boolean).map((w) => w[0]).join('').toLowerCase();
    }

    /**
     * How well `text` answers `q`. Higher is better; 0 means it does not.
     *
     * The bands are far enough apart that a weaker match on a better field can
     * never outrank a stronger one — a substring hit in a subtitle does not
     * beat a prefix hit on a callsign.
     */
    function score(q, text) {
        if (!q) return 1;
        const t = String(text || '').toLowerCase();
        if (!t) return 0;
        if (t === q) return 1000;
        if (t.startsWith(q)) return 800 - Math.min(99, t.length);
        // A word inside it starting with the query: "KSEA" in "Seattle (KSEA)".
        if (new RegExp('(^|[^a-z0-9])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t)) return 600 - Math.min(99, t.length);
        if (t.includes(q)) return 400 - Math.min(99, t.length);
        if (q.length >= 2 && initialsOf(t).startsWith(q)) return 300;
        return 0;
    }

    /** The best score across a row's searchable fields, title weighted up. */
    function rank(q, row) {
        const a = score(q, row.label) * 1.4;
        const b = score(q, row.sub || '') * 0.9;
        const c = score(q, row.keywords || '') * 0.8;
        return Math.max(a, b, c);
    }

    /* =====================================================================
     * WHAT THERE IS TO FIND
     *
     * Read once per visit, lazily, on the first open — never on page load. A
     * reader who never presses ⌘K costs the server nothing, and a reader who
     * does waits about as long as it takes to type the second character.
     * =================================================================== */

    async function harvest() {
        if (S.data || S.loading) return;
        S.loading = true;
        render();
        const get = async (path, pick) => {
            try { return pick(await S.api(path)) || []; } catch (_) { return []; }
        };
        const [pilots, routes, events, documents] = await Promise.all([
            get('/roster', (d) => d.roster),
            get('/routes', (d) => d.routes),
            get('/events', (d) => d.events),
            get('/documents', (d) => d.documents),
        ]);
        S.data = { pilots, routes, events, documents };
        S.loading = false;
        render();
    }

    /** Everything, as one flat list of rows the palette knows how to draw. */
    function rows() {
        const out = S.actions.map((a) => ({
            kind: 'action', id: 'a:' + a.id, label: a.label, sub: a.hint || '',
            icon: a.icon || 'square-chevron-right', group: 'Go to', run: a.run,
        }));
        if (!S.data) return out;

        S.data.pilots.forEach((p) => out.push({
            kind: 'pilot', id: 'p:' + (p.id || p.callsign), label: p.name || p.callsign || 'Pilot',
            sub: [p.callsign, p.rank && p.rank.name].filter(Boolean).join(' · '),
            keywords: p.callsign || '', icon: 'user-round', group: 'Crew', item: p,
        }));
        S.data.routes.forEach((r) => out.push({
            kind: 'route', id: 'r:' + (r.id || `${r.origin}${r.destination}`),
            label: [r.origin, r.destination].filter(Boolean).join(' → ') || 'Route',
            sub: [r.flightNumber, r.aircraft].filter(Boolean).join(' · '),
            keywords: [r.origin, r.destination, r.flightNumber].filter(Boolean).join(' '),
            icon: 'route', group: 'Network', item: r,
        }));
        S.data.events.forEach((e) => out.push({
            kind: 'event', id: 'e:' + (e.id || e.title), label: e.title || 'Event',
            sub: [e.origin && e.destination ? `${e.origin} → ${e.destination}` : '',
                e.startsAt ? P.whenText(e.startsAt) : ''].filter(Boolean).join(' · '),
            icon: 'calendar-days', group: 'Events', item: e,
        }));
        S.data.documents.forEach((d) => out.push({
            kind: 'document', id: 'd:' + (d.id || d.title), label: d.title || 'Document',
            sub: d.category || '', icon: 'file-text', group: 'Library', item: d,
        }));
        return out;
    }

    /** The rows to show, in order, for what has been typed. */
    function matches() {
        const q = S.q.trim().toLowerCase();
        const all = rows();
        if (!q) {
            // Nothing typed: what this reader reached for last, then the doors.
            const recent = readRecent();
            const byId = new Map(all.map((r) => [r.id, r]));
            const seen = new Set();
            const out = [];
            recent.forEach((id) => {
                const r = byId.get(id);
                if (r && !seen.has(id)) { seen.add(id); out.push({ ...r, group: 'Recent' }); }
            });
            all.forEach((r) => { if (r.kind === 'action' && !seen.has(r.id)) out.push(r); });
            return out.slice(0, 24);
        }
        return all
            .map((r) => ({ r, s: rank(q, r) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .slice(0, 24)
            .map((x) => x.r);
    }

    function readRecent() {
        try { return JSON.parse(localStorage.getItem(KEY_RECENT()) || '[]'); } catch (_) { return []; }
    }
    function remember(id) {
        try {
            const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, MAX_RECENT);
            localStorage.setItem(KEY_RECENT(), JSON.stringify(next));
        } catch (_) {}
    }

    /* =====================================================================
     * STYLES
     * =================================================================== */

    function styles() {
        P.baseStyles();
        P.style('crew-command', `
        .cmd-wrap{ position:fixed; inset:0; z-index:150; display:grid; justify-items:center;
            align-items:start; padding:max(4vh,1rem) 1rem 1rem; }
        @media (min-width:40rem){ .cmd-wrap{ padding-top:12vh; } }
        .cmd-scrim{ position:absolute; inset:0; background:rgb(4 6 12 / .5);
            -webkit-backdrop-filter:blur(6px); backdrop-filter:blur(6px); }
        .cmd-box{ position:relative; width:min(40rem,100%); background:var(--surface,#fff);
            border:1px solid var(--line,#e5e5e5); border-radius:1.1rem; overflow:hidden;
            box-shadow:0 40px 90px -30px rgb(0 0 0 / .6);
            display:flex; flex-direction:column; max-height:min(32rem,78vh);
            animation:cmd-in .22s cubic-bezier(.22,1.12,.36,1) both; }
        @keyframes cmd-in{ from{ opacity:0; transform:translateY(-8px) scale(.985); } to{ opacity:1; transform:none; } }
        @media (prefers-reduced-motion:reduce){ .cmd-box{ animation:none; } }

        .cmd-top{ display:flex; align-items:center; gap:.6rem; padding:.85rem 1rem;
            border-bottom:1px solid var(--line,#e5e5e5); }
        .cmd-top > i{ width:1.1rem; height:1.1rem; color:var(--faint,#A8A296); flex:none; }
        .cmd-input{ flex:1; min-width:0; border:0; background:none; outline:none; font:inherit;
            font-size:1rem; color:var(--ink,#1C1A16); }
        .cmd-input::placeholder{ color:var(--faint,#A8A296); }
        .cmd-esc{ font-size:.62rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
            color:var(--muted,#736E64); border:1px solid var(--line,#e5e5e5); border-radius:.35rem;
            padding:.15rem .35rem; flex:none; }

        .cmd-list{ overflow-y:auto; overscroll-behavior:contain; padding:.4rem; }
        .cmd-group{ font-size:.62rem; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
            color:var(--faint,#A8A296); padding:.65rem .7rem .3rem; }
        .cmd-row{ display:flex; align-items:center; gap:.7rem; width:100%; text-align:left;
            padding:.55rem .7rem; border:0; background:none; font:inherit; cursor:pointer;
            border-radius:.6rem; color:inherit; }
        .cmd-row i{ width:1.05rem; height:1.05rem; flex:none; color:var(--muted,#736E64); }
        /* These are <span>s inside a flex row, so each has to be told to be a
           block — an inline label and an inline subtitle share a line, which
           reads as one run-on sentence per result. */
        .cmd-row-main{ min-width:0; flex:1; display:block; }
        .cmd-row-label{ display:block; font-size:.9rem; font-weight:600; letter-spacing:-.01em;
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cmd-row-sub{ display:block; font-size:.75rem; color:var(--muted,#736E64);
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cmd-row-go{ font-size:.7rem; color:var(--faint,#A8A296); flex:none; opacity:0; }
        /* The active row is chosen with the arrow keys as often as the mouse,
           so it is highlighted by state rather than by :hover — the two have to
           agree, and a list where hover and the keyboard disagree is a list
           that presses the wrong thing. */
        .cmd-row-on{ background:color-mix(in srgb, var(--accent) 12%, transparent); }
        .cmd-row-on i{ color:var(--accent); }
        .cmd-row-on .cmd-row-go{ opacity:1; }
        .cmd-empty{ padding:2.2rem 1rem; text-align:center; color:var(--muted,#736E64); font-size:.88rem; }
        .cmd-foot{ display:flex; gap:.9rem; align-items:center; padding:.5rem .8rem;
            border-top:1px solid var(--line,#e5e5e5); font-size:.68rem; color:var(--faint,#A8A296); }
        .cmd-k{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-weight:700;
            border:1px solid var(--line,#e5e5e5); border-radius:.3rem; padding:0 .25rem; margin-right:.2rem; }
        @media (max-width:30rem){ .cmd-foot{ display:none; } }
        `);
    }

    /* =====================================================================
     * DRAWING
     * =================================================================== */

    function render() {
        if (!S.el) return;
        S.rows = matches();
        if (S.active >= S.rows.length) S.active = Math.max(0, S.rows.length - 1);

        let html = '';
        if (!S.rows.length) {
            html = S.loading
                ? `<div class="cmd-empty"><span class="cp-spin"></span> Reading your crew center…</div>`
                : `<div class="cmd-empty">Nothing matches “${esc(S.q)}”.</div>`;
        } else {
            let group = null;
            S.rows.forEach((r, i) => {
                if (r.group !== group) { group = r.group; html += `<div class="cmd-group">${esc(group)}</div>`; }
                html += `<button class="cmd-row ${i === S.active ? 'cmd-row-on' : ''}" data-cmd-i="${i}" type="button">
                    <i data-lucide="${esc(r.icon)}"></i>
                    <span class="cmd-row-main">
                        <span class="cmd-row-label">${esc(r.label)}</span>
                        ${r.sub ? `<span class="cmd-row-sub">${esc(r.sub)}</span>` : ''}
                    </span>
                    <span class="cmd-row-go">↵</span>
                </button>`;
            });
        }
        S.list.innerHTML = html;
        try { icons(); } catch (_) {}
        const on = S.list.querySelector('.cmd-row-on');
        if (on) on.scrollIntoView({ block: 'nearest' });
    }

    function build() {
        if (S.el) return;
        styles();
        S.el = document.createElement('div');
        S.el.className = 'cmd-wrap cp-hidden';
        S.el.setAttribute('role', 'dialog');
        S.el.setAttribute('aria-modal', 'true');
        S.el.setAttribute('aria-label', 'Search and commands');
        S.el.innerHTML = `<div class="cmd-scrim" data-cmd-close></div>
            <div class="cmd-box">
                <div class="cmd-top">
                    <i data-lucide="search"></i>
                    <input class="cmd-input" type="text" autocomplete="off" spellcheck="false"
                        aria-label="Search crew, flights, events, documents and commands"
                        placeholder="Search crew, flights, events — or jump to a tool">
                    <span class="cmd-esc">esc</span>
                </div>
                <div class="cmd-list" role="listbox"></div>
                <div class="cmd-foot">
                    <span><span class="cmd-k">↑↓</span>move</span>
                    <span><span class="cmd-k">↵</span>open</span>
                    <span style="margin-left:auto"><span class="cmd-k">⌘K</span>anywhere</span>
                </div>
            </div>`;
        document.body.appendChild(S.el);
        S.input = S.el.querySelector('.cmd-input');
        S.list = S.el.querySelector('.cmd-list');

        S.el.addEventListener('click', (ev) => {
            if (ev.target.closest('[data-cmd-close]')) { close(); return; }
            const row = ev.target.closest('[data-cmd-i]');
            if (row) pick(Number(row.getAttribute('data-cmd-i')));
        });
        // Pointer and keyboard must agree about which row is active.
        S.list.addEventListener('mousemove', (ev) => {
            const row = ev.target.closest('[data-cmd-i]');
            if (!row) return;
            const i = Number(row.getAttribute('data-cmd-i'));
            if (i !== S.active) { S.active = i; render(); }
        });
        S.input.addEventListener('input', () => { S.q = S.input.value; S.active = 0; render(); });
        S.input.addEventListener('keydown', onKeys);
    }

    function onKeys(ev) {
        if (ev.key === 'ArrowDown') { ev.preventDefault(); S.active = Math.min(S.rows.length - 1, S.active + 1); render(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); S.active = Math.max(0, S.active - 1); render(); }
        else if (ev.key === 'Enter') { ev.preventDefault(); pick(S.active); }
        else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
        else if (ev.key === 'Home') { ev.preventDefault(); S.active = 0; render(); }
        else if (ev.key === 'End') { ev.preventDefault(); S.active = S.rows.length - 1; render(); }
    }

    function pick(i) {
        const row = S.rows[i];
        if (!row) return;
        remember(row.id);
        close();
        // After the palette has gone, so a panel opening does not fight it for
        // the scroll lock or the focus.
        setTimeout(() => {
            try {
                if (row.kind === 'action' && typeof row.run === 'function') row.run();
                else if (typeof S.onOpen === 'function') S.onOpen(row.kind, row.item);
            } catch (err) { console.warn('crewCommand: opening that failed', err); }
        }, 0);
    }

    /* =====================================================================
     * OPENING AND CLOSING
     * =================================================================== */

    function open(prefill) {
        build();
        if (S.open) return;
        S.open = true;
        S.q = prefill || '';
        S.active = 0;
        S.el.classList.remove('cp-hidden');
        P.lockScroll();
        S.input.value = S.q;
        render();
        harvest();
        // A frame later: an input focused in the same tick as it is revealed
        // does not take the caret on iOS.
        requestAnimationFrame(() => { S.input.focus(); S.input.select(); });
    }

    function close() {
        if (!S.open) return;
        S.open = false;
        S.el.classList.add('cp-hidden');
        P.unlockScroll();
    }

    /* =====================================================================
     * THE KEYS, AND THE BOX THAT NEVER WORKED
     * =================================================================== */

    function bindGlobal() {
        if (document.body.dataset.cmdKeys) return;
        document.body.dataset.cmdKeys = '1';
        document.addEventListener('keydown', (ev) => {
            const mod = ev.metaKey || ev.ctrlKey;
            if (mod && (ev.key === 'k' || ev.key === 'K')) { ev.preventDefault(); S.open ? close() : open(); return; }
            // `/` is the other muscle memory, but only when the reader is not
            // already typing into something — otherwise it eats the slash in
            // an ICAO pair or a URL somebody is pasting into the settings.
            if (ev.key === '/' && !S.open) {
                const t = ev.target;
                if (t && (t.matches('input,textarea,select') || t.isContentEditable)) return;
                ev.preventDefault();
                open();
            }
        });
    }

    /**
     * Take over the page's header search field.
     *
     * The field stays in the markup — it is the thing people look for — but it
     * never takes a caret again: focusing or clicking it opens the palette,
     * which is a real search box, and the field behind it is left readonly so
     * nothing can be typed into a control that cannot answer.
     */
    function adopt(el) {
        if (!el || el.dataset.cmdBound) return;
        el.dataset.cmdBound = '1';
        el.readOnly = true;
        el.setAttribute('role', 'button');
        el.style.cursor = 'pointer';
        const go = (ev) => { ev.preventDefault(); el.blur(); open(); };
        el.addEventListener('focus', go);
        el.addEventListener('click', go);
    }

    /**
     * Wire the palette to a page.
     *
     *   api      a CrewPanels.api-shaped call
     *   actions  what this member is allowed to open, already filtered
     *   onOpen   (kind, item) — the page decides which panel a result lives in
     */
    function mount({ api, actions, onOpen, slug } = {}) {
        if (typeof api !== 'function') { console.warn('crewCommand: needs an api function'); return; }
        S.api = api;
        S.actions = Array.isArray(actions) ? actions : [];
        S.onOpen = onOpen;
        S.slug = slug || '';
        styles();
        bindGlobal();
        document.querySelectorAll('[data-crew-search]').forEach(adopt);
    }

    window.CrewCommand = {
        mount, open, close,
        setActions: (a) => { S.actions = Array.isArray(a) ? a : []; if (S.open) render(); },
        isOpen: () => S.open,
    };
})();
