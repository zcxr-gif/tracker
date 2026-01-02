/**
 * LandingUI.js
 * Manages the unified "Launchpad" interface shown when the map is idle.
 * Redesigned for a professional flight tracker look (Sidebar/Widget Layout).
 */

export const LandingUI = {
    _isVisible: false,

    init() {
        this.injectStyles();
        this.render();
        this.attachListeners();
    },

    render() {
        const existing = document.getElementById('sector-ops-landing-ui');
        if (existing) existing.remove();

        const html = `
            <div id="sector-ops-landing-ui" class="landing-ui-wrapper">
                <aside class="landing-sidebar">
                    <div class="sidebar-header">
                        <div class="landing-title">
                            <h1>Sector<span>Ops</span></h1>
                            <div id="landing-clock" class="landing-clock">00:00:00Z</div>
                        </div>
                    </div>

                    <div class="sidebar-scroll-content">
                        <div class="menu-section">
                            <span class="section-label">Operations</span>
                            <div class="landing-tile" id="tile-search">
                                <div class="tile-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
                                <div class="tile-info">
                                    <h3>Search Radar</h3>
                                    <p>Find callsigns & aircraft</p>
                                </div>
                            </div>

                            <div class="landing-tile" id="tile-weather">
                                <div class="tile-icon"><i class="fa-solid fa-cloud-sun"></i></div>
                                <div class="tile-info">
                                    <h3>Weather Ops</h3>
                                    <p>Radar & Conditions</p>
                                </div>
                            </div>
                        </div>

                        <div class="menu-section">
                            <span class="section-label">Configuration</span>
                            <div class="landing-tile" id="tile-server">
                                <div class="tile-icon"><i class="fa-solid fa-server"></i></div>
                                <div class="tile-info">
                                    <h3>Server Space</h3>
                                    <p id="landing-server-name">Expert Server</p>
                                </div>
                            </div>

                            <div class="landing-tile" id="tile-settings">
                                <div class="tile-icon"><i class="fa-solid fa-sliders"></i></div>
                                <div class="tile-info">
                                    <h3>Map Settings</h3>
                                    <p>Filters & Styles</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>

                <div class="landing-stats-bar">
                    <div class="footer-stat">
                        <span class="stat-label">Active Flights</span>
                        <span id="landing-stat-flights" class="stat-value">---</span>
                    </div>
                    <div class="footer-divider"></div>
                    <div class="footer-stat">
                        <span class="stat-label">Staffed Hubs</span>
                        <span id="landing-stat-atc" class="stat-value">---</span>
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
            const searchBar = document.querySelector('.search-bar-container input');
            searchBar?.focus();
        });

        document.getElementById('tile-weather')?.addEventListener('click', () => {
            document.getElementById('open-weather-settings-btn')?.click();
        });

        document.getElementById('tile-settings')?.addEventListener('click', () => {
            document.getElementById('open-filter-settings-btn')?.click();
        });

        document.getElementById('tile-server')?.addEventListener('click', () => {
            const expertBtn = document.querySelector('.server-btn[data-server="Expert Server"]');
            expertBtn?.scrollIntoView({ behavior: 'smooth' });
            expertBtn?.classList.add('pulse-highlight');
            setTimeout(() => expertBtn?.classList.remove('pulse-highlight'), 2000);
        });
    },

    startClock() {
        const updateClock = () => {
            const clockEl = document.getElementById('landing-clock');
            if (!clockEl) return;
            const now = new Date();
            const time = now.toISOString().split('T')[1].split('.')[0] + 'Z';
            clockEl.textContent = time;
        };
        setInterval(updateClock, 1000);
        updateClock();
    },

    injectStyles() {
        const css = `
            .landing-ui-wrapper {
                position: absolute;
                inset: 0;
                z-index: 1500;
                pointer-events: none; /* Allows interacting with map when UI is thin */
                opacity: 0;
                transition: opacity 0.4s ease;
            }

            .landing-ui-wrapper.visible {
                opacity: 1;
            }

            /* Sidebar Design */
            .landing-sidebar {
                position: absolute;
                top: 20px;
                left: 20px;
                bottom: 80px;
                width: 320px;
                background: rgba(15, 23, 42, 0.8);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                display: flex;
                flex-direction: column;
                pointer-events: auto;
                transform: translateX(-20px);
                transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 20px 50px rgba(0,0,0,0.5);
                overflow: hidden;
            }

            .landing-ui-wrapper.visible .landing-sidebar {
                transform: translateX(0);
            }

            .sidebar-header {
                padding: 24px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                background: linear-gradient(to bottom, rgba(255,255,255,0.02), transparent);
            }

            .landing-title h1 {
                font-size: 1.8rem;
                font-weight: 800;
                margin: 0;
                color: #fff;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .landing-title h1 span { color: #38bdf8; }

            .landing-clock {
                font-family: monospace;
                font-size: 0.9rem;
                color: #94a3b8;
                font-weight: 500;
                letter-spacing: 1px;
            }

            .sidebar-scroll-content {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
            }

            .menu-section {
                margin-bottom: 24px;
            }

            .section-label {
                display: block;
                font-size: 0.7rem;
                text-transform: uppercase;
                color: #64748b;
                font-weight: 700;
                letter-spacing: 1.5px;
                margin-bottom: 12px;
                margin-left: 4px;
            }

            /* Tile Redesign (List Style) */
            .landing-tile {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 12px;
                padding: 14px 16px;
                display: flex;
                align-items: center;
                gap: 16px;
                cursor: pointer;
                transition: all 0.2s ease;
                margin-bottom: 8px;
            }

            .landing-tile:hover {
                background: rgba(255, 255, 255, 0.08);
                border-color: #38bdf8;
                transform: translateX(4px);
            }

            .tile-icon {
                width: 38px;
                height: 38px;
                background: rgba(56, 189, 248, 0.1);
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.1rem;
                color: #38bdf8;
                flex-shrink: 0;
            }

            .tile-info h3 { margin: 0; font-size: 0.95rem; color: #fff; }
            .tile-info p { margin: 2px 0 0; font-size: 0.75rem; color: #94a3b8; }

            /* Stats Bar Design */
            .landing-stats-bar {
                position: absolute;
                bottom: 20px;
                left: 20px;
                background: rgba(15, 23, 42, 0.9);
                backdrop-filter: blur(8px);
                padding: 12px 24px;
                border-radius: 100px;
                border: 1px solid rgba(255,255,255,0.1);
                display: flex;
                align-items: center;
                gap: 20px;
                pointer-events: auto;
                transform: translateY(20px);
                transition: transform 0.5s ease;
            }

            .landing-ui-wrapper.visible .landing-stats-bar {
                transform: translateY(0);
            }

            .footer-stat { display: flex; flex-direction: column; }
            .stat-label { font-size: 0.65rem; text-transform: uppercase; color: #64748b; font-weight: 700; }
            .stat-value { font-family: monospace; font-size: 1.1rem; color: #fff; font-weight: 700; }

            .footer-divider {
                width: 1px;
                height: 24px;
                background: rgba(255,255,255,0.1);
            }

            /* Animations */
            @keyframes pulse-blue {
                0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
                70% { box-shadow: 0 0 0 15px rgba(59, 130, 246, 0); }
                100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
            }
            .pulse-highlight { animation: pulse-blue 1s infinite !important; }

            @media (max-width: 600px) {
                .landing-sidebar { width: calc(100% - 40px); bottom: auto; height: auto; }
                .landing-stats-bar { left: 50%; transform: translateX(-50%) translateY(20px); }
                .landing-ui-wrapper.visible .landing-stats-bar { transform: translateX(-50%) translateY(0); }
            }
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }
};