/* ============================================================================
   crewBadges.js — the row across the top of a pilot's own page.

   WHY THIS EXISTS

   A pilot's standing was scattered across four screens. Their rank was in the
   top bar and on a card. Their club was inside the shop. Their awards were
   behind a tile. The things they had actually SPENT their flying on were in a
   receipts list only they could open, which is a strange place to keep a badge
   whose entire value is that other people can see it.

   Every one of those is the same kind of fact — "this is what I am at this
   airline" — and not one of them was anywhere near the top of the page. So
   they are all here now, in one row, across the hero, where a pilot sees them
   before anything else.

   ONE FETCH, BECAUSE IT IS ONE ROW

   GET /me/badges joins all four server-side. A hero stitched together from
   four fetches is a hero that renders four times and settles into the right
   answer last — and the hero is the first thing anybody sees. It does not get
   to flicker. See crewBadges.js on the backend for what goes in it and why the
   order is what it is.

   DRAWN ON AN IMAGE, SO IT IS BUILT FOR ONE

   The hero is a photograph with a dark gradient over it, and a badge that
   looks right on the VA's cream dashboard is invisible on it. These are glass:
   a blurred white film, a white hairline, white text, and the badge's own
   colour carried in a dot rather than a fill — a row of saturated pills over a
   photo reads as a toolbar. Every one is a button that opens the panel the
   badge came from, which is what stops this being decoration.

   IT DRAWS NOTHING UNTIL THERE IS SOMETHING TRUE TO SAY. A pilot on their
   first day at a VA with no rank ladder has an empty row, and an empty row is
   removed rather than left as a gap under their name.

   Requires crewPanels.js.
   ========================================================================== */

(function () {
    'use strict';

    const P = window.CrewPanels;
    if (!P) { console.warn('crewBadges: crewPanels.js must load first'); return; }
    const { esc, icons, relativeText } = P;

    const S = {
        api: null,
        data: null,
        hosts: [],
        // Where the crest is drawn, kept apart from the rail's hosts: a page
        // may have one, the other, or both, and what the rail draws depends on
        // whether a crest is taking the two ladders off it.
        crests: [],
        onOpen: null,
        panel: null,
    };

    /* How many fit across a hero before it stops being a row. The rest are
       reachable through the "+n" chip, which opens the lot in a panel — a rail
       that scrolls sideways on a photograph is a rail nobody discovers. */
    const RAIL_MAX = 6;

    /* =====================================================================
     * STYLES
     * =================================================================== */

    function styles() {
        P.baseStyles();
        P.style('crew-badges', `
        /* ---- THE RAIL, ON THE HERO --------------------------------------
           Glass on a photograph. Every colour here is white-on-dark and none
           of it is a page token, because this sits on the VA's own hero image
           rather than on the page — the one place in the crew center where
           the surrounding colour is not ours to know. */
        .cb-rail{ display:flex; flex-wrap:wrap; gap:.4rem; align-items:center; }
        .cb{ display:inline-flex; align-items:center; gap:.45rem; max-width:13rem;
            padding:.32rem .6rem .32rem .42rem; border-radius:999px; cursor:pointer;
            font:inherit; color:#fff; text-align:left;
            background:rgb(255 255 255 / .14); border:1px solid rgb(255 255 255 / .22);
            backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
            transition:background .16s ease, transform .16s cubic-bezier(.22,1.12,.36,1); }
        .cb:hover{ background:rgb(255 255 255 / .24); transform:translateY(-1px); }
        .cb:focus-visible{ outline:2px solid #fff; outline-offset:2px; }
        /* The badge's own colour, as a mark rather than a fill. A row of
           saturated pills over a photo reads as a toolbar; a row of glass with
           coloured marks reads as a set of badges. */
        .cb-mark{ width:1.35rem; height:1.35rem; border-radius:999px; flex:none;
            display:grid; place-items:center; overflow:hidden;
            background:radial-gradient(120% 120% at 30% 20%,
                color-mix(in srgb, var(--cb-c, #fff) 82%, #fff 18%), var(--cb-c, rgb(255 255 255 / .3)));
            box-shadow:inset 0 1px 0 rgb(255 255 255 / .5); }
        .cb-mark i{ width:.8rem; height:.8rem; color:#fff;
            filter:drop-shadow(0 1px 1px rgb(0 0 0 / .4)); }
        .cb-mark img{ width:100%; height:100%; object-fit:cover; }
        .cb-text{ min-width:0; display:grid; }
        .cb-name{ font-size:.78rem; font-weight:700; letter-spacing:-.005em; line-height:1.15;
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        /* The label under the name — "Rank", "Club · 2 benefits", "Claimed".
           It is what stops a row of names being a row of mysteries. */
        .cb-note{ font-size:.6rem; font-weight:700; letter-spacing:.07em; text-transform:uppercase;
            opacity:.75; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cb-x{ font-size:.66rem; font-weight:800; opacity:.9; flex:none;
            padding-left:.1rem; }
        .cb-more{ background:rgb(255 255 255 / .1); }
        /* The rank is the one thing on this row somebody else decided, and it
           is how this pilot is addressed. It reads first and it reads louder. */
        .cb-rank{ background:rgb(255 255 255 / .22); border-color:rgb(255 255 255 / .34); }
        @media (max-width:640px){
            /* One line on a phone, scrolled rather than wrapped: the hero is
               320px tall there and a rail that wraps to three rows pushes the
               name and the buttons off it. */
            .cb-rail{ flex-wrap:nowrap; overflow-x:auto; padding-bottom:.2rem;
                scrollbar-width:none; -ms-overflow-style:none; }
            .cb-rail::-webkit-scrollbar{ display:none; }
            .cb{ flex:none; }
        }
        @media (prefers-reduced-motion:reduce){ .cb{ transition:none; } }
        /* ---- THE CREST, ON THE RIGHT OF THE HERO -------------------------
           THE TWO LADDERS, AT THE SIZE THEY ARE WORTH.

           A rank and a club were pills in the rail below, the same size and
           shape as "3 badges" and "First pick of the gate". They are not the
           same kind of thing. A rank is what the airline calls this pilot; a
           club is what their flying has earned them. Everything else in the
           rail is a thing they bought or collected.

           So the two ladders come out of the rail and go to the top-right of
           the hero, opposite the airline's own mark — the airline on one side,
           what this pilot is at it on the other — drawn as emblems with the
           VA's own artwork rather than as text with a dot beside it. The rail
           underneath keeps the awards and the holdings, and the "+n" chip
           still opens the lot.

           STACKED ON A PHONE'S HERO, AND SMALLER. 320px of hero has a name, a
           line, a rail and two buttons to fit; a pair of 64px emblems is a
           hero with no room left for the pilot. */
        .cb-crest{ display:flex; align-items:flex-start; gap:.5rem; flex:none; }
        .cb-crest-item{ display:grid; justify-items:center; gap:.3rem; width:4.6rem;
            padding:.5rem .35rem .55rem; border-radius:1rem; cursor:pointer; font:inherit;
            color:#fff; text-align:center;
            background:rgb(0 0 0 / .28); border:1px solid rgb(255 255 255 / .18);
            backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
            transition:background .16s ease, transform .16s cubic-bezier(.22,1.12,.36,1); }
        .cb-crest-item:hover{ background:rgb(0 0 0 / .4); transform:translateY(-1px); }
        .cb-crest-item:focus-visible{ outline:2px solid #fff; outline-offset:2px; }
        /* The emblem itself. Same gradient-from-its-own-colour as the rail's
           mark, three times the size, and with room for the VA's uploaded
           artwork to be the whole of it. */
        .cb-crest-mark{ width:2.6rem; height:2.6rem; border-radius:999px; display:grid; place-items:center;
            overflow:hidden; background:radial-gradient(120% 120% at 30% 20%,
                color-mix(in srgb, var(--cb-c, #fff) 82%, #fff 18%), var(--cb-c, rgb(255 255 255 / .3)));
            box-shadow:inset 0 1px 0 rgb(255 255 255 / .5), 0 4px 12px rgb(0 0 0 / .3); }
        .cb-crest-mark i{ width:1.3rem; height:1.3rem; color:#fff;
            filter:drop-shadow(0 1px 2px rgb(0 0 0 / .45)); }
        .cb-crest-mark img{ width:100%; height:100%; object-fit:cover; }
        .cb-crest-kind{ font-size:.53rem; font-weight:800; letter-spacing:.11em; text-transform:uppercase;
            opacity:.7; line-height:1; }
        .cb-crest-name{ font-size:.68rem; font-weight:700; letter-spacing:-.005em; line-height:1.15;
            max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        @media (max-width:640px){
            .cb-crest{ gap:.35rem; }
            .cb-crest-item{ width:3.7rem; padding:.4rem .25rem .45rem; border-radius:.85rem; }
            .cb-crest-mark{ width:2rem; height:2rem; }
            .cb-crest-mark i{ width:1rem; height:1rem; }
            .cb-crest-name{ font-size:.6rem; }
        }
        @media (prefers-reduced-motion:reduce){ .cb-crest-item{ transition:none; } }
        /* ---- THE SAME BADGES, IN A PANEL --------------------------------
           Where the whole set lives once there are more than a hero can hold.
           Off the photograph, so these are ordinary page tokens again. */
        .cb-list{ display:grid; gap:.35rem; }
        .cb-h{ font-size:.7rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
            color:var(--muted,#736E64); margin-top:.6rem; }
        .cb-h:first-child{ margin-top:0; }
        .cb-row{ display:flex; align-items:center; gap:.65rem; width:100%; text-align:left;
            padding:.55rem .6rem; border-radius:.6rem; cursor:pointer; font:inherit; color:inherit;
            border:1px solid var(--line,#e5e5e5); background:var(--surface,#fff); }
        .cb-row:hover{ border-color:color-mix(in srgb, var(--accent) 45%, transparent); }
        .cb-row .cb-mark{ width:1.9rem; height:1.9rem; }
        .cb-row .cb-mark i{ width:1rem; height:1rem; }
        .cb-row-main{ flex:1; min-width:0; display:grid; gap:.1rem; }
        .cb-row-name{ font-weight:650; letter-spacing:-.01em; }
        .cb-row-note{ font-size:.72rem; color:var(--muted,#736E64); }
        .cb-row-x{ font-size:.75rem; font-weight:700; color:var(--muted,#736E64); flex:none; }
        `);
    }

    /* =====================================================================
     * DRAWING
     * =================================================================== */

    /** A colour we are willing to put in a style attribute. */
    const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim() : '');

    /**
     * The mark: the VA's own image where they uploaded one, their icon
     * otherwise.
     *
     * An image that fails to load leaves an empty circle rather than a broken
     * frame — the circle is already the badge's colour, so the failure looks
     * like a plain badge instead of like a bug.
     */
    function markHtml(b) {
        const c = hex(b.color);
        const style = c ? ` style="--cb-c:${esc(c)}"` : '';
        const inner = b.image && P.safeUrl(b.image)
            ? `<img src="${esc(b.image)}" alt="" loading="lazy" onerror="this.remove()">`
            : `<i data-lucide="${esc(b.icon || 'award')}"></i>`;
        return `<span class="cb-mark"${style} aria-hidden="true">${inner}</span>`;
    }

    /**
     * One badge, on the hero.
     *
     * A button rather than a div: every badge leads to the screen it came
     * from, and a badge you cannot follow is a sticker. The accessible name
     * carries the label and the count, because "Gold" on its own tells a
     * screen reader nothing about which of the four kinds of thing it is.
     */
    function chipHtml(b) {
        const times = Number(b.count) > 1 ? `<span class="cb-x">×${Number(b.count)}</span>` : '';
        const label = [b.name, b.note, Number(b.count) > 1 ? `${b.count} of them` : ''].filter(Boolean).join(', ');
        return `<button type="button" class="cb${b.kind === 'rank' ? ' cb-rank' : ''}"
            data-cb-open="${esc(b.opens || '')}" title="${esc(label)}" aria-label="${esc(label)}">
            ${markHtml(b)}
            <span class="cb-text">
                <span class="cb-name">${esc(b.name)}</span>
                <span class="cb-note">${esc(b.note || '')}</span>
            </span>${times}
        </button>`;
    }

    /** The two ladders, in the order a crest reads them. */
    const CREST_KINDS = ['rank', 'club'];
    const crestBadges = () => ((S.data && S.data.badges) || []).filter((b) => CREST_KINDS.indexOf(b.kind) !== -1)
        .sort((a, b) => CREST_KINDS.indexOf(a.kind) - CREST_KINDS.indexOf(b.kind));

    function crestItemHtml(b) {
        const c = hex(b.color);
        const style = c ? ` style="--cb-c:${esc(c)}"` : '';
        const inner = b.image && P.safeUrl(b.image)
            ? `<img src="${esc(b.image)}" alt="" loading="lazy" onerror="this.remove()">`
            : `<i data-lucide="${esc(b.icon || (b.kind === 'club' ? 'gem' : 'award'))}"></i>`;
        const kind = b.kind === 'club' ? 'Club' : 'Rank';
        const label = [kind, b.name, b.note].filter(Boolean).join(', ');
        return `<button type="button" class="cb-crest-item" data-cb-open="${esc(b.opens || '')}"
            title="${esc(label)}" aria-label="${esc(label)}">
            <span class="cb-crest-mark"${style} aria-hidden="true">${inner}</span>
            <span class="cb-crest-kind">${esc(kind)}</span>
            <span class="cb-crest-name">${esc(b.name)}</span>
        </button>`;
    }

    function crestHtml() {
        const rows = crestBadges();
        if (!rows.length) return '';
        return `<div class="cb-crest">${rows.map(crestItemHtml).join('')}</div>`;
    }

    function paintCrest() {
        S.crests = S.crests.filter((h) => h.isConnected);
        S.crests.forEach((host) => {
            const html = crestHtml();
            if (!html) { host.innerHTML = ''; host.classList.add('cp-hidden'); return; }
            host.classList.remove('cp-hidden');
            host.innerHTML = html;
            if (!host.dataset.cbWired) {
                host.dataset.cbWired = '1';
                host.addEventListener('click', onClick);
            }
            try { icons(); } catch (_) {}
        });
    }

    function railHtml() {
        const all = (S.data && S.data.badges) || [];
        // The rank and the club are drawn as the crest where a page has one —
        // the same badge in both places is the same fact said twice, and the
        // rail is the one that loses, because it is the one that says it small.
        const mine = S.crests.length ? all.filter((b) => CREST_KINDS.indexOf(b.kind) === -1) : all;
        if (!mine.length) return '';
        const shown = mine.slice(0, RAIL_MAX);
        // The "+n" counts against what this rail is actually showing, not
        // against a total that includes two badges drawn twice the size
        // immediately above it.
        const rest = Math.max(0, (Number(S.data.total) || all.length)
            - (all.length - mine.length) - shown.length);
        return `<div class="cb-rail">
            ${shown.map(chipHtml).join('')}
            ${rest > 0 ? `<button type="button" class="cb cb-more" data-cb-all
                aria-label="See all ${Number(S.data.total) || all.length} badges">
                <span class="cb-text"><span class="cb-name">+${rest} more</span></span>
            </button>` : ''}
        </div>`;
    }

    function paint() {
        paintCrest();
        S.hosts = S.hosts.filter((h) => h.isConnected);
        S.hosts.forEach((host) => {
            const html = railHtml();
            if (!html) { host.innerHTML = ''; host.classList.add('cp-hidden'); return; }
            host.classList.remove('cp-hidden');
            host.innerHTML = html;
            if (!host.dataset.cbWired) {
                host.dataset.cbWired = '1';
                host.addEventListener('click', onClick);
            }
            try { icons(); } catch (_) {}
        });
    }

    /* =====================================================================
     * THE WHOLE SET
     *
     * Six fit across a hero. A pilot who has earned more than six should not
     * have to take the platform's word for it, so the "+n" chip opens the lot
     * — grouped by kind, because "what have I earned" and "what did I buy" are
     * two questions and a flat list answers neither.
     * =================================================================== */

    const GROUPS = [
        ['rank', 'Your rank'],
        ['club', 'Your club'],
        ['award', 'Earned'],
        ['held', 'Claimed'],
    ];

    function panelHtml() {
        const all = (S.data && S.data.badges) || [];
        if (!all.length) {
            return `<div class="cp-empty"><i data-lucide="award"></i>
                Nothing yet. Your rank, your club and everything you earn shows up here.</div>`;
        }
        return GROUPS.map(([kind, heading]) => {
            const rows = all.filter((b) => b.kind === kind);
            if (!rows.length) return '';
            return `<div class="cb-h">${esc(heading)}</div>
                <div class="cb-list">${rows.map(rowHtml).join('')}</div>`;
        }).join('');
    }

    function rowHtml(b) {
        const when = b.at ? relativeText(b.at) : '';
        const note = [b.note, when].filter(Boolean).join(' · ');
        return `<button type="button" class="cb-row" data-cb-open="${esc(b.opens || '')}">
            ${markHtml(b)}
            <span class="cb-row-main">
                <span class="cb-row-name">${esc(b.name)}</span>
                ${note ? `<span class="cb-row-note">${esc(note)}</span>` : ''}
            </span>
            ${Number(b.count) > 1 ? `<span class="cb-row-x">×${Number(b.count)}</span>` : ''}
        </button>`;
    }

    function openAll() {
        styles();
        if (!S.panel) {
            S.panel = P.sheet({ id: 'crewBadges', title: 'What you’ve got', icon: 'award' });
            S.panel.el.addEventListener('click', onClick);
        }
        S.panel.open();
        S.panel.body.innerHTML = panelHtml();
        try { icons(); } catch (_) {}
    }

    /* =====================================================================
     * WIRING
     * =================================================================== */

    function onClick(ev) {
        if (ev.target.closest('[data-cb-all]')) { openAll(); return; }
        const go = ev.target.closest('[data-cb-open]');
        if (!go) return;
        const where = go.getAttribute('data-cb-open');
        // The page owns what each of these means — it is the page that knows
        // which panels it has mounted. No handler is not an error: the row is
        // still worth drawing, it simply does not lead anywhere on a page that
        // has not said where.
        if (where && typeof S.onOpen === 'function') S.onOpen(where);
    }

    /* =====================================================================
     * PUBLIC
     * =================================================================== */

    /**
     * Paint the rail into a page.
     *
     * Same contract as CrewShop.mountCard and CrewSuggestions.mountStrip:
     * hidden until there is something true to say, and silent when there is
     * not. A pilot with no rank at a VA with no ladder has no row, and a gap
     * under their name is worse than no row at all.
     */
    function mountRail(host, { api, onOpen } = {}) {
        if (!host || typeof api !== 'function') return;
        styles();
        S.api = api;
        if (onOpen) S.onOpen = onOpen;
        host.classList.add('cp-hidden');
        if (S.hosts.indexOf(host) === -1) S.hosts.push(host);
        if (S.data) { paint(); return; }
        S.api('/me/badges')
            .then((d) => { S.data = d; paint(); })
            .catch(() => { /* no badges, no row, no noise */ });
    }

    /** Read it again — after a purchase, or a flight being approved. */
    function refresh() {
        if (typeof S.api !== 'function') return Promise.resolve();
        return S.api('/me/badges')
            .then((d) => { S.data = d; paint(); if (S.panel && S.panel.isOpen()) openAll(); })
            .catch(() => {});
    }

    /**
     * Paint the crest into a page — the rank and the club, as emblems.
     *
     * Same contract as mountRail and for the same reason: hidden until the
     * fetch lands and there is a ladder to draw. A VA with no rank ladder and
     * no clubs has nothing to put in the corner of its hero, and an empty
     * frame there is worse than a clean photograph.
     *
     * Mounting this CHANGES THE RAIL: the two ladders come out of it, because
     * the same badge at two sizes in the same hero is the same fact said
     * twice. Call it before mountRail, or call both and let the rail repaint.
     */
    function mountCrest(host, { api, onOpen } = {}) {
        if (!host) return;
        styles();
        if (typeof api === 'function') S.api = api;
        if (onOpen) S.onOpen = onOpen;
        host.classList.add('cp-hidden');
        if (S.crests.indexOf(host) === -1) S.crests.push(host);
        if (S.data) { paint(); return; }
        if (typeof S.api !== 'function') return;
        S.api('/me/badges')
            .then((d) => { S.data = d; paint(); })
            .catch(() => { /* no badges, no crest, no noise */ });
    }

    window.CrewBadges = { mountRail, mountCrest, openAll, refresh };
})();
