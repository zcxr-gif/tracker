/**
 * LandingUI.js
 * REDESIGN: Tactical Modal - Advanced Centralized Filter Engine
 * Supports mixing filters, range inputs, and categorical selection.
 */

export const LandingUI = {
    _isVisible: false,
    _modalOpen: false,
    _activeFilters: {}, 

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
                { id: 'group', label: 'Group Flight', icon: 'fa-users', type: 'boolean' } 
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
                                <div class="header-icon-box"><i class="fa-solid fa-sliders-h"></i></div>
                                <div class="header-text">
                                    <h2>Tactical Filters</h2>
                                    <span>Refine airspace visualization</span>
                                </div>
                            </div>
                            <button class="close-modal" id="close-filter-modal">&times;</button>
                        </div>
                        
                        <div class="modal-body">
                            <div class="filter-selection-pane custom-scroll">
                                ${Object.entries(this.filterGroups).map(([key, group]) => `
                                    <div class="filter-group-wrapper">
                                        <div class="filter-group-header">${group.label}</div>
                                        <div class="filter-options-list">
                                            ${group.filters.map(f => `
                                                <button class="nexus-item" data-filter-id="${f.id}">
                                                    <div class="nexus-icon"><i class="fa-solid ${f.icon}"></i></div>
                                                    <span class="nexus-label">${f.label}</span>
                                                    <i class="fa-solid fa-plus nexus-add"></i>
                                                </button>
                                            `).join('')}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>

                            <div class="filter-config-pane">
                                <div class="config-header">
                                    <label>Active Rules</label>
                                    <span id="active-count-badge">0 Active</span>
                                </div>
                                <div id="modal-active-filters" class="modal-active-list custom-scroll">
                                    <div class="empty-state">
                                        <div class="empty-icon-circle">
                                            <i class="fa-solid fa-filter"></i>
                                        </div>
                                        <p>No active filters</p>
                                        <span>Select parameters from the left sidebar to configure rules.</span>
                                    </div>
                                </div>
                                <div class="modal-footer-embedded">
                                    <button class="modal-btn secondary" id="clear-filters-btn">Reset</button>
                                    <button class="modal-btn primary" id="apply-filters-btn">Apply Changes</button>
                                </div>
                            </div>
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
        
        document.getElementById('tile-weather')?.addEventListener('click', () => {
             document.getElementById('open-weather-settings-btn')?.click();
        });
    },

    activateFilter(id) {
        if (!this._activeFilters[id]) {
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
            this._activeFilters[id] = { ...this._activeFilters[id], [subKey]: value };
        } else {
            this._activeFilters[id] = value;
        }
    },

    renderInputControl(id, value) {
        const def = this.allFilters.find(f => f.id === id);
        
        if (def.type === 'select') {
            return `
                <div class="input-wrapper select-wrapper">
                    <select class="row-input-select data-input" data-id="${id}">
                        ${def.options.map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                    </select>
                    <i class="fa-solid fa-chevron-down select-caret"></i>
                </div>
            `;
        } 
        
        if (def.type === 'range') {
            return `
                <div class="range-pill-container">
                    <div class="range-half">
                        <span class="range-label">MIN</span>
                        <input type="number" class="range-input data-input-min" data-id="${id}" placeholder="0" value="${value.min || ''}">
                    </div>
                    <div class="range-divider"></div>
                    <div class="range-half">
                        <span class="range-label">MAX</span>
                        <input type="number" class="range-input data-input-max" data-id="${id}" placeholder="Max" value="${value.max || ''}">
                    </div>
                </div>
            `;
        }

        if (def.type === 'boolean') {
            return `<div class="bool-indicator"><i class="fa-solid fa-check"></i> Active</div>`;
        }

        return `
            <div class="input-wrapper">
                <input type="text" class="row-input data-input" data-id="${id}" placeholder="${def.placeholder || 'Enter value...'}" value="${value}">
            </div>
        `;
    },

    refreshUI() {
        const container = document.getElementById('modal-active-filters');
        const badge = document.getElementById('active-count-badge');
        if (!container) return;

        const activeEntries = Object.entries(this._activeFilters);
        if (badge) badge.textContent = `${activeEntries.length} Rule${activeEntries.length !== 1 ? 's' : ''}`;

        // Highlight active sidebar items
        document.querySelectorAll('.nexus-item').forEach(item => {
            const id = item.dataset.filterId;
            item.classList.toggle('active', !!this._activeFilters[id]);
        });

        if (activeEntries.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon-circle"><i class="fa-solid fa-filter"></i></div>
                    <p>No active filters</p>
                    <span>Select parameters from the left sidebar to configure rules.</span>
                </div>`;
            return;
        }

        // 1. Generate HTML
        container.innerHTML = activeEntries.map(([id, value]) => {
            const def = this.allFilters.find(f => f.id === id);
            return `
                <div class="modal-filter-card slide-in">
                    <div class="card-left-strip"></div>
                    <div class="card-content">
                        <div class="row-header">
                            <div class="row-label">
                                <i class="fa-solid ${def.icon}"></i>
                                <span>${def.label}</span>
                            </div>
                            <button class="row-remove js-remove-filter" data-id="${id}" title="Remove Filter">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                        <div class="row-control">
                            ${this.renderInputControl(id, value)}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // 2. Attach Event Listeners (Fixes "Delete not working" issue)
        
        // Remove Buttons
        container.querySelectorAll('.js-remove-filter').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.id;
                this.removeFilter(id);
            });
        });

        // Standard Inputs & Selects
        container.querySelectorAll('.data-input').forEach(input => {
            input.addEventListener('input', (e) => {
                this.updateFilterValue(e.target.dataset.id, e.target.value);
            });
        });

        // Range Inputs
        container.querySelectorAll('.data-input-min').forEach(input => {
            input.addEventListener('input', (e) => {
                this.updateFilterValue(e.target.dataset.id, e.target.value, 'min');
            });
        });
        container.querySelectorAll('.data-input-max').forEach(input => {
            input.addEventListener('input', (e) => {
                this.updateFilterValue(e.target.dataset.id, e.target.value, 'max');
            });
        });
    },

    dispatchFilterUpdate() {
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
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

            /* Core Root */
            .tactical-ui-root { position: absolute; inset: 0; z-index: 2000; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity 0.5s ease; font-family: 'Inter', sans-serif; }
            .tactical-ui-root.active { opacity: 1; visibility: visible; }
            
            /* SCROLLBAR CUSTOMIZATION */
            .custom-scroll::-webkit-scrollbar { width: 4px; }
            .custom-scroll::-webkit-scrollbar-track { background: transparent; }
            .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
            .custom-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.4); }

            /* Modal Layout */
            .filter-modal {
                background: #121214;
                width: 850px;
                height: 580px;
                max-width: 95vw; max-height: 85vh;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                box-shadow: 0 50px 100px -20px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.05);
                display: flex; flex-direction: column; overflow: hidden;
                pointer-events: auto;
                animation: modalPop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes modalPop { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }

            /* Header */
            .modal-header { height: 70px; padding: 0 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.01); }
            .header-main { display: flex; align-items: center; gap: 16px; color: #fff; }
            .header-icon-box { width: 36px; height: 36px; background: rgba(56, 189, 248, 0.1); border-radius: 8px; color: #38bdf8; display: grid; place-items: center; font-size: 1rem; }
            .header-text h2 { margin: 0; font-size: 1.1rem; font-weight: 700; line-height: 1.2; }
            .header-text span { font-size: 0.75rem; color: #94a3b8; font-weight: 500; }
            .close-modal { background: none; border: none; color: #64748b; font-size: 1.5rem; cursor: pointer; transition: color 0.2s; line-height: 1; }
            .close-modal:hover { color: #fff; }

            .modal-body { display: flex; flex: 1; overflow: hidden; }

            /* LEFT SIDEBAR: Selection */
            .filter-selection-pane {
                width: 260px;
                background: rgba(0,0,0,0.2);
                border-right: 1px solid rgba(255,255,255,0.06);
                padding: 20px 16px;
                overflow-y: auto;
                display: flex; flex-direction: column; gap: 24px;
            }
            .filter-group-header { font-size: 0.7rem; color: #52525b; font-weight: 800; text-transform: uppercase; margin-bottom: 10px; letter-spacing: 1px; padding-left: 8px; }
            .filter-options-list { display: flex; flex-direction: column; gap: 4px; }
            
            .nexus-item {
                background: transparent; border: none; width: 100%;
                padding: 10px 12px; border-radius: 8px; cursor: pointer;
                display: flex; align-items: center; gap: 12px;
                transition: all 0.2s; text-align: left; color: #a1a1aa;
                position: relative; overflow: hidden;
            }
            .nexus-item:hover { background: rgba(255,255,255,0.04); color: #e4e4e7; }
            .nexus-item.active { background: rgba(56, 189, 248, 0.1); color: #38bdf8; }
            .nexus-item.active::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: #38bdf8; }
            
            .nexus-icon { width: 20px; text-align: center; font-size: 0.9rem; }
            .nexus-label { font-size: 0.85rem; font-weight: 500; flex: 1; }
            .nexus-add { font-size: 0.7rem; opacity: 0; transform: translateX(-5px); transition: all 0.2s; }
            .nexus-item:hover .nexus-add { opacity: 0.5; transform: translateX(0); }

            /* RIGHT PANE: Configuration */
            .filter-config-pane { flex: 1; padding: 24px; display: flex; flex-direction: column; background: #18181b; position: relative; }
            
            .config-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
            .config-header label { font-size: 0.85rem; font-weight: 600; color: #e4e4e7; }
            #active-count-badge { background: #27272a; border: 1px solid #3f3f46; color: #a1a1aa; font-size: 0.7rem; font-weight: 600; padding: 4px 10px; border-radius: 12px; }

            .modal-active-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-bottom: 60px; /* Space for footer */ }

            /* Footer embedded in right pane */
            .modal-footer-embedded {
                position: absolute; bottom: 0; left: 0; right: 0;
                padding: 16px 24px;
                background: rgba(24, 24, 27, 0.95);
                border-top: 1px solid rgba(255,255,255,0.06);
                display: flex; justify-content: flex-end; gap: 12px;
                backdrop-filter: blur(5px);
            }
            .modal-btn { padding: 8px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; transition: all 0.2s; border: none; font-size: 0.85rem; }
            .modal-btn.secondary { background: transparent; border: 1px solid #3f3f46; color: #a1a1aa; }
            .modal-btn.secondary:hover { border-color: #52525b; color: #fff; }
            .modal-btn.primary { background: #38bdf8; color: #0f172a; }
            .modal-btn.primary:hover { background: #0ea5e9; box-shadow: 0 0 15px rgba(14, 165, 233, 0.3); }

            /* Filter Cards */
            .modal-filter-card {
                background: #202023; border: 1px solid rgba(255,255,255,0.04);
                border-radius: 8px; display: flex; overflow: hidden;
                transition: transform 0.2s; position: relative;
            }
            .card-left-strip { width: 4px; background: #38bdf8; opacity: 0.7; }
            .card-content { flex: 1; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
            
            .row-header { display: flex; justify-content: space-between; align-items: center; }
            .row-label { display: flex; align-items: center; gap: 8px; color: #e4e4e7; font-size: 0.85rem; font-weight: 600; }
            .row-label i { color: #52525b; }
            
            .row-remove {
                background: transparent; border: none; color: #ef4444; 
                cursor: pointer; opacity: 0; transition: opacity 0.2s;
                padding: 4px; border-radius: 4px;
            }
            .modal-filter-card:hover .row-remove { opacity: 0.6; }
            .row-remove:hover { opacity: 1; background: rgba(239, 68, 68, 0.1); }

            /* Inputs */
            .input-wrapper { position: relative; width: 100%; }
            .row-input, .row-input-select {
                width: 100%; background: #121214; border: 1px solid #3f3f46;
                color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; outline: none;
                transition: border-color 0.2s;
            }
            .row-input:focus, .row-input-select:focus { border-color: #38bdf8; background: #09090b; }
            
            .select-wrapper select { appearance: none; cursor: pointer; }
            .select-caret { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: #71717a; pointer-events: none; font-size: 0.7rem; }

            /* Range Inputs */
            .range-pill-container {
                display: flex; background: #121214; border: 1px solid #3f3f46;
                border-radius: 6px; align-items: center; overflow: hidden;
            }
            .range-pill-container:focus-within { border-color: #38bdf8; }
            .range-half { flex: 1; display: flex; align-items: center; position: relative; }
            .range-label { position: absolute; left: 10px; font-size: 0.6rem; font-weight: 700; color: #52525b; letter-spacing: 0.5px; }
            .range-input {
                width: 100%; background: transparent; border: none; color: #fff;
                padding: 8px 8px 8px 36px; outline: none; font-size: 0.85rem;
            }
            .range-divider { width: 1px; height: 20px; background: #27272a; }

            .bool-indicator { color: #34d399; font-size: 0.8rem; font-weight: 600; display: flex; gap: 6px; align-items: center; }

            /* Empty State */
            .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #52525b; text-align: center; margin-top: 40px; }
            .empty-icon-circle { width: 60px; height: 60px; background: rgba(255,255,255,0.03); border-radius: 50%; display: grid; place-items: center; font-size: 1.5rem; margin-bottom: 16px; }
            .empty-state p { font-size: 0.95rem; font-weight: 600; margin: 0 0 4px 0; color: #a1a1aa; }
            .empty-state span { font-size: 0.8rem; max-width: 220px; line-height: 1.4; }

            /* Overlay & Orbs (Preserved) */
            .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden; transition: all 0.3s; pointer-events: auto; z-index: 3000; }
            .modal-overlay.open { opacity: 1; visibility: visible; }
            
            .utility-nexus { position: absolute; bottom: 40px; right: 40px; pointer-events: none; }
            .orb-row { display: flex; gap: 12px; pointer-events: auto; }
            .orb-btn { width: 48px; height: 48px; border-radius: 50%; background: rgba(15, 15, 15, 0.6); backdrop-filter: blur(15px); border: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.7); cursor: pointer; display: grid; place-items: center; transition: all 0.2s; font-size: 1.1rem; }
            .orb-btn:hover { transform: translateY(-4px); background: rgba(30, 30, 30, 0.9); color: #fff; border-color: rgba(255,255,255,0.4); box-shadow: 0 5px 15px rgba(0,0,0,0.5); }
            .highlight-orb { border-color: rgba(16, 185, 129, 0.4); color: #10b981; }

            .search-blade-container { position: absolute; top: 30px; left: 50%; transform: translateX(-50%); pointer-events: auto; z-index: 2010; }
            .search-blade { background: rgba(10, 10, 10, 0.8); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 100px; height: 44px; width: 340px; display: flex; align-items: center; padding: 0 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); transition: width 0.3s; }
            .search-blade:focus-within { width: 420px; border-color: #38bdf8; box-shadow: 0 10px 40px rgba(56, 189, 248, 0.15); }
            #blade-search-input { flex: 1; background: none; border: none; color: #fff; margin-left: 12px; font-size: 14px; outline: none; }
            .search-icon { color: rgba(255,255,255,0.4); font-size: 14px; }
            .search-shortcut { font-size: 10px; color: #71717a; background: rgba(255,255,255,0.08); padding: 3px 6px; border-radius: 4px; font-weight: 600; }
            
            .top-branding { position: absolute; top: 30px; left: 40px; display: flex; align-items: center; gap: 8px; pointer-events: auto; background: rgba(0,0,0,0.6); padding: 8px 16px; border-radius: 30px; backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
            .status-dot { width: 6px; height: 6px; background: #10b981; border-radius: 50%; box-shadow: 0 0 10px #10b981; }
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