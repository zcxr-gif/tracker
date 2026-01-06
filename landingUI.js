/**
 * LandingUI.js - REDESIGN: Tactical Flight HUD
 * A proper flight tracking interface focusing on clarity and instrument-style aesthetics.
 */

export const LandingUI = {
    _isVisible: false,

    init() {
        this.injectStyles();
        this.render();
        this.attachListeners();
    },

    render() {
        // Cleanup existing instances
        const existing = document.getElementById('inflight-tactical-ui');
        if (existing) existing.remove();

        const html = `
            <div id="inflight-tactical-ui" class="tactical-ui-root">
                <div class="hud-container">
                    <div class="hud-status-bar">
                        <div class="status-indicator">
                            <span class="status-dot-pulse"></span>
                            <span id="landing-server-name" class="mono-label">EXPERT SERVER</span>
                        </div>
                        <div class="hud-system-label">RADAR LNK 01</div>
                    </div>

                    <div class="search-bracket-wrapper">
                        <div class="bracket-left"></div>
                        <div class="search-inner">
                            <i class="fa-solid fa-crosshairs search-icon-tactical"></i>
                            <input type="text" id="tile-search-input" placeholder="INPUT IDENT..." autocomplete="off">
                        </div>
                        <div class="bracket-right"></div>
                    </div>

                    <div class="hud-utility-bezel">
                        <button class="util-btn-hex" id="tile-weather" title="Weather Layers">
                            <i class="fa-solid fa-cloud-sun"></i>
                        </button>
                        <button class="util-btn-hex" id="tile-settings" title="Map Config">
                            <i class="fa-solid fa-sliders"></i>
                        </button>
                        <button class="util-btn-hex" id="tile-history" title="Flight History">
                            <i class="fa-solid fa-clock-rotate-left"></i>
                        </button>
                        <button class="util-btn-hex highlight-btn" id="tile-server" title="Server Status">
                            <i class="fa-solid fa-server"></i>
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

        // Sync custom search with internal app search logic
        searchInput?.addEventListener('input', (e) => {
            if (internalSearch) {
                internalSearch.value = e.target.value;
                internalSearch.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        const actions = {
            'tile-weather': () => document.getElementById('open-weather-settings-btn')?.click(),
            'tile-settings': () => document.getElementById('open-filter-settings-btn')?.click(),
            'tile-history': () => {}, // Expandable logic for future integration
            'tile-server': () => {
                const btn = document.getElementById('tile-server');
                btn.classList.add('hud-glitch-effect');
                setTimeout(() => btn.classList.remove('hud-glitch-effect'), 500);
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
                transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                font-family: 'JetBrains Mono', 'Roboto Mono', 'SF Mono', monospace;
                color: #e2e8f0;
            }

            .tactical-ui-root.active {
                opacity: 1;
                visibility: visible;
            }

            .hud-container {
                position: absolute;
                top: 40px;
                right: 40px;
                pointer-events: auto;
                width: 340px;
                background: linear-gradient(135deg, rgba(6, 10, 15, 0.6) 0%, rgba(10, 15, 25, 0.4) 100%);
                backdrop-filter: blur(20px) saturate(160%);
                -webkit-backdrop-filter: blur(20px) saturate(160%);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 4px;
                padding: 16px;
                display: flex;
                flex-direction: column;
                gap: 16px;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), inset 0 0 20px rgba(56, 189, 248, 0.05);
            }

            /* Scanline Overlay Effect */
            .hud-container::before {
                content: "";
                position: absolute;
                inset: 0;
                background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.02), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.02));
                background-size: 100% 2px, 3px 100%;
                pointer-events: none;
                opacity: 0.3;
            }

            /* Top Status Section */
            .hud-status-bar {
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid rgba(56, 189, 248, 0.2);
                padding-bottom: 10px;
            }

            .status-indicator {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .status-dot-pulse {
                width: 6px;
                height: 6px;
                background: #0ea5e9;
                border-radius: 50%;
                box-shadow: 0 0 10px #0ea5e9;
                animation: hud-pulse 2s infinite;
            }

            .mono-label {
                font-size: 0.65rem;
                font-weight: 700;
                letter-spacing: 0.1em;
                color: #0ea5e9;
            }

            .hud-system-label {
                font-size: 0.55rem;
                color: rgba(255,255,255,0.4);
                font-weight: 800;
            }

            /* Search Bracket Layout */
            .search-bracket-wrapper {
                position: relative;
                display: flex;
                align-items: center;
                height: 44px;
                padding: 0 10px;
            }

            .bracket-left, .bracket-right {
                position: absolute;
                top: 0;
                bottom: 0;
                width: 10px;
                border: 2px solid rgba(56, 189, 248, 0.4);
            }

            .bracket-left { left: 0; border-right: none; }
            .bracket-right { right: 0; border-left: none; }

            .search-inner {
                display: flex;
                align-items: center;
                width: 100%;
                padding: 0 15px;
            }

            .search-icon-tactical {
                font-size: 0.9rem;
                color: #0ea5e9;
                margin-right: 12px;
                opacity: 0.8;
            }

            #tile-search-input {
                background: transparent;
                border: none;
                color: #fff;
                font-family: inherit;
                font-size: 0.85rem;
                outline: none;
                width: 100%;
                text-transform: uppercase;
            }

            #tile-search-input::placeholder {
                color: rgba(56, 189, 248, 0.3);
            }

            /* Utility Bezel */
            .hud-utility-bezel {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 8px;
            }

            .util-btn-hex {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #94a3b8;
                height: 40px;
                cursor: pointer;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1rem;
            }

            .util-btn-hex:hover {
                background: rgba(14, 165, 233, 0.15);
                border-color: #0ea5e9;
                color: #0ea5e9;
                box-shadow: 0 0 15px rgba(14, 165, 233, 0.2);
            }

            .highlight-btn {
                color: #0ea5e9;
                border-color: rgba(14, 165, 233, 0.3);
            }

            /* Animations */
            @keyframes hud-pulse {
                0% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.4; transform: scale(1.2); }
                100% { opacity: 1; transform: scale(1); }
            }

            .hud-glitch-effect {
                animation: hud-glitch 0.3s cubic-bezier(.25,.46,.45,.94) both;
            }

            @keyframes hud-glitch {
                0% { transform: translate(0); text-shadow: none; }
                20% { transform: translate(-2px, 2px); text-shadow: 2px 0 #ff00c1; }
                40% { transform: translate(-2px, -2px); text-shadow: -2px 0 #00fff9; }
                60% { transform: translate(2px, 2px); }
                80% { transform: translate(2px, -2px); }
                100% { transform: translate(0); }
            }

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