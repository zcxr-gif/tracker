/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle the animation of airborne flights
 * while "teleporting" ground-based flights for a Mapbox GL JS map.
 *
 * --- [USER-REQUESTED REWRITE: Time-based Interpolation Model] ---
 *
 * This model prioritizes data-point accuracy over velocity blending.
 *
 * 1. STATE: Each rendered plane's animation is defined by a
 * "start" state (pos, heading) and a "target" state.
 *
 * 2. TARGET: When a new API packet arrives, the *current*
 * rendered position becomes the "start" state, and the new
 * packet's data becomes the "target" state.
 *
 * 3. DURATION: The animation between "start" and "target"
 * occurs over a fixed time (the 'packetDuration').
 *
 * 4. ANIMATION: The loop calculates a time percentage 't' (0.0 to 1.0)
 * and interpolates the plane's position along a great-circle
 * path and separately interpolates its heading.
 *
 * This model ensures the plane *always* animates from its last
 * on-screen spot, preventing any "snapping" or "drag-back"
 * when new data arrives.
 * ===================================================================
 */

const EARTH_RADIUS_KM = 6371;

/**
 * Manages the "A-to-B" interpolation state
 * for a single airborne flight.
 */
class FlightAnimationState {
    constructor({
        initialPos,
        initialHeading
    }) {
        // --- Animation State ---
        // We hold "start" and "target" for the current segment.
        this.startPos = initialPos;
        this.targetPos = initialPos;
        this.startHeading = initialHeading || 0;
        this.targetHeading = initialHeading || 0;

        // --- Timing ---
        this.animationStartTimeMs = performance.now();
        this.animationDurationMs = 1000; // Default, will be overwritten

        // --- Internal State ---
        // Store the last calculated state to prevent "snapping"
        // when a new updateTarget is called.
        this.currentRenderedPos = initialPos;
        this.currentRenderedHeading = initialHeading || 0;

        // Flag to prevent animation until the second packet arrives
        this.isWaitingForFirstUpdate = true;
    }

    /**
     * Called by MapAnimator.updateFlight when a new packet arrives.
     * This sets the new "target" and moves the current "rendered"
     * state to be the "start".
     */
    updateTargets({
        newPos,
        newHeading
    }, durationMs) {
        // The current rendered state becomes the new "start"
        this.startPos = this.currentRenderedPos;
        this.startHeading = this.currentRenderedHeading;

        // The new packet data becomes the new "target"
        this.targetPos = newPos;
        this.targetHeading = (newHeading !== undefined && newHeading !== null) ? newHeading : this.startHeading; // Use last good if new is null

        // Reset the animation clock
        this.animationStartTimeMs = performance.now();
        this.animationDurationMs = durationMs > 0 ? durationMs : 1000; // Ensure valid duration

        // We are now ready to animate
        this.isWaitingForFirstUpdate = false;
    }

    /**
     * Calculates the flight's new position and heading for the current frame.
     * @param {number} currentTimeMs - The current `performance.now()` timestamp.
     * @returns {{coordinates: [number, number], heading: number}}
     */
    getState(currentTimeMs) {
        // If we're waiting for the first real update, just
        // return the static, as-is position and heading.
        if (this.isWaitingForFirstUpdate) {
            return {
                coordinates: this.startPos,
                heading: this.startHeading
            };
        }

        // --- 1. Calculate Interpolation Factor 't' ---
        const elapsedMs = currentTimeMs - this.animationStartTimeMs;
        const t = Math.min(1.0, elapsedMs / this.animationDurationMs);

        // --- 2. Calculate Position (Great-Circle Path) ---
        // We find the total distance and bearing of the segment,
        // then move the plane 't' percent along that path.
        const totalSegmentDistKm = this._getDistanceKm(
            this.startPos[1], this.startPos[0],
            this.targetPos[1], this.targetPos[0]
        );

        if (totalSegmentDistKm < 1e-6) {
            // We are already at the target, don't move.
            this.currentRenderedPos = this.targetPos;
        } else {
            const segmentBearing = this._getBearing(
                this.startPos[1], this.startPos[0],
                this.targetPos[1], this.targetPos[0]
            );

            const distanceToMoveKm = totalSegmentDistKm * t;
            const newPos = this._getDestinationPoint(
                this.startPos[1],
                this.startPos[0],
                segmentBearing,
                distanceToMoveKm
            );
            this.currentRenderedPos = [newPos.lon, newPos.lat];
        }

        // --- 3. Calculate Heading (Simple Angular Lerp) ---
        // NOTE: This heading is interpolated independently from the
        // position. This may cause the "crabbing" effect.
        this.currentRenderedHeading = this._angularLerp(
            this.startHeading,
            this.targetHeading,
            t
        );

        // --- 4. Return and save current state ---
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

        this.lastFrameTime = performance.now(); // Only used for loop safety

        this._animationLoop = this._animationLoop.bind(this);
    }

    /**
     * Starts the animation loop.
     */
    start() {
        this.stop(); // Ensure no duplicates
        this.lastFrameTime = performance.now();
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
        console.log('MapAnimator (Time-based) started.');
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
        console.log('MapAnimator (Time-based) stopped.');
    }

    /**
     * [REWRITTEN for Time-based Interpolation]
     * Updates or creates a flight's state based on new data.
     * @param {object} newPosition - {lon, lat, heading_deg}
     * @param {object} newProperties - The full properties object.
     * @param {number} packetDuration - The expected time (ms) until the NEXT packet.
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
                // Update its "target" state. The animation
                // will automatically restart from its current position.
                animState.updateTargets({
                    newPos: [newApiLon, newApiLat],
                    newHeading: newApiHeading
                }, packetDuration); // Pass in the new duration

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
     * [REWRITTEN for Time-based Interpolation]
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

        // --- 2. Update all animating features ---
        for (const [flightId, animState] of this.airborneFlightState.entries()) {
            const feature = this.currentMapFeatures[flightId];
            if (!feature) {
                this.airborneFlightState.delete(flightId);
                continue;
            }

            // Delegate all calculation to the state object
            // Pass 'now' so it can calculate 't'
            const newState = animState.getState(now);

            // Update the feature's geometry and heading
            feature.geometry.coordinates = newState.coordinates;
            feature.properties.heading = newState.heading;

            // NOTE: No 'isFinished' check is needed.
            // The animation simply stops at t=1.0. If data is late,
            // the plane pauses. When new data arrives, 'updateFlight'
            // provides a new target and the animation continues.
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