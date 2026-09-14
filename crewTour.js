/**
 * crewTour.js — the walk through the crew centre a first-time reader gets.
 *
 * WHY
 *
 * The crew centre is the densest screen on the platform: a roster, a network,
 * a schedule, a noticeboard, a shop, a document library, a website builder and
 * a settings drawer with eleven tabs in it. An owner signing in for the first
 * time is shown all of it at once and told nothing, and the commonest question
 * in support is not "how do I do X" — it is "what is this page".
 *
 * A pilot has the opposite problem and the same cause: they land on a page
 * that is mostly about them and nothing says which parts they can act on.
 *
 * So: a short, skippable walk, different for each of them, over the real
 * interface rather than over a picture of it.
 *
 * WHAT IT IS NOT
 *
 * · Not a wizard. Nothing here changes anything. Every step is a sentence
 *   about something already on the page, and the reader can leave at any step
 *   and be exactly where they were.
 * · Not compulsory. It runs once per person per crew centre, Escape ends it,
 *   and "Skip" is the same size as "Next" rather than hidden in the corner.
 * · Not a dependency. No library, no CDN, and its own styles — the crew pages
 *   already load enough, and a tour that fails to draw because a CDN was slow
 *   would be a black overlay over a page nobody can click.
 *
 * HOW A PAGE USES IT
 *
 *     CrewTour.offer({
 *         id: 'staff', version: 1, slug: 'ocean-virtual',
 *         steps: [
 *             { title: 'Welcome', body: 'This is your crew centre.' },   // centred
 *             { el: '#toolGrid', title: 'Everything you run', body: '…' },
 *         ],
 *     });
 *
 * `offer` runs it only if this browser has not seen this version of this tour
 * for this crew centre. `CrewTour.replay('staff')` always runs it, which is
 * what a "Show me around" menu item calls.
 *
 * A STEP WHOSE TARGET IS NOT THERE IS DROPPED, silently and by design. What is
 * on a crew centre's page depends on the VA's permissions, what they have set
 * up and what they have switched off — a tour that stops on a missing element,
 * or worse spotlights an empty rectangle, is a tour that breaks for exactly the
 * airlines who most need it. Steps are resolved at the moment the tour starts,
 * against the page as it actually is.
 */

(function (global) {
    'use strict';

    var KEY = 'crew:tour:';
    var registry = {};          // id → the options it was offered with
    var open = null;            // the running tour, or null

    var reduced = false;
    try {
        reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { reduced = false; }

    function store(key) {
        try { return global.localStorage ? global.localStorage.getItem(key) : null; } catch (e) { return null; }
    }
    function remember(key, value) {
        try { if (global.localStorage) global.localStorage.setItem(key, value); } catch (e) { /* private window */ }
    }

    var seenKey = function (id, slug) { return KEY + id + ':' + (slug || '-'); };

    /* ---- The styles ------------------------------------------------------
     *
     * Written once, from the crew pages' own custom properties, so the tour
     * wears whatever the airline and the reader have chosen — the accent, the
     * paper, the corner radius, light or dark — without knowing which. The
     * fallbacks are the stock palette, for anything that loads this file
     * outside a crew page.
     * ------------------------------------------------------------------- */
    var CSS = ''
        + '.ctour-mask{position:fixed;inset:0;z-index:2147483000;pointer-events:auto;}'
        + '.ctour-hole{position:fixed;border-radius:12px;box-shadow:0 0 0 9999px rgba(8,10,14,.62);'
        + 'transition:all .28s cubic-bezier(.2,.8,.2,1);pointer-events:none;}'
        + '.ctour-hole.is-still{transition:none;}'
        + '.ctour-ring{position:fixed;border-radius:14px;border:2px solid var(--accent-on,var(--accent,#1C1A16));'
        + 'transition:all .28s cubic-bezier(.2,.8,.2,1);pointer-events:none;}'
        + '.ctour-ring.is-still{transition:none;}'
        + '.ctour-card{position:fixed;z-index:2147483001;width:min(22rem,calc(100vw - 2rem));'
        + 'background:var(--surface,#fff);color:var(--ink,#1C1A16);border:1px solid var(--line,#E7E2D8);'
        + 'border-radius:var(--radius,14px);box-shadow:0 18px 50px rgba(8,10,14,.28);padding:1rem 1.1rem 1.05rem;}'
        + '.ctour-card:focus{outline:none;}'
        + '.ctour-step{font-size:.7rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;'
        + 'color:var(--accent-on,var(--accent,#1C1A16));}'
        + '.ctour-title{margin:.35rem 0 .3rem;font-size:1.05rem;font-weight:800;letter-spacing:-.01em;}'
        + '.ctour-body{margin:0;font-size:.88rem;line-height:1.5;color:var(--muted,#736E64);}'
        + '.ctour-foot{display:flex;align-items:center;gap:.5rem;margin-top:.9rem;}'
        + '.ctour-dots{display:flex;gap:.25rem;margin-right:auto;}'
        + '.ctour-dot{width:.4rem;height:.4rem;border-radius:50%;background:var(--line,#E7E2D8);}'
        + '.ctour-dot.is-at{background:var(--accent-on,var(--accent,#1C1A16));}'
        + '.ctour-btn{font:inherit;font-size:.83rem;font-weight:600;cursor:pointer;border-radius:8px;'
        + 'padding:.45rem .8rem;border:1px solid var(--line,#E7E2D8);background:transparent;color:var(--muted,#736E64);}'
        + '.ctour-btn:hover{color:var(--ink,#1C1A16);border-color:var(--ink,#1C1A16);}'
        + '.ctour-btn--go{background:var(--accent-fill,var(--accent,#1C1A16));border-color:transparent;'
        + 'color:var(--accent-ink,#fff);}'
        + '.ctour-btn--go:hover{opacity:.9;color:var(--accent-ink,#fff);}'
        + '.ctour-btn:focus-visible{outline:2px solid var(--accent-on,var(--accent,#1C1A16));outline-offset:2px;}'
        + '@media (prefers-reduced-motion: reduce){.ctour-hole,.ctour-ring{transition:none;}}';

    function styles() {
        if (document.getElementById('ctour-style')) return;
        var el = document.createElement('style');
        el.id = 'ctour-style';
        el.textContent = CSS;
        document.head.appendChild(el);
    }

    function visible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var r = el.getBoundingClientRect();
        if (!r.width && !r.height) return false;
        var s = global.getComputedStyle ? getComputedStyle(el) : null;
        if (s && (s.display === 'none' || s.visibility === 'hidden')) return false;
        return !el.closest('[hidden]');
    }

    /** The steps that can actually be shown, resolved against the page now. */
    function resolve(steps) {
        var out = [];
        (steps || []).forEach(function (step) {
            if (!step || !step.title) return;
            if (typeof step.when === 'function' && !step.when()) return;
            if (!step.el) { out.push({ step: step, target: null }); return; }
            var target = typeof step.el === 'string' ? document.querySelector(step.el) : step.el;
            if (!visible(target)) return;             // see the header: dropped, not stumbled over
            out.push({ step: step, target: target });
        });
        return out;
    }

    function run(opts) {
        var steps = resolve(opts.steps);
        if (!steps.length) return false;
        if (open) open.end(true);
        styles();

        var at = 0;
        var returnTo = document.activeElement;

        var mask = document.createElement('div');
        mask.className = 'ctour-mask';
        var hole = document.createElement('div');
        hole.className = 'ctour-hole is-still';
        var ring = document.createElement('div');
        ring.className = 'ctour-ring is-still';
        var card = document.createElement('div');
        card.className = 'ctour-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-live', 'polite');
        card.tabIndex = -1;

        mask.appendChild(hole);
        mask.appendChild(ring);
        document.body.appendChild(mask);
        document.body.appendChild(card);

        /* WHERE THE CARD GOES.
         *
         * Under the thing it is describing, or over it when there is no room
         * under — and centred on the screen for a step with no target at all.
         * Clamped to the viewport last, so a target at the very edge moves the
         * card inwards rather than off. */
        function place(target) {
            var vw = document.documentElement.clientWidth;
            var vh = document.documentElement.clientHeight;
            var cw = card.offsetWidth, ch = card.offsetHeight;

            if (!target) {
                hole.style.opacity = '0';
                ring.style.opacity = '0';
                card.style.left = Math.round((vw - cw) / 2) + 'px';
                card.style.top = Math.round((vh - ch) / 2) + 'px';
                return;
            }
            hole.style.opacity = '1';
            ring.style.opacity = '1';

            var r = target.getBoundingClientRect();
            var pad = 8;
            var box = {
                left: Math.max(4, r.left - pad), top: Math.max(4, r.top - pad),
                width: Math.min(vw - 8, r.width + pad * 2), height: Math.min(vh - 8, r.height + pad * 2),
            };
            hole.style.left = box.left + 'px'; hole.style.top = box.top + 'px';
            hole.style.width = box.width + 'px'; hole.style.height = box.height + 'px';
            ring.style.left = (box.left - 2) + 'px'; ring.style.top = (box.top - 2) + 'px';
            ring.style.width = (box.width + 4) + 'px'; ring.style.height = (box.height + 4) + 'px';

            var below = box.top + box.height + 12;
            var top = (below + ch <= vh - 8) ? below : (box.top - ch - 12);
            if (top < 8) top = Math.min(vh - ch - 8, Math.max(8, box.top + box.height + 12));
            var left = box.left + box.width / 2 - cw / 2;
            left = Math.max(8, Math.min(vw - cw - 8, left));
            card.style.left = Math.round(left) + 'px';
            card.style.top = Math.round(Math.max(8, top)) + 'px';
        }

        function draw() {
            var here = steps[at];
            var last = at === steps.length - 1;
            card.innerHTML = ''
                + '<div class="ctour-step">Step ' + (at + 1) + ' of ' + steps.length + '</div>'
                + '<h2 class="ctour-title"></h2>'
                + '<p class="ctour-body"></p>'
                + '<div class="ctour-foot">'
                + '<div class="ctour-dots"></div>'
                + (at > 0 ? '<button type="button" class="ctour-btn" data-back>Back</button>' : '')
                + '<button type="button" class="ctour-btn" data-skip>' + (last ? 'Close' : 'Skip') + '</button>'
                + (last ? '' : '<button type="button" class="ctour-btn ctour-btn--go" data-next>Next</button>')
                + '</div>';
            // Written as text rather than into the HTML above: a step's words
            // can name an airline, and an airline's name is somebody's input.
            card.querySelector('.ctour-title').textContent = here.step.title;
            card.querySelector('.ctour-body').textContent = here.step.body || '';

            var dots = card.querySelector('.ctour-dots');
            for (var i = 0; i < steps.length; i++) {
                var d = document.createElement('span');
                d.className = 'ctour-dot' + (i === at ? ' is-at' : '');
                dots.appendChild(d);
            }

            var back = card.querySelector('[data-back]');
            if (back) back.addEventListener('click', function () { go(at - 1); });
            var next = card.querySelector('[data-next]');
            if (next) next.addEventListener('click', function () { go(at + 1); });
            card.querySelector('[data-skip]').addEventListener('click', function () { end(); });

            if (here.target && here.target.scrollIntoView) {
                try {
                    here.target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
                } catch (e) { here.target.scrollIntoView(); }
            }
            // Measured after the scroll has been asked for, and again on the
            // next frame: a smooth scroll has not moved yet when this returns.
            place(here.target);
            if (global.requestAnimationFrame) {
                requestAnimationFrame(function () { place(here.target); });
                setTimeout(function () { if (open) place(here.target); }, reduced ? 0 : 320);
            }
            card.focus();
        }

        function go(to) {
            if (to < 0 || to >= steps.length) { end(); return; }
            at = to;
            hole.classList.remove('is-still');
            ring.classList.remove('is-still');
            draw();
        }

        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); end(); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
            else if (e.key === 'ArrowLeft' && at > 0) { e.preventDefault(); go(at - 1); }
        }
        function onMove() { if (open) place(steps[at].target); }

        function end(quiet) {
            if (!open) return;
            open = null;
            document.removeEventListener('keydown', onKey, true);
            global.removeEventListener('resize', onMove);
            global.removeEventListener('scroll', onMove, true);
            if (mask.parentNode) mask.parentNode.removeChild(mask);
            if (card.parentNode) card.parentNode.removeChild(card);
            // Seen is seen, however it ended — finishing and leaving halfway
            // are both "this reader has been offered the tour". Only a tour
            // replaced by another (quiet) leaves the mark alone.
            if (!quiet && opts.id) remember(seenKey(opts.id, opts.slug), String(opts.version || 1));
            if (returnTo && returnTo.focus) { try { returnTo.focus(); } catch (e) { /* gone */ } }
            if (typeof opts.onEnd === 'function') opts.onEnd();
        }

        // Clicking the darkened page around the spotlight ends it. The reader
        // reached past the tour for something; that is an answer.
        mask.addEventListener('click', function () { end(); });

        document.addEventListener('keydown', onKey, true);
        global.addEventListener('resize', onMove);
        global.addEventListener('scroll', onMove, true);

        open = { end: end };
        draw();
        return true;
    }

    /**
     * Register a tour, and run it if this browser has not been shown it.
     *
     * Registering happens either way, so "Show me around" works for a reader
     * who has already seen it — which is the only reason that menu item is
     * worth having.
     */
    function offer(opts) {
        if (!opts || !opts.id) return false;
        registry[opts.id] = opts;
        var seen = store(seenKey(opts.id, opts.slug));
        if (seen && Number(seen) >= Number(opts.version || 1)) return false;
        // One beat after whatever called us, so a tour offered from a boot
        // sequence does not spotlight an element the next line is about to
        // repaint.
        setTimeout(function () { run(opts); }, opts.delay == null ? 600 : opts.delay);
        return true;
    }

    function replay(id) {
        var opts = registry[id];
        if (!opts) return false;
        return run(opts);
    }

    /** Has this browser been shown a tour? For a menu item that says so. */
    function seen(id, slug) {
        var opts = registry[id] || {};
        var mark = store(seenKey(id, slug || opts.slug));
        return !!mark && Number(mark) >= Number(opts.version || 1);
    }

    global.CrewTour = {
        offer: offer,
        replay: replay,
        seen: seen,
        stop: function () { if (open) open.end(); },
        version: 1,
    };
})(window);
