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

    // --- STYLING: RED OUTLINE AND STRIP LABEL ---

    const isLightMode = window.mapFilters?.mapStyle === 'light';
    
    // Set active color to bright red
    const activeBorderColor = '#ff0000';
    const inactiveBorderColor = isLightMode ? 'rgba(15, 23, 42, 0.15)' : 'rgba(255, 255, 255, 0.1)';

    // Set fill to transparent
    map.setPaintProperty(layerId, 'fill-color', 'rgba(0, 0, 0, 0)');
    map.setPaintProperty(layerId, 'fill-opacity', 0);

    if (map.getLayer('fir-borders')) {
        // Move borders below aircraft but above terrain
        if (map.getLayer('sector-ops-live-flights-layer')) {
            map.moveLayer('fir-borders', 'sector-ops-live-flights-layer');
        }

        // Apply dynamic colors to the boundary line
        map.setPaintProperty('fir-borders', 'line-color', [
            "case",
            matchExpression,
            activeBorderColor,   // Red for active
            inactiveBorderColor  // Dimmed color for contrast
        ]);

        map.setPaintProperty('fir-borders', 'line-width', [
            "case",
            matchExpression,
            2.0, // Thicker red line for active
            0.5  // Hairline for inactive
        ]);

        // --- ADD OR UPDATE THE LABEL STRIP LAYER ---
        
        // Dynamically add the text layer if it doesn't exist yet
        if (!map.getLayer('fir-active-labels')) {
            const borderLayer = map.getLayer('fir-borders');
            
            const labelLayer = {
                id: 'fir-active-labels',
                type: 'symbol',
                source: borderLayer.source,
                layout: {
                    'symbol-placement': 'line', // Follows the boundary line
                    'text-field': ['get', 'id'], // Uses the FIR ID for the label
                    'text-size': 14,
                    'text-offset': [0, 1.2], // Pushes the text slightly off the line (inside)
                    'text-anchor': 'top',
                    'text-max-angle': 45
                },
                paint: {
                    'text-color': '#ff0000', // Red text
                    'text-halo-color': 'rgba(255, 255, 255, 0.95)', // White background strip
                    'text-halo-width': 4, // Thickness of the background strip
                    'text-opacity': 0 // Hidden by default
                }
            };
            
            // If the original layer uses vector tiles, carry over the source-layer
            if (borderLayer.sourceLayer) {
                labelLayer['source-layer'] = borderLayer.sourceLayer;
            }

            // Insert labels just above the borders
            map.addLayer(labelLayer, 'sector-ops-live-flights-layer');
        }

        // Show labels only on active boundaries
        map.setPaintProperty('fir-active-labels', 'text-opacity', [
            "case",
            matchExpression,
            1, // Fully visible if active
            0  // Hidden if inactive
        ]);
    }
}