/**
 * airportLayout.js
 * Optimized fetching of taxiway lines AND polygons for a detailed ground layout.
 */

export const AirportLayoutManager = {
    activeLayers: new Set(),

    /**
     * Fetches taxiway data (ways and areas) from OSM.
     */
    async plotTaxiways(map, icao, lat, lon) {
        if (!map) return;

        const sourceId = `taxiways-${icao}-source`;
        const lineLayerId = `taxiways-${icao}-line-layer`;
        const fillLayerId = `taxiways-${icao}-fill-layer`;

        this.clearAll(map);

        // Define a small bounding box (~2km) to avoid huge data payloads
        const bbox = `${lat - 0.015},${lon - 0.03},${lat + 0.015},${lon + 0.03}`;
        
        // Fetch both the centerline (ways) and the physical pavement (areas/polygons)
        const query = `
            [out:json][timeout:25];
            (
              way["aeroway"="taxiway"](${bbox});
              relation["aeroway"="taxiway"](${bbox});
            );
            out geom;
        `;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (!data.elements || data.elements.length === 0) return;

            // Process data into two separate feature collections for Lines and Polygons
            const lineFeatures = [];
            const polygonFeatures = [];

            data.elements.forEach(element => {
                if (element.type === 'way' && element.geometry) {
                    const coords = element.geometry.map(p => [p.lon, p.lat]);
                    
                    // Simple heuristic: if it's closed, it's likely a polygon (pavement)
                    const isClosed = coords[0][0] === coords[coords.length-1][0] && 
                                     coords[0][1] === coords[coords.length-1][1];

                    if (isClosed && coords.length > 3) {
                        polygonFeatures.push({
                            type: 'Feature',
                            geometry: { type: 'Polygon', coordinates: [coords] },
                            properties: element.tags
                        });
                    } else {
                        lineFeatures.push({
                            type: 'Feature',
                            geometry: { type: 'LineString', coordinates: coords },
                            properties: element.tags
                        });
                    }
                }
            });

            // Add Sources
            map.addSource(sourceId, {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [...lineFeatures, ...polygonFeatures]
                }
            });

            // 1. Fill Layer (Asphalt Pavement)
            map.addLayer({
                id: fillLayerId,
                type: 'fill',
                source: sourceId,
                filter: ['==', '$type', 'Polygon'],
                paint: {
                    'fill-color': '#27272a', // Zinc-800 Dark Asphalt
                    'fill-opacity': 0.5
                }
            }, 'sector-ops-live-flights-layer');

            // 2. Line Layer (Taxiway Centerlines)
            map.addLayer({
                id: lineLayerId,
                type: 'line',
                source: sourceId,
                filter: ['==', '$type', 'LineString'],
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#fde047', // Yellow Taxiway Markings
                    'line-width': [
                        'interpolate', ['exponential', 1.5], ['zoom'],
                        12, 0.5,
                        15, 2,
                        18, 4
                    ],
                    'line-opacity': 0.8
                }
            }, 'sector-ops-live-flights-layer');

            this.activeLayers.add({ sourceId, layers: [fillLayerId, lineLayerId] });

        } catch (error) {
            console.error(`AirportLayout: Error loading ${icao}:`, error);
        }
    },

    clearAll(map) {
        if (!map) return;
        this.activeLayers.forEach(({ sourceId, layers }) => {
            layers.forEach(layerId => {
                if (map.getLayer(layerId)) map.removeLayer(layerId);
            });
            if (map.getSource(sourceId)) map.removeSource(sourceId);
        });
        this.activeLayers.clear();
    }
};