/**
 * MobileSettingsUI.js - Mobile-optimized Bottom Sheet for Map & Display Settings
 */

export const MobileSettingsUI = {
    _isOpen: false,

    init() {
        this.injectMobileStyles();
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
                        <span>Map & Display Settings</span>
                    </div>

                    <div class="sheet-content custom-scroll">
                        <div class="mobile-section-header">Map Style</div>
                        <div class="settings-mobile-grid">
                            <button class="m-setting-pill" data-setting="mapStyle" data-value="dark">Dark</button>
                            <button class="m-setting-pill" data-setting="mapStyle" data-value="light">Light</button>
                            <button class="m-setting-pill" data-setting="mapStyle" data-value="satellite">Satellite</button>
                        </div>

                        <div class="mobile-section-header">Visibility</div>
                        <div class="m-settings-list">
                            ${this.renderToggle('showAircraftLabels', 'Aircraft Labels', 'fa-tag')}
                            ${this.renderToggle('show3DPath', '3D Flown Path', 'fa-cube')}
                            ${this.renderToggle('showNatTracks', 'NAT Tracks', 'fa-route')}
                            ${this.renderToggle('showNatLabels', 'NAT Labels', 'fa-font')}
                            ${this.renderToggle('useFlatMap', 'Flat Map Projection', 'fa-map')}
                            ${this.renderToggle('useSimpleFlightWindow', 'Simple Flight Info', 'fa-window-maximize')}
                        </div>

                        <div class="mobile-section-header">Aircraft Filters</div>
                        <div class="m-settings-list">
                            ${this.renderToggle('showStaffOnly', 'Staff Pilots Only', 'fa-shield-check')}
                            ${this.renderToggle('showVaOnly', 'VA Members Only', 'fa-star')}
                            ${this.renderToggle('showGroupFlights', 'Show Group Flights', 'fa-users')}
                            ${this.renderToggle('hideAllAircraft', 'Hide All Aircraft', 'fa-eye-slash')}
                        </div>

                        <div class="mobile-section-header">ATC & Airport Filters</div>
                        <div class="m-settings-list">
                            ${this.renderToggle('showUnstaffedAirports', 'Show Unstaffed', 'fa-circle-dot')}
                            ${this.renderToggle('hideNoAtcMarkers', 'Hide No-ATC Dots', 'fa-location-dot')}
                            ${this.renderToggle('hideAtcMarkers', 'Hide ATC Markers', 'fa-headset')}
                        </div>

                        <div class="mobile-section-header">Flight Plan Display</div>
                        <div class="settings-mobile-grid">
                            <button class="m-setting-pill" data-setting="planDisplayMode" data-value="none">None</button>
                            <button class="m-setting-pill" data-setting="planDisplayMode" data-value="direct">Direct</button>
                            <button class="m-setting-pill" data-setting="planDisplayMode" data-value="full">Full Plan</button>
                        </div>

                        <div class="mobile-section-header">Icon Configuration</div>
                        <div class="m-setting-range-card">
                            <div class="range-header">
                                <span>Plane Icon Size</span>
                                <span id="m-val-planeIconSize">0.05</span>
                            </div>
                            <input type="range" class="m-range-input" data-setting="planeIconSize" min="0.01" max="0.15" step="0.01">
                        </div>

                        <div class="mobile-section-header">Icon Color Mode</div>
                        <div class="settings-mobile-grid">
                            <button class="m-setting-pill" data-setting="iconColorMode" data-value="default">White</button>
                            <button class="m-setting-pill" data-setting="iconColorMode" data-value="blue">Blue</button>
                            <button class="m-setting-pill" data-setting="iconColorMode" data-value="orange">Orange</button>
                        </div>
                    </div>

                    <div class="sheet-footer">
                        <button id="mobile-settings-close" class="m-btn m-primary">Done</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
    },

    renderToggle(id, label, icon) {
        return `
            <div class="m-setting-row">
                <div class="m-row-left">
                    <i class="fa-solid ${icon}"></i>
                    <span>${label}</span>
                </div>
                <label class="m-switch">
                    <input type="checkbox" data-setting="${id}">
                    <span class="m-slider"></span>
                </label>
            </div>
        `;
    },

    attachMobileListeners() {
        const sheet = document.querySelector('#mobile-settings-nexus .mobile-bottom-sheet');
        const overlay = document.getElementById('mobile-settings-overlay');

        window.addEventListener('openMobileSettings', () => {
            this._isOpen = true;
            this.syncUIWithState();
            sheet.classList.add('open');
            overlay.classList.add('visible');
        });

        const closeUI = () => {
            this._isOpen = false;
            sheet.classList.remove('open');
            overlay.classList.remove('visible');
            if (window.saveFiltersToLocalStorage) window.saveFiltersToLocalStorage();
        };

        overlay.addEventListener('click', closeUI);
        document.getElementById('mobile-settings-close').addEventListener('click', closeUI);

        sheet.querySelectorAll('input[type="checkbox"]').forEach(input => {
            input.addEventListener('change', (e) => {
                const setting = e.target.dataset.setting;
                window.mapFilters[setting] = e.target.checked;
                window.updateMapFilters();
            });
        });

        sheet.querySelectorAll('.m-range-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const setting = e.target.dataset.setting;
                const val = e.target.value;
                window.mapFilters[setting] = parseFloat(val);
                document.getElementById(`m-val-${setting}`).textContent = val;
                window.updateMapFilters();
            });
        });

        sheet.querySelectorAll('.m-setting-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                const setting = btn.dataset.setting;
                const value = btn.dataset.value;
                window.mapFilters[setting] = value;
                btn.parentElement.querySelectorAll('.m-setting-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                window.updateMapFilters();
            });
        });
    },

    syncUIWithState() {
        const filters = window.mapFilters;
        if (!filters) return;
        const container = document.getElementById('mobile-settings-nexus');

        container.querySelectorAll('input[type="checkbox"]').forEach(input => {
            input.checked = !!filters[input.dataset.setting];
        });

        container.querySelectorAll('.m-range-input').forEach(input => {
            const val = filters[input.dataset.setting];
            input.value = val;
            const label = document.getElementById(`m-val-${input.dataset.setting}`);
            if (label) label.textContent = val;
        });

        container.querySelectorAll('.m-setting-pill').forEach(btn => {
            const setting = btn.dataset.setting;
            const value = btn.dataset.value;
            if (filters[setting] === value) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    },

    injectMobileStyles() {
        if (document.getElementById('mobile-settings-styles')) return;
        const css = `
            @media (max-width: 768px) {
                #mobile-settings-nexus .mobile-sheet-overlay {
                    position: fixed; inset: 0; background: rgba(0,0,0,0.7); 
                    backdrop-filter: blur(4px); opacity: 0; visibility: hidden; transition: 0.3s; z-index: 6000;
                }
                #mobile-settings-nexus .mobile-sheet-overlay.visible { opacity: 1; visibility: visible; }
                
                #mobile-settings-nexus .mobile-bottom-sheet {
                    position: fixed; bottom: -100%; left: 0; width: 100%; height: 75vh;
                    background: #0a0a0b; border-top: 1px solid rgba(255,255,255,0.1);
                    border-radius: 24px 24px 0 0; z-index: 6001; transition: 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                    display: flex; flex-direction: column; color: white; padding-bottom: env(safe-area-inset-bottom);
                }
                #mobile-settings-nexus .mobile-bottom-sheet.open { bottom: 0; }
                
                .sheet-handle { width: 40px; height: 5px; background: rgba(255,255,255,0.2); border-radius: 10px; margin: 12px auto; }
                .mobile-title { padding: 0 20px 15px; font-size: 1.2rem; font-weight: 800; display: flex; align-items: center; gap: 12px; }
                .mobile-section-header { padding: 15px 20px 8px; font-size: 0.7rem; font-weight: 900; color: #71717a; text-transform: uppercase; letter-spacing: 1px; }
                
                .settings-mobile-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 0 20px; }
                .m-setting-pill { 
                    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); 
                    color: #a1a1aa; padding: 10px; border-radius: 12px; font-weight: 600; font-size: 0.8rem;
                }
                .m-setting-pill.active { background: #38bdf8; color: black; border-color: #38bdf8; }
                
                .m-settings-list { padding: 0 20px; display: flex; flex-direction: column; gap: 8px; }
                .m-setting-row { 
                    display: flex; justify-content: space-between; align-items: center; 
                    background: rgba(255,255,255,0.03); padding: 14px; border-radius: 14px;
                }
                .m-row-left { display: flex; align-items: center; gap: 12px; font-size: 0.9rem; }
                .m-row-left i { color: #38bdf8; width: 16px; text-align: center; }

                .m-switch { position: relative; display: inline-block; width: 46px; height: 24px; }
                .m-switch input { opacity: 0; width: 0; height: 0; }
                .m-slider { position: absolute; cursor: pointer; inset: 0; background-color: #27272a; transition: .4s; border-radius: 34px; }
                .m-slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
                input:checked + .m-slider { background-color: #38bdf8; }
                input:checked + .m-slider:before { transform: translateX(22px); }

                .m-setting-range-card { margin: 0 20px; background: rgba(255,255,255,0.03); padding: 16px; border-radius: 14px; }
                .range-header { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 12px; }
                .m-range-input { width: 100%; accent-color: #38bdf8; }
                
                .sheet-footer { padding: 20px; border-top: 1px solid rgba(255,255,255,0.05); }
                .m-btn { width: 100%; padding: 16px; border-radius: 14px; font-weight: 700; border: none; font-size: 1rem; }
                .m-primary { background: #38bdf8; color: #000; }
                
                .custom-scroll { overflow-y: auto; flex: 1; }
            }
        `;
        const style = document.createElement('style');
        style.id = 'mobile-settings-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};