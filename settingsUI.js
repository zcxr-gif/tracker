/**
 * settingsUI.js
 * A redesigned Settings Engine that mirrors the style of the Tactical Filters.
 */

export const SettingsUI = {
    _modalOpen: false,

    // Grouped settings matching the mapFilters state in flight.js
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
                            <div class="config-header">
                                <label>Configuration</label>
                            </div>
                            <div id="settings-active-list" class="modal-active-list custom-scroll">
                                ${this.renderSettingsList()}
                            </div>
                            <div class="modal-footer-embedded">
                                <button class="modal-btn primary" id="save-settings-btn">Save & Apply</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('sector-ops-map-fullscreen').insertAdjacentHTML('beforeend', html);
    },

    renderSettingsList() {
        // Access mapFilters from global scope (flight.js)
        const filters = window.mapFilters || {};
        
        return Object.values(this.settingGroups).map(group => {
            return group.settings.map(s => {
                const value = filters[s.id];
                return `
                    <div class="modal-filter-card">
                        <div class="card-left-strip"></div>
                        <div class="card-content">
                            <div class="row-header">
                                <div class="row-label">
                                    <i class="fa-solid ${s.icon}"></i>
                                    <span>${s.label}</span>
                                </div>
                            </div>
                            <div class="row-control">
                                ${this.renderControl(s, value)}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }).join('');
    },

    renderControl(setting, value) {
        if (setting.type === 'boolean') {
            return `
                <label class="toggle-switch">
                    <input type="checkbox" class="setting-input" data-id="${setting.id}" ${value ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </label>
            `;
        }
        if (setting.type === 'select') {
            return `
                <div class="input-wrapper select-wrapper">
                    <select class="row-input-select setting-input" data-id="${setting.id}">
                        ${setting.options.map(opt => `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt.toUpperCase()}</option>`).join('')}
                    </select>
                    <i class="fa-solid fa-chevron-down select-caret"></i>
                </div>
            `;
        }
    },

    attachListeners() {
        const overlay = document.getElementById('settings-modal-overlay');
        const closeBtn = document.getElementById('close-settings-modal');
        const saveBtn = document.getElementById('save-settings-btn');

        const toggleModal = (state) => {
            this._modalOpen = state;
            overlay.classList.toggle('open', state);
        };

        closeBtn?.addEventListener('click', () => toggleModal(false));
        saveBtn?.addEventListener('click', () => {
            this.applySettings();
            toggleModal(false);
        });

        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) toggleModal(false);
        });
    },

    applySettings() {
        const inputs = document.querySelectorAll('.setting-input');
        inputs.forEach(input => {
            const id = input.dataset.id;
            const val = input.type === 'checkbox' ? input.checked : input.value;
            window.mapFilters[id] = val;
        });

        // Persist and Update Map (Hooks into flight.js functions)
        if (typeof saveFiltersToLocalStorage === 'function') saveFiltersToLocalStorage();
        if (typeof updateMapFilters === 'function') updateMapFilters();
        
        // Handle Map Style specifically
        if (window.mapFilters.mapStyle && typeof sectorOpsMap !== 'undefined') {
            const styles = {
                dark: 'mapbox://styles/mapbox/dark-v11',
                light: 'mapbox://styles/servernoob/cmg3wq7an002p01s17kbx7lqk',
                satellite: 'mapbox://styles/mapbox/satellite-streets-v12'
            };
            sectorOpsMap.setStyle(styles[window.mapFilters.mapStyle]);
        }
        
        window.showGlobalNotification?.("Settings Applied", "success");
    },

    toggle() {
        const overlay = document.getElementById('settings-modal-overlay');
        if (overlay) {
            const newState = !overlay.classList.contains('open');
            overlay.classList.toggle('open', newState);
            if (newState) {
                // Refresh values from state before showing
                document.getElementById('settings-active-list').innerHTML = this.renderSettingsList();
            }
        }
    },

    injectStyles() {
        // Reuse the CSS classes from LandingUI for consistency
        const css = `
            .settings-modal .filter-selection-pane { width: 35%; }
            .settings-modal .filter-config-pane { width: 65%; }
            .static-item { cursor: default !important; background: transparent !important; border: none !important; }
            .static-item:hover { transform: none !important; }
            .modal-filter-card .toggle-switch { margin-left: auto; scale: 0.8; transform-origin: right; }
        `;
        const style = document.createElement('style');
        style.appendChild(document.createTextNode(css));
        document.head.appendChild(style);
    }
};