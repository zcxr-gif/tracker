/**
 * altitudeManager.js
 * Handles 3D vertical displacement of aircraft based on altitude.
 */

export const AltitudeManager = {
    layerId: 'sector-ops-live-flights-layer',

    /**
     * Initializes the 3D altitude effect on the map.
     * @param {mapboxgl.Map} map 
     */
    init(map) {
        if (!map) return;

        // Ensure the layer is ready before applying
        if (map.getLayer(this.layerId)) {
            this.applyAltitudeLogic(map);
        }

        // We re-apply on pitch to ensure the perspective remains correct
        map.on('pitch', () => this.applyAltitudeLogic(map));
    },

    /**
     * Applies the translation logic. 
     * We translate the icon on the Y-axis (upwards) based on altitude.
     */
    applyAltitudeLogic(map) {
        const pitch = map.getPitch();
        
        // If the map is flat, we don't want the icons to "float" north.
        // We scale the effect based on pitch (0 at 0°, full at 60°+).
        const pitchFactor = Math.sin(pitch * Math.PI / 180);

        map.setPaintProperty(this.layerId, 'icon-translate', [
            'interpolate',
            ['linear'],
            ['get', 'altitude'],
            0, ['literal', [0, 0]],
            45000, ['literal', [0, -150 * pitchFactor]] // Translates icon UP by 150px at 45k feet
        ]);

        // This ensures the aircraft label moves with the icon
        if (map.getLayer('sector-ops-live-flights-labels')) {
            map.setPaintProperty('sector-ops-live-flights-labels', 'text-translate', [
                'interpolate',
                ['linear'],
                ['get', 'altitude'],
                0, ['literal', [0, 0]],
                45000, ['literal', [0, -150 * pitchFactor]]
            ]);
            map.setPaintProperty('sector-ops-live-flights-labels', 'text-translate-anchor', 'viewport');
        }

        // 'viewport' keeps the "Up" direction relative to your screen
        map.setPaintProperty(this.layerId, 'icon-translate-anchor', 'viewport');
    }
};