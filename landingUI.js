/**
 * LandingUI.js
 * REDESIGN: Tactical Overlay UI
 * Features: Integrated utility cluster, telemetry stats, and high-density typography.
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
        const existing = document.getElementById('sector-ops-tactical-ui');
        if (existing) existing.remove();

        const html = `
            <div id="sector-ops-tactical-ui" class="tactical-ui-root">
                <div class="hud-corner top-left">
                    <div class="brand-container">
                        <div class="brand-logo">
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#38bdf8" stroke-width="2">
                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
                            </svg>
                        </div>
                        <div class="brand-meta">
                            <div class="brand-name">SECTOR<span class="highlight">OPS</span></div>
                            <div id="landing-clock" class="brand-timer">00:00:00Z</div>
                        </div>
                    </div>
                </div>

                <div class="hud-corner top-right">
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

                <div class="hud-telemetry">
                    <div class="telemetry-item">
                        <span class="tel-label">ACTIVE_AIRBORNE</span>
                        <span id="landing-stat-flights" class="tel-value">0,000</span>
                    </div>
                    <div class="telemetry-divider"></div>
                    <div class="telemetry-item">
                        <span class="tel-label">ATC_STATIONS</span>
                        <span id="landing-stat-atc" class="tel-value">00</span>
                    </div>
                    <div class="telemetry-divider"></div>
                    <div class="telemetry-item">
                        <span class="tel-label">MAP_STATUS</span>
                        <span class="tel-value status-ok">NOMINAL</span>
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
        const el = document.getElementById('sector-ops-tactical-ui');
        if (!el) return;

        if (isActive) {
            el.classList.add('active');
            if (stats.flights) document.getElementById('landing-stat-flights').textContent = stats.flights.toLocaleString();
            if (stats.atc) document.getElementById('landing-stat-atc').textContent = stats.atc.padStart(2, '0');
            if (stats.server) document.getElementById('landing-server-name').textContent = stats.server.toUpperCase();
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
            el.textContent = now.toISOString().split('T')[1].split('.')[0] + 'Z';
        };
        this._clockInterval = setInterval(update, 1000);
        update();
    },

    injectStyles() {
        const existing = document.getElementById('tactical-ui-styles');
        if (existing) existing.remove();

        const css = `
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

            .hud-corner {
                position: absolute;
                pointer-events: auto;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .top-left { top: 24px; left: 24px; }
            .top-right { top: 24px; right: 24px; align-items: flex-end; }

            /* Branding */
            .brand-container {
                display: flex;
                align-items: center;
                gap: 12px;
                background: rgba(15, 17, 23, 0.7);
                padding: 12px 20px;
                border-radius: 12px;
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }

            .brand-name { font-weight: 900; font-size: 1.2rem; letter-spacing: 1px; }
            .brand-name .highlight { color: #38bdf8; margin-left: 2px; }
            .brand-timer { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: #64748b; margin-top: 2px; }

            /* Utility Grid (Top Right) */
            .utility-grid {
                display: flex;
                gap: 8px;
                background: rgba(15, 17, 23, 0.7);
                padding: 6px;
                border-radius: 10px;
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }

            .util-btn {
                width: 40px;
                height: 40px;
                border-radius: 8px;
                border: none;
                background: transparent;
                color: #94a3b8;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
            }

            .util-btn:hover { background: rgba(255,255,255,0.05); color: #fff; }
            .highlight-btn { color: #38bdf8; }

            .server-badge {
                margin-top: 8px;
                background: rgba(15, 17, 23, 0.7);
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 0.65rem;
                font-weight: 800;
                display: flex;
                align-items: center;
                gap: 6px;
                border: 1px solid rgba(56, 189, 248, 0.2);
            }

            .status-dot { width: 6px; height: 6px; background: #38bdf8; border-radius: 50%; box-shadow: 0 0 8px #38bdf8; }

            /* Telemetry (Bottom) */
            .hud-telemetry {
                position: absolute;
                bottom: 30px;
                left: 50%;
                transform: translateX(-50%);
                pointer-events: auto;
                background: rgba(15, 17, 23, 0.85);
                backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                display: flex;
                padding: 10px 30px;
                border-radius: 100px;
                gap: 24px;
                box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
            }

            .telemetry-item { display: flex; flex-direction: column; align-items: center; }
            .tel-label { font-size: 0.6rem; font-weight: 800; color: #64748b; letter-spacing: 1px; }
            .tel-value { font-family: 'JetBrains Mono', monospace; font-size: 1rem; font-weight: 700; color: #fff; }
            .status-ok { color: #10b981; }

            .telemetry-divider { width: 1px; height: 24px; background: rgba(255,255,255,0.1); align-self: center; }

            @keyframes pulse-ring {
                0% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.4); }
                70% { box-shadow: 0 0 0 10px rgba(56, 189, 248, 0); }
                100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
            }
            .pulse-ring { animation: pulse-ring 1s ease-out; }
        `;

        const style = document.createElement('style');
        style.id = 'tactical-ui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};