/**
 * LandingUI.js
 * REDESIGN: INFLIGHT Utility Overlay
 * Features: Integrated Search Bar, Server Switching, and Utility Grid.
 */

export const LandingUI = {
    _isVisible: false,
    // Callback hooks to be set by flight.js
    onSearch: null,
    onResultClick: null,
    onServerSwitch: null,

    init(config = {}) {
        this.onSearch = config.onSearch || null;
        this.onResultClick = config.onResultClick || null;
        this.onServerSwitch = config.onServerSwitch || null;

        this.injectStyles();
        this.render();
        this.attachListeners();
        
        if (config.currentServer) {
            this.updateServerBadge(config.currentServer);
        }
    },

    render() {
        const existing = document.getElementById('inflight-tactical-ui');
        if (existing) existing.remove();

        const html = `
            <div id="inflight-tactical-ui" class="tactical-ui-root">
                <div class="hud-header">
                    <div id="sector-ops-search-container">
                        <div class="search-bar-container">
                            <input type="text" id="sector-ops-search-input" placeholder="Search radar..." autocomplete="off">
                            <button id="sector-ops-search-clear" class="search-clear-btn">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                            <div class="search-icon-label">
                                <i class="fa-solid fa-magnifying-glass"></i>
                            </div>
                        </div>
                        <div id="search-results-dropdown" class="search-results-dropdown"></div>
                    </div>

                    <div class="header-right-cluster">
                        <div id="server-selector-container">
                            <button class="server-btn" data-server="Expert Server">Expert</button>
                            <button class="server-btn" data-server="Training Server">Training</button>
                            <button class="server-btn" data-server="Casual Server">Casual</button>
                        </div>
                        
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
                        </div>

                        <div class="server-badge">
                            <span class="status-dot"></span>
                            <span id="landing-server-name">OFFLINE</span>
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
            if (stats.server) this.updateServerBadge(stats.server);
        } else {
            el.classList.remove('active');
            // Hide dropdown if UI is deactivated
            const dropdown = document.getElementById('search-results-dropdown');
            if (dropdown) dropdown.style.display = 'none';
        }
    },

    updateServerBadge(name) {
        const serverEl = document.getElementById('landing-server-name');
        if (serverEl) serverEl.textContent = name.toUpperCase();
        
        // Update active state of buttons
        document.querySelectorAll('.server-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.server === name);
        });
    },

    attachListeners() {
        const searchInput = document.getElementById('sector-ops-search-input');
        const searchClear = document.getElementById('sector-ops-search-clear');
        const dropdown = document.getElementById('search-results-dropdown');

        // Search Input Handling
        searchInput?.addEventListener('input', (e) => {
            const val = e.target.value;
            searchClear.style.display = val ? 'flex' : 'none';
            if (this.onSearch) this.onSearch(val);
        });

        searchClear?.addEventListener('click', () => {
            searchInput.value = '';
            searchClear.style.display = 'none';
            dropdown.style.display = 'none';
            if (this.onSearch) this.onSearch('');
        });

        // Event Delegation for Search Results and Server Buttons
        document.addEventListener('click', (e) => {
            // Search result click
            const resultItem = e.target.closest('.search-result-item');
            if (resultItem && this.onResultClick) {
                this.onResultClick(resultItem);
            }

            // Server button click
            const serverBtn = e.target.closest('.server-btn');
            if (serverBtn && this.onServerSwitch) {
                this.onServerSwitch(serverBtn.dataset.server);
            }
        });

        // Grid Button Actions
        document.getElementById('tile-weather')?.addEventListener('click', () => 
            document.getElementById('open-weather-settings-btn')?.click()
        );
        document.getElementById('tile-settings')?.addEventListener('click', () => 
            document.getElementById('open-filter-settings-btn')?.click()
        );
    },

    renderSearchResultsDropdown(matches) {
        const dropdown = document.getElementById('search-results-dropdown');
        const searchBar = document.querySelector('.search-bar-container');
        if (!dropdown || !searchBar) return;

        dropdown.innerHTML = '';

        if (matches.length === 0) {
            dropdown.innerHTML = `<div class="search-empty">No active flights found</div>`;
            dropdown.style.display = 'block';
            searchBar.classList.add('has-results');
            return;
        }

        dropdown.innerHTML = matches.slice(0, 15).map(feature => {
            const props = feature.properties;
            const acData = (typeof props.aircraft === 'string') ? JSON.parse(props.aircraft) : (props.aircraft || {});
            const livName = acData.liveryName || 'Generic';
            
            // Generate Logo Path (Matching flight.js logic)
            const words = livName.trim().split(/\s+/);
            let logoName = words.length > 1 && /[^a-zA-Z0-9]/.test(words[1]) ? words[0] : (words[0] + (words[1] ? ' ' + words[1] : ''));
            const sanitizedLogoName = logoName.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_');
            const logoPath = `Images/airline_logos/${sanitizedLogoName}.png`;

            const propsString = JSON.stringify(props).replace(/'/g, "&apos;").replace(/"/g, "&quot;");
            const coordsString = JSON.stringify(feature.geometry.coordinates);

            return `
                <div class="search-result-item" data-coordinates='${coordsString}' data-properties='${propsString}'>
                    <div class="search-result-img-box">
                        <img src="${logoPath}" class="search-result-logo" onerror="this.src='Images/default_plane.png'">
                    </div>
                    <div class="search-result-info">
                        <div class="search-main-text">${props.callsign}</div>
                        <div class="search-sub-text">${props.username} • ${livName}</div>
                    </div>
                    <div class="search-result-stats">
                        <div class="stat-alt">${Math.round(props.altitude || 0).toLocaleString()} ft</div>
                        <div class="stat-gs">${Math.round(props.speed || 0)} kts</div>
                    </div>
                </div>`;
        }).join('');

        dropdown.style.display = 'block';
        searchBar.classList.add('has-results');
    },

    injectStyles() {
        if (document.getElementById('landing-ui-styles')) return;
        const css = `
            .tactical-ui-root {
                position: absolute; inset: 0; z-index: 2000; pointer-events: none;
                opacity: 0; visibility: hidden; transition: all 0.4s ease;
                font-family: 'Inter', sans-serif;
            }
            .tactical-ui-root.active { opacity: 1; visibility: visible; }
            .hud-header {
                position: absolute; top: 20px; left: 20px; right: 20px;
                display: flex; justify-content: space-between; align-items: flex-start;
            }

            /* Search Bar */
            #sector-ops-search-container { pointer-events: auto; width: 300px; position: relative; }
            .search-bar-container { 
                background: rgba(24, 24, 27, 0.85); backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.1); border-radius: 22px;
                height: 44px; display: flex; align-items: center; padding: 0 15px;
                transition: all 0.3s ease;
            }
            .search-bar-container.has-results { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
            .search-bar-container input { 
                background: transparent; border: none; color: #fff; width: 100%; outline: none;
                font-size: 0.9rem; margin-right: 10px;
            }
            .search-icon-label { color: #94a3b8; font-size: 1rem; }
            .search-results-dropdown { 
                display: none; background: rgba(24, 24, 27, 0.95); backdrop-filter: blur(20px);
                border: 1px solid rgba(255,255,255,0.1); border-top: none;
                border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;
                max-height: 400px; overflow-y: auto;
            }

            /* Server Selector */
            #server-selector-container { 
                pointer-events: auto; display: flex; gap: 5px; 
                background: rgba(15, 23, 42, 0.8); padding: 4px; border-radius: 99px;
                margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.05);
            }
            .server-btn { 
                background: transparent; border: none; color: #94a3b8; 
                padding: 6px 14px; font-size: 0.75rem; font-weight: 700;
                border-radius: 99px; cursor: pointer; transition: 0.2s;
            }
            .server-btn.active { background: #38bdf8; color: #0f172a; }

            .header-right-cluster { display: flex; flex-direction: column; align-items: flex-end; }
            .utility-grid { pointer-events: auto; display: flex; gap: 8px; margin-bottom: 10px; }
            .util-btn { 
                width: 40px; height: 40px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1);
                background: rgba(24, 24, 27, 0.8); color: #fff; cursor: pointer;
            }
            .server-badge { 
                background: rgba(56, 189, 248, 0.1); padding: 5px 12px; border-radius: 20px;
                border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; font-size: 0.7rem; font-weight: 800;
                display: flex; align-items: center; gap: 8px;
            }
            .status-dot { width: 6px; height: 6px; background: #38bdf8; border-radius: 50%; box-shadow: 0 0 8px #38bdf8; }
            
            /* Result Items */
            .search-result-item { 
                display: grid; grid-template-columns: 40px 1fr auto; gap: 12px;
                padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer;
            }
            .search-result-item:hover { background: rgba(255,255,255,0.05); }
            .search-main-text { color: #fff; font-weight: 700; font-size: 0.9rem; }
            .search-sub-text { color: #94a3b8; font-size: 0.75rem; }
            .search-result-stats { text-align: right; }
            .stat-alt { color: #38bdf8; font-weight: 700; font-size: 0.8rem; }
            .stat-gs { color: #fbbf24; font-size: 0.7rem; }
        `;
        const style = document.createElement('style');
        style.id = 'landing-ui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};