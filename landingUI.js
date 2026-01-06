/**
 * LandingUI.js
 * REDESIGN: UNIFIED INFLIGHT Utility Module
 * Features: Integrated Search & Utility grid, Enhanced scaling.
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
                <div class="hud-header">
                    <div class="header-right-cluster">
                        
                        <div class="main-module">
                            <div class="search-section">
                                <i class="fa-solid fa-magnifying-glass search-icon"></i>
                                <input type="text" id="tile-search-input" placeholder="Search Radar..." autocomplete="off">
                            </div>

                            <div class="module-divider"></div>

                            <div class="utility-grid">
                                <button class="util-btn" id="tile-weather" title="Weather Layers">
                                    <i class="fa-solid fa-cloud-sun"></i>
                                </button>
                                <button class="util-btn" id="tile-settings" title="Map Config">
                                    <i class="fa-solid fa-sliders"></i>
                                </button>
                                <button class="util-btn" id="tile-history" title="Flight History">
                                    <i class="fa-solid fa-clock-rotate-left"></i>
                                </button>
                                <button class="util-btn highlight-btn" id="tile-server" title="Server Status">
                                    <i class="fa-solid fa-server"></i>
                                </button>
                            </div>
                        </div>

                        <div class="server-badge">
                            <span class="status-dot"></span>
                            <span id="landing-server-name">EXPERT SERVER</span>
                        </div>
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

        // Sync input with the system's internal search bar
        searchInput?.addEventListener('input', (e) => {
            if (internalSearch) {
                internalSearch.value = e.target.value;
                internalSearch.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        const actions = {
            'tile-weather': () => document.getElementById('open-weather-settings-btn')?.click(),
            'tile-settings': () => document.getElementById('open-filter-settings-btn')?.click(),
            'tile-server': () => {
                const btn = document.getElementById('tile-server');
                btn.classList.add('pulse-ring');
                setTimeout(() => btn.classList.remove('pulse-ring'), 1500);
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
            @media (max-width: 768px) {
                .tactical-ui-root { display: none !important; }
            }

            .tactical-ui-root {
                position: absolute;
                inset: 0;
                z-index: 2000;
                pointer-events: none;
                opacity: 0;
                visibility: hidden;
                transition: all 0.6s cubic-bezier(0.22, 1, 0.36, 1);
                font-family: 'Inter', system-ui, -apple-system, sans-serif;
                color: #fff;
            }

            .tactical-ui-root.active {
                opacity: 1;
                visibility: visible;
            }

            .hud-header {
                position: absolute;
                top: 30px;
                right: 30px;
                display: flex;
                justify-content: flex-end;
                pointer-events: none;
            }

            .header-right-cluster {
                display: flex;
                flex-direction: column;
                align-items: stretch;
                gap: 12px;
                pointer-events: auto;
                width: 260px; /* Increased base width */
            }

            /* Unified Container Module */
            .main-module {
                background: rgba(10, 12, 18, 0.8);
                backdrop-filter: blur(25px);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 16px;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
                overflow: hidden;
            }

            /* Search Section - Bigger Scale */
            .search-section {
                display: flex;
                align-items: center;
                padding: 14px 18px;
                height: 52px; /* Increased height */
            }

            .search-icon {
                font-size: 1rem;
                color: #94a3b8;
                margin-right: 12px;
            }

            #tile-search-input {
                background: transparent;
                border: none;
                color: #fff;
                font-size: 1rem; /* Bigger text */
                font-weight: 500;
                outline: none;
                width: 100%;
            }

            #tile-search-input::placeholder {
                color: #475569;
            }

            /* Visual Separator inside the module */
            .module-divider {
                height: 1px;
                background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
                margin: 0 10px;
            }

            /* Utility Buttons - Bigger Scale */
            .utility-grid {
                display: flex;
                padding: 8px;
                gap: 4px;
            }

            .util-btn {
                flex: 1;
                height: 48px; /* Significantly bigger buttons */
                border-radius: 10px;
                border: none;
                background: transparent;
                color: #94a3b8;
                font-size: 1.1rem;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .util-btn:hover { 
                background: rgba(255, 255, 255, 0.08); 
                color: #38bdf8;
                transform: scale(1.05);
            }
            
            .highlight-btn { 
                color: #38bdf8;
                background: rgba(56, 189, 248, 0.05);
            }

            /* Server Badge Styling */
            .server-badge {
                align-self: flex-end;
                background: rgba(10, 12, 18, 0.6);
                padding: 6px 16px;
                border-radius: 100px;
                font-size: 0.7rem;
                font-weight: 900;
                display: flex;
                align-items: center;
                gap: 8px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                color: #38bdf8;
                letter-spacing: 1px;
                backdrop-filter: blur(10px);
            }

            .status-dot { 
                width: 7px; 
                height: 7px; 
                background: #38bdf8; 
                border-radius: 50%; 
                box-shadow: 0 0 10px #38bdf8; 
            }

            @keyframes pulse-ring {
                0% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.4); }
                70% { box-shadow: 0 0 0 15px rgba(56, 189, 248, 0); }
                100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
            }
            .pulse-ring { animation: pulse-ring 1s ease-out; }
        `;

        const style = document.createElement('style');
        style.id = 'inflight-ui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};