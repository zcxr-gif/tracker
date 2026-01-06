/**
 * LandingUI.js
 * REINVENTION: Tactical Command Palette (TCP)
 * Logic: Bottom-up activation, replacing History Orb with Intelligence Trigger.
 */

export const LandingUI = {
    _isVisible: false,
    _activeFilters: {},

    filterOptions: [
        { id: 'type', label: 'Aircraft', icon: 'fa-plane', placeholder: 'e.g. A320' },
        { id: 'airline', label: 'Operator', icon: 'fa-building', placeholder: 'e.g. BAW' },
        { id: 'callsign', label: 'Callsign', icon: 'fa-id-badge', placeholder: 'e.g. G-...' },
        { id: 'rank', label: 'Pilot Rank', icon: 'fa-star', placeholder: 'e.g. Captain' },
        { id: 'altitude', label: 'Altitude', icon: 'fa-arrows-up-down', placeholder: 'e.g. 35000' },
        { id: 'speed', label: 'Speed', icon: 'fa-gauge-high', placeholder: 'e.g. 450' },
        { id: 'origin', label: 'Origin', icon: 'fa-plane-departure', placeholder: 'e.g. KJFK' },
        { id: 'destination', label: 'Destination', icon: 'fa-plane-arrival', placeholder: 'e.g. EGLL' },
        { id: 'atc', label: 'ATC', icon: 'fa-headset', placeholder: 'e.g. Approach' }
    ],

    presets: [
        { id: 'heavy', label: 'Heavies', filters: { type: 'B77', altitude: '30000+' } },
        { id: 'arrivals', label: 'Arrivals', filters: { destination: 'EGLL' } }
    ],

    init() {
        this.injectStyles();
        this.render();
        this.attachListeners();
    },

    render() {
        const existing = document.getElementById('tactical-command-palette');
        if (existing) existing.remove();

        const html = `
            <div id="tactical-command-root" class="tcp-root">
                <div id="tcp-palette" class="tcp-palette-container">
                    <div class="tcp-search-wrapper">
                        <div class="tcp-glow-layer"></div>
                        <div class="tcp-input-bar">
                            <i class="fa-solid fa-magnifying-glass tcp-search-icon"></i>
                            <div id="tcp-tags" class="tcp-tags-area"></div>
                            <input type="text" id="tcp-main-input" placeholder="Search airspace or activate filter..." autocomplete="off">
                            <div class="tcp-esc-hint">ESC</div>
                        </div>
                    </div>

                    <div id="tcp-smart-grid" class="tcp-smart-grid">
                        <div class="grid-section">
                            <span class="grid-label">Quick Filters</span>
                            <div class="grid-items">
                                ${this.filterOptions.map(f => `
                                    <div class="grid-item" data-filter-id="${f.id}">
                                        <i class="fa-solid ${f.icon}"></i>
                                        <span>${f.label}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                        <div class="grid-section">
                            <span class="grid-label">Presets</span>
                            <div class="preset-items">
                                ${this.presets.map(p => `
                                    <button class="tcp-preset-btn" data-preset="${p.id}">${p.label}</button>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="tcp-side-branding">
                    <div class="tcp-pulse-dot"></div>
                    <span id="tcp-server-name" class="tcp-vertical-text">EXPERT SERVER</span>
                </div>

                <div class="tcp-utility-cluster">
                    <div class="tcp-orb-stack">
                        <button class="tcp-orb" id="tile-weather" title="Weather">
                            <i class="fa-solid fa-cloud"></i>
                        </button>
                        <button class="tcp-orb" id="tile-settings" title="Settings">
                            <i class="fa-solid fa-sliders"></i>
                        </button>
                        <button class="tcp-orb tcp-trigger-orb" id="tcp-intelligence-trigger" title="Search & Filters">
                            <i class="fa-solid fa-microchip"></i>
                            <div class="orb-ring"></div>
                        </button>
                        <button class="tcp-orb highlight-orb" id="tile-server" title="Network">
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
        const trigger = document.getElementById('tcp-intelligence-trigger');
        const input = document.getElementById('tcp-main-input');
        const root = document.getElementById('tactical-command-root');

        // Toggle Palette
        trigger?.addEventListener('click', () => this.togglePalette());

        // Focus Logic
        input?.addEventListener('input', () => this.dispatchFilterUpdate());
        input?.addEventListener('focus', () => {
            document.getElementById('tcp-smart-grid').classList.add('visible');
        });

        // Close on ESC
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this._isVisible) this.togglePalette();
        });

        // Filter Grid Clicks
        document.querySelectorAll('.grid-item').forEach(item => {
            item.addEventListener('click', () => {
                this.toggleFilter(item.dataset.filterId);
            });
        });

        // Preset Clicks
        document.querySelectorAll('.tcp-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = this.presets.find(p => p.id === btn.dataset.preset);
                if (preset) {
                    this._activeFilters = { ...this._activeFilters, ...preset.filters };
                    this.refreshUI();
                }
            });
        });

        // Global UI Actions
        const actions = {
            'tile-weather': () => document.getElementById('open-weather-settings-btn')?.click(),
            'tile-settings': () => document.getElementById('open-filter-settings-btn')?.click(),
            'tile-server': () => {
                const orb = document.getElementById('tile-server');
                orb.classList.add('tcp-pulse-anim');
                setTimeout(() => orb.classList.remove('tcp-pulse-anim'), 1000);
            }
        };

        Object.entries(actions).forEach(([id, fn]) => {
            document.getElementById(id)?.addEventListener('click', fn);
        });
    },

    togglePalette() {
        this._isVisible = !this._isVisible;
        const root = document.getElementById('tactical-command-root');
        const palette = document.getElementById('tcp-palette');
        const trigger = document.getElementById('tcp-intelligence-trigger');

        if (this._isVisible) {
            root.classList.add('active');
            palette.classList.add('active');
            trigger.classList.add('active-orb');
            setTimeout(() => document.getElementById('tcp-main-input').focus(), 100);
        } else {
            root.classList.remove('active');
            palette.classList.remove('active');
            trigger.classList.remove('active-orb');
            document.getElementById('tcp-smart-grid').classList.remove('visible');
        }
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
        const tagContainer = document.getElementById('tcp-tags');
        const gridItems = document.querySelectorAll('.grid-item');

        tagContainer.innerHTML = Object.entries(this._activeFilters).map(([id, value]) => {
            const opt = this.filterOptions.find(f => f.id === id);
            return `
                <div class="tcp-tag">
                    <i class="fa-solid ${opt.icon}"></i>
                    <input type="text" 
                           class="tcp-tag-input" 
                           placeholder="${opt.label}" 
                           value="${value}" 
                           oninput="LandingUI.updateFilterValue('${id}', this.value)"
                           onkeydown="if(event.key==='Enter') this.blur()">
                    <i class="fa-solid fa-xmark tcp-tag-close" onclick="LandingUI.toggleFilter('${id}')"></i>
                </div>
            `;
        }).join('');

        gridItems.forEach(item => {
            item.classList.toggle('selected', this._activeFilters[item.dataset.filterId] !== undefined);
        });

        this.dispatchFilterUpdate();
    },

    dispatchFilterUpdate() {
        const searchTerm = document.getElementById('tcp-main-input')?.value || '';
        const event = new CustomEvent('filterUpdate', { 
            detail: { filters: { ...this._activeFilters }, searchTerm } 
        });
        window.dispatchEvent(event);
    },

    injectStyles() {
        const existing = document.getElementById('tcp-styles');
        if (existing) existing.remove();

        const css = `
            :root {
                --tcp-bg: rgba(10, 10, 12, 0.75);
                --tcp-accent: #00f2ff;
                --tcp-border: rgba(255, 255, 255, 0.1);
                --tcp-blur: blur(30px);
            }

            .tcp-root {
                position: absolute;
                inset: 0;
                pointer-events: none;
                z-index: 3000;
                font-family: 'Inter', sans-serif;
                transition: background 0.5s ease;
            }
            .tcp-root.active {
                background: rgba(0, 0, 0, 0.2);
                pointer-events: auto;
            }

            /* The Central Palette */
            .tcp-palette-container {
                position: absolute;
                top: 35%;
                left: 50%;
                transform: translate(-50%, -20%) scale(0.95);
                width: 700px;
                opacity: 0;
                visibility: hidden;
                transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .tcp-palette-container.active {
                transform: translate(-50%, -20%) scale(1);
                opacity: 1;
                visibility: visible;
            }

            .tcp-search-wrapper {
                position: relative;
                background: var(--tcp-bg);
                backdrop-filter: var(--tcp-blur);
                border: 1px solid var(--tcp-border);
                border-radius: 16px;
                padding: 12px 20px;
                box-shadow: 0 30px 60px rgba(0,0,0,0.5);
            }

            .tcp-input-bar {
                display: flex;
                align-items: center;
                gap: 15px;
            }

            .tcp-search-icon { color: var(--tcp-accent); font-size: 1.2rem; }

            #tcp-main-input {
                flex: 1;
                background: none;
                border: none;
                color: #fff;
                font-size: 1.1rem;
                outline: none;
                padding: 8px 0;
            }

            .tcp-tags-area { display: flex; gap: 8px; flex-wrap: wrap; }

            .tcp-tag {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid var(--tcp-border);
                padding: 4px 10px;
                border-radius: 6px;
                display: flex;
                align-items: center;
                gap: 6px;
                animation: tagPop 0.2s ease-out;
            }

            .tcp-tag-input {
                background: transparent;
                border: none;
                color: var(--tcp-accent);
                width: 70px;
                font-size: 0.8rem;
                outline: none;
            }

            /* Smart Grid */
            .tcp-smart-grid {
                margin-top: 15px;
                background: var(--tcp-bg);
                backdrop-filter: var(--tcp-blur);
                border: 1px solid var(--tcp-border);
                border-radius: 16px;
                padding: 20px;
                display: none;
                grid-template-columns: 1fr 180px;
                gap: 20px;
                animation: slideDown 0.3s ease-out;
            }
            .tcp-smart-grid.visible { display: grid; }

            .grid-label { font-size: 0.65rem; text-transform: uppercase; color: rgba(255,255,255,0.4); letter-spacing: 1.5px; display: block; margin-bottom: 12px; }
            
            .grid-items { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
            .grid-item {
                padding: 12px;
                background: rgba(255,255,255,0.03);
                border: 1px solid var(--tcp-border);
                border-radius: 8px;
                color: rgba(255,255,255,0.6);
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 10px;
                transition: all 0.2s;
            }
            .grid-item:hover, .grid-item.selected { background: rgba(255,255,255,0.1); color: #fff; border-color: var(--tcp-accent); }

            /* Utility & Orbs */
            .tcp-utility-cluster { position: absolute; bottom: 30px; right: 30px; pointer-events: auto; }
            .tcp-orb-stack { display: flex; gap: 12px; align-items: center; }
            
            .tcp-orb {
                width: 46px; height: 46px; border-radius: 50%;
                background: rgba(15, 15, 18, 0.6);
                backdrop-filter: blur(10px);
                border: 1px solid var(--tcp-border);
                color: rgba(255,255,255,0.5);
                cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            .tcp-orb:hover { transform: scale(1.1) translateY(-5px); color: #fff; border-color: rgba(255,255,255,0.3); }
            
            .tcp-trigger-orb { position: relative; border-color: var(--tcp-accent); color: var(--tcp-accent); }
            .tcp-trigger-orb.active-orb { background: var(--tcp-accent); color: #000; }
            
            .orb-ring {
                position: absolute; inset: -3px; border: 1px solid var(--tcp-accent);
                border-radius: 50%; opacity: 0.3; animation: orbRotate 4s linear infinite;
            }

            /* Branding */
            .tcp-side-branding { position: absolute; left: 40px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 15px; }
            .tcp-vertical-text { writing-mode: vertical-rl; text-orientation: mixed; color: rgba(255, 255, 255, 0.2); font-size: 0.7rem; letter-spacing: 4px; font-weight: 700; }
            .tcp-pulse-dot { width: 6px; height: 6px; background: var(--tcp-accent); border-radius: 50%; box-shadow: 0 0 10px var(--tcp-accent); }

            /* Animations */
            @keyframes tagPop { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            @keyframes slideDown { from { transform: translateY(-10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            @keyframes orbRotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            
            .tcp-esc-hint { font-size: 0.6rem; color: rgba(255,255,255,0.3); border: 1px solid rgba(255,255,255,0.2); padding: 2px 5px; border-radius: 4px; }
        `;

        const style = document.createElement('style');
        style.id = 'tcp-styles';
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }
};

window.LandingUI = LandingUI;