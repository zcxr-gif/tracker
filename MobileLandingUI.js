/**
 * MobileLandingUI.js
 * Handles responsive overrides for the Tactical UI.
 * Features: Tabbed Interface, Bottom-Sheet Layout, and Touch-Optimized Filters.
 */

export const MobileLandingUI = {
    _activeTab: 'filters', // 'filters' or 'settings'
    _isOpen: false,

    init(parentUI) {
        this.parent = parentUI; // Reference to the main LandingUI logic
        this.injectMobileStyles();
        this.renderMobileContainer();
        this.attachMobileListeners();
    },

    renderMobileContainer() {
        const existing = document.getElementById('mobile-tactical-nexus');
        if (existing) existing.remove();

        const html = `
            <div id="mobile-tactical-nexus" class="mobile-only-ui">
                <div id="mobile-overlay" class="mobile-sheet-overlay"></div>

                <div class="mobile-bottom-sheet">
                    <div class="sheet-handle"></div>
                    
                    <div class="sheet-tabs">
                        <button class="sheet-tab-btn active" data-tab="filters">
                            <i class="fa-solid fa-sliders"></i>
                            <span>Filters</span>
                        </button>
                        <button class="sheet-tab-btn" data-tab="settings">
                            <i class="fa-solid fa-gear"></i>
                            <span>Settings</span>
                        </button>
                    </div>

                    <div class="sheet-content custom-scroll">
                        <div id="mobile-tab-filters" class="tab-pane active">
                            <div class="mobile-filter-list">
                                <div class="mobile-section-header">Active Rules</div>
                                <div id="mobile-active-rules-container"></div>
                                
                                <div class="mobile-section-header">Add Filters</div>
                                <div class="mobile-filter-grid">
                                    ${this.renderFilterGrid()}
                                </div>
                            </div>
                        </div>

                        <div id="mobile-tab-settings" class="tab-pane">
                            <div class="mobile-settings-list">
                                <div class="mobile-setting-item">
                                    <label>Current Server</label>
                                    <div class="mobile-server-pills">
                                        <button class="srv-pill ${this.parent._currentServer === 'Expert' ? 'active' : ''}" data-val="Expert">Expert</button>
                                        <button class="srv-pill ${this.parent._currentServer === 'Training' ? 'active' : ''}" data-val="Training">Training</button>
                                        <button class="srv-pill ${this.parent._currentServer === 'Casual' ? 'active' : ''}" data-val="Casual">Casual</button>
                                    </div>
                                </div>
                                <div class="mobile-setting-item">
                                    <label>Map Region</label>
                                    <div class="val-display">Global Airspace</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="sheet-footer">
                        <button id="mobile-reset-btn" class="m-btn m-secondary">Reset</button>
                        <button id="mobile-apply-btn" class="m-btn m-primary">Apply Changes</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('sector-ops-map-fullscreen')?.insertAdjacentHTML('beforeend', html);
    },

    renderFilterGrid() {
        // Flatten filter groups for a clean mobile grid
        let html = '';
        Object.values(this.parent.filterGroups).forEach(group => {
            group.filters.forEach(f => {
                html += `
                    <button class="m-grid-item" data-id="${f.id}">
                        <i class="fa-solid ${f.icon}"></i>
                        <span>${f.label}</span>
                    </button>
                `;
            });
        });
        return html;
    },

    attachMobileListeners() {
        const sheet = document.querySelector('.mobile-bottom-sheet');
        const overlay = document.getElementById('mobile-overlay');

        // Toggle UI
        window.addEventListener('openMobileUI', () => {
            this._isOpen = true;
            sheet.classList.add('open');
            overlay.classList.add('visible');
            this.syncActiveRules();
        });

        const closeUI = () => {
            this._isOpen = false;
            sheet.classList.remove('open');
            overlay.classList.remove('visible');
        };

        overlay.addEventListener('click', closeUI);

        // Tab Switching
        document.querySelectorAll('.sheet-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                document.querySelectorAll('.sheet-tab-btn, .tab-pane').forEach(el => el.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`mobile-tab-${tab}`).classList.add('active');
            });
        });

        // Add Filter from Grid
        document.querySelectorAll('.m-grid-item').forEach(btn => {
            btn.addEventListener('click', () => {
                this.parent.activateFilter(btn.dataset.id);
                this.syncActiveRules();
            });
        });

        // Server Switching
        document.querySelectorAll('.srv-pill').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const val = btn.dataset.val;
                this.parent._currentServer = val;
                document.querySelectorAll('.srv-pill').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                // Sync back to main UI
                document.getElementById('landing-server-name').textContent = `${val.toUpperCase()} SERVER`;
                window.dispatchEvent(new CustomEvent('serverChange', { detail: { server: val } }));
            });
        });

        // Footer Actions
        document.getElementById('mobile-apply-btn').addEventListener('click', () => {
            this.parent.dispatchFilterUpdate();
            closeUI();
        });

        document.getElementById('mobile-reset-btn').addEventListener('click', () => {
            this.parent._activeFilters = {};
            this.syncActiveRules();
            this.parent.dispatchFilterUpdate();
        });
    },

    syncActiveRules() {
        const container = document.getElementById('mobile-active-rules-container');
        if (!container) return;

        const activeEntries = Object.entries(this.parent._activeFilters);
        if (activeEntries.length === 0) {
            container.innerHTML = `<p class="m-empty-text">No active filters. Tap below to add.</p>`;
            return;
        }

        container.innerHTML = activeEntries.map(([id, value]) => {
            const def = this.parent.allFilters.find(f => f.id === id);
            return `
                <div class="m-active-card">
                    <div class="m-card-info">
                        <i class="fa-solid ${def.icon}"></i>
                        <span>${def.label}</span>
                    </div>
                    <div class="m-card-input">
                        ${this.parent.renderInputControl(id, value)}
                    </div>
                    <button class="m-card-remove" onclick="MobileLandingUI.removeRule('${id}')">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            `;
        }).join('');
    },

    removeRule(id) {
        this.parent.removeFilter(id);
        this.syncActiveRules();
    },

    injectMobileStyles() {
        const css = `
            @media (min-width: 769px) { .mobile-only-ui { display: none; } }
            @media (max-width: 768px) {
                .tactical-ui-root .top-right-actions, 
                .tactical-ui-root .top-branding,
                .modal-overlay { display: none !important; }

                .mobile-sheet-overlay {
                    position: fixed; inset: 0; background: rgba(0,0,0,0.6); 
                    opacity: 0; visibility: hidden; transition: 0.3s; z-index: 5000;
                }
                .mobile-sheet-overlay.visible { opacity: 1; visibility: visible; }

                .mobile-bottom-sheet {
                    position: fixed; bottom: 0; left: 0; right: 0;
                    background: #0f0f11; border-top: 1px solid rgba(255,255,255,0.1);
                    border-radius: 24px 24px 0 0; z-index: 5001;
                    height: 80vh; transform: translateY(100%); transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                    display: flex; flex-direction: column; color: #fff;
                }
                .mobile-bottom-sheet.open { transform: translateY(0); }

                .sheet-handle { width: 40px; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; margin: 12px auto; }
                
                .sheet-tabs { display: flex; border-bottom: 1px solid rgba(255,255,255,0.05); }
                .sheet-tab-btn { 
                    flex: 1; padding: 16px; background: none; border: none; color: #71717a; 
                    display: flex; flex-direction: column; align-items: center; gap: 4px; font-weight: 600; font-size: 0.75rem;
                }
                .sheet-tab-btn.active { color: #38bdf8; border-bottom: 2px solid #38bdf8; }
                .sheet-tab-btn i { font-size: 1.1rem; }

                .sheet-content { flex: 1; overflow-y: auto; padding: 20px; }
                .tab-pane { display: none; }
                .tab-pane.active { display: block; }

                .mobile-section-header { font-size: 0.65rem; font-weight: 900; color: #3f3f46; text-transform: uppercase; letter-spacing: 1.5px; margin: 20px 0 12px; }
                
                .mobile-filter-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
                .m-grid-item { 
                    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); 
                    border-radius: 12px; padding: 12px 8px; color: #a1a1aa; display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 0.7rem;
                }

                .m-active-card { 
                    background: #18181b; border: 1px solid #38bdf8; border-radius: 14px; 
                    padding: 15px; margin-bottom: 10px; position: relative;
                }
                .m-card-info { display: flex; align-items: center; gap: 10px; font-weight: 700; margin-bottom: 12px; }
                .m-card-info i { color: #38bdf8; }
                .m-card-remove { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #ef4444; font-size: 1.2rem; }

                .mobile-server-pills { display: flex; gap: 8px; margin-top: 10px; }
                .srv-pill { flex: 1; padding: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: none; color: #fff; font-size: 0.8rem; }
                .srv-pill.active { background: #38bdf8; color: #000; border-color: #38bdf8; }

                .sheet-footer { padding: 20px; border-top: 1px solid rgba(255,255,255,0.05); display: flex; gap: 12px; }
                .m-btn { flex: 1; padding: 14px; border-radius: 12px; font-weight: 700; border: none; }
                .m-primary { background: #38bdf8; color: #000; }
                .m-secondary { background: rgba(255,255,255,0.05); color: #fff; }
                
                .m-empty-text { color: #3f3f46; font-size: 0.85rem; text-align: center; margin: 20px 0; }
            }
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }
};

window.MobileLandingUI = MobileLandingUI; // Global exposure for onclick handlers