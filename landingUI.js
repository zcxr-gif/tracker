/**
 * LandingUI.js
 * REDESIGN: INFLIGHT Utility Overlay with Integrated Search
 * Features: Right-aligned utility cluster, Integrated Radar Search, auto-hide on mobile.
 */

export const LandingUI = {
    _isVisible: false,
    _map: null,
    _getFeatures: null,
    _onFlightSelect: null,

    init(options = {}) {
        this._map = options.map;
        this._getFeatures = options.getFeatures;
        this._onFlightSelect = options.onFlightSelect;

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
                        
                        <div id="sector-ops-search-container">
                            <div class="search-bar-container">
                                <input type="text" id="sector-ops-search-input" placeholder="Search Radar..." autocomplete="off">
                                <div class="search-icon-label">
                                    <i class="fa-solid fa-magnifying-glass"></i>
                                </div>
                                <button class="search-clear-btn" id="search-clear-btn">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                            <div id="search-results-dropdown" class="search-results-dropdown"></div>
                        </div>

                        <div class="utility-grid">
                            <button class="util-btn" id="tile-search" title="Focus Search">
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
            // Close search when UI is hidden
            const dropdown = document.getElementById('search-results-dropdown');
            if (dropdown) dropdown.style.display = 'none';
        }
    },

    attachListeners() {
        // Tile Actions
        const actions = {
            'tile-search': () => document.getElementById('sector-ops-search-input')?.focus(),
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

        // Search Input Logic
        const searchInput = document.getElementById('sector-ops-search-input');
        const clearBtn = document.getElementById('search-clear-btn');

        searchInput?.addEventListener('input', (e) => this.handleSearchInput(e.target.value));
        
        clearBtn?.addEventListener('click', () => {
            if (searchInput) {
                searchInput.value = '';
                this.handleSearchInput('');
                searchInput.focus();
            }
        });

        // Search Results Delegation
        const dropdown = document.getElementById('search-results-dropdown');
        dropdown?.addEventListener('click', (e) => {
            const item = e.target.closest('.search-result-item');
            if (item) this.onSearchResultClick(item);
        });
    },

    handleSearchInput(searchText) {
        const dropdown = document.getElementById('search-results-dropdown');
        const clearBtn = document.getElementById('search-clear-btn');
        const searchContainer = document.querySelector('.search-bar-container');
        
        if (!dropdown || !clearBtn) return;

        if (!searchText || searchText.length < 2) {
            dropdown.innerHTML = '';
            dropdown.style.display = 'none';
            clearBtn.style.display = 'none';
            searchContainer?.classList.remove('has-results');
            return;
        }

        clearBtn.style.display = 'flex';
        const upperSearchText = searchText.toUpperCase();
        const matches = [];
        const features = this._getFeatures ? this._getFeatures() : {};

        for (const flightId in features) {
            const feature = features[flightId];
            if (!feature || !feature.properties) continue;
            const props = feature.properties;
            
            const callsign = (props.callsign || '').toUpperCase();
            const username = (props.username || '').toUpperCase();
            
            let acName = '';
            let livName = '';
            if (props.aircraft) {
                const acObj = (typeof props.aircraft === 'string') ? JSON.parse(props.aircraft) : props.aircraft;
                acName = (acObj.aircraftName || '').toUpperCase();
                livName = (acObj.liveryName || '').toUpperCase();
            }

            const altStr = props.altitude ? Math.round(props.altitude).toString() : '';

            if (callsign.includes(upperSearchText) ||
                username.includes(upperSearchText) ||
                acName.includes(upperSearchText) ||
                livName.includes(upperSearchText) ||
                altStr.startsWith(upperSearchText)) {
                matches.push(feature);
            }
        }
        
        matches.sort((a, b) => {
            const aCall = (a.properties.callsign || '').toUpperCase();
            const bCall = (b.properties.callsign || '').toUpperCase();
            return (aCall === upperSearchText) ? -1 : (bCall === upperSearchText) ? 1 : 0;
        });

        this.renderSearchResultsDropdown(matches);
    },

    renderSearchResultsDropdown(matches) {
        const dropdown = document.getElementById('search-results-dropdown');
        const searchContainer = document.querySelector('.search-bar-container');
        
        if (!dropdown || !searchContainer) return;
        dropdown.innerHTML = '';

        if (matches.length === 0) {
            dropdown.innerHTML = `
                <div style="padding: 24px 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #94a3b8; opacity: 0.8;">
                    <i class="fa-solid fa-plane-slash" style="font-size: 1.2rem;"></i>
                    <span style="font-size: 0.85rem; font-weight: 500;">No active flights found</span>
                </div>
            `;
            dropdown.style.display = 'block';
            searchContainer.classList.add('has-results');
            return;
        }

        dropdown.innerHTML = matches.slice(0, 15).map(feature => {
            const props = feature.properties;
            const acData = (typeof props.aircraft === 'string') ? JSON.parse(props.aircraft) : (props.aircraft || {});
            const livName = acData.liveryName || 'Generic';
            const altDisplay = props.altitude ? Math.round(props.altitude).toLocaleString() : '0';
            const gsDisplay = props.speed ? Math.round(props.speed) : '0';
            
            let shortType = (acData.aircraftName || 'AC').split(' ')[0].substring(0,4).toUpperCase();
            const words = livName.trim().split(/\s+/);
            let logoName = words.length > 1 && /[^a-zA-Z0-9]/.test(words[1]) ? words[0] : (words[0] + (words[1] ? ' ' + words[1] : ''));
            const sanitizedLogoName = logoName.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_');
            const logoPath = `Images/airline_logos/${sanitizedLogoName}.png`;

            return `
            <div class="search-result-item" 
                 data-coordinates='${JSON.stringify(feature.geometry.coordinates)}'
                 data-properties='${JSON.stringify(props).replace(/'/g, "&apos;")}'>
                <div class="search-result-img-box">
                    <img src="${logoPath}" class="search-result-logo" onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\'fa-solid fa-plane\' style=\'color:#52525b;\'></i>'">
                </div>
                <div class="search-result-info">
                    <div class="search-main-text">
                        <span class="callsign-text">${props.callsign}</span>
                        <span class="search-badge-ac">${shortType}</span>
                    </div>
                    <div class="search-sub-text">${username} • ${livName}</div>
                </div>
                <div class="search-result-stats">
                    <div class="stat-row"><span class="stat-val alt">${altDisplay}</span> <span class="stat-unit">ft</span></div>
                    <div class="stat-row"><span class="stat-val gs">${gsDisplay}</span> <span class="stat-unit">kts</span></div>
                </div>
            </div>`;
        }).join('');
        
        dropdown.style.display = 'block';
        searchContainer.classList.add('has-results');
    },

    onSearchResultClick(itemElement) {
        let coordinates, props;
        try {
            coordinates = JSON.parse(itemElement.dataset.coordinates);
            props = JSON.parse(itemElement.dataset.properties);
        } catch (e) { return; }

        const dropdown = document.getElementById('search-results-dropdown');
        const searchInput = document.getElementById('sector-ops-search-input');
        const clearBtn = document.getElementById('search-clear-btn');
        const searchContainer = document.querySelector('.search-bar-container');
        
        if (dropdown) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; }
        if (searchInput) { searchInput.value = ''; searchInput.blur(); }
        if (clearBtn) clearBtn.style.display = 'none';
        searchContainer?.classList.remove('has-results');
        
        if (this._map) {
            this._map.flyTo({ center: coordinates, zoom: 9, essential: true });
        }

        if (this._onFlightSelect) {
            const flightProps = {
                ...props,
                position: props.position ? JSON.parse(props.position) : null,
                aircraft: props.aircraft ? JSON.parse(props.aircraft) : null
            };
            this._onFlightSelect(flightProps);
        }
    },

    injectStyles() {
        const existing = document.getElementById('inflight-ui-styles');
        if (existing) existing.remove();

        const css = `
            @media (max-width: 768px) { .tactical-ui-root { display: none !important; } }
            
            .tactical-ui-root {
                position: absolute; inset: 0; z-index: 2000; pointer-events: none;
                opacity: 0; visibility: hidden; transition: all 0.6s cubic-bezier(0.22, 1, 0.36, 1);
                font-family: 'Inter', sans-serif; color: #fff;
            }
            .tactical-ui-root.active { opacity: 1; visibility: visible; }
            
            .hud-header { position: absolute; top: 24px; right: 24px; display: flex; flex-direction: column; align-items: flex-end; }
            .header-right-cluster { display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }

            /* Integrated Search Bar Styles */
            #sector-ops-search-container { position: relative; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; }
            .search-bar-container {
                pointer-events: auto; position: relative; display: flex; align-items: center;
                height: 44px; width: 44px; background: rgba(24, 24, 27, 0.85);
                border: 1px solid rgba(255,255,255,0.1); border-radius: 22px;
                backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
                box-shadow: 0 4px 20px rgba(0,0,0,0.4);
                transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1), border-radius 0.2s ease;
                overflow: hidden;
            }
            .search-bar-container:hover, .search-bar-container:focus-within, .search-bar-container.has-results { width: 300px; }
            .search-bar-container.has-results { border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom-color: transparent; }

            .search-icon-label {
                position: absolute; right: 0; top: 0; width: 44px; height: 100%;
                display: flex; align-items: center; justify-content: center;
                color: rgba(255,255,255,0.5); font-size: 1.1rem; z-index: 10; cursor: pointer;
            }
            .search-bar-container:hover .search-icon-label { color: #fff; }

            .search-bar-container input {
                position: absolute; top: 0; left: 0; width: 300px; height: 100%;
                z-index: 20; box-sizing: border-box; padding-left: 20px; padding-right: 44px;
                background: transparent; border: none; outline: none; color: #fff;
                font-family: inherit; font-size: 0.9rem; font-weight: 500;
            }
            .search-bar-container input::placeholder { color: rgba(255,255,255,0.4); }

            .search-clear-btn {
                position: absolute; right: 40px; top: 50%; transform: translateY(-50%);
                width: 20px; height: 20px; background: rgba(255,255,255,0.1);
                border-radius: 50%; border: none; color: #fff; display: none;
                align-items: center; justify-content: center; font-size: 0.6rem; cursor: pointer; z-index: 30;
            }

            .search-results-dropdown {
                display: none; width: 300px; background: rgba(24, 24, 27, 0.95);
                backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); border-top: none;
                border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;
                max-height: 400px; overflow-y: auto; pointer-events: auto;
            }

            .search-result-item {
                display: grid; grid-template-columns: 40px 1fr auto; gap: 12px;
                padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.05);
                cursor: pointer; transition: background 0.15s ease; align-items: center;
            }
            .search-result-item:hover { background: rgba(255,255,255,0.05); }

            .search-result-logo { width: 30px; height: auto; object-fit: contain; }
            .search-main-text { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 0.95rem; }
            .search-sub-text { font-size: 0.75rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .search-result-stats { display: flex; flex-direction: column; align-items: flex-end; }
            .stat-val.alt { color: #38bdf8; font-weight: 700; }
            .stat-val.gs { color: #fbbf24; font-size: 0.8rem; }
            .stat-unit { font-size: 0.6rem; opacity: 0.5; }

            /* Utility Grid & Buttons */
            .utility-grid { display: flex; gap: 8px; pointer-events: auto; }
            .util-btn {
                width: 44px; height: 44px; background: rgba(24, 24, 27, 0.8);
                border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
                color: rgba(255,255,255,0.6); display: flex; align-items: center;
                justify-content: center; cursor: pointer; transition: all 0.3s ease;
                backdrop-filter: blur(10px);
            }
            .util-btn:hover { background: rgba(255,255,255,0.05); color: #38bdf8; transform: translateY(-1px); }
            .highlight-btn { color: #38bdf8; }
            .server-badge {
                background: rgba(56, 189, 248, 0.1); padding: 5px 14px; border-radius: 100px;
                font-size: 0.65rem; font-weight: 800; display: flex; align-items: center;
                gap: 8px; border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8;
            }
            .status-dot { width: 6px; height: 6px; background: #38bdf8; border-radius: 50%; box-shadow: 0 0 10px #38bdf8; }
        `;

        const style = document.createElement('style');
        style.id = 'inflight-ui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};