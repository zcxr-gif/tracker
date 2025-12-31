/**
 * airportLayout.js
 * Optimized fetching of taxiway lines AND polygons with local session caching.
 */

export const AirportLayoutManager = {
    activeLayers: new Set(),
    // Cache to store GeoJSON data by ICAO code to prevent redundant API calls
    layoutCache: new Map(),

    /**
     * Fetches taxiway data from OSM with caching and error handling.
     */
    async plotTaxiways(map, icao, lat, lon) {
        if (!map) return;

        const sourceId = `taxiways-${icao}-source`;
        const lineLayerId = `taxiways-${icao}-line-layer`;
        const fillLayerId = `taxiways-${icao}-fill-layer`;

        // 1. Cleanup current view
        this.clearAll(map);

        let geojsonData;

        // 2. Check if we already have this airport's data in the cache
        if (this.layoutCache.has(icao)) {
            console.log(`AirportLayout: Loading ${icao} from cache.`);
            geojsonData = this.layoutCache.get(icao);
        } else {
            // 3. Fetch from Overpass API if not cached
            const bbox = `${lat - 0.015},${lon - 0.03},${lat + 0.015},${lon + 0.03}`;
            const query = `[out:json][timeout:30];(way["aeroway"="taxiway"](${bbox});relation["aeroway"="taxiway"](${bbox}););out geom;`;
            const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

            try {
                const response = await fetch(url);

                if (!response.ok) {
                    console.warn(`AirportLayout: API busy or error (Status ${response.status})`);
                    return;
                }

                const contentType = response.headers.get("content-type");
                if (!contentType || !contentType.includes("application/json")) {
                    return;
                }

                const data = await response.json();
                if (!data.elements || data.elements.length === 0) return;

                // Process OSM data into GeoJSON
                geojsonData = this.processOsmData(data.elements);
                
                // Store in cache for future use
                this.layoutCache.set(icao, geojsonData);

            } catch (error) {
                console.error(`AirportLayout: Network error for ${icao}:`, error);
                return;
            }
        }

        // 4. Add the data to the map
        map.addSource(sourceId, {
            type: 'geojson',
            data: geojsonData
        });

        // Fill Layer (Asphalt)
        map.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            filter: ['==', '$type', 'Polygon'],
            paint: {
                'fill-color': '#27272a',
                'fill-opacity': 0.5
            }
        }, 'sector-ops-live-flights-layer');

        // Line Layer (Markings)
        map.addLayer({
            id: lineLayerId,
            type: 'line',
            source: sourceId,
            filter: ['==', '$type', 'LineString'],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': '#fde047',
                'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.5, 16, 2, 18, 5],
                'line-opacity': 0.8
            }
        }, 'sector-ops-live-flights-layer');

        this.activeLayers.add({ sourceId, layers: [fillLayerId, lineLayerId] });
    },

    /**
     * Internal helper to convert OSM elements to GeoJSON
     */
    processOsmData(elements) {
        const lineFeatures = [];
        const polygonFeatures = [];

        elements.forEach(element => {
            if (element.geometry) {
                const coords = element.geometry.map(p => [p.lon, p.lat]);
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

        return {
            type: 'FeatureCollection',
            features: [...lineFeatures, ...polygonFeatures]
        };
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