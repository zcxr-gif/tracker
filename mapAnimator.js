/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle the animation of airborne flights
 * while "teleporting" ground-based flights for a Mapbox GL JS map.
 *
 * --- [USER-REQUESTED REWRITE: Velocity-based Smoothing Model] ---
 *
 * This model prioritizes smooth, continuous motion over data-point
 * accuracy. The plane "chases" the latest known data point.
 *
 * 1. STATE: Each rendered plane's animation is defined by its
 * "current" rendered state (pos, heading) and a "target" state
 * (the latest data from the API).
 *
 * 2. TARGET: When a new API packet arrives, the "target"
 * state is simply updated. The "current" state is NOT changed.
 *
 * 3. DURATION: There is no fixed duration. The animation is
 * continuous.
 *
_ * 4. ANIMATION: The loop calculates a small interpolation
 * factor 't' based on the time elapsed since the last frame (delta-time)
 * and a smoothing rate. The plane moves *t* percent closer
 * to its target on every frame.
 *
 * This model ensures the plane *never stops* as long as new data
 * is arriving, creating a "slow and behind" smoothing effect.
 * ===================================================================
 */

const EARTH_RADIUS_KM = 6371;

// --- CONFIGURATION for the new smoothing model ---
// These control how "slow" the animation is.
// Higher numbers = faster, more responsive.
// Lower numbers = slower, smoother, more "behind".
// A value of 1.0 means it tries to close the distance in ~1 second.
// A value of 2.0 means it tries to close the distance in ~0.5 seconds.

// --- [FIX for "Stop-and-Go" animation] ---
// The previous values (1.5, 2.0) were too high, causing the
// animation to catch its target and stop. These lower values
// create a much smoother "chase" effect that remains continuous
// as long as new data is arriving.
const POSITION_SMOOTHING_RATE = 0.1; // Was 1.5
const HEADING_SMOOTHING_RATE = 0.2; // Was 2.0


/**
 * Manages the "chase" interpolation state
 * for a single airborne flight.
 */
class FlightAnimationState {
    constructor({
        initialPos,
        initialHeading
    }) {
        // --- Animation State ---
        // "Target" is the latest API data (where we *want* to be)
        this.targetPos = initialPos;
        this.targetHeading = initialHeading || 0;

        // "Current" is the last rendered position (where we *are*)
        this.currentRenderedPos = initialPos;
        this.currentRenderedHeading = initialHeading || 0;

        // Flag to prevent animation until the second packet arrives
        this.isWaitingForFirstUpdate = true;
    }

    /**
     * Called by MapAnimator.updateFlight when a new packet arrives.
     * This simply updates the "target" state.
     */
    updateTargets({
        newPos,
        newHeading
    }) { // durationMs is no longer needed
        // The new packet data becomes the new "target"
        this.targetPos = newPos;
        this.targetHeading = (newHeading !== undefined && newHeading !== null) ? newHeading : this.targetHeading; // Use last good if new is null

        // We are now ready to animate
        this.isWaitingForFirstUpdate = false;
    }

    /**
     * Calculates the flight's new position and heading for the current frame.
     * @param {number} deltaTimeMs - The time elapsed since the last frame.
     * @returns {{coordinates: [number, number], heading: number}}
     */
    getState(deltaTimeMs) {
        // If we're waiting for the first real update, just
        // return the static, as-is position and heading.
        if (this.isWaitingForFirstUpdate) {
            return {
                coordinates: this.currentRenderedPos,
                heading: this.currentRenderedHeading
            };
        }

        // --- 1. Calculate Interpolation Factors 't' ---
        // We use delta-time to make the animation smooth regardless of frame rate.
        // We cap at 1.0 to prevent overshooting in a single frame if a lag spike occurs.
        const dtSeconds = deltaTimeMs / 1000.0;
        const t_pos = Math.min(1.0, POSITION_SMOOTHING_RATE * dtSeconds);
        const t_heading = Math.min(1.0, HEADING_SMOOTHING_RATE * dtSeconds);

        // --- 2. Calculate Position (Great-Circle Path) ---
        // Find the total distance/bearing from *current* to *target*
        const totalSegmentDistKm = this._getDistanceKm(
            this.currentRenderedPos[1], this.currentRenderedPos[0],
            this.targetPos[1], this.targetPos[0]
        );

        if (totalSegmentDistKm < 1e-6) {
            // We are (practically) at the target. Snap to it.
            this.currentRenderedPos = this.targetPos;
        } else {
            // Find the bearing from *current* to *target*
            const segmentBearing = this._getBearing(
                this.currentRenderedPos[1], this.currentRenderedPos[0],
                this.targetPos[1], this.targetPos[0]
            );

            // Move 't_pos' *percent* of the remaining distance
            const distanceToMoveKm = totalSegmentDistKm * t_pos;
            const newPos = this._getDestinationPoint(
                this.currentRenderedPos[1],
                this.currentRenderedPos[0],
                segmentBearing,
                distanceToMoveKm
            );
            this.currentRenderedPos = [newPos.lon, newPos.lat];
        }

        // --- 3. Calculate Heading (Simple Angular Lerp) ---
        // Interpolate 't_heading' *percent* towards the target heading
        this.currentRenderedHeading = this._angularLerp(
            this.currentRenderedHeading,
            this.targetHeading,
            t_heading
        );

        // --- 4. Return current state ---
        return {
            coordinates: this.currentRenderedPos,
            heading: this.currentRenderedHeading
        };
    }

    // --- Math & Geo Helpers (Unchanged) ---

    _toRad(deg) { return (deg * Math.PI) / 180; }
    
    // !!!!!!!!!!!!! THIS WAS THE BUG !!!!!!!!!!!!!
    // It said (rad * 180) / 180 before.
    _toDeg(rad) { return (rad * 180) / Math.PI; } 
    // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

    _angularLerp(a, b, t) {
        let delta = b - a;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        return (a + delta * t + 360) % 360; // Ensure positive
    }

    _getDistanceKm(lat1, lon1, lat2, lon2) {
        const R = EARTH_RADIUS_KM;
        const toRad = this._toRad;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    _getBearing(lat1, lon1, lat2, lon2) {
        const lat1Rad = this._toRad(lat1);
        const lon1Rad = this._toRad(lon1);
        const lat2Rad = this._toRad(lat2);
        const lon2Rad = this._toRad(lon2);

        const dLonRad = lon2Rad - lon1Rad;
        const y = Math.sin(dLonRad) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLonRad);
        let brngRad = Math.atan2(y, x);

        return (this._toDeg(brngRad) + 360) % 360; // Normalize
    }

    _getDestinationPoint(lat, lon, bearing, distanceKm) {
        const latRad = this._toRad(lat);
        const lonRad = this._toRad(lon);
        const bearingRad = this._toRad(bearing);

        const angularDistance = distanceKm / EARTH_RADIUS_KM;

        const destLatRad = Math.asin(
            Math.sin(latRad) * Math.cos(angularDistance) +
            Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
        );

        let destLonRad = lonRad + Math.atan2(
            Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
            Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(destLatRad)
        );

        destLonRad = (destLonRad + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

        return { lat: this._toDeg(destLatRad), lon: this._toDeg(destLonRad) };
    }
}


/**
 * Main animation manager for the Mapbox map.
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
        this.airborneFlightState = new Map(); // Stores FlightAnimationState instances
        this.animationFrameId = null;

        this.lastFrameTime = performance.now(); // Used for delta-time calculation

        this._animationLoop = this._animationLoop.bind(this);
    }

    /**
     * Starts the animation loop.
     */
    start() {
        this.stop(); // Ensure no duplicates
        this.lastFrameTime = performance.now();
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
        console.log('MapAnimator (Smoothing-based) started.');
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
        console.log('MapAnimator (Smoothing-based) stopped.');
    }

    /**
     * [REWRITTEN for Smoothing-based Interpolation]
     * Updates or creates a flight's state based on new data.
     * @param {object} newPosition - {lon, lat, heading_deg}
     * @param {object} newProperties - The full properties object.
     * @param {number} packetDuration - The expected time (ms) until the NEXT packet. (NOTE: No longer used by this model)
     */
    updateFlight(newPosition, newProperties, packetDuration) {
        const flightId = newProperties.flightId;
        const newApiLon = newPosition.lon;
        const newApiLat = newPosition.lat;
        const newApiHeading = newProperties.heading; // Use prepared heading

        let animState = this.airborneFlightState.get(flightId);

        if (newProperties.phase === 'Ground') {
            // --- 1. GROUND AIRCRAFT ---

            // If it was airborne, it has "landed".
            // Remove it from the animation loop.
            if (animState) {
                this.airborneFlightState.delete(flightId);
            }

            // Teleport the ground plane to its new location.
            this.currentMapFeatures[flightId] = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [newApiLon, newApiLat]
                },
                properties: newProperties
            };

        } else {
            // --- 2. AIRBORNE AIRCRAFT ---
            if (!animState) {
                // --- 2a. First time seeing this AIRBORNE flight ---
                animState = new FlightAnimationState({
                    initialPos: [newApiLon, newApiLat],
                    initialHeading: newApiHeading,
                });
                this.airborneFlightState.set(flightId, animState);

                // Create the feature in the master list. It will
                // stay static until the *next* packet arrives.
                this.currentMapFeatures[flightId] = {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [newApiLon, newApiLat] },
                    properties: newProperties
                };

            } else {
                // --- 2b. This is an existing AIRBORNE flight ---
                // Update its "target" state.
                animState.updateTargets({
                    newPos: [newApiLon, newApiLat],
                    newHeading: newApiHeading
                }); // No duration needed

                // Update properties
                this.currentMapFeatures[flightId].properties = newProperties;
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
     * [REWRITTEN for Smoothing-based Interpolation]
     * The core animation loop (runs every frame).
     */
    _animationLoop() {
        this.animationFrameId = requestAnimationFrame(this._animationLoop);

        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            return;
        }

        // --- 1. Calculate Delta-Time (for safety) ---
        const now = performance.now();
        const deltaTimeMs = now - this.lastFrameTime;
        this.lastFrameTime = now;

        if (deltaTimeMs > 1000) {
            return; // Skip massive deltas (e.g., tabbed out)
        }
        if (deltaTimeMs <= 0) {
            return; // No time has passed
        }

        // --- 2. Update all animating features ---
        for (const [flightId, animState] of this.airborneFlightState.entries()) {
            const feature = this.currentMapFeatures[flightId];
            if (!feature) {
                this.airborneFlightState.delete(flightId);
                continue;
            }

            // Delegate all calculation to the state object
            // Pass 'deltaTimeMs' so it can calculate its 't'
            const newState = animState.getState(deltaTimeMs);

            // Update the feature's geometry and heading
            feature.geometry.coordinates = newState.coordinates;
            feature.properties.heading = newState.heading;

            // NOTE: The animation *never* stops, it just
            // "settles" when it reaches its target.
        }

        // --- 3. Update the map source with the new state of *all* features ---
        // This single call pushes all ground-teleports AND
        // all airborne-animations to the map at once.
        source.setData({
            type: 'FeatureCollection',
            features: Object.values(this.currentMapFeatures)
        });
    }
}