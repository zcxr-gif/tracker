/**
 * LandingUI.js
 * REDESIGN: Tactical Modal - Advanced Centralized Filter Engine
 * UPDATED: Seamless Search Connectivity, Keyboard Navigation & Text Highlighting
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

    /**
     * LOCAL SEARCH ENGINE
     * Filter through live flight data and render the panel-style results
     */
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

        this._searchCursorIndex = -1; // Reset selection on new search

        if (this._currentMatches.length > 0 && searchBlade) {
            searchBlade.classList.add('has-results');
            searchBlade.style.borderBottomLeftRadius = '0';
            searchBlade.style.borderBottomRightRadius = '0';
        } else if (searchBlade) {
            searchBlade.classList.remove('has-results');
            searchBlade.style.borderBottomLeftRadius = '100px';
            searchBlade.style.borderBottomRightRadius = '100px';
        }

        this.renderSearchResults(query);
    },

    highlightText(text, query) {
        if (!query || !text) return text;
        const regex = new RegExp(`(${query})`, 'gi');
        return text.replace(regex, '<b class="search-highlight">$1</b>');
    },

    renderSearchResults(query) {
        const container = document.getElementById('blade-search-results');
        if (!container) return;
        
        if (this._currentMatches.length === 0) {
            container.innerHTML = `
                <div class="search-no-results">
                    <i class="fa-solid fa-plane-slash"></i>
                    <span>No matching flights</span>
                </div>
            `;
        } else {
            container.innerHTML = this._currentMatches.map((f, idx) => `
                <div class="search-result-item ${this._searchCursorIndex === idx ? 'selected' : ''}" 
                     data-index="${idx}"
                     onclick="LandingUI.executeSearchClick('${f.properties.flightId}', ${f.geometry.coordinates[1]}, ${f.geometry.coordinates[0]})">
                    <div class="res-main">
                        <span class="res-callsign">${this.highlightText(f.properties.callsign || 'N/A', query)}</span>
                        <span class="res-aircraft">${this.highlightText(f.properties.aircraftName || '', query)}</span>
                    </div>
                    <div class="res-sub">
                        <span class="res-pilot"><i class="fa-solid fa-user"></i> ${this.highlightText(f.properties.username || 'Anonymous', query)}</span>
                        <span class="res-alt">${Math.round(f.properties.altitude || 0)}ft</span>
                    </div>
                </div>
            `).join('');
        }
        
        container.classList.add('visible');
    },

    executeSearchClick(id, lat, lon) {
        if (window.handleSearchResultClick) {
            window.handleSearchResultClick(id, lat, lon);
        } else {
            console.log('Search Execution:', id, lat, lon);
        }
        // Cleanup after click
        const searchResults = document.getElementById('blade-search-results');
        const searchBlade = document.querySelector('.search-blade');
        const searchInput = document.getElementById('blade-search-input');
        
        if (searchResults) searchResults.classList.remove('visible');
        if (searchBlade) {
        }
        if (searchInput) searchInput.blur();
    },

    render() {
        const existing = document.getElementById('inflight-tactical-ui');
        if (existing) existing.remove();

        this.allFilters = [];
        Object.values(this.filterGroups).forEach(group => this.allFilters.push(...group.filters));

        const html = `
            <div id="inflight-tactical-ui" class="tactical-ui-root">
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
                <div class="top-right-actions">
                    <div class="search-blade">
                        <i class="fa-solid fa-magnifying-glass search-icon"></i>
                        <input type="text" id="blade-search-input" placeholder="Quick search..." autocomplete="off">
                        <div class="search-shortcut">⌘K</div>
                        <!-- Search Results Dropdown -->
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

                <!-- BOTTOM UTILITY NEXUS -->
                <div class="utility-nexus">
                    <div class="orb-row">
                        <!-- WEATHER NEXUS -->
                        <div class="weather-nexus-container" id="weather-menu-wrapper">
                            <div class="weather-spread">
                                <button class="spread-opt" data-weather="precip">
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
        
        // Global Keyboard Shortcut
        window.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                searchInput?.focus();
            }

            // Keyboard Navigation Logic
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

        // Search Input Engine
        searchInput?.addEventListener('input', (e) => {
            this.handleLocalSearch(e.target.value);
        });

        // Close Search on Outside Click
        document.addEventListener('click', (e) => {
            if (searchResults && !searchBlade?.contains(e.target)) {
                searchResults.classList.remove('visible');
                if (searchBlade) {
                    searchBlade.style.borderBottomLeftRadius = '100px';
                    searchBlade.style.borderBottomRightRadius = '100px';
                }
            }
        });

        // Hover Tooltips
        filterBtn?.addEventListener('mouseenter', () => this.showPreview('filters'));
        filterBtn?.addEventListener('mouseleave', () => this.hidePreview('filters'));
        settingsBtn?.addEventListener('mouseenter', () => this.showPreview('settings'));
        settingsBtn?.addEventListener('mouseleave', () => this.hidePreview('settings'));

        // Weather Menu
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

        // Server Dropdown
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

        // Filter Modal Controls
        const toggleModal = (state) => {
            this._modalOpen = state;
            modalOverlay?.classList.toggle('open', state);
            if (state) {
                this.refreshUI();
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = '';
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
                <div class="preview-line">
                    <i class="fa-solid fa-earth-americas"></i>
                    <span class="preview-label">Region:</span>
                    <span class="preview-value">Global Airspace</span>
                </div>
            `;
        }

        tooltip.innerHTML = `
            <div class="preview-header">${type.toUpperCase()} STATUS</div>
            <div class="preview-body">${content}</div>
            <div class="preview-footer">Click icon to manage full settings</div>
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
        if (badge) badge.textContent = `${activeEntries.length} Active Rule${activeEntries.length !== 1 ? 's' : ''}`;
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
                        <div class="row-header" style="display:flex; justify-content:space-between; align-items:center;">
                            <div class="row-label">
                                <i class="fa-solid ${def.icon}"></i>
                                <span>${def.label}</span>
                            </div>
                            <button class="row-remove js-remove-filter" data-id="${id}" title="Remove Filter" style="background:none; border:none; color:#ef4444; cursor:pointer; padding:5px;">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                        <div class="row-control">${this.renderInputControl(id, value)}</div>
                    </div>
                </div>
            `;
        }).join('');

        // Re-attach local listeners
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
            return `<div class="bool-indicator" style="font-size:0.8rem; color:#10b981; font-weight:600;"><i class="fa-solid fa-check"></i> Active Policy Enabled</div>`;
        }
        
        return `
            <div class="input-wrapper">
                <input type="text" class="row-input data-input" data-id="${id}" placeholder="${def.placeholder || 'Search value...'}" value="${value}">
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

            .tactical-ui-root {
                position: absolute;
                inset: 0;
                z-index: 2000;
                pointer-events: none;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.5s ease;
                font-family: 'Inter', sans-serif;
            }
            .tactical-ui-root.active {
                opacity: 1;
                visibility: visible;
            }

            /* SEARCH BLADE & CONNECTED DROP-DOWN */
            .top-right-actions {
                position: absolute;
                top: 30px;
                right: 40px;
                pointer-events: auto;
            }
            .search-blade {
    background: rgba(10, 10, 10, 0.85);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 100px;
    height: 44px;
    width: 240px;
    display: flex;
    align-items: center;
    padding: 0 18px;
    /* STRICT TRANSITION: 
       We only animate width and colors. 
       Removing 'border-radius' or 'all' prevents the "bending" animation.
    */
    transition: width 0.25s ease, background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
    position: relative;
    box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    z-index: 1002;
    pointer-events: auto;
}

.search-blade:focus-within {
    width: 380px;
    border-color: #38bdf8;
    background: #0f0f11;
    box-shadow: 0 15px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(56, 189, 248, 0.3);
}
            
            .search-blade.has-results {
    border-bottom-left-radius: 0 !important;
    border-bottom-right-radius: 0 !important;
    border-top-left-radius: 20px !important;
    border-top-right-radius: 20px !important;
}
            #blade-search-input {
                flex: 1;
                background: none;
                border: none;
                color: #fff;
                margin-left: 10px;
                outline: none;
                font-size: 15px;
                font-weight: 500;
            }
            .search-icon {
                color: rgba(255, 255, 255, 0.4);
                font-size: 14px;
            }
            .search-shortcut {
                background: rgba(255, 255, 255, 0.08);
                padding: 3px 8px;
                border-radius: 6px;
                font-size: 0.65rem;
                color: rgba(255, 255, 255, 0.4);
                font-weight: 800;
                margin-left: 10px;
            }

            .search-results-dropdown {
                position: absolute;
                top: 42px; /* Overlaps bottom border of search blade precisely */
                left: -1px;
                right: -1px;
                background: #0f0f11;
                backdrop-filter: blur(25px);
                border: 1px solid #38bdf8;
                border-top: none; /* Look connected */
                border-bottom-left-radius: 20px;
                border-bottom-right-radius: 20px;
                max-height: 420px;
                overflow-y: auto;
                display: none;
                box-shadow: 0 30px 60px rgba(0,0,0,0.8);
                z-index: 1001;
                padding: 8px 0;
            }
            .search-results-dropdown.visible {
                display: block;
            }
            .search-result-item {
                padding: 14px 22px;
                cursor: pointer;
                border-bottom: 1px solid rgba(255, 255, 255, 0.03);
                transition: all 0.2s;
                border-left: 3px solid transparent;
            }
            .search-result-item:hover, .search-result-item.selected {
                background: rgba(56, 189, 248, 0.12);
                border-left-color: #38bdf8;
                padding-left: 28px;
            }
            
            /* Text Highlighting Style */
            .search-highlight {
                color: #38bdf8;
                background: rgba(56, 189, 248, 0.1);
                border-radius: 2px;
                padding: 0 1px;
                font-weight: 800;
            }

            .res-main {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 5px;
            }
            .res-callsign {
                font-weight: 800;
                color: #fff;
                font-size: 1.05rem;
                letter-spacing: 0.5px;
            }
            .res-aircraft {
                font-size: 0.75rem;
                color: rgba(255, 255, 255, 0.4);
                text-transform: uppercase;
                font-weight: 600;
            }
            .res-sub {
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 0.8rem;
            }
            .res-pilot {
                color: #38bdf8;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 5px;
            }
            .res-alt {
                color: #10b981;
                font-family: 'JetBrains Mono', monospace;
                font-weight: 600;
            }
            .search-no-results {
                padding: 50px 20px;
                text-align: center;
                color: rgba(255, 255, 255, 0.3);
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .search-no-results i {
                font-size: 28px;
                opacity: 0.4;
            }

            /* UTILITY NEXUS STYLES */
            .utility-nexus {
                position: absolute;
                bottom: 40px;
                right: 40px;
                pointer-events: none;
            }
            .orb-row {
                display: flex;
                gap: 15px;
                pointer-events: auto;
                align-items: flex-end;
            }
            .orb-btn {
                width: 52px;
                height: 52px;
                border-radius: 50%;
                background: rgba(15, 15, 15, 0.7);
                backdrop-filter: blur(15px);
                border: 1px solid rgba(255, 255, 255, 0.12);
                color: rgba(255, 255, 255, 0.7);
                cursor: pointer;
                display: grid;
                place-items: center;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                position: relative;
                box-shadow: 0 10px 20px rgba(0,0,0,0.3);
                font-size: 1.1rem;
            }
            .orb-btn:hover {
                transform: translateY(-5px);
                background: #fff;
                color: #000;
                border-color: #fff;
                box-shadow: 0 15px 30px rgba(255,255,255,0.25);
            }

            /* TOOLTIPS */
            .nexus-orb-wrapper {
                position: relative;
            }
            .nexus-preview-tooltip {
                position: absolute;
                bottom: calc(100% + 20px);
                right: 0;
                width: 260px;
                background: rgba(10, 10, 12, 0.95);
                backdrop-filter: blur(30px);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 18px;
                padding: 20px;
                color: #fff;
                opacity: 0;
                visibility: hidden;
                transform: translateY(15px);
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 30px 60px rgba(0,0,0,0.6);
                pointer-events: none;
                z-index: 4000;
            }
            .nexus-preview-tooltip.visible {
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }
            .preview-header {
                font-size: 0.65rem;
                font-weight: 900;
                color: #71717a;
                letter-spacing: 1.5px;
                margin-bottom: 14px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                padding-bottom: 8px;
                text-transform: uppercase;
            }
            .preview-line {
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 0.85rem;
                margin-bottom: 10px;
            }
            .preview-line i {
                color: #38bdf8;
                width: 18px;
                text-align: center;
                font-size: 0.8rem;
            }
            .preview-label { color: #a1a1aa; }
            .preview-value { font-weight: 700; color: #fff; margin-left: auto; }
            .preview-footer {
                margin-top: 14px;
                font-size: 0.65rem;
                color: #38bdf8;
                font-weight: 600;
                border-top: 1px solid rgba(255, 255, 255, 0.05);
                padding-top: 10px;
            }

            /* SERVER SELECTOR PANEL STYLE */
            .top-branding.dropdown {
                position: absolute;
                top: 30px;
                left: 40px;
                pointer-events: auto;
                background: rgba(0, 0, 0, 0.7);
                padding: 10px 24px;
                border-radius: 100px;
                backdrop-filter: blur(15px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                cursor: pointer;
                color: #fff;
                display: flex;
                align-items: center;
                gap: 12px;
                box-shadow: 0 10px 20px rgba(0,0,0,0.3);
                transition: all 0.3s;
            }
            .top-branding.dropdown:hover {
                background: rgba(20, 20, 20, 0.9);
                border-color: rgba(255,255,255,0.2);
            }
            .status-dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 12px #10b981; }
            #landing-server-name { font-size: 0.8rem; font-weight: 800; letter-spacing: 1px; }
            .dropdown-arrow { font-size: 0.75rem; opacity: 0.4; transition: transform 0.3s; }
            .top-branding.dropdown.open .dropdown-arrow { transform: rotate(180deg); opacity: 1; }

            .server-menu {
                position: absolute;
                top: calc(100% + 12px);
                left: 0;
                width: 100%;
                background: #18181b;
                border: 1px solid #3f3f46;
                border-radius: 16px;
                display: none;
                flex-direction: column;
                overflow: hidden;
                box-shadow: 0 20px 40px rgba(0,0,0,0.6);
                z-index: 5000;
            }
            .top-branding.dropdown.open .server-menu { display: flex; }
            .server-option {
                padding: 14px 24px;
                font-size: 0.85rem;
                font-weight: 600;
                color: #a1a1aa;
                transition: all 0.2s;
            }
            .server-option:hover {
                background: rgba(56, 189, 248, 0.1);
                color: #38bdf8;
            }

            /* WEATHER EXPANSION STYLE */
            .weather-nexus-container { position: relative; display: flex; flex-direction: column-reverse; align-items: center; gap: 15px; }
            .weather-spread {
                display: flex;
                flex-direction: column-reverse;
                align-items: center;
                gap: 12px;
                opacity: 0;
                visibility: hidden;
                position: absolute;
                bottom: calc(100% + 15px);
                left: 50%;
                transform: translateX(-50%) translateY(20px);
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                pointer-events: none;
            }
            .weather-nexus-container.expanded .weather-spread {
                opacity: 1;
                visibility: visible;
                transform: translateX(-50%) translateY(0);
                pointer-events: auto;
            }
            .spread-opt {
                padding: 12px 20px;
                border-radius: 100px;
                background: rgba(15, 15, 15, 0.95);
                backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: rgba(255, 255, 255, 0.6);
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 14px;
                white-space: nowrap;
                transition: all 0.2s;
                box-shadow: 0 10px 20px rgba(0,0,0,0.4);
            }
            .spread-opt i { font-size: 0.95rem; }
            .spread-label { font-size: 0.8rem; font-weight: 700; }
            .spread-opt:hover { background: #222; color: #fff; border-color: #38bdf8; }
            .spread-opt.active { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border-color: #38bdf8; }

            /* MODAL SYSTEM (TACTICAL PANEL) */
            .modal-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.85);
                backdrop-filter: blur(15px);
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                visibility: hidden;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                z-index: 3000;
                pointer-events: auto;
            }
            .modal-overlay.open { opacity: 1; visibility: visible; }
            
            .filter-modal {
                background: #0a0a0b;
                width: 940px;
                height: 660px;
                max-width: 95vw;
                max-height: 90vh;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 28px;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-shadow: 0 50px 100px rgba(0,0,0,0.9);
                transform: scale(0.96) translateY(20px);
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .modal-overlay.open .filter-modal { transform: scale(1) translateY(0); }

            .modal-header {
                height: 90px;
                padding: 0 40px;
                background: rgba(255, 255, 255, 0.02);
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .header-main { display: flex; align-items: center; gap: 24px; }
            .header-icon-box {
                width: 50px;
                height: 50px;
                background: rgba(56, 189, 248, 0.12);
                border-radius: 14px;
                color: #38bdf8;
                display: grid;
                place-items: center;
                font-size: 1.3rem;
            }
            .header-text h2 { margin: 0; font-size: 1.4rem; font-weight: 800; color: #fff; }
            .header-text span { font-size: 0.9rem; color: #71717a; font-weight: 500; }
            .close-modal { background: none; border: none; color: #71717a; font-size: 2.2rem; cursor: pointer; transition: 0.2s; }
            .close-modal:hover { color: #fff; transform: rotate(90deg); }

            .modal-body { display: flex; flex: 1; overflow: hidden; }
            .filter-selection-pane {
                width: 300px;
                background: rgba(0, 0, 0, 0.3);
                border-right: 1px solid rgba(255, 255, 255, 0.08);
                padding: 30px;
                overflow-y: auto;
            }
            .filter-group-header {
                font-size: 0.7rem;
                font-weight: 900;
                color: #3f3f46;
                text-transform: uppercase;
                letter-spacing: 2px;
                margin-bottom: 18px;
                margin-top: 30px;
            }
            .filter-group-header:first-child { margin-top: 0; }
            
            .nexus-item {
                width: 100%;
                text-align: left;
                background: transparent;
                border: none;
                padding: 14px 18px;
                border-radius: 14px;
                color: #71717a;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 14px;
                transition: all 0.25s;
                margin-bottom: 6px;
            }
            .nexus-item:hover { background: rgba(255, 255, 255, 0.05); color: #fff; }
            .nexus-item.active { background: rgba(56, 189, 248, 0.12); color: #38bdf8; font-weight: 700; }
            .nexus-icon { width: 24px; text-align: center; font-size: 1rem; }

            .filter-config-pane {
                flex: 1;
                padding: 40px;
                background: #0d0d0e;
                display: flex;
                flex-direction: column;
                position: relative;
            }
            .config-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
            .config-header label { font-size: 0.8rem; font-weight: 900; color: #3f3f46; text-transform: uppercase; letter-spacing: 2.5px; }
            #active-count-badge { background: #38bdf8; color: #000; padding: 6px 14px; border-radius: 100px; font-size: 0.75rem; font-weight: 800; }

            .modal-active-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; padding-bottom: 120px; }
            .modal-filter-card {
                background: #141416;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 20px;
                display: flex;
                overflow: hidden;
                box-shadow: 0 8px 30px rgba(0,0,0,0.3);
            }
            .card-left-strip { width: 6px; background: #38bdf8; }
            .card-content { flex: 1; padding: 24px; }
            .row-label { display: flex; align-items: center; gap: 14px; font-size: 1rem; font-weight: 700; color: #fff; }
            .row-label i { color: #38bdf8; opacity: 0.9; }
            .row-control { margin-top: 20px; }

            /* INPUTS */
            .row-input, .row-input-select {
                width: 100%;
                background: #1c1c1f;
                border: 1px solid #2d2d30;
                border-radius: 12px;
                color: #fff;
                padding: 14px 18px;
                font-size: 0.95rem;
                font-family: inherit;
                outline: none;
                transition: all 0.2s;
            }
            .row-input:focus, .row-input-select:focus { border-color: #38bdf8; background: #232326; box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.1); }

            .range-pill-container {
                display: flex;
                background: #1c1c1f;
                border: 1px solid #2d2d30;
                border-radius: 12px;
                overflow: hidden;
            }
            .range-half { flex: 1; display: flex; align-items: center; padding: 0 16px; }
            .range-label { font-size: 0.65rem; font-weight: 900; color: #3f3f46; margin-right: 14px; }
            .range-input { background: none; border: none; color: #fff; width: 100%; padding: 14px 0; outline: none; font-size: 1rem; font-weight: 600; }
            .range-divider { width: 1px; height: 28px; background: #2d2d30; align-self: center; }

            .modal-footer-embedded {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                padding: 30px 40px;
                background: rgba(13, 13, 14, 0.95);
                backdrop-filter: blur(12px);
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                display: flex;
                justify-content: flex-end;
                gap: 20px;
            }
            .modal-btn {
                padding: 14px 32px;
                border-radius: 14px;
                font-weight: 700;
                font-size: 1rem;
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                border: none;
            }
            .modal-btn.primary { background: #38bdf8; color: #000; }
            .modal-btn.primary:hover { transform: translateY(-3px); box-shadow: 0 12px 25px rgba(56, 189, 248, 0.35); }
            .modal-btn.secondary { background: rgba(255, 255, 255, 0.06); color: #fff; border: 1px solid rgba(255, 255, 255, 0.12); }
            .modal-btn.secondary:hover { background: rgba(255, 255, 255, 0.12); }

            .empty-state {
                flex: 1;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                color: #3f3f46;
                text-align: center;
                padding: 40px;
            }
            .empty-icon-circle {
                width: 90px;
                height: 90px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.03);
                border: 2px dashed rgba(255, 255, 255, 0.08);
                display: grid;
                place-items: center;
                font-size: 2.2rem;
                margin-bottom: 24px;
            }
            .empty-state p { margin: 0; color: #a1a1aa; font-weight: 700; font-size: 1.2rem; }
            .empty-state span { font-size: 0.95rem; margin-top: 10px; max-width: 260px; line-height: 1.5; }

            .active-pulse-dot {
                position: absolute;
                top: 0;
                right: 0;
                width: 12px;
                height: 12px;
                background: #38bdf8;
                border-radius: 50%;
                border: 2px solid #0a0a0b;
                opacity: 0;
                transition: opacity 0.3s;
                box-shadow: 0 0 15px #38bdf8;
            }

            .custom-scroll::-webkit-scrollbar { width: 8px; }
            .custom-scroll::-webkit-scrollbar-track { background: transparent; }
            .custom-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 10px; border: 2px solid transparent; background-clip: content-box; }
            .custom-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); border: 2px solid transparent; background-clip: content-box; }

            @keyframes slideIn {
                from { opacity: 0; transform: translateY(12px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .slide-in { animation: slideIn 0.35s forwards; }
        `;
        
        const styleId = 'landing-ui-integrated-css';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = css;
            document.head.appendChild(style);
        }
    }
};