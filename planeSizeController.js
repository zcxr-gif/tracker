/**
 * planeSizeController.js
 * Specialized logic for small-scale aircraft icons (5% to 20%).
 */

export function initPlaneSizeSlider(map, filters) {
    // 1. Set the new default to 8% (0.08) if no setting exists
    if (filters.planeIconSize === undefined) {
        filters.planeIconSize = 0.08; 
    }

    // 2. Updated Slider UI (Range: 0.05 to 0.20)
    const sliderHTML = `
        <div class="filter-section-divider">
            <span class="filter-section-title">Visual Scaling</span>
        </div>
        <ul class="filter-toggle-list" style="padding-top: 8px;">
            <li class="filter-toggle-item" style="flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 16px;">
                <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                    <span class="filter-toggle-label"><i class="fa-solid fa-plane-up"></i> Aircraft Scale</span>
                    <span id="plane-size-display" style="font-family: 'JetBrains Mono', monospace; color: var(--color-brand); font-weight: 800; font-size: 0.9rem;">${Math.round(filters.planeIconSize * 100)}%</span>
                </div>
                <input type="range" id="plane-size-slider" min="0.05" max="0.20" step="0.01" value="${filters.planeIconSize}" 
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
                        border: 2px solid #fff;
                    }
                </style>
            </li>
        </ul>
    `;

    const updateSize = (newSize) => {
        const val = parseFloat(newSize);
        const display = document.getElementById('plane-size-display');
        if (display) display.textContent = Math.round(val * 100) + '%';

        filters.planeIconSize = val;
        localStorage.setItem('mapFilters', JSON.stringify(filters));

        // Apply scaling to the Mapbox Aircraft Layer
        if (map && map.getLayer('sector-ops-live-flights-layer')) {
            map.setLayoutProperty('sector-ops-live-flights-layer', 'icon-size', val);
        }
    };

    const injectSlider = () => {
        const settingsContainer = document.getElementById('filter-window-content');
        // Ensure we inject only if the container exists and slider isn't already there
        if (settingsContainer && !document.getElementById('plane-size-slider')) {
            settingsContainer.insertAdjacentHTML('beforeend', sliderHTML);
            
            const slider = document.getElementById('plane-size-slider');
            slider.addEventListener('input', (e) => updateSize(e.target.value));
        }
    };

    const applySize = () => {
        if (map.getLayer('sector-ops-live-flights-layer')) {
            map.setLayoutProperty('sector-ops-live-flights-layer', 'icon-size', filters.planeIconSize);
        }
    };

    if (map) {
        map.on('style.load', applySize);
        if (map.isStyleLoaded()) applySize();
    }

    // Observer to detect when the settings menu is opened
    const observer = new MutationObserver(() => {
        if (document.getElementById('filter-window-content')) {
            injectSlider();
        }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
}