/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle updating flight positions on a Mapbox GL JS map.
 *
 * --- [Extrapolation / Dead Reckoning Model] ---
 *
 * This model provides smooth, realistic animation by extrapolating
 * a flight's position based on its last known speed and heading.
 *
 * It "dead reckons" the plane's position between server updates.
 *
 * - The animation loop runs at ~60fps.
 * - On each frame, it moves the plane forward based on its current
 * speed and heading.
 * - The plane's HEADING is smoothly interpolated (using lerpAngle)
 * to create realistic, banking turns.
 * - The plane's POSITION is extrapolated, not interpolated. This
 * prevents "sliding" and ensures the plane only moves in the
 * direction it is facing.
 * ===================================================================
 */

// Earth's radius in Nautical Miles
const EARTH_RADIUS_NM = 3440.065;

/**
 * Main manager for the Mapbox map.
 * Animates features by extrapolating their position.
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
         * targetHeading, targetSpeedKts,         // The target values from the server
         * lastUpdateTimestamp,
         * properties
         * }
         */
        this.flightStates = new Map();
        
        this.animationFrameId = null;
        this.isAnimating = false;
        this.lastFrameTimestamp = null; // For calculating deltaT
        
        // Tunable animation parameter for TURNS.
        // Lower = Slower, more "heavy" turns
        // Higher = Faster, "snappier" turns
        this.INTERPOLATION_FACTOR = 0.1; 
    }

    /**
     * Starts the animation loop.
     */
    start() {
        if (this.isAnimating) return;
        this.isAnimating = true;
        this.lastFrameTimestamp = null; // Reset timestamp on start
        console.log('MapAnimator (Extrapolation) started.');
        
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
        console.log('MapAnimator (Extrapolation) stopped.');
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

        // --- [!! IMPORTANT !!] ---
        // This model REQUIRES speed in knots.
        // Change 'speed_kts' if your property is named differently (e.g., 'groundSpeed_kts')
        const speed = newProperties.speed_kts || 0;
        // --- [!! /IMPORTANT !!] ---

        if (state) {
            // --- Existing Flight: Check Timestamp ---
            if (newTimestamp <= state.lastUpdateTimestamp) {
                // console.warn(`Ignoring out-of-order data for ${flightId}`);
                return; // Ignore old/out-of-order packet
            }
            
            // --- Valid Update: "Snap" Position and Update Targets ---
            // We "snap" the current position to the new data to prevent drift.
            state.currentLon = newPosition.lon;
            state.currentLat = newPosition.lat;
            
            // We update the TARGETS for heading and speed.
            // The animation loop will smoothly interpolate towards these.
            state.targetHeading = newPosition.heading_deg;
            state.targetSpeedKts = speed;
            
            state.lastUpdateTimestamp = newTimestamp;
            state.properties = newProperties; // Store the latest full properties
            
        } else {
            // --- New Flight: Create State ---
            // The plane "pops" into existence.
            this.flightStates.set(flightId, {
                currentLon: newPosition.lon,
                currentLat: newPosition.lat,
                currentHeading: newPosition.heading_deg, // Start facing the correct way
                
                targetHeading: newPosition.heading_deg,
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

        // Calculate deltaT (time since last frame) in seconds
        if (!this.lastFrameTimestamp) {
            this.lastFrameTimestamp = timestamp;
            this.animationFrameId = requestAnimationFrame(this._animationLoop);
            return;
        }
        const deltaT_seconds = (timestamp - this.lastFrameTimestamp) / 1000.0;
        this.lastFrameTimestamp = timestamp;

        let needsMapUpdate = false;

        // Iterate over all flights we are tracking
        for (const [flightId, state] of this.flightStates.entries()) {
            
            const feature = this.currentMapFeatures[flightId];
            if (!feature) continue; // Should not happen, but safe to check

            const speedKts = state.targetSpeedKts;

            // --- 1. Interpolate Heading ---
            // This creates the smooth, realistic turning motion.
            state.currentHeading = lerpAngle(state.currentHeading, state.targetHeading, this.INTERPOLATION_FACTOR);

            // --- 2. Extrapolate Position ---
            // Only move the plane if its speed is greater than a small threshold.
            if (speedKts > 0.1) {
                // Calculate distance to move this frame (in nautical miles)
                const distanceNm = (speedKts * deltaT_seconds) / 3600.0;
                
                // Calculate the new position
                const { lon, lat } = getDestinationPoint(
                    state.currentLon,
                    state.currentLat,
                    state.currentHeading,
                    distanceNm
                );
                
                // Update the state's animated position
                state.currentLon = lon;
                state.currentLat = lat;
            }
            
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