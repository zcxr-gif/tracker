/**
 * MobileSettingsUI.js - Mobile-optimized settings sheet
 * Design-matched to MobileLandingUI (Filters)
 */

export const MobileSettingsUI = {
    _isOpen: false,

    init() {
        this.renderMobileContainer();
        this.attachMobileListeners();
    },

    renderMobileContainer() {
        const existing = document.getElementById('mobile-settings-nexus');
        if (existing) existing.remove();

        const html = `
            <div id="mobile-settings-nexus" class="mobile-only-ui">
                <div id="mobile-settings-overlay" class="mobile-sheet-overlay"></div>

                <div class="mobile-bottom-sheet">
                    <div class="sheet-handle"></div>
                    
                    <div class="mobile-title">
                        <i class="fa-solid fa-gears"></i>
                        <span>Map Settings</span>
                    </div>

                    <div class="sheet-content custom-scroll">
                        <div class="mobile-section-header">Visuals</div>
                        <div class="m-card-input-wrapper">
                            ${this.renderToggle('show3DPath', 'fa-cube', '3D Flight Path')}
                            ${this.renderToggle('showAircraftLabels', 'fa-tag', 'Aircraft Labels')}
                            ${this.renderToggle('useFlatMap', 'fa-map', 'Flat Map Projection')}
                        </div>

                        <div class="mobile-section-header">Navigation Layers</div>
                        <div class="m-card-input-wrapper">
                            ${this.renderToggle('showNatTracks', 'fa-route', 'NAT Tracks')}
                            ${this.renderToggle('showNatLabels', 'fa-font', 'Track Labels')}
                        </div>

                        <div class="mobile-section-header">Aircraft Icons</div>
                        <div class="m-card-input-wrapper">
                            <div class="m-settings-row">
                                <div class="row-label"><i class="fa-solid fa-palette"></i> Icon Theme</div>
                                <select class="m-card-input-select" data-setting="iconColorMode">
                                    <option value="default">Classic White</option>
                                    <option value="blue">Deep Blue</option>
                                    <option value="orange">Safety Orange</option>
                                </select>
                            </div>
                            <div class="m-settings-row">
                                <div class="row-label"><i class="fa-solid fa-maximize"></i> Icon Size</div>
                                <input type="range" class="range-input" data-setting="planeIconSize" min="0.02" max="0.1" step="0.01">
                            </div>
                        </div>
                    </div>

                    <div class="sheet-footer">
                        <button id="mobile-settings-close-btn" class="m-btn m-secondary">Close</button>
                        <button id="mobile-settings-save-btn" class="m-btn m-primary">Save Settings</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('sector-ops-map-fullscreen')?.insertAdjacentHTML('beforeend', html);
    },

    renderToggle(settingKey, icon, label) {
        const isActive = window.mapFilters[settingKey];
        return `
            <div class="m-settings-row" data-setting="${settingKey}">
                <div class="row-label">
                    <i class="fa-solid ${icon}"></i>
                    <span>${label}</span>
                </div>
                <label class="toggle-switch">
                    <input type="checkbox" ${isActive ? 'checked' : ''} data-setting="${settingKey}">
                    <span class="toggle-slider"></span>
                </label>
            </div>
        `;
    },

    attachMobileListeners() {
        const sheet = document.querySelector('#mobile-settings-nexus .mobile-bottom-sheet');
        const overlay = document.getElementById('mobile-settings-overlay');

        // Add inside MobileSettingsUI.attachMobileListeners()
window.addEventListener('openMobileSettings', () => {
    this._isOpen = true;
    const sheet = document.querySelector('#mobile-settings-nexus .mobile-bottom-sheet');
    const overlay = document.getElementById('mobile-settings-overlay');
    
    if (sheet && overlay) {
        sheet.classList.add('open');
        overlay.classList.add('visible');
        this.syncSettingsUI(); // Matches UI to current map state
    }
});

        const closeUI = () => {
            this._isOpen = false;
            sheet.classList.remove('open');
            overlay.classList.remove('visible');
        };

        overlay.addEventListener('click', closeUI);
        document.getElementById('mobile-settings-close-btn').addEventListener('click', closeUI);

        document.getElementById('mobile-settings-save-btn').addEventListener('click', () => {
            this.applySettings();
            closeUI();
            if (typeof window.showGlobalNotification === 'function') {
                window.showGlobalNotification('Settings Applied', 'success');
            }
        });
    },

    syncSettingsUI() {
        // Update all inputs to match current window.mapFilters state
        const inputs = document.querySelectorAll('#mobile-settings-nexus [data-setting]');
        inputs.forEach(input => {
            const key = input.dataset.setting;
            const val = window.mapFilters[key];
            if (input.type === 'checkbox') input.checked = !!val;
            else input.value = val;
        });
    },

    applySettings() {
        const inputs = document.querySelectorAll('#mobile-settings-nexus [data-setting]');
        inputs.forEach(input => {
            const key = input.dataset.setting;
            let val = input.type === 'checkbox' ? input.checked : input.value;
            
            // Numeric conversion for sliders
            if (input.type === 'range') val = parseFloat(val);
            
            window.mapFilters[key] = val;
        });

        // Trigger the global update logic defined in flight.js
        if (typeof window.updateMapFilters === 'function') {
            window.updateMapFilters();
            window.saveFiltersToLocalStorage();
        }
    }
};