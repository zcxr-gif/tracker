/**
 * Inflight UI
 * Modular Floating Dashboard for Flight Tracking
 */

export const LandingUI = {
    _isVisible: false,
    _expandedModule: null,

    init() {
        this.injectStyles();
        this.render();
        this.attachListeners();
    },

    render() {
        // Force cleanup of any old elements
        const existing = document.getElementById('inflight-landing-ui');
        if (existing) existing.remove();

        const html = `
            <div id="inflight-landing-ui" class="landing-ui-wrapper">
                <div class="landing-top-left-stack">
                    <div class="brand-module">
                        <span class="brand-text">In<span>flight</span></span>
                        <span id="landing-clock" class="brand-clock">00:00:00Z</span>
                    </div>

                    <div class="landing-module" id="tile-search" data-module="search">
                        <div class="module-header">
                            <div class="header-main">
                                <i class="fa-solid fa-magnifying-glass"></i>
                                <span>Search Radar</span>
                            </div>
                            <i class="fa-solid fa-chevron-down caret"></i>
                        </div>
                        <div class="module-content">
                            <input type="text" id="inflight-search-input" placeholder="Search flight, callsign, or airport..." />
                        </div>
                    </div>

                    <div class="landing-module" id="tile-weather" data-module="weather">
                        <div class="module-header">
                            <div class="header-main">
                                <i class="fa-solid fa-cloud-sun"></i>
                                <span>Weather Ops</span>
                            </div>
                            <i class="fa-solid fa-chevron-down caret"></i>
                        </div>
                        <div class="module-content">
                            <div class="control-row">
                                <label>Show METARs</label>
                                <input type="checkbox" class="inflight-switch" id="toggle-metar" checked>
                            </div>
                            <div class="control-row">
                                <label>Wind Vectors</label>
                                <input type="checkbox" class="inflight-switch" id="toggle-wind">
                            </div>
                            <div class="control-row">
                                <label>Precipitation</label>
                                <input type="checkbox" class="inflight-switch" id="toggle-precip">
                            </div>
                        </div>
                    </div>

                    <div class="landing-module" id="tile-server" data-module="server">
                        <div class="module-header">
                            <div class="header-main">
                                <i class="fa-solid fa-server"></i>
                                <span id="landing-server-name">Expert Server</span>
                            </div>
                            <i class="fa-solid fa-chevron-down caret"></i>
                        </div>
                        <div class="module-content">
                            <div class="server-list">
                                <div class="server-opt active" data-val="Expert Server">Expert Server</div>
                                <div class="server-opt" data-val="Training Server">Training Server</div>
                                <div class="server-opt" data-val="Casual Server">Casual Server</div>
                            </div>
                        </div>
                    </div>

                    <div class="landing-module" id="tile-settings" data-module="map">
                        <div class="module-header">
                            <div class="header-main">
                                <i class="fa-solid fa-layer-group"></i>
                                <span>Map Settings</span>
                            </div>
                            <i class="fa-solid fa-chevron-down caret"></i>
                        </div>
                        <div class="module-content">
                            <div class="control-row">
                                <label>Night Mode</label>
                                <input type="checkbox" class="inflight-switch" id="toggle-night">
                            </div>
                            <div class="control-row">
                                <label>High Detail</label>
                                <input type="checkbox" class="inflight-switch" id="toggle-detail" checked>
                            </div>
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
        const el = document.getElementById('inflight-landing-ui');
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
        // Toggle Module Expansion
        const modules = document.querySelectorAll('.landing-module');
        modules.forEach(mod => {
            const header = mod.querySelector('.module-header');
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const modId = mod.getAttribute('data-module');
                
                if (this._expandedModule === modId) {
                    mod.classList.remove('expanded');
                    this._expandedModule = null;
                } else {
                    modules.forEach(m => m.classList.remove('expanded'));
                    mod.classList.add('expanded');
                    this._expandedModule = modId;
                    
                    // Auto-focus search if opened
                    if (modId === 'search') {
                        setTimeout(() => document.getElementById('inflight-search-input')?.focus(), 100);
                    }
                }
            });
        });

        // Server Selection logic
        const serverOpts = document.querySelectorAll('.server-opt');
        serverOpts.forEach(opt => {
            opt.addEventListener('click', (e) => {
                const val = opt.getAttribute('data-val');
                document.getElementById('landing-server-name').textContent = val;
                serverOpts.forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                // Potential callback for server change
                console.log(`Server changed to: ${val}`);
            });
        });

        // Prevent click-through on content interaction
        const contentAreas = document.querySelectorAll('.module-content');
        contentAreas.forEach(area => {
            area.addEventListener('click', (e) => e.stopPropagation());
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
        const oldStyle = document.getElementById('inflight-ui-styles');
        if (oldStyle) oldStyle.remove();

        const css = `
            .landing-ui-wrapper {
                position: absolute;
                inset: 0;
                z-index: 1500;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.3s ease;
                font-family: 'Inter', sans-serif;
            }

            .landing-ui-wrapper.visible { opacity: 1; }

            .landing-top-left-stack {
                position: absolute;
                top: 20px;
                left: 20px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: auto;
            }

            /* Brand Style */
            .brand-module {
                padding: 12px 18px;
                background: rgba(15, 15, 20, 0.95);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 280px;
                margin-bottom: 5px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            }

            .brand-text { font-weight: 900; font-size: 1.2rem; color: #fff; letter-spacing: -0.8px; }
            .brand-text span { color: #38bdf8; }
            .brand-clock { font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: #94a3b8; }

            /* Module Design */
            .landing-module {
                background: rgba(25, 25, 30, 0.8);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 10px;
                width: 280px;
                overflow: hidden;
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            }

            .landing-module:hover {
                background: rgba(35, 35, 40, 0.9);
                border-color: rgba(56, 189, 248, 0.3);
            }

            .module-header {
                padding: 14px 18px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: pointer;
                color: #f1f5f9;
            }

            .header-main { display: flex; align-items: center; gap: 12px; font-size: 0.9rem; font-weight: 600; }
            .header-main i { color: #38bdf8; width: 16px; text-align: center; }

            .caret { font-size: 0.75rem; transition: transform 0.3s ease; opacity: 0.4; }
            .landing-module.expanded .caret { transform: rotate(180deg); opacity: 1; }

            /* Content Sections */
            .module-content {
                max-height: 0;
                padding: 0 18px;
                opacity: 0;
                transition: all 0.3s ease;
                border-top: 1px solid transparent;
            }

            .landing-module.expanded .module-content {
                max-height: 300px;
                padding: 15px 18px;
                opacity: 1;
                border-top: 1px solid rgba(255, 255, 255, 0.05);
            }

            /* Inputs & Toggles */
            #inflight-search-input {
                width: 100%;
                background: rgba(0,0,0,0.3);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 6px;
                padding: 8px 12px;
                color: white;
                font-size: 0.85rem;
                outline: none;
            }

            .control-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
                font-size: 0.85rem;
                color: #94a3b8;
            }

            .inflight-switch {
                appearance: none;
                width: 32px;
                height: 18px;
                background: #334155;
                border-radius: 20px;
                position: relative;
                cursor: pointer;
                transition: 0.3s;
            }

            .inflight-switch:checked { background: #38bdf8; }
            .inflight-switch::before {
                content: '';
                position: absolute;
                width: 14px;
                height: 14px;
                background: white;
                border-radius: 50%;
                top: 2px;
                left: 2px;
                transition: 0.3s;
            }
            .inflight-switch:checked::before { left: 16px; }

            /* Server Options */
            .server-list { display: flex; flex-direction: column; gap: 4px; }
            .server-opt {
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 0.8rem;
                cursor: pointer;
                color: #94a3b8;
                transition: 0.2s;
            }
            .server-opt:hover { background: rgba(255,255,255,0.05); color: white; }
            .server-opt.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600; }

            /* Stats */
            .landing-bottom-stats {
                position: absolute;
                bottom: 25px;
                left: 25px;
                display: flex;
                gap: 12px;
                pointer-events: auto;
            }

            .stat-pill {
                background: rgba(15, 15, 20, 0.9);
                border: 1px solid rgba(255,255,255,0.1);
                padding: 8px 16px;
                border-radius: 8px;
                display: flex;
                flex-direction: column;
                min-width: 80px;
            }

            .stat-pill .label { font-size: 0.6rem; text-transform: uppercase; color: #64748b; font-weight: 800; letter-spacing: 0.5px; }
            .stat-pill .value { font-family: 'JetBrains Mono', monospace; font-size: 1rem; color: #38bdf8; font-weight: 700; margin-top: 2px; }
        `;

        const style = document.createElement('style');
        style.id = 'inflight-ui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};