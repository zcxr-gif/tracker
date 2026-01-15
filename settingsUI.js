/**
 * settingsUI.js - Optimized Professional Settings Engine
 */

export const SettingsUI = {
    _modalOpen: false,
    _activeGroup: 'general', // Track which tab is active

    settingGroups: {
        general: {
            label: "General Display",
            icon: "fa-eye",
            settings: [
                { id: 'hideAtcMarkers', label: 'Hide ATC Facilities', type: 'boolean', icon: 'fa-tower-broadcast' },
                { id: 'showUnstaffedAirports', label: 'Show All Airports', type: 'boolean', icon: 'fa-map-location-dot' },
                { id: 'showAircraftLabels', label: 'Show Aircraft Labels', type: 'boolean', icon: 'fa-tag' }
            ]
        },
        map: {
            label: "Map Projection",
            icon: "fa-map",
            settings: [
                { id: 'mapStyle', label: 'Map Style', type: 'select', options: ['dark', 'light', 'satellite'], icon: 'fa-palette' },
                { id: 'useFlatMap', label: 'Flat Map Projection', type: 'boolean', icon: 'fa-layer-group' }
            ]
        },
        interface: {
            label: "Interface & UI",
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
                <div class="filter-modal settings-modal-container">
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
                    
                    <div class="modal-body-wrapper">
                        <div class="settings-sidebar custom-scroll">
                            ${Object.entries(this.settingGroups).map(([key, group]) => `
                                <div class="settings-nav-item ${this._activeGroup === key ? 'active' : ''}" data-group="${key}">
                                    <i class="fa-solid ${group.icon}"></i>
                                    <span>${group.label}</span>
                                </div>
                            `).join('')}
                        </div>

                        <div class="settings-content-pane">
                            <div class="config-pane-header">
                                <label id="settings-pane-title">${this.settingGroups[this._activeGroup].label}</label>
                            </div>
                            <div id="settings-active-list" class="settings-list-container custom-scroll">
                                ${this.renderSettingsList(this._activeGroup)}
                            </div>
                            <div class="settings-footer">
                                <button class="modal-btn primary" id="save-settings-btn">Save & Apply</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    },

    renderSettingsList(groupId) {
        const filters = window.mapFilters || {};
        const group = this.settingGroups[groupId];
        
        return group.settings.map(s => {
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
                <div class="setting-card">
                    <div class="setting-card-info">
                        <i class="fa-solid ${s.icon} card-icon"></i>
                        <span class="card-label">${s.label}</span>
                    </div>
                    <div class="setting-card-action">
                        ${inputHtml}
                    </div>
                </div>`;
        }).join('');
    },

    attachListeners() {
        const overlay = document.getElementById('settings-modal-overlay');
        
        // Tab Switching Logic
        overlay?.addEventListener('click', (e) => {
            const navItem = e.target.closest('.settings-nav-item');
            if (navItem) {
                const groupId = navItem.dataset.group;
                this.switchTab(groupId);
            }
        });

        document.getElementById('close-settings-modal')?.addEventListener('click', () => this.toggle());
        document.getElementById('save-settings-btn')?.addEventListener('click', () => this.save());
        
        overlay?.addEventListener('click', (e) => {
            if (e.target.id === 'settings-modal-overlay') this.toggle();
        });
    },

    switchTab(groupId) {
        this._activeGroup = groupId;
        
        // Update UI Classes
        document.querySelectorAll('.settings-nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.group === groupId);
        });

        // Update Title and Content
        document.getElementById('settings-pane-title').innerText = this.settingGroups[groupId].label;
        document.getElementById('settings-active-list').innerHTML = this.renderSettingsList(groupId);
    },

    save() {
        const prevStyle = window.mapFilters?.mapStyle;
        const prevProjection = window.mapFilters?.useFlatMap;

        // Collect all values from ALL groups, not just active one
        Object.values(this.settingGroups).forEach(group => {
            group.settings.forEach(s => {
                const el = document.getElementById(`setting-${s.id}`);
                if (el) {
                    window.mapFilters[s.id] = s.type === 'boolean' ? el.checked : el.value;
                }
            });
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
            overlay.classList.toggle('open');
        }
    },

    injectStyles() {
        const css = `
            .settings-modal-container { 
                width: 750px; 
                max-width: 90vw; 
                background: #1a1a1a; 
                border-radius: 12px; 
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            .modal-body-wrapper { 
                display: flex; 
                height: 500px; 
                background: #111;
            }
            
            /* Sidebar Styles */
            .settings-sidebar { 
                width: 220px; 
                background: rgba(0,0,0,0.2); 
                border-right: 1px solid rgba(255,255,255,0.05);
                padding: 15px 0;
            }
            .settings-nav-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 20px;
                cursor: pointer;
                color: #888;
                transition: all 0.2s;
                font-size: 0.9rem;
            }
            .settings-nav-item:hover { background: rgba(255,255,255,0.03); color: #fff; }
            .settings-nav-item.active { 
                background: rgba(255,255,255,0.05); 
                color: #00e5ff; 
                border-left: 3px solid #00e5ff;
            }
            .settings-nav-item i { width: 20px; text-align: center; }

            /* Content Area */
            .settings-content-pane { 
                flex: 1; 
                display: flex; 
                flex-direction: column; 
                padding: 0;
            }
            .config-pane-header { padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.05); }
            .config-pane-header label { font-size: 1.1rem; color: #fff; font-weight: 600; }
            
            .settings-list-container { flex: 1; padding: 20px; overflow-y: auto; }
            
            /* Cards */
            .setting-card {
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.05);
                border-radius: 8px;
                padding: 12px 16px;
                margin-bottom: 10px;
            }
            .setting-card-info { display: flex; align-items: center; gap: 15px; }
            .card-icon { color: #00e5ff; font-size: 1rem; width: 20px; }
            .card-label { color: #e0e0e0; font-size: 0.9rem; }

            .setting-select { 
                background: #2a2a2a; 
                border: 1px solid #444; 
                color: #fff; 
                border-radius: 4px; 
                padding: 5px 10px; 
                font-size: 0.8rem; 
            }
            
            .settings-footer { 
                padding: 20px; 
                background: rgba(0,0,0,0.2); 
                text-align: right; 
                border-top: 1px solid rgba(255,255,255,0.05);
            }
        `;
        if (!document.getElementById('settings-styles')) {
            const style = document.createElement('style');
            style.id = 'settings-styles';
            style.appendChild(document.createTextNode(css));
            document.head.appendChild(style);
        }
    }
};