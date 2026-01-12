/**
 * atcHighlights.js
 * Optimized for VATSpy.json data structure
 */

/**
 * Standard Point-in-Polygon algorithm.
 * Necessary because Center (CTR) controllers often only provide coordinates, 
 * not the specific FIR boundary ID.
 */
function isPointInPolygon(point, polygon) {
    const x = point[0], y = point[1];
    let inside = false;
    
    // Support both Polygon and MultiPolygon geometries from VATSpy.json
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
 * Updates the Mapbox layer style based on active ATC controllers.
 * @param {object} map - Mapbox GL JS instance
 * @param {string} layerId - The ID of the fill layer (e.g., 'fir-fills')
 * @param {Array} atcData - Array of online Center controllers
 */
export function updateActiveSectors(map, layerId, atcData) {
    if (!map || !map.getLayer(layerId)) return;

    // 1. Get all FIR features currently loaded in the 'fir-boundaries' source
    const firFeatures = map.querySourceFeatures('fir-boundaries');
    const activeIds = [];

    // 2. Map coordinates to FIR IDs (ICAOs)
    atcData.forEach(controller => {
        if (controller.latitude && controller.longitude) {
            const controllerPoint = [controller.longitude, controller.latitude];
            
            // Find which FIR boundary contains this controller
            const match = firFeatures.find(feature => 
                isPointInPolygon(controllerPoint, feature.geometry)
            );

            if (match && match.properties.id) {
                activeIds.push(match.properties.id);
            }
        }
    });

    /**
     * 3. Match Logic:
     * Strips suffixes (e.g., 'KZLA-E' -> 'KZLA') to ensure sub-sectors 
     * light up when the parent FIR is active.
     */
    const matchExpression = [
        "match",
        ["slice", ["get", "id"], 0, ["index-of", "-", ["concat", ["get", "id"], "-"]]],
        activeIds.length > 0 ? activeIds : ["none"],
        true, 
        false 
    ];

    // 4. Apply Subtle Fill (Emerald-500)
    map.setPaintProperty(layerId, 'fill-color', [
        "case",
        matchExpression,
        '#22c55e', 
        'transparent'
    ]);
    
    map.setPaintProperty(layerId, 'fill-opacity', [
        "case",
        matchExpression,
        0.08, // Very light 8% tint
        0
    ]);

    // 5. Apply Thick, Glowing Border
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
            2.5, // Thicker for active
            0.5  // Hairline for inactive
        ]);
    }
}