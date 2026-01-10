/**
 * LandingUI.js
 * REDESIGN: Tactical Modal - Centered Filter & Search Nexus
 * Transforms the filter grid into a centered modal for high-detail custom filtering.
 */

export const LandingUI = {
    _isVisible: false,
    _filterNexusOpen: false,
    _activeFilters: {}, 
    _customFilters: {
        aircraft: '',
        livery: '',
        altitude: '',
        airport: ''
    },

    filterOptions: [
        { id: 'groups', label: 'Groups', icon: 'fa-users-rays' },
        { id: 'rank', label: 'Rank', icon: 'fa-star' },
        { id: 'atc', label: 'Live ATC', icon: 'fa-headset' },
        { id: 'staff', label: 'Staff', icon: 'fa-shield-halved' }
    ],

    init() {
        this.injectStyles();
        this.render();
        this.attachListeners();
    },

    injectStyles() {
        const css = `
            /* Modal Overlay */
            .nexus-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(10px);
                z-index: 2999;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s ease;
            }
            .nexus-overlay.open { opacity: 1; visibility: visible; }

            /* Centered Tactical Modal */
            .filter-nexus-grid {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -45%) scale(0.95);
                width: 500px;
                max-width: 95vw;
                background: rgba(15, 15, 20, 0.98);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 28px;
                padding: 30px;
                z-index: 3000;
                opacity: 0;
                visibility: hidden;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 40px 100px rgba(0,0,0,0.8);
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            .filter-nexus-grid.open { 
                opacity: 1; 
                transform: translate(-50%, -50%) scale(1); 
                visibility: visible; 
            }

            /* Custom Filter Form */
            .custom-filter-section {
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding-top: 15px;
                border-top: 1px solid rgba(255,255,255,0.05);
            }
            
            .nexus-input-row {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 10px;
            }

            .nexus-input-group {
                display: flex;
                flex-direction: column;
                gap: 5px;
            }

            .nexus-input-group label {
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 1px;
                color: rgba(255,255,255,0.4);
                margin-left: 5px;
            }

            .nexus-input {
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 10px;
                padding: 12px;
                color: #fff;
                font-size: 14px;
                outline: none;
                transition: border 0.2s;
            }
            .nexus-input:focus { border-color: #38bdf8; }

            /* Quick Toggle Grid */
            .quick-toggle-row {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 10px;
            }

            .nexus-item {
                aspect-ratio: 1/1;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 6px;
                border-radius: 15px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.05);
                color: rgba(255, 255, 255, 0.4);
                cursor: pointer;
                transition: all 0.2s;
            }
            .nexus-item.active {
                background: rgba(56, 189, 248, 0.15);
                border-color: #38bdf8;
                color: #38bdf8;
            }
            .nexus-item:hover { background: rgba(255, 255, 255, 0.08); }

            .apply-filters-btn {
                background: #38bdf8;
                color: #000;
                border: none;
                border-radius: 12px;
                padding: 15px;
                font-weight: 800;
                font-size: 14px;
                cursor: pointer;
                margin-top: 10px;
                transition: transform 0.2s;
            }
            .apply-filters-btn:active { transform: scale(0.98); }

            /* Header Labels */
            .modal-title { font-size: 18px; font-weight: 700; color: #fff; margin: 0; }
            .modal-subtitle { font-size: 12px; color: rgba(255,255,255,0.5); }
        `;
        const styleSheet = document.createElement("style");
        styleSheet.innerText = css;
        document.head.appendChild(styleSheet);
    },

    render() {
        const container = document.createElement('div');
        container.id = 'landing-ui-wrapper';
        
        container.innerHTML = `
            <div id="nexus-overlay" class="nexus-overlay"></div>

            <div id="glass-blade" class="glass-blade">
                <div class="search-section">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" placeholder="Search flights, pilots, or airports..." id="global-search">
                </div>
                <div class="nexus-trigger" id="nexus-trigger">
                    <i class="fa-solid fa-filter"></i>
                    <span id="filter-count">0</span>
                </div>
            </div>

            <div id="filter-nexus-grid" class="filter-nexus-grid">
                <div>
                    <h2 class="modal-title">Tactical Filters</h2>
                    <p class="modal-subtitle">Filter the map by live API telemetry data.</p>
                </div>

                <div class="quick-toggle-row">
                    ${this.filterOptions.map(f => `
                        <div class="nexus-item ${this._activeFilters[f.id] ? 'active' : ''}" data-filter-id="${f.id}">
                            <i class="fa-solid ${f.icon}"></i>
                            <span style="font-size: 10px;">${f.label}</span>
                        </div>
                    `).join('')}
                </div>

                <div class="custom-filter-section">
                    <div class="nexus-input-row">
                        <div class="nexus-input-group">
                            <label>Aircraft Type</label>
                            <input type="text" id="cust-aircraft" class="nexus-input" placeholder="e.g. A320" value="${this._customFilters.aircraft}">
                        </div>
                        <div class="nexus-input-group">
                            <label>Livery / Airline</label>
                            <input type="text" id="cust-livery" class="nexus-input" placeholder="e.g. Delta" value="${this._customFilters.livery}">
                        </div>
                    </div>
                    <div class="nexus-input-row">
                        <div class="nexus-input-group">
                            <label>Min Altitude (ft)</label>
                            <input type="number" id="cust-altitude" class="nexus-input" placeholder="e.g. 30000" value="${this._customFilters.altitude}">
                        </div>
                        <div class="nexus-input-group">
                            <label>Airport / Dest</label>
                            <input type="text" id="cust-airport" class="nexus-input" placeholder="e.g. KLAX" value="${this._customFilters.airport}">
                        </div>
                    </div>
                    <button class="apply-filters-btn" id="apply-nexus-filters">APPLY CUSTOM FILTERS</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);
    },

    update(show, data = {}) {
        this._isVisible = show;
        const blade = document.getElementById('glass-blade');
        if (blade) {
            blade.classList.toggle('visible', show);
        }
    },

    refreshUI() {
        const grid = document.getElementById('filter-nexus-grid');
        const overlay = document.getElementById('nexus-overlay');
        const countBadge = document.getElementById('filter-count');
        
        if (this._filterNexusOpen) {
            grid.classList.add('open');
            overlay.classList.add('open');
        } else {
            grid.classList.remove('open');
            overlay.classList.remove('open');
        }

        const activeCount = Object.values(this._activeFilters).filter(v => v).length;
        countBadge.innerText = activeCount;
    },

    attachListeners() {
        const trigger = document.getElementById('nexus-trigger');
        const overlay = document.getElementById('nexus-overlay');
        const applyBtn = document.getElementById('apply-nexus-filters');

        trigger?.addEventListener('click', () => {
            this._filterNexusOpen = !this._filterNexusOpen;
            this.refreshUI();
        });

        overlay?.addEventListener('click', () => {
            this._filterNexusOpen = false;
            this.refreshUI();
        });

        // Toggle Buttons (Quick Filters)
        document.querySelectorAll('.nexus-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const id = item.getAttribute('data-filter-id');
                this._activeFilters[id] = !this._activeFilters[id];
                item.classList.toggle('active');
                this.refreshUI();
            });
        });

        // Apply Custom Advanced Filters
        applyBtn?.addEventListener('click', () => {
            // Collect data from inputs
            this._customFilters = {
                aircraft: document.getElementById('cust-aircraft').value,
                livery: document.getElementById('cust-livery').value,
                altitude: document.getElementById('cust-altitude').value,
                airport: document.getElementById('cust-airport').value
            };

            // Dispatch to flight.js map logic
            const event = new CustomEvent('filterUpdate', { 
                detail: { 
                    filters: this._activeFilters,
                    custom: this._customFilters 
                } 
            });
            window.dispatchEvent(event);

            // Close modal
            this._filterNexusOpen = false;
            this.refreshUI();
        });
    }
};