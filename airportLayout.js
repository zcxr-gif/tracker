/**
 * airportLayout.js
 * High-fidelity Airport Layout: Widened coverage and enhanced cartography.
 */

export const AirportLayoutManager = {
    activeLayers: new Set(),
    layoutCache: new Map(),

    async plotTaxiways(map, icao, lat, lon) {
        if (!map) return;

        const sourceId = `airport-${icao}-source`;
        const pavementLayerId = `pavement-${icao}`;
        const taxiLineLayerId = `taxi-line-${icao}`;
        const gateCircleLayerId = `gate-point-${icao}`;
        const taxiLabelLayerId = `taxi-label-${icao}`;
        const gateLabelLayerId = `gate-label-${icao}`;

        this.clearAll(map);

        let geojsonData;

        if (this.layoutCache.has(icao)) {
            geojsonData = this.layoutCache.get(icao);
        } else {
            /**
             * 1. WIDENED AREA & IMPROVED QUERY
             * Increased bbox to ~0.06 degrees (approx 6-7km coverage) to handle large hubs like JFK/DFW.
             * Added 'taxilane' and 'apron_way' to capture internal terminal paths.
             */
            const buffer = 0.05; 
            const bbox = `${lat - (buffer/2)},${lon - buffer},${lat + (buffer/2)},${lon + buffer}`;
            
            // Comprehensive query for all airport infrastructure
            const query = `[out:json][timeout:45];
                (
                  way["aeroway"~"taxiway|taxilane|apron|apron_way|runway"](${bbox});
                  relation["aeroway"~"taxiway|taxilane|apron|apron_way|runway"](${bbox});
                  node["aeroway"~"gate|parking_position"](${bbox});
                );
                out geom;`;
            
            const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

            try {
                const response = await fetch(url);
                if (!response.ok) return;
                const data = await response.json();
                if (!data.elements || data.elements.length === 0) return;

                geojsonData = this.processOsmData(data.elements);
                this.layoutCache.set(icao, geojsonData);
            } catch (error) {
                console.error(`AirportLayout error:`, error);
                return;
            }
        }

        map.addSource(sourceId, {
            type: 'geojson',
            data: geojsonData
        });

        // 2. ENHANCED PAVEMENT (Darker, cleaner polygons)
        map.addLayer({
            id: pavementLayerId,
            type: 'fill',
            source: sourceId,
            filter: ['==', '$type', 'Polygon'],
            paint: {
                'fill-color': [
                    'match',
                    ['get', 'aeroway'],
                    'runway', '#0a0a0a', // Runways are darkest
                    '#1e1e1e'            // Aprons and taxiways
                ],
                'fill-opacity': 0.85
            }
        }, 'sector-ops-live-flights-layer');

        // 3. TAXIWAY CENTERLINES (Professional styling)
        map.addLayer({
            id: taxiLineLayerId,
            type: 'line',
            source: sourceId,
            filter: ['all', 
                ['==', '$type', 'LineString'],
                ['!=', 'aeroway', 'runway'] // Don't put yellow lines on runways
            ],
            layout: { 
                'line-join': 'round', 
                'line-cap': 'round' 
            },
            paint: {
                'line-color': '#fde047',
                'line-width': [
                    'interpolate', ['exponential', 1.5], ['zoom'], 
                    12, 0.2, 
                    14, 1.2, 
                    16, 2.5, 
                    18, 5
                ],
                'line-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    12, 0.2,
                    14, 1.0
                ]
            }
        });

        // 4. TAXIWAY LABELS (Small, subtle guidance)
        map.addLayer({
            id: taxiLabelLayerId,
            type: 'symbol',
            source: sourceId,
            filter: ['all', ['==', '$type', 'LineString'], ['has', 'ref']],
            layout: {
                'text-field': ['get', 'ref'],
                'symbol-placement': 'line',
                'symbol-spacing': 300,
                'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 17, 12],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-rotation-alignment': 'map',
                'text-pitch-alignment': 'viewport'
            },
            paint: {
                'text-color': '#fde047',
                'text-halo-color': '#000',
                'text-halo-width': 1.5
            }
        });

        // 5. GATE/PARKING STANDS (Professional circle markers)
        map.addLayer({
            id: gateCircleLayerId,
            type: 'circle',
            source: sourceId,
            filter: ['all', 
                ['==', '$type', 'Point'], 
                ['match', ['get', 'aeroway'], ['gate', 'parking_position'], true, false]
            ],
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.5, 17, 4],
                'circle-color': '#fde047',
                'circle-stroke-width': 1,
                'circle-stroke-color': '#000'
            }
        });

        // 6. GATE LABELS (High contrast for readability)
        map.addLayer({
            id: gateLabelLayerId,
            type: 'symbol',
            source: sourceId,
            filter: ['all', ['==', '$type', 'Point'], ['has', 'ref']],
            layout: {
                'text-field': ['get', 'ref'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 15, 8, 18, 11],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-offset': [0, 1.5],
                'text-anchor': 'top',
                'text-allow-overlap': false
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#111',
                'text-halo-width': 2
            }
        });

        this.activeLayers.add({ 
            sourceId, 
            layers: [pavementLayerId, taxiLineLayerId, taxiLabelLayerId, gateCircleLayerId, gateLabelLayerId] 
        });
    },

    processOsmData(elements) {
        const features = [];
        elements.forEach(element => {
            let geometry = null;
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
                    type: "Feature",
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