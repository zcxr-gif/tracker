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
 * Updates the Mapbox layer style based on active ATC.
 * @param {object} map - Your Mapbox map instance
 * @param {string} layerId - The ID of the fill layer (e.g., 'fir-fills')
 * @param {Array} atcData - The array of online Center controllers
 */
export function updateActiveSectors(map, layerId, atcData) {
    if (!map || !map.getLayer(layerId)) return;

    // 1. Build the list of active IDs from data first to prevent flickering.
    // By using atcData as the source of truth, the highlight stays even if 
    // the region is currently off-screen.
    const activeIdsSet = new Set();
    const lookupPoints = [];

    atcData.forEach(controller => {
        if (controller.fir_id) {
            // Priority 1: Use the explicit ID from the API
            activeIdsSet.add(controller.fir_id);
        } else if (controller.latitude && controller.longitude) {
            // Priority 2: Queue for spatial lookup if ID is missing
            lookupPoints.push([controller.longitude, controller.latitude]);
        }
    });

    // 2. Supplemental lookup for coordinates if needed.
    // Note: querySourceFeatures only sees tiles currently in view.
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
    
    // 3. Create a prefix-matching expression (e.g., 'KZLA' matches 'KZLA-CTR')
    const matchExpression = [
        "match",
        ["slice", ["get", "id"], 0, ["index-of", "-", ["concat", ["get", "id"], "-"]]],
        activeIds.length > 0 ? activeIds : ["none"],
        true,
        false
    ];

    // --- STYLING: BRIGHT WHITE OUTLINE ---

    // Set fill to transparent (as we only want the outline highlighted)
    map.setPaintProperty(layerId, 'fill-color', 'rgba(0, 0, 0, 0)');
    map.setPaintProperty(layerId, 'fill-opacity', 0);

    if (map.getLayer('fir-borders')) {
        // Bright White for active, faint for inactive
        map.setPaintProperty('fir-borders', 'line-color', [
            "case",
            matchExpression,
            '#ffffff', 
            'rgba(255, 255, 255, 0.15)'
        ]);

        // Thicker border for the active center
        map.setPaintProperty('fir-borders', 'line-width', [
            "case",
            matchExpression,
            3.0, 
            0.5 
        ]);

        // Adds a subtle "bloom" effect to the white outline
        map.setPaintProperty('fir-borders', 'line-blur', [
            "case",
            matchExpression,
            1.0, 
            0
        ]);
        
        // Ensure active borders are drawn on top of others
        map.setPaintProperty('fir-borders', 'line-sort-key', [
            "case",
            matchExpression,
            2, 
            1
        ]);
    }
}