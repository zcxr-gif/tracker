/**
 * flownPath3D.js
 * Handles the rendering of 3D flight trails based on altitude.
 */

export const FlownPath3D = {
    /**
     * Adds or updates the 3D path for a specific flight.
     * @param {Object} map - The Mapbox map instance.
     * @param {string} flightId - Unique ID of the flight.
     * @param {Array} trailData - Array of points [{lat, lon, alt}, ...].
     * @param {boolean} is3DEnabled - Whether the 3D filter is active.
     */
    updatePath(map, flightId, trailData, is3DEnabled) {
        if (!map || !flightId) return;

        const sourceId = `source-3d-path-${flightId}`;
        const layerId = `layer-3d-path-${flightId}`;

        // If 3D is disabled or trail data is empty, cleanup and exit
        if (!is3DEnabled || !trailData || trailData.length < 2) {
            this.clearPath(map, flightId);
            return;
        }

        // Mapbox uses METERS for altitude. Convert feet to meters.
        // Format: [longitude, latitude, altitude_in_meters]
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
            map.addSource(sourceId, { 
                type: 'geojson', 
                data: geojson,
                lineMetrics: true // Required for gradients if used later
            });

            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                layout: { 
                    'line-join': 'round', 
                    'line-cap': 'round' 
                },
                paint: {
                    'line-color': '#38bdf8',
                    'line-width': 3,
                    'line-opacity': 0.9,
                    // CRITICAL: This allows the line to use the Z coordinate (altitude) 
                    // from the GeoJSON instead of clamping it to the ground.
                    'line-z-offset': 0 
                }
            });
        } else {
            const source = map.getSource(sourceId);
            if (source) source.setData(geojson);
        }
    },

    /**
     * Completely removes the 3D path layers and sources for a specific flight.
     */
    clearPath(map, flightId) {
        if (!map || !flightId) return;
        
        const layerId = `layer-3d-path-${flightId}`;
        const sourceId = `source-3d-path-${flightId}`;

        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
        if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
        }
    },

    /**
     * Utility to clear all 3D paths if multiple are present
     */
    clearAllPaths(map) {
        if (!map) return;
        const layers = map.getStyle().layers;
        if (!layers) return;

        layers.forEach(layer => {
            if (layer.id.startsWith('layer-3d-path-')) {
                const flightId = layer.id.replace('layer-3d-path-', '');
                this.clearPath(map, flightId);
            }
        });
    }
};