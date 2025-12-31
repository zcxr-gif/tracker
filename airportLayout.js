/**
 * airportLayout.js
 * Optimized fetching of taxiway lines AND polygons with robust error handling.
 */

export const AirportLayoutManager = {
    activeLayers: new Set(),

    /**
     * Fetches taxiway data from OSM with retry logic and error handling.
     */
    async plotTaxiways(map, icao, lat, lon) {
        if (!map) return;

        const sourceId = `taxiways-${icao}-source`;
        const lineLayerId = `taxiways-${icao}-line-layer`;
        const fillLayerId = `taxiways-${icao}-fill-layer`;

        this.clearAll(map);

        // Define bounding box (~2km radius)
        const bbox = `${lat - 0.015},${lon - 0.03},${lat + 0.015},${lon + 0.03}`;
        
        // Cleaned query: minimized whitespace to reduce URL length issues
        const query = `[out:json][timeout:30];(way["aeroway"="taxiway"](${bbox});relation["aeroway"="taxiway"](${bbox}););out geom;`;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(url);

            // Check if the response is actually OK (status 200)
            if (!response.ok) {
                if (response.status === 504 || response.status === 429) {
                    console.warn(`AirportLayout: Overpass API is busy (Status ${response.status}). Try again in a moment.`);
                }
                return;
            }

            // Verify content type to avoid "Unexpected token <" errors
            const contentType = response.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                const text = await response.text();
                console.error(`AirportLayout: Expected JSON but received: ${text.substring(0, 100)}...`);
                return;
            }

            const data = await response.json();

            if (!data.elements || data.elements.length === 0) {
                console.log(`AirportLayout: No layout data found for ${icao}`);
                return;
            }

            const lineFeatures = [];
            const polygonFeatures = [];

            data.elements.forEach(element => {
                if (element.geometry) {
                    const coords = element.geometry.map(p => [p.lon, p.lat]);
                    
                    // Logic to separate physical pavement (polygons) from markings (lines)
                    const isClosed = coords.length > 3 && 
                                     coords[0][0] === coords[coords.length-1][0] && 
                                     coords[0][1] === coords[coords.length-1][1];

                    if (isClosed || element.type === 'relation') {
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

            map.addSource(sourceId, {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: [...lineFeatures, ...polygonFeatures]
                }
            });

            // 1. Fill Layer (Pavement/Asphalt)
            map.addLayer({
                id: fillLayerId,
                type: 'fill',
                source: sourceId,
                filter: ['==', '$type', 'Polygon'],
                paint: {
                    'fill-color': '#3f3f46', // Zinc-700
                    'fill-opacity': 0.4
                }
            }, 'sector-ops-live-flights-layer');

            // 2. Line Layer (Yellow Centerlines)
            map.addLayer({
                id: lineLayerId,
                type: 'line',
                source: sourceId,
                filter: ['==', '$type', 'LineString'],
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#eab308', // Amber-500 yellow
                    'line-width': [
                        'interpolate', ['exponential', 1.5], ['zoom'],
                        12, 0.5,
                        16, 2,
                        18, 5
                    ],
                    'line-opacity': 0.8
                }
            }, 'sector-ops-live-flights-layer');

            this.activeLayers.add({ sourceId, layers: [fillLayerId, lineLayerId] });

        } catch (error) {
            console.error(`AirportLayout: Network or Parsing Error for ${icao}:`, error);
        }
    },

    /**
     * Removes all plotted taxiway layers from the map.
     */
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