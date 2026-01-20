/**
 * airportLayout.js
 * Enhanced Airport Layout with Detailed Markings
 * Includes: Threshold markings (piano keys), Side stripes, Aiming points, and Oriented Runway Designators.
 */

export const AirportLayoutManager = {
    activeLayers: new Set(),
    layoutCache: new Map(),

    async plotTaxiways(map, icao, lat, lon) {
        if (!map) return;

        const sourceId = `airport-${icao}-source`;
        const planeLayerId = 'sector-ops-live-flights-layer'; // The Anchor
        
        // Layer IDs
        const taxiOutlineLayerId = `taxi-outline-${icao}`;
        const taxiwayPavementId = `pavement-taxi-${icao}`;
        const runwayPavementPolyId = `pavement-runway-poly-${icao}`;
        const runwayPavementLineId = `pavement-runway-line-${icao}`;
        const runwayEdgeLeftId = `runway-edge-l-${icao}`;
        const runwayEdgeRightId = `runway-edge-r-${icao}`;
        const runwayThresholdId = `runway-threshold-${icao}`;
        const runwayAimingId = `runway-aiming-${icao}`;
        const runwayCenterlineId = `runway-center-${icao}`;
        const runwayDesignatorId = `runway-num-${icao}`;
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

        // --- LAYER STACKING ORDER ---

        // 1. TAXIWAY OUTLINES
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
                'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 1.5, 14, 4, 16, 10, 18, 20],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0.8]
            }
        }, planeLayerId);

        // 2. TAXIWAY PAVEMENT
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

        // 3. RUNWAY PAVEMENT (Base)
        map.addLayer({
            id: runwayPavementLineId,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', 'aeroway', 'runway'], ['==', '$type', 'LineString']],
            layout: { 'line-cap': 'butt', 'line-join': 'miter' },
            paint: {
                'line-color': '#0f0f0f',
                'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 2, 12, 6, 14, 30, 16, 100, 18, 250]
            }
        }, planeLayerId);

        map.addLayer({
            id: runwayPavementPolyId,
            type: 'fill',
            source: sourceId,
            filter: ['all', ['==', '$type', 'Polygon'], ['==', 'aeroway', 'runway']],
            paint: {
                'fill-color': '#0f0f0f',
                'fill-opacity': 1.0
            }
        }, planeLayerId);

        // 4. RUNWAY SIDE STRIPES (Left & Right)
        const sideStripeWidth = ['interpolate', ['linear'], ['zoom'], 14, 1, 16, 3, 18, 6];
        const sideStripeOffset = ['interpolate', ['linear'], ['zoom'], 14, 14, 16, 48, 18, 120];

        map.addLayer({
            id: runwayEdgeLeftId,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', 'aeroway', 'runway'], ['==', '$type', 'LineString']],
            paint: {
                'line-color': '#ffffff',
                'line-width': sideStripeWidth,
                'line-offset': sideStripeOffset,
                'line-opacity': 0.9
            }
        }, planeLayerId);

        map.addLayer({
            id: runwayEdgeRightId,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', 'aeroway', 'runway'], ['==', '$type', 'LineString']],
            paint: {
                'line-color': '#ffffff',
                'line-width': sideStripeWidth,
                'line-offset': ['negative', sideStripeOffset],
                'line-opacity': 0.9
            }
        }, planeLayerId);

        // 5. THRESHOLD MARKINGS (Piano Keys)
        map.addLayer({
            id: runwayThresholdId,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', 'aeroway', 'runway'], ['==', '$type', 'LineString']],
            paint: {
                'line-color': '#ffffff',
                'line-width': ['interpolate', ['linear'], ['zoom'], 14, 15, 16, 50, 18, 120],
                'line-dasharray': [0.1, 5], // Short stubs at ends
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.8]
            }
        }, planeLayerId);

        // 6. AIMING POINTS (The "Captain's Blocks")
        map.addLayer({
            id: runwayAimingId,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', 'aeroway', 'runway'], ['==', '$type', 'LineString']],
            paint: {
                'line-color': '#ffffff',
                'line-width': ['interpolate', ['linear'], ['zoom'], 15, 5, 18, 18],
                'line-dasharray': [4, 20], 
                'line-offset': ['interpolate', ['linear'], ['zoom'], 15, 18, 18, 50],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.5, 0.8]
            }
        }, planeLayerId);

        // 7. CENTERLINE
        map.addLayer({
            id: runwayCenterlineId,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', 'aeroway', 'runway'], ['==', '$type', 'LineString']],
            paint: {
                'line-color': '#ffffff',
                'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 5],
                'line-dasharray': [5, 10],
                'line-opacity': 0.9
            }
        }, planeLayerId);

        // 8. RUNWAY DESIGNATORS (Numbers)
        map.addLayer({
            id: runwayDesignatorId,
            type: 'symbol',
            source: sourceId,
            filter: ['==', 'feature_type', 'runway_threshold'],
            layout: {
                'text-field': ['get', 'ref'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 15, 12, 18, 36],
                'text-font': ['Open Sans Bold'],
                'text-rotate': ['get', 'bearing'],
                'text-rotation-alignment': 'map',
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                'text-offset': [0, 1]
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#000',
                'text-halo-width': 1.5,
                'text-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.5, 1]
            }
        }, planeLayerId);

        // 9. TAXIWAY LINES & DETAILS
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
                'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.4, 14, 1.2, 16, 3, 18, 6],
                'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 1]
            }
        }, planeLayerId);

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
                taxiOutlineLayerId, taxiwayPavementId,
                runwayPavementPolyId, runwayPavementLineId,
                runwayEdgeLeftId, runwayEdgeRightId,
                runwayThresholdId, runwayAimingId,
                runwayCenterlineId, runwayDesignatorId,
                taxiLineLayerId, gateLineLayerId, 
                taxiLabelLayerId, gateCircleLayerId, 
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
                // Main Feature
                features.push({
                    type: "Feature",
                    geometry: geometry,
                    properties: { ...element.tags, osm_id: element.id }
                });

                // Special Processing for Runway Threshold Points (Designators)
                if (element.tags?.aeroway === 'runway' && geometry.type === 'LineString') {
                    const coords = geometry.coordinates;
                    if (coords.length >= 2) {
                        const start = coords[0];
                        const next = coords[1];
                        const end = coords[coords.length - 1];
                        const prev = coords[coords.length - 2];

                        const calculateBearing = (p1, p2) => {
                            const y = p2[0] - p1[0];
                            const x = p2[1] - p1[1];
                            return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
                        };

                        const refs = element.tags.ref ? element.tags.ref.split('/') : ['', ''];

                        // Entry End
                        features.push({
                            type: "Feature",
                            geometry: { type: 'Point', coordinates: start },
                            properties: { 
                                feature_type: 'runway_threshold', 
                                ref: refs[0], 
                                bearing: calculateBearing(start, next) 
                            }
                        });

                        // Opposite End
                        features.push({
                            type: "Feature",
                            geometry: { type: 'Point', coordinates: end },
                            properties: { 
                                feature_type: 'runway_threshold', 
                                ref: refs[1] || '', 
                                bearing: calculateBearing(end, prev) 
                            }
                        });
                    }
                }
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