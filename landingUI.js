/**
 * LandingUI.js
 * FINAL REDESIGN: Modular Floating UI (Match image_986d0c.png)
 * Removes sidebars and splash screens. Keeps the map as the primary focus.
 */

export const LandingUI = {
    _isVisible: false,

    init() {
        this.injectStyles();
        this.render();
        this.attachListeners();
    },

    render() {
        // Force cleanup of any old Sector Ops elements to prevent "stacking"
        const existing = document.getElementById('sector-ops-landing-ui');
        if (existing) existing.remove();

        const html = `
            <div id="sector-ops-landing-ui" class="landing-ui-wrapper">
                <div class="landing-top-left-stack">
                    <div class="brand-module">
                        <span class="brand-text">Sector<span>Ops</span></span>
                        <span id="landing-clock" class="brand-clock">00:00:00Z</span>
                    </div>

                    <div class="landing-module" id="tile-search">
                        <div class="module-header">
                            <span>Search Radar</span>
                            <i class="fa-solid fa-chevron-down"></i>
                        </div>
                    </div>

                    <div class="landing-module" id="tile-weather">
                        <div class="module-header">
                            <span>Weather Ops</span>
                            <i class="fa-solid fa-chevron-down"></i>
                        </div>
                    </div>

                    <div class="landing-module" id="tile-server">
                        <div class="module-header">
                            <span id="landing-server-name">Expert Server</span>
                            <i class="fa-solid fa-chevron-down"></i>
                        </div>
                    </div>

                    <div class="landing-module" id="tile-settings">
                        <div class="module-header">
                            <span>Map Settings</span>
                            <i class="fa-solid fa-chevron-down"></i>
                        </div>
                    </div>
                </div>

                <div class="landing-bottom-stats">
                    <div class="stat-pill">
                        <span class="label">Flights</span>
                        <span id="landing-stat-flights" class="value">---</span>
                    </div>
                    <div class="stat-pill">
                        <span class="label">Staffed</span>
                        <span id="landing-stat-atc" class="value">---</span>
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
        const el = document.getElementById('sector-ops-landing-ui');
        if (!el) return;

        if (isActive) {
            el.classList.add('visible');
            if (stats.flights) document.getElementById('landing-stat-flights').textContent = stats.flights;
            if (stats.atc) document.getElementById('landing-stat-atc').textContent = stats.atc;
            if (stats.server) document.getElementById('landing-server-name').textContent = stats.server;
        } else {
            el.classList.remove('visible');
        }
    },

    attachListeners() {
        document.getElementById('tile-search')?.addEventListener('click', () => {
            document.querySelector('.search-bar-container input')?.focus();
        });

        document.getElementById('tile-weather')?.addEventListener('click', () => {
            document.getElementById('open-weather-settings-btn')?.click();
        });

        document.getElementById('tile-settings')?.addEventListener('click', () => {
            document.getElementById('open-filter-settings-btn')?.click();
        });

        document.getElementById('tile-server')?.addEventListener('click', () => {
            const expertBtn = document.querySelector('.server-btn[data-server="Expert Server"]');
            expertBtn?.classList.add('pulse-highlight');
            setTimeout(() => expertBtn?.classList.remove('pulse-highlight'), 2000);
        });
    },

    startClock() {
        const updateClock = () => {
            const clockEl = document.getElementById('landing-clock');
            if (!clockEl) return;
            const now = new Date();
            clockEl.textContent = now.toISOString().split('T')[1].split('.')[0] + 'Z';
        };
        setInterval(updateClock, 1000);
        updateClock();
    },

    injectStyles() {
        // Remove existing styles if they exist
        const oldStyle = document.getElementById('landing-ui-styles');
        if (oldStyle) oldStyle.remove();

        const css = `
            .landing-ui-wrapper {
                position: absolute;
                inset: 0;
                z-index: 1500;
                pointer-events: none; /* Crucial: Allows map interaction through the wrapper */
                opacity: 0;
                transition: opacity 0.3s ease;
            }

            .landing-ui-wrapper.visible {
                opacity: 1;
            }

            /* Stacked modules (Top Left) */
            .landing-top-left-stack {
                position: absolute;
                top: 15px;
                left: 15px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                pointer-events: auto;
            }

            /* Small Branding Box */
            .brand-module {
                padding: 10px 16px;
                background: rgba(30, 30, 35, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                min-width: 240px;
                margin-bottom: 4px;
            }

            .brand-text { font-weight: 800; font-size: 1.1rem; color: #fff; letter-spacing: -0.5px; }
            .brand-text span { color: #38bdf8; }
            .brand-clock { font-family: monospace; font-size: 0.85rem; color: #94a3b8; }

            /* Module Design (Matches Explore/Weather style) */
            .landing-module {
                background: rgba(45, 45, 50, 0.85);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 6px;
                width: 240px;
                cursor: pointer;
                transition: background 0.2s;
            }

            .landing-module:hover {
                background: rgba(60, 60, 65, 0.95);
                border-color: rgba(255, 255, 255, 0.2);
            }

            .module-header {
                padding: 12px 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                color: #e2e8f0;
                font-size: 0.9rem;
                font-weight: 500;
            }

            .module-header i { font-size: 0.7rem; opacity: 0.5; }

            /* Bottom-Left Stats */
            .landing-bottom-stats {
                position: absolute;
                bottom: 15px;
                left: 15px;
                display: flex;
                gap: 8px;
                pointer-events: auto;
            }

            .stat-pill {
                background: rgba(15, 15, 20, 0.8);
                border: 1px solid rgba(255,255,255,0.1);
                padding: 6px 14px;
                border-radius: 4px;
                display: flex;
                gap: 10px;
                align-items: center;
            }

            .stat-pill .label { font-size: 0.65rem; text-transform: uppercase; color: #64748b; font-weight: 700; }
            .stat-pill .value { font-family: monospace; font-size: 0.9rem; color: #38bdf8; font-weight: 700; }

            @keyframes pulse-blue {
                0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
                70% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
                100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
            }
            .pulse-highlight { animation: pulse-blue 1s infinite; }
        `;

        const style = document.createElement('style');
        style.id = 'landing-ui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};