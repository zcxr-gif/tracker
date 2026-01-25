/**
 * atcHighlights.js
 * Mapbox GL JS version with Coordinate-to-FIR lookup
 */

/**
 * Standard Point-in-Polygon algorithm to check if a lat/lon is inside a GeoJSON feature.
 */
function isPointInPolygon(point, polygon) {
    const x = point[0], y = point[1];
    let inside = false;
    
    const rings = polygon.type === 'Polygon' ? [polygon.coordinates] : polygon.coordinates;
    
    rings.forEach(ringSet => {
        ringSet.forEach(ring => {
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                const xi = ring[i][0], yi = ring[i][1];
                const xj = ring[j][0], yj = ring[j][1];
                const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
        });
    });
    return inside;
}

/**
 * Helper to determine if the current map style is likely "Light Mode"
 */
function isLightMode(map) {
    const style = map.getStyle();
    if (!style || !style.name) return false;
    const name = style.name.toLowerCase();
    // Common keywords for light maps
    return name.includes('light') || name.includes('street') || name.includes('outdoor');
}

/**
 * Updates the Mapbox layer style based on active ATC.
 * @param {object} map - Your Mapbox map instance
 * @param {string} layerId - The ID of the fill layer (e.g., 'fir-fills')
 * @param {Array} atcData - The array of online Center controllers
 */

export function updateActiveSectors(map, layerId, atcData) {
    if (!map || !map.getLayer(layerId)) return;

    const activeIdsSet = new Set();
    const lookupPoints = [];

    atcData.forEach(controller => {
        if (controller.fir_id) {
            activeIdsSet.add(controller.fir_id);
        } else if (controller.latitude && controller.longitude) {
            lookupPoints.push([controller.longitude, controller.latitude]);
        }
    });

    if (lookupPoints.length > 0) {
        const firFeatures = map.querySourceFeatures('fir-boundaries');
        lookupPoints.forEach(point => {
            const match = firFeatures.find(f => isPointInPolygon(point, f.geometry));
            if (match && match.properties.id) {
                activeIdsSet.add(match.properties.id);
            }
        });
    }

    const activeIds = Array.from(activeIdsSet);
    const isLight = isLightMode(map);

    // Define colors based on theme
    const activeColor = isLight ? '#0055ff' : '#ffffff'; // Vivid Blue for light, White for dark
    const inactiveColor = isLight ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.1)';
    const activeOpacity = 1.0;
    const inactiveOpacity = isLight ? 0.4 : 0.2;

    const matchExpression = [
        "match",
        ["slice", ["get", "id"], 0, ["index-of", "-", ["concat", ["get", "id"], "-"]]],
        activeIds.length > 0 ? activeIds : ["none"],
        true,
        false
    ];

    if (map.getLayer('fir-borders')) {
        // Move borders below aircraft but above terrain
        if (map.getLayer('airplane-layer-id')) {
            map.moveLayer('fir-borders', 'airplane-layer-id');
        }

        // Apply Dynamic Color
        map.setPaintProperty('fir-borders', 'line-color', [
            "case",
            matchExpression,
            activeColor,
            inactiveColor
        ]);

        // Apply Dynamic Width
        map.setPaintProperty('fir-borders', 'line-width', [
            "case",
            matchExpression,
            isLight ? 2.0 : 1.5, // Slightly thicker on light mode for definition
            0.5
        ]);

        // Apply Dynamic Opacity
        map.setPaintProperty('fir-borders', 'line-opacity', [
            "case",
            matchExpression,
            activeOpacity,
            inactiveOpacity
        ]);

        // Remove blur on light mode to keep lines crisp
        map.setPaintProperty('fir-borders', 'line-blur', [
            "case",
            matchExpression,
            isLight ? 0 : 0.5,
            0
        ]);
    }
}