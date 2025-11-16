/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle the smooth animation of airborne flights
 * while "teleporting" ground-based flights for a Mapbox GL JS map.
 *
 * REFACTOR (TEST):
 * - Introduces a 'FlightAnimationState' class.
 * - Each instance manages the animation state and update
 * logic for a *single* aircraft.
 * - The main 'MapAnimator' loop is simplified to iterating
 * and delegating the calculations to each instance.
 * - This "individually" handles each plane's animation logic
 * from an object-oriented perspective.
 * ===================================================================
 */

const KTS_TO_KMS_PER_MS = 1.852 / 3600000;
const EARTH_RADIUS_KM = 6371;

/**
 * Manages the animation state and interpolation/extrapolation
 * logic for a single airborne flight.
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
        apiHeadingDeg,
        correctionDist,
        correctionBearing
    }) {
        this.fromPos = fromPos;
        this.toPos = toPos;
        this.fromHeading = fromHeading;
        this.toHeading = toHeading;
        this.startTime = startTime;
        this.duration = duration;
        this.apiSpeedKt = apiSpeedKt;
        this.apiHeadingDeg = apiHeadingDeg;
        this.correctionDist = correctionDist;
        this.correctionBearing = correctionBearing;
    }

    /**
     * Calculates the flight's new position and heading for the current frame.
     * @param {number} now - The current timestamp from performance.now().
     * @returns {{coordinates: [number, number], heading: number}}
     */
    update(now) {
        const timeElapsedMs = now - this.startTime;
        let progress = timeElapsedMs / this.duration;
        progress = Math.max(0.0, progress); // Clamp progress

        // --- 1. Calculate INTERPOLATED HEADING ---
        let finalHeading;
        if (progress < 1.0) {
            // BLENDING: LERP the heading
            let deltaH = this.toHeading - this.fromHeading;
            if (deltaH > 180) deltaH -= 360;
            if (deltaH < -180) deltaH += 360;
            finalHeading = this.fromHeading + (deltaH * progress);
            finalHeading = (finalHeading + 360) % 360; // Normalize
        } else {
            // EXTRAPOLATING: Use the final API heading
            finalHeading = this.apiHeadingDeg;
        }

        // --- 2. Calculate PURE EXTRAPOLATED Position (P_extrap) ---
        const distanceToMoveKm = (this.apiSpeedKt * KTS_TO_KMS_PER_MS) * timeElapsedMs;
        let P_extrap = { lon: this.toPos[0], lat: this.toPos[1] }; // Default

        if (distanceToMoveKm > 0) {
            P_extrap = this._getDestinationPoint(
                this.toPos[1],       // Start from last API lat
                this.toPos[0],       // Start from last API lon
                finalHeading,        // ⭐️ Use the interpolated heading
                distanceToMoveKm
            );
        }

        let finalLon, finalLat;

        if (progress < 1.0) {
            // --- 3. BLENDING (Correction towards Extrapolation) ---

            // --- 3a. Calculate 'Correction' Position (P_interp) ---
            let P_interp_coords;
            if (this.correctionDist > 0) {
                P_interp_coords = this._getDestinationPoint(
                    this.fromPos[1],           // Start from the *last rendered* lat
                    this.fromPos[0],           // Start from the *last rendered* lon
                    this.correctionBearing,    // Use the pre-calculated bearing
                    this.correctionDist * progress // Travel 'progress' % of the way
                );
            } else {
                P_interp_coords = { lon: this.fromPos[0], lat: this.fromPos[1] };
            }
            
            // --- 3b. FINAL Position: Blend P_interp with P_extrap (Eased) ---
            const easeProgress = 0.5 * (1 - Math.cos(Math.PI * progress));

            finalLon = P_interp_coords.lon + (P_extrap.lon - P_interp_coords.lon) * easeProgress;
            finalLat = P_interp_coords.lat + (P_extrap.lat - P_interp_coords.lat) * easeProgress;

        } else {
            // --- 4. PURE EXTRAPOLATING ---
            finalLon = P_extrap.lon;
            finalLat = P_extrap.lat;
        }
        
        return {
            coordinates: [finalLon, finalLat],
            heading: finalHeading
        };
    }
    
    // --- Geo Helper (encapsulated) ---

    _toRad(deg) { return (deg * Math.PI) / 180; }
    _toDeg(rad) { return (rad * 180) / Math.PI; }

    /**
     * Calculates the destination point given a starting point, bearing, and distance.
     */
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
            
            const fromPos = currentFeature ? currentFeature.geometry.coordinates : [newApiLon, newApiLat];
            const fromHeading = currentFeature ? currentFeature.properties.heading : newApiHeading;

            const { distanceKm: correctionDist, initialBearing: correctionBearing } = 
                this._getDistanceAndBearing(
                    fromPos[1], fromPos[0], // from
                    newApiLat, newApiLon    // to
                );

            let startTime = now;
            const animationDuration = Math.max(500, packetDuration);

            if (!currentFeature) {
                startTime = now - (animationDuration + 1);
            }

            // ★★★ REFACTORED ★★★
            // Create and store an instance of the new state class
            this.airborneFlightState.set(flightId, new FlightAnimationState({
                fromPos: fromPos,
                toPos: [newApiLon, newApiLat],
                fromHeading: fromHeading,
                toHeading: newApiHeading,
                startTime: startTime,
                duration: animationDuration,
                apiSpeedKt: newProperties.speed || 0,
                apiHeadingDeg: newApiHeading,
                correctionDist: correctionDist,
                correctionBearing: correctionBearing
            }));

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
     * ★★★ REFACTORED ★★★
     * This loop now *delegates* all calculation to the
     * FlightAnimationState instance for each flight.
     */
    _animationLoop() {
        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            this.animationFrameId = requestAnimationFrame(this._animationLoop);
            return;
        }

        const now = performance.now();

        // --- 1. Update all airborne features ---
        for (const [flightId, animState] of this.airborneFlightState.entries()) {
            const feature = this.currentMapFeatures[flightId];
            if (!feature) {
                this.airborneFlightState.delete(flightId);
                continue;
            }
            
            // ★★★ NEW LOGIC ★★★
            // Delegate all calculation to the individual flight's state object
            const newState = animState.update(now);

            // Update the feature from the result
            feature.geometry.coordinates = newState.coordinates;
            feature.properties.heading = newState.heading;
        }

        // --- 2. Update the map source with the new state of *all* features ---
        source.setData({
            type: 'FeatureCollection',
            features: Object.values(this.currentMapFeatures)
        });

        // --- 3. Request the next animation frame ---
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
    }
    
    _toRad(deg) { return (deg * Math.PI) / 180; }
    _toDeg(rad) { return (rad * 180) / Math.PI; }

    /**
     * Calculates the initial bearing and distance between two points.
     */
    _getDistanceAndBearing(lat1, lon1, lat2, lon2) {
        const toRad = this._toRad;
        const toDeg = this._toDeg;

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
        const distanceKm = EARTH_RADIUS_KM * c;

        if (distanceKm === 0) {
            return { distanceKm: 0, initialBearing: 0 };
        }

        // Initial Bearing
        const y = Math.sin(deltaLon) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
                  Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLon);
        let initialBearing = toDeg(Math.atan2(y, x));
        initialBearing = (initialBearing + 360) % 360; // Normalize

        return { distanceKm, initialBearing };
    }
}