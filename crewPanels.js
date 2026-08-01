/* ============================================================================
   crewPanels.js — the shared chrome the crew center's panels are built from.

   WHY THIS EXISTS

   crewEvents.js arrived first and, being the only module of its kind, brought
   its own everything: a slide-over shell, a toast, an API helper, a date
   formatter and two hundred lines of CSS. That was right for one module. It is
   wrong for five — the noticeboard, the schedule, the embeds and the
   partnership panel would otherwise each carry their own copy of the same
   sheet, and a VA's brand token would have to be plumbed into all of them
   separately every time the design moved.

   So the fifth copy became this instead. It is deliberately NOT a framework:
   no components, no state, no rendering. It is the four things every panel in
   this product needs and nothing else —

     CrewPanels.style(id, css)      one <style>, added once, idempotent
     CrewPanels.sheet({...})        a slide-over shell with a header + body
     CrewPanels.toast(msg, tone)    the same toast crewEvents uses, one host
     CrewPanels.api({backend,slug,token})  a fetch bound to /api/crew/<slug>

   plus the small formatting helpers (esc, whenText, relativeText) that were
   about to be written a fourth time.

   crewEvents.js is deliberately left alone. It works, it is heavily tested by
   use, and rewriting it to sit on this would be a large change to a shipped
   feature to buy tidiness. Its `cev-` classes and this file's `cp-` classes
   describe the same design in two places; if crewEvents is ever touched at
   depth, that is the moment to fold it in.

   EVERY COLOUR IS A var() OFF THE HOST PAGE. That is what lets one module sit
   inside the owner dashboard, the pilot home and a VA's own brand theme
   without three stylesheets — a VA who themes their crew center themes this
   too. Nothing here has a hardcoded palette except the three status colours
   (green/amber/red) that mean the same thing in every brand.

   Loaded as a classic script, like crewBrand.js and crewBridge.js, and must be
   loaded BEFORE the panels that use it.
   ========================================================================== */

(function () {
    'use strict';

    /* ---------------------------------------------------------------------
     * Formatting. Local to this file for the reason crewEvents keeps its own:
     * these modules are dropped into several different pages and must not
     * depend on which of them happens to define escapeHtml.
     * ------------------------------------------------------------------- */

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

    /** An URL we are willing to put in an <img> or an iframe. https, or ours. */
    const safeUrl = (u) => {
        try {
            const url = new URL(u, location.href);
            return url.origin === location.origin || url.protocol === 'https:';
        } catch { return false; }
    };

    const icons = () => { if (window.lucide) window.lucide.createIcons(); };

    /** A date a human reads, in THEIR timezone — never in Z. */
    function whenText(iso, { withYear = false } = {}) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleString(undefined, {
            weekday: 'short', day: 'numeric', month: 'short',
            year: withYear ? 'numeric' : undefined,
            hour: '2-digit', minute: '2-digit',
        });
    }

    /** Just the clock, for a row that already says which day it is. */
    function timeText(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    /** The day, for grouping a schedule into days. Stable per local date. */
    function dayKey(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        // Local, not UTC: a VA reading their Thursday must see Thursday's
        // flying, and a toISOString() key would roll it over at 00:00Z.
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function dayLabel(iso) {
        if (!iso) return 'Undated';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return 'Undated';
        const today = dayKey(new Date().toISOString());
        const tomorrow = dayKey(new Date(Date.now() + 86400000).toISOString());
        const key = dayKey(iso);
        if (key === today) return 'Today';
        if (key === tomorrow) return 'Tomorrow';
        return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    }

    /**
     * "3 days ago" / "in 2 hours" / "just now".
     *
     * Both directions from one function because a noticeboard looks backwards
     * and a schedule looks forwards, and having two of these is how they end up
     * disagreeing about what "an hour" rounds to.
     */
    function relativeText(iso) {
        if (!iso) return '';
        const t = new Date(iso).getTime();
        if (Number.isNaN(t)) return '';
        const diff = t - Date.now();
        const ahead = diff > 0;
        const mins = Math.round(Math.abs(diff) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return ahead ? `in ${mins} min` : `${mins} min ago`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return ahead ? `in ${hours}h` : `${hours}h ago`;
        const days = Math.round(hours / 24);
        if (days === 1) return ahead ? 'tomorrow' : 'yesterday';
        if (days < 30) return ahead ? `in ${days} days` : `${days} days ago`;
        const months = Math.round(days / 30);
        if (months < 12) return ahead ? `in ${months} mo` : `${months} mo ago`;
        const years = Math.round(months / 12);
        return ahead ? `in ${years}y` : `${years}y ago`;
    }

    /** "8h 12m" from a minute count. '' when there is nothing to say. */
    function durationText(mins) {
        const m = Math.round(Number(mins) || 0);
        if (m <= 0) return '';
        const h = Math.floor(m / 60);
        return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
    }

    /* ---------------------------------------------------------------------
     * Styles
     * ------------------------------------------------------------------- */

    /** Add a stylesheet once. Returns true the first time, false thereafter. */
    function style(id, css) {
        if (document.getElementById(id)) return false;
        const el = document.createElement('style');
        el.id = id;
        el.textContent = css;
        document.head.appendChild(el);
        return true;
    }

    function baseStyles() {
        style('cp-styles', `
        .cp-hidden{ display:none !important; }
        #cp-toasts{ position:fixed; bottom:1rem; left:50%; transform:translateX(-50%);
            z-index:120; display:flex; flex-direction:column; gap:.5rem; pointer-events:none; }
        .cp-toast{ background:var(--ink,#1C1A16); color:var(--bg,#fff); padding:.6rem 1rem;
            border-radius:.6rem; font-size:.85rem; font-weight:500; box-shadow:0 8px 24px rgba(0,0,0,.18);
            max-width:min(90vw,26rem); transition:opacity .3s, transform .3s; }
        .cp-toast-ok{ background:#16A34A; color:#fff; }
        .cp-toast-bad{ background:#DC2626; color:#fff; }
        .cp-toast.cp-out{ opacity:0; transform:translateY(6px); }

        .cp-panel{ position:fixed; inset:0; z-index:70; }
        .cp-scrim{ position:absolute; inset:0; background:rgba(0,0,0,.45); }
        .cp-sheet{ position:absolute; right:0; top:0; height:100%; width:100%;
            max-width:46rem; background:var(--surface,#fff); border-left:1px solid var(--line,#e5e5e5);
            overflow-y:auto; display:flex; flex-direction:column; }
        .cp-sheet-wide{ max-width:64rem; }
        .cp-head{ position:sticky; top:0; z-index:3; display:flex; align-items:center;
            justify-content:space-between; gap:.75rem; padding:0 1rem; height:3.75rem;
            background:var(--surface,#fff); border-bottom:1px solid var(--line,#e5e5e5); }
        .cp-head-title{ display:flex; align-items:center; gap:.6rem; font-weight:700;
            letter-spacing:-.01em; min-width:0; color:var(--ink,#1C1A16); }
        .cp-head-title>span{ min-width:0; }
        .cp-sub{ display:block; font-size:.72rem; font-weight:500; color:var(--muted,#736E64); }
        .cp-head-actions{ display:flex; align-items:center; gap:.5rem; }
        .cp-body{ padding:1rem; display:grid; gap:.9rem; align-content:start; }

        .cp-icon-btn{ width:2.25rem; height:2.25rem; display:grid; place-items:center; border-radius:.5rem;
            color:var(--muted,#736E64); background:transparent; border:0; cursor:pointer; }
        .cp-icon-btn:hover{ color:var(--ink,#1C1A16); }
        .cp-btn{ display:inline-flex; align-items:center; gap:.4rem; padding:.55rem .9rem;
            border-radius:.5rem; font-size:.85rem; font-weight:600; cursor:pointer;
            background:var(--surface,#fff); color:var(--ink,#1C1A16);
            border:1px solid var(--line,#e5e5e5); }
        .cp-btn:hover{ border-color:var(--ink,#1C1A16); }
        .cp-btn:disabled{ opacity:.55; cursor:default; }
        .cp-btn-primary{ background:var(--accent,#1C1A16); color:#fff; border-color:transparent; }
        .cp-btn-primary:hover{ opacity:.9; border-color:transparent; }
        .cp-btn-bad{ color:#DC2626; }
        .cp-btn-sm{ padding:.35rem .6rem; font-size:.78rem; }
        .cp-btn i,.cp-fact i{ width:1em; height:1em; }

        .cp-card{ border:1px solid var(--line,#e5e5e5); border-radius:.75rem;
            background:var(--surface,#fff); padding:.9rem 1rem; }
        .cp-card-title{ font-size:.95rem; font-weight:700; letter-spacing:-.01em; margin:0;
            color:var(--ink,#1C1A16); }
        .cp-chip{ display:inline-flex; align-items:center; gap:.25rem; font-size:.68rem; font-weight:700;
            letter-spacing:.03em; text-transform:uppercase; padding:.15rem .45rem; border-radius:.3rem;
            border:1px solid var(--line,#e5e5e5); color:var(--muted,#736E64); }
        .cp-chip-ok{ background:#16A34A; color:#fff; border-color:transparent; }
        .cp-chip-warn{ background:#D97706; color:#fff; border-color:transparent; }
        .cp-chip-bad{ background:#DC2626; color:#fff; border-color:transparent; }
        .cp-chip-mute{ background:var(--line,#e5e5e5); color:var(--muted,#736E64); }
        .cp-chip-accent{ background:var(--accent,#1C1A16); color:#fff; border-color:transparent; }
        .cp-fact{ display:inline-flex; align-items:center; gap:.35rem; font-size:.82rem;
            color:var(--muted,#736E64); }
        .cp-facts{ display:flex; flex-wrap:wrap; gap:.35rem .9rem; }
        .cp-muted{ color:var(--muted,#736E64); }
        .cp-faint{ color:var(--faint,#A8A296); }

        .cp-input,.cp-select,.cp-textarea{ width:100%; background:var(--surface,#fff);
            color:var(--ink,#1C1A16); border:1px solid var(--line,#e5e5e5); border-radius:.5rem;
            padding:.5rem .7rem; font-size:.85rem; font-family:inherit; }
        .cp-input:focus,.cp-select:focus,.cp-textarea:focus{ outline:none; border-color:var(--ink,#1C1A16); }
        .cp-textarea{ resize:vertical; min-height:4.5rem; }
        .cp-label{ display:block; font-size:.72rem; font-weight:700; text-transform:uppercase;
            letter-spacing:.04em; color:var(--faint,#A8A296); margin-bottom:.3rem; }
        .cp-grid2{ display:grid; grid-template-columns:1fr 1fr; gap:.6rem; }
        @media (max-width:34rem){ .cp-grid2{ grid-template-columns:1fr; } }

        .cp-empty{ text-align:center; padding:2.5rem 1rem; color:var(--muted,#736E64); font-size:.9rem; }
        .cp-empty i{ width:1.6rem; height:1.6rem; display:block; margin:0 auto .6rem;
            color:var(--faint,#A8A296); }
        .cp-note{ font-size:.8rem; color:var(--muted,#736E64); }
        .cp-note-bad{ color:#DC2626; }
        .cp-note-warn{ color:#D97706; }
        @media (prefers-reduced-motion:reduce){ .cp-card,.cp-toast{ transition:none; } }

        /* ===================================================================
         * MOBILE
         *
         * Not the desktop panel made narrow — a different shape.
         *
         * A slide-over is a desktop idea: it comes from the right because there
         * is somewhere for it to come from. On a phone it is the whole screen,
         * so the sideways animation says nothing, the close button sits in the
         * furthest corner from a thumb, and the sheet covers the page with no
         * hint that the page is still there.
         *
         * So below 40rem these become BOTTOM SHEETS: they rise from the edge
         * the thumb is nearest, stop short of the top so the page behind stays
         * visible (which is what makes "tap outside to close" discoverable),
         * and carry a grab handle in a sticky header that does not scroll away.
         *
         * Three details that matter more on a phone than they look:
         *
         *   · dvh, not vh. Mobile Safari's vh is the height WITHOUT the address
         *     bar, so a 92vh sheet is taller than the screen until you scroll,
         *     and the bottom of it — where the buttons are — sits under the
         *     chrome. dvh tracks the real viewport. vh is kept as a fallback
         *     first, so a browser without dvh gets something sane.
         *   · env(safe-area-inset-bottom). Without it the last button sits
         *     under the home indicator on every notched phone.
         *   · 44px minimum on anything tappable. Below that, a control is a
         *     coin toss.
         * ================================================================= */
        @media (max-width:40rem){
            .cp-sheet{
                right:0; left:0; top:auto; bottom:0;
                width:100%; max-width:none;
                height:auto; max-height:92vh; max-height:92dvh;
                border-left:0; border-top:1px solid var(--line,#e5e5e5);
                border-radius:1.1rem 1.1rem 0 0;
                padding-bottom:env(safe-area-inset-bottom,0px);
            }
            .cp-head{
                position:sticky; padding-top:.75rem; height:auto; min-height:3.5rem;
                border-radius:1.1rem 1.1rem 0 0;
            }
            /* The grab handle. On the sticky header, not the scrolling body, so
               it is still there after the sheet has been scrolled. */
            .cp-head::before{
                content:''; position:absolute; top:.4rem; left:50%; transform:translateX(-50%);
                width:2.25rem; height:.25rem; border-radius:999px;
                background:var(--line,#e5e5e5);
            }
            .cp-body{ padding:.85rem .85rem 1.5rem; }
            .cp-icon-btn{ width:2.75rem; height:2.75rem; }
            .cp-btn{ min-height:2.75rem; }
            .cp-btn-sm{ min-height:2.5rem; padding:.5rem .75rem; font-size:.82rem; }
            /* 16px, so iOS does not zoom the page when a field takes focus —
               which it does silently below 16 and never undoes. */
            .cp-input,.cp-select,.cp-textarea{ font-size:1rem; padding:.6rem .75rem; }
            .cp-grid2{ grid-template-columns:1fr; }
            #cp-toasts{ bottom:calc(1rem + env(safe-area-inset-bottom,0px)); width:100%; padding:0 1rem; }
            .cp-toast{ max-width:none; }
        }`);
    }

    /* ---------------------------------------------------------------------
     * Scroll locking
     *
     * With a sheet open, the PAGE behind it still scrolls under a touch that
     * misses the sheet — and on iOS the scroll chains through to the body even
     * when it does not, so flicking a list to its end starts dragging the
     * dashboard around behind it.
     *
     * Counted rather than boolean: the schedule opens a dialog on top of its
     * own panel, and the dialog closing must not unlock the page while the
     * panel is still up.
     * ------------------------------------------------------------------- */
    let lockCount = 0;
    let lockedScrollY = 0;

    function lockScroll() {
        if (lockCount++ > 0) return;
        lockedScrollY = window.scrollY || 0;
        const b = document.body;
        b.style.position = 'fixed';
        b.style.top = `-${lockedScrollY}px`;
        b.style.left = '0';
        b.style.right = '0';
        b.style.width = '100%';
    }

    function unlockScroll() {
        if (lockCount === 0) return;
        if (--lockCount > 0) return;
        const b = document.body;
        b.style.position = '';
        b.style.top = '';
        b.style.left = '';
        b.style.right = '';
        b.style.width = '';
        // position:fixed dropped the page to the top; put it back where the
        // reader was, or opening a panel becomes a way to lose your place.
        window.scrollTo(0, lockedScrollY);
    }

    /* ---------------------------------------------------------------------
     * Toast
     * ------------------------------------------------------------------- */

    function toast(msg, tone) {
        baseStyles();
        let host = document.getElementById('cp-toasts');
        if (!host) {
            host = document.createElement('div');
            host.id = 'cp-toasts';
            document.body.appendChild(host);
        }
        const el = document.createElement('div');
        el.className = 'cp-toast cp-toast-' + (tone || 'info');
        el.textContent = msg;
        host.appendChild(el);
        setTimeout(() => { el.classList.add('cp-out'); setTimeout(() => el.remove(), 300); }, 4200);
    }

    /* ---------------------------------------------------------------------
     * Who owns the Escape key
     *
     * A sheet and a dialog stacked on it BOTH listen on `document`, and the
     * sheet listens first because it opened first. So one Escape ran both
     * handlers: the dialog closed, and the schedule behind it closed with it.
     * Dismissing a departure's detail threw away the schedule the reader was
     * looking at, and the editor and the crew list did the same.
     *
     * stopPropagation cannot fix that — the two listeners are on the same node,
     * and the sheet's has already run by the time the dialog's is reached. So
     * the sheet asks instead: is there a layer above me? If there is, the
     * Escape is not mine.
     *
     * Selector rather than a registry because the dialogs are built by modules
     * that do not otherwise talk to this one, which is the same reason
     * anythingOpen() below matches on classes.
     * ------------------------------------------------------------------- */

    const TOP_LAYER = '.cp-dialog, .cs-dialog, .cev-modal:not(.cev-hidden)';
    const somethingOnTop = () => !!document.querySelector(TOP_LAYER);

    /* ---------------------------------------------------------------------
     * The slide-over shell
     * ------------------------------------------------------------------- */

    /**
     * Build (once) and return a panel: a scrim, a sheet, a sticky header and a
     * body you render into.
     *
     * Returns { el, body, head, open(), close(), setActions(html) }. The body is
     * yours; everything else is handled — scrim click, the close button and
     * Escape all close it, which is the part every panel would otherwise get
     * subtly differently.
     */
    function sheet({ id, title, icon = 'panel-top', wide = false, actions = '' }) {
        baseStyles();
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.className = 'cp-panel cp-hidden';
            el.innerHTML = `
                <div class="cp-scrim" data-cp-close></div>
                <div class="cp-sheet${wide ? ' cp-sheet-wide' : ''}">
                    <header class="cp-head">
                        <div class="cp-head-title"><i data-lucide="${esc(icon)}"></i> <span>${esc(title)}</span></div>
                        <div class="cp-head-actions">
                            ${actions}
                            <button class="cp-icon-btn" data-cp-close aria-label="Close"><i data-lucide="x"></i></button>
                        </div>
                    </header>
                    <div class="cp-body"></div>
                </div>`;
            document.body.appendChild(el);
            el.addEventListener('click', (ev) => {
                if (ev.target.closest('[data-cp-close]')) close();
            });
        }

        let isOpen = false;
        const open = () => {
            // Guarded, because open() is called on every tile press and the
            // scroll lock is counted — an unguarded second call would take a
            // second lock that nothing ever releases.
            if (isOpen) return;
            isOpen = true;
            el.classList.remove('cp-hidden');
            // One listener while open, removed on close. A panel that leaves an
            // Escape handler behind starts closing panels it does not own.
            document.addEventListener('keydown', onKey);
            lockScroll();
            // Guarded, because it is the last thing between the lock and the
            // caller. lucide throws on an icon name it does not know, and an
            // exception escaping here would leave the page locked behind a
            // panel that never finished opening — the white screen this file's
            // safety net exists to catch. A missing icon is not worth that.
            try { icons(); } catch (err) { console.warn('crewPanels: icons failed', err); }
        };
        const close = () => {
            if (!isOpen) return;
            isOpen = false;
            el.classList.add('cp-hidden');
            document.removeEventListener('keydown', onKey);
            unlockScroll();
        };
        function onKey(ev) { if (ev.key === 'Escape' && !somethingOnTop()) close(); }

        return {
            el,
            body: el.querySelector('.cp-body'),
            head: el.querySelector('.cp-head'),
            open,
            close,
            isOpen: () => isOpen,
            setTitle: (t) => { el.querySelector('.cp-head-title span').textContent = t; },
        };
    }

    /* ---------------------------------------------------------------------
     * The backend
     * ------------------------------------------------------------------- */

    /**
     * A fetch bound to one crew center.
     *
     * `token` is taken as a FUNCTION for the reason crewEvents takes one: a
     * session can be replaced mid-visit (a pilot changes their password and
     * gets a fresh one), and a token captured at mount time goes stale in a way
     * that looks to the pilot like a random sign-out.
     *
     * Errors come back as real Errors carrying the server's own message, its
     * machine-readable `code` and the status — because the difference between
     * "your database needs updating" (409, a thing the VA can fix, with a
     * button) and "we broke" (500) is the whole of a good error message here.
     */
    function api({ backend, slug, token }) {
        const base = String(backend || '').replace(/\/+$/, '');
        const va = String(slug || '').toLowerCase();
        const getToken = typeof token === 'function' ? token : () => String(token || '');
        return async function call(path, { method = 'GET', body = null } = {}) {
            const headers = { Accept: 'application/json' };
            const t = getToken();
            if (t) headers.Authorization = 'Bearer ' + t;
            if (body) headers['Content-Type'] = 'application/json';
            const res = await fetch(`${base}/api/crew/${encodeURIComponent(va)}${path}`, {
                method, headers, body: body ? JSON.stringify(body) : undefined,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const err = new Error(data.error || 'That didn’t work.');
                err.code = data.code || '';
                err.status = res.status;
                throw err;
            }
            return data;
        };
    }

    /**
     * The one error that is not an error: a project on an older schema.
     *
     * Every feature added after a VA set up their database hits this, and the
     * right response is never "something went wrong" — it is to name the
     * missing thing and point at the button that fixes it. Panels render this
     * instead of their content.
     */
    const isSchemaGap = (err) => !!err && err.status === 409 && /_missing$|_unsupported$/.test(err.code || '');

    function schemaGapHtml(err) {
        return `<div class="cp-empty">
            <i data-lucide="database"></i>
            ${esc(err && err.message ? err.message : 'Your crew center’s database needs updating.')}
            <div style="margin-top:.9rem">
                <button class="cp-btn cp-btn-primary" data-cp-fix-store>Update my database</button>
            </div>
        </div>`;
    }

    /* ---------------------------------------------------------------------
     * THE SAFETY NET
     *
     * Reported as "the window doesn't load, the whole page just goes white".
     *
     * That symptom is not a panel that rendered nothing — an empty panel still
     * leaves the dashboard behind it. It is the SCROLL LOCK left on. lockScroll
     * takes the body out of flow (`position:fixed; top:-<scrollY>px`), which
     * collapses the document to nothing; if whatever was going to render then
     * throws, the lock is never released and what is left on screen is the page
     * background. White. No content, no error, nothing to click.
     *
     * Every path through this file releases the lock properly, so this is not a
     * fix for a known leak — it is the floor under all of them, including the
     * ones in modules that call lockScroll directly and the ones a future panel
     * will introduce. An uncaught error is exactly the moment nobody's `finally`
     * ran, so it is exactly the moment to check.
     *
     * Deliberately narrow: it only unlocks when NOTHING is actually open. A
     * panel that threw while rendering its body is still a panel the reader is
     * looking at, and yanking the page back out from under it would be a second
     * bug wearing the first one's clothes.
     * ------------------------------------------------------------------- */

    /** Is any panel, sheet or dialog currently on screen? */
    function anythingOpen() {
        return !!document.querySelector('.cp-panel:not(.cp-hidden), .cev-panel:not(.cev-hidden), .cev-modal:not(.cev-hidden)');
    }

    /**
     * Give the page back if it was locked for a panel that is not there.
     *
     * Returns true when it actually recovered something, so the caller can say
     * so rather than leaving the reader wondering what just happened.
     */
    function recoverScroll() {
        if (lockCount === 0 && document.body.style.position !== 'fixed') return false;
        if (anythingOpen()) return false;
        // Force it, whatever the counter thinks. The counter is the thing that
        // got out of step; the body is the thing the reader is stuck behind.
        lockCount = 1;
        unlockScroll();
        return true;
    }

    function onUncaught(what, err) {
        // The console always gets the real error — this never swallows one.
        console.error('crew center:', what, err);
        // Only speak up when there was something to give back. Plenty of pages
        // throw something harmless on load (a CDN that did not arrive, an
        // extension), and a toast on every visit saying "something went wrong"
        // would be noise that teaches people to ignore it — including the one
        // time it is telling them why the screen went blank.
        if (!recoverScroll()) return;
        toast('Something went wrong opening that. The page has been given back — please try again.', 'bad');
    }

    window.addEventListener('error', (ev) => onUncaught('error', ev.error || ev.message));
    window.addEventListener('unhandledrejection', (ev) => onUncaught('unhandled rejection', ev.reason));

    // A last resort the reader can reach without the console: if the page is
    // somehow still locked with nothing open, Escape gives it back.
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') recoverScroll();
    });

    window.CrewPanels = {
        esc, safeUrl, icons,
        whenText, timeText, dayKey, dayLabel, relativeText, durationText,
        style, baseStyles, toast, sheet, api,
        lockScroll, unlockScroll, recoverScroll,
        isSchemaGap, schemaGapHtml,
    };
})();
