/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle smooth animation of flight positions on a Mapbox GL JS map.
 *
 * --- [Hybrid Interpolation/Extrapolation Model] ---
 *
 * This animator attempts to solve the problem of inconsistent,
 * out-of-order, and stale data from the API.
 *
 * It maintains an internal state for every flight and runs a 60fps
 * animation loop.
 *
 * 1.  Guard Clauses: It ignores out-of-order (old timestamps)
 * and stale (identical position) packets.
 * 2.  Turn Rate Calculation: It stores the previous two data points
 * to calculate a `turnRate` (degrees per second).
 * 3.  Hybrid Logic:
 * - If data is "fresh" (e.g., < 3 seconds old), it INTERPOLATES
 * (smooths) the plane's visual position towards the target position.
 * This fixes the "stutter" from 1-2 second stale packets.
 * - If data is "stale" (e.g., > 3 seconds old), it EXTRAPOLATES
 * (predicts) the plane's next position using its last known
 * speed, heading, and turn rate. This handles the 10-second gaps.
 *
 * As we discussed, this logic is advanced, but *will still fail*
 * (i.e., cause a "jump") if a plane begins or ends a turn
 * *during* a long data gap. This is an unavoidable limitation
 * of the data source.
 * ===================================================================
 */

// --- Configuration ---

// How long to wait for new data before switching from smoothing
// (interpolating) to "dead reckoning" (extrapolating).
const STALE_DATA_THRESHOLD_MS = 3000; // 3 seconds

// How "fast" the interpolation should be when data is fresh.
// A value of 1.0 means it tries to catch up in 1 second.
// A value of 5.0 is a "tighter" follow.
// A lower value (e.g., 0.5) is a "looser" follow.
const INTERPOLATION_SPEED_FACTOR = 1.5;

/**
 * Manages the animation loop and state for all flights.
 */
export class MapAnimator {
    /**
     * @param {mapboxgl.Map} map - The Mapbox map instance.
     * @param {string} sourceName - The name of the GeoJSON source to update.
     */
    constructor(map, sourceName) {
        this.map = map;
        this.sourceName = sourceName;

        /**
         * @type {Map<string, FlightState>}
         * Stores the animation state for every flight.
         * Key: flightId, Value: FlightState object
         */
        this.flights = new Map();

        this.animationFrameId = null;
        this.lastFrameTime = 0;

        // Bind the animation loop to this class instance
        this._animationLoop = this._animationLoop.bind(this);
    }

    /**
     * Starts the 60fps animation loop.
     */
    start() {
        console.log('MapAnimator (Hybrid) started.');
        this.lastFrameTime = performance.now();
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
    }

    /**
     * Stops the animation loop.
     */
    stop() {
        console.log('MapAnimator (Hybrid) stopped.');
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * The "data-in" function. Called by the websocket client.
     * This function just updates the *target* state for a flight.
     * The animation loop handles moving the plane.
     *
     * @param {object} newPosition - {lon, lat}
     * @param {object} newProperties - The full properties object from the API,
     * Must include: flightId, lastReportMs,
     * heading_deg, gs_kt (ground speed).
     */
    updateFlight(newPosition, newProperties) {
        const flightId = newProperties.flightId;
        if (!flightId) return;

        let state = this.flights.get(flightId);

        if (!state) {
            // This is a new flight. Create a new state for it.
            state = new FlightState(newProperties);
            this.flights.set(flightId, state);
        } else {
            // This is an existing flight. Update its target data.
            state.updateTarget(newProperties);
        }
    }

    /**
     * Removes a flight from the animator.
     * @param {string} flightId
     */
    removeFlight(flightId) {
        this.flights.delete(flightId);
    }

    /**
     * The "heartbeat" of the animator. Runs 60 times/sec.
     */
    _animationLoop() {
        const now = performance.now();
        // Time since *last frame* in seconds.
        const deltaTime = (now - this.lastFrameTime) / 1000;

        const features = [];

        for (const [flightId, state] of this.flights.entries()) {
            // Time since *last data packet* in milliseconds.
            const dataGapMs = now - state.lastUpdateTime;

            // 1. Decide: Are we smoothing or predicting?
            if (dataGapMs > STALE_DATA_THRESHOLD_MS) {
                // DATA IS STALE: Extrapolate (predict)
                state.extrapolate(deltaTime);
            } else {
                // DATA IS FRESH: Interpolate (smooth)
                state.interpolate(deltaTime);
            }

            // 2. Get the new visual state as a GeoJSON feature
            features.push(state.toGeoJSON());
        }

        // 3. Update the map source with all new positions at once
        this._updateMapSource(features);

        // 4. Set up the next frame
        this.lastFrameTime = now;
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
    }

    /**
     * Pushes the new GeoJSON feature collection to the Mapbox source.
     * @param {Array<object>} features - An array of GeoJSON features.
     */
    _updateMapSource(features) {
        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            return;
        }

        source.setData({
            type: 'FeatureCollection',
            features: features
        });
    }
}

/**
 * A class to hold the animation and data state for a single flight.
 */
class FlightState {
    constructor(properties) {
        // The *actual* data from the last valid packet. This is our "goal".
        this.targetData = this._parsePacket(properties);
        
        // The *previous* data packet. Used for turn-rate calculation.
        this.previousData = null;

        // The *visual* state. This is what's on the map.
        // We initialize it to the target position.
        this.visualState = { ...this.targetData };

        // The `performance.now()` timestamp of the last *valid* data packet.
        this.lastUpdateTime = performance.now();
    }

    /**
     * Updates the flight's target data with a new packet.
     * @param {object} properties - The new flight properties packet.
     * @returns {boolean} - True if the data was valid and accepted.
     */
    updateTarget(properties) {
        const newPacket = this._parsePacket(properties);

        // --- Guard Clauses ---
        // 1. Out-of-Order Data Guard:
        //    (e.g., packet `...:32Z` arrives after `...:34Z`)
        if (newPacket.timestamp <= this.targetData.timestamp) {
            return false;
        }

        // 2. Stale Position Guard:
        //    (e.g., timestamp is new, but lat/lon are identical)
        if (newPacket.lat === this.targetData.lat && 
            newPacket.lon === this.targetData.lon) {
            return false;
        }

        // --- Data is New and Valid ---
        // Shift old data
        this.previousData = this.targetData;
        this.targetData = newPacket;

        // Calculate the turn rate based on the last two points
        this._calculateTurnRate();

        // Update the timestamp
        this.lastUpdateTime = performance.now();
        return true;
    }

    /**
     * Calculates and stores the turn rate (deg/sec) in `targetData`.
     */
    _calculateTurnRate() {
        if (!this.previousData || !this.targetData) {
            this.targetData.turnRate = 0;
            return;
        }

        const timeDiffSec = (this.targetData.timestamp - this.previousData.timestamp) / 1000;
        if (timeDiffSec <= 0) {
            this.targetData.turnRate = 0;
            return;
        }

        const headingDiff = _getHeadingDiff(
            this.previousData.heading,
            this.targetData.heading
        );

        this.targetData.turnRate = headingDiff / timeDiffSec;
    }

    /**
     * INTERPOLATE (Smooth): Move the visual state towards the target state.
     * @param {number} deltaTime - Time since last frame (seconds).
     */
    interpolate(deltaTime) {
        const factor = INTERPOLATION_SPEED_FACTOR * deltaTime;

        // Lerp (Linear Interpolate) the position
        this.visualState.lat = _lerp(
            this.visualState.lat,
            this.targetData.lat,
            factor
        );
        this.visualState.lon = _lerp(
            this.visualState.lon,
            this.targetData.lon,
            factor
        );

        // Special Lerp for heading (finds shortest path)
        this.visualState.heading = _lerpHeading(
            this.visualState.heading,
            this.targetData.heading,
            factor
        );
        
        // Also smooth the speed, so the prediction logic doesn't
        // suddenly get a new value.
        this.visualState.speed_kt = _lerp(
            this.visualState.speed_kt,
            this.targetData.speed_kt,
            factor
        );
    }

    /**
     * EXTRAPOLATE (Predict): Project the next position based on
     * the last known speed, heading, and turn rate.
     * @param {number} deltaTime - Time since last frame (seconds).
     */
    extrapolate(deltaTime) {
        // Use the *visual* state's speed, which is smoothed
        const speed_kt = this.visualState.speed_kt;
        
        // Use the last known (calculated) turn rate
        const turnRate = this.targetData.turnRate || 0;

        // 1. Calculate the new heading based on the turn rate
        const newHeading = _normalizeHeading(
            this.visualState.heading + (turnRate * deltaTime)
        );

        // 2. Project the new lat/lon from the *current visual position*
        //    using the *newly calculated heading*.
        const [newLat, newLon] = _projectPosition(
            this.visualState.lat,
            this.visualState.lon,
            speed_kt,
            newHeading, // Use the *new* heading for projection
            deltaTime
        );
        
        // 3. Update the visual state to this new predicted position
        this.visualState.lat = newLat;
        this.visualState.lon = newLon;
        this.visualState.heading = newHeading;
    }

    /**
     * Creates a GeoJSON feature from the *visual* state.
     * @returns {object} A GeoJSON Point Feature.
     */
    toGeoJSON() {
        return {
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [this.visualState.lon, this.visualState.lat]
            },
            properties: {
                // Pass all target properties (callsign, etc.)
                ...this.targetData.rawProperties,
                
                // Overwrite with the animated values
                flightId: this.targetData.flightId,
                heading_deg: this.visualState.heading
            }
        };
    }

    /**
     * Helper to parse the raw API packet into a clean object.
     */
    _parsePacket(properties) {
        // --- !!! IMPORTANT !!! ---
        // You MUST adjust these properties to match your API data!
        return {
            lat: properties.position.lat,
            lon: properties.position.lon,
            heading: properties.position.heading_deg,
            speed_kt: properties.position.gs_kt,
            timestamp: properties.position.lastReportMs, // The real data timestamp
            flightId: properties.flightId,
            turnRate: 0, // Will be calculated
            rawProperties: properties // Store for the GeoJSON
        };
    }
}


// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Linear interpolation.
 * @param {number} start
 * @param {number} end
 * @param {number} amt - A value from 0.0 to 1.0
 * @returns {number}
 */
function _lerp(start, end, amt) {
    // Clamp amt to 0-1 range
    const t = Math.max(0, Math.min(1, amt));
    return (1 - t) * start + t * end;
}

/**
 * Keeps a heading value between 0 and 359.9...
 * @param {number} heading
 * @returns {number}
 */
function _normalizeHeading(heading) {
    return (heading % 360 + 360) % 360;
}

/**
 * Calculates the shortest angle difference between two headings.
 * e.g., from 350 to 10 is +20, not -340.
 * @param {number} start
 * @param {number} end
 * @returns {number} The difference (e.g., -20 or +20)
 */
function _getHeadingDiff(start, end) {
    const diff = (end - start + 180) % 360 - 180;
    return diff < -180 ? diff + 360 : diff;
}

/**
 * Interpolates a heading, finding the shortest path.
 * @param {number} start
 * @param {number} end
 * @param {number} amt
 * @returns {number}
 */
function _lerpHeading(start, end, amt) {
    const diff = _getHeadingDiff(start, end);
    // Clamp amt to 0-1 range
    const t = Math.max(0, Math.min(1, amt));
    return _normalizeHeading(start + diff * t);
}

// --- Geospatial Projection (Dead Reckoning) ---

const EARTH_RADIUS_NM = 3440.065; // Earth's radius in Nautical Miles

/**
 * Projects a new lat/lon position from a starting point,
 * given a speed, heading, and time.
 *
 * @param {number} lat - Starting latitude
 * @param {number} lon - Starting longitude
 * @param {number} speed_kt - Speed in knots (nautical miles per hour)
 * @param {number} heading - Heading in degrees (0-360)
 * @param {number} deltaTime - Time in seconds
 * @returns {[number, number]} - [newLat, newLon]
 */
function _projectPosition(lat, lon, speed_kt, heading, deltaTime) {
    // 1. Calculate distance traveled in nautical miles
    const distanceNm = speed_kt * (deltaTime / 3600); // (seconds / (sec/hr))
    if (distanceNm === 0) {
        return [lat, lon];
    }
    
    // 2. Convert to radians
    const distRad = distanceNm / EARTH_RADIUS_NM;
    const latRad = (lat * Math.PI) / 180;
    const lonRad = (lon * Math.PI) / 180;
    const headingRad = (heading * Math.PI) / 180;

    // 3. Calculate new latitude
    const newLatRad = Math.asin(
        Math.sin(latRad) * Math.cos(distRad) +
        Math.cos(latRad) * Math.sin(distRad) * Math.cos(headingRad)
    );

    // 4. Calculate new longitude
    const newLonRad = lonRad + Math.atan2(
        Math.sin(headingRad) * Math.sin(distRad) * Math.cos(latRad),
        Math.cos(distRad) - Math.sin(latRad) * Math.sin(newLatRad)
    );

    // 5. Convert back to degrees
    const newLat = (newLatRad * 180) / Math.PI;
    const newLon = (newLonRad * 180) / Math.PI;

    return [newLat, newLon];
}