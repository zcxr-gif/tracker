/**
 * LandingUI.js
 * REDESIGN: Tactical Modal - Advanced Centralized Filter Engine
 * UPDATED: Added Hover Previews for Settings and Filters
 */

export const LandingUI = {
    _isVisible: false,
    _modalOpen: false,
    _weatherMenuOpen: false,
    _activeFilters: {}, 
    _currentServer: 'Expert', // Default server

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
                { 
                    id: 'country', 
                    label: 'Country Registry', 
                    icon: 'fa-globe', 
                    type: 'select', 
                    options: [] 
                },
                { id: 'airline', label: 'Airline Code', icon: 'fa-building', type: 'text', placeholder: 'e.g. UAL, BAW' }
            ]
        },
        route: {
            label: "Route & Network",
            filters: [
                { id: 'departureIcao', label: 'Departure', icon: 'fa-plane-departure', type: 'text', placeholder: 'ICAO' },
                { id: 'arrivalIcao', label: 'Arrival', icon: 'fa-plane-arrival', type: 'text', placeholder: 'ICAO' },
                { id: 'callsign', label: 'Callsign', icon: 'fa-id-badge', type: 'text', placeholder: 'Search...' },
                { id: 'group', label: 'Group Flight', icon: 'fa-users', type: 'boolean' } 
            ]
        }
    },

    async init() {
        await this.loadPrefixData(); 
        this.injectStyles();
        this.render();
        this.attachListeners();
    },

    async loadPrefixData() {
        try {
            const response = await fetch('prefix.json');
            const data = await response.json();
            const countryFilter = this.filterGroups.aircraft.filters.find(f => f.id === 'country');
            if (countryFilter) {
                countryFilter.options = [
                    'All Countries', 
                    ...data.map(p => `${p.country} (${p.prefix[0]})`)
                ];
            }
        } catch (e) {
            console.error("Error loading prefix.json:", e);
        }
    },

    render() {
        const existing = document.getElementById('inflight-tactical-ui');
        if (existing) existing.remove();

        this.allFilters = [];
        Object.values(this.filterGroups).forEach(group => this.allFilters.push(...group.filters));

        const html = `
            <div id="inflight-tactical-ui" class="tactical-ui-root">
                <div class="top-branding dropdown" id="server-selector">
                    <div class="status-dot"></div>
                    <div class="branding-content">
                        <span id="landing-server-name">${this._currentServer.toUpperCase()} SERVER</span>
                        <i class="fa-solid fa-chevron-down dropdown-arrow"></i>
                    </div>
                    <div class="server-menu">
                        <div class="server-option" data-val="Expert">Expert</div>
                        <div class="server-option" data-val="Training">Training</div>
                        <div class="server-option" data-val="Casual">Casual</div>
                    </div>
                </div>

                <div class="top-right-actions">
                    <div class="search-blade">
                        <i class="fa-solid fa-magnifying-glass search-icon"></i>
                        <input type="text" id="blade-search-input" placeholder="Quick search..." autocomplete="off">
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
                        <!-- WEATHER NEXUS WRAPPER -->
                        <div class="weather-nexus-container" id="weather-menu-wrapper">
                            <div class="weather-spread">
                                <button class="spread-opt" data-weather="precip" id="opt-radar">
                                    <i class="fa-solid fa-satellite-dish"></i>
                                    <span class="spread-label">Radar (Precip)</span>
                                </button>
                                <button class="spread-opt" data-weather="sigmets">
                                    <i class="fa-solid fa-triangle-exclamation"></i>
                                    <span class="spread-label">SIGMETs</span>
                                </button>
                                <button class="spread-opt" data-weather="clouds">
                                    <i class="fa-solid fa-cloud"></i>
                                    <span class="spread-label">Cloud Cover</span>
                                </button>
                                <button class="spread-opt" data-weather="wind">
                                    <i class="fa-solid fa-wind"></i>
                                    <span class="spread-label">Wind Speed</span>
                                </button>
                            </div>
                            <button class="orb-btn" id="tile-weather" aria-label="Weather"><i class="fa-solid fa-cloud-sun-rain"></i></button>
                        </div>

                        <!-- FILTER ORB -->
                        <div class="nexus-orb-wrapper">
                            <div class="nexus-preview-tooltip" id="filter-preview-tooltip"></div>
                            <button class="orb-btn nexus-trigger" id="toggle-filter-modal" aria-label="Filters">
                                <i class="fa-solid fa-filter"></i>
                                <div id="filter-active-dot" class="active-pulse-dot"></div>
                            </button>
                        </div>

                        <!-- SETTINGS ORB -->
                        <div class="nexus-orb-wrapper">
                            <div class="nexus-preview-tooltip" id="settings-preview-tooltip"></div>
                            <button class="orb-btn" id="tile-settings" aria-label="Settings">
                                <i class="fa-solid fa-gear"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const container = document.getElementById('sector-ops-map-fullscreen');
        if (container) container.insertAdjacentHTML('beforeend', html);
    },

    attachListeners() {
        const modalOverlay = document.getElementById('filter-modal-overlay');
        const filterBtn = document.getElementById('toggle-filter-modal');
        const settingsBtn = document.getElementById('tile-settings');
        const closeBtn = document.getElementById('close-filter-modal');
        const applyBtn = document.getElementById('apply-filters-btn');
        const clearBtn = document.getElementById('clear-filters-btn');
        const serverSelector = document.getElementById('server-selector');
        
        const weatherWrapper = document.getElementById('weather-menu-wrapper');
        const weatherTrigger = document.getElementById('tile-weather');

        // Hover Previews
        filterBtn?.addEventListener('mouseenter', () => this.showPreview('filters'));
        filterBtn?.addEventListener('mouseleave', () => this.hidePreview('filters'));
        settingsBtn?.addEventListener('mouseenter', () => this.showPreview('settings'));
        settingsBtn?.addEventListener('mouseleave', () => this.hidePreview('settings'));

        // Weather Menu Logic
        weatherTrigger?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._weatherMenuOpen = !this._weatherMenuOpen;
            weatherWrapper.classList.toggle('expanded', this._weatherMenuOpen);
        });

        document.addEventListener('click', (e) => {
            if (!weatherWrapper?.contains(e.target)) {
                this._weatherMenuOpen = false;
                weatherWrapper?.classList.remove('expanded');
            }
        });

        document.querySelectorAll('.spread-opt').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isActive = btn.classList.toggle('active');
                const weatherType = btn.dataset.weather;
                window.dispatchEvent(new CustomEvent('weatherToggle', { 
                    detail: { type: weatherType, isActive: isActive } 
                }));
            });
        });

        serverSelector?.addEventListener('click', (e) => {
            e.stopPropagation();
            serverSelector.classList.toggle('open');
        });

        document.addEventListener('click', () => {
            serverSelector?.classList.remove('open');
        });

        document.querySelectorAll('.server-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                const val = e.target.dataset.val;
                this._currentServer = val;
                document.getElementById('landing-server-name').textContent = `${val.toUpperCase()} SERVER`;
                window.dispatchEvent(new CustomEvent('serverChange', { detail: { server: val } }));
            });
        });

        const toggleModal = (state) => {
            this._modalOpen = state;
            modalOverlay.classList.toggle('open', state);
            if (state) this.refreshUI();
        };

        filterBtn?.addEventListener('click', () => toggleModal(true));
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

        document.querySelectorAll('.nexus-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.filterId;
                this.activateFilter(id);
            });
        });
        
        document.getElementById('blade-search-input')?.addEventListener('input', () => {
            this.dispatchFilterUpdate();
        });
    },

    showPreview(type) {
        const tooltip = document.getElementById(`${type}-preview-tooltip`);
        if (!tooltip) return;

        let content = '';
        if (type === 'filters') {
            const activeKeys = Object.keys(this._activeFilters);
            if (activeKeys.length === 0) {
                content = `<div class="preview-empty">No active filters</div>`;
            } else {
                content = activeKeys.map(id => {
                    const def = this.allFilters.find(f => f.id === id);
                    const val = this._activeFilters[id];
                    let displayVal = '';
                    
                    if (def.type === 'range') {
                        displayVal = `${val.min || 0} - ${val.max || 'Max'}`;
                    } else if (def.type === 'boolean') {
                        displayVal = 'ON';
                    } else {
                        displayVal = val || 'Any';
                    }

                    return `
                        <div class="preview-line">
                            <i class="fa-solid ${def.icon}"></i>
                            <span class="preview-label">${def.label}:</span>
                            <span class="preview-value">${displayVal}</span>
                        </div>
                    `;
                }).join('');
            }
        } else {
            // Settings Preview
            content = `
                <div class="preview-line">
                    <i class="fa-solid fa-server"></i>
                    <span class="preview-label">Server:</span>
                    <span class="preview-value">${this._currentServer}</span>
                </div>
                <div class="preview-line">
                    <i class="fa-solid fa-earth-americas"></i>
                    <span class="preview-label">Region:</span>
                    <span class="preview-value">Global</span>
                </div>
            `;
        }

        tooltip.innerHTML = `
            <div class="preview-header">${type.toUpperCase()} STATUS</div>
            <div class="preview-body">${content}</div>
            <div class="preview-footer">Click icon to open full window</div>
        `;
        tooltip.classList.add('visible');
    },

    hidePreview(type) {
        const tooltip = document.getElementById(`${type}-preview-tooltip`);
        tooltip?.classList.remove('visible');
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
        const activeDot = document.getElementById('filter-active-dot');
        if (!container) return;

        const activeEntries = Object.entries(this._activeFilters);
        if (badge) badge.textContent = `${activeEntries.length} Rule${activeEntries.length !== 1 ? 's' : ''}`;
        
        // Update the pulse dot on the filter icon
        if (activeDot) activeDot.style.opacity = activeEntries.length > 0 ? '1' : '0';

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
                        <div class="row-control">${this.renderInputControl(id, value)}</div>
                    </div>
                </div>
            `;
        }).join('');

        // Re-attach input listeners
        container.querySelectorAll('.js-remove-filter').forEach(btn => {
            btn.addEventListener('click', (e) => this.removeFilter(e.currentTarget.dataset.id));
        });
        container.querySelectorAll('.data-input').forEach(input => {
            input.addEventListener('input', (e) => this.updateFilterValue(e.target.dataset.id, e.target.value));
        });
        container.querySelectorAll('.data-input-min').forEach(input => {
            input.addEventListener('input', (e) => this.updateFilterValue(e.target.dataset.id, e.target.value, 'min'));
        });
        container.querySelectorAll('.data-input-max').forEach(input => {
            input.addEventListener('input', (e) => this.updateFilterValue(e.target.dataset.id, e.target.value, 'max'));
        });
    },

    dispatchFilterUpdate() {
        const quickSearch = document.getElementById('blade-search-input')?.value || '';
        window.dispatchEvent(new CustomEvent('filterUpdate', {
            detail: { filters: { ...this._activeFilters }, quickSearch }
        }));
    },

    update(isActive, stats = {}) {
        const el = document.getElementById('inflight-tactical-ui');
        if (!el) return;
        isActive ? el.classList.add('active') : el.classList.remove('active');
    },

    injectStyles() {
        const css = `
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

            .tactical-ui-root { position: absolute; inset: 0; z-index: 2000; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity 0.5s ease; font-family: 'Inter', sans-serif; }
            .tactical-ui-root.active { opacity: 1; visibility: visible; }
            
            /* HOVER PREVIEW TOOLTIP */
            .nexus-orb-wrapper { position: relative; pointer-events: auto; }
            .nexus-preview-tooltip {
                position: absolute; bottom: calc(100% + 15px); right: 0;
                width: 200px; background: rgba(10, 10, 12, 0.85); 
                backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 12px; padding: 12px; color: #fff;
                opacity: 0; transform: translateY(10px); visibility: hidden;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 20px 40px rgba(0,0,0,0.5); z-index: 4000;
                pointer-events: none;
            }
            .nexus-preview-tooltip.visible { opacity: 1; transform: translateY(0); visibility: visible; }
            
            .preview-header { font-size: 0.6rem; font-weight: 800; color: #71717a; letter-spacing: 1px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px; }
            .preview-body { display: flex; flex-direction: column; gap: 6px; }
            .preview-line { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; }
            .preview-line i { width: 14px; text-align: center; color: #38bdf8; font-size: 0.7rem; }
            .preview-label { color: #a1a1aa; }
            .preview-value { font-weight: 600; color: #fff; }
            .preview-empty { font-size: 0.75rem; color: #52525b; font-style: italic; }
            .preview-footer { margin-top: 10px; font-size: 0.6rem; color: #38bdf8; font-weight: 500; opacity: 0.8; }

            /* PULSE DOT */
            .active-pulse-dot {
                position: absolute; top: 0; right: 0; width: 8px; height: 8px;
                background: #38bdf8; border-radius: 50%; border: 2px solid #000;
                opacity: 0; transition: opacity 0.3s;
            }

            /* SERVER DROPDOWN STYLES */
            .top-branding.dropdown { 
                position: absolute; top: 30px; left: 40px; 
                display: flex; align-items: center; gap: 12px; 
                pointer-events: auto; background: rgba(0,0,0,0.6); 
                padding: 8px 18px; border-radius: 30px; 
                backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); 
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                cursor: pointer; transition: all 0.2s;
            }
            .top-branding.dropdown:hover { background: rgba(20,20,20,0.8); border-color: rgba(255,255,255,0.2); }
            .branding-content { display: flex; align-items: center; gap: 10px; }
            .dropdown-arrow { font-size: 0.6rem; color: #71717a; transition: transform 0.2s; }
            .top-branding.dropdown.open .dropdown-arrow { transform: rotate(180deg); }
            
            .server-menu { 
                position: absolute; top: calc(100% + 10px); left: 0; width: 100%;
                background: #18181b; border: 1px solid #3f3f46; border-radius: 12px;
                overflow: hidden; opacity: 0; transform: translateY(-10px);
                visibility: hidden; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            }
            .top-branding.dropdown.open .server-menu { opacity: 1; transform: translateY(0); visibility: visible; }
            .server-option { padding: 10px 18px; color: #a1a1aa; font-size: 0.75rem; font-weight: 600; transition: all 0.2s; border-bottom: 1px solid rgba(255,255,255,0.03); }
            .server-option:hover { background: rgba(56, 189, 248, 0.1); color: #38bdf8; }

            .status-dot { width: 6px; height: 6px; background: #10b981; border-radius: 50%; box-shadow: 0 0 10px #10b981; }
            #landing-server-name { font-size: 0.7rem; font-weight: 700; color: #fff; letter-spacing: 0.5px; white-space: nowrap; }

            /* WEATHER EXPANSION */
            .weather-nexus-container { position: relative; display: flex; flex-direction: column-reverse; align-items: center; gap: 12px; }
            .weather-spread {
                display: flex; flex-direction: column-reverse; align-items: center; gap: 8px; opacity: 0;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                position: absolute; bottom: calc(100% + 10px); left: 50%;
                transform-origin: bottom center; transform: translateX(-50%) translateY(20px) scale(0.9);
                pointer-events: none;
            }
            .weather-nexus-container.expanded .weather-spread { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); pointer-events: auto; }
            .spread-opt {
                width: auto; min-width: 42px; height: 42px; padding: 0 16px; border-radius: 21px;
                background: rgba(15, 15, 15, 0.85); backdrop-filter: blur(15px);
                border: 1px solid rgba(255, 255, 255, 0.15); color: rgba(255, 255, 255, 0.6);
                cursor: pointer; display: flex; align-items: center; gap: 10px; transition: all 0.2s ease;
                white-space: nowrap; box-shadow: 0 8px 25px rgba(0,0,0,0.5);
            }
            .spread-opt i { font-size: 0.9rem; width: 18px; text-align: center; }
            .spread-label { font-size: 0.75rem; font-weight: 600; opacity: 0; max-width: 0; overflow: hidden; transition: all 0.3s; }
            .weather-nexus-container.expanded .spread-label { opacity: 1; max-width: 150px; margin-right: 4px; }
            .spread-opt:hover { background: #282828; color: #fff; border-color: rgba(56, 189, 248, 0.5); transform: scale(1.05); }
            .spread-opt.active { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border-color: rgba(56, 189, 248, 0.5); }

            /* MODAL & UI CORE */
            .filter-modal {
                background: #121214; width: 850px; height: 580px; max-width: 95vw; max-height: 85vh;
                border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px;
                box-shadow: 0 50px 100px -20px rgba(0,0,0,0.9);
                display: flex; flex-direction: column; overflow: hidden; pointer-events: auto;
                animation: modalPop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes modalPop { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }

            .modal-header { height: 70px; padding: 0 24px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); display: flex; justify-content: space-between; align-items: center; }
            .header-main { display: flex; align-items: center; gap: 16px; color: #fff; }
            .header-icon-box { width: 30px; height: 30px; background: rgba(56, 189, 248, 0.1); border-radius: 8px; color: #38bdf8; display: grid; place-items: center; }
            .header-text h2 { margin: 0; font-size: 1.1rem; font-weight: 700; }
            .header-text span { font-size: 0.75rem; color: #94a3b8; }
            .close-modal { background: none; border: none; color: #64748b; font-size: 1.5rem; cursor: pointer; }

            .modal-body { display: flex; flex: 1; overflow: hidden; }
            .filter-selection-pane { width: 260px; background: rgba(0,0,0,0.2); border-right: 1px solid rgba(255,255,255,0.06); padding: 20px 16px; overflow-y: auto; }
            .filter-group-header { font-size: 0.7rem; color: #52525b; font-weight: 800; text-transform: uppercase; margin-bottom: 10px; letter-spacing: 1px; }
            
            .nexus-item { background: transparent; border: none; width: 100%; padding: 10px 12px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s; color: #a1a1aa; position: relative; }
            .nexus-item:hover { background: rgba(255,255,255,0.04); color: #e4e4e7; }
            .nexus-item.active { background: rgba(56, 189, 248, 0.1); color: #38bdf8; }
            .nexus-item.active::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: #38bdf8; }
            
            .filter-config-pane { flex: 1; padding: 24px; display: flex; flex-direction: column; background: #18181b; position: relative; }
            .modal-active-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding-bottom: 60px; }
            .modal-footer-embedded { position: absolute; bottom: 0; left: 0; right: 0; padding: 16px 24px; background: #18181b; border-top: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: flex-end; gap: 12px; }
            .modal-btn { padding: 8px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; border: none; font-size: 0.85rem; }
            .modal-btn.primary { background: #38bdf8; color: #0f172a; }

            .modal-filter-card { background: #202023; border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; display: flex; overflow: hidden; }
            .card-left-strip { width: 4px; background: #38bdf8; opacity: 0.7; }
            .card-content { flex: 1; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
            
            .row-input, .row-input-select { width: 100%; background: #121214; border: 1px solid #3f3f46; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 0.85rem; outline: none; }
            .range-pill-container { display: flex; background: #121214; border: 1px solid #3f3f46; border-radius: 6px; align-items: center; overflow: hidden; }
            .range-half { flex: 1; display: flex; align-items: center; position: relative; }
            .range-input { width: 100%; background: transparent; border: none; color: #fff; padding: 8px 8px 8px 36px; outline: none; font-size: 0.85rem; }
            .range-label { position: absolute; left: 10px; font-size: 0.6rem; font-weight: 700; color: #52525b; }
            .range-divider { width: 1px; height: 20px; background: #27272a; }

            .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden; transition: all 0.3s; z-index: 3000; pointer-events: auto; }
            .modal-overlay.open { opacity: 1; visibility: visible; }
            
            .utility-nexus { position: absolute; bottom: 40px; right: 40px; pointer-events: none; }
            .orb-row { display: flex; gap: 10px; pointer-events: auto; align-items: flex-end; }
            .orb-btn { width: 42px; height: 42px; border-radius: 50%; background: rgba(15, 15, 15, 0.6); backdrop-filter: blur(15px); border: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.7); cursor: pointer; display: grid; place-items: center; transition: all 0.2s; position: relative; }
            .orb-btn:hover { transform: translateY(-4px); background: #1e1e1e; color: #fff; border-color: rgba(255,255,255,0.4); box-shadow: 0 5px 15px rgba(0,0,0,0.5); }

            .top-right-actions { position: absolute; top: 30px; right: 40px; pointer-events: auto; }
            .search-blade { background: rgba(10, 10, 10, 0.8); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 100px; height: 38px; width: 220px; display: flex; align-items: center; padding: 0 14px; transition: all 0.3s; }
            .search-blade:focus-within { width: 300px; border-color: #38bdf8; }
            #blade-search-input { flex: 1; background: none; border: none; color: #fff; margin-left: 10px; outline: none; font-size: 13px; }
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