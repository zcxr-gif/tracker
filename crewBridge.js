/**
 * crewBridge.js — the crew center's side of the app bridge.
 *
 * Crew pages are standalone documents. They render fine on their own at
 * inflight.info/crew/<slug>, and they also get framed — by the app's Crew
 * Center overlay (crewCenterOverlay.js), and by VAs embedding their own crew
 * center in their website. This module is what lets a framed crew page stop
 * pretending it's a whole browser tab:
 *
 *   1. ?embed=1 shell mode. The host already supplies a rounded card, a dimmed
 *      backdrop and a close button, so the page drops its own page-level chrome
 *      and fills the frame instead. crew.html and crew-join.html already did a
 *      version of this by hand; this generalises it.
 *
 *   2. Actions the crew center can't perform itself. A PIREP row knows a
 *      callsign; only the app can fly the map to it. Rather than teach the crew
 *      center about the map, it asks:
 *
 *          CrewBridge.showFlight('AEROMEXICO 412');
 *          CrewBridge.showAirport('MMMX');
 *          CrewBridge.close();
 *
 *      Off-host (a real tab) those calls fall back to a normal navigation, so
 *      the same button works in both places and no caller needs to branch.
 *
 * Protocol and origin checks are documented in crewCenterOverlay.js. Loaded as
 * a classic script, like crewBrand.js, because the crew pages aren't bundled.
 */

(function (global) {
    'use strict';

    const doc = global.document;
    const EMBEDDED = (function () {
        try {
            return new URLSearchParams(global.location.search).get('embed') === '1'
                && global.parent !== global;
        } catch (_) { return false; }
    })();

    let hostReady = false;
    const hostListeners = [];

    function send(type, payload) {
        if (!EMBEDDED) return false;
        try {
            // The overlay is same-origin. A VA site framing us is not, and does
            // not answer this protocol — it only pushes themes — so targeting
            // our own origin is correct and keeps the messages from leaking to
            // an unexpected embedder.
            global.parent.postMessage(
                Object.assign({ type: 'inflight:crew:' + type }, payload || {}),
                global.location.origin
            );
            return true;
        } catch (_) { return false; }
    }

    // ---- Shell mode --------------------------------------------------------
    // Only the page-level chrome goes; nothing about the content changes, so a
    // framed page and a standalone one stay the same product.
    function applyEmbedShell() {
        if (!EMBEDDED || !doc.body) return;
        doc.body.classList.add('embed');
        doc.documentElement.style.background = 'transparent';

        if (doc.getElementById('crew-embed-shell')) return;
        const style = doc.createElement('style');
        style.id = 'crew-embed-shell';
        style.textContent = `
            /* The host shell owns the page background and the scroll edge. */
            body.embed { background: transparent !important; min-height: 0 !important; }
            body.embed { min-height: 100% !important; }

            /* The host's own close button sits top-right; ours would collide. */
            body.embed [data-embed-hide] { display: none !important; }

            /* A sticky header inside a framed card should stick to the card,
               not to a viewport the frame doesn't own. */
            body.embed header.sticky { position: relative !important; top: auto !important; }

            /* Scroll inside the card rather than growing the frame. */
            body.embed { height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; }
        `;
        doc.head.appendChild(style);
    }

    // ---- Host handshake ----------------------------------------------------
    function listen() {
        if (!EMBEDDED) return;
        global.addEventListener('message', (e) => {
            if (e.source !== global.parent) return;
            const d = e.data;
            if (!d || typeof d.type !== 'string') return;
            if (d.type !== 'inflight:host:hello') return;
            // Cross-origin embedders (a VA website) can say hello too, but only
            // our own app is trusted to describe itself as the tracker.
            if (e.origin !== global.location.origin) return;
            hostReady = true;
            hostListeners.forEach(fn => { try { fn(d); } catch (_) {} });
        });
    }

    // ---- Public API --------------------------------------------------------
    const CrewBridge = {
        /** True when running inside a host shell with ?embed=1. */
        isEmbedded() { return EMBEDDED; },

        /** True once the app has answered our announcement. */
        isHosted() { return hostReady; },

        /** Called with the host's hello payload ({ app, theme }). */
        onHost(fn) {
            if (typeof fn !== 'function') return;
            hostListeners.push(fn);
        },

        /** Ask the host to close the overlay. Off-host this does nothing. */
        close() { return send('close'); },

        /** Label the host's dialog, e.g. with the VA name. */
        setTitle(title) { return send('title', { title: String(title || '').slice(0, 120) }); },

        /**
         * Show a live flight on the app's map.
         * Off-host, navigates to the tracker's own deep link instead, so the
         * same crew center button works in a plain tab.
         */
        showFlight(callsign) {
            const cs = String(callsign || '').trim();
            if (!cs) return false;
            if (send('flight', { callsign: cs })) return true;
            global.open('/?q=' + encodeURIComponent(cs), '_blank', 'noopener');
            return false;
        },

        /** Focus an airport on the app's map, with the same off-host fallback. */
        showAirport(icao) {
            const code = String(icao || '').trim().toUpperCase();
            if (!/^[A-Z0-9]{3,4}$/.test(code)) return false;
            if (send('airport', { icao: code })) return true;
            global.open('/?q=' + encodeURIComponent(code), '_blank', 'noopener');
            return false;
        },
    };

    /**
     * Declarative handoff. Anything in a crew page can opt into "show this on
     * the map" without knowing the bridge exists:
     *
     *     <button data-map-airport="MMMX">MMMX</button>
     *     <button data-map-flight="AEROMEXICO 412">AEROMEXICO 412</button>
     *
     * One delegated listener covers content rendered at any point, which
     * matters because the crew pages rebuild their lists constantly. Off-host
     * the same attributes fall back to opening the tracker in a new tab.
     */
    function delegate() {
        doc.addEventListener('click', (e) => {
            if (!e.target || !e.target.closest) return;

            const flightEl = e.target.closest('[data-map-flight]');
            const airportEl = flightEl ? null : e.target.closest('[data-map-airport]');
            if (!flightEl && !airportEl) return;

            // Stop here rather than letting the click also reach a row handler
            // wrapping the chip — "show it on the map" is the whole intent.
            e.preventDefault();
            e.stopPropagation();

            if (flightEl) CrewBridge.showFlight(flightEl.getAttribute('data-map-flight'));
            else CrewBridge.showAirport(airportEl.getAttribute('data-map-airport'));
        });
    }

    function boot() {
        applyEmbedShell();
        listen();
        delegate();
        // Announce last, so the host's reply lands on a page that's ready for it.
        send('ready');
    }

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
    else boot();

    global.CrewBridge = CrewBridge;
})(window);
