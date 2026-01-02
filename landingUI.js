/**
 * LandingUI.js
 * Manages the unified "Launchpad" interface shown when the map is idle.
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
                <div class="landing-ui-content">
                    <div class="landing-header">
                        <div class="landing-title">
                            <h1>Sector<span>Ops</span></h1>
                            <p>Global Flight Intelligence & Radar</p>
                        </div>
                        <div id="landing-clock" class="landing-clock">00:00:00Z</div>
                    </div>

                    <div class="landing-grid">
                        <div class="landing-tile tile-search" id="tile-search">
                            <div class="tile-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
                            <div class="tile-info">
                                <h3>Search Radar</h3>
                                <p>Find callsigns, pilots, or aircraft</p>
                            </div>
                        </div>

                        <div class="landing-tile" id="tile-weather">
                            <div class="tile-icon"><i class="fa-solid fa-cloud-sun"></i></div>
                            <div class="tile-info">
                                <h3>Weather Ops</h3>
                                <p>Radar, SIGMETs & Conditions</p>
                            </div>
                        </div>

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
                                <p>Filters & Style Configuration</p>
                            </div>
                        </div>
                    </div>

                    <div class="landing-footer">
                        <div class="footer-stat">
                            <span class="stat-label">Active Flights</span>
                            <span id="landing-stat-flights" class="stat-value">---</span>
                        </div>
                        <div class="footer-stat">
                            <span class="stat-label">Staffed Hubs</span>
                            <span id="landing-stat-atc" class="stat-value">---</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('sector-ops-map-fullscreen').insertAdjacentHTML('beforeend', html);
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
        document.getElementById('tile-search').addEventListener('click', () => {
            const searchBar = document.querySelector('.search-bar-container');
            if (searchBar) {
                // Expand the existing search bar and focus it
                searchBar.querySelector('input').focus();
            }
        });

        document.getElementById('tile-weather').addEventListener('click', () => {
            document.getElementById('open-weather-settings-btn')?.click();
        });

        document.getElementById('tile-settings').addEventListener('click', () => {
            document.getElementById('open-filter-settings-btn')?.click();
        });

        document.getElementById('tile-server').addEventListener('click', () => {
            // Cycle servers or open a menu? For now, trigger the Expert button as a focus
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
                display: flex;
                align-items: center;
                justify-content: center;
                background: radial-gradient(circle at center, rgba(15, 23, 42, 0.4) 0%, rgba(10, 12, 16, 0.8) 100%);
                z-index: 1500;
                opacity: 0;
                pointer-events: none;
                transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
                backdrop-filter: blur(0px);
            }

            .landing-ui-wrapper.visible {
                opacity: 1;
                pointer-events: auto;
                backdrop-filter: blur(12px);
            }

            .landing-ui-content {
                width: 100%;
                max-width: 700px;
                padding: 40px;
                transform: translateY(20px);
                transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
            }

            .landing-ui-wrapper.visible .landing-ui-content {
                transform: translateY(0);
            }

            .landing-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-end;
                margin-bottom: 40px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                padding-bottom: 20px;
            }

            .landing-title h1 {
                font-size: 2.5rem;
                font-weight: 800;
                margin: 0;
                letter-spacing: -1px;
                color: #fff;
            }

            .landing-title h1 span { color: var(--color-brand); }
            .landing-title p { color: #94a3b8; margin: 5px 0 0; font-size: 1rem; }

            .landing-clock {
                font-family: var(--font-data);
                font-size: 1.5rem;
                color: #fff;
                font-weight: 500;
                opacity: 0.8;
            }

            .landing-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 20px;
            }

            .landing-tile {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: var(--radius-lg);
                padding: 24px;
                display: flex;
                align-items: center;
                gap: 20px;
                cursor: pointer;
                transition: all 0.3s ease;
            }

            .landing-tile:hover {
                background: rgba(255, 255, 255, 0.07);
                border-color: var(--color-brand);
                transform: translateY(-4px);
                box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            }

            .tile-icon {
                width: 50px;
                height: 50px;
                background: rgba(56, 189, 248, 0.1);
                border-radius: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.5rem;
                color: var(--color-brand);
            }

            .tile-info h3 { margin: 0; font-size: 1.1rem; color: #fff; }
            .tile-info p { margin: 4px 0 0; font-size: 0.85rem; color: #94a3b8; }

            .landing-footer {
                margin-top: 40px;
                display: flex;
                gap: 40px;
            }

            .footer-stat { display: flex; flex-direction: column; gap: 4px; }
            .stat-label { font-size: 0.75rem; text-transform: uppercase; color: #64748b; font-weight: 700; letter-spacing: 1px; }
            .stat-value { font-family: var(--font-data); font-size: 1.5rem; color: #fff; font-weight: 700; }

            /* Highlight pulse for server button */
            @keyframes pulse-blue {
                0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
                70% { box-shadow: 0 0 0 15px rgba(59, 130, 246, 0); }
                100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
            }
            .pulse-highlight { animation: pulse-blue 1s infinite !important; }

            @media (max-width: 600px) {
                .landing-grid { grid-template-columns: 1fr; }
                .landing-header { flex-direction: column; align-items: flex-start; gap: 10px; }
            }
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }
};