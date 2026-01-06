/**
 * LandingUI.js
 * REDESIGN: Spatial Minimalist Overlay with Universal Filter Logic
 * Focus: High-end typography, ergonomic placement, and zero-box architecture.
 */

export const LandingUI = {
    _isVisible: false,
    _filterShelfOpen: false,
    _activeFilters: new Map(), // Changed to Map to store { filterId: value }
    _currentPendingFilter: null, // The filter currently being "typed" into

    filterOptions: [
        { id: 'type', label: 'Aircraft Type', icon: 'fa-plane', placeholder: 'e.g. A320, B738...' },
        { id: 'airline', label: 'Operator', icon: 'fa-building', placeholder: 'e.g. Delta, Emirates...' },
        { id: 'callsign', label: 'Callsign Prefix', icon: 'fa-id-badge', placeholder: 'e.g. DL, BAW...' },
        { id: 'rank', label: 'Pilot Rank', icon: 'fa-star', placeholder: 'Minimum Grade (1-5)...' },
        { id: 'altitude', label: 'Altitude Range', icon: 'fa-arrows-up-down', placeholder: 'e.g. 35000...' },
        { id: 'speed', label: 'Ground Speed', icon: 'fa-gauge-high', placeholder: 'e.g. 450...' },
        { id: 'heading', label: 'Heading', icon: 'fa-compass', placeholder: '0-360...' },
        { id: 'ground', label: 'Ground Status', icon: 'fa-trowel-bricks', placeholder: 'On ground? (yes/no)' },
        { id: 'inflight', label: 'In-Flight', icon: 'fa-cloud-sun', placeholder: 'In air? (yes/no)' },
        { id: 'origin', label: 'Origin', icon: 'fa-plane-departure', placeholder: 'ICAO (e.g. KJFK)...' },
        { id: 'destination', label: 'Destination', icon: 'fa-plane-arrival', placeholder: 'ICAO (e.g. EGLL)...' },
        { id: 'duration', label: 'Duration', icon: 'fa-hourglass-half', placeholder: 'Minutes flown...' },
        { id: 'proximity', label: 'Proximity', icon: 'fa-bullseye', placeholder: 'NM from you...' },
        { id: 'atc', label: 'ATC Coverage', icon: 'fa-headset', placeholder: 'Frequency...' }
    ],

    presets: [
        { id: 'heavy', label: 'Heavies', filters: { 'type': 'A38,B74,B77,B78' } },
        { id: 'arrivals', label: 'Arrivals', filters: { 'inflight': 'yes' } },
        { id: 'atc-active', label: 'Live ATC', filters: { 'atc': 'any' } }
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
                <div class="side-branding">
                    <div class="status-indicator-dot"></div>
                    <span id="landing-server-name" class="vertical-text">EXPERT SERVER</span>
                </div>

                <div class="search-island-wrapper">
                    <div id="filter-shelf" class="filter-shelf">
                        <div class="shelf-header">
                            <span class="shelf-title">Universal Filters</span>
                            <div class="preset-row">
                                ${this.presets.map(p => `<button class="preset-btn" data-preset="${p.id}">${p.label}</button>`).join('')}
                            </div>
                        </div>
                        <div class="filter-grid">
                            ${this.filterOptions.map(f => `
                                <div class="filter-item" data-filter-id="${f.id}">
                                    <i class="fa-solid ${f.icon}"></i>
                                    <span>${f.label}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="search-island">
                        <div class="search-glow"></div>
                        <button id="toggle-filters" class="filter-trigger" aria-label="Filters">
                            <i class="fa-solid fa-list-ul"></i>
                        </button>
                        <div id="active-tags-container" class="tags-inline"></div>
                        <input type="text" id="tile-search-input" placeholder="Find a flight..." autocomplete="off">
                        <div class="search-divider"></div>
                        <div class="search-hint">ENTER TO APPLY</div>
                    </div>
                </div>

                <div class="utility-cluster">
                    <div class="orb-stack">
                        <button class="orb-btn" id="tile-weather" aria-label="Weather">
                            <i class="fa-solid fa-cloud"></i>
                        </button>
                        <button class="orb-btn" id="tile-settings" aria-label="Settings">
                            <i class="fa-solid fa-sliders"></i>
                        </button>
                        <button class="orb-btn" id="tile-history" aria-label="History">
                            <i class="fa-solid fa-clock"></i>
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
        const searchInput = document.getElementById('tile-search-input');
        const filterToggle = document.getElementById('toggle-filters');
        const filterShelf = document.getElementById('filter-shelf');

        // Toggle Shelf
        filterToggle?.addEventListener('click', () => {
            this._filterShelfOpen = !this._filterShelfOpen;
            filterShelf.classList.toggle('open', this._filterShelfOpen);
            filterToggle.classList.toggle('active', this._filterShelfOpen);
        });

        // Input Logic: Handle Entry and Values
        searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = searchInput.value.trim();
                if (this._currentPendingFilter && val) {
                    this._activeFilters.set(this._currentPendingFilter, val);
                    this._currentPendingFilter = null;
                    searchInput.value = '';
                    this.refreshUI();
                }
            }
        });

        // Filter Selection Logic
        document.querySelectorAll('.filter-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.filterId;
                this.selectFilterForInput(id);
            });
        });

        // Preset Logic
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const presetId = btn.dataset.preset;
                const preset = this.presets.find(p => p.id === presetId);
                if (preset) {
                    Object.entries(preset.filters).forEach(([fid, fval]) => {
                        this._activeFilters.set(fid, fval);
                    });
                    this.refreshUI();
                }
            });
        });

        const actions = {
            'tile-weather': () => document.getElementById('open-weather-settings-btn')?.click(),
            'tile-settings': () => document.getElementById('open-filter-settings-btn')?.click(),
            'tile-server': () => {
                const orb = document.getElementById('tile-server');
                orb.classList.add('orb-pulse');
                setTimeout(() => orb.classList.remove('orb-pulse'), 1000);
            }
        };

        Object.entries(actions).forEach(([id, fn]) => {
            document.getElementById(id)?.addEventListener('click', fn);
        });
    },

    selectFilterForInput(id) {
        const filter = this.filterOptions.find(f => f.id === id);
        this._currentPendingFilter = id;
        
        // Visual feedback: Update search bar to show we are waiting for input for this filter
        const searchInput = document.getElementById('tile-search-input');
        if (searchInput) {
            searchInput.placeholder = `Set ${filter.label}: ${filter.placeholder}`;
            searchInput.focus();
        }

        // Close shelf to let user type
        this._filterShelfOpen = false;
        document.getElementById('filter-shelf').classList.remove('open');
        document.getElementById('toggle-filters').classList.remove('active');
    },

    removeFilter(id) {
        this._activeFilters.delete(id);
        this.refreshUI();
    },

    refreshUI() {
        const container = document.getElementById('active-tags-container');
        const searchInput = document.getElementById('tile-search-input');
        
        // Update tags in search bar: Format as "Label: Value"
        container.innerHTML = Array.from(this._activeFilters.entries()).map(([id, value]) => {
            const opt = this.filterOptions.find(f => f.id === id);
            return `
                <div class="filter-tag">
                    <span class="tag-key">${opt.label}:</span>
                    <span class="tag-val">${value}</span>
                    <i class="fa-solid fa-xmark" onclick="event.stopPropagation(); LandingUI.removeFilter('${id}')"></i>
                </div>
            `;
        }).join('');

        // Reset search bar state if no pending filter
        if (!this._currentPendingFilter && searchInput) {
            searchInput.placeholder = "Add more filters...";
        }

        this.dispatchFilterUpdate();
    },

    dispatchFilterUpdate() {
        /**
         * IMPORTANT: This event broadcasts to the Map Controller.
         * The Map logic should listen for 'filterUpdate' and filter its collection
         * of aircraft markers based on the 'activeFilters' object.
         */
        const filterObject = Object.fromEntries(this._activeFilters);
        const event = new CustomEvent('filterUpdate', {
            detail: {
                activeFilters: filterObject, // e.g., { type: 'A320', altitude: '30000' }
                searchTerm: document.getElementById('tile-search-input')?.value || ''
            }
        });
        window.dispatchEvent(event);
    },

    injectStyles() {
        const existing = document.getElementById('inflight-ui-styles');
        if (existing) existing.remove();

        const css = `
            .tactical-ui-root {
                position: absolute;
                inset: 0;
                z-index: 2000;
                pointer-events: none;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.8s cubic-bezier(0.2, 0, 0, 1);
                font-family: 'Inter', system-ui, sans-serif;
            }

            .tactical-ui-root.active { opacity: 1; visibility: visible; }

            .side-branding {
                position: absolute;
                left: 40px;
                top: 50%;
                transform: translateY(-50%);
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 20px;
                pointer-events: auto;
            }

            .status-indicator-dot {
                width: 2px;
                height: 40px;
                background: linear-gradient(to bottom, transparent, #fff, transparent);
            }

            .vertical-text {
                writing-mode: vertical-rl;
                text-orientation: mixed;
                transform: rotate(180deg);
                font-size: 0.6rem;
                font-weight: 900;
                letter-spacing: 0.4em;
                color: rgba(255, 255, 255, 0.4);
                text-transform: uppercase;
            }

            .search-island-wrapper {
                position: absolute;
                bottom: 40px;
                left: 50%;
                transform: translateX(-50%);
                pointer-events: auto;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 15px;
            }

            .filter-shelf {
                width: 500px;
                background: rgba(10, 10, 10, 0.8);
                backdrop-filter: blur(40px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 24px;
                padding: 20px;
                opacity: 0;
                transform: translateY(20px) scale(0.95);
                pointer-events: none;
                transition: all 0.5s cubic-bezier(0.2, 0, 0, 1);
                box-shadow: 0 30px 60px rgba(0,0,0,0.5);
            }

            .filter-shelf.open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }

            .shelf-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .shelf-title { font-size: 0.7rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.2em; color: rgba(255,255,255,0.5); }
            
            .preset-row { display: flex; gap: 8px; }
            .preset-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-size: 0.65rem; padding: 4px 12px; border-radius: 100px; cursor: pointer; }

            .filter-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
            .filter-item { display: flex; align-items: center; gap: 12px; padding: 12px 16px; background: rgba(255,255,255,0.03); border-radius: 12px; cursor: pointer; transition: all 0.2s; }
            .filter-item i { font-size: 0.8rem; color: rgba(255,255,255,0.3); }
            .filter-item span { font-size: 0.8rem; color: rgba(255,255,255,0.7); }
            .filter-item:hover { background: rgba(255,255,255,0.08); }

            .search-island {
                position: relative;
                background: rgba(10, 10, 10, 0.4);
                backdrop-filter: blur(30px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                padding: 8px 16px;
                border-radius: 100px;
                display: flex;
                align-items: center;
                min-width: 400px;
                max-width: 800px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            }

            .filter-trigger { background: none; border: none; color: rgba(255,255,255,0.4); cursor: pointer; padding: 8px; transition: all 0.3s; }
            .filter-trigger.active { color: #fff; transform: rotate(90deg); }

            .tags-inline { display: flex; gap: 6px; margin-right: 8px; }
            .filter-tag {
                background: rgba(255,255,255,0.1);
                color: #fff;
                font-size: 0.7rem;
                padding: 4px 10px;
                border-radius: 100px;
                display: flex;
                align-items: center;
                gap: 6px;
                border: 1px solid rgba(255,255,255,0.1);
            }
            .tag-key { opacity: 0.6; font-weight: 400; }
            .tag-val { font-weight: 700; }
            .filter-tag i { cursor: pointer; font-size: 0.6rem; opacity: 0.5; }

            #tile-search-input { background: transparent; border: none; color: #fff; font-size: 0.9rem; outline: none; width: 100%; }

            .search-divider { width: 1px; height: 16px; background: rgba(255, 255, 255, 0.1); margin: 0 15px; }
            .search-hint { font-size: 0.6rem; font-weight: 800; color: rgba(255, 255, 255, 0.2); white-space: nowrap; }

            .utility-cluster { position: absolute; bottom: 40px; right: 40px; pointer-events: auto; }
            .orb-stack { display: flex; gap: 12px; }
            .orb-btn {
                width: 48px; height: 48px; border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.05);
                background: rgba(255, 255, 255, 0.03);
                backdrop-filter: blur(10px);
                color: rgba(255, 255, 255, 0.4);
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .orb-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; transform: scale(1.1) translateY(-5px); }
            .highlight-orb { background: rgba(255, 255, 255, 0.08); color: #fff; }
        `;

        const style = document.createElement('style');
        style.id = 'inflight-ui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};