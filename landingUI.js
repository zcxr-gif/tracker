/**
 * LandingUI.js
 * REDESIGN: Tactical Modal - Advanced Centralized Filter Engine
 * UPDATED: Mobile-First Architecture, Safe-Area Awareness & Adaptive Overlap Prevention
 * FULL EXPANSION: No condensation of styles or logic.
 */

export const LandingUI = {
    _isVisible: false,
    _modalOpen: false,
    _weatherMenuOpen: false,
    _activeFilters: {}, 
    _currentServer: 'Expert', // Default server
    _searchCursorIndex: -1, // Track keyboard navigation
    _currentMatches: [],

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
                { id: 'country', label: 'Country Registry', icon: 'fa-globe', type: 'select', options: [] },
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

    handleLocalSearch(query) {
        const resultsContainer = document.getElementById('blade-search-results');
        const searchBlade = document.querySelector('.search-blade');

        if (!query || query.length < 2) {
            this._currentMatches = [];
            this._searchCursorIndex = -1;
            if (resultsContainer) {
                resultsContainer.innerHTML = '';
                resultsContainer.classList.remove('visible');
                if (searchBlade) {
                    searchBlade.classList.remove('has-results');
                }
            }
            return;
        }

        const flights = window.getLiveFlightData ? window.getLiveFlightData() : [];
        const upperQuery = query.toUpperCase();

        this._currentMatches = flights.filter(f => {
            const p = f.properties;
            const callsignMatch = p.callsign?.toUpperCase().includes(upperQuery);
            const userMatch = p.username?.toUpperCase().includes(upperQuery);
            const aircraftMatch = p.aircraftName?.toUpperCase().includes(upperQuery);
            return callsignMatch || userMatch || aircraftMatch;
        }).slice(0, 15);

        this._searchCursorIndex = -1;

        if (this._currentMatches.length > 0 && searchBlade) {
            searchBlade.classList.add('has-results');
        } else if (searchBlade) {
            searchBlade.classList.remove('has-results');
        }

        this.renderSearchResults(query);
    },

    highlightText(text, query) {
        if (!query || !text) return text;
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<span class="premium-highlight">$1</span>');
    },

    renderSearchResults(query) {
        const container = document.getElementById('blade-search-results');
        if (!container) return;
        
        if (this._currentMatches.length === 0) {
            container.innerHTML = `
                <div class="premium-empty-state">
                    <p>No matches found</p>
                </div>
            `;
        } else {
            container.innerHTML = this._currentMatches.map((f, idx) => `
                <div class="premium-result-item ${this._searchCursorIndex === idx ? 'selected' : ''}" 
                     data-index="${idx}"
                     onclick="LandingUI.executeSearchClick('${f.properties.flightId}', ${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]})">
                    
                    <div class="res-meta-icon">
                        <i class="fa-solid fa-circle"></i>
                    </div>

                    <div class="res-info-main">
                        <div class="res-primary-row">
                            <span class="res-callsign">${this.highlightText(f.properties.callsign || 'N/A', query)}</span>
                            <span class="res-pill">${this.highlightText(f.properties.aircraftName || '---', query)}</span>
                        </div>
                        <div class="res-secondary-row">
                            <span class="res-pilot">${this.highlightText(f.properties.username || 'Anonymous', query)}</span>
                        </div>
                    </div>

                    <div class="res-stats">
                        <span class="res-altitude">${Math.round(f.properties.altitude || 0).toLocaleString()}<span>ft</span></span>
                    </div>
                </div>
            `).join('');
        }
        
        container.classList.add('visible');
    },

    executeSearchClick(id, lat, lon) {
        if (window.handleSearchResultClick) {
            window.handleSearchResultClick(id, lat, lon);
        }
        const searchResults = document.getElementById('blade-search-results');
        const searchBlade = document.querySelector('.search-blade');
        const searchInput = document.getElementById('blade-search-input');
        
        if (searchResults) searchResults.classList.remove('visible');
        if (searchBlade) searchBlade.classList.remove('has-results');
        if (searchInput) {
            searchInput.blur();
            searchInput.value = '';
        }
    },

    render() {
        const existing = document.getElementById('inflight-tactical-ui');
        if (existing) existing.remove();

        this.allFilters = [];
        Object.values(this.filterGroups).forEach(group => this.allFilters.push(...group.filters));

        const html = `
            <div id="inflight-tactical-ui" class="tactical-ui-root">
                
                <div class="top-interface-bar">
                    <!-- SERVER SELECTOR -->
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

                    <!-- SEARCH BAR -->
                    <div class="search-blade">
                        <i class="fa-solid fa-magnifying-glass search-icon"></i>
                        <input type="text" id="blade-search-input" placeholder="Search..." autocomplete="off">
                        <div class="search-shortcut">⌘K</div>
                        <div id="blade-search-results" class="search-results-dropdown custom-scroll"></div>
                    </div>
                </div>

                <!-- FILTER MODAL -->
                <div id="filter-modal-overlay" class="modal-overlay">
                    <div class="filter-modal">
                        <div class="modal-header">
                            <div class="header-main">
                                <div class="header-icon-box"><i class="fa-solid fa-sliders-h"></i></div>
                                <div class="header-text">
                                    <h2>Tactical Filters</h2>
                                    <span>Refine visualization</span>
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
                                    </div>
                                </div>
                                <div class="modal-footer-embedded">
                                    <button class="modal-btn secondary" id="clear-filters-btn">Reset</button>
                                    <button class="modal-btn primary" id="apply-filters-btn">Apply</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- BOTTOM UTILITY NEXUS -->
                <div class="utility-nexus">
                    <div class="orb-row">
                        <!-- WEATHER NEXUS -->
                        <div class="weather-nexus-container" id="weather-menu-wrapper">
                            <div class="weather-spread">
                                <button class="spread-opt" data-weather="precip">
                                    <i class="fa-solid fa-satellite-dish"></i>
                                    <span class="spread-label">Radar</span>
                                </button>
                                <button class="spread-opt" data-weather="sigmets">
                                    <i class="fa-solid fa-triangle-exclamation"></i>
                                    <span class="spread-label">SIGMETs</span>
                                </button>
                                <button class="spread-opt" data-weather="clouds">
                                    <i class="fa-solid fa-cloud"></i>
                                    <span class="spread-label">Clouds</span>
                                </button>
                                <button class="spread-opt" data-weather="wind">
                                    <i class="fa-solid fa-wind"></i>
                                    <span class="spread-label">Wind</span>
                                </button>
                            </div>
                            <button class="orb-btn" id="tile-weather" aria-label="Weather">
                                <i class="fa-solid fa-cloud-sun-rain"></i>
                            </button>
                        </div>

                        <!-- FILTER ORB -->
                        <div class="nexus-orb-wrapper">
                            <div class="nexus-preview-tooltip" id="filters-preview-tooltip"></div>
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
        if (container) {
            container.insertAdjacentHTML('beforeend', html);
        }
    },

    attachListeners() {
        const modalOverlay = document.getElementById('filter-modal-overlay');
        const filterBtn = document.getElementById('toggle-filter-modal');
        const settingsBtn = document.getElementById('tile-settings');
        const searchInput = document.getElementById('blade-search-input');
        const searchResults = document.getElementById('blade-search-results');
        const searchBlade = document.querySelector('.search-blade');
        const serverSelector = document.getElementById('server-selector');
        const weatherTrigger = document.getElementById('tile-weather');
        const weatherWrapper = document.getElementById('weather-menu-wrapper');
        
        window.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                searchInput?.focus();
            }

            if (searchResults?.classList.contains('visible')) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this._searchCursorIndex = Math.min(this._searchCursorIndex + 1, this._currentMatches.length - 1);
                    this.renderSearchResults(searchInput.value);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this._searchCursorIndex = Math.max(this._searchCursorIndex - 1, 0);
                    this.renderSearchResults(searchInput.value);
                } else if (e.key === 'Enter' && this._searchCursorIndex >= 0) {
                    const selected = this._currentMatches[this._searchCursorIndex];
                    this.executeSearchClick(selected.properties.flightId, selected.geometry.coordinates[1], selected.geometry.coordinates[0]);
                }
            }
        });

        searchInput?.addEventListener('input', (e) => {
            this.handleLocalSearch(e.target.value);
        });

        document.addEventListener('click', (e) => {
            if (searchResults && !searchBlade?.contains(e.target)) {
                searchResults.classList.remove('visible');
                if (searchBlade) searchBlade.classList.remove('has-results');
            }
        });

        filterBtn?.addEventListener('mouseenter', () => this.showPreview('filters'));
        filterBtn?.addEventListener('mouseleave', () => this.hidePreview('filters'));
        settingsBtn?.addEventListener('mouseenter', () => this.showPreview('settings'));
        settingsBtn?.addEventListener('mouseleave', () => this.hidePreview('settings'));

        weatherTrigger?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._weatherMenuOpen = !this._weatherMenuOpen;
            weatherWrapper?.classList.toggle('expanded', this._weatherMenuOpen);
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
            weatherWrapper?.classList.remove('expanded');
            this._weatherMenuOpen = false;
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
            modalOverlay?.classList.toggle('open', state);
            if (state) {
                this.refreshUI();
            }
        };

        filterBtn?.addEventListener('click', () => toggleModal(true));
        document.getElementById('close-filter-modal')?.addEventListener('click', () => toggleModal(false));
        document.getElementById('apply-filters-btn')?.addEventListener('click', () => {
            this.dispatchFilterUpdate();
            toggleModal(false);
        });
        
        document.getElementById('clear-filters-btn')?.addEventListener('click', () => {
            this._activeFilters = {};
            this.refreshUI();
            this.dispatchFilterUpdate();
        });

        modalOverlay?.addEventListener('click', (e) => {
            if (e.target === modalOverlay) toggleModal(false);
        });

        document.querySelectorAll('.nexus-item').forEach(item => {
            item.addEventListener('click', () => this.activateFilter(item.dataset.filterId));
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
            content = `
                <div class="preview-line">
                    <i class="fa-solid fa-server"></i>
                    <span class="preview-label">Server:</span>
                    <span class="preview-value">${this._currentServer}</span>
                </div>
            `;
        }

        tooltip.innerHTML = `
            <div class="preview-header">${type.toUpperCase()}</div>
            <div class="preview-body">${content}</div>
        `;
        tooltip.classList.add('visible');
    },

    hidePreview(type) {
        document.getElementById(`${type}-preview-tooltip`)?.classList.remove('visible');
    },

    activateFilter(id) {
        if (!this._activeFilters[id]) {
            const def = this.allFilters.find(f => f.id === id);
            if (def.type === 'range') {
                this._activeFilters[id] = { min: '', max: '' };
            } else if (def.type === 'boolean') {
                this._activeFilters[id] = true;
            } else if (def.type === 'select') {
                this._activeFilters[id] = def.options[0];
            } else {
                this._activeFilters[id] = '';
            }
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

    refreshUI() {
        const container = document.getElementById('modal-active-filters');
        const badge = document.getElementById('active-count-badge');
        const activeDot = document.getElementById('filter-active-dot');
        if (!container) return;

        const activeEntries = Object.entries(this._activeFilters);
        if (badge) badge.textContent = `${activeEntries.length} Rule${activeEntries.length !== 1 ? 's' : ''}`;
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
                </div>
            `;
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
                            <button class="row-remove js-remove-filter" data-id="${id}">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                        <div class="row-control">${this.renderInputControl(id, value)}</div>
                    </div>
                </div>
            `;
        }).join('');

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

    renderInputControl(id, value) {
        const def = this.allFilters.find(f => f.id === id);
        
        if (def.type === 'select') {
            return `
                <div class="input-wrapper select-wrapper">
                    <select class="row-input-select data-input" data-id="${id}">
                        ${def.options.map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                    </select>
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
            return `<div class="bool-indicator"><i class="fa-solid fa-check"></i> Enabled</div>`;
        }
        
        return `
            <div class="input-wrapper">
                <input type="text" class="row-input data-input" data-id="${id}" placeholder="${def.placeholder || 'Value...'}" value="${value}">
            </div>
        `;
    },

    dispatchFilterUpdate() {
        const quickSearch = document.getElementById('blade-search-input')?.value || '';
        window.dispatchEvent(new CustomEvent('filterUpdate', { 
            detail: { filters: { ...this._activeFilters }, quickSearch } 
        }));
    },

    update(isActive, stats = {}) {
        const el = document.getElementById('inflight-tactical-ui');
        if (el) {
            isActive ? el.classList.add('active') : el.classList.remove('active');
        }
    },

    injectStyles() {
        const css = `
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

            :root {
                --ui-bg: rgba(10, 10, 12, 0.9);
                --accent: #38bdf8;
                --safe-top: env(safe-area-inset-top, 0px);
                --safe-bottom: env(safe-area-inset-bottom, 0px);
                --safe-left: env(safe-area-inset-left, 0px);
                --safe-right: env(safe-area-inset-right, 0px);
            }

            .tactical-ui-root {
                position: fixed;
                inset: 0;
                z-index: 2000;
                pointer-events: none;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.5s ease;
                font-family: 'Inter', sans-serif;
                overflow: hidden;
            }
            .tactical-ui-root.active {
                opacity: 1;
                visibility: visible;
            }

            /* ADAPTIVE HEADER BAR */
            .top-interface-bar {
                position: absolute;
                top: calc(20px + var(--safe-top));
                left: calc(20px + var(--safe-left));
                right: calc(20px + var(--safe-right));
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 15px;
                pointer-events: auto;
            }

            .top-branding.dropdown {
                background: var(--ui-bg);
                backdrop-filter: blur(15px);
                padding: 10px 20px;
                border-radius: 100px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: #fff;
                display: flex;
                align-items: center;
                gap: 12px;
                cursor: pointer;
                transition: 0.3s;
                flex-shrink: 0;
            }

            .status-dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 10px #10b981; }
            #landing-server-name { font-size: 0.75rem; font-weight: 800; letter-spacing: 0.5px; }
            
            .search-blade {
                background: var(--ui-bg);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 100px;
                height: 44px;
                width: 260px;
                display: flex;
                align-items: center;
                padding: 0 18px;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                position: relative;
            }
            .search-blade:focus-within { width: 340px; border-color: var(--accent); }
            
            #blade-search-input {
                flex: 1;
                background: none;
                border: none;
                color: #fff;
                margin-left: 10px;
                outline: none;
                font-size: 0.9rem;
            }
            .search-shortcut {
                background: rgba(255, 255, 255, 0.1);
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 0.6rem;
                color: rgba(255, 255, 255, 0.5);
                margin-left: 8px;
            }

            /* SEARCH DROPDOWN */
            .search-results-dropdown {
                position: absolute;
                top: calc(100% + 10px);
                right: 0;
                width: 100%;
                background: #0f0f11;
                border-radius: 16px;
                border: 1px solid rgba(255,255,255,0.1);
                max-height: 350px;
                overflow-y: auto;
                display: none;
                z-index: 1001;
                box-shadow: 0 20px 40px rgba(0,0,0,0.5);
            }
            .search-results-dropdown.visible { display: block; }
            .premium-result-item { padding: 12px 18px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); }
            .premium-result-item:hover { background: rgba(255,255,255,0.05); }
            .res-callsign { font-weight: 700; color: #fff; font-size: 0.9rem; }
            .res-pill { font-size: 0.65rem; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; margin-left: 8px; color: #aaa; }
            .res-pilot { font-size: 0.75rem; color: #777; margin-top: 4px; display: block; }

            /* UTILITY NEXUS (BOTTOM) */
            .utility-nexus {
                position: absolute;
                bottom: calc(30px + var(--safe-bottom));
                right: calc(30px + var(--safe-right));
                pointer-events: auto;
            }
            .orb-row { display: flex; gap: 12px; align-items: flex-end; }
            .orb-btn {
                width: 54px; height: 54px; border-radius: 50%;
                background: var(--ui-bg); backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.15); color: #fff;
                display: grid; place-items: center; cursor: pointer;
                transition: 0.3s; font-size: 1.2rem;
            }
            .orb-btn:hover { border-color: var(--accent); transform: scale(1.1); }

            /* WEATHER EXPANSION */
            .weather-nexus-container { position: relative; }
            .weather-spread {
                position: absolute; bottom: 70px; right: 0;
                display: flex; flex-direction: column; gap: 8px;
                opacity: 0; visibility: hidden; transform: translateY(10px);
                transition: 0.3s ease;
            }
            .weather-nexus-container.expanded .weather-spread { opacity: 1; visibility: visible; transform: translateY(0); }
            .spread-opt {
                background: var(--ui-bg); backdrop-filter: blur(10px);
                border: 1px solid rgba(255,255,255,0.1); color: #fff;
                padding: 10px 18px; border-radius: 30px; display: flex;
                align-items: center; gap: 10px; cursor: pointer; white-space: nowrap;
                font-size: 0.8rem; font-weight: 600;
            }
            .spread-opt.active { background: var(--accent); color: #000; }

            /* MODAL SYSTEM (MOBILE FRIENDLY) */
            .modal-overlay {
                position: fixed; inset: 0; background: rgba(0,0,0,0.8);
                display: flex; align-items: center; justify-content: center;
                opacity: 0; visibility: hidden; transition: 0.4s;
                padding: 20px; z-index: 5000; pointer-events: auto;
            }
            .modal-overlay.open { opacity: 1; visibility: visible; }
            
            .filter-modal {
                background: #0d0d0f;
                width: 900px; max-width: 100%;
                height: 600px; max-height: 100%;
                border-radius: 24px; border: 1px solid rgba(255,255,255,0.1);
                display: flex; flex-direction: column; overflow: hidden;
                box-shadow: 0 40px 100px rgba(0,0,0,0.8);
            }

            .modal-header {
                padding: 20px 30px; border-bottom: 1px solid rgba(255,255,255,0.1);
                display: flex; justify-content: space-between; align-items: center;
                flex-shrink: 0;
            }
            .header-text h2 { margin: 0; color: #fff; font-size: 1.2rem; }
            .header-text span { font-size: 0.8rem; color: #555; }
            .close-modal { background: none; border: none; color: #fff; font-size: 2rem; cursor: pointer; }

            .modal-body { display: flex; flex: 1; overflow: hidden; }
            .filter-selection-pane {
                width: 280px; background: rgba(0,0,0,0.2); border-right: 1px solid rgba(255,255,255,0.1);
                padding: 25px; overflow-y: auto; flex-shrink: 0;
            }
            .filter-group-header { font-size: 0.65rem; font-weight: 900; color: #444; text-transform: uppercase; margin: 20px 0 10px; }
            .nexus-item {
                width: 100%; display: flex; align-items: center; gap: 12px;
                background: none; border: none; padding: 10px; border-radius: 10px;
                color: #888; cursor: pointer; text-align: left; font-size: 0.85rem;
            }
            .nexus-item:hover { background: rgba(255,255,255,0.05); color: #fff; }
            .nexus-item.active { background: rgba(56, 189, 248, 0.1); color: var(--accent); }

            .filter-config-pane { flex: 1; padding: 30px; display: flex; flex-direction: column; position: relative; overflow-y: auto; }
            .modal-active-list { flex: 1; display: flex; flex-direction: column; gap: 15px; padding-bottom: 80px; }
            
            .modal-filter-card {
                background: #161618; border-radius: 16px; border: 1px solid rgba(255,255,255,0.05);
                padding: 20px; display: flex; flex-direction: column;
            }
            .row-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
            .row-label { color: #fff; font-weight: 700; display: flex; align-items: center; gap: 10px; }
            .row-remove { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 1rem; }

            .row-input, .row-input-select {
                width: 100%; background: #222; border: 1px solid #333;
                border-radius: 8px; color: #fff; padding: 12px; outline: none;
            }

            .range-pill-container { display: flex; background: #222; border-radius: 8px; border: 1px solid #333; overflow: hidden; }
            .range-half { flex: 1; display: flex; align-items: center; padding: 0 12px; }
            .range-label { font-size: 0.6rem; font-weight: 900; color: #555; margin-right: 10px; }
            .range-input { background: none; border: none; color: #fff; width: 100%; padding: 12px 0; outline: none; }
            .range-divider { width: 1px; background: #333; height: 20px; align-self: center; }

            .modal-footer-embedded {
                position: absolute; bottom: 0; left: 0; right: 0;
                padding: 20px 30px; background: #0d0d0f; border-top: 1px solid rgba(255,255,255,0.1);
                display: flex; justify-content: flex-end; gap: 15px;
            }
            .modal-btn { padding: 12px 24px; border-radius: 12px; font-weight: 700; cursor: pointer; border: none; }
            .modal-btn.primary { background: var(--accent); color: #000; }
            .modal-btn.secondary { background: #222; color: #fff; }

            .bool-indicator { color: #10b981; font-weight: 700; font-size: 0.8rem; }

            /* MOBILE SPECIFIC OVERRIDES */
            @media (max-width: 768px) {
                .top-interface-bar { flex-direction: column; align-items: stretch; top: calc(10px + var(--safe-top)); }
                .search-blade { width: 100% !important; order: 2; }
                .top-branding.dropdown { order: 1; align-self: flex-start; }
                
                .modal-overlay { padding: 0; }
                .filter-modal { border-radius: 0; height: 100%; }
                .modal-body { flex-direction: column; }
                .filter-selection-pane { width: 100%; height: 200px; border-right: none; border-bottom: 1px solid #222; }
                .modal-footer-embedded { position: sticky; bottom: 0; }
                
                .utility-nexus { bottom: calc(20px + var(--safe-bottom)); right: calc(20px + var(--safe-right)); }
                .orb-btn { width: 48px; height: 48px; font-size: 1rem; }
                
                #landing-server-name { font-size: 0.65rem; }
            }

            .active-pulse-dot {
                position: absolute; top: 0; right: 0; width: 12px; height: 12px;
                background: var(--accent); border-radius: 50%; border: 2px solid #000;
                opacity: 0; transition: 0.3s; box-shadow: 0 0 10px var(--accent);
            }

            .custom-scroll::-webkit-scrollbar { width: 5px; }
            .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
            
            .empty-state { text-align: center; padding: 40px; color: #444; }
            .empty-icon-circle { font-size: 2rem; margin-bottom: 10px; opacity: 0.3; }
        `;
        
        const styleId = 'landing-ui-responsive-css';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = css;
            document.head.appendChild(style);
        }
    }
};