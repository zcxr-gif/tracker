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
        this.renderedPos = initialPos; // [lon, lat]
        this.renderedHeading = initialHeading; // degrees
        this.renderedSpeedKt = initialSpeedKt; // knots

        // The "target" state (from latest API packet)
        this.targetPos = initialPos;
        this.targetHeading = initialHeading;
        this.targetSpeedKt = initialSpeedKt;

        // [NEW] Internal state for managing smooth landing
        this.isLanding = false;

        // --- TUNING PARAMETERS ---
        // How quickly the plane turns (higher = more responsive, "tighter")
        // A good starting value is between 1.0 (heavy) and 5.0 (agile).
        this.headingSmoothFactor = 2.0;

        // How quickly the plane changes speed (higher = faster)
        this.speedSmoothFactor = 5.0;

        // Distance (km) at which we start blending from "seeking" the
        // target to "following" the API heading.
        // *NOTE*: This value *must* be tuned relative to headingSmoothFactor.
        // A "heavy" plane (low smooth factor) needs a *larger* blend
        // distance to give it enough time to make the final turn.
        this.followBlendDistanceKm = 1.0;

        // [NEW] Distance (km) at which the plane begins to decelerate
        // for a smooth stop at its target. This fixes the "orbit" flaw.
        this.slowingDistanceKm = 0.5;
        
        // [NEW] Thresholds to determine when a "landing" flight has
        // officially "arrived" and can be removed from the animation loop.
        this.arrivalThresholdKm = 0.01;  // 10 meters
        this.arrivalThresholdKts = 0.5;    // 0.5 knots
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
     * @returns {{coordinates: [number, number], heading: number, isFinished: boolean}}
     */
    update(deltaTimeMs) {
        if (deltaTimeMs <= 0) {
            return {
                coordinates: this.renderedPos,
                heading: this.renderedHeading,
                isFinished: false // [NEW]
            };
        }
        const dtSec = deltaTimeMs / 1000.0;

        // --- 1. Calculate Frame-Independent Lerp Factors ---
        const headingLerpFactor = 1.0 - Math.exp(-this.headingSmoothFactor * dtSec);
        const speedLerpFactor = 1.0 - Math.exp(-this.speedSmoothFactor * dtSec);

        // --- 2. Calculate Distance and Bearing to Target ---
        const distToTargetKm = this._getDistanceKm(
            this.renderedPos[1], this.renderedPos[0],
            this.targetPos[1], this.targetPos[0]
        );
        const bearingToTarget = this._getBearing(
            this.renderedPos[1], this.renderedPos[0],
            this.targetPos[1], this.targetPos[0]
        );

        // --- 3. Calculate "Desired" Heading (Seeker/Follower Logic) ---
        // blendFactor = 1.0: 100% "seek" the target (when far away)
        // blendFactor = 0.0: 100% "follow" the API heading (when on top of target)
        const blendFactor = Math.min(1.0, distToTargetKm / this.followBlendDistanceKm);

        const desiredHeading = this._angularLerp(
            this.targetHeading, // Start with API heading
            bearingToTarget, // Blend towards bearing-to-target
            blendFactor // Based on distance
        );

        // --- 4. Smoothly blend the rendered heading ---
        this.renderedHeading = this._angularLerp(
            this.renderedHeading,
            desiredHeading,
            headingLerpFactor
        );

        // --- 5. Smoothly blend the rendered speed ---
        
        // [FIX for ORBIT FLASW]
        // We calculate a "frame target speed". This is normally the
        // API's target speed, but as we get close to the target,
        // we blend this down to 0. This makes the plane *naturally*
        // slow down and stop, preventing any "orbiting".
        const speedAtTargetBlend = Math.min(1.0, distToTargetKm / this.slowingDistanceKm);
        const frameTargetSpeed = this.targetSpeedKt * speedAtTargetBlend;

        this.renderedSpeedKt = this._lerp(
            this.renderedSpeedKt,
            frameTargetSpeed, // [CHANGED] Was this.targetSpeedKt
            speedLerpFactor
        );
        
        // --- 6. Move the plane ---
        const distanceToMoveKm = (this.renderedSpeedKt * KTS_TO_KMS_PER_MS) * deltaTimeMs;

        // Don't move if speed is negligible
        if (distanceToMoveKm > 1e-6) {
           const newPos = this._getDestinationPoint(
                this.renderedPos[1],
                this.renderedPos[0],
                this.renderedHeading,
                distanceToMoveKm
            );
            this.renderedPos = [newPos.lon, newPos.lat];
        }

        // --- 7. [NEW] Check for "Landing" completion ---
        let isFinished = false;
        if (this.isLanding) {
            // If we are in "landing" mode, check if we've come to a stop.
            if (distToTargetKm < this.arrivalThresholdKm && this.renderedSpeedKt < this.arrivalThresholdKts) {
                // We've arrived.
                isFinished = true;
                // Snap to final position to be precise
                this.renderedPos = this.targetPos;
                this.renderedHeading = this.targetHeading;
            }
        }

        return {
            coordinates: this.renderedPos,
            heading: this.renderedHeading,
            isFinished: isFinished
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
        this.airborneFlightState = new Map(); // Stores FlightAnimationState instances
        this.animationFrameId = null;

        this.lastFrameTime = performance.now();

        this._animationLoop = this._animationLoop.bind(this);
    }

    /**
     * Starts the animation loop.
     */
    start() {
        this.stop(); // Ensure no duplicates
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
     * [REWRITTEN to handle smooth landing]
     * Updates or creates a flight's state based on new data.
     */
    updateFlight(newPosition, newProperties, packetDuration) {
        const flightId = newProperties.flightId;
        const newApiLon = newPosition.lon;
        const newApiLat = newPosition.lat;
        const newApiHeading = newPosition.heading_deg || 0;
        const newApiSpeedKt = newProperties.speed || 0;

        let animState = this.airborneFlightState.get(flightId);

        if (newProperties.phase === 'Ground') {
            // --- 1. GROUND AIRCRAFT ---
            
            if (animState) {
                // --- 1a. AIR-TO-GROUND (Landing) ---
                // The flight *was* airborne, now it's ground.
                // Initiate a smooth landing animation.
                animState.isLanding = true;
                animState.updateTargets({
                    newPos: [newApiLon, newApiLat],
                    newHeading: newApiHeading,
                    newSpeedKt: 0 // Target speed is 0
                });
                // Just update the properties. The animation loop
                // will move the plane to its final spot.
                this.currentMapFeatures[flightId].properties = newProperties;
                
            } else {
                // --- 1b. GROUND-TO-GROUND (Taxiing) ---
                // The flight was already on the ground. Teleport it.
                this.currentMapFeatures[flightId] = {
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [newApiLon, newApiLat]
                    },
                    properties: newProperties
                };
                // Ensure no old animation state exists
                this.airborneFlightState.delete(flightId);
            }

        } else {
            // --- 2. AIRBORNE AIRCRAFT ---
            if (!animState) {
                // --- 2a. First time seeing this AIRBORNE flight ---
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
                // --- 2b. This is an existing AIRBORNE flight ---
                // It might have been landing, but it's airborne again
                // (e.g., a go-around or a data flap).
                animState.isLanding = false;
                
                animState.updateTargets({
                    newPos: [newApiLon, newApiLat],
                    newHeading: newApiHeading,
                    newSpeedKt: newApiSpeedKt
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
     * [REWRITTEN to handle landing cleanup]
     * The core animation loop (runs every frame).
     */
    _animationLoop() {
        this.animationFrameId = requestAnimationFrame(this._animationLoop);

        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            return;
        }

        // --- 1. Calculate Delta-Time ---
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

            // Delegate all calculation
            const newState = animState.update(deltaTimeMs);

            // Update the feature's geometry and heading
            feature.geometry.coordinates = newState.coordinates;
            feature.properties.heading = newState.heading;

            if (newState.isFinished) {
                // [NEW] This flight has landed and finished its
                // animation. Remove it from the animation map
                // so it no longer updates.
                this.airborneFlightState.delete(flightId);
                
                // As a final guarantee, snap it to its final target pos
                feature.geometry.coordinates = animState.targetPos;
                feature.properties.heading = animState.targetHeading;
            }
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