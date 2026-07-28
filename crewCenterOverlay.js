/**
 * crewCenterOverlay.js — Crew Center as an in-app overlay.
 *
 * The Crew Center lives at /crew/<slug>, which `_redirects` rewrites to
 * crew.html on this same origin. Rather than sending pilots out to a new tab,
 * this mounts that page in a dimmed layer over the map — the same presentation
 * ProfileUI uses (see ProfileUI._inject) so the two feel like one app.
 *
 * Why an iframe rather than a port: crew-dashboard.html is a ~200KB standalone
 * document. Framing it gets the in-app presentation now and leaves the crew UI
 * free to evolve on its own; individual screens can be ported later without
 * touching this shell.
 *
 * Same-origin is what makes the rest of this work. Because /crew/<slug> is
 * served from this origin, the framed page shares localStorage with the host,
 * so the overlay can read `crew:session:<slug>` and open a pilot straight onto
 * their dashboard instead of asking them to sign in a second time — and the two
 * can talk over postMessage without a cross-origin handshake.
 *
 * ---------------------------------------------------------------------------
 * The bridge
 *
 * Framed crew pages load crewBridge.js, which speaks this protocol. Everything
 * is namespaced and both directions are checked against location.origin, so
 * nothing but our own crew pages can drive the app.
 *
 *   frame → host    inflight:crew:ready              announce; host replies hello
 *                   inflight:crew:close              close the overlay
 *                   inflight:crew:flight  {callsign} find that flight, fly to it
 *                   inflight:crew:airport {icao}     focus that airport
 *                   inflight:crew:title   {title}    label the dialog
 *
 *   host  → frame   inflight:host:hello   {theme,app} initial state
 *                   inflight:crew:theme   {theme}     host flipped light/dark
 *
 * A crew page that hasn't loaded the bridge simply never sends anything, and
 * the overlay behaves exactly as it did before.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   CrewCenterOverlay.open('british-airways');
 *   CrewCenterOverlay.open('aeromexico-virtual', { path: 'join' });
 *   CrewCenterOverlay.close();
 */

const LAYER_ID = 'crew-center-overlay';
const STYLE_ID = 'crew-center-overlay-styles';

// Matches the slugs used in /crew/<slug>. Anything else is refused rather than
// interpolated into a URL.
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

// Sub-pages the overlay can be pointed at directly, mapped to their route.
// Anything not in here falls back to the crew center entry point.
const PATHS = {
    join: (slug) => `/crew/${encodeURIComponent(slug)}/join`,
    status: (slug) => `/crew/${encodeURIComponent(slug)}/status`,
};

// How long a stored crew session is trusted for before we send the pilot back
// through the login. The backend signs crew tokens for 7 days; staying a little
// under that means a deep link doesn't land on a dashboard whose token expires
// mid-session.
const SESSION_MAX_AGE = 6 * 24 * 60 * 60 * 1000;

export const CrewCenterOverlay = {
    _layer: null,
    _frame: null,
    _isOpen: false,
    _lastFocus: null,
    _onKeydown: null,
    _onMessage: null,
    _prevBodyOverflow: '',
    _slug: '',

    isOpen() { return this._isOpen; },

    // ---- Session handoff --------------------------------------------------
    /**
     * The stored crew session for a slug, if it still looks usable.
     *
     * crew.html writes this on a successful login. Because the crew pages are
     * same-origin with the app, we can read it here and skip a login the pilot
     * has already done. A malformed or aged-out entry returns null and the
     * pilot simply gets the login page — the failure mode is the old behaviour.
     */
    _session(slug) {
        let raw = null;
        try { raw = localStorage.getItem('crew:session:' + slug); } catch (_) { return null; }
        if (!raw) return null;
        let s;
        try { s = JSON.parse(raw); } catch (_) { return null; }
        if (!s || !s.token || !s.view) return null;
        if (!s.at || Date.now() - s.at > SESSION_MAX_AGE) return null;
        return s;
    },

    /**
     * Where to point the frame. An explicit sub-page wins; otherwise a live
     * session goes straight to the right dashboard and everything else lands on
     * the login.
     */
    _entryUrl(slug, opts) {
        const path = opts && opts.path;
        if (path && PATHS[path]) return `${PATHS[path](slug)}?embed=1`;

        const session = this._session(slug);
        if (session) {
            const page = session.view === 'pilot' ? 'crew-pilot.html' : 'crew-dashboard.html';
            return `/${page}?va=${encodeURIComponent(slug)}&embed=1`;
        }
        return `/crew/${encodeURIComponent(slug)}?embed=1`;
    },

    // ---- Theme ------------------------------------------------------------
    // The app stores its light/dark choice under 'pui-theme' (see landingUI /
    // MobileDashboardUI). Anything unrecognised falls back to the OS preference
    // so the framed page is never left guessing.
    _hostTheme() {
        let stored = null;
        try { stored = localStorage.getItem('pui-theme'); } catch (_) {}
        if (stored === 'dark' || stored === 'light') return stored;
        return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
            ? 'dark' : 'light';
    },

    _send(message) {
        if (!this._frame || !this._frame.contentWindow) return;
        try { this._frame.contentWindow.postMessage(message, window.location.origin); } catch (_) {}
    },

    /** Push the host's current theme into the frame. */
    syncTheme() {
        this._send({ type: 'inflight:crew:theme', theme: this._hostTheme() });
    },

    // ---- Bridge -----------------------------------------------------------
    _handleMessage(e) {
        if (!this._isOpen) return;
        // Same-origin only, and only from the frame we opened. Both checks
        // matter: origin alone would let any same-origin frame drive the app.
        if (e.origin !== window.location.origin) return;
        if (!this._frame || e.source !== this._frame.contentWindow) return;

        const msg = e.data;
        if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('inflight:crew:')) return;

        switch (msg.type) {
            case 'inflight:crew:ready':
                this._send({ type: 'inflight:host:hello', app: 'inflight-tracker', theme: this._hostTheme() });
                break;

            case 'inflight:crew:close':
                this.close();
                break;

            case 'inflight:crew:title': {
                const t = typeof msg.title === 'string' ? msg.title.slice(0, 120) : '';
                if (t && this._layer) this._layer.setAttribute('aria-label', t);
                break;
            }

            case 'inflight:crew:flight':
                this._showFlight(msg.callsign);
                break;

            case 'inflight:crew:airport':
                this._showAirport(msg.icao);
                break;
        }
    },

    /**
     * Find a live flight by callsign and fly the map to it.
     *
     * The crew center only ever knows a callsign — the tracker's internal
     * flight id is not something it can hold — so this resolves through the
     * app's own search before handing off to the normal selection path.
     */
    _showFlight(callsign) {
        const q = String(callsign || '').trim();
        if (!q || typeof window.runGlobalSearch !== 'function') return;

        let hit = null;
        try {
            const results = window.runGlobalSearch(q);
            hit = results && Array.isArray(results.flights) ? results.flights[0] : null;
        } catch (_) { return; }
        if (!hit || !hit.feature) return;

        const props = hit.feature.properties || {};
        const coords = (hit.feature.geometry && hit.feature.geometry.coordinates) || [];
        const lon = Number(coords[0]), lat = Number(coords[1]);
        if (!props.flightId || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

        this.close();
        // After the closing transition, so the map isn't animating behind a
        // fading overlay.
        setTimeout(() => {
            if (typeof window.onSearchResultClick === 'function') {
                window.onSearchResultClick(props.flightId, lat, lon);
            }
        }, 260);
    },

    _showAirport(icao) {
        const code = String(icao || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{3,4}$/.test(code)) return;
        if (typeof window.getAirportCoords !== 'function') return;

        const c = window.getAirportCoords(code);
        if (!c) return;

        this.close();
        setTimeout(() => {
            if (typeof window.onAirportSearchResultClick === 'function') {
                window.onAirportSearchResultClick({ icao: code, lat: c.lat, lon: c.lon });
            }
        }, 260);
    },

    _injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${LAYER_ID} {
                position: fixed; inset: 0; z-index: 100000;
                display: flex; align-items: center; justify-content: center;
                padding: 24px;
                background: rgba(8, 10, 16, 0.62);
                backdrop-filter: blur(3px);
                -webkit-backdrop-filter: blur(3px);
                opacity: 0; visibility: hidden; pointer-events: none;
                transition: opacity 220ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0ms linear 220ms;
            }
            #${LAYER_ID}.cco-open {
                opacity: 1; visibility: visible; pointer-events: auto;
                transition: opacity 220ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0ms linear 0ms;
            }
            #${LAYER_ID} .cco-shell {
                position: relative;
                width: 100%; max-width: 1380px; height: 92vh;
                background: #0b0d12;
                border-radius: 18px;
                box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
                overflow: hidden;
                opacity: 0; transform: translateY(8px) scale(0.99);
                transition: opacity 260ms cubic-bezier(0.16, 1, 0.3, 1) 40ms,
                            transform 260ms cubic-bezier(0.16, 1, 0.3, 1) 40ms;
            }
            #${LAYER_ID}.cco-open .cco-shell { opacity: 1; transform: translateY(0) scale(1); }
            #${LAYER_ID} .cco-frame {
                width: 100%; height: 100%; border: 0; display: block;
                background: transparent;
                opacity: 0; transition: opacity 200ms ease;
            }
            #${LAYER_ID} .cco-frame.cco-loaded { opacity: 1; }
            #${LAYER_ID} .cco-spinner {
                position: absolute; inset: 0; display: grid; place-items: center;
                gap: 12px; color: rgba(255, 255, 255, 0.55);
                font: 600 13px/1.4 system-ui, -apple-system, sans-serif;
                pointer-events: none;
            }
            #${LAYER_ID} .cco-spinner.cco-hidden { display: none; }
            #${LAYER_ID} .cco-spinner span {
                width: 26px; height: 26px; border-radius: 50%;
                border: 2px solid rgba(255, 255, 255, 0.18);
                border-top-color: rgba(255, 255, 255, 0.75);
                animation: cco-spin 720ms linear infinite;
            }
            @keyframes cco-spin { to { transform: rotate(360deg); } }
            #${LAYER_ID} .cco-close {
                position: absolute; top: 12px; right: 12px; z-index: 2;
                width: 34px; height: 34px; border-radius: 10px;
                display: grid; place-items: center;
                border: 1px solid rgba(255, 255, 255, 0.14);
                background: rgba(18, 20, 28, 0.72);
                color: rgba(255, 255, 255, 0.8);
                font-size: 16px; line-height: 1; cursor: pointer;
                backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
            }
            #${LAYER_ID} .cco-close:hover {
                background: rgba(28, 31, 42, 0.9); color: #fff;
                border-color: rgba(255, 255, 255, 0.24);
            }
            /* Phones: full-bleed, matching how the mobile sheets present. */
            @media (max-width: 640px) {
                #${LAYER_ID} { padding: 0; }
                #${LAYER_ID} .cco-shell { height: 100%; max-width: none; border-radius: 0; }
                #${LAYER_ID} .cco-close { top: max(10px, env(safe-area-inset-top)); right: 10px; }
            }
            @media (prefers-reduced-motion: reduce) {
                #${LAYER_ID}, #${LAYER_ID} .cco-shell, #${LAYER_ID} .cco-frame { transition: none; }
                #${LAYER_ID} .cco-spinner span { animation: none; }
            }
        `;
        document.head.appendChild(style);
    },

    _build() {
        if (this._layer) return;
        this._injectStyles();

        const layer = document.createElement('div');
        layer.id = LAYER_ID;
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-modal', 'true');
        layer.setAttribute('aria-label', 'Crew Center');
        layer.innerHTML = `
            <div class="cco-shell">
                <button type="button" class="cco-close" aria-label="Close Crew Center">&#10005;</button>
                <div class="cco-spinner"><span></span>Opening crew center…</div>
                <iframe class="cco-frame" title="Crew Center"
                        referrerpolicy="same-origin"
                        allow="clipboard-write"></iframe>
            </div>`;
        document.body.appendChild(layer);

        this._layer = layer;
        this._frame = layer.querySelector('.cco-frame');

        // Backdrop click closes; clicks inside the shell must not.
        layer.addEventListener('click', (e) => { if (e.target === layer) this.close(); });
        layer.querySelector('.cco-close').addEventListener('click', () => this.close());

        this._frame.addEventListener('load', () => {
            this._frame.classList.add('cco-loaded');
            const sp = this._layer.querySelector('.cco-spinner');
            if (sp) sp.classList.add('cco-hidden');
            // Push the theme without waiting to be asked. A crew page running
            // crewBridge.js also announces itself, but this covers the ordering
            // where the frame is ready before its script has run.
            this.syncTheme();
        });

        // One listener for the life of the overlay; _handleMessage ignores
        // anything that isn't from the current frame.
        this._onMessage = (e) => this._handleMessage(e);
        window.addEventListener('message', this._onMessage);
    },

    /**
     * Open the Crew Center for a VA slug.
     * @param {string} slug          the VA slug from /crew/<slug>
     * @param {object} [opts]
     * @param {string} [opts.path]   'join' | 'status' — open a sub-page directly
     * @returns {boolean} whether the overlay opened
     */
    open(slug, opts) {
        const clean = String(slug || '').trim();
        if (!SLUG_RE.test(clean)) {
            console.warn('[CrewCenterOverlay] refusing to open an invalid slug:', slug);
            return false;
        }

        this._build();
        this._slug = clean;

        // Reset the loading state on every open — the frame is reused, so a
        // second open would otherwise show the previous VA until it swaps.
        const sp = this._layer.querySelector('.cco-spinner');
        if (sp) sp.classList.remove('cco-hidden');
        this._frame.classList.remove('cco-loaded');
        this._layer.setAttribute('aria-label', 'Crew Center');
        this._frame.src = this._entryUrl(clean, opts);

        this._lastFocus = document.activeElement;
        this._prevBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        // Force a reflow so the transition runs on first open too.
        void this._layer.offsetWidth;
        this._layer.classList.add('cco-open');
        this._isOpen = true;

        this._onKeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };
        // Capture phase: the host app also listens for Esc (ProfileUI closes on
        // it), and the crew overlay sits on top, so it must win.
        document.addEventListener('keydown', this._onKeydown, true);

        const closeBtn = this._layer.querySelector('.cco-close');
        if (closeBtn) closeBtn.focus();
        return true;
    },

    close() {
        if (!this._isOpen || !this._layer) return;
        this._layer.classList.remove('cco-open');
        this._isOpen = false;

        if (this._onKeydown) {
            document.removeEventListener('keydown', this._onKeydown, true);
            this._onKeydown = null;
        }
        document.body.style.overflow = this._prevBodyOverflow || '';

        // Drop the frame's document once hidden so the crew center isn't left
        // polling in the background behind the map.
        setTimeout(() => {
            if (!this._isOpen && this._frame) {
                this._frame.classList.remove('cco-loaded');
                this._frame.src = 'about:blank';
            }
        }, 240);

        if (this._lastFocus && typeof this._lastFocus.focus === 'function') {
            try { this._lastFocus.focus(); } catch (_) {}
        }
        this._lastFocus = null;
    },
};

// Handy for the crew pages themselves (an embedded child can ask to be closed)
// and for debugging from the console.
if (typeof window !== 'undefined') window.CrewCenterOverlay = CrewCenterOverlay;
