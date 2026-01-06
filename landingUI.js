/**
 * LandingUI.js
 * REDESIGN: Spatial Minimalist Overlay
 * Focus: High-end typography, ergonomic placement, and zero-box architecture.
 */

export const LandingUI = {
    _isVisible: false,

    init() {
        this.injectStyles();
        this.render();
        this.attachListeners();
    },

    render() {
        const existing = document.getElementById('inflight-tactical-ui');
        if (existing) existing.remove();

        const html = `
            <div id="inflight-tactical-ui" class="tactical-ui-root">
                <div class="side-branding">
                    <div class="status-indicator-dot"></div>
                    <span id="landing-server-name" class="vertical-text">EXPERT SERVER</span>
                </div>

                <div class="search-island-wrapper">
                    <div class="search-island">
                        <div class="search-glow"></div>
                        <i class="fa-solid fa-magnifying-glass search-icon-subtle"></i>
                        <input type="text" id="tile-search-input" placeholder="Find a flight..." autocomplete="off">
                        <div class="search-divider"></div>
                        <div class="search-hint">CMD+K</div>
                    </div>
                </div>

                <div class="utility-cluster">
                    <div class="orb-stack">
                        <button class="orb-btn" id="tile-weather" aria-label="Weather">
                            <i class="fa-solid fa-cloud"></i>
                        </button>
                        <button class="orb-btn" id="tile-settings" aria-label="Settings">
                            <i class="fa-solid fa-sliders"></i>
                        </button>
                        <button class="orb-btn" id="tile-history" aria-label="History">
                            <i class="fa-solid fa-clock"></i>
                        </button>
                        <button class="orb-btn highlight-orb" id="tile-server" aria-label="Network">
                            <i class="fa-solid fa-wifi"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        const container = document.getElementById('sector-ops-map-fullscreen');
        if (container) {
            container.insertAdjacentHTML('beforeend', html);
        }
    },

    update(isActive, stats = {}) {
        const el = document.getElementById('inflight-tactical-ui');
        if (!el) return;

        if (isActive) {
            el.classList.add('active');
            if (stats.server) {
                const serverEl = document.getElementById('landing-server-name');
                if (serverEl) serverEl.textContent = stats.server.toUpperCase();
            }
        } else {
            el.classList.remove('active');
        }
    },

    attachListeners() {
        const searchInput = document.getElementById('tile-search-input');
        const internalSearch = document.querySelector('.search-bar-container input');

        searchInput?.addEventListener('input', (e) => {
            if (internalSearch) {
                internalSearch.value = e.target.value;
                internalSearch.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        // Hover animation for the vertical status
        const sideBrand = document.querySelector('.side-branding');
        sideBrand?.addEventListener('mouseenter', () => sideBrand.classList.add('expand'));
        sideBrand?.addEventListener('mouseleave', () => sideBrand.classList.remove('expand'));

        const actions = {
            'tile-weather': () => document.getElementById('open-weather-settings-btn')?.click(),
            'tile-settings': () => document.getElementById('open-filter-settings-btn')?.click(),
            'tile-server': () => {
                const orb = document.getElementById('tile-server');
                orb.classList.add('orb-pulse');
                setTimeout(() => orb.classList.remove('orb-pulse'), 1000);
            }
        };

        Object.entries(actions).forEach(([id, fn]) => {
            document.getElementById(id)?.addEventListener('click', fn);
        });
    },

    injectStyles() {
        const existing = document.getElementById('inflight-ui-styles');
        if (existing) existing.remove();

        const css = `
            .tactical-ui-root {
                position: absolute;
                inset: 0;
                z-index: 2000;
                pointer-events: none;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.8s cubic-bezier(0.2, 0, 0, 1);
                font-family: 'Inter', system-ui, sans-serif;
            }

            .tactical-ui-root.active {
                opacity: 1;
                visibility: visible;
            }

            /* Side Branding (Vertical Text) */
            .side-branding {
                position: absolute;
                left: 40px;
                top: 50%;
                transform: translateY(-50%);
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 20px;
                pointer-events: auto;
            }

            .status-indicator-dot {
                width: 2px;
                height: 40px;
                background: linear-gradient(to bottom, transparent, #fff, transparent);
            }

            .vertical-text {
                writing-mode: vertical-rl;
                text-orientation: mixed;
                transform: rotate(180deg);
                font-size: 0.6rem;
                font-weight: 900;
                letter-spacing: 0.4em;
                color: rgba(255, 255, 255, 0.4);
                text-transform: uppercase;
                transition: color 0.3s ease;
            }

            .side-branding:hover .vertical-text {
                color: #fff;
            }

            /* Floating Island Search */
            .search-island-wrapper {
                position: absolute;
                bottom: 40px;
                left: 50%;
                transform: translateX(-50%);
                pointer-events: auto;
            }

            .search-island {
                position: relative;
                background: rgba(10, 10, 10, 0.4);
                backdrop-filter: blur(30px) saturate(150%);
                -webkit-backdrop-filter: blur(30px) saturate(150%);
                border: 1px solid rgba(255, 255, 255, 0.08);
                padding: 12px 24px;
                border-radius: 100px;
                display: flex;
                align-items: center;
                width: 320px;
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            }

            .search-island:focus-within {
                width: 400px;
                background: rgba(10, 10, 10, 0.6);
                border-color: rgba(255, 255, 255, 0.2);
                transform: translateX(-50%) translateY(-5px);
            }

            .search-icon-subtle {
                color: rgba(255, 255, 255, 0.3);
                font-size: 0.9rem;
                margin-right: 15px;
            }

            #tile-search-input {
                background: transparent;
                border: none;
                color: #fff;
                font-size: 0.9rem;
                font-weight: 500;
                outline: none;
                width: 100%;
            }

            #tile-search-input::placeholder {
                color: rgba(255, 255, 255, 0.2);
            }

            .search-divider {
                width: 1px;
                height: 16px;
                background: rgba(255, 255, 255, 0.1);
                margin: 0 15px;
            }

            .search-hint {
                font-size: 0.6rem;
                font-weight: 800;
                color: rgba(255, 255, 255, 0.2);
            }

            /* Utility Cluster (Orbs) */
            .utility-cluster {
                position: absolute;
                bottom: 40px;
                right: 40px;
                pointer-events: auto;
            }

            .orb-stack {
                display: flex;
                gap: 12px;
            }

            .orb-btn {
                width: 48px;
                height: 48px;
                border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.05);
                background: rgba(255, 255, 255, 0.03);
                backdrop-filter: blur(10px);
                color: rgba(255, 255, 255, 0.4);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.1rem;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .orb-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
                transform: scale(1.1) translateY(-5px);
                border-color: rgba(255, 255, 255, 0.2);
                box-shadow: 0 10px 20px rgba(0,0,0,0.2);
            }

            .highlight-orb {
                background: rgba(255, 255, 255, 0.08);
                color: #fff;
            }

            @keyframes orb-pulse {
                0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.4); }
                70% { transform: scale(1.1); box-shadow: 0 0 0 15px rgba(255, 255, 255, 0); }
                100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
            }
            .orb-pulse { animation: orb-pulse 0.6s ease-out; }

            @media (max-width: 768px) {
                .tactical-ui-root { display: none !important; }
            }
        `;

        const style = document.createElement('style');
        style.id = 'inflight-ui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};