/**
 * LandingUI.js
 * REDESIGN: INFLIGHT Utility Overlay
 * Features: Right-aligned utility cluster, auto-hide on mobile.
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
                        <div class="utility-grid">
                            <button class="util-btn" id="tile-search" title="Search Radar">
                                <i class="fa-solid fa-magnifying-glass"></i>
                            </button>
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
        const actions = {
            'tile-search': () => document.querySelector('.search-bar-container input')?.focus(),
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
            /* Hide UI on smaller screens/devices */
            @media (max-width: 768px) {
                .tactical-ui-root {
                    display: none !important;
                }
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
                top: 24px;
                right: 24px;
                display: flex;
                justify-content: flex-end;
                align-items: flex-start;
                pointer-events: none;
            }

            /* Utility & Server Cluster */
            .header-right-cluster {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 10px;
                pointer-events: auto;
            }

            .utility-grid {
                display: flex;
                gap: 6px;
                background: rgba(10, 12, 18, 0.6);
                padding: 6px;
                border-radius: 12px;
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            }

            .util-btn {
                width: 38px;
                height: 38px;
                border-radius: 8px;
                border: none;
                background: transparent;
                color: #64748b;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
            }

            .util-btn:hover { 
                background: rgba(255, 255, 255, 0.05); 
                color: #38bdf8; 
                transform: translateY(-1px);
            }
            
            .highlight-btn { color: #38bdf8; }

            .server-badge {
                background: rgba(56, 189, 248, 0.1);
                padding: 5px 14px;
                border-radius: 100px;
                font-size: 0.65rem;
                font-weight: 800;
                display: flex;
                align-items: center;
                gap: 8px;
                border: 1px solid rgba(56, 189, 248, 0.3);
                color: #38bdf8;
                letter-spacing: 0.5px;
            }

            .status-dot { 
                width: 6px; 
                height: 6px; 
                background: #38bdf8; 
                border-radius: 50%; 
                box-shadow: 0 0 10px #38bdf8; 
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