/**
 * LandingUI.js
 * REDESIGN: Spatial Minimalist - Flightradar24-style Filter Flow
 * * Flow:
 * 1. User opens Nexus (Filter Menu).
 * 2. User clicks a category (e.g., Altitude).
 * 3. A "Configurator Blade" appears with specific inputs (e.g., Min/Max).
 * 4. User clicks "Apply" -> Adds a chip to the top Search Blade.
 */

export const LandingUI = {
    _isVisible: false,
    _filterNexusOpen: false,
    _configuringFilterId: null, // Tracks which filter is currently being edited
    _activeFilters: {}, // Structure: { id: { value: '...', type: '...' } }

    // Defined with input types to mimic FR24 logic (Range vs Text)
    filterOptions: [
        { id: 'type', label: 'Aircraft', icon: 'fa-plane', inputType: 'text', placeholder: 'e.g. B737, A320' },
        { id: 'airline', label: 'Operator', icon: 'fa-building', inputType: 'text', placeholder: 'e.g. DAL, UAL' },
        { id: 'callsign', label: 'Callsign', icon: 'fa-id-badge', inputType: 'text', placeholder: 'Search callsign...' },
        { id: 'rank', label: 'Rank', icon: 'fa-star', inputType: 'text', placeholder: 'Grade level...' },
        { id: 'altitude', label: 'Altitude', icon: 'fa-arrows-up-down', inputType: 'range', unit: 'ft' },
        { id: 'speed', label: 'Speed', icon: 'fa-gauge-high', inputType: 'range', unit: 'kts' },
        { id: 'origin', label: 'Origin', icon: 'fa-plane-departure', inputType: 'text', placeholder: 'ICAO Code' },
        { id: 'destination', label: 'Destination', icon: 'fa-plane-arrival', inputType: 'text', placeholder: 'ICAO Code' },
        { id: 'atc', label: 'ATC', icon: 'fa-headset', inputType: 'text', placeholder: 'Frequency/Name' },
        { id: 'groups', label: 'Groups', icon: 'fa-users-rays', inputType: 'text', placeholder: 'Group Name' }
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
                    
                    <div id="filter-configurator" class="filter-configurator">
                        <div class="config-header">
                            <i id="config-icon" class="fa-solid fa-filter"></i>
                            <span id="config-title">CONFIGURE</span>
                            <button class="config-close-btn" id="close-config"><i class="fa-solid fa-xmark"></i></button>
                        </div>
                        <div id="config-body" class="config-body">
                            </div>
                        <div class="config-footer">
                            <button id="apply-filter-btn" class="action-btn apply">ADD FILTER</button>
                        </div>
                    </div>

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
        const closeConfigBtn = document.getElementById('close-config');
        const applyFilterBtn = document.getElementById('apply-filter-btn');

        // Toggle Nexus Grid
        nexusTrigger?.addEventListener('click', () => {
            this._filterNexusOpen = !this._filterNexusOpen;
            // Close configurator if closing nexus
            if (!this._filterNexusOpen) this.closeConfigurator();
            
            if (nexusGrid) nexusGrid.classList.toggle('open', this._filterNexusOpen);
            if (nexusTrigger) nexusTrigger.classList.toggle('active', this._filterNexusOpen);
        });

        // Close Configurator
        closeConfigBtn?.addEventListener('click', () => this.closeConfigurator());

        // Apply Filter Logic
        applyFilterBtn?.addEventListener('click', () => this.applyCurrentFilter());

        // Nexus Item Click (Opens Configurator)
        document.querySelectorAll('.nexus-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.filterId;
                this.openConfigurator(id);
            });
        });

        // Global Search Input
        searchInput?.addEventListener('input', () => this.dispatchFilterUpdate());

        // Standard Orbs
        document.getElementById('tile-weather')?.addEventListener('click', () => document.getElementById('open-weather-settings-btn')?.click());
        document.getElementById('tile-settings')?.addEventListener('click', () => document.getElementById('open-filter-settings-btn')?.click());
    },

    openConfigurator(filterId) {
        this._configuringFilterId = filterId;
        const option = this.filterOptions.find(f => f.id === filterId);
        if (!option) return;

        const configEl = document.getElementById('filter-configurator');
        const bodyEl = document.getElementById('config-body');
        const titleEl = document.getElementById('config-title');
        const iconEl = document.getElementById('config-icon');
        const gridEl = document.getElementById('filter-nexus-grid');

        // Update Header
        titleEl.textContent = option.label;
        iconEl.className = `fa-solid ${option.icon}`;

        // Build Inputs based on Type (FR24 Style)
        if (option.inputType === 'range') {
            bodyEl.innerHTML = `
                <div class="range-inputs-wrapper">
                    <div class="input-group">
                        <label>MIN (${option.unit || ''})</label>
                        <input type="number" id="filter-min" placeholder="0">
                    </div>
                    <div class="separator">-</div>
                    <div class="input-group">
                        <label>MAX (${option.unit || ''})</label>
                        <input type="number" id="filter-max" placeholder="Unlimited">
                    </div>
                </div>
            `;
        } else {
            bodyEl.innerHTML = `
                <div class="text-input-wrapper">
                    <input type="text" id="filter-value" placeholder="${option.placeholder || 'Enter value...'}" autocomplete="off">
                </div>
            `;
            // Auto focus for text
            setTimeout(() => document.getElementById('filter-value')?.focus(), 100);
        }

        // Handle ENTER key to apply
        bodyEl.querySelectorAll('input').forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.applyCurrentFilter();
            });
        });

        // Show Configurator, Hide/Dim Grid slightly
        configEl.classList.add('active');
        if (gridEl) gridEl.classList.add('dimmed');
    },

    closeConfigurator() {
        this._configuringFilterId = null;
        document.getElementById('filter-configurator')?.classList.remove('active');
        document.getElementById('filter-nexus-grid')?.classList.remove('dimmed');
    },

    applyCurrentFilter() {
        if (!this._configuringFilterId) return;

        const option = this.filterOptions.find(f => f.id === this._configuringFilterId);
        let value = null;

        if (option.inputType === 'range') {
            const min = document.getElementById('filter-min').value;
            const max = document.getElementById('filter-max').value;
            if (min || max) {
                value = { min: min || '0', max: max || '∞' };
            }
        } else {
            const val = document.getElementById('filter-value').value;
            if (val) value = val;
        }

        if (value) {
            this._activeFilters[this._configuringFilterId] = {
                value: value,
                type: option.inputType,
                unit: option.unit
            };
            this.refreshActiveChips();
            this.closeConfigurator();
        }
    },

    removeFilter(id) {
        delete this._activeFilters[id];
        this.refreshActiveChips();
    },

    refreshActiveChips() {
        const container = document.getElementById('active-filter-chips');
        if (!container) return;

        container.innerHTML = Object.entries(this._activeFilters).map(([id, data]) => {
            const opt = this.filterOptions.find(f => f.id === id);
            
            // Format display string
            let displayStr = '';
            if (data.type === 'range') {
                displayStr = `${data.value.min} - ${data.value.max} ${data.unit || ''}`;
            } else {
                displayStr = data.value;
            }

            return `
                <div class="filter-chip">
                    <i class="fa-solid ${opt.icon}"></i>
                    <span class="chip-label">${opt.label}:</span>
                    <span class="chip-value">${displayStr}</span>
                    <i class="fa-solid fa-xmark chip-close" onclick="LandingUI.removeFilter('${id}')"></i>
                </div>
            `;
        }).join('');

        this.dispatchFilterUpdate();
    },

    dispatchFilterUpdate() {
        // Loose ends: Sending the complex objects (ranges/text) so backend can parse later
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
            document.getElementById('landing-server-name').textContent = stats.server.toUpperCase();
        }
    },

    injectStyles() {
        const css = `
            .tactical-ui-root {
                position: absolute; inset: 0; z-index: 2000;
                pointer-events: none; opacity: 0; visibility: hidden;
                transition: opacity 0.5s ease;
                font-family: 'Inter', -apple-system, sans-serif;
            }
            .tactical-ui-root.active { opacity: 1; visibility: visible; }

            /* Top Branding */
            .top-branding {
                position: absolute; top: 30px; left: 40px;
                display: flex; align-items: center; gap: 12px; pointer-events: auto;
            }
            .status-dot { width: 6px; height: 6px; background: #00ff88; border-radius: 50%; box-shadow: 0 0 10px #00ff88; }
            #landing-server-name { color: rgba(255,255,255,0.4); font-size: 10px; font-weight: 800; letter-spacing: 0.2em; }

            /* Search Blade */
            .search-blade-container {
                position: absolute; top: 30px; right: 40px;
                display: flex; flex-direction: column; align-items: flex-end; gap: 12px;
                pointer-events: none;
            }
            .search-blade {
                pointer-events: auto;
                background: rgba(20, 20, 20, 0.6); backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px;
                height: 44px; width: 240px; display: flex; align-items: center; padding: 0 14px;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .search-blade:focus-within { width: 380px; background: rgba(30, 30, 30, 0.8); border-color: rgba(255,255,255,0.2); }
            .search-icon { color: rgba(255,255,255,0.3); font-size: 14px; }
            #blade-search-input { flex: 1; background: none; border: none; color: #fff; margin-left: 12px; font-size: 14px; outline: none; }
            .search-shortcut { font-size: 10px; color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; }

            /* Active Chips (Read Only) */
            .filter-chips-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; max-width: 500px; }
            .filter-chip {
                pointer-events: auto;
                background: rgba(0, 122, 255, 0.15); border: 1px solid rgba(0, 122, 255, 0.3);
                backdrop-filter: blur(10px); border-radius: 8px;
                padding: 6px 10px; display: flex; align-items: center; gap: 8px;
                color: #fff; font-size: 12px; animation: chipIn 0.3s ease-out;
            }
            @keyframes chipIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
            .chip-label { color: rgba(255,255,255,0.6); font-weight: 500; text-transform: uppercase; font-size: 10px; }
            .chip-value { font-weight: 700; }
            .chip-close { margin-left: 4px; color: rgba(255,255,255,0.4); cursor: pointer; }
            .chip-close:hover { color: #fff; }

            /* Utility Nexus Container */
            .utility-nexus {
                position: absolute; bottom: 40px; right: 40px;
                display: flex; flex-direction: column; align-items: flex-end; gap: 15px; pointer-events: none;
            }

            /* Filter Configurator (The "Popup" Blade) */
            .filter-configurator {
                pointer-events: auto;
                width: 320px;
                background: rgba(15, 15, 15, 0.95);
                backdrop-filter: blur(40px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                padding: 16px;
                margin-bottom: 10px;
                opacity: 0; transform: translateY(20px) scale(0.95); visibility: hidden;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 20px 60px rgba(0,0,0,0.6);
            }
            .filter-configurator.active { opacity: 1; transform: translateY(0) scale(1); visibility: visible; }

            .config-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); }
            #config-title { font-size: 12px; font-weight: 700; letter-spacing: 1px; color: #fff; flex: 1; }
            .config-close-btn { background: none; border: none; color: rgba(255,255,255,0.3); cursor: pointer; transition: 0.2s; }
            .config-close-btn:hover { color: #fff; }

            .config-body { margin-bottom: 16px; }
            .text-input-wrapper input {
                width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
                border-radius: 8px; padding: 10px; color: #fff; outline: none; font-size: 14px;
            }
            .text-input-wrapper input:focus { border-color: #007aff; background: rgba(0, 122, 255, 0.1); }

            .range-inputs-wrapper { display: flex; align-items: center; gap: 10px; }
            .input-group { flex: 1; display: flex; flex-direction: column; gap: 4px; }
            .input-group label { font-size: 9px; color: rgba(255,255,255,0.4); font-weight: 600; }
            .input-group input { 
                width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
                border-radius: 6px; padding: 8px; color: #fff; outline: none; font-size: 13px;
            }
            .input-group input:focus { border-color: #007aff; }
            .separator { color: rgba(255,255,255,0.2); font-weight: bold; margin-top: 14px; }

            .config-footer { display: flex; justify-content: flex-end; }
            .action-btn { 
                background: #fff; color: #000; border: none; border-radius: 6px; padding: 8px 16px; 
                font-size: 11px; font-weight: 700; cursor: pointer; transition: 0.2s; 
            }
            .action-btn:hover { background: #e0e0e0; transform: translateY(-1px); }

            /* Nexus Grid */
            .filter-nexus-grid {
                pointer-events: auto;
                display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
                background: rgba(10, 10, 10, 0.8); backdrop-filter: blur(30px);
                padding: 15px; border-radius: 20px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                opacity: 0; transform: translateY(20px) scale(0.95); visibility: hidden;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .filter-nexus-grid.open { opacity: 1; transform: translateY(0) scale(1); visibility: visible; }
            .filter-nexus-grid.dimmed { opacity: 0.3; pointer-events: none; transform: scale(0.98); }

            .nexus-item {
                width: 70px; height: 70px; display: flex; flex-direction: column;
                align-items: center; justify-content: center; gap: 6px;
                border-radius: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05);
                color: rgba(255, 255, 255, 0.4); cursor: pointer; transition: all 0.2s;
            }
            .nexus-item:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
            .nexus-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }

            /* Orbs */
            .orb-row { display: flex; gap: 12px; pointer-events: auto; }
            .orb-btn {
                width: 48px; height: 48px; border-radius: 50%;
                background: rgba(15, 15, 15, 0.6); backdrop-filter: blur(15px);
                border: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.5);
                cursor: pointer; display: flex; align-items: center; justify-content: center;
                transition: all 0.3s;
            }
            .orb-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; transform: scale(1.05); }
            .orb-btn.active { background: #fff; color: #000; }
            .highlight-orb { border-color: rgba(0, 255, 136, 0.3); }
        `;

        const style = document.createElement('style');
        style.id = 'landing-ui-spatial-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};

window.LandingUI = LandingUI;