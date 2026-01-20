/**
 * airportLayout.js
 * High-Detail Procedural Runway Build
 * Generates ICAO-standard markings (Thresholds, Aiming Points, Designations)
 */

export const AirportLayoutManager = {
    activeLayers: new Set(),
    layoutCache: new Map(),

    // --- GEOMETRY UTILITIES ---
    
    // Calculates bearing between two coordinates [lon, lat]
    getBearing(start, end) {
        const startLat = start[1] * Math.PI / 180;
        const startLon = start[0] * Math.PI / 180;
        const endLat = end[1] * Math.PI / 180;
        const endLon = end[0] * Math.PI / 180;
        const dLon = endLon - startLon;
        const y = Math.sin(dLon) * Math.cos(endLat);
        const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLon);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    },

    // Calculates a new coordinate based on distance (meters) and bearing
    destPoint(pt, brng, dist) {
        const R = 6378137; // Earth's radius
        const brngRad = brng * Math.PI / 180;
        const lat1 = pt[1] * Math.PI / 180;
        const lon1 = pt[0] * Math.PI / 180;
        const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dist / R) + Math.cos(lat1) * Math.sin(dist / R) * Math.cos(brngRad));
        const lon2 = lon1 + Math.atan2(Math.sin(brngRad) * Math.sin(dist / R) * Math.cos(lat1), Math.cos(dist / R) - Math.sin(lat1) * Math.sin(lat2));
        return [lon2 * 180 / Math.PI, lat2 * 180 / Math.PI];
    },

    async plotTaxiways(map, icao, lat, lon) {
        if (!map) return;

        const sourceId = `airport-${icao}-source`;
        const markingSourceId = `runway-markings-${icao}-source`;
        const planeLayerId = 'sector-ops-live-flights-layer'; 
        
        this.clearAll(map);

        let geojsonData;

        if (this.layoutCache.has(icao)) {
            geojsonData = this.layoutCache.get(icao);
        } else {
            const buffer = 0.05; 
            const bbox = `${lat - (buffer/2)},${lon - buffer},${lat + (buffer/2)},${lon + buffer}`;
            const query = `[out:json][timeout:45];(way["aeroway"~"taxiway|taxilane|apron|runway|parking_guideline"](${bbox});relation["aeroway"~"taxiway|taxilane|apron|runway|parking_guideline"](${bbox});node["aeroway"~"gate|parking_position"](${bbox}););out geom;`;
            const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

            try {
                const response = await fetch(url);
                const data = await response.json();
                if (!data.elements) return;
                geojsonData = this.processOsmData(data.elements);
                this.layoutCache.set(icao, geojsonData);
            } catch (error) {
                console.error(`AirportLayout error:`, error);
                return;
            }
        }

        // --- PROCEDURAL RUNWAY BUILD ---
        const markingData = this.generateRunwayBuild(geojsonData);

        map.addSource(sourceId, { type: 'geojson', data: geojsonData });
        map.addSource(markingSourceId, { type: 'geojson', data: markingData });

        // 1. TAXIWAY PAVEMENT
        map.addLayer({
            id: `taxi-pavement-${icao}`,
            type: 'fill',
            source: sourceId,
            filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'aeroway', 'runway']],
            paint: { 'fill-color': '#1a1a1a', 'fill-opacity': 0.9 }
        }, planeLayerId);

        // 2. RUNWAY BASE (Pavement)
        map.addLayer({
            id: `runway-base-${icao}`,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', 'aeroway', 'runway'], ['==', '$type', 'LineString']],
            layout: { 'line-cap': 'square', 'line-join': 'miter' },
            paint: {
                'line-color': '#0f0f0f',
                'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 2, 12, 6, 14, 25, 16, 80, 18, 180]
            }
        }, planeLayerId);

        // 3. RUNWAY SIDE STRIPES (Solid white edges)
        map.addLayer({
            id: `runway-edge-stripes-${icao}`,
            type: 'line',
            source: markingSourceId,
            filter: ['==', 'type', 'edge-stripe'],
            paint: {
                'line-color': '#ffffff',
                'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 4],
                'line-opacity': 0.8
            }
        }, planeLayerId);

        // 4. RUNWAY MARKINGS (Thresholds & Aiming blocks)
        map.addLayer({
            id: `runway-blocks-${icao}`,
            type: 'line',
            source: markingSourceId,
            filter: ['match', ['get', 'type'], ['threshold-stripe', 'aiming-point', 'touchdown-zone'], true, false],
            paint: {
                'line-color': '#ffffff',
                'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 14, 2, 16, 8, 18, 20],
                'line-opacity': 0.95
            }
        }, planeLayerId);

        // 5. RUNWAY CENTERLINE (Dashed)
        map.addLayer({
            id: `runway-centerline-${icao}`,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', 'aeroway', 'runway'], ['==', '$type', 'LineString']],
            paint: {
                'line-color': '#ffffff',
                'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 4],
                'line-dasharray': [5, 5],
                'line-opacity': 0.9
            }
        }, planeLayerId);

        // 6. RUNWAY DESIGNATIONS (Numbers/Letters)
        map.addLayer({
            id: `runway-labels-${icao}`,
            type: 'symbol',
            source: markingSourceId,
            filter: ['==', 'type', 'designation'],
            layout: {
                'text-field': ['get', 'ref'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 15, 12, 18, 45],
                'text-font': ['Open Sans Bold'],
                'text-rotate': ['get', 'bearing'],
                'text-rotation-alignment': 'map',
                'text-allow-overlap': true,
                'text-ignore-placement': true
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#000000',
                'text-halo-width': 1
            }
        }, planeLayerId);

        // 7. TAXIWAY LINES (Yellow)
        map.addLayer({
            id: `taxi-lines-${icao}`,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', '$type', 'LineString'], ['!=', 'aeroway', 'runway'], ['!=', 'aeroway', 'parking_guideline']],
            paint: {
                'line-color': '#fde047',
                'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.4, 14, 1.2, 16, 3, 18, 6]
            }
        }, planeLayerId);

        this.activeLayers.add({ 
            sourceId, 
            markingSourceId,
            layers: [
                `taxi-pavement-${icao}`,
                `runway-base-${icao}`,
                `runway-edge-stripes-${icao}`,
                `runway-blocks-${icao}`,
                `runway-centerline-${icao}`,
                `runway-labels-${icao}`,
                `taxi-lines-${icao}`
            ] 
        });
    },

    generateRunwayBuild(osmData) {
        const features = [];
        const runways = osmData.features.filter(f => f.properties.aeroway === 'runway' && f.geometry.type === 'LineString');

        runways.forEach(rw => {
            const coords = rw.geometry.coordinates;
            const start = coords[0];
            const end = coords[coords.length - 1];
            
            // Core Runway Stats
            const bearing = this.getBearing(start, end);
            const reverseBearing = (bearing + 180) % 360;
            const runwayWidth = 45; // Standard ICAO width

            const addEndMarkings = (origin, brng, label) => {
                if (!label) return;

                // A. Designation Number (Pos 40m from threshold)
                const numPos = this.destPoint(origin, brng, 40);
                features.push({
                    type: "Feature",
                    geometry: { type: "Point", coordinates: numPos },
                    properties: { type: "designation", ref: label, bearing: (brng + 90) % 360 }
                });

                // B. Threshold Stripes (Zebra)
                // We draw 8 stripes total, spaced across the runway width
                for (let i = -14; i <= 14; i += 4) {
                    const stripeOrigin = this.destPoint(origin, brng + 90, i);
                    const stripeStart = this.destPoint(stripeOrigin, brng, 2);
                    const stripeEnd = this.destPoint(stripeStart, brng, 15);
                    features.push({
                        type: "Feature",
                        geometry: { type: "LineString", coordinates: [stripeStart, stripeEnd] },
                        properties: { type: "threshold-stripe" }
                    });
                }

                // C. Aiming Points (The big blocks at 300m)
                [-12, 12].forEach(sideOffset => {
                    const blockStart = this.destPoint(this.destPoint(origin, brng + 90, sideOffset), brng, 300);
                    const blockEnd = this.destPoint(blockStart, brng, 45);
                    features.push({
                        type: "Feature",
                        geometry: { type: "LineString", coordinates: [blockStart, blockEnd] },
                        properties: { type: "aiming-point" }
                    });
                });

                // D. Touchdown Zone Markers (150m, 450m, 600m)
                [150, 450, 600].forEach(dist => {
                    [-13, 13].forEach(sideOffset => {
                        const tdStart = this.destPoint(this.destPoint(origin, brng + 90, sideOffset), brng, dist);
                        const tdEnd = this.destPoint(tdStart, brng, 20);
                        features.push({
                            type: "Feature",
                            geometry: { type: "LineString", coordinates: [tdStart, tdEnd] },
                            properties: { type: "touchdown-zone" }
                        });
                    });
                });
            };

            // Parse designation (Handle "09/27" or "09L/27R")
            const refs = rw.properties.ref ? rw.properties.ref.split('/') : ["", ""];
            addEndMarkings(start, bearing, refs[0]);
            addEndMarkings(end, reverseBearing, refs[1]);

            // E. Side Edge Stripes (Continuous solid lines)
            const leftEdgeStart = this.destPoint(start, bearing + 90, runwayWidth / 2);
            const leftEdgeEnd = this.destPoint(end, bearing + 90, runwayWidth / 2);
            const rightEdgeStart = this.destPoint(start, bearing - 90, runwayWidth / 2);
            const rightEdgeEnd = this.destPoint(end, bearing - 90, runwayWidth / 2);

            features.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: [leftEdgeStart, leftEdgeEnd] },
                properties: { type: "edge-stripe" }
            });
            features.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: [rightEdgeStart, rightEdgeEnd] },
                properties: { type: "edge-stripe" }
            });
        });

        return { type: 'FeatureCollection', features };
    },

    processOsmData(elements) {
        const features = [];
        elements.forEach(element => {
            let geometry = null;
            if (element.type === 'node') {
                geometry = { type: 'Point', coordinates: [element.lon, element.lat] };
            } else if (element.geometry) {
                const coords = element.geometry.map(p => [p.lon, p.lat]);
                const isArea = element.tags && (
                    element.tags.aeroway === 'apron' || 
                    element.tags.aeroway === 'runway' ||
                    element.tags.area === 'yes'
                );
                if (coords.length > 3 && coords[0][0] === coords[coords.length-1][0] && isArea) {
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
        return { type: 'FeatureCollection', features };
    },

    clearAll(map) {
        if (!map) return;
        this.activeLayers.forEach(({ sourceId, markingSourceId, layers }) => {
            layers.forEach(layerId => {
                if (map.getLayer(layerId)) map.removeLayer(layerId);
            });
            if (map.getSource(sourceId)) map.removeSource(sourceId);
            if (markingSourceId && map.getSource(markingSourceId)) map.removeSource(markingSourceId);
        });
        this.activeLayers.clear();
    }
};