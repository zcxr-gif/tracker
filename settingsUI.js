/**
 * settingsUI.js
 * A functional Settings Engine integrated with window.mapFilters.
 */

export const SettingsUI = {
    _modalOpen: false,

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
                    
                    <div class="modal-body">
                        <div class="filter-selection-pane custom-scroll">
                            ${Object.entries(this.settingGroups).map(([key, group]) => `
                                <div class="filter-group-wrapper">
                                    <div class="filter-group-header">${group.label}</div>
                                    <div class="filter-options-list">
                                        ${group.settings.map(s => `
                                            <div class="nexus-item static-item">
                                                <div class="nexus-icon"><i class="fa-solid ${s.icon}"></i></div>
                                                <span class="nexus-label">${s.label}</span>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            `).join('')}
                        </div>

                        <div class="filter-config-pane">
                            <div class="config-header"><label>Configuration</label></div>
                            <div id="settings-active-list" class="modal-active-list custom-scroll">
                                ${this.renderSettingsList()}
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

    renderSettingsList() {
        const filters = window.mapFilters || {};
        return Object.values(this.settingGroups).map(group => {
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
                    <div class="modal-filter-card">
                        <div class="card-left-strip"></div>
                        <div class="card-content">
                            <div class="row-header">
                                <div class="row-label"><i class="fa-solid ${s.icon} row-icon"></i> ${s.label}</div>
                                ${inputHtml}
                            </div>
                        </div>
                    </div>`;
            }).join('');
        }).join('');
    },

    attachListeners() {
        document.getElementById('close-settings-modal')?.addEventListener('click', () => this.toggle());
        document.getElementById('save-settings-btn')?.addEventListener('click', () => this.save());
        
        // Close on overlay click
        document.getElementById('settings-modal-overlay')?.addEventListener('click', (e) => {
            if (e.target.id === 'settings-modal-overlay') this.toggle();
        });
    },

    save() {
        const prevStyle = window.mapFilters.mapStyle;
        const prevProjection = window.mapFilters.useFlatMap;

        // 1. Collect values from UI
        Object.values(this.settingGroups).forEach(group => {
            group.settings.forEach(s => {
                const el = document.getElementById(`setting-${s.id}`);
                if (!el) return;
                window.mapFilters[s.id] = s.type === 'boolean' ? el.checked : el.value;
            });
        });

        // 2. Persist to Local Storage
        window.saveFiltersToLocalStorage?.();

        // 3. Handle Special Updates (Map Style & Projection)
        if (window.sectorOpsMap) {
            // Update Style
            if (window.mapFilters.mapStyle !== prevStyle) {
                const styles = {
                    dark: 'mapbox://styles/mapbox/dark-v11',
                    light: 'mapbox://styles/servernoob/cmg3wq7an002p01s17kbx7lqk',
                    satellite: 'mapbox://styles/mapbox/satellite-streets-v12'
                };
                window.sectorOpsMap.setStyle(styles[window.mapFilters.mapStyle]);
            }

            // Update Projection (Requires re-init because projection is a load-time setting)
            if (window.mapFilters.useFlatMap !== prevProjection) {
                window.initializeSectorOpsMap?.(); 
            }
        }

        // 4. Trigger standard filter updates (Aicraft/ATC markers)
        window.updateMapFilters?.();

        this.toggle();
        window.showGlobalNotification?.("Settings Applied", "success");
    },

    toggle() {
        const overlay = document.getElementById('settings-modal-overlay');
        if (overlay) {
            const isNowOpen = overlay.classList.toggle('open');
            if (isNowOpen) {
                document.getElementById('settings-active-list').innerHTML = this.renderSettingsList();
            }
        }
    },

    injectStyles() {
        const css = `
            .settings-modal .filter-selection-pane { width: 35%; }
            .settings-modal .filter-config-pane { width: 65%; }
            .setting-select { 
                background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); 
                color: white; border-radius: 4px; padding: 4px 8px; font-size: 0.8rem;
            }
            .modal-filter-card .toggle-switch { margin-left: auto; scale: 0.8; transform-origin: right; }
        `;
        const style = document.createElement('style');
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }
};