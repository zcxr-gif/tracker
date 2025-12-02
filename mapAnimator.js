/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * Handles smooth animation of flight positions on a Mapbox GL JS map.
 *
 * --- [REWRITE: Interpolation Model] ---
 *
 * This version smoothly interpolates (slides) the aircraft from its
 * previous position to the new position over the estimated duration
 * of the update interval.
 *
 * Features:
 * 1. Smooth Lat/Lon interpolation.
 * 2. Smart Heading rotation (takes shortest path, e.g., 350° -> 10°).
 * 3. Dynamic Duration: Adapts to the actual speed of incoming data.
 * 4. Timestamp Guard: Prevents out-of-order packets from causing jumps.
 * ===================================================================
 */

export class MapAnimator {
    /**
     * @param {mapboxgl.Map} map - The Mapbox map instance.
     * @param {string} sourceName - The name of the GeoJSON source to update.
     * @param {Object} featuresObject - A reference to the master features object (currentMapFeatures) in flight.js.
     */
    constructor(map, sourceName, featuresObject) {
        this.map = map;
        this.sourceName = sourceName;
        this.currentMapFeatures = featuresObject; // Shared reference
        
        // Stores animation state for each flight:
        // { startCoords, endCoords, startTime, duration, startHeading, endHeading }
        this.animationStates = {}; 
        
        this.isActive = false;
        this.animationFrameId = null;

        // Configuration
        this.defaultDuration = 3000; // Fallback duration in ms
        this.minDuration = 500;      // Minimum animation time
        this.lastFrameTime = 0;
    }

    /**
     * Starts the animation loop.
     */
    start() {
        if (!this.isActive) {
            console.log('MapAnimator (Interpolation) started.');
            this.isActive = true;
            this._animate();
        }
    }

    /**
     * Stops the animation loop.
     */
    stop() {
        this.isActive = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        console.log('MapAnimator (Interpolation) stopped.');
    }

    /**
     * Updates a flight's target position and sets up the interpolation.
     * @param {object} newPosition - {lon, lat, heading_deg, lastReport}
     * @param {object} newProperties - The full properties object.
     */
    updateFlight(newPosition, newProperties) {
        const flightId = newProperties.flightId;
        const now = performance.now();
        const newTimestamp = newProperties.last_update || Date.now();

        // 1. Guard against out-of-order data
        // We check our own animation state to see the last timestamp we processed
        const currentState = this.animationStates[flightId];
        
        if (currentState) {
            if (newTimestamp <= currentState.dataTimestamp) {
                // Ignore old or duplicate packets
                return;
            }
        }

        // 2. Determine Start Position (Visual Continuity)
        // If we are already animating, start from the *current visually interpolated* position
        // so the plane doesn't snap back. If it's new, start from the new position.
        let startCoords = [newPosition.lon, newPosition.lat];
        let startHeading = newPosition.heading_deg;
        let calculatedDuration = this.defaultDuration;

        if (currentState) {
            // Get the exact position where the icon is *right now*
            startCoords = currentState.currentCoords || currentState.endCoords;
            startHeading = currentState.currentHeading || currentState.endHeading;

            // Calculate dynamic duration based on how much time passed since last update
            const timeSinceLastUpdate = now - currentState.updateReceivedTime;
            // Smooth it slightly (avg of current gap and default) to avoid jitter
            if (timeSinceLastUpdate > this.minDuration && timeSinceLastUpdate < 10000) {
                calculatedDuration = timeSinceLastUpdate;
            }
        }

        // 3. Update the Master Feature immediately with new properties (text, etc.)
        // But keep coordinates at the "start" for now, the loop will move them.
        this.currentMapFeatures[flightId] = {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: startCoords
            },
            properties: {
                ...newProperties,
                heading: startHeading // Start with current visual heading
            }
        };

        // 4. Store Animation Target
        this.animationStates[flightId] = {
            startCoords: startCoords,
            endCoords: [newPosition.lon, newPosition.lat],
            startHeading: startHeading,
            endHeading: newPosition.heading_deg,
            startTime: now,
            duration: calculatedDuration,
            dataTimestamp: newTimestamp,
            updateReceivedTime: now,
            currentCoords: startCoords, // Track for next update continuity
            currentHeading: startHeading
        };
    }

    /**
     * Removes a flight from the map and animation state.
     * @param {string} flightId 
     */
    removeFlight(flightId) {
        delete this.currentMapFeatures[flightId];
        delete this.animationStates[flightId];
        // We don't trigger an update here; the loop handles it efficiently.
    }

    /**
     * The main animation loop running at ~60fps.
     */
    _animate() {
        if (!this.isActive) return;

        const now = performance.now();
        let needsUpdate = false;

        // Iterate over all active animations
        for (const flightId in this.animationStates) {
            const state = this.animationStates[flightId];
            
            // Calculate progress (0.0 to 1.0)
            const elapsed = now - state.startTime;
            let t = elapsed / state.duration;

            // Clamp progress to 1.0 to prevent overshooting if data lags slightly
            if (t > 1) t = 1;

            // --- Interpolate Coordinates (Linear) ---
            const currentLon = state.startCoords[0] + (state.endCoords[0] - state.startCoords[0]) * t;
            const currentLat = state.startCoords[1] + (state.endCoords[1] - state.startCoords[1]) * t;
            
            // --- Interpolate Heading (Shortest Path) ---
            // Fix 350 -> 10 jumping the long way around
            let dHeading = state.endHeading - state.startHeading;
            if (dHeading > 180) dHeading -= 360;
            if (dHeading < -180) dHeading += 360;
            
            const currentHeading = state.startHeading + dHeading * t;

            // Store current state for visual continuity on next update
            state.currentCoords = [currentLon, currentLat];
            state.currentHeading = currentHeading;

            // Update the GeoJSON Feature
            const feature = this.currentMapFeatures[flightId];
            if (feature) {
                feature.geometry.coordinates = [currentLon, currentLat];
                feature.properties.heading = currentHeading;
                needsUpdate = true;
            }
        }

        // Push to Mapbox ONLY if something changed
        if (needsUpdate) {
            this._updateMapSource();
        }

        this.animationFrameId = requestAnimationFrame(() => this._animate());
    }

    /**
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