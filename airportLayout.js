/**
 * airportLayout.js
 * Professional Airport Styling: Taxiway Markings, Pavement, and Signage.
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
            // Fetching taxiways, parking positions, and gates
            const bbox = `${lat - 0.02},${lon - 0.04},${lat + 0.02},${lon + 0.04}`;
            const query = `[out:json][timeout:30];(way["aeroway"~"taxiway|parking_position|apron"](${bbox});relation["aeroway"~"taxiway|parking_position|apron"](${bbox});node["aeroway"~"gate|parking_position"](${bbox}););out geom;`;
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

        // 1. PAVEMENT (The Asphalt)
        map.addLayer({
            id: pavementLayerId,
            type: 'fill',
            source: sourceId,
            filter: ['==', '$type', 'Polygon'],
            paint: {
                'fill-color': '#1a1a1a', // Deep charcoal black
                'fill-opacity': 0.8
            }
        }, 'sector-ops-live-flights-layer');

        // 2. TAXIWAY CENTERLINES (The Yellow Lines)
        map.addLayer({
            id: taxiLineLayerId,
            type: 'line',
            source: sourceId,
            filter: ['==', '$type', 'LineString'],
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': '#fde047', // Standard Aviation Yellow
                'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 13, 0.8, 16, 2.5, 18, 6],
                'line-opacity': 0.9
            }
        });

        // 3. TAXIWAY SIGNAGE (Yellow text on black backgrounds)
        map.addLayer({
            id: taxiLabelLayerId,
            type: 'symbol',
            source: sourceId,
            filter: ['all', ['==', '$type', 'LineString'], ['has', 'ref']],
            layout: {
                'text-field': ['get', 'ref'],
                'symbol-placement': 'line',
                'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 17, 14],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-letter-spacing': 0.1,
                'text-max-angle': 30,
                'text-rotation-alignment': 'map'
            },
            paint: {
                'text-color': '#fde047',
                'text-halo-color': '#000',
                'text-halo-width': 2,
                'text-halo-blur': 0
            }
        });

        // 4. GATE POINTS (The actual parking spot)
        map.addLayer({
            id: gateCircleLayerId,
            type: 'circle',
            source: sourceId,
            filter: ['all', 
                ['==', '$type', 'Point'], 
                ['match', ['get', 'aeroway'], ['gate', 'parking_position'], true, false]
            ],
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2, 18, 5],
                'circle-color': '#1a1a1a',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#fde047'
            }
        });

        // 5. GATE LABELS (White/Bold text for Terminal Gates)
        map.addLayer({
            id: gateLabelLayerId,
            type: 'symbol',
            source: sourceId,
            filter: ['all', ['==', '$type', 'Point'], ['has', 'ref']],
            layout: {
                'text-field': ['get', 'ref'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 15, 8, 18, 12],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-offset': [0, 1.2],
                'text-anchor': 'top'
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#000',
                'text-halo-width': 1
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