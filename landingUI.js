/**
 * LandingUI.js
 * REDESIGN: Spatial Minimalist - Detached Search & Filter Nexus
 * FEATURE: FR24-Style Advanced Filtering (Multi-select, Searchable Lists)
 */

export const LandingUI = {
    _isVisible: false,
    _filterNexusOpen: false,
    _currentModalId: null, // Tracks which filter modal is open
    _activeFilters: {}, // Stores selected values: { type: ['A320', 'A321'], airline: ['DAL'] }
    
    // MOCK DATA for demonstration (In a real app, fetch this from your backend)
    _dataSources: {
        type: [
            { code: 'A318', name: 'Airbus A318' },
            { code: 'A319', name: 'Airbus A319' },
            { code: 'A320', name: 'Airbus A320' },
            { code: 'A20N', name: 'Airbus A320neo' },
            { code: 'A321', name: 'Airbus A321' },
            { code: 'B737', name: 'Boeing 737-700' },
            { code: 'B738', name: 'Boeing 737-800' },
            { code: 'B77W', name: 'Boeing 777-300ER' },
            { code: 'C172', name: 'Cessna 172' }
        ],
        airline: [
            { code: 'DAL', name: 'Delta Air Lines' },
            { code: 'UAL', name: 'United Airlines' },
            { code: 'AAL', name: 'American Airlines' },
            { code: 'BAW', name: 'British Airways' },
            { code: 'DLH', name: 'Lufthansa' }
        ]
    },

    filterOptions: [
        { id: 'type', label: 'Aircraft', icon: 'fa-plane', hasModal: true },
        { id: 'airline', label: 'Operator', icon: 'fa-building', hasModal: true },
        { id: 'callsign', label: 'Callsign', icon: 'fa-id-badge', hasModal: false }, // Text input only
        { id: 'rank', label: 'Rank', icon: 'fa-star', hasModal: false },
        { id: 'altitude', label: 'Altitude', icon: 'fa-arrows-up-down', hasModal: false },
        { id: 'speed', label: 'Speed', icon: 'fa-gauge-high', hasModal: false },
        { id: 'origin', label: 'Origin', icon: 'fa-plane-departure', hasModal: false },
        { id: 'destination', label: 'Destination', icon: 'fa-plane-arrival', hasModal: false },
        { id: 'groups', label: 'Groups', icon: 'fa-users-rays', hasModal: false }
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
                    <div id="active-filter-chips" class="filter-chips-row"></div>
                </div>

                <div id="filter-config-modal" class="filter-config-modal">
                    </div>

                <div class="utility-nexus">
                    <div id="filter-nexus-grid" class="filter-nexus-grid">
                        ${this.filterOptions.map(f => `
                            <div class="nexus-item" data-filter-id="${f.id}" title="${f.label}">
                                <i class="fa-solid ${f.icon}"></i>
                                <span class="nexus-label">${f.label}</span>
                            </div>
                        `).join('')}
                    </div>

                    <div class="orb-row">
                        <button class="orb-btn" id="tile-weather" aria-label="Weather"><i class="fa-solid fa-cloud"></i></button>
                        <button class="orb-btn" id="tile-settings" aria-label="Settings"><i class="fa-solid fa-sliders"></i></button>
                        <button class="orb-btn nexus-trigger" id="toggle-nexus" aria-label="Filters"><i class="fa-solid fa-filter"></i></button>
                        <button class="orb-btn highlight-orb" id="tile-server" aria-label="Network"><i class="fa-solid fa-wifi"></i></button>
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
        const nexusTrigger = document.getElementById('toggle-nexus');
        const nexusGrid = document.getElementById('filter-nexus-grid');

        // Toggle Nexus Grid
        nexusTrigger?.addEventListener('click', () => {
            this._filterNexusOpen = !this._filterNexusOpen;
            nexusGrid.classList.toggle('open', this._filterNexusOpen);
            nexusTrigger.classList.toggle('active', this._filterNexusOpen);
            
            // Close modal if nexus closes
            if(!this._filterNexusOpen) this.closeFilterModal();
        });

        // Click on Filter Category
        document.querySelectorAll('.nexus-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.filterId;
                this.handleFilterClick(id);
            });
        });

        // Global Search
        document.getElementById('blade-search-input')?.addEventListener('input', () => this.dispatchFilterUpdate());
    },

    handleFilterClick(id) {
        const option = this.filterOptions.find(f => f.id === id);
        
        // If it's a simple input filter (like speed/altitude), just add a chip
        if (!option.hasModal) {
            if (!this._activeFilters[id]) {
                this._activeFilters[id] = ''; // Init empty string
                this.refreshUI();
            }
            return;
        }

        // If it supports the FR24 style modal
        this.openFilterModal(id);
    },

    openFilterModal(id) {
        this._currentModalId = id;
        const option = this.filterOptions.find(f => f.id === id);
        const modal = document.getElementById('filter-config-modal');
        const data = this._dataSources[id] || []; // Get mock data
        
        // Get currently selected items for this filter
        const currentSelection = Array.isArray(this._activeFilters[id]) ? this._activeFilters[id] : [];

        modal.innerHTML = `
            <div class="modal-header">
                <button class="back-btn" onclick="LandingUI.closeFilterModal()"><i class="fa-solid fa-chevron-left"></i></button>
                <span>Filter by ${option.label}</span>
                <button class="close-btn" onclick="LandingUI.closeFilterModal()"><i class="fa-solid fa-xmark"></i></button>
            </div>
            
            <div class="modal-search">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="modal-search-input" placeholder="Find ${option.label}..." autofocus>
            </div>

            <div class="modal-list-container" id="modal-list-content">
                ${this.renderChecklist(data, currentSelection)}
            </div>

            <div class="modal-footer">
                <div class="selection-summary">
                    <span id="selection-count">${currentSelection.length}</span> selected
                </div>
                <button class="apply-btn" onclick="LandingUI.closeFilterModal()">Done</button>
            </div>
        `;

        modal.classList.add('active');

        // Attach internal modal listeners (Search & Checkbox)
        const input = document.getElementById('modal-search-input');
        input.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filteredData = data.filter(item => 
                item.name.toLowerCase().includes(term) || item.code.toLowerCase().includes(term)
            );
            document.getElementById('modal-list-content').innerHTML = this.renderChecklist(filteredData, this._activeFilters[id] || []);
        });
    },

    renderChecklist(data, selectedCodes) {
        if(data.length === 0) return `<div class="empty-state">No results found</div>`;
        
        return data.map(item => {
            const isChecked = selectedCodes.includes(item.code);
            return `
                <div class="checklist-item" onclick="LandingUI.toggleCheckbox('${item.code}')">
                    <div class="checkbox ${isChecked ? 'checked' : ''}">
                        ${isChecked ? '<i class="fa-solid fa-check"></i>' : ''}
                    </div>
                    <div class="item-info">
                        <span class="item-name">${item.name}</span>
                        <span class="item-code">${item.code}</span>
                    </div>
                </div>
            `;
        }).join('');
    },

    toggleCheckbox(code) {
        const id = this._currentModalId;
        if (!this._activeFilters[id] || !Array.isArray(this._activeFilters[id])) {
            this._activeFilters[id] = [];
        }

        const index = this._activeFilters[id].indexOf(code);
        if (index > -1) {
            this._activeFilters[id].splice(index, 1); // Remove
        } else {
            this._activeFilters[id].push(code); // Add
        }

        // Re-render the list to update checkboxes without closing modal
        const data = this._dataSources[id]; 
        // Note: In real app, re-filter based on current search term
        document.getElementById('modal-list-content').innerHTML = this.renderChecklist(data, this._activeFilters[id]);
        document.getElementById('selection-count').innerText = this._activeFilters[id].length;
        
        // Also update the main UI chips in background
        this.refreshUI(); 
    },

    closeFilterModal() {
        const modal = document.getElementById('filter-config-modal');
        modal.classList.remove('active');
        this._currentModalId = null;
    },

    removeFilter(id) {
        delete this._activeFilters[id];
        this.refreshUI();
    },

    updateSimpleFilter(id, value) {
        this._activeFilters[id] = value;
        this.dispatchFilterUpdate();
    },

    refreshUI() {
        // Render Chips
        const container = document.getElementById('active-filter-chips');
        if (container) {
            container.innerHTML = Object.entries(this._activeFilters).map(([id, value]) => {
                const opt = this.filterOptions.find(f => f.id === id);
                
                // Logic to display content inside the chip
                let chipContent = '';
                
                if (Array.isArray(value)) {
                    // It's a list (like Aircraft)
                    if (value.length === 0) return ''; // Don't show empty arrays
                    const firstItem = value[0]; // e.g., 'A320'
                    const remainder = value.length - 1;
                    chipContent = `
                        <span class="chip-val-text">${firstItem} ${remainder > 0 ? `+${remainder}` : ''}</span>
                    `;
                } else {
                    // It's a simple text input
                    chipContent = `
                        <input type="text" class="chip-input" value="${value}" 
                               placeholder="${opt.label}..."
                               oninput="LandingUI.updateSimpleFilter('${id}', this.value)">
                    `;
                }

                return `
                    <div class="filter-chip">
                        <i class="fa-solid ${opt.icon}"></i>
                        ${chipContent}
                        <i class="fa-solid fa-xmark chip-close" onclick="LandingUI.removeFilter('${id}')"></i>
                    </div>
                `;
            }).join('');
        }

        // Highlight icons in Nexus
        document.querySelectorAll('.nexus-item').forEach(item => {
            const id = item.dataset.filterId;
            const isActive = this._activeFilters[id] && 
                             (Array.isArray(this._activeFilters[id]) ? this._activeFilters[id].length > 0 : true);
            item.classList.toggle('active', !!isActive);
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

    injectStyles() {
        const css = `
            /* Core Styles from Previous Version (Condensed) */
            .tactical-ui-root { position: absolute; inset: 0; z-index: 2000; pointer-events: none; font-family: 'Inter', sans-serif; }
            .top-branding { position: absolute; top: 30px; left: 40px; display: flex; align-items: center; gap: 12px; pointer-events: auto; }
            .status-dot { width: 6px; height: 6px; background: #00ff88; border-radius: 50%; box-shadow: 0 0 10px #00ff88; }
            #landing-server-name { color: rgba(255,255,255,0.4); font-size: 10px; font-weight: 800; letter-spacing: 0.2em; }
            
            /* Search Blade */
            .search-blade-container { position: absolute; top: 30px; right: 40px; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; pointer-events: none; }
            .search-blade { pointer-events: auto; background: rgba(20, 20, 20, 0.4); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; height: 44px; width: 240px; display: flex; align-items: center; padding: 0 14px; transition: all 0.4s ease; }
            .search-blade:focus-within { width: 380px; background: rgba(30, 30, 30, 0.8); }
            .search-icon { color: rgba(255,255,255,0.3); font-size: 14px; }
            #blade-search-input { flex: 1; background: none; border: none; color: #fff; margin-left: 12px; font-size: 14px; outline: none; }
            
            /* Filter Chips */
            .filter-chips-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; max-width: 450px; }
            .filter-chip { pointer-events: auto; background: rgba(0, 122, 255, 0.15); backdrop-filter: blur(10px); border: 1px solid rgba(0, 122, 255, 0.3); border-radius: 6px; padding: 6px 10px; display: flex; align-items: center; gap: 8px; color: #fff; font-size: 12px; }
            .chip-input { background: none; border: none; color: #fff; width: 80px; outline: none; }
            .chip-close { cursor: pointer; opacity: 0.5; } .chip-close:hover { opacity: 1; color: #ff4444; }
            .chip-val-text { font-weight: 600; color: #8ecfff; }

            /* Utility Nexus (Right Bottom) */
            .utility-nexus { position: absolute; bottom: 40px; right: 40px; display: flex; flex-direction: column; align-items: flex-end; gap: 20px; pointer-events: none; }
            .orb-row { display: flex; gap: 12px; pointer-events: auto; }
            .orb-btn { width: 48px; height: 48px; border-radius: 50%; background: rgba(15, 15, 15, 0.6); backdrop-filter: blur(15px); border: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.5); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.3s; }
            .orb-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; transform: scale(1.05); }
            .orb-btn.active { background: #fff; color: #000; }
            
            .filter-nexus-grid { pointer-events: auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; background: rgba(10, 10, 10, 0.85); backdrop-filter: blur(30px); padding: 15px; border-radius: 20px; border: 1px solid rgba(255, 255, 255, 0.1); opacity: 0; transform: translateY(20px) scale(0.95); visibility: hidden; transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
            .filter-nexus-grid.open { opacity: 1; transform: translateY(0) scale(1); visibility: visible; }
            .nexus-item { width: 70px; height: 70px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border-radius: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); color: rgba(255, 255, 255, 0.4); cursor: pointer; transition: all 0.2s; }
            .nexus-item:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
            .nexus-item.active { background: rgba(0, 122, 255, 0.2); border-color: #007aff; color: #fff; }
            .nexus-label { font-size: 9px; text-transform: uppercase; font-weight: 600; }

            /* --- NEW: FR24 Style Modal --- */
            .filter-config-modal {
                position: absolute;
                bottom: 120px; /* Above the nexus */
                right: 40px;
                width: 320px;
                height: 450px;
                background: rgba(20, 20, 23, 0.95);
                backdrop-filter: blur(40px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 16px;
                display: flex;
                flex-direction: column;
                pointer-events: auto;
                opacity: 0;
                transform: translateX(20px);
                visibility: hidden;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 30px 60px rgba(0,0,0,0.6);
            }
            .filter-config-modal.active { opacity: 1; transform: translateX(0); visibility: visible; }

            .modal-header { height: 50px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: space-between; padding: 0 16px; font-size: 14px; font-weight: 600; color: #fff; }
            .back-btn, .close-btn { background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 16px; transition: color 0.2s; }
            .back-btn:hover, .close-btn:hover { color: #fff; }

            .modal-search { padding: 12px 16px; position: relative; display: flex; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); }
            .modal-search i { position: absolute; left: 26px; color: rgba(255,255,255,0.3); font-size: 12px; }
            #modal-search-input { width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 8px 10px 8px 32px; color: #fff; font-size: 13px; outline: none; }
            #modal-search-input:focus { border-color: rgba(255,255,255,0.3); }

            .modal-list-container { flex: 1; overflow-y: auto; padding: 8px 0; }
            .checklist-item { display: flex; align-items: center; gap: 12px; padding: 10px 20px; cursor: pointer; transition: background 0.1s; }
            .checklist-item:hover { background: rgba(255,255,255,0.05); }
            
            .checkbox { width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
            .checkbox.checked { background: #007aff; border-color: #007aff; }
            .checkbox i { font-size: 10px; color: #fff; }

            .item-info { display: flex; flex-direction: column; }
            .item-name { color: #ddd; font-size: 13px; font-weight: 500; }
            .item-code { color: rgba(255,255,255,0.4); font-size: 11px; }

            .modal-footer { height: 60px; border-top: 1px solid rgba(255,255,255,0.1); padding: 0 20px; display: flex; align-items: center; justify-content: space-between; }
            .selection-summary { color: rgba(255,255,255,0.5); font-size: 12px; }
            .apply-btn { background: #007aff; color: #fff; border: none; padding: 8px 24px; border-radius: 20px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
            .apply-btn:hover { background: #0062cc; }
            
            /* Scrollbar for list */
            .modal-list-container::-webkit-scrollbar { width: 4px; }
            .modal-list-container::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }
        `;

        const style = document.createElement('style');
        style.id = 'landing-ui-fr24-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};

window.LandingUI = LandingUI;