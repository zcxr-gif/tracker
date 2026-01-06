/**
 * LandingUI.js
 * REDESIGN: Spatial Minimalist Overlay with Universal Filter Logic
 * Focus: High-end typography, ergonomic placement, and zero-box architecture.
 */

export const LandingUI = {
    _isVisible: false,
    _filterShelfOpen: false,
    _activeFilters: new Set(), // Track mixed filters

    // The 14 universal filter definitions
    filterOptions: [
        { id: 'type', label: 'Aircraft Type', icon: 'fa-plane' },
        { id: 'airline', label: 'Operator', icon: 'fa-building' },
        { id: 'callsign', label: 'Callsign Prefix', icon: 'fa-id-badge' },
        { id: 'rank', label: 'Pilot Rank', icon: 'fa-star' },
        { id: 'altitude', label: 'Altitude Range', icon: 'fa-arrows-up-down' },
        { id: 'speed', label: 'Ground Speed', icon: 'fa-gauge-high' },
        { id: 'heading', label: 'Heading', icon: 'fa-compass' },
        { id: 'ground', label: 'Ground Status', icon: 'fa-trowel-bricks' },
        { id: 'inflight', label: 'In-Flight', icon: 'fa-cloud-sun' },
        { id: 'origin', label: 'Origin', icon: 'fa-plane-departure' },
        { id: 'destination', label: 'Destination', icon: 'fa-plane-arrival' },
        { id: 'duration', label: 'Duration', icon: 'fa-hourglass-half' },
        { id: 'proximity', label: 'Proximity', icon: 'fa-bullseye' },
        { id: 'atc', label: 'ATC Coverage', icon: 'fa-headset' }
    ],

    presets: [
        { id: 'heavy', label: 'Heavies', filters: ['type', 'duration'] },
        { id: 'arrivals', label: 'Arrivals', filters: ['destination', 'inflight'] },
        { id: 'atc-active', label: 'Live ATC', filters: ['atc'] }
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
                        <div class="search-hint">CMD+K</div>
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
        }
    },

    attachListeners() {
        const searchInput = document.getElementById('tile-search-input');
        const filterToggle = document.getElementById('toggle-filters');
        const filterShelf = document.getElementById('filter-shelf');
        const internalSearch = document.querySelector('.search-bar-container input');

        // Toggle Shelf
        filterToggle?.addEventListener('click', () => {
            this._filterShelfOpen = !this._filterShelfOpen;
            filterShelf.classList.toggle('open', this._filterShelfOpen);
            filterToggle.classList.toggle('active', this._filterShelfOpen);
        });

        // Search Mirroring
        searchInput?.addEventListener('input', (e) => {
            if (internalSearch) {
                internalSearch.value = e.target.value;
                internalSearch.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        // Filter Selection Logic
        document.querySelectorAll('.filter-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.filterId;
                this.toggleFilter(id);
            });
        });

        // Preset Logic
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const presetId = btn.dataset.preset;
                const preset = this.presets.find(p => p.id === presetId);
                if (preset) {
                    preset.filters.forEach(f => this._activeFilters.add(f));
                    this.refreshUI();
                }
            });
        });

        // Hover animation for the vertical status
        const sideBrand = document.querySelector('.side-branding');
        sideBrand?.addEventListener('mouseenter', () => sideBrand.classList.add('expand'));
        sideBrand?.addEventListener('mouseleave', () => sideBrand.classList.remove('expand'));

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

    toggleFilter(id) {
        if (this._activeFilters.has(id)) {
            this._activeFilters.delete(id);
        } else {
            this._activeFilters.add(id);
        }
        this.refreshUI();
    },

    refreshUI() {
        const container = document.getElementById('active-tags-container');
        const shelfItems = document.querySelectorAll('.filter-item');
        
        // Update tags in search bar
        container.innerHTML = Array.from(this._activeFilters).map(id => {
            const opt = this.filterOptions.find(f => f.id === id);
            return `<div class="filter-tag">${opt.label} <i class="fa-solid fa-xmark" onclick="event.stopPropagation(); LandingUI.toggleFilter('${id}')"></i></div>`;
        }).join('');

        // Update shelf visual state
        shelfItems.forEach(item => {
            item.classList.toggle('selected', this._activeFilters.has(item.dataset.filterId));
        });

        this.dispatchFilterUpdate();
    },

    dispatchFilterUpdate() {
        // Ready for connection: This event will broadcast the mixed filter state
        const event = new CustomEvent('filterUpdate', {
            detail: {
                activeFilters: Array.from(this._activeFilters),
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

            .tactical-ui-root.active {
                opacity: 1;
                visibility: visible;
            }

            /* Side Branding */
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
                transition: color 0.3s ease;
            }

            /* Search Island & Shelf */
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

            .filter-shelf.open {
                opacity: 1;
                transform: translateY(0) scale(1);
                pointer-events: auto;
            }

            .shelf-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                padding: 0 5px;
            }

            .shelf-title {
                font-size: 0.7rem;
                font-weight: 900;
                text-transform: uppercase;
                letter-spacing: 0.2em;
                color: rgba(255,255,255,0.5);
            }

            .preset-row {
                display: flex;
                gap: 8px;
            }

            .preset-btn {
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                color: #fff;
                font-size: 0.65rem;
                padding: 4px 12px;
                border-radius: 100px;
                cursor: pointer;
                transition: all 0.2s;
            }

            .preset-btn:hover { background: rgba(255,255,255,0.15); }

            .filter-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 10px;
            }

            .filter-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                background: rgba(255,255,255,0.03);
                border-radius: 12px;
                cursor: pointer;
                border: 1px solid transparent;
                transition: all 0.2s;
            }

            .filter-item i { font-size: 0.8rem; color: rgba(255,255,255,0.3); }
            .filter-item span { font-size: 0.8rem; color: rgba(255,255,255,0.7); font-weight: 500; }

            .filter-item:hover { background: rgba(255,255,255,0.08); }
            .filter-item.selected {
                background: rgba(255,255,255,0.1);
                border-color: rgba(255,255,255,0.3);
            }
            .filter-item.selected i { color: #fff; }

            .search-island {
                position: relative;
                background: rgba(10, 10, 10, 0.4);
                backdrop-filter: blur(30px) saturate(150%);
                border: 1px solid rgba(255, 255, 255, 0.08);
                padding: 8px 16px;
                border-radius: 100px;
                display: flex;
                align-items: center;
                min-width: 320px;
                max-width: 600px;
                transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                box-shadow: 0 20px 40px rgba(0,0,0,0.3);
            }

            .filter-trigger {
                background: none;
                border: none;
                color: rgba(255,255,255,0.4);
                cursor: pointer;
                padding: 8px;
                margin-right: 8px;
                transition: all 0.3s;
            }

            .filter-trigger.active { color: #fff; transform: rotate(90deg); }

            .tags-inline {
                display: flex;
                gap: 6px;
                margin-right: 8px;
            }

            .filter-tag {
                background: rgba(255,255,255,0.1);
                color: #fff;
                font-size: 0.7rem;
                padding: 4px 10px;
                border-radius: 100px;
                white-space: nowrap;
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .filter-tag i {
                cursor: pointer;
                font-size: 0.6rem;
                opacity: 0.5;
            }

            .filter-tag i:hover { opacity: 1; }

            #tile-search-input {
                background: transparent;
                border: none;
                color: #fff;
                font-size: 0.9rem;
                font-weight: 500;
                outline: none;
                width: 100%;
            }

            .search-divider { width: 1px; height: 16px; background: rgba(255, 255, 255, 0.1); margin: 0 15px; }
            .search-hint { font-size: 0.6rem; font-weight: 800; color: rgba(255, 255, 255, 0.2); }

            /* Utility Cluster (Orbs) */
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

            @keyframes orb-pulse {
                0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.4); }
                70% { transform: scale(1.1); box-shadow: 0 0 0 15px rgba(255, 255, 255, 0); }
                100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
            }
            .orb-pulse { animation: orb-pulse 0.6s ease-out; }

            @media (max-width: 768px) { .tactical-ui-root { display: none !important; } }
        `;

        const style = document.createElement('style');
        style.id = 'inflight-ui-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};