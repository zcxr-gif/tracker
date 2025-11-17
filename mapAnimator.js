/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle the animation of airborne flights
 * while "teleporting" ground-based flights for a Mapbox GL JS map.
 *
 * --- [USER-REQUESTED REWRITE: Constant-Speed Model] ---
 *
 * This model prioritizes a smooth, continuous, and *capped*
 * speed over the previous "chase" model.
 *
 * 1. STATE: Each rendered plane's animation is defined by its
 * "current" rendered state (pos, heading) and a "target" state
 * (the latest data from the API).
 *
 * 2. TARGET: When a new API packet arrives, the "target"
 * state is simply updated.
 *
 * 3. ANIMATION: The loop calculates the distance to move based on
 * a *fixed speed* (e.g., 540 km/h) and the time elapsed
 * since the last frame (delta-time).
 *
 * This model ensures the plane *never* speeds up to "catch" a
 * distant target. It always moves at a constant, believable
 * visual speed, which will naturally lag behind the "true" data.
 * ===================================================================
 */

const EARTH_RADIUS_KM = 6371;

// --- CONFIGURATION for the new Constant-Speed model ---

// --- [USER REQUEST: Use a constant, slow animation speed] ---
// This is the visual speed the plane icon will travel across the map,
// in kilometers per second.
// This is the *most important* value for tuning the feel.
//
// For reference:
// 900 km/h (Real cruise) = 0.25 km/s
// 720 km/h = 0.20 km/s
// 540 km/h (Slower) = 0.15 km/s
//
// By setting this *slower* than a real plane's speed, we
// guarantee the animation will always be lagging and continuous
// as long as new data is arriving.
const ANIMATION_SPEED_KM_PER_SECOND = 0.23; // Approx 540 km/h

// Heading smoothing can remain proportional, as it looks good.
// This controls how quickly the plane "turns" to its new bearing.
const HEADING_SMOOTHING_RATE = 0.4;


/**
 * Manages the "constant-speed" interpolation state
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
    }) {
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

        // --- 1. Calculate Delta-Time & Factors ---
        const dtSeconds = deltaTimeMs / 1000.0;
        
        // Heading interpolation remains proportional (it feels good)
        const t_heading = Math.min(1.0, HEADING_SMOOTHING_RATE * dtSeconds);

        // [NEW] Position movement is based on a *fixed speed*
        const maxDistanceToMoveThisFrame = ANIMATION_SPEED_KM_PER_SECOND * dtSeconds;

        // --- 2. Calculate Position (Great-Circle Path) ---
        // Find the total distance/bearing from *current* to *target*
        const totalSegmentDistKm = this._getDistanceKm(
            this.currentRenderedPos[1], this.currentRenderedPos[0],
            this.targetPos[1], this.targetPos[0]
        );

        // This will be the bearing of our *actual* movement this frame
        let segmentBearing = 0;

        if (totalSegmentDistKm < 1e-6) {
            // We are (practically) at the target. Snap to it.
            this.currentRenderedPos = this.targetPos;
        } else {
            // Find the bearing from *current* to *target*
            segmentBearing = this._getBearing(
                this.currentRenderedPos[1], this.currentRenderedPos[0],
                this.targetPos[1], this.targetPos[0]
            );

            // --- [CRITICAL FIX] ---
            // We are no longer moving a *percentage* of the distance.
            // We are moving at our *fixed animation speed* TOWARDS
            // the target, but no further than the target itself.
            const distanceToMoveKm = Math.min(
                maxDistanceToMoveThisFrame, 
                totalSegmentDistKm
            );
            // --- [END CRITICAL FIX] ---

            const newPos = this._getDestinationPoint(
                this.currentRenderedPos[1],
                this.currentRenderedPos[0],
                segmentBearing,
                distanceToMoveKm
            );
            this.currentRenderedPos = [newPos.lon, newPos.lat];
        }

        // --- 3. Calculate Heading (Improved Logic) ---
        // This logic is still good: point where we are moving.
        const effectiveHeadingTarget = (totalSegmentDistKm < 1e-6)
            ? this.targetHeading  // We are "settled", use API heading
            : segmentBearing;      // We are moving, use ground track

        // Interpolate 't_heading' *percent* towards the effective target
        this.currentRenderedHeading = this._angularLerp(
            this.currentRenderedHeading,
            effectiveHeadingTarget,
            t_heading
        );

        // --- 4. Return current state ---
        return {
            coordinates: this.currentRenderedPos,
            heading: this.currentRenderedHeading
        };
    }

    // --- Math & Geo Helpers ---

    _toRad(deg) { return (deg * Math.PI) / 180; }
    
    _toDeg(rad) { return (rad * 180) / Math.PI; } 

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
        console.log('MapAnimator (Constant-Speed) started.');
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
        console.log('MapAnimator (Constant-Speed) stopped.');
    }

    /**
     * Updates or creates a flight's state based on new data.
     * @param {object} newPosition - {lon, lat, heading_deg}
     * @param {object} newProperties - The full properties object.
     */
    updateFlight(newPosition, newProperties) { 
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
                });

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
            // Pass 'deltaTimeMs' so it can calculate its speed
            const newState = animState.getState(deltaTimeMs);

            // Update the feature's geometry and heading
            feature.geometry.coordinates = newState.coordinates;
            feature.properties.heading = newState.heading;
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