/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle the smooth animation of airborne flights
 * while "teleporting" ground-based flights for a Mapbox GL JS map.
 *
 * VERSION 4: Constant-Time Interpolation
 * - Implements a "chaser" model for maximum perceptual smoothness.
 * - Decouples animation time from server packet duration.
 * - All airborne animations take a fixed `INTERP_DURATION_MS`.
 * - When new data arrives, a new animation starts from the
 * *current rendered position*, creating a smooth, continuous
 * "chase" to the new target.
 * - This model *removes the need for extrapolation* and the
 * complex blending logic from v3.
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
        this.airborneFlightState = new Map();     // Stores animation state
        this.animationFrameId = null;

        /**
         * [NEW] The fixed duration for all animations (in ms).
         * This is the "magic number" for smoothness. 1500ms is a good
         * starting point, but you can tune it.
         */
        this.INTERP_DURATION_MS = 1500;

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
     * [REVISED] Updates or creates a flight's state.
     * This function no longer uses `packetDuration`.
     *
     * @param {Object} newPosition - The 'position' object from the flight data.
     * @param {Object} newProperties - The full 'properties' object for the map feature.
     */
    updateFlight(newPosition, newProperties) {
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
            // --- 2. AIRBORNE AIRCRAFT: Animate ---
            const currentFeature = this.currentMapFeatures[flightId];
            const now = performance.now();
            
            // Get the 'from' state (current *rendered* position)
            const fromPos = currentFeature ? 
                currentFeature.geometry.coordinates : 
                [newApiLon, newApiLat];
            
            const fromHeading = currentFeature ? 
                currentFeature.properties.heading : 
                newApiHeading;

            // [REVISED] Calculate the correction path from the
            // *current rendered position* to the new API target.
            const { distanceKm, initialBearing } = 
                this._getDistanceAndBearing(
                    fromPos[1], fromPos[0], // from
                    newApiLat, newApiLon    // to
                );

            // [NEW] Set the animation state.
            // We *always* start a new animation from scratch.
            this.airborneFlightState.set(flightId, {
                fromPos: fromPos,
                toPos: [newApiLon, newApiLat],
                fromHeading: fromHeading,
                toHeading: newApiHeading,
                startTime: now,
                duration: this.INTERP_DURATION_MS, // Use constant duration
                
                // Store pre-calculated path for interpolation
                pathDistanceKm: distanceKm,
                pathBearing: initialBearing
            });

            // Update/create the feature
            if (currentFeature) {
                // Just update properties. The animation loop will move the icon.
                this.currentMapFeatures[flightId].properties = newProperties;
            } else {
                // New flight: create it at the 'from' position to start.
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
     * [REVISED] The core animation loop (runs every frame).
     * This is now *dramatically* simpler. It only does
     * interpolation. There is no extrapolation or blending.
     *
     * @private
     */
    _animationLoop() {
        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            this.animationFrameId = requestAnimationFrame(this._animationLoop);
            return;
        }

        const now = performance.now();

        for (const [flightId, state] of this.airborneFlightState.entries()) {
            const feature = this.currentMapFeatures[flightId];
            if (!feature) {
                this.airborneFlightState.delete(flightId);
                continue;
            }

            const timeElapsedMs = now - state.startTime;
            
            // [NEW] Calculate progress, but clamp it at 1.0.
            // The animation simply *finishes* when it reaches its
            // target and waits for the next `updateFlight` call.
            let progress = timeElapsedMs / state.duration;
            progress = Math.min(1.0, progress); // Clamp at 1.0
            
            let finalLon, finalLat, finalHeading;

            // --- 1. Calculate INTERPOLATED HEADING ---
            let deltaH = state.toHeading - state.fromHeading;
            if (deltaH > 180) deltaH -= 360;
            if (deltaH < -180) deltaH += 360;
            finalHeading = state.fromHeading + (deltaH * progress);
            finalHeading = (finalHeading + 360) % 360; // Normalize

            // --- 2. Calculate INTERPOLATED Position ---
            // We just move `progress` % along the pre-calculated
            // great-circle path.
            
            if (progress === 1.0 || state.pathDistanceKm === 0) {
                // We are at the end, or we didn't have a path
                finalLon = state.toPos[0];
                finalLat = state.toPos[1];
            } else {
                // We are in-progress. Calculate the point along the arc.
                const { lon, lat } = this._getDestinationPoint(
                    state.fromPos[1],       // Start from the *last rendered* lat
                    state.fromPos[0],       // Start from the *last rendered* lon
                    state.pathBearing,      // Use the pre-calculated bearing
                    state.pathDistanceKm * progress // Travel 'progress' % of the way
                );
                finalLon = lon;
                finalLat = lat;
            }
            
            // --- 3. Update the feature ---
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
     * Calculates the initial bearing and distance between two points.
     * (No changes from your v3)
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
     * (No changes from your v3)
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