/**
 * atcHighlights.js
 * Mapbox GL JS version with Coordinate-to-FIR lookup
 */

/**
 * Standard Point-in-Polygon algorithm to check if a lat/lon is inside a GeoJSON feature.
 * This allows us to find the FIR region even if we only have coordinates.
 */
function isPointInPolygon(point, polygon) {
    const x = point[0], y = point[1];
    let inside = false;
    
    // Handle both Polygon and MultiPolygon geometries
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
 * Updates the Mapbox layer style based on active ATC.
 * @param {object} map - Your Mapbox map instance
 * @param {string} layerId - The ID of the fill layer (e.g., 'fir-fills')
 * @param {Array} atcData - The array of online Center controllers
 */
export function updateActiveSectors(map, layerId, atcData) {
    if (!map || !map.getLayer(layerId)) return;

    const firFeatures = map.querySourceFeatures('fir-boundaries');
    
    // CHANGE: Use a Set instead of an Array to ensure all IDs are unique
    const activeIdsSet = new Set();

    atcData.forEach(controller => {
        if (controller.latitude && controller.longitude) {
            const controllerPoint = [controller.longitude, controller.latitude];
            
            const match = firFeatures.find(feature => 
                isPointInPolygon(controllerPoint, feature.geometry)
            );

            if (match && match.properties.id) {
                activeIdsSet.add(match.properties.id); // Sets ignore duplicate entries
            }
        } else if (controller.fir_id) {
            activeIdsSet.add(controller.fir_id);
        }
    });
    
    // Convert the Set back to an Array for Mapbox
    const activeIds = Array.from(activeIdsSet);

    const matchExpression = [
        "match",
        ["slice", ["get", "id"], 0, ["index-of", "-", ["concat", ["get", "id"], "-"]]],
        activeIds.length > 0 ? activeIds : ["none"],
        true, 
        false 
    ];

    // 1. Subtle Fill (Instead of heavy shading)
    map.setPaintProperty(layerId, 'fill-color', [
        "case",
        matchExpression,
        '#22c55e', // Emerald-500
        'transparent'
    ]);
    map.setPaintProperty(layerId, 'fill-opacity', [
        "case",
        matchExpression,
        0.08, // Very light tint (8%)
        0
    ]);

    // 2. Thick, Glowing Border (The "Pop Out" effect)
    if (map.getLayer('fir-borders')) {
        map.setPaintProperty('fir-borders', 'line-color', [
            "case",
            matchExpression,
            '#4ade80', // Brighter green for active
            'rgba(255, 255, 255, 0.15)' // Faint white for inactive
        ]);

        map.setPaintProperty('fir-borders', 'line-width', [
            "case",
            matchExpression,
            3.5, // Thicker border for active region
            0.5  // Thin border for others
        ]);

        // Add a "blur" for a neon glow effect
        map.setPaintProperty('fir-borders', 'line-blur', [
            "case",
            matchExpression,
            1.5, // Soft glow for active
            0
        ]);
    }
}