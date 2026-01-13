/**
 * atcHighlights.js
 * Mapbox GL JS version with Coordinate-to-FIR lookup and Style Persistence
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
 * Initializes or re-initializes the FIR sources and layers.
 * Call this after map.setStyle() inside a 'style.load' event listener.
 */
export function initializeFIRLayers(map, geojsonData) {
    if (!map.getSource('fir-boundaries')) {
        map.addSource('fir-boundaries', {
            type: 'geojson',
            data: geojsonData // URL or GeoJSON object
        });
    }

    if (!map.getLayer('fir-fills')) {
        map.addLayer({
            id: 'fir-fills',
            type: 'fill',
            source: 'fir-boundaries',
            paint: {
                'fill-color': 'rgba(0, 0, 0, 0)',
                'fill-opacity': 0
            }
        });
    }

    if (!map.getLayer('fir-borders')) {
        // Find the first label layer to insert the FIR boundaries beneath them
        const layers = map.getStyle().layers;
        let firstLabelId = layers.find(l => l.type === 'symbol')?.id;

        map.addLayer({
            id: 'fir-borders',
            type: 'line',
            source: 'fir-boundaries',
            paint: {
                'line-color': 'rgba(255, 255, 255, 0.1)',
                'line-width': 0.5,
                'line-opacity': 0.3
            }
        }, firstLabelId); // Insert below labels
    }
}

/**
 * Updates the Mapbox layer style based on active ATC.
 * @param {object} map - Your Mapbox map instance
 * @param {Array} atcData - The array of online Center controllers
 */
export function updateActiveSectors(map, atcData) {
    const layerId = 'fir-fills';
    const borderLayerId = 'fir-borders';

    if (!map || !map.getLayer(layerId) || !map.getLayer(borderLayerId)) return;

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
    
    // Create prefix-matching expression
    const matchExpression = [
        "match",
        ["slice", ["get", "id"], 0, ["index-of", "-", ["concat", ["get", "id"], "-"]]],
        activeIds.length > 0 ? activeIds : ["none"],
        true,
        false
    ];

    // Apply Highlight Styles
    map.setPaintProperty(borderLayerId, 'line-color', [
        "case",
        matchExpression,
        '#ffffff', 
        'rgba(255, 255, 255, 0.1)' 
    ]);

    map.setPaintProperty(borderLayerId, 'line-width', [
        "case",
        matchExpression,
        1.5,
        0.5 
    ]);

    map.setPaintProperty(borderLayerId, 'line-blur', [
        "case",
        matchExpression,
        0.5, 
        0
    ]);
    
    map.setPaintProperty(borderLayerId, 'line-opacity', [
        "case",
        matchExpression,
        1.0,
        0.3
    ]);
}