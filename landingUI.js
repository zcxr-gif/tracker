/**
 * LandingUI.js
 * REDESIGN: Tactical Modal - Advanced Centralized Filter Engine
 * Supports mixing filters, range inputs, and categorical selection.
 */

export const LandingUI = {
    _isVisible: false,
    _modalOpen: false,
    _activeFilters: {}, 

    // [NEW] Advanced Filter Definitions
    // Grouped for better UI organization
    filterGroups: {
        flight: {
            label: "Flight Data",
            filters: [
                { id: 'phase', label: 'Flight Phase', icon: 'fa-plane-circle-check', type: 'select', options: ['Ground', 'Climb', 'Cruise', 'Descent'] },
                { id: 'altitude', label: 'Altitude (ft)', icon: 'fa-arrow-up-right-dots', type: 'range', min: 0, max: 60000, step: 1000 },
                { id: 'speed', label: 'Speed (GS)', icon: 'fa-gauge-high', type: 'range', min: 0, max: 1200, step: 50 },
                { id: 'vspeed', label: 'Vert. Speed', icon: 'fa-angles-up', type: 'range', min: -6000, max: 6000, step: 500 }
            ]
        },
        aircraft: {
            label: "Aircraft Info",
            filters: [
                { id: 'category', label: 'Category', icon: 'fa-shapes', type: 'select', options: ['Heavy', 'Widebody', 'Narrowbody', 'Regional', 'GA', 'Military', 'Fighter'] },
                { id: 'type', label: 'Aircraft Type', icon: 'fa-plane', type: 'text', placeholder: 'e.g. B737, A320' },
                { id: 'livery', label: 'Livery', icon: 'fa-paint-roller', type: 'text', placeholder: 'e.g. United, FedEx' },
                { id: 'airline', label: 'Airline Code', icon: 'fa-building', type: 'text', placeholder: 'e.g. UAL, BAW' }
            ]
        },
        route: {
            label: "Route & Network",
            filters: [
                { id: 'origin', label: 'Origin', icon: 'fa-plane-departure', type: 'text', placeholder: 'ICAO' },
                { id: 'destination', label: 'Destination', icon: 'fa-plane-arrival', type: 'text', placeholder: 'ICAO' },
                { id: 'callsign', label: 'Callsign', icon: 'fa-id-badge', type: 'text', placeholder: 'Search...' },
                { id: 'group', label: 'Group Flight', icon: 'fa-users', type: 'boolean' } // Simple toggle
            ]
        }
    },

    init() {
        this.injectStyles();
        this.render();
        this.attachListeners();
    },

    render() {
        const existing = document.getElementById('inflight-tactical-ui');
        if (existing) existing.remove();

        // Flatten filters for easier lookup later
        this.allFilters = [];
        Object.values(this.filterGroups).forEach(group => this.allFilters.push(...group.filters));

        const html = `
            <div id="inflight-tactical-ui" class="tactical-ui-root">
                <div class="top-branding">
                    <div class="status-dot"></div>
                    <span id="landing-server-name">EXPERT SERVER</span>
                </div>

                <div class="search-blade-container">
                    <div class="search-blade">
                        <i class="fa-solid fa-magnifying-glass search-icon"></i>
                        <input type="text" id="blade-search-input" placeholder="Quick search callsign..." autocomplete="off">
                        <div class="search-shortcut">⌘K</div>
                    </div>
                </div>

                <div id="filter-modal-overlay" class="modal-overlay">
                    <div class="filter-modal">
                        <div class="modal-header">
                            <div class="header-main">
                                <i class="fa-solid fa-sliders-h"></i>
                                <h2>Tactical Filters</h2>
                            </div>
                            <button class="close-modal" id="close-filter-modal">&times;</button>
                        </div>
                        
                        <div class="modal-body">
                            <div class="filter-selection-pane">
                                ${Object.entries(this.filterGroups).map(([key, group]) => `
                                    <div class="filter-group-header">${group.label}</div>
                                    <div class="filter-options-grid">
                                        ${group.filters.map(f => `
                                            <div class="nexus-item" data-filter-id="${f.id}">
                                                <i class="fa-solid ${f.icon}"></i>
                                                <span class="nexus-label">${f.label}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                `).join('')}
                            </div>

                            <div class="filter-config-pane">
                                <div class="config-header">
                                    <label>Active Rules</label>
                                    <span id="active-count-badge">0</span>
                                </div>
                                <div id="modal-active-filters" class="modal-active-list">
                                    <div class="empty-state">
                                        <i class="fa-solid fa-filter-circle-xmark"></i>
                                        <p>No active filters</p>
                                        <span>Select parameters from the left to refine your view.</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="modal-footer">
                            <button class="modal-btn secondary" id="clear-filters-btn">Reset All</button>
                            <button class="modal-btn primary" id="apply-filters-btn">Apply Configuration</button>
                        </div>
                    </div>
                </div>

                <div class="utility-nexus">
                    <div class="orb-row">
                        <button class="orb-btn" id="tile-weather" aria-label="Weather"><i class="fa-solid fa-cloud"></i></button>
                        <button class="orb-btn nexus-trigger" id="toggle-filter-modal" aria-label="Filters"><i class="fa-solid fa-filter"></i></button>
                        <button class="orb-btn highlight-orb" id="tile-server" aria-label="Network"><i class="fa-solid fa-wifi"></i></button>
                    </div>
                </div>
            </div>
        `;

        const container = document.getElementById('sector-ops-map-fullscreen');
        if (container) container.insertAdjacentHTML('beforeend', html);
    },

    attachListeners() {
        const modalOverlay = document.getElementById('filter-modal-overlay');
        const openBtn = document.getElementById('toggle-filter-modal');
        const closeBtn = document.getElementById('close-filter-modal');
        const applyBtn = document.getElementById('apply-filters-btn');
        const clearBtn = document.getElementById('clear-filters-btn');

        const toggleModal = (state) => {
            this._modalOpen = state;
            modalOverlay.classList.toggle('open', state);
            if (state) this.refreshUI();
        };

        openBtn?.addEventListener('click', () => toggleModal(true));
        closeBtn?.addEventListener('click', () => toggleModal(false));
        applyBtn?.addEventListener('click', () => {
            this.dispatchFilterUpdate();
            toggleModal(false);
        });
        
        clearBtn?.addEventListener('click', () => {
            this._activeFilters = {};
            this.refreshUI();
            this.dispatchFilterUpdate();
        });

        modalOverlay?.addEventListener('click', (e) => {
            if (e.target === modalOverlay) toggleModal(false);
        });

        // Add Filter from Grid
        document.querySelectorAll('.nexus-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.filterId;
                this.activateFilter(id);
            });
        });
        
        // Search Input (Quick Filter)
        document.getElementById('blade-search-input')?.addEventListener('input', () => {
            this.dispatchFilterUpdate();
        });
        
        // Utility Orbs logic
        document.getElementById('tile-weather')?.addEventListener('click', () => {
             document.getElementById('open-weather-settings-btn')?.click();
        });
    },

    activateFilter(id) {
        // If already active, don't reset, just highlight or focus
        if (!this._activeFilters[id]) {
            // Initialize with default value based on type
            const def = this.allFilters.find(f => f.id === id);
            if (def.type === 'range') this._activeFilters[id] = { min: '', max: '' };
            else if (def.type === 'select') this._activeFilters[id] = def.options[0];
            else if (def.type === 'boolean') this._activeFilters[id] = true;
            else this._activeFilters[id] = '';
        }
        this.refreshUI();
    },

    removeFilter(id) {
        delete this._activeFilters[id];
        this.refreshUI();
    },

    updateFilterValue(id, value, subKey = null) {
        if (subKey) {
            // Handle range objects (min/max)
            this._activeFilters[id] = { ...this._activeFilters[id], [subKey]: value };
        } else {
            this._activeFilters[id] = value;
        }
    },

    // [NEW] Dynamically renders inputs based on filter definition
    renderInputControl(id, value) {
        const def = this.allFilters.find(f => f.id === id);
        
        if (def.type === 'select') {
            return `
                <select class="row-input-select" onchange="LandingUI.updateFilterValue('${id}', this.value)">
                    ${def.options.map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                </select>
            `;
        } 
        
        if (def.type === 'range') {
            return `
                <div class="range-inputs">
                    <input type="number" placeholder="Min" value="${value.min || ''}" 
                           oninput="LandingUI.updateFilterValue('${id}', this.value, 'min')">
                    <span class="range-sep">-</span>
                    <input type="number" placeholder="Max" value="${value.max || ''}" 
                           oninput="LandingUI.updateFilterValue('${id}', this.value, 'max')">
                </div>
            `;
        }

        if (def.type === 'boolean') {
            return `<div class="bool-indicator">Active</div>`;
        }

        // Default Text
        return `
            <input type="text" class="row-input" placeholder="${def.placeholder || 'Enter value...'}" 
                   value="${value}" oninput="LandingUI.updateFilterValue('${id}', this.value)">
        `;
    },

    refreshUI() {
        const container = document.getElementById('modal-active-filters');
        const badge = document.getElementById('active-count-badge');
        if (!container) return;

        const activeEntries = Object.entries(this._activeFilters);
        if (badge) badge.textContent = activeEntries.length;

        // Update Grid Selection State
        document.querySelectorAll('.nexus-item').forEach(item => {
            const id = item.dataset.filterId;
            item.classList.toggle('active', !!this._activeFilters[id]);
        });

        if (activeEntries.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-filter-circle-xmark"></i>
                    <p>No active filters</p>
                    <span>Select parameters from the left to refine your view.</span>
                </div>`;
            return;
        }

        container.innerHTML = activeEntries.map(([id, value]) => {
            const def = this.allFilters.find(f => f.id === id);
            return `
                <div class="modal-filter-row">
                    <div class="row-header">
                        <div class="row-label">
                            <i class="fa-solid ${def.icon}"></i>
                            <span>${def.label}</span>
                        </div>
                        <button class="row-remove" onclick="LandingUI.removeFilter('${id}')">
                            <i class="fa-solid fa-times"></i>
                        </button>
                    </div>
                    <div class="row-control">
                        ${this.renderInputControl(id, value)}
                    </div>
                </div>
            `;
        }).join('');
    },

    dispatchFilterUpdate() {
        // Combine active filters with the quick search bar
        const quickSearch = document.getElementById('blade-search-input')?.value || '';
        
        const event = new CustomEvent('filterUpdate', {
            detail: { 
                filters: { ...this._activeFilters },
                quickSearch: quickSearch
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
            /* Core Root */
            .tactical-ui-root { position: absolute; inset: 0; z-index: 2000; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity 0.5s ease; font-family: 'Inter', sans-serif; }
            .tactical-ui-root.active { opacity: 1; visibility: visible; }

            /* Modal Layout */
            .filter-modal {
                background: rgba(20, 20, 20, 0.95);
                width: 800px; /* Wider for 2-col layout */
                max-width: 95vw;
                height: 550px;
                max-height: 85vh;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 24px;
                box-shadow: 0 40px 100px rgba(0,0,0,0.8);
                display: flex; flex-direction: column; overflow: hidden;
                pointer-events: auto;
            }

            .modal-body { display: flex; flex: 1; overflow: hidden; }

            /* Left Pane: Selection */
            .filter-selection-pane {
                width: 40%;
                background: rgba(255,255,255,0.02);
                border-right: 1px solid rgba(255,255,255,0.08);
                padding: 20px;
                overflow-y: auto;
            }
            .filter-group-header {
                font-size: 0.7rem; color: #64748b; font-weight: 700; text-transform: uppercase; margin: 16px 0 8px 0; letter-spacing: 1px;
            }
            .filter-group-header:first-child { margin-top: 0; }
            
            .filter-options-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
            .nexus-item {
                background: rgba(255,255,255,0.05); border: 1px solid transparent;
                border-radius: 8px; padding: 10px; cursor: pointer;
                display: flex; flex-direction: column; align-items: center; gap: 6px;
                transition: all 0.2s;
            }
            .nexus-item:hover { background: rgba(255,255,255,0.1); }
            .nexus-item.active { background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.4); color: #38bdf8; }
            .nexus-label { font-size: 0.7rem; font-weight: 500; text-align: center; }

            /* Right Pane: Configuration */
            .filter-config-pane { flex: 1; padding: 20px; display: flex; flex-direction: column; background: #0f0f10; }
            .config-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
            .config-header label { font-size: 0.9rem; font-weight: 600; color: #fff; }
            #active-count-badge { background: #38bdf8; color: #000; font-size: 0.7rem; font-weight: 800; padding: 2px 8px; border-radius: 10px; }

            .modal-active-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
            
            /* Active Row Styling */
            .modal-filter-row { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; }
            .row-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
            .row-label { display: flex; align-items: center; gap: 8px; color: #94a3b8; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; }
            .row-remove { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.9rem; opacity: 0.7; transition: opacity 0.2s; }
            .row-remove:hover { opacity: 1; }

            /* Controls */
            .row-input, .row-input-select {
                width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);
                color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 0.9rem; outline: none;
            }
            .row-input:focus, .row-input-select:focus { border-color: #38bdf8; }
            
            .range-inputs { display: flex; align-items: center; gap: 8px; }
            .range-inputs input { 
                flex: 1; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);
                color: #fff; padding: 6px; border-radius: 4px; font-size: 0.85rem; text-align: center;
            }
            .range-sep { color: #64748b; font-weight: bold; }
            .bool-indicator { color: #4ade80; font-size: 0.8rem; font-weight: 700; background: rgba(74, 222, 128, 0.1); padding: 4px 8px; border-radius: 4px; display: inline-block; }

            /* Empty State */
            .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #475569; text-align: center; }
            .empty-state i { font-size: 2rem; margin-bottom: 12px; opacity: 0.5; }
            .empty-state p { font-size: 1rem; font-weight: 600; margin: 0; color: #64748b; }
            .empty-state span { font-size: 0.8rem; max-width: 200px; margin-top: 6px; }

            /* Shared/Previous Styles */
            .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden; transition: all 0.4s; pointer-events: auto; z-index: 3000; }
            .modal-overlay.open { opacity: 1; visibility: visible; }
            .modal-header { padding: 20px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); }
            .header-main { display: flex; align-items: center; gap: 12px; color: #fff; }
            .header-main h2 { margin: 0; font-size: 1.2rem; font-weight: 600; }
            .close-modal { background: none; border: none; color: #fff; font-size: 1.5rem; cursor: pointer; opacity: 0.7; }
            .modal-footer { padding: 20px; border-top: 1px solid rgba(255, 255, 255, 0.1); display: flex; justify-content: flex-end; gap: 12px; background: rgba(255,255,255,0.02); }
            .modal-btn { padding: 10px 24px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s; border: none; font-size: 0.9rem; }
            .modal-btn.secondary { background: rgba(255, 255, 255, 0.05); color: #94a3b8; }
            .modal-btn.secondary:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
            .modal-btn.primary { background: #38bdf8; color: #000; }
            .modal-btn.primary:hover { background: #0ea5e9; }
            
            /* Orb & Search Bar (Keep existing logic roughly same) */
            .utility-nexus { position: absolute; bottom: 40px; right: 40px; pointer-events: none; }
            .orb-row { display: flex; gap: 12px; pointer-events: auto; }
            .orb-btn { width: 48px; height: 48px; border-radius: 50%; background: rgba(15, 15, 15, 0.6); backdrop-filter: blur(15px); border: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.7); cursor: pointer; display: grid; place-items: center; transition: all 0.2s; font-size: 1.1rem; }
            .orb-btn:hover { transform: translateY(-2px); background: rgba(30, 30, 30, 0.8); color: #fff; border-color: rgba(255,255,255,0.3); }
            .highlight-orb { border-color: rgba(16, 185, 129, 0.4); color: #10b981; }

            .search-blade-container { position: absolute; top: 30px; left: 50%; transform: translateX(-50%); pointer-events: auto; z-index: 2010; }
            .search-blade { background: rgba(10, 10, 10, 0.8); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 100px; height: 44px; width: 340px; display: flex; align-items: center; padding: 0 14px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); transition: width 0.3s; }
            .search-blade:focus-within { width: 400px; border-color: #38bdf8; }
            #blade-search-input { flex: 1; background: none; border: none; color: #fff; margin-left: 12px; font-size: 14px; outline: none; }
            .search-icon { color: rgba(255,255,255,0.3); font-size: 14px; }
            .search-shortcut { font-size: 10px; color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; }
            
            .top-branding { position: absolute; top: 30px; left: 40px; display: flex; align-items: center; gap: 8px; pointer-events: auto; background: rgba(0,0,0,0.4); padding: 6px 12px; border-radius: 20px; backdrop-filter: blur(5px); border: 1px solid rgba(255,255,255,0.1); }
            .status-dot { width: 6px; height: 6px; background: #10b981; border-radius: 50%; box-shadow: 0 0 8px #10b981; }
            #landing-server-name { font-size: 0.75rem; font-weight: 700; color: #fff; letter-spacing: 0.5px; }
        `;
        
        const styleId = 'landing-ui-advanced-css';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = css;
            document.head.appendChild(style);
        }
    }
};