/**
 * LandingUI.js
 * REDESIGN: Spatial Minimalist Overlay with Universal Filter Logic
 * Position: Top-Right Anchored
 */

export const LandingUI = {
    _isVisible: false,
    _filterShelfOpen: false,
    _activeFilters: {}, 

    filterOptions: [
        { id: 'type', label: 'Aircraft Type', icon: 'fa-plane', placeholder: 'e.g. A320' },
        { id: 'airline', label: 'Operator', icon: 'fa-building', placeholder: 'e.g. BAW' },
        { id: 'callsign', label: 'Callsign Prefix', icon: 'fa-id-badge', placeholder: 'e.g. G-' },
        { id: 'rank', label: 'Pilot Rank', icon: 'fa-star', placeholder: 'e.g. Captain' },
        { id: 'altitude', label: 'Altitude Range', icon: 'fa-arrows-up-down', placeholder: 'e.g. 35000' },
        { id: 'speed', label: 'Ground Speed', icon: 'fa-gauge-high', placeholder: 'e.g. 450' },
        { id: 'heading', label: 'Heading', icon: 'fa-compass', placeholder: 'e.g. 090' },
        { id: 'ground', label: 'Ground Status', icon: 'fa-trowel-bricks', placeholder: 'e.g. Taxiing' },
        { id: 'inflight', label: 'In-Flight', icon: 'fa-cloud-sun', placeholder: 'e.g. Cruise' },
        { id: 'origin', label: 'Origin', icon: 'fa-plane-departure', placeholder: 'e.g. KJFK' },
        { id: 'destination', label: 'Destination', icon: 'fa-plane-arrival', placeholder: 'e.g. EGLL' },
        { id: 'duration', label: 'Duration', icon: 'fa-hourglass-half', placeholder: 'e.g. 2:00' },
        { id: 'proximity', label: 'Proximity', icon: 'fa-bullseye', placeholder: 'e.g. 50nm' },
        { id: 'atc', label: 'ATC Coverage', icon: 'fa-headset', placeholder: 'e.g. Approach' }
    ],

    presets: [
        { id: 'heavy', label: 'Heavies', filters: { type: 'B77', duration: '5:00' } },
        { id: 'arrivals', label: 'Arrivals', filters: { destination: '', inflight: '' } },
        { id: 'atc-active', label: 'Live ATC', filters: { atc: '' } }
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

        filterToggle?.addEventListener('click', () => {
            this._filterShelfOpen = !this._filterShelfOpen;
            filterShelf.classList.toggle('open', this._filterShelfOpen);
            filterToggle.classList.toggle('active', this._filterShelfOpen);
        });

        searchInput?.addEventListener('input', () => {
            this.dispatchFilterUpdate();
        });

        document.querySelectorAll('.filter-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.filterId;
                this.toggleFilter(id);
            });
        });

        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const presetId = btn.dataset.preset;
                const preset = this.presets.find(p => p.id === presetId);
                if (preset) {
                    this._activeFilters = { ...this._activeFilters, ...preset.filters };
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
        const container = document.getElementById('active-tags-container');
        const shelfItems = document.querySelectorAll('.filter-item');

        container.innerHTML = Object.entries(this._activeFilters).map(([id, value]) => {
            const opt = this.filterOptions.find(f => f.id === id);
            return `
                <div class="filter-tag">
                    <i class="fa-solid ${opt.icon}"></i>
                    <input type="text" 
                           class="filter-tag-input" 
                           placeholder="${opt.placeholder || opt.label}" 
                           value="${value}" 
                           oninput="LandingUI.updateFilterValue('${id}', this.value)"
                           onkeydown="if(event.key==='Enter') this.blur()">
                    <i class="fa-solid fa-xmark tag-close" onclick="event.stopPropagation(); LandingUI.toggleFilter('${id}')"></i>
                </div>
            `;
        }).join('');

        shelfItems.forEach(item => {
            item.classList.toggle('selected', this._activeFilters[item.dataset.filterId] !== undefined);
        });

        this.dispatchFilterUpdate();

        const inputs = container.querySelectorAll('input');
        if (inputs.length > 0) {
            const lastInput = inputs[inputs.length - 1];
            if (lastInput.value === '') lastInput.focus();
        }
    },

    dispatchFilterUpdate() {
        const event = new CustomEvent('filterUpdate', { 
            detail: { 
                filters: { ...this._activeFilters }, 
                searchTerm: document.getElementById('tile-search-input')?.value || '' 
            } 
        });
        window.dispatchEvent(event);
    },

    injectStyles() {
        const existing = document.getElementById('inflight-ui-styles');
        if (existing) existing.remove();

        const css = `
            /* Interactive Filter Tag Styles */
            .filter-tag {
                display: flex;
                align-items: center;
                gap: 6px;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.1);
                padding: 4px 10px;
                border-radius: 6px;
                color: #fff;
                font-size: 0.8rem;
                transition: all 0.2s ease;
                flex-shrink: 0;
            }
            .filter-tag:focus-within {
                background: rgba(255, 255, 255, 0.15);
                border-color: rgba(255, 255, 255, 0.3);
            }
            .filter-tag-input {
                background: transparent;
                border: none;
                outline: none;
                color: #fff;
                font-family: inherit;
                font-size: 0.8rem;
                width: 70px;
                padding: 0;
            }
            .filter-tag-input::placeholder {
                color: rgba(255, 255, 255, 0.3);
            }
            .tag-close {
                cursor: pointer;
                opacity: 0.5;
                font-size: 0.7rem;
            }
            .tag-close:hover { opacity: 1; color: #ff4d4d; }

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
            
            /* Side Branding (Left) */
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
            .status-indicator-dot { width: 2px; height: 40px; background: linear-gradient(to bottom, transparent, #fff, transparent); }
            .vertical-text { writing-mode: vertical-rl; text-orientation: mixed; color: rgba(255, 255, 255, 0.4); font-size: 0.7rem; letter-spacing: 4px; font-weight: 800; }

            /* Search Island Wrapper - POSITIONED TOP RIGHT */
            .search-island-wrapper {
                position: absolute;
                top: 40px;
                right: 40px;
                width: auto;
                max-width: 700px;
                display: flex;
                flex-direction: column;
                align-items: flex-end; /* Anchors content to the right edge */
                gap: 16px;
                pointer-events: none;
            }

            .search-island {
                position: relative;
                width: auto;
                min-width: 320px;
                height: 60px;
                background: rgba(25, 25, 25, 0.4);
                backdrop-filter: blur(25px);
                border-radius: 30px;
                border: 1px solid rgba(255, 255, 255, 0.08);
                display: flex;
                align-items: center;
                padding: 0 20px;
                gap: 12px;
                pointer-events: auto;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            }
            .search-island:focus-within { transform: translateY(2px); background: rgba(35, 35, 35, 0.6); border-color: rgba(255, 255, 255, 0.15); }
            .search-glow { position: absolute; inset: -1px; border-radius: 30px; background: linear-gradient(135deg, rgba(255,255,255,0.05), transparent, rgba(255,255,255,0.05)); pointer-events: none; }
            
            .filter-trigger { background: none; border: none; color: rgba(255, 255, 255, 0.4); cursor: pointer; font-size: 1.1rem; transition: all 0.3s; padding: 5px; }
            .filter-trigger.active { color: #fff; transform: rotate(90deg); }
            
            /* Prevent tags from over-expanding the bar */
            .tags-inline { 
                display: flex; 
                gap: 6px; 
                overflow-x: auto; 
                scrollbar-width: none; 
                max-width: 350px; 
                mask-image: linear-gradient(to right, black 85%, transparent 100%);
            }
            .tags-inline::-webkit-scrollbar { display: none; }
            
            #tile-search-input { 
                flex: 1; 
                min-width: 120px; 
                background: none; 
                border: none; 
                color: #fff; 
                font-size: 0.95rem; 
                outline: none; 
            }
            #tile-search-input::placeholder { color: rgba(255, 255, 255, 0.2); }
            
            .search-divider { width: 1px; height: 20px; background: rgba(255, 255, 255, 0.1); }
            .search-hint { font-size: 0.6rem; color: rgba(255, 255, 255, 0.2); font-weight: 700; background: rgba(255, 255, 255, 0.05); padding: 4px 6px; border-radius: 4px; }

            /* Filter Shelf - Aligned Right */
            .filter-shelf {
                width: 580px;
                background: rgba(20, 20, 20, 0.7);
                backdrop-filter: blur(30px);
                border-radius: 24px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                padding: 24px;
                max-height: 0;
                opacity: 0;
                overflow: hidden;
                transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
                pointer-events: auto;
                box-shadow: 0 20px 50px rgba(0,0,0,0.4);
            }
            .filter-shelf.open { max-height: 500px; opacity: 1; transform: translateY(0); }
            
            .shelf-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
            .shelf-title { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 2px; color: rgba(255, 255, 255, 0.4); font-weight: 700; }
            
            .preset-row { display: flex; gap: 8px; }
            .preset-btn { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.5); padding: 5px 12px; border-radius: 15px; font-size: 0.65rem; cursor: pointer; transition: all 0.3s; }
            .preset-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }

            .filter-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
            .filter-item { background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 12px; display: flex; flex-direction: row; align-items: center; gap: 12px; cursor: pointer; transition: all 0.2s ease; color: rgba(255, 255, 255, 0.4); }
            .filter-item:hover { background: rgba(255, 255, 255, 0.06); transform: scale(1.02); color: #fff; }
            .filter-item.selected { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.3); color: #fff; }
            .filter-item i { font-size: 1rem; width: 20px; text-align: center; }
            .filter-item span { font-size: 0.75rem; font-weight: 500; }

            /* Utility Cluster (Bottom Right) */
            .utility-cluster { position: absolute; bottom: 40px; right: 40px; pointer-events: auto; }
            .orb-stack { display: flex; gap: 12px; }
            .orb-btn {
                width: 44px; height: 44px; border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.08);
                background: rgba(25, 25, 25, 0.4);
                backdrop-filter: blur(10px);
                color: rgba(255, 255, 255, 0.4);
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .orb-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; transform: translateY(-5px); }
            .highlight-orb { background: rgba(255, 255, 255, 0.08); color: #fff; }
            
            @keyframes orb-pulse {
                0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.4); }
                70% { box-shadow: 0 0 0 15px rgba(255, 255, 255, 0); }
                100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
            }
            .orb-pulse { animation: orb-pulse 1s ease-out; }
        `;

        const style = document.createElement('style');
        style.id = 'inflight-ui-styles';
        style.type = 'text/css';
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }
};

window.LandingUI = LandingUI;