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

            // ⬇️ 1. --- FIX: Jump straight to extrapolation for new flights ---
            let startTime = now;
            const animationDuration = Math.max(500, packetDuration);

            if (!currentFeature) {
                // This is a new flight.
                // Force it to skip interpolation and go straight to extrapolation.
                // Set startTime to the past so (now - startTime) / duration is > 1.
                startTime = now - (animationDuration + 1);
            }
            // ⬆️ --- END OF FIX 1 ---

            // Store the animation parameters
            this.airborneFlightState.set(flightId, {
                fromPos: fromPos,
                toPos: [newApiLon, newApiLat],
                fromHeading: fromHeading,
                toHeading: newApiHeading,
                startTime: startTime, // Use the (potentially modified) startTime
                duration: animationDuration,
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
     * * FIX: Replaced the two-phase (Interpolation then Extrapolation) logic 
     * with a blended logic. This calculates the pure extrapolated position (P_extrap) 
     * and smoothly transitions the rendered position from the correction path (P_interp) 
     * towards P_extrap over the animation duration.
     */
    _animationLoop() {
        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            // Map isn't ready, try again next frame
            this.animationFrameId = requestAnimationFrame(this._animationLoop);
            return;
        }

        const now = performance.now();
        
        // Constant conversion factor for speed (knots) to distance (km) per millisecond
        // 1 knot = 1.852 km/h. Factor = (1.852 km/h per knot) / (3,600,000 ms/h)
        const KTS_TO_KMS_PER_MS = 1.852 / 3600000;

        // --- 1. Animate airborne flights ---
        for (const [flightId, state] of this.airborneFlightState.entries()) {
            const feature = this.currentMapFeatures[flightId];
            if (!feature) {
                this.airborneFlightState.delete(flightId);
                continue;
            }

            // Time elapsed since the new API packet arrived (and the animation started)
            const timeElapsedMs = now - state.startTime;
            
            // Calculate progress of the correction blend (0.0 to 1.0)
            const progress = timeElapsedMs / state.duration;

            // --- A. Calculate the PURE EXTRAPOLATED Position (P_extrap) ---
            // This is the position the plane *should* be if it moved constantly 
            // from the last API point (state.toPos) with the last API vector.
            const distanceToMoveKm = (state.apiSpeedKt * KTS_TO_KMS_PER_MS) * timeElapsedMs;
            
            let P_extrap = { lon: state.toPos[0], lat: state.toPos[1] }; // Default to last API pos

            // Only extrapolate if there is movement
            if (distanceToMoveKm > 0) {
                P_extrap = this._getDestinationPoint(
                    state.toPos[1],       // Start from last API lat (P_api,prev)
                    state.toPos[0],       // Start from last API lon (P_api,prev)
                    state.apiHeadingDeg,  // Use last API heading
                    distanceToMoveKm      // Total distance from P_api,prev
                );
            }


            let finalLon, finalLat, finalHeading;

            if (progress < 1.0) {
                // --- I. BLENDING (Correction towards Extrapolation) ---
                // We are in the blending window. The rendered position transitions 
                // from the last rendered point (state.fromPos) to the PURE EXTRAPOLATED 
                // position (P_extrap). This ensures continuous forward movement.

                // 1. Position Interpolation (P_interp): The 'Correction' LERP.
                //    This moves from the last rendered position (state.fromPos) to 
                //    the new API position (state.toPos).
                const interpLon = state.fromPos[0] + (state.toPos[0] - state.fromPos[0]) * progress;
                const interpLat = state.fromPos[1] + (state.toPos[1] - state.fromPos[1]) * progress;
                
                // 2. FINAL Position: Blend P_interp with P_extrap.
                // At progress=0, use P_interp (full correction).
                // As progress -> 1, the weight shifts to P_extrap (full projection).
                finalLon = interpLon + (P_extrap.lon - interpLon) * progress;
                finalLat = interpLat + (P_extrap.lat - interpLat) * progress;

                // 3. Heading LERP: Transition the displayed heading
                let deltaH = state.toHeading - state.fromHeading;
                if (deltaH > 180) deltaH -= 360;
                if (deltaH < -180) deltaH += 360;
                finalHeading = state.fromHeading + (deltaH * progress);
            
            } else {
                // --- II. PURE EXTRAPOLATING ---
                // Blending is complete. Use the pure extrapolated position and heading.
                finalLon = P_extrap.lon;
                finalLat = P_extrap.lat;
                finalHeading = state.apiHeadingDeg;
            }

            // Update the feature
            feature.geometry.coordinates = [finalLon, finalLat];
            feature.properties.heading = finalHeading;
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