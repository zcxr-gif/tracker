/**
 * LandingUI.js
 * REDESIGN: Spatial Minimalist Overlay with Universal Filter Logic
 * Position: Locked Top-Right Corner
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
            /* Container Root */
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

            /* Search Island Wrapper - PINNED TO TOP RIGHT */
            .search-island-wrapper {
                position: absolute;
                top: 20px; /* Closer to top edge */
                right: 20px; /* Closer to right edge */
                left: auto !important; /* Force override any legacy left: 50% */
                transform: none !important; /* Force override any legacy translate */
                width: auto;
                max-width: 600px;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 12px;
                pointer-events: none;
            }

            .search-island {
                position: relative;
                width: auto;
                min-width: 300px;
                height: 54px;
                background: rgba(15, 15, 15, 0.6);
                backdrop-filter: blur(25px);
                border-radius: 27px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                display: flex;
                align-items: center;
                padding: 0 16px;
                gap: 10px;
                pointer-events: auto;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            }
            .search-island:focus-within { 
                background: rgba(25, 25, 25, 0.8); 
                border-color: rgba(255, 255, 255, 0.2);
            }

            .tags-inline { 
                display: flex; 
                gap: 6px; 
                overflow-x: auto; 
                scrollbar-width: none; 
                max-width: 280px; 
                mask-image: linear-gradient(to right, black 80%, transparent 100%);
            }
            .tags-inline::-webkit-scrollbar { display: none; }
            
            #tile-search-input { 
                flex: 1; 
                min-width: 80px; 
                background: none; 
                border: none; 
                color: #fff; 
                font-size: 0.9rem; 
                outline: none; 
            }
            #tile-search-input::placeholder { color: rgba(255, 255, 255, 0.3); }

            .filter-tag {
                display: flex;
                align-items: center;
                gap: 4px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.1);
                padding: 2px 8px;
                border-radius: 4px;
                color: #fff;
                font-size: 0.75rem;
                flex-shrink: 0;
            }
            .filter-tag-input {
                background: transparent;
                border: none;
                outline: none;
                color: #fff;
                width: 60px;
                font-size: 0.75rem;
            }

            /* Filter Shelf - Anchored Right */
            .filter-shelf {
                width: 480px;
                background: rgba(10, 10, 10, 0.8);
                backdrop-filter: blur(30px);
                border-radius: 20px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                padding: 20px;
                max-height: 0;
                opacity: 0;
                overflow: hidden;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                pointer-events: auto;
                box-shadow: 0 20px 50px rgba(0,0,0,0.5);
            }
            .filter-shelf.open { max-height: 500px; opacity: 1; margin-top: 10px; }
            
            .shelf-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
            .shelf-title { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 2px; color: rgba(255, 255, 255, 0.4); font-weight: 700; }
            
            .preset-btn { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.6); padding: 4px 10px; border-radius: 12px; font-size: 0.65rem; cursor: pointer; }

            .filter-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
            .filter-item { 
                background: rgba(255, 255, 255, 0.03); 
                border: 1px solid rgba(255, 255, 255, 0.05); 
                border-radius: 10px; 
                padding: 10px; 
                display: flex; 
                align-items: center; 
                gap: 10px; 
                cursor: pointer; 
                color: rgba(255, 255, 255, 0.5); 
            }
            .filter-item:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
            .filter-item.selected { background: rgba(255, 255, 255, 0.15); border-color: #fff; color: #fff; }

            /* Branding & Utils */
            .side-branding { position: absolute; left: 30px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 20px; pointer-events: auto; }
            .vertical-text { writing-mode: vertical-rl; text-orientation: mixed; color: rgba(255, 255, 255, 0.3); font-size: 0.65rem; letter-spacing: 3px; font-weight: 800; }
            
            .utility-cluster { position: absolute; bottom: 30px; right: 30px; pointer-events: auto; }
            .orb-stack { display: flex; gap: 10px; }
            .orb-btn {
                width: 42px; height: 42px; border-radius: 50%;
                border: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(15, 15, 15, 0.5);
                backdrop-filter: blur(10px);
                color: rgba(255, 255, 255, 0.5);
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.2s;
            }
            .orb-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; transform: translateY(-3px); }
        `;

        const style = document.createElement('style');
        style.id = 'inflight-ui-styles';
        style.type = 'text/css';
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }
};

window.LandingUI = LandingUI;