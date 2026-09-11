/**
 * crewSkin.js — which of the crew center's two interfaces a VA is looking at.
 *
 * WHAT THIS IS
 *
 * The crew center shipped with one look. It is a good look — warm, papery,
 * quiet — and it was also the ONLY look, which meant every airline on the
 * platform handed its pilots the same page with a different logo in the
 * corner. An airline's crew center is the second thing it shows a recruit
 * after its website, and "generic" is a thing a recruit notices.
 *
 * So there are two, and this file is the switch:
 *
 *   essential   the original, unchanged. `data-skin="essential"` matches
 *               nothing in crewSkin.css; not one rule applies.
 *   aurora      the second interface — dark-first, glass over an ambient
 *               canvas, depth instead of hairlines, motion with a spring in
 *               it. See crewSkin.css, which does all of the drawing.
 *
 * WHO DECIDES — three answers, in this order:
 *
 *   1. ?ui=aurora        a preview link. Never persisted: a link an owner
 *                        pastes into Discord to show staff the new look must
 *                        not silently rewrite the choice of everyone who
 *                        clicks it.
 *   2. this device        what the reader last picked from the top bar, per VA
 *                        (`crew:ui:<slug>`). A pilot who prefers one look keeps
 *                        it even if their VA prefers the other.
 *   3. the crew record    `ui` on the VA, set by an owner in Settings →
 *                        Appearance. What everyone sees on their first visit.
 *
 * ...and `essential` when nobody has said anything, so an untouched VA is
 * byte-for-byte the crew center it had yesterday.
 *
 * THE FIRST-PAINT PROBLEM
 *
 * The crew record arrives from a fetch, which is hundreds of milliseconds after
 * the page has already painted. A VA whose crew default is aurora would get the
 * essential shell and then a flash as it swapped — on every visit. So the
 * resolved default is cached per VA (`crew:ui:default:<slug>`) and read back
 * synchronously at head time. The first visit flips; every visit after that
 * paints correctly from the first frame. The flip itself goes through the View
 * Transitions API where the browser has it, so even that reads as a dissolve
 * rather than a jolt.
 *
 * Loaded as a classic script in <head>, like crewBrand.js — it has to have set
 * the attribute and asked for the stylesheet BEFORE the body paints.
 */

(function (global) {
    'use strict';

    const SKINS = ['essential', 'aurora'];

    const META = {
        essential: {
            name: 'Essential',
            desc: 'Warm paper, hairlines, nothing in the way of the work.',
        },
        aurora: {
            name: 'Aurora',
            desc: 'A lit flight deck — glass, depth and a little motion.',
        },
    };

    /* The two glyphs for the top-bar switch, drawn here rather than asked of
     * lucide. Every other control in that bar is a lucide <i>, and when that
     * CDN is slow or blocked those buttons are briefly empty — survivable for
     * a button whose neighbours explain it, and not for the only control on
     * the page that offers something a reader has never seen. So this one
     * draws itself: no request, no dependency, never a 36px hole in the bar. */
    const GLYPH = {
        // Offering aurora: sparkles.
        aurora: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<path d="M12 3.2 13.6 8 18.4 9.6 13.6 11.2 12 16 10.4 11.2 5.6 9.6 10.4 8Z"/>'
            + '<path d="M18.5 15.5 19.2 17.3 21 18l-1.8.7-.7 1.8-.7-1.8L16 18l1.8-.7Z"/></svg>',
        // Offering essential: a calm, ruled page.
        essential: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>'
            + '<path d="M7.5 9.5h9M7.5 13h9M7.5 16h5"/></svg>',
    };

    const doc = global.document;
    const root = doc.documentElement;
    const STYLE_ID = 'crew-skin-css';
    const listeners = [];
    let current = 'essential';

    const valid = (s) => SKINS.indexOf(String(s || '').toLowerCase()) !== -1
        ? String(s).toLowerCase() : '';

    /** The VA we are looking at: /crew/<slug>/… or ?va=<slug>. Same rule the
     *  pages themselves use — the key has to agree with theirs. */
    function slug() {
        const m = global.location.pathname.match(/\/crew\/([^/?#]+)/i);
        if (m && m[1]) return decodeURIComponent(m[1]).trim().toLowerCase();
        const q = new URLSearchParams(global.location.search).get('va');
        return q ? q.trim().toLowerCase() : '';
    }

    const KEY = () => 'crew:ui:' + slug();
    const KEY_DEFAULT = () => 'crew:ui:default:' + slug();

    function read(key) { try { return localStorage.getItem(key) || ''; } catch (_) { return ''; } }
    function write(key, v) { try { localStorage.setItem(key, v); } catch (_) {} }

    const stillness = () => global.matchMedia
        && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------------------------------------------------------------------
     * The stylesheet. Asked for once, in <head>, so the browser blocks the
     * first paint on it rather than painting essential and then repainting.
     *
     * It is requested even for a reader on `essential`: the chooser in
     * Settings is styled by it, the reader is one click from needing it, and
     * it is a single small file behind the same cache as the page.
     * ------------------------------------------------------------------- */
    function ensureStyle() {
        if (doc.getElementById(STYLE_ID)) return;
        const link = doc.createElement('link');
        link.id = STYLE_ID;
        link.rel = 'stylesheet';
        link.href = '/crewSkin.css';
        (doc.head || root).appendChild(link);
    }

    /* ---------------------------------------------------------------------
     * Applying one.
     * ------------------------------------------------------------------- */
    function paint(skin) {
        current = skin;
        root.setAttribute('data-skin', skin);
        ensureStyle();
    }

    /**
     * Swap interfaces. `persist:false` for a preview or for a crew default
     * being applied — only a choice the reader actually made is written down.
     */
    function set(skin, opts) {
        const next = valid(skin);
        if (!next || next === current) return current;
        const o = opts || {};
        const apply = () => {
            paint(next);
            if (o.persist !== false) write(KEY(), next);
            // The switch in the bar offers the OTHER interface, so it is wrong
            // the instant this changes. Redrawn here rather than at each call
            // site: with a view transition in play `set` returns before this
            // has run, and a caller that redrew straight afterwards would be
            // redrawing the old answer.
            renderToggles();
            listeners.forEach((fn) => { try { fn(next); } catch (_) {} });
        };
        // A whole-page crossfade where the browser has one, and nothing at all
        // for a reader who has asked for less movement.
        if (!stillness() && typeof doc.startViewTransition === 'function' && o.animate !== false) {
            try { doc.startViewTransition(apply); } catch (_) { apply(); }
        } else {
            apply();
        }
        return next;
    }

    /** Flip to the other one. What the top-bar button does. */
    function toggle() {
        const next = current === 'aurora' ? 'essential' : 'aurora';
        set(next);
        // Said plainly, because the button is on a pilot's page too and most
        // of the people pressing it have no Settings to be pointed at: this
        // changed their browser and nobody else's.
        if (global.CrewPanels && global.CrewPanels.toast) {
            global.CrewPanels.toast(META[next].name + ' — on this device.', 'ok');
        }
        return next;
    }

    /**
     * The crew's own default, off the VA record. Applied only when this reader
     * has not chosen for themselves and no preview link is in play — and cached
     * either way, so the NEXT visit paints it from the first frame.
     */
    function applyRecord(branding) {
        const want = valid(branding && branding.ui);
        if (!want) return current;
        write(KEY_DEFAULT(), want);
        const q = valid(new URLSearchParams(global.location.search).get('ui'));
        if (q) return current;                 // a preview link outranks the crew
        if (read(KEY())) return current;       // this reader has already chosen
        set(want, { persist: false });
        return current;
    }

    /* ---------------------------------------------------------------------
     * Resolve, at head time, from everything we can know synchronously.
     * ------------------------------------------------------------------- */
    (function boot() {
        const q = valid(new URLSearchParams(global.location.search).get('ui'));
        const mine = valid(read(KEY()));
        const crew = valid(read(KEY_DEFAULT()));
        paint(q || mine || crew || 'essential');
    })();

    /* ---------------------------------------------------------------------
     * The chooser — Settings → Appearance.
     *
     * Each option draws a miniature of the interface it is offering, in that
     * interface's own colours. The markup is deliberately plain elements and
     * CSS classes (see crewSkin.css §16) rather than an image: it themes with
     * the VA's accent, it is correct in light and dark, and it weighs nothing.
     * ------------------------------------------------------------------- */
    function previewHtml(skin) {
        // The aurora miniature gets the keyline and the wash its real cards
        // have; the essential one gets flat cards and a ruled bar. The
        // difference between the two pictures IS the difference between them.
        return '<div class="ifc-prev ifc-prev-' + skin + '" aria-hidden="true">'
            + '<div class="ifc-bar"><span class="ifc-dot"></span>'
            + '<span class="ifc-line" style="width:22%"></span>'
            + '<span class="ifc-line" style="width:12%;margin-left:auto"></span></div>'
            + '<div class="ifc-hero"></div>'
            + '<div class="ifc-row"><span class="ifc-cell"></span><span class="ifc-cell"></span><span class="ifc-cell"></span></div>'
            + '</div>';
    }

    function optionsHtml() {
        return SKINS.map((k) => {
            const m = META[k];
            const on = k === current;
            return '<button type="button" role="radio" aria-checked="' + on + '" data-skin-opt="' + k + '" class="ifc-opt">'
                + previewHtml(k)
                + '<span class="ifc-name">' + m.name + '<span class="ifc-badge">In use</span></span>'
                + '<span class="ifc-desc">' + m.desc + '</span>'
                + '</button>';
        }).join('');
    }

    /**
     * Paint the chooser into `host` and keep it in step.
     *
     * `onChoose(skin)` is the page's — the dashboard uses it to save the crew
     * default. The switch itself happens here either way, immediately, so the
     * reader sees the answer to their click before any request is made.
     */
    function mountPicker(host, onChoose) {
        const el = typeof host === 'string' ? doc.querySelector(host) : host;
        if (!el) return function () {};
        const render = () => {
            el.setAttribute('role', 'radiogroup');
            el.classList.add('ifc-opts');
            el.innerHTML = optionsHtml();
        };
        if (!el.dataset.skinWired) {
            el.dataset.skinWired = '1';
            el.addEventListener('click', (e) => {
                const b = e.target.closest('[data-skin-opt]');
                if (!b) return;
                const k = valid(b.getAttribute('data-skin-opt'));
                if (!k || k === current) return;
                set(k);                 // redraws the chooser through onChange
                if (typeof onChoose === 'function') onChoose(k);
            });
            onChange(render);
        }
        render();
        return render;
    }

    /* ---------------------------------------------------------------------
     * The top-bar switch.
     *
     * Mounted into any <span data-skin-toggle></span> a page puts in its
     * header, so a page opts in with one empty element and no script of its
     * own. Settings is staff-only; this is how a pilot gets the choice too.
     * ------------------------------------------------------------------- */
    function renderToggles() {
        const other = current === 'aurora' ? 'essential' : 'aurora';
        const label = 'Switch to the ' + META[other].name + ' interface';
        doc.querySelectorAll('[data-skin-toggle]').forEach((host) => {
            let btn = host.querySelector('.ifc-toggle');
            if (!btn) {
                btn = doc.createElement('button');
                btn.type = 'button';
                // The host page's own top-bar button classes, so this control
                // is the same object as the ones either side of it — plus
                // ifc-toggle, which carries its size when Tailwind is absent.
                btn.className = 'ifc-toggle w-9 h-9 grid place-items-center rounded-md muted hover:text-[var(--ink)] transition';
                btn.addEventListener('click', toggle);
                host.appendChild(btn);
            }
            btn.title = label;
            btn.setAttribute('aria-label', label);
            btn.innerHTML = GLYPH[other];
        });
    }

    function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

    // The toggles need the DOM. Everything above ran before it existed.
    if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', renderToggles, { once: true });
    } else {
        renderToggles();
    }

    global.CrewSkin = {
        SKINS, META,
        current: () => current,
        set, toggle, applyRecord, onChange,
        mountPicker, renderToggles, optionsHtml,
        slug,
    };
})(window);
