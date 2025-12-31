/**
 * airportLayout.js
 * Externally handles dynamic fetching and plotting of taxiway layouts.
 */

export const AirportLayoutManager = {
    activeLayers: new Set(),

    /**
     * Fetches taxiway data from OSM and plots it on the Mapbox instance.
     * @param {object} map - The sectorOpsMap instance.
     * @param {string} icao - Airport ICAO code.
     * @param {number} lat - Airport Latitude.
     * @param {number} lon - Airport Longitude.
     */
    async plotTaxiways(map, icao, lat, lon) {
        if (!map) return;

        const sourceId = `taxiways-${icao}-source`;
        const layerId = `taxiways-${icao}-layer`;

        // 1. Cleanup previous layout to keep the map performance high
        this.clearAll(map);

        // 2. Define a bounding box (~2km radius)
        const bbox = `${lat - 0.02},${lon - 0.04},${lat + 0.02},${lon + 0.04}`;
        
        // 3. Construct Overpass Query for aeroway=taxiway
        const query = `[out:json];way["aeroway"="taxiway"](${bbox});out geom;`;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (!data.elements || data.elements.length === 0) {
                console.log(`AirportLayout: No taxiway data found for ${icao}`);
                return;
            }

            // 4. Convert OSM elements to GeoJSON LineStrings
            const features = data.elements.map(element => ({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: element.geometry.map(p => [p.lon, p.lat])
                },
                properties: element.tags
            }));

            // 5. Add to the map
            map.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features }
            });

            map.addLayer({
                'id': layerId,
                'type': 'line',
                'source': sourceId,
                'layout': {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                'paint': {
                    'line-color': '#52525b', // Zinc-600 asphalt color
                    'line-width': [
                        'interpolate', ['exponential', 1.5], ['zoom'],
                        12, 1,
                        14, 3,
                        16, 12,
                        18, 30
                    ],
                    'line-opacity': 0.6
                }
            }, 'sector-ops-live-flights-layer'); // Place UNDER aircraft icons

            this.activeLayers.add({ sourceId, layerId });

        } catch (error) {
            console.error(`AirportLayout: Failed to load layout for ${icao}:`, error);
        }
    },

    /**
     * Removes all plotted taxiway layers from the map.
     */
    clearAll(map) {
        if (!map) return;
        this.activeLayers.forEach(({ sourceId, layerId }) => {
            if (map.getLayer(layerId)) map.removeLayer(layerId);
            if (map.getSource(sourceId)) map.removeSource(sourceId);
        });
        this.activeLayers.clear();
    }
};