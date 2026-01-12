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

    // 1. Get all FIR features currently loaded in the GeoJSON source
    // Ensure the source name 'fir-boundaries' matches the one in flight.js
    const firFeatures = map.querySourceFeatures('fir-boundaries');
    const activeIds = [];

    // 2. Map coordinates to FIR IDs
    atcData.forEach(controller => {
        // Use coordinates to perform Point-in-Polygon lookup
        if (controller.latitude && controller.longitude) {
            const controllerPoint = [controller.longitude, controller.latitude];
            
            // Find which FIR boundary contains this point
            const match = firFeatures.find(feature => 
                isPointInPolygon(controllerPoint, feature.geometry)
            );

            if (match && match.properties.id) {
                activeIds.push(match.properties.id);
            }
        } else if (controller.fir_id) {
            // Fallback if an ID is already provided
            activeIds.push(controller.fir_id);
        }
    });

    /**
     * Mapbox Expression Logic:
     * We match the base ID (e.g., 'KZLA') even if the GeoJSON feature ID is 'KZLA-E'
     */
    const matchExpression = [
        "match",
        ["slice", ["get", "id"], 0, ["index-of", "-", ["concat", ["get", "id"], "-"]]],
        activeIds.length > 0 ? activeIds : ["none"],
        true, 
        false 
    ];

    // Apply Highlight Green if matched, otherwise keep it transparent
    map.setPaintProperty(layerId, 'fill-color', [
        "case",
        matchExpression,
        '#22c55e', // Emerald-500
        'transparent'
    ]);

    // Set the opacity for the active region
    map.setPaintProperty(layerId, 'fill-opacity', [
        "case",
        matchExpression,
        0.3, // Highlighted opacity
        0    // Hidden
    ]);
}