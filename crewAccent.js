/**
 * crewAccent.js — keeps a VA's accent readable, whatever colour they chose.
 *
 * THE BUG THIS EXISTS FOR
 *
 * Every crew centre page styles its highlights with two classes:
 *
 *     .accent-bg    { background: var(--accent); }   …usually with text-white
 *     .accent-text  { color: var(--accent); }
 *
 * Both assume the accent is a MID-TO-DARK colour, and nothing ever checked.
 * An airline whose brand is cream, sky blue, pale gold or plain white — which
 * is a great many airlines — got white text on a nearly white button: a row of
 * highlights you cannot read a word of. The mirror image was just as bad in the
 * dark interface, where the stock accent is nearly black: every accent-coloured
 * link and icon was black text on a black page, which reads as missing rather
 * than as unreadable.
 *
 * WHAT IT DOES
 *
 * Publishes two properties next to --accent, and the stylesheets read them:
 *
 *   --accent-ink   the ink that sits ON the accent. Black or white, whichever
 *                  the accent's own brightness says is legible. This is what
 *                  makes a pale brand colour usable as a button.
 *   --accent-on    the accent as TEXT on the page. The same hue, moved far
 *                  enough in lightness to clear a contrast floor against the
 *                  page's background — darkened on paper, lifted in the dark.
 *                  The airline's colour, still recognisably theirs, and
 *                  readable.
 *   --accent-fill  the accent as a BLOCK on the page, and almost always the
 *                  accent itself, untouched. It moves only when the accent is
 *                  so close to the page's own background that the button stops
 *                  being a shape at all — a near-black accent in the dark
 *                  interface, a near-white one on paper. A button nobody can
 *                  see the edges of is the same complaint as one nobody can
 *                  read the label of.
 *
 * THE RULES IT FOLLOWS
 *
 * · The accent itself is never changed. --accent is what the VA chose and what
 *   a big block of colour uses; these two are derived from it and nothing else
 *   reads them. A VA that picks their exact brand hex still gets their exact
 *   brand hex on every filled button.
 * · Contrast is the real thing — WCAG relative luminance, not a guess at how
 *   dark a hex "looks". 4.5:1 for ink on a filled control, 3.5:1 for accent
 *   text, which is the readable floor for the weights these pages set it in.
 * · It re-runs whenever anything that could change the answer changes: the VA
 *   picks a colour, a theme lands from the backend, or the page flips between
 *   light and dark. All three go through the same watcher, so there is no path
 *   that sets an accent and forgets to re-derive its ink.
 *
 * Loaded as a classic script in <head>, like crewBrand.js and crewSkin.js: it
 * has to have written both properties before the body paints, or the first
 * frame is the unreadable one.
 */

(function (global) {
    'use strict';

    // The floors. 4.5 is the WCAG AA figure for body text, which is what ink on
    // a button is. 3.5 is below AA for small text and deliberately so: accent
    // text on these pages is a semibold label or an icon, never a paragraph,
    // and holding it to 4.5 pushes every pale brand colour to nearly black —
    // at which point the airline's colour is gone and we have solved the
    // problem by deleting the feature.
    var INK_MIN = 4.5;
    /* 3.6 rather than 3.5, and the extra tenth is not decoration.
     *
     * The ground below is the PAGE (--bg). Most accent text does sit on it,
     * but some of it sits on a panel a shade off it — the sign-in page's split
     * look puts its eyebrow on a stone-50 panel, a couple of percent darker
     * than the page behind it. An accent walked to exactly 3.5 against the
     * page lands at 3.40 there, and a pale brand colour set as small caps at
     * 3.40:1 is the one place this whole file is supposed to be looking. The
     * tenth is the headroom for that difference; it costs a pale accent about
     * one step of lightness and nothing anybody can see. */
    var TEXT_MIN = 3.6;
    // A block of colour does not have to be READ, only SEEN, so the bar is far
    // lower — this is the line between "a quiet button" and "no button". Only
    // an accent within a whisker of the page's own background is moved at all.
    var FILL_MIN = 1.6;

    var HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

    function rgb(hex) {
        var h = String(hex || '').trim();
        if (!HEX.test(h)) return null;
        h = h.slice(1);
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }

    function hex(c) {
        return '#' + c.map(function (v) {
            var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
            return s.length === 1 ? '0' + s : s;
        }).join('');
    }

    /** WCAG relative luminance. */
    function luminance(c) {
        var a = c.map(function (v) {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }

    function contrast(a, b) {
        var la = luminance(a), lb = luminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }

    // ---- HSL, for moving a colour's lightness without losing its hue --------
    function toHsl(c) {
        var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var l = (max + min) / 2, h = 0, s = 0;
        if (max !== min) {
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
        }
        return [h, s, l];
    }

    function toRgb(hsl) {
        var h = hsl[0], s = hsl[1], l = hsl[2];
        if (!s) { var v = l * 255; return [v, v, v]; }
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        var f = function (t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
    }

    /**
     * The accent, moved just far enough to be readable ON `ground`.
     *
     * Lightness is walked in small steps AWAY from the ground — down on a pale
     * page, up on a dark one — and stops the moment the floor is cleared. The
     * step is small and the stop is early on purpose: the point is a readable
     * version of the airline's colour, not the nearest colour that passes.
     *
     * A colour with no saturation at all (a grey accent, and the stock one is
     * nearly that) is given a little rather than left to walk to black or
     * white, which is the one case where moving lightness alone produces
     * something that reads as a rendering fault rather than as a colour.
     */
    function readable(accent, ground, floor) {
        if (contrast(accent, ground) >= floor) return accent;
        var dark = luminance(ground) < 0.4;      // a dark page: lift the accent
        var hsl = toHsl(accent);
        var best = accent;
        for (var i = 0; i < 40; i++) {
            hsl[2] = Math.max(0, Math.min(1, hsl[2] + (dark ? 0.025 : -0.025)));
            if (hsl[1] > 0 && hsl[1] < 0.18) hsl[1] = Math.min(0.3, hsl[1] + 0.01);
            best = toRgb(hsl);
            if (contrast(best, ground) >= floor) break;
            if (hsl[2] <= 0 || hsl[2] >= 1) break;
        }
        return best;
    }

    /** The ink for text sitting on a block of `colour`. */
    function inkOn(colour) {
        var white = [255, 255, 255];
        // Not pure black: these pages' own ink is #1C1A16, and a button that
        // uses true black next to text that does not reads as a different
        // element rather than as the same page.
        var black = [28, 26, 22];
        var onWhite = contrast(colour, white), onBlack = contrast(colour, black);
        if (onWhite >= INK_MIN) return white;
        if (onBlack >= INK_MIN) return black;
        return onWhite >= onBlack ? white : black;     // neither clears: the better of the two
    }

    var writing = false;
    var last = '';

    function read(prop, fallback) {
        var v = '';
        try { v = getComputedStyle(document.documentElement).getPropertyValue(prop).trim(); } catch (e) { v = ''; }
        return v || fallback;
    }

    /**
     * Derive both properties from whatever the page currently says.
     *
     * Everything is read back off the computed style rather than passed in, so
     * one code path serves the colour picker, a theme arriving from the
     * backend, a skin switch and a light/dark flip. Nothing has to remember to
     * tell this file what it did.
     */
    function paint() {
        if (writing) return;
        var accent = rgb(read('--accent', '#1C1A16'));
        // The ground accent TEXT will sit on. --bg is the page; a card's
        // --surface is within a few percent of it on every skin, so the page is
        // the honest thing to measure against.
        var ground = rgb(read('--bg', '#FFFFFF')) || [255, 255, 255];
        if (!accent) return;

        // The fill first: the ink has to be legible on the colour that is
        // ACTUALLY painted, which on the rare lifted fill is not the accent.
        var fill = readable(accent, ground, FILL_MIN);
        var ink = hex(inkOn(fill));
        var on = hex(readable(accent, ground, TEXT_MIN));
        var stamp = ink + on + hex(fill);
        if (stamp === last) return;
        last = stamp;

        writing = true;
        try {
            document.documentElement.style.setProperty('--accent-ink', ink);
            document.documentElement.style.setProperty('--accent-on', on);
            document.documentElement.style.setProperty('--accent-fill', hex(fill));
        } finally {
            // Released on the next frame: our own write lands in the style
            // attribute this file is watching, and re-entering on it would be
            // an endless loop of deriving the same two colours.
            if (global.requestAnimationFrame) requestAnimationFrame(function () { writing = false; });
            else setTimeout(function () { writing = false; }, 0);
        }
    }

    /* WHAT CHANGES THE ANSWER, and therefore what is watched.
     *
     *   the <html> style attribute   the colour picker writes --accent there
     *   the <html> class/attributes  .dark, data-skin — a different ground
     *   a <style> added to <head>    crewBrand.js publishes a VA's theme that way
     *   the system colour scheme     a reader flipping their device at night
     *
     * One watcher for the lot, debounced to a frame, so a theme that arrives
     * and flips the mode in the same tick derives its colours once. */
    function watch() {
        var pending = false;
        var soon = function () {
            if (pending) return;
            pending = true;
            var run = function () { pending = false; paint(); };
            if (global.requestAnimationFrame) requestAnimationFrame(run); else setTimeout(run, 16);
        };
        if (global.MutationObserver) {
            new MutationObserver(soon).observe(document.documentElement, {
                attributes: true, attributeFilter: ['style', 'class', 'data-skin', 'data-theme'],
            });
            if (document.head) {
                new MutationObserver(soon).observe(document.head, { childList: true });
            }
        }
        if (global.matchMedia) {
            var mq = global.matchMedia('(prefers-color-scheme: dark)');
            if (mq.addEventListener) mq.addEventListener('change', soon);
            else if (mq.addListener) mq.addListener(soon);
        }
        // The explicit door, for a caller that would rather say so than be
        // noticed: CrewAccent.refresh() after setting --accent by hand.
        document.addEventListener('crew:accent', soon);
    }

    paint();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { paint(); watch(); });
    } else {
        watch();
    }

    global.CrewAccent = {
        refresh: paint,
        // Exported for anything that wants to ask the same question about a
        // colour it has not applied yet — the colour picker's own preview, for
        // one, which should show the button as it will actually look.
        inkOn: function (h) { var c = rgb(h); return c ? hex(inkOn(c)) : ''; },
        fillOn: function (h, ground) {
            var c = rgb(h), g = rgb(ground);
            return c && g ? hex(readable(c, g, FILL_MIN)) : '';
        },
        readableOn: function (h, ground, floor) {
            var c = rgb(h), g = rgb(ground);
            return c && g ? hex(readable(c, g, Number(floor) || TEXT_MIN)) : '';
        },
        contrast: function (a, b) {
            var x = rgb(a), y = rgb(b);
            return x && y ? contrast(x, y) : 0;
        },
        version: 1,
    };
})(window);
