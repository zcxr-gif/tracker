/**
 * flownPath3D.js
 * Handles the rendering of 3D flight trails based on altitude.
 */

export const FlownPath3D = {
    // Adds or updates the 3D path for a specific flight
    updatePath(map, flightId, trailData, is3DEnabled) {
        const sourceId = `source-3d-path-${flightId}`;
        const layerId = `layer-3d-path-${flightId}`;

        if (!is3DEnabled) {
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            return;
        }

        // Convert trail coordinates to include altitude for 3D rendering
        // Convert trail coordinates to include altitude for 3D rendering
const coordinates = trailData.map(p => [
    p.longitude || p.lon, 
    p.latitude || p.lat, 
    (p.altitude || p.alt || 0) * 0.3048
]);

        const geojson = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: coordinates
            }
        };

        if (!map.getSource(sourceId)) {
            map.addSource(sourceId, { type: 'geojson', data: geojson });
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#38bdf8',
                    'line-width': 3,
                    'line-opacity': 0.8,
                    // Mapbox property to ensure it renders at the correct altitude
                    'line-translate-anchor': 'map'
                }
            });
        } else {
            map.getSource(sourceId).setData(geojson);
        }
    },

    clearPath(map, flightId) {
        const layerId = `layer-3d-path-${flightId}`;
        const sourceId = `source-3d-path-${flightId}`;
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
    }
};