/**
 * LandingUI.js
 * REDESIGN: Tactical Modal - Centralized Filter Engine
 * Replaced bottom-right Nexus with a high-focus central Modal for complex filtering.
 */

export const LandingUI = {
    _isVisible: false,
    _modalOpen: false,
    _activeFilters: {}, 

    filterOptions: [
        { id: 'type', label: 'Aircraft', icon: 'fa-plane' },
        { id: 'livery', label: 'Livery', icon: 'fa-paint-roller' },
        { id: 'airline', label: 'Operator', icon: 'fa-building' },
        { id: 'altitude', label: 'Altitude', icon: 'fa-arrows-up-down' },
        { id: 'speed', label: 'Speed', icon: 'fa-gauge-high' },
        { id: 'origin', label: 'Origin', icon: 'fa-plane-departure' },
        { id: 'destination', label: 'Destination', icon: 'fa-plane-arrival' },
        { id: 'callsign', label: 'Callsign', icon: 'fa-id-badge' },
        { id: 'atc', label: 'ATC', icon: 'fa-headset' },
        { id: 'rank', label: 'Pilot Rank', icon: 'fa-star' },
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
                            <div class="filter-section">
                                <label>Available Parameters</label>
                                <div class="filter-options-grid">
                                    ${this.filterOptions.map(f => `
                                        <div class="nexus-item" data-filter-id="${f.id}">
                                            <i class="fa-solid ${f.icon}"></i>
                                            <span class="nexus-label">${f.label}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>

                            <div class="filter-section">
                                <label>Active Configuration</label>
                                <div id="modal-active-filters" class="modal-active-list">
                                    <div class="empty-state">No active filters. Select a parameter above to start.</div>
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
                        <button class="orb-btn" id="tile-weather" aria-label="Weather">
                            <i class="fa-solid fa-cloud"></i>
                        </button>
                        <button class="orb-btn nexus-trigger" id="toggle-filter-modal" aria-label="Filters">
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
        applyBtn?.addEventListener('click', () => toggleModal(false));
        
        clearBtn?.addEventListener('click', () => {
            this._activeFilters = {};
            this.refreshUI();
        });

        // Close on backdrop click
        modalOverlay?.addEventListener('click', (e) => {
            if (e.target === modalOverlay) toggleModal(false);
        });

        // Search Input
        document.getElementById('blade-search-input')?.addEventListener('input', () => {
            this.dispatchFilterUpdate();
        });

        // Add Filter from Grid
        document.querySelectorAll('.nexus-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.filterId;
                this.toggleFilter(id);
            });
        });

        // Utility Orbs logic
        document.getElementById('tile-weather')?.addEventListener('click', () => {
             document.getElementById('open-weather-settings-btn')?.click();
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
        const container = document.getElementById('modal-active-filters');
        if (!container) return;

        const activeEntries = Object.entries(this._activeFilters);

        if (activeEntries.length === 0) {
            container.innerHTML = `<div class="empty-state">No active filters. Select a parameter above to start.</div>`;
        } else {
            container.innerHTML = activeEntries.map(([id, value]) => {
                const opt = this.filterOptions.find(f => f.id === id);
                return `
                    <div class="modal-filter-row">
                        <div class="row-label">
                            <i class="fa-solid ${opt.icon}"></i>
                            <span>${opt.label}</span>
                        </div>
                        <input type="text" 
                               class="row-input" 
                               placeholder="Enter ${opt.label.toLowerCase()}..." 
                               value="${value}" 
                               oninput="LandingUI.updateFilterValue('${id}', this.value)">
                        <button class="row-remove" onclick="LandingUI.toggleFilter('${id}')">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                `;
            }).join('');
        }

        // Update selected state in grid
        document.querySelectorAll('.nexus-item').forEach(item => {
            item.classList.toggle('active', this._activeFilters[item.dataset.filterId] !== undefined);
        });

        this.dispatchFilterUpdate();
    },

    dispatchFilterUpdate() {
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
            const serverEl = document.getElementById('landing-server-name');
            if (serverEl) serverEl.textContent = stats.server.toUpperCase();
        }
    },

    injectStyles() {
        const css = `
            .tactical-ui-root {
                position: absolute;
                inset: 0;
                z-index: 2000;
                pointer-events: none;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.5s ease;
                font-family: 'Inter', -apple-system, sans-serif;
            }
            .tactical-ui-root.active { opacity: 1; visibility: visible; }

            /* Modal System */
            .modal-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(10px);
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                visibility: hidden;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                pointer-events: auto;
                z-index: 3000;
            }
            .modal-overlay.open { opacity: 1; visibility: visible; }
            
            .filter-modal {
                background: rgba(20, 20, 20, 0.85);
                width: 500px;
                max-width: 90vw;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 24px;
                box-shadow: 0 40px 100px rgba(0,0,0,0.6);
                transform: scale(0.9) translateY(20px);
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .modal-overlay.open .filter-modal { transform: scale(1) translateY(0); }

            .modal-header {
                padding: 24px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            }
            .header-main { display: flex; align-items: center; gap: 15px; color: #fff; }
            .header-main i { font-size: 20px; color: #007aff; }
            .header-main h2 { margin: 0; font-size: 18px; font-weight: 600; }
            .close-modal { background: none; border: none; color: rgba(255,255,255,0.4); font-size: 28px; cursor: pointer; }

            .modal-body { padding: 24px; overflow-y: auto; max-height: 60vh; }
            .filter-section { margin-bottom: 30px; }
            .filter-section label { 
                display: block; color: rgba(255,255,255,0.3); 
                font-size: 11px; text-transform: uppercase; 
                letter-spacing: 1px; margin-bottom: 12px; font-weight: 700;
            }

            .filter-options-grid {
                display: grid;
                grid-template-columns: repeat(5, 1fr);
                gap: 8px;
            }
            .nexus-item {
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.05);
                border-radius: 12px;
                padding: 12px 5px;
                display: flex; flex-direction: column; align-items: center; gap: 6px;
                cursor: pointer; transition: all 0.2s;
            }
            .nexus-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); }
            .nexus-item.active { background: #007aff; border-color: #007aff; color: #fff; }
            .nexus-item.active .nexus-label { color: #fff; }
            .nexus-label { font-size: 9px; color: rgba(255,255,255,0.5); font-weight: 600; text-align: center; }

            .modal-active-list { display: flex; flex-direction: column; gap: 10px; }
            .empty-state { padding: 20px; text-align: center; color: rgba(255,255,255,0.2); font-size: 13px; border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; }
            
            .modal-filter-row {
                display: flex; align-items: center; gap: 12px;
                background: rgba(255,255,255,0.05);
                padding: 8px 12px; border-radius: 12px;
                animation: rowIn 0.3s ease-out;
            }
            @keyframes rowIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
            
            .row-label { display: flex; align-items: center; gap: 10px; width: 100px; color: #fff; font-size: 12px; }
            .row-label i { color: #007aff; width: 15px; }
            .row-input { 
                flex: 1; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1);
                border-radius: 6px; padding: 8px 12px; color: #fff; outline: none; font-size: 13px;
            }
            .row-input:focus { border-color: #007aff; }
            .row-remove { background: none; border: none; color: rgba(255,68,68,0.5); cursor: pointer; transition: color 0.2s; }
            .row-remove:hover { color: #ff4444; }

            .modal-footer {
                padding: 20px 24px;
                display: flex; justify-content: flex-end; gap: 12px;
                background: rgba(0, 0, 0, 0.2);
            }
            .modal-btn {
                padding: 10px 20px; border-radius: 10px; border: none; 
                font-weight: 600; cursor: pointer; transition: all 0.2s; font-size: 13px;
            }
            .modal-btn.primary { background: #007aff; color: white; }
            .modal-btn.primary:hover { background: #0062cc; transform: translateY(-1px); }
            .modal-btn.secondary { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.6); }

            /* Standard UI Elements */
            .top-branding { position: absolute; top: 30px; left: 40px; display: flex; align-items: center; gap: 12px; pointer-events: auto; }
            .status-dot { width: 6px; height: 6px; background: #00ff88; border-radius: 50%; box-shadow: 0 0 10px #00ff88; }
            #landing-server-name { color: rgba(255,255,255,0.4); font-size: 10px; font-weight: 800; letter-spacing: 0.2em; }

            .search-blade-container { position: absolute; top: 30px; right: 40px; pointer-events: none; }
            .search-blade {
                pointer-events: auto; background: rgba(20, 20, 20, 0.4); backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px;
                height: 44px; width: 240px; display: flex; align-items: center; padding: 0 14px;
            }
            #blade-search-input { flex: 1; background: none; border: none; color: #fff; margin-left: 12px; font-size: 14px; outline: none; }
            .search-icon { color: rgba(255,255,255,0.3); font-size: 14px; }
            .search-shortcut { font-size: 10px; color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; }

            .utility-nexus { position: absolute; bottom: 40px; right: 40px; pointer-events: none; }
            .orb-row { display: flex; gap: 12px; pointer-events: auto; }
            .orb-btn {
                width: 48px; height: 48px; border-radius: 50%;
                background: rgba(15, 15, 15, 0.6); backdrop-filter: blur(15px);
                border: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.5);
                cursor: pointer; display: flex; align-items: center; justify-content: center;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .orb-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; transform: scale(1.05); }
            .highlight-orb { border-color: rgba(0, 255, 136, 0.3); }
        `;

        const style = document.createElement('style');
        style.id = 'landing-ui-spatial-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};

window.LandingUI = LandingUI;