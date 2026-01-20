/**
 * airportLayout.js
 * Enhanced Procedural Layout with HTML-referenced Styling
 * Includes ICAO Pattern A Hold-Short Markings
 */

export const AirportLayoutManager = {
    activeLayers: new Set(),
    layoutCache: new Map(),

    // --- STYLING CONSTANTS (Matched to HTML Reference) ---
    COLORS: {
        RUNWAY_BASE: '#333333',     // HTML ASPHALT
        TAXIWAY_BASE: '#222222',     // Slightly darker pavement
        MARKING_WHITE: '#FFFFFF',
        MARKING_YELLOW: '#FACC15',   // HTML TAXIWAY_YELLOW
        GRASS_FALLBACK: '#14532d'    // HTML GRASS
    },

    // --- GEOMETRY UTILITIES ---
    
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

    getDistance(pt1, pt2) {
        const R = 6378137;
        const dLat = (pt2[1] - pt1[1]) * Math.PI / 180;
        const dLon = (pt2[0] - pt1[0]) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(pt1[1] * Math.PI / 180) * Math.cos(pt2[1] * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    },

    destPoint(pt, brng, dist) {
        const R = 6378137;
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
        const markingSourceId = `airport-markings-${icao}-source`;
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

        // --- PROCEDURAL MARKING BUILD ---
        const markingData = this.generateMarkings(geojsonData);

        map.addSource(sourceId, { type: 'geojson', data: geojsonData });
        map.addSource(markingSourceId, { type: 'geojson', data: markingData });

        // 1. TAXIWAY PAVEMENT (Darker Asphalt)
        map.addLayer({
            id: `taxi-pavement-${icao}`,
            type: 'fill',
            source: sourceId,
            filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'aeroway', 'runway']],
            paint: { 'fill-color': this.COLORS.TAXIWAY_BASE, 'fill-opacity': 0.95 }
        }, planeLayerId);

        // 2. RUNWAY BASE (HTML ASPHALT)
        map.addLayer({
            id: `runway-base-${icao}`,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', 'aeroway', 'runway'], ['==', '$type', 'LineString']],
            layout: { 'line-cap': 'butt', 'line-join': 'miter' },
            paint: {
                'line-color': this.COLORS.RUNWAY_BASE,
                'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 2, 12, 6, 14, 25, 16, 80, 18, 180]
            }
        }, planeLayerId);

        // 3. RUNWAY EDGE STRIPES
        map.addLayer({
            id: `runway-edge-stripes-${icao}`,
            type: 'line',
            source: markingSourceId,
            filter: ['==', 'type', 'edge-stripe'],
            paint: {
                'line-color': this.COLORS.MARKING_WHITE,
                'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.8, 18, 3],
                'line-opacity': 0.8
            }
        }, planeLayerId);

        // 4. RUNWAY BLOCKS (Threshold/Aiming)
        map.addLayer({
            id: `runway-blocks-${icao}`,
            type: 'line',
            source: markingSourceId,
            filter: ['match', ['get', 'type'], ['threshold-stripe', 'aiming-point', 'touchdown-zone'], true, false],
            paint: {
                'line-color': this.COLORS.MARKING_WHITE,
                'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 14, 2, 16, 8, 18, 20],
                'line-opacity': 1.0
            }
        }, planeLayerId);

        // 5. TAXIWAY CENTERLINES
        map.addLayer({
            id: `taxi-lines-${icao}`,
            type: 'line',
            source: sourceId,
            filter: ['all', ['==', '$type', 'LineString'], ['!=', 'aeroway', 'runway'], ['!=', 'aeroway', 'parking_guideline']],
            paint: {
                'line-color': this.COLORS.MARKING_YELLOW,
                'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.5, 14, 1.5, 16, 3, 18, 6]
            }
        }, planeLayerId);

        // 6. HOLD SHORT LINES (Pattern A)
        // Solid Side
        map.addLayer({
            id: `hold-short-solid-${icao}`,
            type: 'line',
            source: markingSourceId,
            filter: ['==', 'type', 'hold-short-solid'],
            paint: {
                'line-color': this.COLORS.MARKING_YELLOW,
                'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 5],
                'line-gap-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 5]
            }
        }, planeLayerId);

        // Dashed Side
        map.addLayer({
            id: `hold-short-dash-${icao}`,
            type: 'line',
            source: markingSourceId,
            filter: ['==', 'type', 'hold-short-dash'],
            paint: {
                'line-color': this.COLORS.MARKING_YELLOW,
                'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 5],
                'line-gap-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 5],
                'line-dasharray': [2, 2]
            }
        }, planeLayerId);

        // 7. RUNWAY DESIGNATIONS
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
                'text-color': this.COLORS.MARKING_WHITE,
                'text-halo-color': '#000000',
                'text-halo-width': 1.5,
                'text-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.5, 1]
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
                `taxi-lines-${icao}`,
                `hold-short-solid-${icao}`,
                `hold-short-dash-${icao}`,
                `runway-labels-${icao}`
            ] 
        });
    },

    generateMarkings(osmData) {
        const features = [];
        const runways = osmData.features.filter(f => f.properties.aeroway === 'runway' && f.geometry.type === 'LineString');
        const taxiways = osmData.features.filter(f => f.properties.aeroway === 'taxiway' && f.geometry.type === 'LineString');

        // 1. Generate Runway Markings
        runways.forEach(rw => {
            const coords = rw.geometry.coordinates;
            const start = coords[0];
            const end = coords[coords.length - 1];
            const bearing = this.getBearing(start, end);
            const reverseBearing = (bearing + 180) % 360;
            const rwWidth = 45;

            const addEndMarkings = (origin, brng, label) => {
                if (!label) return;
                const textRotation = (brng + 180) % 360; 
                const numPos = this.destPoint(origin, brng, 40);
                features.push({
                    type: "Feature",
                    geometry: { type: "Point", coordinates: numPos },
                    properties: { type: "designation", ref: label, bearing: textRotation }
                });

                // Threshold Zebra
                for (let i = -14; i <= 14; i += 4) {
                    const stripeOrigin = this.destPoint(origin, brng + 90, i);
                    const sStart = this.destPoint(stripeOrigin, brng, 2);
                    const sEnd = this.destPoint(sStart, brng, 15);
                    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [sStart, sEnd] }, properties: { type: "threshold-stripe" } });
                }

                // Aiming Points
                [-12, 12].forEach(side => {
                    const bStart = this.destPoint(this.destPoint(origin, brng + 90, side), brng, 300);
                    const bEnd = this.destPoint(bStart, brng, 45);
                    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [bStart, bEnd] }, properties: { type: "aiming-point" } });
                });
            };

            const refs = rw.properties.ref ? rw.properties.ref.split('/') : ["", ""];
            addEndMarkings(start, bearing, refs[0]);
            addEndMarkings(end, reverseBearing, refs[1]);

            // Edge Stripes
            const lS = this.destPoint(start, bearing + 90, rwWidth/2), lE = this.destPoint(end, bearing + 90, rwWidth/2);
            const rS = this.destPoint(start, bearing - 90, rwWidth/2), rE = this.destPoint(end, bearing - 90, rwWidth/2);
            features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [lS, lE] }, properties: { type: "edge-stripe" } });
            features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [rS, rE] }, properties: { type: "edge-stripe" } });
        });

        // 2. Procedural Hold-Short Markings (Pattern A)
        // We find taxiway nodes that are close to runway segments
        taxiways.forEach(tw => {
            const twCoords = tw.geometry.coordinates;
            twCoords.forEach(coord => {
                runways.forEach(rw => {
                    const rwCoords = rw.geometry.coordinates;
                    for (let i = 0; i < rwCoords.length - 1; i++) {
                        const dist = this.getDistanceToSegment(coord, rwCoords[i], rwCoords[i+1]);
                        // If taxiway point is near runway edge (within ~40m)
                        if (dist > 25 && dist < 45) {
                            const rwBearing = this.getBearing(rwCoords[i], rwCoords[i+1]);
                            // Create the 4-line pattern
                            this.createHoldShortPattern(features, coord, rwBearing + 90, 25);
                        }
                    }
                });
            });
        });

        return { type: 'FeatureCollection', features };
    },

    createHoldShortPattern(features, center, angle, width) {
        // Pattern A: 2 solid (runway side), 2 dashed (taxiway side)
        // We use 'angle' as the orientation of the taxiway entering the runway
        const offsets = [-3, -1, 1, 3]; // meters from center
        const halfWidth = width / 2;

        offsets.forEach((off, idx) => {
            const p1 = this.destPoint(this.destPoint(center, angle + 90, halfWidth), angle, off);
            const p2 = this.destPoint(this.destPoint(center, angle - 90, halfWidth), angle, off);
            
            features.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: [p1, p2] },
                properties: { 
                    type: idx < 2 ? "hold-short-solid" : "hold-short-dash" 
                }
            });
        });
    },

    getDistanceToSegment(p, a, b) {
        const d2 = Math.pow(a[0]-b[0], 2) + Math.pow(a[1]-b[1], 2);
        if (d2 === 0) return this.getDistance(p, a);
        let t = ((p[0]-a[0])*(b[0]-a[0]) + (p[1]-a[1])*(b[1]-a[1])) / d2;
        t = Math.max(0, Math.min(1, t));
        const projection = [a[0] + t*(b[0]-a[0]), a[1] + t*(b[1]-a[1])];
        return this.getDistance(p, projection);
    },

    processOsmData(elements) {
        const features = [];
        elements.forEach(element => {
            let geometry = null;
            if (element.type === 'node') {
                geometry = { type: 'Point', coordinates: [element.lon, element.lat] };
            } else if (element.geometry) {
                const coords = element.geometry.map(p => [p.lon, p.lat]);
                const isArea = element.tags && (element.tags.aeroway === 'apron' || element.tags.aeroway === 'runway' || element.tags.area === 'yes');
                if (coords.length > 3 && coords[0][0] === coords[coords.length-1][0] && isArea) {
                    geometry = { type: 'Polygon', coordinates: [coords] };
                } else {
                    geometry = { type: 'LineString', coordinates: coords };
                }
            }
            if (geometry) features.push({ type: "Feature", geometry: geometry, properties: { ...element.tags, osm_id: element.id } });
        });
        return { type: 'FeatureCollection', features };
    },

    clearAll(map) {
        if (!map) return;
        this.activeLayers.forEach(({ sourceId, markingSourceId, layers }) => {
            layers.forEach(layerId => { if (map.getLayer(layerId)) map.removeLayer(layerId); });
            if (map.getSource(sourceId)) map.removeSource(sourceId);
            if (markingSourceId && map.getSource(markingSourceId)) map.removeSource(markingSourceId);
        });
        this.activeLayers.clear();
    }
};