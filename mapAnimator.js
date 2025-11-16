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

            // --- Capture the LAST RENDERED POSITION for smoother transition ---
            // If the flight state exists, its 'lastRenderedPos' is the *actual* // animated position from the last frame. Use that as the starting point.
            const lastRenderedPos = this.airborneFlightState.get(flightId)?.lastRenderedPos || fromPos;

            // Force it to skip interpolation for new flights
            let startTime = now;
            const animationDuration = Math.max(500, packetDuration);

            if (!currentFeature) {
                // This is a new flight.
                startTime = now - (animationDuration + 1);
            }
            // ⬆️ --- END OF FIX 1 ---

            // Store the animation parameters
            this.airborneFlightState.set(flightId, {
                // fromPos is now the position where the blending starts from (last API position if new flight)
                fromPos: lastRenderedPos, // Start the correction from the last *rendered* position
                toPos: [newApiLon, newApiLat],
                fromHeading: fromHeading,
                toHeading: newApiHeading,
                startTime: startTime,
                duration: animationDuration,
                // --- [NEW] Store data for extrapolation ---
                apiSpeedKt: newProperties.speed || 0,
                apiHeadingDeg: newApiHeading,
                // New: This will be updated in the loop to store the position for the next packet
                lastRenderedPos: lastRenderedPos 
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
     * * FIX: Modified the logic to ensure a smoother, more gradual correction
     * by using the blend progress to control the speed of the correction
     * towards the extrapolated position, thus preventing a jump.
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
            const progress = Math.min(1.0, timeElapsedMs / state.duration); // Clamp to 1.0

            // --- A. Calculate the PURE EXTRAPOLATED Position (P_extrap) ---
            // This is the position the plane *should* be if it moved constantly 
            // from the last API point (state.toPos) with the last API vector.
            const totalExtrapDistanceKm = (state.apiSpeedKt * KTS_TO_KMS_PER_MS) * timeElapsedMs;
            
            let P_extrap = { lon: state.toPos[0], lat: state.toPos[1] }; // Default to last API pos

            // Only extrapolate if there is movement
            if (totalExtrapDistanceKm > 0) {
                P_extrap = this._getDestinationPoint(
                    state.toPos[1],       // Start from last API lat (P_api,prev)
                    state.toPos[0],       // Start from last API lon (P_api,prev)
                    state.apiHeadingDeg,  // Use last API heading
                    totalExtrapDistanceKm // Total distance from P_api,prev
                );
            }

            let finalLon, finalLat, finalHeading;

            // --- NEW: Correction by Exponential Smoothing ---
            // We use the 'progress' (which goes from 0 to 1 over the duration) 
            // as the linear interpolation factor to *slowly* move the 
            // current rendered position (state.lastRenderedPos) towards 
            // the purely extrapolated position (P_extrap).
            
            // NOTE: state.fromPos is the last *rendered* position from the previous packet.
            // P_extrap is the position based on the new API packet and extrapolation.
            
            // Calculate the total required correction vector: P_extrap - state.fromPos.
            const correctionLon = P_extrap.lon - state.fromPos[0];
            const correctionLat = P_extrap.lat - state.fromPos[1];
            
            // Apply a fraction of the total correction based on the blend 'progress'.
            // This ensures the correction is spread evenly over the entire duration.
            finalLon = state.fromPos[0] + (correctionLon * progress);
            finalLat = state.fromPos[1] + (correctionLat * progress);
            
            // If the blend is complete (progress=1), or if we are past the blend window
            if (progress >= 1.0) {
                // If past the blend window, the position is already the extrapolated position (P_extrap)
                // for this frame (as progress is clamped to 1).
                finalHeading = state.apiHeadingDeg;
            } else {
                // Heading LERP: Transition the displayed heading
                let deltaH = state.toHeading - state.fromHeading;
                if (deltaH > 180) deltaH -= 360;
                if (deltaH < -180) deltaH += 360;
                finalHeading = state.fromHeading + (deltaH * progress);
            }
            
            // --- Crucial step: Store the *new* rendered position for the next frame's correction ---
            state.lastRenderedPos = [finalLon, finalLat];


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