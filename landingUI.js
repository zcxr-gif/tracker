/**
 * LandingUI.js
 * REDESIGN: INFLIGHT Tactical Overlay
 * Features: Minimalist glassmorphism, .ico integration, and streamlined utility.
 */

export const LandingUI = {
    _isVisible: false,
    _clockInterval: null,

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
                    <div class="brand-container">
                        <div class="brand-logo">
                            <img src="Images/inflightIcon.ico" alt="Inflight Logo" class="brand-icon-img">
                        </div>
                        <div class="brand-meta">
                            <div class="brand-name">IN<span class="highlight">FLIGHT</span></div>
                            <div id="landing-clock" class="brand-timer">00:00:00Z</div>
                        </div>
                    </div>

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
        this.startClock();
    },

    update(isActive, stats = {}) {
        const el = document.getElementById('inflight-tactical-ui');
        if (!el) return;

        if (isActive) {
            el.classList.add('active');
            // Update server name if provided in stats
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

    startClock() {
        if (this._clockInterval) clearInterval(this._clockInterval);
        const update = () => {
            const el = document.getElementById('landing-clock');
            if (!el) return;
            const now = new Date();
            // Standard UTC/ZULU time format for aviation
            el.textContent = now.toISOString().split('T')[1].split('.')[0] + 'Z';
        };
        this._clockInterval = setInterval(update, 1000);
        update();
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
                left: 24px;
                right: 24px;
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                pointer-events: none;
            }

            /* Branding Section */
            .brand-container {
                pointer-events: auto;
                display: flex;
                align-items: center;
                gap: 14px;
                background: rgba(10, 12, 18, 0.6);
                padding: 10px 18px;
                border-radius: 14px;
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            }

            .brand-icon-img {
                width: 28px;
                height: 28px;
                filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.4));
            }

            .brand-name { 
                font-weight: 900; 
                font-size: 1.3rem; 
                letter-spacing: 2px;
                line-height: 1;
            }
            .brand-name .highlight { color: #38bdf8; }
            
            .brand-timer { 
                font-family: 'JetBrains Mono', monospace; 
                font-size: 0.75rem; 
                color: #94a3b8; 
                margin-top: 4px;
                letter-spacing: 1px;
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