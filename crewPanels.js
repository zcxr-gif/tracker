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

   AND THE FOUR THINGS AN UPDATE NEEDS (see "Updating data" below)

     CrewPanels.keepPlace(el, render)   re-draw a list without moving the reader
     CrewPanels.busy(btn, label)        a button that says it is working
     CrewPanels.ask({...})              a confirm the page draws itself
     CrewPanels.emit(topic) / .on(...)  one change, every view that shows it

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
        /* EVERY WIDTH IN HERE IS A BORDER-BOX WIDTH.
           These panels are laid out with width:100% on padded boxes — a
           .cp-input inside a .cp-card, the confirm sheet across a phone — and
           every one of those is 100% PLUS its padding under the default content
           box, so it overflows its own container by two paddings and sits off
           centre. It looked right only because Tailwind's preflight happened to
           set border-box globally on the pages this shipped on, and Tailwind is
           a CDN script: blocked, slow or simply down, and this stylesheet was
           relying on it for its box model. Same reasoning as the .hidden rule
           in crew-dashboard.html — a panel's own structure must not depend on a
           third-party script arriving.
           Scoped to our own classes rather than a global *, because this file
           is dropped into pages it does not own. */
        [class^="cp-"],[class*=" cp-"],[class^="cp-"]::before,[class*=" cp-"]::before,
        [class^="cp-"]::after,[class*=" cp-"]::after{ box-sizing:border-box; }
        .cp-hidden{ display:none !important; }
        /* Present to a screen reader, absent from the page. Not display:none,
           which removes it from the accessibility tree along with everything
           else — see announce(). */
        .cp-sr-only{ position:absolute; width:1px; height:1px; padding:0; margin:-1px;
            overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%); white-space:nowrap; border:0; }
        #cp-toasts{ position:fixed; bottom:1rem; left:50%; transform:translateX(-50%);
            z-index:120; display:flex; flex-direction:column; gap:.5rem; pointer-events:none; }
        .cp-toast{ background:var(--ink,#1C1A16); color:var(--bg,#fff); padding:.6rem 1rem;
            border-radius:.6rem; font-size:.85rem; font-weight:500; box-shadow:0 8px 24px rgba(0,0,0,.18);
            max-width:min(90vw,26rem); transition:opacity .3s, transform .3s; }
        .cp-toast-ok{ background:#16A34A; color:#fff; }
        .cp-toast-bad{ background:#DC2626; color:#fff; }
        .cp-toast.cp-out{ opacity:0; transform:translateY(6px); }

        .cp-panel{ position:fixed; inset:0; z-index:70; }
        /* touch-action:none so dragging the dimmed area does nothing at all.
           It used to scroll the page BEHIND the open panel, which left you
           looking at a sheet floating over content that had moved on without
           it — and, framed, handed the gesture on to the host page. */
        .cp-scrim{ position:absolute; inset:0; background:rgba(0,0,0,.45); touch-action:none; }
        .cp-sheet{ position:absolute; right:0; top:0; height:100%; width:100%;
            max-width:46rem; background:var(--surface,#fff); border-left:1px solid var(--line,#e5e5e5);
            overflow-y:auto; overscroll-behavior:contain; display:flex; flex-direction:column; }
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
        .cp-input::placeholder,.cp-textarea::placeholder{ color:var(--faint,#A8A296); }
        /* Where the keyboard is. Same rule the dashboard sets for its own
           controls, restated here for the same reason as box-sizing above: these
           panels are dropped into pages that may not set one, and a confirm
           dialog whose focused button looks no different from the other is a
           dialog a keyboard user has to guess at. Ours, not the browser's
           default, so it matches the VA's accent in both themes. */
        .cp-btn:focus-visible,.cp-icon-btn:focus-visible,
        .cp-input:focus-visible,.cp-select:focus-visible,.cp-textarea:focus-visible{
            outline:2px solid var(--accent,#1C1A16); outline-offset:2px; }
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

        /* A button that is working. Inline-size so it sits on the text baseline
           of whatever label replaced the original, and currentColor so it is
           right on a primary button and a plain one without a second rule. */
        .cp-spin{ display:inline-block; width:.85em; height:.85em; margin-right:.15em;
            border:2px solid currentColor; border-right-color:transparent; border-radius:50%;
            animation:cp-spin .6s linear infinite; vertical-align:-.1em; }
        @keyframes cp-spin{ to{ transform:rotate(360deg); } }
        [aria-busy="true"]{ cursor:progress; }
        @media (prefers-reduced-motion:reduce){
            .cp-spin{ animation-duration:1.6s; }
        }

        /* The page's own confirm. See ask(). */
        .cp-ask{ position:fixed; inset:0; z-index:130; display:grid; place-items:center;
            padding:1rem; }
        .cp-ask-scrim{ position:absolute; inset:0; background:rgba(0,0,0,.5); }
        .cp-ask-box{ position:relative; width:min(26rem,100%); background:var(--surface,#fff);
            color:var(--ink,#1C1A16); border:1px solid var(--line,#e5e5e5); border-radius:.9rem;
            box-shadow:0 24px 60px rgba(0,0,0,.28); padding:1.1rem 1.15rem 1rem;
            display:grid; gap:.55rem; }
        .cp-ask-title{ font-size:1rem; font-weight:700; letter-spacing:-.01em; margin:0; }
        .cp-ask-body{ font-size:.87rem; color:var(--muted,#736E64); margin:0; white-space:pre-line; }
        .cp-ask-row{ display:flex; justify-content:flex-end; gap:.5rem; margin-top:.35rem; }
        .cp-btn-danger{ background:#DC2626; color:#fff; border-color:transparent; }
        .cp-btn-danger:hover{ background:#B91C1C; border-color:transparent; }
        @media (max-width:40rem){
            .cp-ask{ place-items:end center; padding:0; }
            .cp-ask-box{ width:100%; border-radius:1.1rem 1.1rem 0 0; border-left:0; border-right:0;
                padding-bottom:calc(1rem + env(safe-area-inset-bottom,0px)); }
            .cp-ask-row{ flex-direction:column-reverse; }
            .cp-ask-row .cp-btn{ width:100%; justify-content:center; }
        }

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
    let lockedHeight = '';

    function lockScroll() {
        if (lockCount++ > 0) return;
        lockedScrollY = window.scrollY || 0;
        const b = document.body;
        // PIN THE HEIGHT BEFORE GOING OUT OF FLOW.
        //
        // `position:fixed` does not only move the body, it changes what a
        // percentage height on it resolves against: in flow that is <html>,
        // which has no height, so `height:100%` means `auto` and the body
        // keeps its content height. Fixed, it is the initial containing block,
        // which is exactly one screen tall — so the same rule that was a no-op
        // a moment ago collapses the document to a single viewport and, with
        // `top:-<scrollY>` already applied, parks it above the screen.
        //
        // The framed crew center had such a rule (crewBridge's embed shell),
        // and the result was every panel opening onto a blank frame: the sheet
        // itself is fixed and drew fine, but the entire page behind it had
        // gone. That rule is gone too, but this is the half that holds for a
        // VA's own stylesheet, a future host shell, or anything else that ever
        // sets a percentage height on the body. The lock's job is to stop the
        // page scrolling, never to resize it.
        lockedHeight = b.style.height;
        b.style.height = b.getBoundingClientRect().height + 'px';
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
        b.style.height = lockedHeight;
        lockedHeight = '';
        // position:fixed dropped the page to the top; put it back where the
        // reader was, or opening a panel becomes a way to lose your place.
        window.scrollTo(0, lockedScrollY);
    }

    /* ---------------------------------------------------------------------
     * Toast
     * ------------------------------------------------------------------- */

    /**
     * Say one thing, briefly.
     *
     * Two rules about the stack, both learned from bulk work — reviewing a
     * morning's flight reports is six presses in five seconds, and six toasts
     * is not feedback, it is a wall across the bottom of the screen:
     *
     *   · THE SAME MESSAGE AGAIN counts up in place rather than queueing. Six
     *     approvals read "Flight approved… ×6" on one line, which is both
     *     shorter and more useful than six copies — it is the running total of
     *     what you have just done. Its life is extended on each repeat, so the
     *     count is still there when the last press lands.
     *   · AT MOST THREE at once. Past three, the oldest goes. A fourth distinct
     *     message means the first is already history.
     */
    const TOAST_MAX = 3;

    /**
     * Say it to a screen reader too.
     *
     * The toast is now where the crew center reports what a press did — saved,
     * removed, approved, refused. A message only a sighted reader receives is
     * not feedback, it is decoration, and routing MORE of the dashboard's
     * feedback through here would have quietly made this worse rather than
     * better.
     *
     * A separate visually-hidden region rather than making the toast host live,
     * for two reasons: the visual stack is capped and coalesced ("…×6"), and
     * that bookkeeping has nothing to do with what should be spoken; and a
     * failure wants `assertive` while a confirmation wants `polite`, which is a
     * property of the REGION, so it takes two of them.
     *
     * Blanked before it is written, because a live region whose text does not
     * change is not announced — the second identical confirmation would be
     * silent — and the two writes have to land in separate frames or the
     * browser coalesces them back into no change at all.
     */
    function announce(text, tone) {
        const assertive = tone === 'bad';
        const id = assertive ? 'cp-live-alert' : 'cp-live-status';
        let live = document.getElementById(id);
        if (!live) {
            live = document.createElement('div');
            live.id = id;
            live.className = 'cp-sr-only';
            live.setAttribute('role', assertive ? 'alert' : 'status');
            live.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
            live.setAttribute('aria-atomic', 'true');
            document.body.appendChild(live);
        }
        live.textContent = '';
        setTimeout(() => { live.textContent = text; }, 60);
    }

    function toast(msg, tone) {
        baseStyles();
        let host = document.getElementById('cp-toasts');
        if (!host) {
            host = document.createElement('div');
            host.id = 'cp-toasts';
            document.body.appendChild(host);
        }
        const text = String(msg == null ? '' : msg);
        const kind = 'cp-toast-' + (tone || 'info');

        const same = Array.from(host.children).find(
            (t) => t.dataset.cpMsg === text && t.classList.contains(kind) && !t.classList.contains('cp-out'),
        );
        if (same) {
            const n = (Number(same.dataset.cpN) || 1) + 1;
            same.dataset.cpN = String(n);
            same.textContent = `${text} ×${n}`;
            clearTimeout(Number(same.dataset.cpT));
            same.dataset.cpT = String(setTimeout(() => retire(same), 4200));
            announce(same.textContent, tone);
            return;
        }

        const el = document.createElement('div');
        el.className = 'cp-toast ' + kind;
        el.textContent = text;
        el.dataset.cpMsg = text;
        host.appendChild(el);
        el.dataset.cpT = String(setTimeout(() => retire(el), 4200));
        while (host.children.length > TOAST_MAX) retire(host.firstElementChild, true);
        announce(text, tone);
    }

    function retire(el, now) {
        if (!el || el.classList.contains('cp-out')) return;
        clearTimeout(Number(el.dataset.cpT));
        el.classList.add('cp-out');
        setTimeout(() => el.remove(), now ? 0 : 300);
    }

    /**
     * Bring something into view, honouring the reader's motion preference.
     *
     * `behavior:'smooth'` is the right default — an unannounced jump is how a
     * reader loses track of where they are — but it is exactly the kind of
     * movement `prefers-reduced-motion` is about, and scrollIntoView does not
     * consult the preference on its own the way a CSS transition does.
     */
    function reveal(el, block) {
        if (!el || typeof el.scrollIntoView !== 'function') return;
        const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ block: block || 'nearest', behavior: still ? 'auto' : 'smooth' });
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

    /* =====================================================================
     * UPDATING DATA
     *
     * Reported as two complaints that are really one: "the page jumps to the
     * top when I press a button", and "I have to refresh to see what I just
     * changed".
     *
     * Both come from the same shape of code. A crew center screen draws a list
     * by assigning innerHTML, and an action that changes the data re-runs that
     * draw. That is the right instinct — it is how the dashboard stays honest
     * about what the server now holds — but done plainly it has two costs the
     * reader pays:
     *
     *   · The draw destroys the node the caret was in, and when the new content
     *     is shorter than the reader's scroll offset it destroys that too. The
     *     caret goes every time, measurably: after an innerHTML replacement
     *     document.activeElement is <body>. The offset survives an equal-height
     *     redraw, and snaps to 0 the moment the list is shorter than where the
     *     reader was — filtering a list down, switching to a short tab, clearing
     *     the last rows. Nobody asked the page to scroll; it looks like the
     *     button did it.
     *   · It redraws ONE view. The figure at the top of the dashboard, the
     *     badge on the tab, the rank badge on a roster card — all read the same
     *     data from a different place, and none of them hear about the change.
     *     So the screen is half old and half new, and the only way to make it
     *     agree with itself is F5.
     *
     * (The larger half of "the page scrolls when I press things" is not here at
     * all — it is a drawer over an unlocked page, where the gesture that misses
     * the drawer scrolls the dashboard behind it. That is lockScroll's job, and
     * the crew center dashboard's own four drawers now take it.)
     *
     * The four functions below are what the crew center needs to stop paying
     * both costs above. They are deliberately small: this is not a rendering
     * framework, it is the plumbing that makes hand-written renders behave.
     * =================================================================== */

    /**
     * The nearest ancestor that actually scrolls.
     *
     * Not `closest('.cp-body')` — the dashboard's own drawers are plain
     * `overflow-y-auto` divs with no class in common, the panels here are
     * `.cp-sheet`, and a list on the dashboard itself scrolls the document. One
     * answer for all three, found by asking the layout rather than the markup.
     */
    function scrollerFor(el) {
        for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
            const oy = getComputedStyle(n).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
        }
        return document.scrollingElement || document.documentElement;
    }

    /**
     * Where a node sits, as child indices from a root.
     *
     * Used to put the caret back after a redraw. An id would be better and is
     * not available: these rows are built from array indices, so the field the
     * reader was typing in has no stable identity — but it does have a stable
     * POSITION, which is exactly what survives a redraw of the same array.
     */
    function indexPath(root, node) {
        const path = [];
        for (let n = node; n && n !== root && n.parentElement; n = n.parentElement) {
            path.push(Array.prototype.indexOf.call(n.parentElement.children, n));
        }
        return path.reverse();
    }

    function nodeAtPath(root, path) {
        let n = root;
        for (const i of path) {
            if (!n || !n.children || !n.children[i]) return null;
            n = n.children[i];
        }
        return n;
    }

    /**
     * Re-draw something without moving the reader.
     *
     *   CrewPanels.keepPlace('#pirepList', () => { list.innerHTML = …; });
     *
     * Captures the scroll offset of whatever is actually scrolling, plus the
     * focused field and its caret, runs the render, then puts all three back.
     *
     * The FOCUS is the part that is always needed: an innerHTML replacement
     * drops the caret on every browser, every time, so a row that redraws while
     * somebody is typing in it takes their place in the sentence with it. The
     * SCROLL is the part that is sometimes needed — a same-height redraw keeps
     * its offset on its own, and the case this saves is the one where the new
     * content is shorter than where the reader was and the offset snaps to 0.
     *
     * The offset is put back twice, a frame apart, because lucide replaces every
     * <i> with an <svg> of a different height after we return, and a list whose
     * rows each grow by 2px lands the reader slightly off where they were. The
     * second pass is skipped if the reader has scrolled in the meantime — by
     * then the offset is theirs, not ours to restore.
     *
     * `viewKey` is for a panel that renders genuinely DIFFERENT screens from one
     * function — a library, and the document you open out of it. Keeping the
     * place is right for a redraw of the same screen and wrong for a change of
     * screen: opening a document 400px down because that is where the list was
     * is not "not losing your place", it is starting half way through it.
     *
     * So a change of key moves to where THAT screen was last left — its top the
     * first time, and otherwise the offset it had when you went away. Which
     * makes going back from a document to the library land on the document you
     * were just reading rather than at the top of a list you now have to scroll
     * through again. Omit the key for anything that only ever draws one thing.
     */
    function keepPlace(el, render, viewKey) {
        const host = (el && el.nodeType) ? el : document.querySelector(String(el || ''));
        if (!host) { if (typeof render === 'function') render(); return; }
        const box = scrollerFor(host);

        if (viewKey != null) {
            const key = String(viewKey);
            const was = host.dataset.cpView;
            if (was !== key) {
                // Remember where the screen being left off was, on the element
                // rather than in a module variable: two panels can be open at
                // once, and a panel is torn down and rebuilt with its host.
                const seen = host._cpViewTops || (host._cpViewTops = Object.create(null));
                if (was != null) seen[was] = box.scrollTop;
                host.dataset.cpView = key;
                render();
                box.scrollTop = seen[key] || 0;
                return;
            }
        }

        const top = box.scrollTop;
        const left = box.scrollLeft;

        const active = document.activeElement;
        let field = null;
        if (active && active !== document.body && host.contains(active)
            && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
            field = { path: indexPath(host, active) };
            try { field.start = active.selectionStart; field.end = active.selectionEnd; } catch { /* number/colour inputs throw */ }
        }

        render();

        box.scrollTop = top;
        box.scrollLeft = left;
        if (field) {
            const back = nodeAtPath(host, field.path);
            if (back && typeof back.focus === 'function') {
                // preventScroll, or the browser helpfully scrolls the field into
                // view and undoes the line above — the jump this exists to stop.
                try { back.focus({ preventScroll: true }); } catch { back.focus(); }
                if (field.start != null) {
                    try { back.setSelectionRange(field.start, field.end); } catch { /* not a text field */ }
                }
            }
        }
        requestAnimationFrame(() => {
            if (Math.abs(box.scrollTop - top) > 2 && Math.abs(box.scrollTop - top) < 400) box.scrollTop = top;
        });
    }

    /**
     * A button that says it is working.
     *
     *   const done = CrewPanels.busy(btn, 'Saving…');  …  done();
     *
     * Returns the undo. Swaps the label, disables the button and marks it
     * aria-busy, so a slow round trip is visibly a slow round trip rather than
     * a press that did nothing — which is what gets pressed again, and what
     * turns one save into two.
     *
     * Re-entrant calls are ignored rather than stacked: the second call would
     * capture "Saving…" as the label to restore and leave it there for good.
     */
    function busy(btn, label) {
        const el = (btn && btn.nodeType) ? btn : document.getElementById(String(btn || ''));
        if (!el) return () => {};
        if (el.dataset.cpBusy) return () => {};
        const wasHtml = el.innerHTML;
        const wasDisabled = !!el.disabled;
        el.dataset.cpBusy = '1';
        el.disabled = true;
        el.setAttribute('aria-busy', 'true');
        if (label !== false) el.innerHTML = `<span class="cp-spin"></span>${esc(label || 'Working…')}`;
        return function done() {
            if (!el.dataset.cpBusy) return;
            delete el.dataset.cpBusy;
            el.disabled = wasDisabled;
            el.removeAttribute('aria-busy');
            if (label !== false) { el.innerHTML = wasHtml; try { icons(); } catch { /* ignore */ } }
        };
    }

    /**
     * Ask before doing something that cannot be undone — in the page.
     *
     *   if (!await CrewPanels.ask({ title:'Delete 412 flights?', … })) return;
     *
     * Replaces window.confirm, which is wrong here for three reasons beyond
     * looking like 1998: it cannot say which airline or how many rows in the
     * VA's own voice, it is BLOCKED outright in a cross-origin iframe on some
     * browsers — and this dashboard runs framed inside a VA's own website and
     * inside the app's Crew Center overlay — and when it is blocked it returns
     * false, so the button silently does nothing at all.
     *
     * `type` asks the reader to type a word back before the button works — for
     * the handful of actions that wipe a whole dataset. It replaces
     * window.prompt, which is blocked in the same places and for the same
     * reason, and which returned null indistinguishably from "cancelled".
     *
     * Carries `.cp-dialog` so an open sheet underneath knows the Escape key is
     * not its own (see TOP_LAYER).
     */
    function ask({ title, body = '', confirm: okLabel = 'Continue', cancel: cancelLabel = 'Cancel', danger = false, type = '' } = {}) {
        baseStyles();
        // ONE QUESTION AT A TIME, and a second asked while one is up is answered
        // no rather than stacked.
        //
        // A bin icon on a card takes an impatient double-press, and three
        // dialogs over each other — two of them unreachable behind the top one,
        // each holding a scroll lock — is the worst possible answer to "did that
        // register?". The callers also disable the button before asking, so this
        // should not be reached; it is here because the safe answer to a
        // question nobody can see must be the one that changes nothing, and
        // relying on every future caller to remember that is how it gets lost.
        // Nothing in the crew center asks a question from inside a question.
        if (document.querySelector('.cp-ask')) return Promise.resolve(false);
        return new Promise((resolve) => {
            const host = document.createElement('div');
            host.className = 'cp-ask cp-dialog';
            host.setAttribute('role', 'dialog');
            host.setAttribute('aria-modal', 'true');
            // Named and described, or a screen reader announces "dialog" and
            // then two buttons with no idea what is being asked. Fixed ids are
            // safe because only one of these is ever open — see the guard above.
            host.setAttribute('aria-labelledby', 'cp-ask-title');
            if (body) host.setAttribute('aria-describedby', 'cp-ask-body');
            host.innerHTML = `
                <div class="cp-ask-scrim" data-ask-no></div>
                <div class="cp-ask-box">
                    <h3 class="cp-ask-title" id="cp-ask-title">${esc(title || 'Are you sure?')}</h3>
                    ${body ? `<p class="cp-ask-body" id="cp-ask-body">${esc(body)}</p>` : ''}
                    ${type ? `<label class="cp-label" for="cp-ask-type">Type <b>${esc(type)}</b> to confirm</label>
                        <input id="cp-ask-type" class="cp-input" data-ask-type autocomplete="off"
                            spellcheck="false" placeholder="${esc(type)}">` : ''}
                    <div class="cp-ask-row">
                        <button class="cp-btn" data-ask-no>${esc(cancelLabel)}</button>
                        <button class="cp-btn ${danger ? 'cp-btn-danger' : 'cp-btn-primary'}" data-ask-yes ${type ? 'disabled' : ''}>${esc(okLabel)}</button>
                    </div>
                </div>`;
            document.body.appendChild(host);
            lockScroll();
            const yes = host.querySelector('[data-ask-yes]');
            const typed = host.querySelector('[data-ask-type]');
            // Scoped to the button row: the SCRIM carries data-ask-no too (so
            // that clicking away cancels), it comes first in the DOM, and it is a
            // div — focusing it silently did nothing, which left the keyboard in
            // the form BEHIND an open modal.
            const no = host.querySelector('.cp-ask-row [data-ask-no]');
            if (typed) {
                typed.addEventListener('input', () => { yes.disabled = typed.value.trim() !== type; });
            }
            // Focus the field if there is one, else the safe choice — never the
            // destructive button: a stray Enter left over from the form behind
            // must not delete anything.
            (typed || (danger ? no : yes)).focus({ preventScroll: true });

            let settled = false;
            const finish = (answer) => {
                if (settled) return;
                settled = true;
                document.removeEventListener('keydown', onKey, true);
                host.remove();
                unlockScroll();
                resolve(answer);
            };
            function onKey(ev) {
                if (ev.key === 'Escape') { ev.stopPropagation(); finish(false); }
                else if (ev.key === 'Enter' && (ev.target === yes || (typed && ev.target === typed && !yes.disabled))) {
                    ev.stopPropagation(); ev.preventDefault(); finish(true);
                } else if (ev.key === 'Tab') {
                    // Keep Tab inside the dialog. window.confirm did this for
                    // free by being the browser's own window; a modal drawn in
                    // the page does not, and tabbing out of a question into the
                    // form it is asking about is how you end up answering a
                    // dialog you can no longer see.
                    const stops = Array.from(host.querySelectorAll('button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'))
                        .filter((n) => n.offsetParent !== null);
                    if (!stops.length) return;
                    const first = stops[0], last = stops[stops.length - 1];
                    const on = document.activeElement;
                    if (ev.shiftKey && (on === first || !host.contains(on))) { ev.preventDefault(); last.focus(); }
                    else if (!ev.shiftKey && (on === last || !host.contains(on))) { ev.preventDefault(); first.focus(); }
                }
            }
            // Capture, so Escape here is swallowed before the sheet underneath
            // sees it — closing the dialog must not close the panel behind it.
            document.addEventListener('keydown', onKey, true);
            host.addEventListener('click', (ev) => {
                if (ev.target.closest('[data-ask-yes]')) finish(true);
                else if (ev.target.closest('[data-ask-no]')) finish(false);
            });
        });
    }

    /* ---------------------------------------------------------------------
     * One change, every view that shows it
     *
     * The crew center draws the same facts in several places on purpose: the
     * roster count is a headline figure, a drawer tab badge and the length of a
     * list, and a rank is a row in the settings editor, a badge on a pilot card
     * and a threshold on a route. Before this, whichever place you changed the
     * data from was the only one that knew.
     *
     * So: say WHAT CHANGED, not who should redraw. `emit('roster')` after a
     * pilot is added, and the figures, the badge and the list each decided for
     * themselves, at load time, that they care. The alternative — having
     * submitPilot() call the four renders by name — is the version that rots,
     * because the fifth view that shows a pilot count is added by somebody who
     * has never read submitPilot.
     *
     * Topics are plain strings and deliberately coarse ('roster', 'pireps',
     * 'routes', 'applications', 'structure', 'settings'). A subscriber that
     * needs to be cheap debounces itself; most of them are a DOM write.
     * ------------------------------------------------------------------- */

    const subs = new Map();

    /** Subscribe. Returns the unsubscribe, for anything that can be unmounted. */
    function on(topic, fn) {
        if (typeof fn !== 'function') return () => {};
        String(topic || '').split(/\s+/).filter(Boolean).forEach((t) => {
            if (!subs.has(t)) subs.set(t, new Set());
            subs.get(t).add(fn);
        });
        return () => String(topic || '').split(/\s+/).forEach((t) => { const s = subs.get(t); if (s) s.delete(fn); });
    }

    /**
     * Announce a change. Every subscriber runs; one that throws does not stop
     * the others, because a broken badge must not be able to leave the list it
     * was drawn beside showing yesterday's data.
     */
    function emit(topic, detail) {
        String(topic || '').split(/\s+/).filter(Boolean).forEach((t) => {
            const s = subs.get(t);
            if (!s) return;
            for (const fn of Array.from(s)) {
                try { fn(detail, t); } catch (err) { console.error('crew center: listener for', t, 'failed', err); }
            }
        });
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
     * Narrow, but measured by what is on SCREEN rather than what is open: it
     * unlocks when nothing is showing the reader anything. A panel that got
     * some content out is still a panel they are looking at, and yanking the
     * page from under it would be a second bug wearing the first one's clothes
     * — but an empty shell is not that, it is the debris of a render that
     * failed, and treating it as a real panel is what let the black screen
     * survive this net. See anythingOpen().
     * ------------------------------------------------------------------- */

    /**
     * Is any panel, sheet or dialog currently showing the reader something?
     *
     * "Open" is not the same question as "on screen", and the difference is the
     * black screen this net kept failing to catch. A panel whose body render
     * threw before it wrote anything is still `open` by class — so the check
     * above said "something is open, leave the page alone" and refused to
     * unlock, while what the reader actually had was an empty sheet over a
     * collapsed document. Framed in the app's Crew Center overlay that reads as
     * a black screen with nothing to click, and Escape was the only way out.
     *
     * An empty body is nothing to look at, so it does not count as open. A
     * panel that got *some* content out still does, which keeps the original
     * intent: never yank the page from under a reader who has something.
     */
    function anythingOpen() {
        // A host page's own drawer. The crew center dashboard marks its four
        // with data-topic and holds the page with lockScroll like everything
        // here does, so they have to count: without them, one unrelated uncaught
        // error while the roster is open would hand scrolling back to the page
        // UNDERNEATH an open drawer — the bug this net exists to prevent,
        // arrived at from the other direction.
        if (document.querySelector('[data-topic][data-open="1"]')) return true;
        const open = document.querySelectorAll(
            '.cp-panel:not(.cp-hidden), .cev-panel:not(.cev-hidden), .cev-modal:not(.cev-hidden), .cp-ask',
        );
        for (const el of open) {
            const body = el.querySelector('.cp-body, .cev-body');
            // No body element at all: not ours to judge, treat as real.
            if (!body) return true;
            if (body.textContent.trim() || body.querySelector('img, svg, canvas, iframe, input')) return true;
        }
        return false;
    }

    /**
     * Close any panel that is open but has nothing in it. Called only from the
     * uncaught handler: by then the render that should have filled it has
     * already failed, so the shell is debris rather than a panel mid-flight.
     */
    function closeEmptyPanels() {
        const open = document.querySelectorAll('.cp-panel:not(.cp-hidden), .cev-panel:not(.cev-hidden)');
        for (const el of open) {
            const body = el.querySelector('.cp-body, .cev-body');
            if (body && !body.textContent.trim()) {
                el.classList.add(el.classList.contains('cev-panel') ? 'cev-hidden' : 'cp-hidden');
            }
        }
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
        // Nothing on screen is worth keeping, so take the empty shells down
        // too — leaving one up would put a transparent sheet over a page the
        // reader can now scroll but not click through to.
        closeEmptyPanels();
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
        keepPlace, busy, ask, on, emit, reveal,
    };
})();
