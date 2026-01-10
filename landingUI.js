/**
 * LandingUI.js
 * REDESIGN: Spatial Minimalist - Detached Search & Filter Nexus
 * Replaced Search Island with "Glass Blade" and moved Filters to "Utility Nexus"
 */

export const LandingUI = {
    _isVisible: false,
    _filterNexusOpen: false,
    _activeFilters: {}, 

    filterOptions: [
        { id: 'type', label: 'Aircraft', icon: 'fa-plane' },
        { id: 'airline', label: 'Operator', icon: 'fa-building' },
        { id: 'callsign', label: 'Callsign', icon: 'fa-id-badge' },
        { id: 'rank', label: 'Rank', icon: 'fa-star' },
        { id: 'altitude', label: 'Altitude', icon: 'fa-arrows-up-down' },
        { id: 'speed', label: 'Speed', icon: 'fa-gauge-high' },
        { id: 'origin', label: 'Origin', icon: 'fa-plane-departure' },
        { id: 'destination', label: 'Destination', icon: 'fa-plane-arrival' },
        { id: 'atc', label: 'ATC', icon: 'fa-headset' },
        { id: 'groups', label: 'Groups', icon: 'fa-users-rays' } // Added Group Flight option
    ],

    init() {
        this.injectStyles();
        this.render();
        this.attachListeners();
    },

    render() {
        const existing = document.getElementById('inflight-tactical-ui');
        if (existing) existing.remove();

        const html = `
            <div id="inflight-tactical-ui" class="tactical-ui-root">
                <div class="top-branding">
                    <div class="status-dot"></div>
                    <span id="landing-server-name">EXPERT SERVER</span>
                </div>

                <div class="search-blade-container">
                    <div class="search-blade">
                        <i class="fa-solid fa-magnifying-glass search-icon"></i>
                        <input type="text" id="blade-search-input" placeholder="Search airspace..." autocomplete="off">
                        <div class="search-shortcut">⌘K</div>
                    </div>
                    <div id="active-filter-chips" class="filter-chips-row"></div>
                </div>

                <div class="utility-nexus">
                    <div id="filter-nexus-grid" class="filter-nexus-grid">
                        ${this.filterOptions.map(f => `
                            <div class="nexus-item" data-filter-id="${f.id}" title="${f.label}">
                                <i class="fa-solid ${f.icon}"></i>
                                <span class="nexus-label">${f.label}</span>
                            </div>
                        `).join('')}
                    </div>

                    <div class="orb-row">
                        <button class="orb-btn" id="tile-weather" aria-label="Weather">
                            <i class="fa-solid fa-cloud"></i>
                        </button>
                        <button class="orb-btn" id="tile-settings" aria-label="Settings">
                            <i class="fa-solid fa-sliders"></i>
                        </button>
                        <button class="orb-btn nexus-trigger" id="toggle-nexus" aria-label="Filters">
                            <i class="fa-solid fa-filter"></i>
                        </button>
                        <button class="orb-btn highlight-orb" id="tile-server" aria-label="Network">
                            <i class="fa-solid fa-wifi"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        const container = document.getElementById('sector-ops-map-fullscreen');
        if (container) {
            container.insertAdjacentHTML('beforeend', html);
        }
    },

    attachListeners() {
        const searchInput = document.getElementById('blade-search-input');
        const nexusTrigger = document.getElementById('toggle-nexus');
        const nexusGrid = document.getElementById('filter-nexus-grid');

        // Toggle Filter Nexus
        nexusTrigger?.addEventListener('click', () => {
            this._filterNexusOpen = !this._filterNexusOpen;
            if (nexusGrid) nexusGrid.classList.toggle('open', this._filterNexusOpen);
            if (nexusTrigger) nexusTrigger.classList.toggle('active', this._filterNexusOpen);
        });

        // Search Input Logic
        searchInput?.addEventListener('input', () => {
            this.dispatchFilterUpdate();
        });

        // Filter Item Logic
        document.querySelectorAll('.nexus-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.filterId;
                this.toggleFilter(id);
            });
        });

        const actions = {
            'tile-weather': () => document.getElementById('open-weather-settings-btn')?.click(),
            'tile-settings': () => document.getElementById('open-filter-settings-btn')?.click(),
            'tile-server': () => {
                const orb = document.getElementById('tile-server');
                if (orb) {
                    orb.classList.add('orb-pulse');
                    setTimeout(() => orb.classList.remove('orb-pulse'), 1000);
                }
            }
        };

        Object.entries(actions).forEach(([id, fn]) => {
            document.getElementById(id)?.addEventListener('click', fn);
        });
    },

    toggleFilter(id) {
        if (this._activeFilters[id] !== undefined) {
            delete this._activeFilters[id];
        } else {
            this._activeFilters[id] = '';
        }
        this.refreshUI();
    },

    updateFilterValue(id, value) {
        this._activeFilters[id] = value;
        this.dispatchFilterUpdate();
    },

    refreshUI() {
        // Update Chips under search bar
        const container = document.getElementById('active-filter-chips');
        if (container) {
            container.innerHTML = Object.entries(this._activeFilters).map(([id, value]) => {
                const opt = this.filterOptions.find(f => f.id === id);
                return `
                    <div class="filter-chip">
                        <i class="fa-solid ${opt.icon}"></i>
                        <input type="text" 
                               class="chip-input" 
                               placeholder="${opt.label}..." 
                               value="${value}" 
                               oninput="LandingUI.updateFilterValue('${id}', this.value)"
                               onkeydown="if(event.key==='Enter') this.blur()">
                        <i class="fa-solid fa-xmark chip-close" onclick="LandingUI.toggleFilter('${id}')"></i>
                    </div>
                `;
            }).join('');
        }

        // Update selected state in Nexus
        document.querySelectorAll('.nexus-item').forEach(item => {
            item.classList.toggle('active', this._activeFilters[item.dataset.filterId] !== undefined);
        });

        this.dispatchFilterUpdate();
    },

    dispatchFilterUpdate() {
        const event = new CustomEvent('filterUpdate', { 
            detail: { 
                filters: { ...this._activeFilters }, 
                searchTerm: document.getElementById('blade-search-input')?.value || '' 
            } 
        });
        window.dispatchEvent(event);
    },

    update(isActive, stats = {}) {
        const el = document.getElementById('inflight-tactical-ui');
        if (!el) return;
        isActive ? el.classList.add('active') : el.classList.remove('active');
        if (stats.server) {
            const serverEl = document.getElementById('landing-server-name');
            if (serverEl) serverEl.textContent = stats.server.toUpperCase();
        }
    },

    injectStyles() {
        const css = `
            .tactical-ui-root {
                position: absolute;
                inset: 0;
                z-index: 2000;
                pointer-events: none;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.5s ease;
                font-family: 'Inter', -apple-system, sans-serif;
            }
            .tactical-ui-root.active { opacity: 1; visibility: visible; }

            /* Top Branding */
            .top-branding {
                position: absolute;
                top: 30px;
                left: 40px;
                display: flex;
                align-items: center;
                gap: 12px;
                pointer-events: auto;
            }
            .status-dot { width: 6px; height: 6px; background: #00ff88; border-radius: 50%; box-shadow: 0 0 10px #00ff88; }
            #landing-server-name { color: rgba(255,255,255,0.4); font-size: 10px; font-weight: 800; letter-spacing: 0.2em; }

            /* Search Blade */
            .search-blade-container {
                position: absolute;
                top: 30px;
                right: 40px;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 12px;
                pointer-events: none;
            }
            .search-blade {
                pointer-events: auto;
                background: rgba(20, 20, 20, 0.4);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 12px;
                height: 44px;
                width: 240px;
                display: flex;
                align-items: center;
                padding: 0 14px;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .search-blade:focus-within {
                width: 380px;
                background: rgba(30, 30, 30, 0.7);
                border-color: rgba(255, 255, 255, 0.2);
                box-shadow: 0 10px 30px rgba(0,0,0,0.4);
            }
            .search-icon { color: rgba(255,255,255,0.3); font-size: 14px; }
            #blade-search-input {
                flex: 1;
                background: none;
                border: none;
                color: #fff;
                margin-left: 12px;
                font-size: 14px;
                outline: none;
            }
            .search-shortcut {
                font-size: 10px;
                color: rgba(255,255,255,0.2);
                background: rgba(255,255,255,0.05);
                padding: 2px 6px;
                border-radius: 4px;
            }

            /* Filter Chips (Below Search) */
            .filter-chips-row {
                display: flex;
                flex-wrap: wrap;
                justify-content: flex-end;
                gap: 8px;
                max-width: 450px;
            }
            .filter-chip {
                pointer-events: auto;
                background: rgba(255, 255, 255, 0.08);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 6px 10px;
                display: flex;
                align-items: center;
                gap: 8px;
                color: #fff;
                animation: chipIn 0.3s ease-out;
            }
            @keyframes chipIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
            .chip-input { background: none; border: none; color: #fff; font-size: 12px; width: 80px; outline: none; }
            .chip-close { font-size: 12px; color: rgba(255,255,255,0.3); cursor: pointer; transition: color 0.2s; }
            .chip-close:hover { color: #ff4444; }

            /* Utility Nexus */
            .utility-nexus {
                position: absolute;
                bottom: 40px;
                right: 40px;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 20px;
                pointer-events: none;
            }
            .orb-row { display: flex; gap: 12px; pointer-events: auto; }
            .orb-btn {
                width: 48px; height: 48px;
                border-radius: 50%;
                background: rgba(15, 15, 15, 0.6);
                backdrop-filter: blur(15px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.5);
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .orb-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; transform: scale(1.05); }
            .orb-btn.active { background: #fff; color: #000; }
            .highlight-orb { border-color: rgba(0, 255, 136, 0.3); }

            /* Filter Nexus Grid */
            .filter-nexus-grid {
                pointer-events: auto;
                display: grid;
                grid-template-columns: repeat(4, 1fr); /* Changed to 4 columns to accommodate the new filter */
                gap: 10px;
                background: rgba(10, 10, 10, 0.8);
                backdrop-filter: blur(30px);
                padding: 15px;
                border-radius: 20px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                opacity: 0;
                transform: translateY(20px) scale(0.95);
                visibility: hidden;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 20px 50px rgba(0,0,0,0.5);
            }
            .filter-nexus-grid.open { opacity: 1; transform: translateY(0) scale(1); visibility: visible; }
            
            .nexus-item {
                width: 70px; height: 70px;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                gap: 6px;
                border-radius: 12px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.05);
                color: rgba(255, 255, 255, 0.4);
                cursor: pointer;
                transition: all 0.2s;
            }
            .nexus-item:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
            .nexus-item.active { background: rgba(0, 122, 255, 0.2); border-color: #007aff; color: #fff; }
            .nexus-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
            
        `;

        const style = document.createElement('style');
        style.id = 'landing-ui-spatial-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};

window.LandingUI = LandingUI;