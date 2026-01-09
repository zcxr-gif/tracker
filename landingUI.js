/**
 * LandingUI.js - Neon Glass Edition
 * Integrates acdetails.html aesthetic with landingUI.js logic
 */

export const LandingUI = {
    _isVisible: false,
    _isSheetExpanded: false,
    _activeFilters: {},

    // Map your custom UI chips to data keys
    chipMapping: {
        'On Ground': 'grounded',
        'Military': 'mil',
        '7700': 'emergency',
        'Blocked (LADD)': 'ladd',
        'UAT Only': 'uat'
    },

    init() {
        this.injectStyles();
        this.render();
        this.attachListeners();
        // Load Phosphor Icons dynamically if not present
        if (!document.querySelector('script[src*="phosphor-icons"]')) {
            const script = document.createElement('script');
            script.src = "https://unpkg.com/@phosphor-icons/web";
            document.head.appendChild(script);
        }
    },

    render() {
        const existing = document.getElementById('inflight-neon-ui');
        if (existing) existing.remove();

        const html = `
            <div id="inflight-neon-ui" class="neon-ui-root">
                <div class="top-branding">
                    <div class="status-dot"></div>
                    <span id="landing-server-name">EXPERT SERVER</span>
                </div>

                <div class="header-zone">
                    <div class="dynamic-island" id="dynamicIsland">
                        <button class="di-icon-btn" id="menuBtn"><i class="ph ph-list"></i></button>
                        <input type="text" id="blade-search-input" class="di-search" placeholder="Search flight, airport...">
                        <button class="di-icon-btn" id="settings-trigger"><i class="ph ph-gear"></i></button>
                    </div>
                </div>

                <div class="fab-stack">
                    <div class="fab" id="fab-weather" title="Weather Radar"><i class="ph ph-cloud-rain"></i></div>
                    <div class="fab" id="fab-3d" title="3D View"><i class="ph ph-cube"></i></div>
                    <div class="fab" id="fab-locate" title="Locate Me"><i class="ph ph-navigation-arrow"></i></div>
                </div>

                <div class="bottom-sheet" id="filterSheet">
                    <div class="sheet-handle-area" id="sheetDragHandle">
                        <div class="sheet-pill"></div>
                        <div class="quick-chips">
                            <div class="chip" data-filter="grounded">On Ground</div>
                            <div class="chip" data-filter="mil">Military</div>
                            <div class="chip emergency" data-filter="emergency"><i class="ph ph-warning-circle"></i> 7700</div>
                            <div class="chip" data-filter="ladd">Blocked (LADD)</div>
                            <div class="chip" data-filter="uat">UAT Only</div>
                        </div>
                    </div>

                    <div class="sheet-content">
                        <div class="section-title">PHYSICS FILTERS <span id="active-filter-count" style="color:var(--neon-cyan)">Active: 0</span></div>
                        
                        <div class="slider-group">
                            <div class="slider-label"><span>Altitude</span> <span class="slider-val" id="altVal">Any</span></div>
                            <input type="range" id="range-alt" min="0" max="60000" step="1000">
                        </div>

                        <div class="slider-group">
                            <div class="slider-label"><span>Speed (Ground)</span> <span class="slider-val" id="spdVal">Any</span></div>
                            <input type="range" id="range-spd" min="0" max="800" step="10">
                        </div>

                        <div class="section-title">DATA SOURCE INTEGRITY</div>
                        <div class="grid-3">
                            <div class="toggle-box active" data-source="adsb"><div><i class="ph ph-broadcast"></i></div><div>ADS-B</div></div>
                            <div class="toggle-box active" data-source="mlat"><div><i class="ph ph-airplane-tilt"></i></div><div>MLAT</div></div>
                            <div class="toggle-box" data-source="sat"><div><i class="ph ph-planet"></i></div><div>SAT</div></div>
                        </div>
                    </div>
                </div>

                <div class="modal-overlay" id="settingsModal">
                    <div class="settings-card">
                        <h2 style="margin: 0 0 20px 0; font-size: 18px;">Display Options</h2>
                        <div class="switch-row"><span>Dark Mode</span><div class="toggle-switch on"></div></div>
                        <div class="switch-row"><span>Aircraft Labels</span><div class="toggle-switch on"></div></div>
                        <div class="switch-row"><span>Show Trails</span><div class="toggle-switch"></div></div>
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
        const sheet = document.getElementById('filterSheet');
        const handle = document.getElementById('sheetDragHandle');
        const searchInput = document.getElementById('blade-search-input');

        // 1. Bottom Sheet Toggle
        handle?.addEventListener('click', () => {
            this._isSheetExpanded = !this._isSheetExpanded;
            sheet.classList.toggle('expanded', this._isSheetExpanded);
            if(navigator.vibrate) navigator.vibrate(10);
        });

        // 2. Search Logic
        searchInput?.addEventListener('input', () => this.dispatchFilterUpdate());

        // 3. Chip & Toggle Box Logic
        document.querySelectorAll('.chip, .toggle-box').forEach(el => {
            el.addEventListener('click', () => {
                el.classList.toggle('active');
                const filterId = el.dataset.filter || el.dataset.source;
                this.toggleFilter(filterId, el.classList.contains('active'));
            });
        });

        // 4. Slider Logic
        this.setupSlider('range-alt', 'altVal', ' ft');
        this.setupSlider('range-spd', 'spdVal', ' kts');

        // 5. Modal Logic
        const settingsTrigger = document.getElementById('settings-trigger');
        const modal = document.getElementById('settingsModal');
        settingsTrigger?.addEventListener('click', () => modal.classList.toggle('open'));
        modal?.addEventListener('click', (e) => { if(e.target === modal) modal.classList.remove('open'); });

        // 6. FAB Toggle Logic
        document.querySelectorAll('.fab').forEach(fab => {
            fab.addEventListener('click', () => {
                fab.classList.toggle('toggle-active');
                if (fab.id === 'fab-locate') this.dispatchFilterUpdate('locate-me');
            });
        });
    },

    setupSlider(inputId, valId, unit) {
        const input = document.getElementById(inputId);
        const display = document.getElementById(valId);
        input?.addEventListener('input', (e) => {
            const val = e.target.value;
            display.innerText = val === "0" ? "Any" : val + unit;
            this._activeFilters[inputId] = val;
            this.dispatchFilterUpdate();
        });
    },

    toggleFilter(id, isActive) {
        if (isActive) {
            this._activeFilters[id] = true;
        } else {
            delete this._activeFilters[id];
        }
        
        const count = Object.keys(this._activeFilters).filter(k => !k.startsWith('range')).length;
        const countEl = document.getElementById('active-filter-count');
        if (countEl) countEl.innerText = `Active: ${count}`;
        
        this.dispatchFilterUpdate();
    },

    dispatchFilterUpdate(type = 'filterUpdate') {
        const event = new CustomEvent(type, { 
            detail: { 
                filters: { ...this._activeFilters }, 
                searchTerm: document.getElementById('blade-search-input')?.value || '' 
            } 
        });
        window.dispatchEvent(event);
    },

    update(isActive, stats = {}) {
        const el = document.getElementById('inflight-neon-ui');
        if (!el) return;
        isActive ? el.classList.add('active') : el.classList.remove('active');
        if (stats.server) {
            const serverEl = document.getElementById('landing-server-name');
            if (serverEl) serverEl.textContent = stats.server.toUpperCase();
        }
    },

    injectStyles() {
        const css = `
            :root {
                --glass-surface: rgba(20, 20, 20, 0.75);
                --glass-border: rgba(255, 255, 255, 0.08);
                --glass-blur: 24px;
                --text-primary: #F0F0F0;
                --text-secondary: #909090;
                --text-tertiary: #505050;
                --neon-cyan: #00F0FF;
                --neon-red: #FF2E55;
                --ease-elastic: cubic-bezier(0.34, 1.56, 0.64, 1);
            }

            .neon-ui-root {
                position: absolute; inset: 0; z-index: 9999;
                pointer-events: none; opacity: 0; visibility: hidden;
                transition: opacity 0.5s ease;
                font-family: 'Inter', sans-serif;
            }
            .neon-ui-root.active { opacity: 1; visibility: visible; }

            .top-branding {
                position: absolute; top: 20px; left: 24px;
                display: flex; align-items: center; gap: 8px; pointer-events: auto;
            }
            .status-dot { width: 6px; height: 6px; background: var(--neon-cyan); border-radius: 50%; box-shadow: 0 0 10px var(--neon-cyan); }
            #landing-server-name { color: var(--text-secondary); font-size: 10px; font-weight: 800; letter-spacing: 0.1em; }

            .header-zone { width: 100%; display: flex; justify-content: center; padding-top: 16px; }
            .dynamic-island {
                pointer-events: auto; background: var(--glass-surface); backdrop-filter: blur(var(--glass-blur));
                border: 1px solid var(--glass-border); height: 50px; border-radius: 25px;
                display: flex; align-items: center; padding: 4px 6px; gap: 12px; min-width: 280px;
            }
            .di-icon-btn { width: 38px; height: 38px; border-radius: 50%; border: none; background: transparent; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; }
            .di-search { flex: 1; background: transparent; border: none; outline: none; color: white; font-size: 14px; }

            .fab-stack { position: absolute; right: 20px; bottom: 140px; display: flex; flex-direction: column; gap: 12px; pointer-events: auto; }
            .fab { width: 48px; height: 48px; border-radius: 14px; background: var(--glass-surface); backdrop-filter: blur(10px); border: 1px solid var(--glass-border); display: flex; align-items: center; justify-content: center; color: white; cursor: pointer; transition: 0.2s var(--ease-elastic); }
            .fab.toggle-active { color: var(--neon-cyan); border-color: var(--neon-cyan); background: rgba(0, 240, 255, 0.1); }

            .bottom-sheet {
                position: absolute; bottom: 0; left: 0; right: 0; background: #0A0A0A;
                border-top: 1px solid var(--glass-border); border-radius: 24px 24px 0 0;
                transform: translateY(calc(100% - 100px)); transition: transform 0.5s var(--ease-elastic);
                pointer-events: auto; max-height: 80vh; display: flex; flex-direction: column;
            }
            .bottom-sheet.expanded { transform: translateY(0); }
            .sheet-handle-area { width: 100%; padding: 12px 0; display: flex; flex-direction: column; align-items: center; cursor: pointer; }
            .sheet-pill { width: 40px; height: 4px; background: var(--text-tertiary); border-radius: 2px; margin-bottom: 12px; }
            
            .quick-chips { display: flex; gap: 8px; padding: 0 20px; overflow-x: auto; width: 100%; box-sizing: border-box; }
            .chip { padding: 6px 12px; border-radius: 100px; background: rgba(255,255,255,0.05); color: var(--text-secondary); font-size: 12px; white-space: nowrap; border: 1px solid transparent; }
            .chip.active { background: rgba(0, 240, 255, 0.1); border-color: var(--neon-cyan); color: var(--neon-cyan); }
            .chip.emergency.active { color: var(--neon-red); border-color: var(--neon-red); }

            .sheet-content { padding: 20px 24px 40px; overflow-y: auto; }
            .section-title { font-size: 10px; color: var(--text-tertiary); letter-spacing: 1px; margin: 20px 0 10px; }
            
            input[type=range] { width: 100%; -webkit-appearance: none; background: transparent; }
            input[type=range]::-webkit-slider-runnable-track { height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; }
            input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 16px; width: 16px; border-radius: 50%; background: var(--text-primary); margin-top: -6px; }

            .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
            .toggle-box { background: rgba(255,255,255,0.03); border-radius: 12px; padding: 10px; text-align: center; cursor: pointer; border: 1px solid transparent; }
            .toggle-box.active { border-color: var(--neon-cyan); color: var(--neon-cyan); }

            .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center; z-index: 10001; pointer-events: auto; }
            .modal-overlay.open { display: flex; }
            .settings-card { width: 90%; max-width: 340px; background: #151515; border: 1px solid var(--glass-border); border-radius: 24px; padding: 24px; }
            .switch-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
            .toggle-switch { width: 40px; height: 20px; background: #333; border-radius: 10px; position: relative; }
            .toggle-switch.on { background: var(--neon-cyan); }
            .toggle-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: white; border-radius: 50%; transition: 0.2s; }
            .toggle-switch.on::after { transform: translateX(20px); }
        `;

        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }
};

window.LandingUI = LandingUI;