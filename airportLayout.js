/**
 * airportLayout.js
 * Enhanced Airport Layout: Features high-realism runways and smart-masking taxiways.
 * Fixed Layout Ordering: Taxiways < Lines < Runways (Mask) < Planes
 */

export const AirportLayoutManager = {
    activeLayers: new Set(),
    layoutCache: new Map(),

    async plotTaxiways(map, icao, lat, lon) {
        if (!map) return;

        const sourceId = `airport-${icao}-source`;
        const planeLayerId = 'sector-ops-live-flights-layer'; // The Anchor: Everything goes UNDER this
        
        // Layer IDs
        const taxiOutlineLayerId = `taxi-outline-${icao}`;
        const taxiwayPavementId = `pavement-taxi-${icao}`; // NEW: Split pavement
        const runwayPavementId = `pavement-runway-${icao}`; // NEW: Split pavement
        const taxiLineLayerId = `taxi-line-${icao}`;
        const runwayMarkingId = `runway-marks-${icao}`;
        const runwayEdgeId = `runway-edges-${icao}`;
        const gateLineLayerId = `gate-line-${icao}`;
        const gateCircleLayerId = `gate-point-${icao}`;
        const taxiLabelLayerId = `taxi-label-${icao}`;
        const gateLabelLayerId = `gate-label-${icao}`;

        this.clearAll(map);

        let geojsonData;

        if (this.layoutCache.has(icao)) {
            geojsonData = this.layoutCache.get(icao);
        } else {
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

        // --- NEW LAYER STACKING ORDER ---

        // 1. TAXIWAY OUTLINES (Bottom)
        map.addLayer({
            id: taxiOutlineLayerId,
            type: 'line',
            source: sourceId,
            filter: ['all', 
                ['==', '$type', 'LineString'],
                ['!=', 'aeroway', 'runway'],
                ['!=', 'aeroway', 'parking_guideline']
            ],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': '#000000',
                'line-width': [
                    'interpolate', ['exponential', 1.5], ['zoom'], 
                    12, 1.5, 14, 4, 16, 10, 18, 20
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0.8]
            }
        }, planeLayerId);

        // 2. TAXIWAY/APRON PAVEMENT (Concrete Gray)
        // We render this BEFORE the yellow lines, so yellow lines sit ON TOP of taxiways.
        map.addLayer({
            id: taxiwayPavementId,
            type: 'fill',
            source: sourceId,
            filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'aeroway', 'runway']],
            paint: {
                'fill-color': '#1a1a1a', 
                'fill-opacity': 0.9
            }
        }, planeLayerId);

        // 3. TAXIWAY LINES (Yellow)
        // These now sit on top of taxiways, BUT...
        map.addLayer({
            id: taxiLineLayerId,
            type: 'line',
            source: sourceId,
            filter: ['all', 
                ['==', '$type', 'LineString'],
                ['!=', 'aeroway', 'runway'],
                ['!=', 'aeroway', 'parking_guideline']
            ],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': '#fde047',
                'line-width': [
                    'interpolate', ['exponential', 1.5], ['zoom'], 
                    12, 0.4, 14, 1.2, 16, 3, 18, 6
                ],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 1]
            }
        }, planeLayerId);

        // 4. RUNWAY PAVEMENT (Asphalt Black) - THE MASK
        // Critically, this is drawn AFTER the yellow lines. 
        // Any yellow line crossing the runway will be covered by this layer.
        map.addLayer({
            id: runwayPavementId,
            type: 'fill',
            source: sourceId,
            filter: ['all', ['==', '$type', 'Polygon'], ['==', 'aeroway', 'runway']],
            paint: {
                'fill-color': '#0f0f0f',
                'fill-opacity': 1.0 // Must be 1.0 to fully hide the lines underneath
            }
        }, planeLayerId);

        // 5. RUNWAY MARKINGS (White Dashes)
        // Drawn on top of the black runway pavement.
        map.addLayer({
            id: runwayMarkingId,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', 'aeroway', 'runway'], ['==', '$type', 'LineString']],
            paint: {
                'line-color': '#ffffff',
                'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 15, 3, 18, 6],
                'line-dasharray': [4, 6],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 1]
            }
        }, planeLayerId);

        // 6. RUNWAY EDGES
        map.addLayer({
            id: runwayEdgeId,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', 'aeroway', 'runway'], ['==', '$type', 'Polygon']],
            paint: {
                'line-color': '#ffffff',
                'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 17, 2],
                'line-opacity': 0.4
            }
        }, planeLayerId);

        // 7. GATES & LABELS (Top details)
        map.addLayer({
            id: gateLineLayerId,
            type: 'line',
            source: sourceId,
            filter: ['==', 'aeroway', 'parking_guideline'],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': '#fde047',
                'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.3, 16, 1.2, 18, 2.5],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.7]
            }
        }, planeLayerId);

        map.addLayer({
            id: taxiLabelLayerId,
            type: 'symbol',
            source: sourceId,
            filter: ['all', ['==', '$type', 'LineString'], ['has', 'ref'], ['!=', 'aeroway', 'parking_guideline']],
            layout: {
                'text-field': ['get', 'ref'],
                'symbol-placement': 'line',
                'symbol-spacing': 400,
                'text-size': ['interpolate', ['linear'], ['zoom'], 15, 8, 18, 11],
                'text-font': ['Open Sans Bold'],
                'text-rotation-alignment': 'map'
            },
            paint: {
                'text-color': '#fde047',
                'text-halo-color': '#000',
                'text-halo-width': 1.5
            }
        }, planeLayerId);

        map.addLayer({
            id: gateCircleLayerId,
            type: 'circle',
            source: sourceId,
            filter: ['all', ['==', '$type', 'Point'], ['match', ['get', 'aeroway'], ['gate', 'parking_position'], true, false]],
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 1, 18, 4],
                'circle-color': '#fde047',
                'circle-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 1]
            }
        }, planeLayerId);

        map.addLayer({
            id: gateLabelLayerId,
            type: 'symbol',
            source: sourceId,
            filter: ['all', ['==', '$type', 'Point'], ['has', 'ref']],
            layout: {
                'text-field': ['get', 'ref'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 16, 9, 18, 11],
                'text-font': ['Open Sans Bold'],
                'text-offset': [0, 1.2],
                'text-anchor': 'top'
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#000000',
                'text-halo-width': 2,
                'text-opacity': ['interpolate', ['linear'], ['zoom'], 16, 0, 16.5, 1]
            }
        }, planeLayerId);

        this.activeLayers.add({ 
            sourceId, 
            layers: [
                taxiOutlineLayerId,
                taxiwayPavementId,
                runwayPavementId,
                runwayMarkingId,
                runwayEdgeId,
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

                const isArea = element.tags && (
                    element.tags.aeroway === 'apron' || 
                    element.tags.aeroway === 'hangar' || 
                    element.tags.aeroway === 'runway' ||
                    element.tags.area === 'yes'
                );

                if (isClosed && isArea) {
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