/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle updating flight positions on a Mapbox GL JS map.
 *
 * --- [Interpolation Model] ---
 *
 * This model provides smooth animation using linear interpolation.
 *
 * It maintains an internal "state" for each flight, including its
 * current animated position and its target position (from the API).
 *
 * A `requestAnimationFrame` loop runs ~60fps to move the "current"
 * position slightly closer to the "target" position on each frame,
 * resulting in smooth movement.
 * ===================================================================
 */

/**
 * Main manager for the Mapbox map.
 * Animates features by interpolating them towards a target state.
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
        
        /**
         * @private
         * Stores the animation state for all flights.
         * Key: flightId
         * Value: {
         * currentLon, currentLat, currentHeading,
         * targetLon, targetLat, targetHeading,
         * lastUpdateTimestamp,
         * properties
         * }
         */
        this.flightStates = new Map();
        
        this.animationFrameId = null;
        this.isAnimating = false;
        
        // Tunable animation parameter.
        // 0.1 = Slower, smoother (more "laggy")
        // 0.5 = Faster, more responsive (more "snappy")
        this.INTERPOLATION_FACTOR = 0.2; 
    }

    /**
     * Starts the animation loop.
     */
    start() {
        if (this.isAnimating) return;
        this.isAnimating = true;
        console.log('MapAnimator (Interpolation) started.');
        
        // Bind the loop to `this` and start it
        this._animationLoop = this._animationLoop.bind(this);
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
    }

    /**
     * Stops the animation loop.
     */
    stop() {
        if (!this.isAnimating) return;
        this.isAnimating = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        this.animationFrameId = null;
        console.log('MapAnimator (Interpolation) stopped.');
    }

    /**
     * Updates a flight's *target* state.
     * This is called by your Socket.IO receiver. It does NOT
     * update the map directly.
     *
     * @param {object} newPosition - {lon, lat, heading_deg, lastReportMs}
     * @param {object} newProperties - The full properties object (the flight).
     */
    updateFlight(newPosition, newProperties) {
        const flightId = newProperties.flightId;
        
        // --- [TIMESTAMP GUARD] ---
        // We get the timestamp from the position object,
        // which your server.js 'simplifyFlight' function puts there.
        const newTimestamp = newPosition.lastReportMs;
        if (!newTimestamp) {
            console.warn(`Ignoring update for ${flightId}: missing 'lastReportMs'`);
            return; // No timestamp, can't animate
        }

        const state = this.flightStates.get(flightId);

        if (state) {
            // --- Existing Flight: Check Timestamp ---
            
            // The Guard Clause:
            // If the new data is older than (or equal to) the current data,
            // stop right here. Do not process this "old" packet.
            if (newTimestamp <= state.lastUpdateTimestamp) {
                // console.warn(`Ignoring out-of-order data for ${flightId}`);
                return; // Do nothing
            }
            
            // --- Valid Update: Update Target ---
            state.targetLon = newPosition.lon;
            state.targetLat = newPosition.lat;
            state.targetHeading = newPosition.heading_deg;
            state.lastUpdateTimestamp = newTimestamp;
            state.properties = newProperties; // Store the latest full properties
            
        } else {
            // --- New Flight: Create State ---
            // It "pops" in. Current and Target are the same.
            this.flightStates.set(flightId, {
                currentLon: newPosition.lon,
                currentLat: newPosition.lat,
                currentHeading: newPosition.heading_deg,
                
                targetLon: newPosition.lon,
                targetLat: newPosition.lat,
                targetHeading: newPosition.heading_deg,
                
                lastUpdateTimestamp: newTimestamp,
                properties: newProperties
            });
            
            // Also add it to the shared map features so it appears
            this.currentMapFeatures[flightId] = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [newPosition.lon, newPosition.lat]
                },
                properties: {
                    ...newProperties,
                    heading: newPosition.heading_deg // Ensure heading is in properties for Mapbox
                }
            };
        }
    }

    /**
     * Removes a flight from the map and the animator.
     * @param {string} flightId 
     */
    removeFlight(flightId) {
        // Delete from our internal animator state
        this.flightStates.delete(flightId);
        
        // Delete from the shared map state (this is the reference)
        delete this.currentMapFeatures[flightId];
        
        // The map will be updated on the next animation loop,
        // which will see the feature is gone.
    }
    
    /**
     * @private
     * The main animation loop (runs ~60fps).
     */
    _animationLoop() {
        if (!this.isAnimating) return;

        let needsMapUpdate = false;

        // Iterate over all flights we are tracking
        for (const [flightId, state] of this.flightStates.entries()) {
            
            // --- 1. Interpolate Values ---
            state.currentLon = lerp(state.currentLon, state.targetLon, this.INTERPOLATION_FACTOR);
            state.currentLat = lerp(state.currentLat, state.targetLat, this.INTERPOLATION_FACTOR);
            state.currentHeading = lerpAngle(state.currentHeading, state.targetHeading, this.INTERPOLATION_FACTOR);
            
            // --- 2. Update the Shared Feature Object ---
            // This is the object the map source is pointing to.
            // We mutate it directly.
            const feature = this.currentMapFeatures[flightId];
            
            if (feature) {
                // Update geometry
                feature.geometry.coordinates = [state.currentLon, state.currentLat];
                
                // Update properties (most importantly, heading for rotation)
                // We also re-assign all properties to keep data fresh.
                Object.assign(feature.properties, state.properties);
                feature.properties.heading = state.currentHeading;

                needsMapUpdate = true;
            }
            // (If no feature, it was a new flight and was created in updateFlight)
        }

        // --- 3. Update the Map Source (if anything changed) ---
        if (needsMapUpdate) {
            this._updateMapSource();
        }

        // --- 4. Request the next frame ---
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
    }

    /**
     * @private
     * Pushes the current state of *all* features to the map source.
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


// =========================
// Helper Functions
// =========================

/**
 * Linear interpolation (Lerp).
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0.0 to 1.0)
 * @returns {number}
 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Interpolates an angle, correctly handling the 360 -> 0 degree wrap.
 * @param {number} a - Start angle (degrees)
 * @param {number} b - End angle (degrees)
 * @param {number} t - Interpolation factor (0.0 to 1.0)
 * @returns {number}
 */
function lerpAngle(a, b, t) {
    let diff = b - a;
    
    // Find the shortest path (e.g., 350 -> 10 should be +20, not -340)
    if (diff > 180) {
        diff -= 360; // Wrap backward
    } else if (diff < -180) {
        diff += 360; // Wrap forward
    }
    
    let newAngle = a + diff * t;
    
    // Keep the result between 0 and 360
    return (newAngle + 360) % 360;
}