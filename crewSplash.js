/**
 * crewSplash.js — the moment between signing in and being in.
 *
 * WHY
 *
 * Signing in handed a pilot a white page, then a page with some of the airline
 * on it, then a page with the rest. Nothing said the sign-in had worked; the
 * only evidence was that the login form was gone. Meanwhile the crew centre's
 * first paint is genuinely waiting on several fetches — the VA record, /me, the
 * figures — so there is real time to fill and it was being filled with a flicker
 * of half-drawn interface.
 *
 * So the arrival gets a confirmation, in the shape everybody already knows from
 * paying with a phone: a ring turning while the work happens, a tick drawn when
 * it is done, and then the airline's own mark under it before the cover lifts.
 * The reader is told three things in order — we are working, it worked, and
 * whose crew centre this is — and none of them by a sentence.
 *
 * THE RULES IT FOLLOWS
 *
 * · IT NEVER TRAPS ANYBODY. The cover lifts when the page says it is ready,
 *   and it lifts anyway at CEILING_MS whether or not anything said so. A splash
 *   that waits on a fetch is a splash that is still there when the fetch never
 *   answers.
 * · IT IS ONLY EVER A COVER. Nothing behind it is blocked from loading and
 *   nothing about the page depends on it: delete this file and the crew centre
 *   is exactly as it was, a little more abrupt.
 * · IT GOES UP BEFORE THE PAGE DOES, WHICH IS WHY `arm` BELONGS IN <head>.
 *   It paints into <html> when there is no <body> yet rather than waiting for
 *   one, because DOMContentLoaded fires when the WHOLE document has been
 *   parsed — a cover armed there is a cover that goes up over a crew centre
 *   the reader has already seen. Armed from the head, the cover is the first
 *   thing the browser draws and the page draws once, underneath it.
 * · IT ONLY SHOWS AFTER A SIGN-IN. `arm` looks for a one-shot flag that the
 *   login page sets and reads once — a refresh, a bookmark, or coming back from
 *   a panel is not an arrival and gets nothing.
 * · REDUCED MOTION IS HONOURED PROPERLY. Not "the same thing, faster": no
 *   sweep and no drawing at all, a tick that is simply there, and a shorter
 *   hold. The information survives; the movement does not.
 *
 * HOW A PAGE USES IT
 *
 *     CrewSplash.arm({ slug });                    // in <head>, once
 *     CrewSplash.done({ name, logo });             // when the page is ready
 *     CrewSplash.whenClear(() => offerTour());     // anything that must not
 *                                                  // open underneath it
 */

(function (global) {
    'use strict';

    var FLAG = 'crew:welcome:';
    // Nothing is shown for less than this: a boot that finishes in 80ms would
    // otherwise be a white flash, which reads as a fault rather than as speed.
    var MIN_MS = 620;
    // And nothing is shown for longer than this, said or not. See the rules.
    var CEILING_MS = 6000;

    var reduced = false;
    try {
        reduced = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { reduced = false; }

    var state = null;        // { cover, ring, mark, openedAt, ceiling } while up
    var waiting = [];        // whenClear callbacks
    var finished = false;

    var CSS = ''
        + '.csplash{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;'
        + 'background:var(--bg,#F6F3ED);transition:opacity .38s ease,visibility .38s;}'
        + '.csplash.is-gone{opacity:0;visibility:hidden;}'
        + '.csplash__in{display:grid;justify-items:center;gap:1.1rem;padding:2rem;}'
        + '.csplash__dial{position:relative;width:76px;height:76px;}'
        + '.csplash__svg{width:100%;height:100%;transform:rotate(-90deg);overflow:visible;}'
        /* The track and the arc are the same circle twice: the second is dashed
           so a fraction of it shows, and it is the dash that turns. */
        + '.csplash__track{fill:none;stroke:var(--line,#E7E2D8);stroke-width:5;}'
        + '.csplash__arc{fill:none;stroke:var(--accent-on,var(--accent,#1C1A16));stroke-width:5;stroke-linecap:round;'
        + 'stroke-dasharray:56 170;stroke-dashoffset:0;transform-origin:50% 50%;animation:csplash-spin 1.05s linear infinite;}'
        + '@keyframes csplash-spin{to{transform:rotate(360deg);}}'
        /* Done: the arc stops turning and closes into a whole ring. */
        + '.csplash.is-done .csplash__arc{animation:none;stroke-dasharray:226 226;'
        + 'transition:stroke-dasharray .42s cubic-bezier(.2,.8,.2,1);}'
        + '.csplash__tick{position:absolute;inset:0;display:grid;place-items:center;}'
        + '.csplash__tick svg{width:38px;height:38px;overflow:visible;}'
        + '.csplash__tick path{fill:none;stroke:var(--accent-on,var(--accent,#1C1A16));stroke-width:5.5;'
        + 'stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:36;stroke-dashoffset:36;}'
        + '.csplash.is-done .csplash__tick path{transition:stroke-dashoffset .34s cubic-bezier(.5,0,.2,1) .18s;stroke-dashoffset:0;}'
        /* The airline, arriving under its own tick. */
        + '.csplash__mark{display:grid;justify-items:center;gap:.5rem;opacity:0;transform:translateY(6px);'
        + 'transition:opacity .34s ease .34s,transform .34s cubic-bezier(.2,.8,.2,1) .34s;}'
        + '.csplash.is-done .csplash__mark{opacity:1;transform:none;}'
        + '.csplash__logo{height:34px;width:auto;max-width:190px;object-fit:contain;display:block;'
        + 'border-radius:6px;}'
        + '.csplash__mono{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;'
        + 'background:var(--accent-fill,var(--accent,#1C1A16));color:var(--accent-ink,#fff);font-weight:800;font-size:1rem;}'
        + '.csplash__name{font-size:.95rem;font-weight:600;color:var(--ink,#1C1A16);letter-spacing:-.01em;text-align:center;}'
        /* NO MOVEMENT, SAME INFORMATION. The ring does not turn, the tick is
           not drawn, the mark does not rise. Each is simply in its final state,
           and the cover still fades because a cut is its own kind of jolt. */
        + '@media (prefers-reduced-motion: reduce){'
        + '.csplash__arc{animation:none;stroke-dasharray:226 226;}'
        + '.csplash__tick path{stroke-dashoffset:0;}'
        + '.csplash__mark{opacity:1;transform:none;transition:none;}'
        + '.csplash.is-done .csplash__arc{transition:none;}'
        + '}'
        /* ---- THE PAGE UNDERNEATH, WHILE THE COVER IS UP ------------------
           The cover is opaque and covers the viewport, so this is not about
           what can be SEEN. It is about what is drawn and then covered: an
           arriving page paints its own header, hero and skeletons behind the
           cover, and on a phone that paint is the expensive one. Held back
           until the cover lifts, the first thing the browser draws is the
           cover, and the page draws once — into a viewport nobody is
           looking at yet.

           `visibility` rather than `display`: the layout still happens, so
           scripts that measure an element while the cover is up get the
           answer they would have got, and nothing reflows on the lift. */
        + 'html.csplash-up{overflow:hidden;}'
        + 'html.csplash-up body>*:not(.csplash){visibility:hidden;}';

    function styles() {
        if (document.getElementById('csplash-style')) return;
        var el = document.createElement('style');
        el.id = 'csplash-style';
        el.textContent = CSS;
        (document.head || document.documentElement).appendChild(el);
    }

    function initials(name) {
        return String(name || '').trim().split(/\s+/).slice(0, 2)
            .map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '✈';
    }

    /** An image address we are willing to put in a src. */
    function image(url) {
        var s = String(url || '').trim();
        if (!s) return '';
        try { return new URL(s).protocol === 'https:' ? s : ''; } catch (e) { return ''; }
    }

    function paint() {
        styles();
        var cover = document.createElement('div');
        cover.className = 'csplash';
        // Announced as busy rather than as a dialog: nothing here can be acted
        // on, and a screen reader should say the page is working, not offer a
        // control that does not exist.
        cover.setAttribute('role', 'status');
        cover.setAttribute('aria-live', 'polite');
        cover.setAttribute('aria-label', 'Signing you in');
        cover.innerHTML = ''
            + '<div class="csplash__in">'
            + '<div class="csplash__dial">'
            + '<svg class="csplash__svg" viewBox="0 0 80 80" aria-hidden="true">'
            + '<circle class="csplash__track" cx="40" cy="40" r="36"></circle>'
            + '<circle class="csplash__arc" cx="40" cy="40" r="36"></circle>'
            + '</svg>'
            + '<span class="csplash__tick" aria-hidden="true">'
            + '<svg viewBox="0 0 40 40"><path d="M10 21.5 17 28.5 30.5 13"></path></svg>'
            + '</span>'
            + '</div>'
            + '<div class="csplash__mark"></div>'
            + '</div>';
        /* INTO <html> WHEN THERE IS NO <body> YET, AND THAT IS THE WHOLE FIX.
         *
         * This is called from a <head> script, so `document.body` is null: the
         * parser has not reached it. The old code waited for DOMContentLoaded
         * to get one — which fires only once the ENTIRE document has been
         * parsed, by which time the crew centre has already painted. That is
         * the flicker: the page, and then the cover over it, in that order.
         *
         * An element appended to <html> renders exactly as one in <body> does,
         * and it is in the tree before the parser has read a single row of the
         * page, so the cover is the first thing drawn. It is moved into <body>
         * once there is one, so the document ends up the shape every other
         * script expects to find it in. */
        (document.body || document.documentElement).appendChild(cover);
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', function () {
                if (document.body && cover.parentNode !== document.body) document.body.appendChild(cover);
            });
        }
        try { document.documentElement.classList.add('csplash-up'); } catch (e) { /* not ours */ }
        return cover;
    }

    function clear() {
        if (!state) return;
        var cover = state.cover;
        state = null;
        finished = true;
        // The page underneath is allowed to draw again BEFORE the fade rather
        // than after it: it paints under an opaque cover that is on its way
        // out, so the reveal is the fade and not a second paint behind it.
        try { document.documentElement.classList.remove('csplash-up'); } catch (e) { /* not ours */ }
        cover.classList.add('is-gone');
        var gone = function () {
            if (cover.parentNode) cover.parentNode.removeChild(cover);
            var queue = waiting.slice();
            waiting.length = 0;
            queue.forEach(function (fn) { try { fn(); } catch (e) { /* not ours */ } });
        };
        // Removed after the fade, or straight away where there is none.
        if (reduced) setTimeout(gone, 220); else setTimeout(gone, 420);
    }

    /**
     * Show the cover, if this is an arrival.
     *
     * The flag is read AND cleared here, so a reload of the same page is not a
     * second arrival — and so a boot that never reaches `done` still cannot
     * make the next visit show it again.
     */
    function arm(opts) {
        opts = opts || {};
        if (state) return true;
        var key = FLAG + (opts.slug || '-');
        var armed = false;
        try {
            armed = global.sessionStorage && global.sessionStorage.getItem(key) === '1';
            if (armed) global.sessionStorage.removeItem(key);
        } catch (e) { armed = false; }
        if (!armed && !opts.force) { finished = true; return false; }

        // Painted NOW, synchronously, whether or not there is a <body> yet.
        // See paint(): waiting for one is what put the cover on top of a page
        // the reader had already seen.
        if (!state) {
            state = {
                cover: paint(),
                openedAt: Date.now(),
                ceiling: setTimeout(function () { done(state && state.said); }, CEILING_MS),
            };
        }
        return true;
    }

    /**
     * The page is ready: complete the ring, draw the tick, show the airline,
     * and lift.
     *
     * Safe to call more than once and safe to call before `arm` has painted —
     * a boot that finishes before the cover exists simply never shows one.
     */
    function done(brand) {
        if (!state) { finished = true; runWaiting(); return; }
        if (state.said) return;
        state.said = brand || {};
        clearTimeout(state.ceiling);

        var mark = state.cover.querySelector('.csplash__mark');
        var logo = image(brand && brand.logo);
        var name = String((brand && brand.name) || '').trim();
        if (logo) {
            var img = document.createElement('img');
            img.className = 'csplash__logo';
            img.alt = name;
            img.decoding = 'async';
            // A logo that 404s falls back to the monogram rather than leaving a
            // broken-image glyph as the last thing shown before the page.
            img.addEventListener('error', function () { img.replaceWith(monogram(name)); });
            img.src = logo;
            mark.appendChild(img);
        } else if (name) {
            mark.appendChild(monogram(name));
        }
        if (name && !logo) {
            var label = document.createElement('span');
            label.className = 'csplash__name';
            label.textContent = name;
            mark.appendChild(label);
        }

        // Held open for the rest of MIN_MS where the boot beat it, so a fast
        // sign-in is a confirmation rather than a blink.
        var waited = Date.now() - state.openedAt;
        var floor = Math.max(0, MIN_MS - waited);
        setTimeout(function () {
            if (!state) return;
            state.cover.classList.add('is-done');
            // Long enough for the ring to close, the tick to draw and the mark
            // to settle — the three transitions above, end to end.
            setTimeout(clear, reduced ? 520 : 1180);
        }, floor);
    }

    function monogram(name) {
        var el = document.createElement('span');
        el.className = 'csplash__mono';
        el.textContent = initials(name);
        return el;
    }

    function runWaiting() {
        var queue = waiting.slice();
        waiting.length = 0;
        queue.forEach(function (fn) { try { fn(); } catch (e) { /* not ours */ } });
    }

    /** Run something once nothing is covering the page. */
    function whenClear(fn) {
        if (typeof fn !== 'function') return;
        if (!state && finished) { fn(); return; }
        if (!state) { fn(); return; }
        waiting.push(fn);
    }

    /** The sign-in page, saying the next page is an arrival. */
    function mark(slug) {
        try { if (global.sessionStorage) global.sessionStorage.setItem(FLAG + (slug || '-'), '1'); }
        catch (e) { /* private window: no splash, no harm */ }
    }

    global.CrewSplash = {
        arm: arm, done: done, whenClear: whenClear, mark: mark,
        // Closes it with no ceremony. For a boot that failed: the reader needs
        // the page and whatever it says, not a tick.
        dismiss: clear,
        version: 1,
    };
})(window);
