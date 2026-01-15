/**
 * settingsUI.js
 * A functional Settings Engine with a Tabbed Interface integrated with window.mapFilters.
 */

export const SettingsUI = {
    _modalOpen: false,
    _activeTab: 'general', // Track current tab

    settingGroups: {
        general: {
            label: "General",
            icon: "fa-eye",
            settings: [
                { id: 'hideAtcMarkers', label: 'Hide ATC Facilities', type: 'boolean', icon: 'fa-tower-broadcast' },
                { id: 'showUnstaffedAirports', label: 'Show All Airports', type: 'boolean', icon: 'fa-map-location-dot' },
                { id: 'showAircraftLabels', label: 'Show Aircraft Labels', type: 'boolean', icon: 'fa-tag' }
            ]
        },
        map: {
            label: "Map",
            icon: "fa-map",
            settings: [
                { id: 'mapStyle', label: 'Map Style', type: 'select', options: ['dark', 'light', 'satellite'], icon: 'fa-palette' },
                { id: 'useFlatMap', label: 'Flat Map Projection', type: 'boolean', icon: 'fa-layer-group' }
            ]
        },
        interface: {
            label: "Interface",
            icon: "fa-desktop",
            settings: [
                { id: 'useSimpleFlightWindow', label: 'Use Simple Window', type: 'boolean', icon: 'fa-tablet-screen-button' },
                { id: 'planDisplayMode', label: 'Flight Plan Path', type: 'select', options: ['none', 'direct', 'full'], icon: 'fa-route' },
                { id: 'iconColorMode', label: 'Icon Color', type: 'select', options: ['default', 'blue', 'orange'], icon: 'fa-plane' }
            ]
        }
    },

    init() {
        this.injectStyles();
        this.render();
        this.attachListeners();
    },

    render() {
        const existing = document.getElementById('settings-modal-overlay');
        if (existing) existing.remove();

        const html = `
            <div id="settings-modal-overlay" class="modal-overlay">
                <div class="filter-modal settings-modal">
                    <div class="modal-header">
                        <div class="header-main">
                            <div class="header-icon-box"><i class="fa-solid fa-gear"></i></div>
                            <div class="header-text">
                                <h2>System Settings</h2>
                                <span>Configure map and interface behavior</span>
                            </div>
                        </div>
                        <button class="close-modal" id="close-settings-modal">&times;</button>
                    </div>
                    
                    <div class="modal-body tabbed-layout">
                        <div class="settings-sidebar">
                            ${Object.entries(this.settingGroups).map(([key, group]) => `
                                <div class="tab-nav-item ${this._activeTab === key ? 'active' : ''}" data-tab="${key}">
                                    <i class="fa-solid ${group.icon}"></i>
                                    <span>${group.label}</span>
                                </div>
                            `).join('')}
                        </div>

                        <div class="filter-config-pane">
                            <div id="settings-tab-content" class="modal-active-list custom-scroll">
                                ${this.renderActiveTab()}
                            </div>
                            <div class="modal-footer-embedded">
                                <button class="modal-btn primary" id="save-settings-btn">Save & Apply</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    },

    renderActiveTab() {
        const filters = window.mapFilters || {};
        const group = this.settingGroups[this._activeTab];
        
        return `
            <div class="tab-header-mini">${group.label} Settings</div>
            ${group.settings.map(s => {
                const value = filters[s.id];
                let inputHtml = '';

                if (s.type === 'boolean') {
                    inputHtml = `
                        <label class="toggle-switch">
                            <input type="checkbox" id="setting-${s.id}" ${value ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>`;
                } else if (s.type === 'select') {
                    inputHtml = `
                        <select id="setting-${s.id}" class="setting-select">
                            ${s.options.map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt.toUpperCase()}</option>`).join('')}
                        </select>`;
                }

                return `
                    <div class="modal-filter-card">
                        <div class="card-left-strip"></div>
                        <div class="card-content">
                            <div class="row-header">
                                <div class="row-label"><i class="fa-solid ${s.icon} row-icon"></i> ${s.label}</div>
                                ${inputHtml}
                            </div>
                        </div>
                    </div>`;
            }).join('')}`;
    },

    switchTab(tabId) {
        this._activeTab = tabId;
        
        // Update Sidebar UI
        document.querySelectorAll('.tab-nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === tabId);
        });

        // Update Content
        const contentArea = document.getElementById('settings-tab-content');
        if (contentArea) {
            contentArea.innerHTML = this.renderActiveTab();
        }
    },

    attachListeners() {
        document.getElementById('close-settings-modal')?.addEventListener('click', () => this.toggle());
        document.getElementById('save-settings-btn')?.addEventListener('click', () => this.save());
        
        // Tab switching listener
        document.querySelector('.settings-sidebar')?.addEventListener('click', (e) => {
            const navItem = e.target.closest('.tab-nav-item');
            if (navItem) {
                this.switchTab(navItem.dataset.tab);
            }
        });

        // Close on overlay click
        document.getElementById('settings-modal-overlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'settings-modal-overlay') this.toggle();
        });
    },

    save() {
        const prevStyle = window.mapFilters.mapStyle;
        const prevProjection = window.mapFilters.useFlatMap;

        // Collect values ONLY from the currently rendered tab to avoid overwriting 
        // existing filters with nulls from unrendered tabs.
        const currentGroup = this.settingGroups[this._activeTab];
        currentGroup.settings.forEach(s => {
            const el = document.getElementById(`setting-${s.id}`);
            if (!el) return;
            window.mapFilters[s.id] = s.type === 'boolean' ? el.checked : el.value;
        });

        window.saveFiltersToLocalStorage?.();

        if (window.sectorOpsMap) {
            if (window.mapFilters.mapStyle !== prevStyle) {
                const styles = {
                    dark: 'mapbox://styles/mapbox/dark-v11',
                    light: 'mapbox://styles/servernoob/cmg3wq7an002p01s17kbx7lqk',
                    satellite: 'mapbox://styles/mapbox/satellite-streets-v12'
                };
                window.sectorOpsMap.setStyle(styles[window.mapFilters.mapStyle]);
            }

            if (window.mapFilters.useFlatMap !== prevProjection) {
                window.initializeSectorOpsMap?.(); 
            }
        }

        window.updateMapFilters?.();
        this.toggle();
        window.showGlobalNotification?.("Settings Applied", "success");
    },

    toggle() {
        const overlay = document.getElementById('settings-modal-overlay');
        if (overlay) {
            const isNowOpen = overlay.classList.toggle('open');
            if (isNowOpen) {
                this.switchTab(this._activeTab); // Refresh current tab
            }
        }
    },

    injectStyles() {
        const css = `
            .tabbed-layout { display: flex; height: 100%; overflow: hidden; padding: 0 !important; }
            
            .settings-sidebar { 
                width: 200px; 
                background: rgba(0,0,0,0.2); 
                border-right: 1px solid rgba(255,255,255,0.05);
                display: flex;
                flex-direction: column;
                padding: 10px 0;
            }

            .tab-nav-item {
                padding: 12px 20px;
                display: flex;
                align-items: center;
                gap: 12px;
                cursor: pointer;
                color: rgba(255,255,255,0.6);
                transition: all 0.2s;
                border-left: 3px solid transparent;
            }

            .tab-nav-item i { width: 20px; text-align: center; }

            .tab-nav-item:hover { background: rgba(255,255,255,0.05); color: white; }

            .tab-nav-item.active {
                background: rgba(255,255,255,0.1);
                color: #00e5ff;
                border-left-color: #00e5ff;
            }

            .settings-modal .filter-config-pane { flex: 1; display: flex; flex-direction: column; }
            
            .tab-header-mini {
                padding: 15px 20px 5px 20px;
                text-transform: uppercase;
                font-size: 0.7rem;
                letter-spacing: 1px;
                color: rgba(255,255,255,0.4);
                font-weight: bold;
            }

            .setting-select { 
                background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); 
                color: white; border-radius: 4px; padding: 4px 8px; font-size: 0.8rem;
                outline: none;
            }

            .modal-filter-card .toggle-switch { margin-left: auto; scale: 0.8; transform-origin: right; }
        `;
        const style = document.createElement('style');
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }
};