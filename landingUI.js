/**
 * LandingUI.js
 * REDESIGN: Spatial Minimalist - FR24 Style Modal Flow
 * * BEHAVIOR:
 * 1. No chips near the top search bar.
 * 2. Clicking a Filter Orb opens a detached "Panel".
 * 3. Panel has navigation (Main Menu -> Specific Category).
 * 4. Inside a category (e.g. Aircraft), user sees a search bar AND a scrollable list.
 * 5. Selections accumulate in the Panel Footer.
 */

export const LandingUI = {
    _filterPanelOpen: false,
    _currentView: 'home', // 'home' or 'category_view'
    _activeCategory: null,
    _tempSelections: {}, // Stores selections before hitting "Continue"

    // Mock Data to simulate the list in the screenshot (The "Loose Ends")
    mockData: {
        type: ['Airbus A318', 'Airbus A319', 'Airbus A320', 'Airbus A320neo', 'Airbus A321', 'Boeing 737-800', 'Boeing 777-300ER', 'Cessna 172'],
        airline: ['Delta', 'United', 'American', 'Lufthansa', 'British Airways', 'Emirates', 'Qatar'],
        origin: ['KJFK', 'EGLL', 'KLAX', 'OMDB', 'WSSS', 'RJTT'],
    },

    filterOptions: [
        { id: 'type', label: 'Aircraft', icon: 'fa-plane' },
        { id: 'airline', label: 'Operator', icon: 'fa-building' },
        { id: 'callsign', label: 'Callsign', icon: 'fa-id-badge' },
        { id: 'rank', label: 'Rank', icon: 'fa-star' },
        { id: 'altitude', label: 'Altitude', icon: 'fa-arrows-up-down', isRange: true },
        { id: 'speed', label: 'Speed', icon: 'fa-gauge-high', isRange: true },
        { id: 'origin', label: 'Origin', icon: 'fa-plane-departure' },
        { id: 'destination', label: 'Destination', icon: 'fa-plane-arrival' },
        { id: 'groups', label: 'Groups', icon: 'fa-users-rays' }
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
                        <input type="text" id="blade-search-input" placeholder="Search global airspace..." autocomplete="off">
                        <div class="search-shortcut">⌘K</div>
                    </div>
                </div>

                <div id="fr24-filter-panel" class="fr24-panel">
                    </div>

                <div class="utility-nexus">
                    <div class="orb-row">
                        <button class="orb-btn" id="tile-weather"><i class="fa-solid fa-cloud"></i></button>
                        <button class="orb-btn" id="tile-settings"><i class="fa-solid fa-sliders"></i></button>
                        
                        <button class="orb-btn nexus-trigger" id="toggle-filter-panel">
                            <i class="fa-solid fa-filter"></i>
                            <div id="filter-badge" class="filter-badge hidden">0</div>
                        </button>
                        
                        <button class="orb-btn highlight-orb" id="tile-server"><i class="fa-solid fa-wifi"></i></button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('sector-ops-map-fullscreen')?.insertAdjacentHTML('beforeend', html);
    },

    attachListeners() {
        const toggleBtn = document.getElementById('toggle-filter-panel');
        const panel = document.getElementById('fr24-filter-panel');

        toggleBtn?.addEventListener('click', () => {
            this._filterPanelOpen = !this._filterPanelOpen;
            panel.classList.toggle('active', this._filterPanelOpen);
            toggleBtn.classList.toggle('active', this._filterPanelOpen);
            
            if (this._filterPanelOpen) {
                this.renderMainMenu();
            }
        });

        // Close panel when clicking outside (optional, good UX)
        document.addEventListener('click', (e) => {
            if (this._filterPanelOpen && !panel.contains(e.target) && !toggleBtn.contains(e.target)) {
                this._filterPanelOpen = false;
                panel.classList.remove('active');
                toggleBtn.classList.remove('active');
            }
        });
    },

    // ---------------------------------------------------------
    // RENDER STATES
    // ---------------------------------------------------------

    // State 1: The Grid of Categories (Initial View)
    renderMainMenu() {
        const panel = document.getElementById('fr24-filter-panel');
        this._currentView = 'home';
        
        panel.innerHTML = `
            <div class="panel-header">
                <span class="panel-title">FILTERS</span>
                <button class="panel-close-btn" onclick="LandingUI.closePanel()"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="panel-content grid-view">
                ${this.filterOptions.map(opt => `
                    <div class="category-card" onclick="LandingUI.openCategory('${opt.id}')">
                        <i class="fa-solid ${opt.icon}"></i>
                        <span>${opt.label}</span>
                        ${this._tempSelections[opt.id] ? '<div class="active-dot"></div>' : ''}
                    </div>
                `).join('')}
            </div>
            <div class="panel-footer-placeholder">
                <span class="hint-text">Select a category to filter</span>
            </div>
        `;
    },

    // State 2: The Specific Filter View (The Screenshot Look)
    openCategory(id) {
        this._activeCategory = id;
        this._currentView = 'category';
        const option = this.filterOptions.find(o => o.id === id);
        const panel = document.getElementById('fr24-filter-panel');

        // Check if we have mock data for this list, or use generic inputs
        const hasList = this.mockData[id] !== undefined;

        let contentHtml = '';

        if (hasList) {
            // Render Search Bar + List (Screenshot Style)
            contentHtml = `
                <div class="local-search-container">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="cat-search" placeholder="Find ${option.label}..." oninput="LandingUI.filterList(this.value)">
                </div>
                <div class="scrollable-list" id="selection-list">
                    ${this.renderListItems(id)}
                </div>
            `;
        } else if (option.isRange) {
            // Render Range Sliders (Altitude/Speed)
            contentHtml = `
                <div class="range-container">
                    <label>Min</label>
                    <input type="number" class="range-input" id="range-min" placeholder="0">
                    <div class="range-divider"></div>
                    <label>Max</label>
                    <input type="number" class="range-input" id="range-max" placeholder="Unlimited">
                </div>
            `;
        } else {
            // Generic Text Input fallback
            contentHtml = `
                 <div class="local-search-container">
                    <input type="text" id="generic-input" placeholder="Enter ${option.label}...">
                </div>
            `;
        }

        panel.innerHTML = `
            <div class="panel-header">
                <button class="back-btn" onclick="LandingUI.renderMainMenu()"><i class="fa-solid fa-chevron-left"></i></button>
                <span class="panel-title">FILTER BY ${option.label.toUpperCase()}</span>
                <button class="panel-close-btn" onclick="LandingUI.closePanel()"><i class="fa-solid fa-xmark"></i></button>
            </div>
            
            <div class="panel-content list-view">
                ${contentHtml}
            </div>

            <div class="panel-footer" id="panel-footer">
                ${this.renderFooterChips(id)}
            </div>
        `;
    },

    renderListItems(categoryId, searchTerm = '') {
        const items = this.mockData[categoryId] || [];
        const currentSelections = this._tempSelections[categoryId] || [];

        // Filter mock data
        const filtered = items.filter(item => item.toLowerCase().includes(searchTerm.toLowerCase()));

        return filtered.map(item => {
            const isSelected = currentSelections.includes(item);
            return `
                <div class="list-row ${isSelected ? 'selected' : ''}" onclick="LandingUI.toggleSelection('${item}')">
                    <div class="checkbox-circle">
                        ${isSelected ? '<i class="fa-solid fa-check"></i>' : ''}
                    </div>
                    <span class="row-label">${item}</span>
                    <span class="row-code">CODE</span>
                </div>
            `;
        }).join('');
    },

    // ---------------------------------------------------------
    // LOGIC
    // ---------------------------------------------------------

    toggleSelection(value) {
        const cat = this._activeCategory;
        if (!this._tempSelections[cat]) this._tempSelections[cat] = [];

        const index = this._tempSelections[cat].indexOf(value);
        if (index > -1) {
            this._tempSelections[cat].splice(index, 1); // Remove
        } else {
            this._tempSelections[cat].push(value); // Add
        }

        // Re-render only list and footer to maintain state
        document.getElementById('selection-list').innerHTML = this.renderListItems(cat, document.getElementById('cat-search')?.value || '');
        document.getElementById('panel-footer').innerHTML = this.renderFooterChips(cat);
    },

    filterList(term) {
        document.getElementById('selection-list').innerHTML = this.renderListItems(this._activeCategory, term);
    },

    renderFooterChips(catId) {
        const selections = this._tempSelections[catId] || [];
        
        if (selections.length === 0) {
            return `<button class="continue-btn disabled">Continue</button>`;
        }

        return `
            <div class="footer-chips-scroll">
                ${selections.map(val => `
                    <div class="mini-chip">
                        ${val} <i class="fa-solid fa-xmark" onclick="event.stopPropagation(); LandingUI.toggleSelection('${val}')"></i>
                    </div>
                `).join('')}
            </div>
            <button class="continue-btn" onclick="LandingUI.applyFilters()">Continue (${selections.length})</button>
        `;
    },

    applyFilters() {
        // This is where you connect the "Loose Ends" to your backend/map
        console.log("Filters Applied:", this._tempSelections);
        
        // Update badge on the main orb
        const totalFilters = Object.values(this._tempSelections).flat().length;
        const badge = document.getElementById('filter-badge');
        if(badge) {
            badge.textContent = totalFilters;
            badge.classList.toggle('hidden', totalFilters === 0);
        }

        this.closePanel();
        
        // Dispatch event for other systems
        window.dispatchEvent(new CustomEvent('filterUpdate', { detail: this._tempSelections }));
    },

    closePanel() {
        this._filterPanelOpen = false;
        document.getElementById('fr24-filter-panel')?.classList.remove('active');
        document.getElementById('toggle-filter-panel')?.classList.remove('active');
    },

    injectStyles() {
        const css = `
            :root {
                --panel-bg: rgba(18, 18, 18, 0.95);
                --panel-border: rgba(255, 255, 255, 0.1);
                --accent-gold: #ffc107; /* The FR24 active color */
                --text-muted: rgba(255, 255, 255, 0.5);
            }

            .tactical-ui-root {
                position: absolute; inset: 0; z-index: 2000; pointer-events: none;
                font-family: 'Inter', sans-serif;
            }

            /* Branding & Search (Top) */
            .top-branding { position: absolute; top: 30px; left: 40px; display: flex; align-items: center; gap: 12px; pointer-events: auto; }
            .status-dot { width: 6px; height: 6px; background: #00ff88; border-radius: 50%; box-shadow: 0 0 10px #00ff88; }
            #landing-server-name { color: var(--text-muted); font-size: 10px; font-weight: 800; letter-spacing: 0.2em; }

            .search-blade-container { position: absolute; top: 30px; right: 40px; pointer-events: none; }
            .search-blade {
                pointer-events: auto; background: rgba(20, 20, 20, 0.6); backdrop-filter: blur(20px);
                border: 1px solid var(--panel-border); border-radius: 12px; height: 44px; width: 240px;
                display: flex; align-items: center; padding: 0 14px; transition: all 0.3s;
            }
            #blade-search-input { flex: 1; background: none; border: none; color: #fff; margin-left: 12px; outline: none; }
            .search-icon { color: var(--text-muted); }

            /* --- THE MAIN PANEL (The FR24 Lookalike) --- */
            .fr24-panel {
                pointer-events: auto;
                position: absolute;
                bottom: 100px; /* Floating above the nexus */
                right: 40px;
                width: 360px;
                height: 500px;
                background: var(--panel-bg);
                backdrop-filter: blur(40px);
                border: 1px solid var(--panel-border);
                border-radius: 16px;
                display: flex; flex-direction: column;
                box-shadow: 0 30px 80px rgba(0,0,0,0.6);
                
                opacity: 0; transform: translateY(20px) scale(0.95); visibility: hidden;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                overflow: hidden;
            }
            .fr24-panel.active { opacity: 1; transform: translateY(0) scale(1); visibility: visible; }

            /* Header */
            .panel-header {
                height: 50px; border-bottom: 1px solid var(--panel-border);
                display: flex; align-items: center; justify-content: space-between; padding: 0 16px;
                background: rgba(255,255,255,0.02);
            }
            .panel-title { font-size: 12px; font-weight: 700; letter-spacing: 1px; color: #fff; text-transform: uppercase; }
            .back-btn, .panel-close-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 14px; }
            .back-btn:hover, .panel-close-btn:hover { color: #fff; }

            /* Content Area */
            .panel-content { flex: 1; overflow-y: auto; position: relative; }
            
            /* Grid View (Main Menu) */
            .grid-view { padding: 16px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
            .category-card {
                aspect-ratio: 1; background: rgba(255,255,255,0.04); border-radius: 12px;
                display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
                cursor: pointer; transition: 0.2s; border: 1px solid transparent; position: relative;
            }
            .category-card:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.1); }
            .category-card i { font-size: 18px; color: var(--text-muted); }
            .category-card span { font-size: 10px; font-weight: 600; color: #ccc; }
            .active-dot { position: absolute; top: 8px; right: 8px; width: 6px; height: 6px; background: var(--accent-gold); border-radius: 50%; }

            /* List View (Inside Category) */
            .local-search-container {
                margin: 16px; padding: 0 12px; height: 40px;
                background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid var(--panel-border);
                display: flex; align-items: center; gap: 10px;
            }
            #cat-search { background: none; border: none; width: 100%; color: #fff; outline: none; }
            
            .list-row {
                padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,0.03);
                display: flex; align-items: center; gap: 12px; cursor: pointer; transition: 0.2s;
            }
            .list-row:hover { background: rgba(255,255,255,0.05); }
            
            /* The Selection State (Gold) */
            .list-row.selected { background: rgba(255, 193, 7, 0.15); }
            .list-row.selected .checkbox-circle { background: var(--accent-gold); border-color: var(--accent-gold); color: #000; }
            .checkbox-circle {
                width: 18px; height: 18px; border-radius: 4px; border: 2px solid var(--text-muted);
                display: flex; align-items: center; justify-content: center; font-size: 10px; transition: 0.2s;
            }
            .row-label { font-size: 13px; color: #fff; font-weight: 500; flex: 1; }
            .row-code { font-size: 10px; color: var(--text-muted); background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px; }

            /* Footer (Sticky) */
            .panel-footer {
                background: rgba(30,30,30,0.9); border-top: 1px solid var(--panel-border);
                padding: 12px; display: flex; flex-direction: column; gap: 8px;
            }
            .footer-chips-scroll { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
            .mini-chip {
                background: var(--accent-gold); color: #000; font-size: 11px; font-weight: 600;
                padding: 4px 8px; border-radius: 4px; display: flex; align-items: center; gap: 6px; white-space: nowrap;
            }
            .mini-chip i { cursor: pointer; opacity: 0.6; } .mini-chip i:hover { opacity: 1; }
            
            .continue-btn {
                width: 100%; height: 36px; background: #007aff; border: none; border-radius: 6px;
                color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; transition: 0.2s;
            }
            .continue-btn:hover { background: #006add; }
            .continue-btn.disabled { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.3); pointer-events: none; }

            /* Bottom Right Nexus */
            .utility-nexus { position: absolute; bottom: 40px; right: 40px; pointer-events: none; }
            .orb-row { display: flex; gap: 12px; pointer-events: auto; }
            .orb-btn {
                width: 48px; height: 48px; border-radius: 50%; position: relative;
                background: rgba(15, 15, 15, 0.6); backdrop-filter: blur(15px);
                border: 1px solid var(--panel-border); color: var(--text-muted);
                cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.3s;
            }
            .orb-btn:hover, .orb-btn.active { background: #fff; color: #000; }
            .filter-badge {
                position: absolute; top: -2px; right: -2px; background: var(--accent-gold); color: #000;
                width: 16px; height: 16px; border-radius: 50%; font-size: 10px; font-weight: 800;
                display: flex; align-items: center; justify-content: center;
            }
            .filter-badge.hidden { display: none; }
        `;

        const style = document.createElement('style');
        style.id = 'landing-ui-spatial-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};

window.LandingUI = LandingUI;