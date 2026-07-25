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
 * Same-origin matters. Because /crew/<slug> is served from this origin, the
 * framed page shares localStorage with the host — which is what will later let
 * the host hand it a session (`crew:session:<slug>`) instead of prompting for a
 * second login. This module deliberately does none of that yet; it is purely
 * presentational, so it can ship and be judged on feel before any auth work.
 *
 * Usage:
 *   CrewCenterOverlay.open('british-airways');
 *   CrewCenterOverlay.close();
 */

const LAYER_ID = 'crew-center-overlay';
const STYLE_ID = 'crew-center-overlay-styles';

// Matches the slugs used in /crew/<slug>. Anything else is refused rather than
// interpolated into a URL.
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

export const CrewCenterOverlay = {
    _layer: null,
    _frame: null,
    _isOpen: false,
    _lastFocus: null,
    _onKeydown: null,
    _prevBodyOverflow: '',

    isOpen() { return this._isOpen; },

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
        });
    },

    /**
     * Open the Crew Center for a VA slug.
     * @param {string} slug  the VA slug from /crew/<slug>
     * @returns {boolean} whether the overlay opened
     */
    open(slug) {
        const clean = String(slug || '').trim();
        if (!SLUG_RE.test(clean)) {
            console.warn('[CrewCenterOverlay] refusing to open an invalid slug:', slug);
            return false;
        }

        this._build();

        // Reset the loading state on every open — the frame is reused, so a
        // second open would otherwise show the previous VA until it swaps.
        const sp = this._layer.querySelector('.cco-spinner');
        if (sp) sp.classList.remove('cco-hidden');
        this._frame.classList.remove('cco-loaded');
        this._frame.src = `/crew/${encodeURIComponent(clean)}?embed=1`;

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
