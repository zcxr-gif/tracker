/**
 * atcHighlights.js
 * Mapbox GL JS version - "Pop Out" Border Style
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

export function updateActiveSectors(map, layerId, atcData) {
    // layerId should ideally be your 'line' layer (e.g., 'fir-outlines')
    if (!map || !map.getLayer(layerId)) return;

    const firFeatures = map.querySourceFeatures('fir-boundaries');
    const activeIds = [];

    atcData.forEach(controller => {
        if (controller.latitude && controller.longitude) {
            const controllerPoint = [controller.longitude, controller.latitude];
            const match = firFeatures.find(feature => isPointInPolygon(controllerPoint, feature.geometry));
            if (match && match.properties.id) {
                activeIds.push(match.properties.id);
            }
        }
    });

    const matchExpression = [
        "match",
        ["slice", ["get", "id"], 0, ["index-of", "-", ["concat", ["get", "id"], "-"]]],
        activeIds.length > 0 ? activeIds : ["none"],
        true, 
        false 
    ];

    // --- VISUAL IMPROVEMENTS ---

    // 1. Color: Bright Emerald Green for active, transparent/subtle for inactive
    map.setPaintProperty(layerId, 'line-color', [
        "case",
        matchExpression,
        '#00ff88', // Bright Neon Green
        'rgba(255, 255, 255, 0.1)' // Very faint white for inactive borders
    ]);

    // 2. Thickness: Make active regions much thicker to "Pop"
    map.setPaintProperty(layerId, 'line-width', [
        "case",
        matchExpression,
        4, // Thick active border
        0.5 // Thin inactive border
    ]);

    // 3. Optional: Add a slight blur to active borders to make them "glow"
    map.setPaintProperty(layerId, 'line-blur', [
        "case",
        matchExpression,
        1, // Slight glow
        0  // Sharp line
    ]);

    // 4. Opacity
    map.setPaintProperty(layerId, 'line-opacity', [
        "case",
        matchExpression,
        1,   // Fully visible
        0.2  // Faded
    ]);
}