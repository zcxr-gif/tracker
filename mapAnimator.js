/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle the smooth animation of airborne flights
 * while "teleporting" ground-based flights for a Mapbox GL JS map.
 *
 * VERSION 2: Now includes dead reckoning (extrapolation) to
 * smoothly project aircraft movement between server updates,
 * preventing the "freeze" effect.
 * ===================================================================
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
        this.airborneFlightState = new Map();     // Stores animation state for airborne flights
        this.animationFrameId = null;

        // Bind the animation loop to the class instance
        this._animationLoop = this._animationLoop.bind(this);
    }

    /**
     * Starts the animation loop.
     */
    start() {
        this.stop(); // Ensure no duplicates
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
        console.log('MapAnimator started.');
    }

    /**
     * Stops the animation loop and clears the animation state.
     */
    stop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        this.airborneFlightState.clear();
        console.log('MapAnimator stopped.');
    }

    /**
     * Updates or creates a flight's state based on new data.
     * This is the main "intake" method.
     * @param {Object} newPosition - The 'position' object from the flight data.
     * @param {Object} newProperties - The full 'properties' object for the map feature.
     * @param {number} packetDuration - The time (ms) since the last server packet.
     */
    updateFlight(newPosition, newProperties, packetDuration) {
        const flightId = newProperties.flightId;
        const newApiLon = newPosition.lon;
        const newApiLat = newPosition.lat;
        const newApiHeading = newPosition.heading_deg || 0;

        // --- HYBRID LOGIC ---
        if (newProperties.phase === 'Ground') {
            // --- 1. GROUND AIRCRAFT: Teleport ---
            // Update the master feature object directly. The loop will render it.
            this.currentMapFeatures[flightId] = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [newApiLon, newApiLat]
                },
                properties: newProperties
            };
            // If it was animating (e.g., just landed), stop it.
            this.airborneFlightState.delete(flightId);

        } else {
            // --- 2. AIRBORNE AIRCRAFT: Animate + Extrapolate ---
            const currentFeature = this.currentMapFeatures[flightId];
            const now = performance.now();
            
            // Get the 'from' state (current rendered position)
            // If this is the first packet, 'from' and 'to' are the same.
            const fromPos = currentFeature ? currentFeature.geometry.coordinates : [newApiLon, newApiLat];
            const fromHeading = currentFeature ? currentFeature.properties.heading : newApiHeading;

            // Store the animation parameters
            this.airborneFlightState.set(flightId, {
                fromPos: fromPos,
                toPos: [newApiLon, newApiLat],
                fromHeading: fromHeading,
                toHeading: newApiHeading,
                startTime: now,
                duration: Math.max(500, packetDuration),
                // --- [NEW] Store data for extrapolation ---
                apiSpeedKt: newProperties.speed || 0,
                apiHeadingDeg: newApiHeading
            });

            // Update the feature's properties (callsign, etc.)
            // but *not* its geometry (the loop will do that).
            if (currentFeature) {
                this.currentMapFeatures[flightId].properties = newProperties;
            } else {
                // First time seeing this (airborne). Create it at its start position.
                this.currentMapFeatures[flightId] = {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: fromPos },
                    properties: newProperties
                };
            }
        }
    }

    /**
     * Removes a flight from the map and animation state.
     * @param {string} flightId 
     */
    removeFlight(flightId) {
        delete this.currentMapFeatures[flightId];
        this.airborneFlightState.delete(flightId);
    }

    /**
     * The core animation loop (runs every frame).
     * @private
     */
    _animationLoop() {
        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            // Map isn't ready, try again next frame
            this.animationFrameId = requestAnimationFrame(this._animationLoop);
            return;
        }

        const now = performance.now();
        
        // --- 1. Animate airborne flights ---
        for (const [flightId, state] of this.airborneFlightState.entries()) {
            const feature = this.currentMapFeatures[flightId];
            if (!feature) {
                this.airborneFlightState.delete(flightId);
                continue;
            }

            // Calculate progress of the "gentle fix" interpolation
            const progress = (now - state.startTime) / state.duration;

            if (progress < 1.0) {
                // --- A. INTERPOLATING ("Gentle Fix") ---
                // We are in the animation window, correcting from the last
                // rendered position to the new API position.

                // Linear Interpolation (LERP) for position
                const newLon = state.fromPos[0] + (state.toPos[0] - state.fromPos[0]) * progress;
                const newLat = state.fromPos[1] + (state.toPos[1] - state.fromPos[1]) * progress;
                
                // LERP for heading (with wrap-around logic)
                let deltaH = state.toHeading - state.fromHeading;
                if (deltaH > 180) deltaH -= 360;
                if (deltaH < -180) deltaH += 360;
                const newHeading = state.fromHeading + (deltaH * progress);

                // Update the feature in the main state object
                feature.geometry.coordinates = [newLon, newLat];
                feature.properties.heading = newHeading;
            
            } else {
                // --- B. EXTRAPOLATING (Dead Reckoning) ---
                // The "gentle fix" animation is complete.
                // Now, we project the plane forward from its last *API position*
                // using its last known speed and heading.

                // How long has it been since the animation *ended*?
                const timeSinceAnimEndMs = now - (state.startTime + state.duration);
                
                // Convert speed (knots) to kilometers per millisecond
                // 1 knot = 1.852 km/h
                // km/h -> km/ms = / 3,600,000
                const ktsToKmsPerMs = (state.apiSpeedKt * 1.852) / 3600000;
                
                // Calculate distance to move *from the target position*
                const distanceToMoveKm = ktsToKmsPerMs * timeSinceAnimEndMs;

                if (distanceToMoveKm > 0 && state.apiSpeedKt > 30) {
                    // Calculate the new extrapolated position
                    const extrapolatedPos = this._getDestinationPoint(
                        state.toPos[1],       // Start from last API lat
                        state.toPos[0],       // Start from last API lon
                        state.apiHeadingDeg,  // Use last API heading
                        distanceToMoveKm
                    );

                    feature.geometry.coordinates = [extrapolatedPos.lon, extrapolatedPos.lat];
                } else {
                    // Not moving (or 0 speed), just stay at the target position
                    feature.geometry.coordinates = state.toPos;
                }

                // Heading remains constant during extrapolation
                feature.properties.heading = state.apiHeadingDeg;
            }
        }

        // --- 2. Update the map source with the new state of *all* features ---
        // This single call renders *both* the teleported ground planes
        // and the smoothly animated/extrapolated airborne planes.
        source.setData({
            type: 'FeatureCollection',
            features: Object.values(this.currentMapFeatures)
        });

        // --- 3. Request the next animation frame ---
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
    }

    /**
     * Calculates the destination point given a starting point, bearing, and distance.
     * Uses the Haversine formula.
     * @param {number} lat - Starting latitude in degrees.
     * @param {number} lon - Starting longitude in degrees.
     * @param {number} bearing - Bearing in degrees (0-360).
     * @param {number} distanceKm - Distance to travel in kilometers.
     * @returns {{lat: number, lon: number}} The destination point.
     * @private
     */
    _getDestinationPoint(lat, lon, bearing, distanceKm) {
        const R = 6371; // Earth's radius in km
        const toRad = (deg) => (deg * Math.PI) / 180;
        const toDeg = (rad) => (rad * 180) / Math.PI;

        const latRad = toRad(lat);
        const lonRad = toRad(lon);
        const bearingRad = toRad(bearing);

        const angularDistance = distanceKm / R;

        const destLatRad = Math.asin(
            Math.sin(latRad) * Math.cos(angularDistance) +
            Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
        );

        let destLonRad = lonRad + Math.atan2(
            Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
            Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(destLatRad)
        );

        // Normalize longitude to -180 to +180
        destLonRad = (destLonRad + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

        return { lat: toDeg(destLatRad), lon: toDeg(destLonRad) };
    }
}