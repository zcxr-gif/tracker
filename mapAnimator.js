/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle updating flight positions on a Mapbox GL JS map.
 *
 * --- [Extrapolation / Reconciliation Model] ---
 *
 * This model provides smooth animation by combining two techniques:
 *
 * 1. Extrapolation (Prediction):
 * The animation loop moves the plane forward at ~60fps based
 * on its last known speed and smoothly interpolated heading.
 *
 * 2. Reconciliation (Correction):
 * The loop also *gently nudges* the plane's animated position
 * towards its *true* server-reported position.
 *
 * This eliminates "snapping" and "jitter" by *never*
 * instantly resetting the plane's position. It smoothly
 * corrects any drift between the prediction and the server's data.
 * ===================================================================
 */

// Earth's radius in Nautical Miles
const EARTH_RADIUS_NM = 3440.065;

/**
 * Main manager for the Mapbox map.
 * Animates features by extrapolating and reconciling their position.
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
         * currentLon, currentLat, currentHeading, // The animated values
         * targetLon, targetLat, targetHeading,    // The *true* server values
         * targetSpeedKts,
         * lastUpdateTimestamp,
         * properties
         * }
         */
        this.flightStates = new Map();
        
        this.animationFrameId = null;
        this.isAnimating = false;
        this.lastFrameTimestamp = null; // For calculating deltaT
        
        // --- Tunable Parameters ---

        // For turns (heading). Lower = Slower, "heavier" turns.
        this.HEADING_INTERPOLATION_FACTOR = 0.05; 
        
        // For position (reconciliation). Lower = Smoother, but more drift.
        // Keep this low to prevent any jitter.
        this.POSITION_INTERPOLATION_FACTOR = 0.05; 
    }

    /**
     * Starts the animation loop.
     */
    start() {
        if (this.isAnimating) return;
        this.isAnimating = true;
        this.lastFrameTimestamp = null; // Reset timestamp on start
        console.log('MapAnimator (Extrapolation/Reconciliation) started.');
        
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
        console.log('MapAnimator (Extrapolation/Reconciliation) stopped.');
    }

    /**
     * Updates a flight's *target* state.
     * This is called by your Socket.IO receiver.
     *
     * @param {object} newPosition - {lon, lat, heading_deg, lastReportMs}
     * @param {object} newProperties - The full properties object (the flight).
     */
    updateFlight(newPosition, newProperties) {
        const flightId = newProperties.flightId;
        
        // --- [TIMESTAMP GUARD] ---
        const newTimestamp = newPosition.lastReportMs;
        if (!newTimestamp) {
            console.warn(`Ignoring update for ${flightId}: missing 'lastReportMs'`);
            return;
        }

        const state = this.flightStates.get(flightId);

        // We assume 'speed_kts' is present and in knots, as confirmed.
        const speed = newProperties.speed_kts || 0;

        if (state) {
            // --- Existing Flight: Check Timestamp ---
            if (newTimestamp <= state.lastUpdateTimestamp) {
                // console.warn(`Ignoring out-of-order data for ${flightId}`);
                return; // Ignore old/out-of-order packet
            }
            
            // --- [FIX: UPDATE TARGETS, DO NOT SNAP] ---
            // We ONLY update the *target* (server) values.
            // DO NOT snap state.currentLon / state.currentLat.
            // The animation loop will smoothly reconcile the position.
            state.targetLon = newPosition.lon;
            state.targetLat = newPosition.lat;
            state.targetHeading = newPosition.heading_deg;
            state.targetSpeedKts = speed;
            
            state.lastUpdateTimestamp = newTimestamp;
            state.properties = newProperties; // Store the latest full properties
            
        } else {
            // --- New Flight: Create State ---
            // Animated and Target positions are identical on creation.
            this.flightStates.set(flightId, {
                currentLon: newPosition.lon, // Animated position
                currentLat: newPosition.lat, // Animated position
                currentHeading: newPosition.heading_deg, // Animated heading
                
                targetLon: newPosition.lon, // Server position
                targetLat: newPosition.lat, // Server position
                targetHeading: newPosition.heading_deg, // Server heading
                targetSpeedKts: speed,
                
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
        this.flightStates.delete(flightId);
        delete this.currentMapFeatures[flightId];
    }
    
    /**
     * @private
     * The main animation loop (runs ~60fps).
     * @param {number} timestamp - DOMHighResTimeStamp from requestAnimationFrame
     */
    _animationLoop(timestamp) {
        if (!this.isAnimating) return;

        // --- [Cap deltaT] ---
        if (!this.lastFrameTimestamp) {
            this.lastFrameTimestamp = timestamp;
            this.animationFrameId = requestAnimationFrame(this._animationLoop);
            return;
        }
        let deltaT_seconds = (timestamp - this.lastFrameTimestamp) / 1000.0;
        this.lastFrameTimestamp = timestamp;

        // Cap deltaT to prevent massive jumps if the loop pauses (e.g., tab switch)
        // 0.067s is ~15fps. The plane will slow down rather than jump.
        if (deltaT_seconds > 0.067) {
            deltaT_seconds = 0.067;
        }
        // --- [END Cap] ---


        let needsMapUpdate = false;

        // Iterate over all flights we are tracking
        for (const [flightId, state] of this.flightStates.entries()) {
            
            const feature = this.currentMapFeatures[flightId];
            if (!feature) continue; // Should not happen, but safe to check

            const speedKts = state.targetSpeedKts;

            // --- 1. Interpolate Heading ---
            // This creates the smooth, realistic turning motion.
            state.currentHeading = lerpAngle(state.currentHeading, state.targetHeading, this.HEADING_INTERPOLATION_FACTOR);

            // --- 2. [Extrapolate AND Reconcile Position] ---
            
            // Part A: Extrapolation (Prediction)
            // Move the plane forward based on its *current* heading and *target* speed.
            if (speedKts > 0.1) {
                // Calculate distance to move this frame (in nautical miles)
                // (speed_knots * (deltaT_seconds / 3600.0))
                const distanceNm = (speedKts * deltaT_seconds) / 3600.0;
                
                // Calculate the new position based on the *animated* state
                const { lon, lat } = getDestinationPoint(
                    state.currentLon,
                    state.currentLat,
                    state.currentHeading, // Use the *animated* heading
                    distanceNm
                );
                
                // Update the state's animated position
                state.currentLon = lon;
                state.currentLat = lat;
            }
            
            // Part B: Reconciliation (Correction)
            // Gently "pull" the animated position towards the *true* server position.
            // This prevents drift and corrects extrapolation errors *without* snapping.
            state.currentLon = lerp(state.currentLon, state.targetLon, this.POSITION_INTERPOLATION_FACTOR);
            state.currentLat = lerp(state.currentLat, state.targetLat, this.POSITION_INTERPOLATION_FACTOR);
            // --- [END Extrapolate/Reconcile] ---


            // --- 3. Update the Shared Feature Object ---
            // We update this *every* frame to reflect new heading or position
            feature.geometry.coordinates = [state.currentLon, state.currentLat];
            
            // Re-assign all properties to keep data fresh (e.g., altitude)
            Object.assign(feature.properties, state.properties);
            
            // CRITICAL: Update the 'heading' property for Mapbox to rotate the icon
            feature.properties.heading = state.currentHeading;

            needsMapUpdate = true;
        }

        // --- 4. Update the Map Source (if anything changed) ---
        if (needsMapUpdate) {
            this._updateMapSource();
        }

        // --- 5. Request the next frame ---
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
 * Added a simple Linear Interpolation function for position.
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0.0 to 1.0)
 * @returns {number}
 */
function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * Converts degrees to radians.
 * @param {number} degrees
 * @returns {number}
 */
function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * Converts radians to degrees.
 * @param {number} radians
 * @returns {number}
 */
function toDegrees(radians) {
    // [FIX] This was the bug. It is now corrected.
    return radians * (180 / Math.PI);
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

/**
 * Calculates a new lat/lon coordinate given a starting point,
 * bearing (heading), and distance.
 * @param {number} lon - Starting longitude
 * @param {number} lat - Starting latitude
 * @param {number} bearing - Bearing (heading) in degrees
 * @param {number} distanceNm - Distance in nautical miles
 * @returns {{lon: number, lat: number}}
 */
function getDestinationPoint(lon, lat, bearing, distanceNm) {
    const latRad = toRadians(lat);
    const lonRad = toRadians(lon);
    const bearingRad = toRadians(bearing);
    const angularDistance = distanceNm / EARTH_RADIUS_NM;

    const lat2Rad = Math.asin(
        Math.sin(latRad) * Math.cos(angularDistance) +
        Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
    );

    const lon2Rad = lonRad + Math.atan2(
        Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(lat2Rad)
    );

    return {
        lat: toDegrees(lat2Rad),
        lon: toDegrees(lon2Rad)
    };
}