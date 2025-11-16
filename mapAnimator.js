/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle the smooth animation of airborne flights
 * while "teleporting" ground-based flights for a Mapbox GL JS map.
 *
 * --- [USER-REQUESTED REWRITE: Velocity Blending Model] ---
 *
 * This model prioritizes visual smoothness over data-point accuracy.
 *
 * 1. STATE: Each rendered plane has its *own* state (renderedPos,
 * renderedHeading, renderedSpeed).
 * 2. TARGET: New API packets update the plane's *target* state
 * (targetPos, targetHeading, targetSpeed).
 * 3. CHASE: In the animation loop, the plane constantly and
 * smoothly "chases" its target.
 *
 * - It blends its speed towards the target speed.
 * - It calculates a "desired heading" (a blend between "seeking"
 * the target position and "following" the target heading).
 * - It blends its rendered heading toward this desired heading.
 * - It moves forward using its *own* blended velocity.
 *
 * This eliminates all "snapping" and "drag-back" visual errors.
 * ===================================================================
 */

const KTS_TO_KMS_PER_MS = 1.852 / 3600000;
const EARTH_RADIUS_KM = 6371;

/**
 * Manages the animation state and "seeker" logic
 * for a single airborne flight.
 */
class FlightAnimationState {
    constructor({
        initialPos,
        initialHeading,
        initialSpeedKt
    }) {
        // The "rendered" state (what's on screen)
        this.renderedPos = initialPos;         // [lon, lat]
        this.renderedHeading = initialHeading;   // degrees
        this.renderedSpeedKt = initialSpeedKt;   // knots

        // The "target" state (from latest API packet)
        this.targetPos = initialPos;
        this.targetHeading = initialHeading;
        this.targetSpeedKt = initialSpeedKt;

        // --- TUNING PARAMETERS ---
        // How quickly the plane turns (higher = more responsive, "tighter")
        // A good starting value is between 1.0 (heavy) and 5.0 (agile).
        this.headingSmoothFactor = 2.0;

        // How quickly the plane changes speed (higher = faster)
        this.speedSmoothFactor = 5.0;
        
        // Distance (km) at which we start blending from "seeking" the
        // target to "following" the API heading.
        this.followBlendDistanceKm = 1.0;
    }

    /**
     * Called by MapAnimator.updateFlight when a new packet arrives.
     * This just updates the "goal" for the animation loop to chase.
     */
    updateTargets({
        newPos,
        newHeading,
        newSpeedKt
    }) {
        this.targetPos = newPos;
        this.targetHeading = newHeading;
        this.targetSpeedKt = newSpeedKt;
    }

    /**
     * Calculates the flight's new position and heading for the current frame.
     * @param {number} deltaTimeMs - The time (ms) since the last frame.
     * @returns {{coordinates: [number, number], heading: number}}
     */
    update(deltaTimeMs) {
        if (deltaTimeMs <= 0) {
            return {
                coordinates: this.renderedPos,
                heading: this.renderedHeading
            };
        }
        const dtSec = deltaTimeMs / 1000.0;

        // --- 1. Calculate Frame-Independent Lerp Factors ---
        // This math ensures the animation feels the same at 30fps or 144fps
        const headingLerpFactor = 1.0 - Math.exp(-this.headingSmoothFactor * dtSec);
        const speedLerpFactor = 1.0 - Math.exp(-this.speedSmoothFactor * dtSec);

        // --- 2. Calculate "Desired" Heading (Seeker/Follower Logic) ---
        const distToTargetKm = this._getDistanceKm(
            this.renderedPos[1], this.renderedPos[0],
            this.targetPos[1], this.targetPos[0]
        );
        const bearingToTarget = this._getBearing(
            this.renderedPos[1], this.renderedPos[0],
            this.targetPos[1], this.targetPos[0]
        );

        // We blend between "seeking" the target and "following" the API heading.
        // blendFactor = 1.0: 100% "seek" the target (when far away)
        // blendFactor = 0.0: 100% "follow" the API heading (when on top of target)
        const blendFactor = Math.min(1.0, distToTargetKm / this.followBlendDistanceKm);
        
        const desiredHeading = this._angularLerp(
            this.targetHeading,  // Start with API heading
            bearingToTarget,     // Blend towards bearing-to-target
            blendFactor          // Based on distance
        );

        // --- 3. Smoothly blend the rendered heading ---
        this.renderedHeading = this._angularLerp(
            this.renderedHeading,
            desiredHeading,
            headingLerpFactor
        );

        // --- 4. Smoothly blend the rendered speed ---
        this.renderedSpeedKt = this._lerp(
            this.renderedSpeedKt,
            this.targetSpeedKt,
            speedLerpFactor
        );
        
        // --- 5. Move the plane ---
        // We move from our *last rendered position* using our *new
        // blended heading and speed*.
        const distanceToMoveKm = (this.renderedSpeedKt * KTS_TO_KMS_PER_MS) * deltaTimeMs;

        const newPos = this._getDestinationPoint(
            this.renderedPos[1],
            this.renderedPos[0],
            this.renderedHeading,
            distanceToMoveKm
        );
        
        this.renderedPos = [newPos.lon, newPos.lat];

        return {
            coordinates: this.renderedPos,
            heading: this.renderedHeading
        };
    }
    
    // --- Math & Geo Helpers ---

    _toRad(deg) { return (deg * Math.PI) / 180; }
    _toDeg(rad) { return (rad * 180) / Math.PI; }
    _lerp(a, b, t) { return a + (b - a) * t; }

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
        this.airborneFlightState = new Map();     // Stores FlightAnimationState instances
        this.animationFrameId = null;

        // [NEW] Need last frame time for delta-time calculations
        this.lastFrameTime = performance.now();

        // Bind the animation loop to the class instance
        this._animationLoop = this._animationLoop.bind(this);
    }

    /**
     * Starts the animation loop.
     */
    start() {
        this.stop(); // Ensure no duplicates
        
        // [NEW] Set start time
        this.lastFrameTime = performance.now();
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
        console.log('MapAnimator (VelocityBlend) started.');
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
        console.log('MapAnimator (VelocityBlend) stopped.');
    }

    /**
     * [REWRITTEN]
     * Updates or creates a flight's state based on new data.
     * This now just updates the *target* for the animation to chase.
     */
    updateFlight(newPosition, newProperties, packetDuration) {
        const flightId = newProperties.flightId;
        const newApiLon = newPosition.lon;
        const newApiLat = newPosition.lat;
        const newApiHeading = newPosition.heading_deg || 0;
        const newApiSpeedKt = newProperties.speed || 0;

        // --- HYBRID LOGIC ---
        if (newProperties.phase === 'Ground') {
            // --- 1. GROUND AIRCRAFT: Teleport ---
            // Instantly move the aircraft to the new position
            this.currentMapFeatures[flightId] = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [newApiLon, newApiLat]
                },
                properties: newProperties
            };
            // Remove any pending animation
            this.airborneFlightState.delete(flightId);

        } else {
            // --- 2. AIRBORNE AIRCRAFT: Update Targets ---
            let animState = this.airborneFlightState.get(flightId);
            
            if (!animState) {
                // --- First time we've seen this airborne flight ---
                // Create a new state, starting it *at* the API position.
                animState = new FlightAnimationState({
                    initialPos: [newApiLon, newApiLat],
                    initialHeading: newApiHeading,
                    initialSpeedKt: newApiSpeedKt
                });
                this.airborneFlightState.set(flightId, animState);
                
                // Create the feature in the master list
                this.currentMapFeatures[flightId] = {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [newApiLon, newApiLat] },
                    properties: newProperties
                };

            } else {
                // --- This is an existing airborne flight ---
                // Just update its targets. The anim loop will do the rest.
                animState.updateTargets({
                    newPos: [newApiLon, newApiLat],
                    newHeading: newApiHeading,
                    newSpeedKt: newApiSpeedKt
                });
                
                // Update properties (like phase, speed, etc.)
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
     * [REWRITTEN]
     * The core animation loop (runs every frame).
     * This loop now calculates delta-time and runs the
     * "seeker" physics simulation for each flight.
     */
    _animationLoop() {
        // Ensure the loop continues
        this.animationFrameId = requestAnimationFrame(this._animationLoop);

        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            return; // Map not ready, wait for next frame
        }

        // --- 1. Calculate Delta-Time ---
        const now = performance.now();
        const deltaTimeMs = now - this.lastFrameTime;
        this.lastFrameTime = now;

        // If tab was in background, deltaTime will be huge.
        // Skip this frame to prevent massive "jumps".
        if (deltaTimeMs > 1000) {
            return;
        }

        let didUpdate = false;

        // --- 2. Update all airborne features ---
        for (const [flightId, animState] of this.airborneFlightState.entries()) {
            const feature = this.currentMapFeatures[flightId];
            if (!feature) {
                // This flight was removed, clean up its animation state
                this.airborneFlightState.delete(flightId);
                continue;
            }
            
            // Delegate all calculation to the individual flight's state object
            const newState = animState.update(deltaTimeMs);

            // Update the feature's geometry and heading in the master list
            feature.geometry.coordinates = newState.coordinates;
            feature.properties.heading = newState.heading;
            didUpdate = true;
        }

        if (!didUpdate && this.airborneFlightState.size === 0) {
            // No airborne flights to animate, but we still must
            // update the source for any ground planes that moved.
        }

        // --- 3. Update the map source with the new state of *all* features ---
        source.setData({
            type: 'FeatureCollection',
            features: Object.values(this.currentMapFeatures)
        });
    }
}