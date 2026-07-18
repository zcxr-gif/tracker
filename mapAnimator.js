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
 * The map source is updated immediately on each 'updateFlight'
 * or 'removeFlight' call.
 * ===================================================================
 */

// All animation-related constants and the FlightAnimationState class
// have been removed as they are no longer needed.

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

        // When batching, individual updateFlight/removeFlight calls mutate the
        // shared features object but defer the expensive source.setData() until
        // endBatch(). This turns a per-flight O(n²) rebuild storm (one full
        // FeatureCollection rebuild + Mapbox re-tessellation per flight, per
        // packet) into a single rebuild per packet.
        this._batching = false;

        // No animation state or loop IDs are needed for teleporting.
    }

    /**
     * Begin a batch. While batching, updateFlight()/removeFlight() mutate the
     * feature set but do NOT push to the map source. Call endBatch() to flush.
     */
    beginBatch() {
        this._batching = true;
    }

    /**
     * End a batch and push all accumulated changes to the map in a single
     * source.setData() call.
     */
    endBatch() {
        this._batching = false;
        this._updateMapSource();
    }

    /**
     * Starts the animator. (No-op in teleport mode).
     */
    start() {
        // No animation loop is used in this model.
        console.log('MapAnimator (Teleport) started.');
    }

    /**
     * Stops the animator. (No-op in teleport mode).
     */
    stop() {
        // No animation loop to stop.
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
        const newApiLon = newPosition.lon;
        const newApiLat = newPosition.lat;

        // Regardless of 'Ground' or 'Airborne', just
        // create or update the feature in the master list.
        // This is the "teleport".
        this.currentMapFeatures[flightId] = {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [newApiLon, newApiLat]
            },
            properties: newProperties // Includes new heading, phase, etc.
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
        // Defer while batching — endBatch() will flush once at the end.
        if (this._batching) return;

        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            // If source/style isn't ready, it's fine.
            // The next update will catch it.
            return;
        }

        // This single call pushes all changes to the map at once.
        source.setData({
            type: 'FeatureCollection',
            features: Object.values(this.currentMapFeatures)
        });
    }
}