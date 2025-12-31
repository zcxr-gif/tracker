/**
 * airportLayout.js
 * High-fidelity Airport Layout: Widened coverage and enhanced cartography.
 * Updated: Added gate lines (parking guidelines) and "tag" style gate labels.
 */

export const AirportLayoutManager = {
    activeLayers: new Set(),
    layoutCache: new Map(),

    async plotTaxiways(map, icao, lat, lon) {
        if (!map) return;

        const sourceId = `airport-${icao}-source`;
        const pavementLayerId = `pavement-${icao}`;
        const taxiLineLayerId = `taxi-line-${icao}`;
        const gateLineLayerId = `gate-line-${icao}`;
        const gateCircleLayerId = `gate-point-${icao}`;
        const taxiLabelLayerId = `taxi-label-${icao}`;
        const gateLabelLayerId = `gate-label-${icao}`;

        this.clearAll(map);

        let geojsonData;

        if (this.layoutCache.has(icao)) {
            geojsonData = this.layoutCache.get(icao);
        } else {
            /**
             * WIDENED AREA & IMPROVED QUERY
             * Added 'parking_guideline' to capture the lead-in lines to gates.
             */
            const buffer = 0.05; 
            const bbox = `${lat - (buffer/2)},${lon - buffer},${lat + (buffer/2)},${lon + buffer}`;
            
            const query = `[out:json][timeout:45];
                (
                  way["aeroway"~"taxiway|taxilane|apron|apron_way|runway|parking_guideline"](${bbox});
                  relation["aeroway"~"taxiway|taxilane|apron|apron_way|runway|parking_guideline"](${bbox});
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

        // 1. PAVEMENT (Darker, cleaner polygons)
        map.addLayer({
            id: pavementLayerId,
            type: 'fill',
            source: sourceId,
            filter: ['==', '$type', 'Polygon'],
            paint: {
                'fill-color': [
                    'match',
                    ['get', 'aeroway'],
                    'runway', '#0a0a0a', 
                    '#1e1e1e'            
                ],
                'fill-opacity': 0.85
            }
        }, 'sector-ops-live-flights-layer');

        // 2. TAXIWAY CENTERLINES
        map.addLayer({
            id: taxiLineLayerId,
            type: 'line',
            source: sourceId,
            filter: ['all', 
                ['==', '$type', 'LineString'],
                ['!=', 'aeroway', 'runway'],
                ['!=', 'aeroway', 'parking_guideline']
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

        // 3. GATE LINES (Lead-in / Parking Guidelines)
        // These are thinner and only appear when zoomed in closer.
        map.addLayer({
            id: gateLineLayerId,
            type: 'line',
            source: sourceId,
            filter: ['==', 'aeroway', 'parking_guideline'],
            layout: { 
                'line-join': 'round', 
                'line-cap': 'round' 
            },
            paint: {
                'line-color': '#fde047',
                'line-width': [
                    'interpolate', ['linear'], ['zoom'], 
                    14, 0.5, 
                    16, 1.5, 
                    18, 3
                ],
                'line-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    14, 0,
                    15, 0.8
                ]
            }
        });

        // 4. TAXIWAY LABELS (Subtle guidance)
        map.addLayer({
            id: taxiLabelLayerId,
            type: 'symbol',
            source: sourceId,
            filter: ['all', 
                ['==', '$type', 'LineString'], 
                ['has', 'ref'],
                ['!=', 'aeroway', 'parking_guideline']
            ],
            layout: {
                'text-field': ['get', 'ref'],
                'symbol-placement': 'line',
                'symbol-spacing': 300,
                'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 17, 12],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-rotation-alignment': 'map'
            },
            paint: {
                'text-color': '#fde047',
                'text-halo-color': '#000',
                'text-halo-width': 1.5
            }
        });

        // 5. GATE/PARKING STAND POINTS
        map.addLayer({
            id: gateCircleLayerId,
            type: 'circle',
            source: sourceId,
            filter: ['all', 
                ['==', '$type', 'Point'], 
                ['match', ['get', 'aeroway'], ['gate', 'parking_position'], true, false]
            ],
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.5, 17, 3],
                'circle-color': '#fde047',
                'circle-stroke-width': 1,
                'circle-stroke-color': '#000',
                'circle-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1]
            }
        });

        // 6. GATE LABELS (Styled as "Tags" - Zoom restricted)
        // Only visible from zoom 16+ to prevent clutter.
        map.addLayer({
            id: gateLabelLayerId,
            type: 'symbol',
            source: sourceId,
            filter: ['all', ['==', '$type', 'Point'], ['has', 'ref']],
            layout: {
                'text-field': ['get', 'ref'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 16, 9, 18, 11],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-offset': [0, 1.2],
                'text-anchor': 'top',
                'text-allow-overlap': false,
                'text-letter-spacing': 0.05
            },
            paint: {
                'text-color': '#ffffff',
                // Thick halo creates the "tag" / pill background look
                'text-halo-color': '#111111',
                'text-halo-width': 2.5,
                'text-halo-blur': 0.5,
                'text-opacity': [
                    'interpolate', ['linear'], ['zoom'],
                    15.5, 0,
                    16, 1
                ]
            }
        });

        this.activeLayers.add({ 
            sourceId, 
            layers: [
                pavementLayerId, 
                taxiLineLayerId, 
                gateLineLayerId, 
                taxiLabelLayerId, 
                gateCircleLayerId, 
                gateLabelLayerId
            ] 
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

                // Check if it's an apron or hangar area (Polygon) vs a line (Taxiway/Guideline)
                const isArea = element.tags && (element.tags.aeroway === 'apron' || element.tags.aeroway === 'hangar');

                if ((isClosed && isArea) || element.type === 'relation') {
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