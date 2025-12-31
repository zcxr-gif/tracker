/**
 * airportLayout.js
 * Optimized fetching of taxiway lines, polygons, and GATES/PARKING with local session caching.
 */

export const AirportLayoutManager = {
    activeLayers: new Set(),
    // Cache to store GeoJSON data by ICAO code to prevent redundant API calls
    layoutCache: new Map(),

    /**
     * Fetches taxiway and gate data from OSM with caching and error handling.
     */
    async plotTaxiways(map, icao, lat, lon) {
        if (!map) return;

        const sourceId = `taxiways-${icao}-source`;
        const lineLayerId = `taxiways-${icao}-line-layer`;
        const fillLayerId = `taxiways-${icao}-fill-layer`;
        const labelLayerId = `taxiways-${icao}-label-layer`;
        const gateLayerId = `taxiways-${icao}-gate-layer`;

        // 1. Cleanup current view
        this.clearAll(map);

        let geojsonData;

        // 2. Check if we already have this airport's data in the cache
        if (this.layoutCache.has(icao)) {
            geojsonData = this.layoutCache.get(icao);
        } else {
            // 3. Fetch from Overpass API
            // Expanded bbox slightly to ensure we catch all terminal gates
            const bbox = `${lat - 0.02},${lon - 0.04},${lat + 0.02},${lon + 0.04}`;
            
            // Query for taxiways, gates, and parking positions
            const query = `[out:json][timeout:30];(way["aeroway"~"taxiway|parking_position"](${bbox});relation["aeroway"~"taxiway|parking_position"](${bbox});node["aeroway"~"gate|parking_position"](${bbox}););out geom;`;
            const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

            try {
                const response = await fetch(url);
                if (!response.ok) return;

                const data = await response.json();
                if (!data.elements || data.elements.length === 0) return;

                // Process OSM data into GeoJSON
                geojsonData = this.processOsmData(data.elements);
                this.layoutCache.set(icao, geojsonData);

            } catch (error) {
                console.error(`AirportLayout error for ${icao}:`, error);
                return;
            }
        }

        // 4. Add the data to the map
        map.addSource(sourceId, {
            type: 'geojson',
            data: geojsonData
        });

        // Fill Layer (Asphalt/Aprons)
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

        // Line Layer (Taxiway Markings)
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

        // NEW: Gate/Parking Marker Layer
        // This adds a small circle at the gate location
        map.addLayer({
            id: gateLayerId,
            type: 'circle',
            source: sourceId,
            filter: ['all', 
                ['==', '$type', 'Point'], 
                ['match', ['get', 'aeroway'], ['gate', 'parking_position'], true, false]
            ],
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2, 17, 6],
                'circle-color': '#fde047',
                'circle-stroke-width': 1,
                'circle-stroke-color': '#000'
            }
        });

        // NEW: Labels (Names for Taxiways AND Gates)
        map.addLayer({
            id: labelLayerId,
            type: 'symbol',
            source: sourceId,
            filter: ['has', 'ref'],
            layout: {
                'text-field': ['get', 'ref'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 16, 12],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-allow-overlap': false,
                'text-padding': 10
            },
            paint: {
                'text-color': '#fde047',
                'text-halo-color': '#000',
                'text-halo-width': 1.5
            }
        });

        this.activeLayers.add({ sourceId, layers: [fillLayerId, lineLayerId, labelLayerId, gateLayerId] });
    },

    /**
     * Internal helper to convert OSM elements to GeoJSON.
     * Updated to handle Nodes (Gates/Stands).
     */
    processOsmData(elements) {
        const features = [];

        elements.forEach(element => {
            let geometry = null;
            let type = "Feature";

            if (element.type === 'node') {
                geometry = { type: 'Point', coordinates: [element.lon, element.lat] };
            } else if (element.geometry) {
                const coords = element.geometry.map(p => [p.lon, p.lat]);
                const isClosed = coords.length > 3 && 
                                 coords[0][0] === coords[coords.length-1][0] && 
                                 coords[0][1] === coords[coords.length-1][1];

                if (isClosed || element.type === 'relation') {
                    geometry = { type: 'Polygon', coordinates: [coords] };
                } else {
                    geometry = { type: 'LineString', coordinates: coords };
                }
            }

            if (geometry) {
                features.push({
                    type: type,
                    geometry: geometry,
                    properties: { ...element.tags, osm_id: element.id }
                });
            }
        });

        return { type: 'FeatureCollection', features: features };
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