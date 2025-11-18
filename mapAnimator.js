/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle updating flight positions on a Mapbox GL JS map.
 *
 * --- [USER-REQUESTED REWRITE: Teleport-Only Model] ---
 *
 * This model provides *no animation or interpolation*.
 *
 * When new flight data arrives, the GeoJSON feature is
 * immediately "teleported" to the new coordinates and its
 * properties (like heading) are updated.
 *
 * This version includes a timestamp check to prevent
 * out-of-order data from moving planes backward.
 * ===================================================================
 */

/**
 * Main manager for the Mapbox map.
 * In this version, it does not "animate", it only handles
 * updating the map source when data changes.
 */
export class MapAnimator {
    /**
     * @param {mapboxgl.Map} map - The Mapbox map instance.
     * @param {string} sourceName - The name of the GeoJSON source to update.
     * @param {Object} featuresObject - A *reference* to the master features object (currentMapFeatures) in flight.js.
     */
    constructor(map, sourceName, featuresObject) {
        this.map = map;
        this.sourceName = sourceName;
        this.currentMapFeatures = featuresObject; // This is a SHARED REFERENCE
    }

    /**
     * Starts the animator. (No-op in teleport mode).
     */
    start() {
        console.log('MapAnimator (Teleport) started.');
    }

    /**
     * Stops the animator. (No-op in teleport mode).
     */
    stop() {
        console.log('MapAnimator (Teleport) stopped.');
    }

    /**
     * Updates or creates a flight's state based on new data.
     * This will "teleport" the feature to the new position.
     * @param {object} newPosition - {lon, lat, heading_deg}
     * @param {object} newProperties - The full properties object.
     */
    updateFlight(newPosition, newProperties) {
        const flightId = newProperties.flightId;

        // --- [THE FIX: TIMESTAMP GUARD] ---
        
        // 1. Get the timestamp from the new data.
        //    !!! IMPORTANT: Change 'last_update' to your data's actual timestamp property !!!
        const newTimestamp = newProperties.last_update;

        // 2. Check if the flight already exists in our master list
        const existingFeature = this.currentMapFeatures[flightId];

        if (existingFeature) {
            // 3. Get the timestamp of the *current* data on the map
            //    This assumes the timestamp is also stored in the feature's properties.
            const currentTimestamp = existingFeature.properties.last_update;

            // 4. The Guard Clause:
            //    If the new data is older than (or equal to) the current data,
            //    stop right here. Do not process this "old" packet.
            if (newTimestamp <= currentTimestamp) {
                // You can uncomment this for debugging
                // console.warn(`Ignoring out-of-order data for ${flightId}`);
                return; // Do nothing
            }
        }
        // --- [END OF FIX] ---

        // If we are here, it's either:
        // a) A brand new flight (existingFeature was false)
        // b) Newer data for an existing flight (newTimestamp > currentTimestamp)

        // Proceed with the "teleport"
        const newApiLon = newPosition.lon;
        const newApiLat = newPosition.lat;

        this.currentMapFeatures[flightId] = {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [newApiLon, newApiLat]
            },
            properties: newProperties // This stores the new properties, including the new, later timestamp
        };

        // Trigger an immediate update of the map source.
        this._updateMapSource();
    }

    /**
     * Removes a flight from the map.
     * @param {string} flightId 
     */
    removeFlight(flightId) {
        delete this.currentMapFeatures[flightId];

        // Trigger an immediate update to remove it from the map.
        this._updateMapSource();
    }

    /**
     * Pushes the current state of *all* features to the map source.
     * This is called by updateFlight and removeFlight.
     */
    _updateMapSource() {
        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            return;
        }

        source.setData({
            type: 'FeatureCollection',
            features: Object.values(this.currentMapFeatures)
        });
    }
}