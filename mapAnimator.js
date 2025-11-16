/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle the smooth animation of airborne flights
 * while "teleporting" ground-based flights for a Mapbox GL JS map.
 *
 * --- [USER-REQUESTED REWRITE] ---
 * The previous logic was overly complex and caused position divergence.
 * This new model is a standard "Interpolate-then-Extrapolate" system.
 *
 * 1. INTERPOLATE: When a new packet arrives, the plane animates
 * from its last rendered position (fromPos) to the new API
 * position (toPos) over the packet's 'duration'. This
 * corrects any previous extrapolation error.
 *
 * 2. EXTRAPOLATE: After the 'duration' has passed, the plane
 * continues moving from 'toPos' using the latest
 * 'apiSpeedKt' and 'apiHeadingDeg'.
 *
 * This ensures the map is 100% accurate to the API data at the
 * end of every interpolation cycle, just like the PFD.
 * ===================================================================
 */

const KTS_TO_KMS_PER_MS = 1.852 / 3600000;
const EARTH_RADIUS_KM = 6371;

/**
 * Manages the animation state and interpolation/extrapolation
 * logic for a single airborne flight.
 *
 * --- [REWRITTEN MODEL] ---
 * This model interpolates from the last rendered position (fromPos) to the
 * new API position (toPos) over the 'duration' (the packet interval).
 * After that, it extrapolates from 'toPos' using the latest API speed/heading.
 */
class FlightAnimationState {
    constructor({
        fromPos,
        toPos,
        fromHeading,
        toHeading,
        startTime,
        duration,
        apiSpeedKt,
        apiHeadingDeg
    }) {
        this.fromPos = fromPos;         // Last rendered position [lon, lat]
        this.toPos = toPos;             // New API position [lon, lat]
        this.fromHeading = fromHeading;     // Last rendered heading
        this.toHeading = toHeading;         // New API heading
        this.startTime = startTime;         // performance.now()
        this.duration = duration;           // Time (ms) between server packets
        this.apiSpeedKt = apiSpeedKt;     // Speed for extrapolation
        this.apiHeadingDeg = apiHeadingDeg; // Heading for extrapolation

        // Calculate total distance for interpolation
        this.interpTotalDistanceKm = this._getDistanceKm(
            fromPos[1], fromPos[0], 
            toPos[1], toPos[0]
        );
    }

    /**
     * Calculates the flight's new position and heading for the current frame.
     * @param {number} now - The current timestamp from performance.now().
     * @returns {{coordinates: [number, number], heading: number}}
     */
    update(now) {
        const timeElapsedMs = now - this.startTime;
        const progress = Math.max(0.0, timeElapsedMs / this.duration);

        let finalLon, finalLat, finalHeading;

        if (progress < 1.0) {
            // --- 1. INTERPOLATION PHASE ---
            // We are blending from the last rendered pos to the new API pos.

            // Use an easing function for smoother correction
            // This is an "ease-in-out" curve
            const easeProgress = 0.5 * (1 - Math.cos(Math.PI * Math.min(1.0, progress)));

            // Position: Interpolate along the great-circle path
            const interpPos = this._getIntermediatePoint(
                this.fromPos[1], this.fromPos[0], // from
                this.toPos[1], this.toPos[0],     // to
                easeProgress                      // fraction
            );
            finalLon = interpPos.lon;
            finalLat = interpPos.lat;
            
            // Heading: LERP the heading, also using easing
            let deltaH = this.toHeading - this.fromHeading;
            if (deltaH > 180) deltaH -= 360;
            if (deltaH < -180) deltaH += 360;
            finalHeading = this.fromHeading + (deltaH * easeProgress);

        } else {
            // --- 2. EXTRAPOLATION PHASE ---
            // We have reached the API position and are now predicting future movement.

            const extrapTimeMs = timeElapsedMs - this.duration;
            const distanceToMoveKm = (this.apiSpeedKt * KTS_TO_KMS_PER_MS) * extrapTimeMs;

            const extrapPos = this._getDestinationPoint(
                this.toPos[1],       // Start from last API lat
                this.toPos[0],       // Start from last API lon
                this.apiHeadingDeg,  // Use last API heading
                distanceToMoveKm
            );

            finalLon = extrapPos.lon;
            finalLat = extrapPos.lat;
            finalHeading = this.apiHeadingDeg;
        }
        
        finalHeading = (finalHeading + 360) % 360; // Normalize
        
        return {
            coordinates: [finalLon, finalLat],
            heading: finalHeading
        };
    }
    
    // --- Geo Helpers (Copied from flight.js to ensure module safety) ---

    _toRad(deg) { return (deg * Math.PI) / 180; }
    _toDeg(rad) { return (rad * 180) / Math.PI; }

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

    _getIntermediatePoint(lat1, lon1, lat2, lon2, fraction) {
        const toRad = this._toRad;
        const toDeg = this._toDeg;

        const lat1Rad = toRad(lat1);
        const lon1Rad = toRad(lon1);
        const lat2Rad = toRad(lat2);
        const lon2Rad = toRad(lon2);

        // Use the total distance calculated in the constructor
        const d = this.interpTotalDistanceKm / EARTH_RADIUS_KM; // Angular distance in radians

        if (d === 0 || isNaN(d)) {
            return { lat: lat1, lon: lon1 };
        }
        
        // Handle potential division by zero if sin(d) is 0
        const sin_d = Math.sin(d);
        if (sin_d === 0) {
             return { lat: lat1, lon: lon1 };
        }

        const a = Math.sin((1 - fraction) * d) / sin_d;
        const b = Math.sin(fraction * d) / sin_d;

        const x = a * Math.cos(lat1Rad) * Math.cos(lon1Rad) + b * Math.cos(lat2Rad) * Math.cos(lon2Rad);
        const y = a * Math.cos(lat1Rad) * Math.sin(lon1Rad) + b * Math.cos(lat2Rad) * Math.sin(lon2Rad);
        const z = a * Math.sin(lat1Rad) + b * Math.sin(lat2Rad);

        const latI = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
        const lonI = toDeg(Math.atan2(y, x));

        return { lat: latI, lon: lonI };
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

        // Normalize longitude
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
            // --- 2. AIRBORNE AIRCRAFT: Animate + Extrapolate ---
            const currentFeature = this.currentMapFeatures[flightId];
            const now = performance.now();
            
            // Use the last rendered position as the starting point
            const fromPos = currentFeature ? currentFeature.geometry.coordinates : [newApiLon, newApiLat];
            // Use the last rendered heading as the starting heading
            const fromHeading = currentFeature ? currentFeature.properties.heading : newApiHeading;

            let startTime = now;
            // Use the server packet duration as the animation duration
            const animationDuration = Math.max(500, packetDuration);

            if (!currentFeature) {
                // If it's a new flight, start it in the past so it's already
                // in the extrapolation phase (i.e., appears at its API position).
                startTime = now - (animationDuration + 1);
            }

            // Create and store an instance of the new state class
            this.airborneFlightState.set(flightId, new FlightAnimationState({
                fromPos: fromPos,
                toPos: [newApiLon, newApiLat],
                fromHeading: fromHeading,
                toHeading: newApiHeading,
                startTime: startTime,
                duration: animationDuration,
                apiSpeedKt: newProperties.speed || 0,
                apiHeadingDeg: newApiHeading
            }));

            // Update/create the feature in the master list
            if (currentFeature) {
                // Update properties (like phase, speed, etc.)
                this.currentMapFeatures[flightId].properties = newProperties;
            } else {
                // Create a new feature (geometry will be updated by the loop)
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
     * This loop now *delegates* all calculation to the
     * FlightAnimationState instance for each flight.
     */
    _animationLoop() {
        // Ensure the loop continues
        this.animationFrameId = requestAnimationFrame(this._animationLoop);

        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            return; // Map not ready, wait for next frame
        }

        const now = performance.now();
        let didUpdate = false;

        // --- 1. Update all airborne features ---
        for (const [flightId, animState] of this.airborneFlightState.entries()) {
            const feature = this.currentMapFeatures[flightId];
            if (!feature) {
                // This flight was removed, clean up its animation state
                this.airborneFlightState.delete(flightId);
                continue;
            }
            
            // Delegate all calculation to the individual flight's state object
            const newState = animState.update(now);

            // Update the feature's geometry and heading in the master list
            feature.geometry.coordinates = newState.coordinates;
            feature.properties.heading = newState.heading;
            didUpdate = true;
        }

        if (!didUpdate && this.airborneFlightState.size === 0) {
            // No airborne flights to animate, no need to update source
            // Note: Ground flights are "teleported" in updateFlight,
            // so they still need the source to be set.
        }

        // --- 2. Update the map source with the new state of *all* features ---
        // This single call updates all ground (teleported) and
        // airborne (animated) planes at once.
        source.setData({
            type: 'FeatureCollection',
            features: Object.values(this.currentMapFeatures)
        });
    }
    
    // (Geo helpers are encapsulated in the FlightAnimationState class)
}