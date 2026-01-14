/**
 * altitudeManager.js
 * Handles 3D vertical displacement of aircraft based on altitude.
 */

applyAltitudeLogic(map) {
    const pitch = map.getPitch();
    
    // Scale the effect based on pitch (0 at 0°, full at 60°+).
    const pitchFactor = Math.sin(pitch * Math.PI / 180);

    // Use icon-offset instead of icon-translate
    // Note: offset units are in 'ems' for text or pixels for icons, 
    // and they are relative to the icon's size/anchor.
    map.setLayoutProperty(this.layerId, 'icon-offset', [
        'interpolate',
        ['linear'],
        ['get', 'altitude'],
        0, ['literal', [0, 0]],
        45000, ['literal', [0, -150 * pitchFactor]]
    ]);

    if (map.getLayer('sector-ops-live-flights-labels')) {
        map.setLayoutProperty('sector-ops-live-flights-labels', 'text-offset', [
            'interpolate',
            ['linear'],
            ['get', 'altitude'],
            0, ['literal', [0, 0]],
            // Text offset is often measured in 'ems', so you may need to 
            // adjust this multiplier (e.g., -5 instead of -150)
            45000, ['literal', [0, -5 * pitchFactor]] 
        ]);
    }
}