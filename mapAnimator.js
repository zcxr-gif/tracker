/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle the smooth animation of airborne flights
 * while "teleporting" ground-based flights for a Mapbox GL JS map.
 *
 * VERSION 4: Eased-Blending Precision
 * - Fixes "strafing" during turns by matching extrapolated path
 * to the interpolated heading.
 * - Uses precise Haversine-based (great-circle) interpolation
 * for the correction path.
 * - [NEW] Uses a non-linear (ease-in-out) blend to smoothly
 * transition from the correction path to the extrapolated path,
 * making sharp turns feel natural.
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
            this.currentMapFeatures[flightId] = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [newApiLon, newApiLat]
                },
                properties: newProperties
            };
            this.airborneFlightState.delete(flightId);

        } else {
            // --- 2. AIRBORNE AIRCRAFT: Animate + Extrapolate ---
            const currentFeature = this.currentMapFeatures[flightId];
            const now = performance.now();
            
            // Get the 'from' state (current rendered position)
            const fromPos = currentFeature ? currentFeature.geometry.coordinates : [newApiLon, newApiLat];
            const fromHeading = currentFeature ? currentFeature.properties.heading : newApiHeading;

            // --- [NEW] Pre-calculate the correction path's vector ---
            // This is the great-circle path from the last rendered position to the new API position.
            const { distanceKm: correctionDist, initialBearing: correctionBearing } = 
                this._getDistanceAndBearing(
                    fromPos[1], fromPos[0], // from
                    newApiLat, newApiLon    // to
                );

            let startTime = now;
            const animationDuration = Math.max(500, packetDuration);

            if (!currentFeature) {
                // This is a new flight. Force it to skip interpolation.
                startTime = now - (animationDuration + 1);
            }

            // Store the animation parameters
            this.airborneFlightState.set(flightId, {
                fromPos: fromPos,
                toPos: [newApiLon, newApiLat],
                fromHeading: fromHeading,
                toHeading: newApiHeading,
                startTime: startTime,
                duration: animationDuration,
                // --- Store data for extrapolation ---
                apiSpeedKt: newProperties.speed || 0,
                apiHeadingDeg: newApiHeading,
                // --- [NEW] Store pre-calculated correction path ---
                correctionDist: correctionDist,
                correctionBearing: correctionBearing
            });

            // Update/create the feature
            if (currentFeature) {
                this.currentMapFeatures[flightId].properties = newProperties;
            } else {
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
     * * ★★★ REVISED LOGIC (V4 - Eased Blending) ★★★
     * * 1.  Calculate the `finalHeading` by interpolating between `fromHeading` and `toHeading`.
     * 2.  Calculate `P_extrap`: The "pure" extrapolated position. This is calculated
     * from `toPos` using the *`finalHeading`*. This is the key
     * to fixing the "strafing" effect, as the extrapolated path now follows
     * the icon's rotation, creating a natural arc.
     * 3.  Calculate `P_interp`: The "correction" position. This is calculated by
     * moving `progress` % along the great-circle arc from `fromPos` to `toPos`
     * (using our pre-calculated `correctionBearing` and `correctionDist`).
     * 4.  Calculate `finalPos`: We blend `P_interp` and `P_extrap` using an
     * *ease-in-out* function instead of a linear one. This creates a
     * much smoother transition during sharp turns.
     */
    _animationLoop() {
        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            this.animationFrameId = requestAnimationFrame(this._animationLoop);
            return;
        }

        const now = performance.now();
        const KTS_TO_KMS_PER_MS = 1.852 / 3600000;

        for (const [flightId, state] of this.airborneFlightState.entries()) {
            const feature = this.currentMapFeatures[flightId];
            if (!feature) {
                this.airborneFlightState.delete(flightId);
                continue;
            }

            const timeElapsedMs = now - state.startTime;
            let progress = timeElapsedMs / state.duration;
            progress = Math.max(0.0, progress); // Clamp progress

            // --- 1. Calculate INTERPOLATED HEADING ---
            // We calculate this *first* as it's needed for the P_extrap calculation.
            let finalHeading;
            if (progress < 1.0) {
                // BLENDING: LERP the heading
                let deltaH = state.toHeading - state.fromHeading;
                if (deltaH > 180) deltaH -= 360;
                if (deltaH < -180) deltaH += 360;
                finalHeading = state.fromHeading + (deltaH * progress);
                finalHeading = (finalHeading + 360) % 360; // Normalize
            } else {
                // EXTRAPOLATING: Use the final API heading
                finalHeading = state.apiHeadingDeg;
            }

            // --- 2. Calculate PURE EXTRAPOLATED Position (P_extrap) ---
            // This is where the plane *should* be, flying from the last
            // API point (`toPos`) using the *current interpolated heading*.
            const distanceToMoveKm = (state.apiSpeedKt * KTS_TO_KMS_PER_MS) * timeElapsedMs;
            let P_extrap = { lon: state.toPos[0], lat: state.toPos[1] }; // Default

            if (distanceToMoveKm > 0) {
                P_extrap = this._getDestinationPoint(
                    state.toPos[1],       // Start from last API lat
                    state.toPos[0],       // Start from last API lon
                    finalHeading,         // ⭐️ Use the interpolated heading
                    distanceToMoveKm
                );
            }

            let finalLon, finalLat;

            if (progress < 1.0) {
                // --- 3. BLENDING (Correction towards Extrapolation) ---

                // --- 3a. Calculate 'Correction' Position (P_interp) ---
                // Use Great-Circle (Haversine) interpolation for precision.
                let P_interp_coords;
                if (state.correctionDist > 0) {
                    P_interp_coords = this._getDestinationPoint(
                        state.fromPos[1],           // Start from the *last rendered* lat
                        state.fromPos[0],           // Start from the *last rendered* lon
                        state.correctionBearing,    // Use the pre-calculated bearing
                        state.correctionDist * progress // Travel 'progress' % of the way
                    );
                } else {
                    // No distance to correct (e.g., first packet), just use the start pos.
                    P_interp_coords = { lon: state.fromPos[0], lat: state.fromPos[1] };
                }
                
                // --- 3b. FINAL Position: Blend P_interp with P_extrap ---

                // ★★★ NEW FIX ★★★
                // We apply an Ease-In-Out function to the progress.
                // This makes the blend non-linear and much smoother.
                // It ensures the "fix" is applied *very* little at the beginning
                // and end of the blend, smoothing out the "jump."
                const easeProgress = 0.5 * (1 - Math.cos(Math.PI * progress));

                // This LERP now uses the 'easeProgress' instead of the linear 'progress'.
                finalLon = P_interp_coords.lon + (P_extrap.lon - P_interp_coords.lon) * easeProgress;
                finalLat = P_interp_coords.lat + (P_extrap.lat - P_interp_coords.lat) * easeProgress;

            } else {
                // --- 4. PURE EXTRAPOLATING ---
                // Blending is complete. Use the pure extrapolated position.
                finalLon = P_extrap.lon;
                finalLat = P_extrap.lat;
            }

            // Update the feature
            feature.geometry.coordinates = [finalLon, finalLat];
            feature.properties.heading = finalHeading;
        }

        // --- 2. Update the map source with the new state of *all* features ---
        source.setData({
            type: 'FeatureCollection',
            features: Object.values(this.currentMapFeatures)
        });

        // --- 3. Request the next animation frame ---
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
    }

    /**
     * [NEW] Calculates the initial bearing and distance between two points.
     * @param {number} lat1 - Start latitude
     * @param {number} lon1 - Start longitude
     * @param {number} lat2 - End latitude
     * @param {number} lon2 - End longitude
     * @returns {{distanceKm: number, initialBearing: number}}
     * @private
     */
    _getDistanceAndBearing(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const toRad = (deg) => (deg * Math.PI) / 180;
        const toDeg = (rad) => (rad * 180) / Math.PI;

        const lat1Rad = toRad(lat1);
        const lon1Rad = toRad(lon1);
        const lat2Rad = toRad(lat2);
        const lon2Rad = toRad(lon2);

        const deltaLon = lon2Rad - lon1Rad;

        // Distance (Haversine)
        const a = Math.sin((lat2Rad - lat1Rad) / 2) ** 2 +
                  Math.cos(lat1Rad) * Math.cos(lat2Rad) *
                  Math.sin(deltaLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distanceKm = R * c;

        // Handle case where points are identical
        if (distanceKm === 0) {
            return { distanceKm: 0, initialBearing: 0 };
        }

        // Initial Bearing
        const y = Math.sin(deltaLon) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
                  Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLon);
        let initialBearing = toDeg(Math.atan2(y, x));
        initialBearing = (initialBearing + 360) % 360; // Normalize to 0-360

        return { distanceKm, initialBearing };
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