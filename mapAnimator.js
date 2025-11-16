/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle the smooth animation of airborne flights
 * while "teleporting" ground-based flights for a Mapbox GL JS map.
 * * This version includes extrapolation to smoothly continue
 * flight paths at their last known speed and heading.
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
            // --- 2. AIRBORNE AIRCRAFT: Animate ---
            const currentFeature = this.currentMapFeatures[flightId];
            
            // Get the 'from' state
            // This is the CRITICAL part: if the feature exists, we use its *current*
            // on-screen (possibly extrapolated) position as the starting point.
            const fromPos = currentFeature ? currentFeature.geometry.coordinates : [newApiLon, newApiLat];
            const fromHeading = currentFeature ? currentFeature.properties.heading : newApiHeading;

            // Store the animation parameters
            this.airborneFlightState.set(flightId, {
                fromPos: fromPos,
                toPos: [newApiLon, newApiLat],
                fromHeading: fromHeading,
                toHeading: newApiHeading,
                startTime: performance.now(),
                duration: Math.max(500, packetDuration) // Animate over the packet duration
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

            // Calculate how far along the animation we are.
            // By NOT clamping this to 1.0, we allow extrapolation.
            // 'progress' will continue to grow (1.1, 1.2, etc.),
            // pushing the icon along the same vector.
            const progress = (now - state.startTime) / state.duration;

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

            // We no longer delete the state when progress === 1.
            // The state will only be updated (in updateFlight) or
            // deleted (in removeFlight or if the plane lands).
        }

        // --- 2. Update the map source with the new state of *all* features ---
        // This single call renders *both* the teleported ground planes
        // and the smoothly extrapolated/animated airborne planes.
        source.setData({
            type: 'FeatureCollection',
            features: Object.values(this.currentMapFeatures)
        });

        // --- 3. Request the next animation frame ---
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
    }
}