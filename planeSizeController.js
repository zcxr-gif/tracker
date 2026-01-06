/**
 * planeSizeController.js
 * Logic for the Aircraft Icon Size slider in the Settings menu.
 */

export function initPlaneSizeSlider(map, filters) {
    // 1. Ensure a default value exists in the filter state
    if (filters.planeIconSize === undefined) {
        filters.planeIconSize = 1.0; // Default scale (1:1)
    }

    // 2. The Slider HTML Template (Matching your existing UI style)
    const sliderHTML = `
        <div class="filter-section-divider">
            <span class="filter-section-title">Visuals</span>
        </div>
        <ul class="filter-toggle-list" style="padding-top: 8px;">
            <li class="filter-toggle-item" style="flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 16px;">
                <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                    <span class="filter-toggle-label"><i class="fa-solid fa-maximize"></i> Plane Icon Size</span>
                    <span id="plane-size-display" style="font-family: 'JetBrains Mono', monospace; color: var(--color-brand); font-weight: 800; font-size: 0.9rem;">${filters.planeIconSize}x</span>
                </div>
                <input type="range" id="plane-size-slider" min="0.5" max="3.0" step="0.1" value="${filters.planeIconSize}" 
                       style="width: 100%; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.1); outline: none; -webkit-appearance: none; cursor: pointer;">
                <style>
                    #plane-size-slider::-webkit-slider-thumb {
                        -webkit-appearance: none;
                        width: 16px;
                        height: 16px;
                        border-radius: 50%;
                        background: var(--color-brand);
                        cursor: pointer;
                        box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
                    }
                </style>
            </li>
        </ul>
    `;

    // 3. Logic to update the map and save settings
    const updateSize = (newSize) => {
        // Update the visual display number
        const display = document.getElementById('plane-size-display');
        if (display) display.textContent = newSize + 'x';

        // Update the state object
        filters.planeIconSize = newSize;

        // Persist to local storage (matches your existing storage key)
        localStorage.setItem('mapFilters', JSON.stringify(filters));

        // Apply directly to the Mapbox Aircraft Layer
        if (map && map.getLayer('sector-ops-live-flights-layer')) {
            map.setLayoutProperty('sector-ops-live-flights-layer', 'icon-size', newSize);
        }
        
        // Optional: Also scale the aircraft labels if you want them to match
        if (map && map.getLayer('sector-ops-live-flights-labels')) {
            map.setLayoutProperty('sector-ops-live-flights-labels', 'text-size', 11 * newSize);
        }
    };

    // 4. Injector: Adds the slider to the DOM if it's not already there
    const injectSlider = () => {
        const settingsContainer = document.getElementById('filter-window-content');
        if (settingsContainer && !document.getElementById('plane-size-slider')) {
            settingsContainer.insertAdjacentHTML('beforeend', sliderHTML);
            
            const slider = document.getElementById('plane-size-slider');
            slider.addEventListener('input', (e) => updateSize(parseFloat(e.target.value)));
        }
    };

    // 5. Initial Application (On map load or style change)
    const applyInitialSize = () => {
        if (map.getLayer('sector-ops-live-flights-layer')) {
            map.setLayoutProperty('sector-ops-live-flights-layer', 'icon-size', filters.planeIconSize);
        }
    };

    if (map) {
        if (map.isStyleLoaded()) applyInitialSize();
        map.on('style.load', applyInitialSize);
    }

    // 6. Watch for when the settings window content is injected
    const observer = new MutationObserver(() => {
        if (document.getElementById('filter-window-content')) {
            injectSlider();
        }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
}