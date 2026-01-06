/**
 * LandingUI.js
 * REDESIGN: INFLIGHT Utility Overlay
 * Features: Unified transparent modal, horizontal expansion, integrated search/utils.
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
                    <div class="tactical-modal">
                        <div class="search-wrapper">
                            <i class="fa-solid fa-magnifying-glass search-icon"></i>
                            <input type="text" id="tile-search-input" placeholder="SEARCH RADAR..." autocomplete="off">
                        </div>

                        <div class="modal-footer">
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

                            <div class="server-badge">
                                <span class="status-dot"></span>
                                <span id="landing-server-name">EXPERT SERVER</span>
                            </div>
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

        // Sync custom search with the internal app search
        searchInput?.addEventListener('input', (e) => {
            if (internalSearch) {
                internalSearch.value = e.target.value;
                // Trigger internal search logic if it listens for input events
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
                transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
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
                pointer-events: none;
            }

            /* Unified Transparent Modal */
            .tactical-modal {
                pointer-events: auto;
                background: rgba(10, 12, 18, 0.15); /* Very transparent */
                backdrop-filter: blur(12px) saturate(180%);
                -webkit-backdrop-filter: blur(12px) saturate(180%);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 14px;
                padding: 10px;
                width: 320px; /* Expanded sideways */
                display: flex;
                flex-direction: column;
                gap: 10px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            }

            /* Search Bar Styling (Horizontal expansion focus) */
            .search-wrapper {
                display: flex;
                align-items: center;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                padding: 0 14px;
                height: 40px; /* Substantial feel without being tall */
                transition: border 0.3s ease;
            }

            .search-wrapper:focus-within {
                border-color: rgba(56, 189, 248, 0.4);
            }

            .search-icon {
                font-size: 0.85rem;
                color: #64748b;
                margin-right: 12px;
            }

            #tile-search-input {
                background: transparent;
                border: none;
                color: #fff;
                font-size: 0.75rem;
                font-weight: 600;
                letter-spacing: 0.05em;
                outline: none;
                width: 100%;
            }

            #tile-search-input::placeholder {
                color: #475569;
            }

            /* Bottom layout of the modal */
            .modal-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .utility-grid {
                display: flex;
                gap: 4px;
            }

            .util-btn {
                width: 36px;
                height: 36px;
                border-radius: 6px;
                border: none;
                background: transparent;
                color: #94a3b8;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
            }

            .util-btn:hover { 
                background: rgba(56, 189, 248, 0.1); 
                color: #38bdf8; 
            }
            
            .highlight-btn { color: #38bdf8; }

            .server-badge {
                background: rgba(56, 189, 248, 0.1);
                padding: 6px 12px;
                border-radius: 8px;
                font-size: 0.6rem;
                font-weight: 800;
                display: flex;
                align-items: center;
                gap: 6px;
                border: 1px solid rgba(56, 189, 248, 0.2);
                color: #38bdf8;
                letter-spacing: 0.5px;
            }

            .status-dot { 
                width: 4px; 
                height: 4px; 
                background: #38bdf8; 
                border-radius: 50%; 
                box-shadow: 0 0 8px #38bdf8; 
            }

            @keyframes pulse-ring {
                0% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.4); }
                70% { box-shadow: 0 0 0 10px rgba(56, 189, 248, 0); }
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