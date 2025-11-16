/**
 * MapAnimator.js  — improved interpolation + initial placement fix
 * Replaces previous version. Uses Cubic Hermite (smooth) interpolation
 * across the last two API points, blends to extrapolation, and avoids
 * initial-placement jumps by creating new features at the API position.
 */

export class MapAnimator {
    constructor(map, sourceName, featuresObject) {
        this.map = map;
        this.sourceName = sourceName;
        this.currentMapFeatures = featuresObject;
        this.airborneFlightState = new Map();
        this.animationFrameId = null;
        this._animationLoop = this._animationLoop.bind(this);
    }

    start() {
        this.stop();
        this.animationFrameId = requestAnimationFrame(this._animationLoop);
        console.log('MapAnimator started.');
    }

    stop() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
        this.airborneFlightState.clear();
        console.log('MapAnimator stopped.');
    }

    /**
     * Update flight with a new API packet.
     * newPosition: { lon, lat, heading_deg? }
     * newProperties: full properties object (must include flightId, speed, phase)
     * packetDuration: ms since last packet (server)
     */
    updateFlight(newPosition, newProperties, packetDuration) {
        const flightId = newProperties.flightId;
        const toLon = Number(newPosition.lon);
        const toLat = Number(newPosition.lat);
        const toHeading = (newPosition.heading_deg !== undefined) ? Number(newPosition.heading_deg) : 0;
        const now = performance.now();

        if (newProperties.phase === 'Ground') {
            // Teleport ground aircraft — update master object directly and clear animation state.
            this.currentMapFeatures[flightId] = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [toLon, toLat] },
                properties: newProperties
            };
            this.airborneFlightState.delete(flightId);
            return;
        }

        // Airborne logic
        const curFeature = this.currentMapFeatures[flightId];
        const state = this.airborneFlightState.get(flightId) || {};

        // TIMESTAMPED HISTORY — keep up to two API points
        // state.apiHistory = [{ lon, lat, heading, t }, ...] newest at end
        if (!state.apiHistory) state.apiHistory = [];

        // push new API point (but avoid duplicate timestamp noise)
        const last = state.apiHistory[state.apiHistory.length - 1];
        if (!last || Math.abs(now - (last.t || 0)) > 1) {
            state.apiHistory.push({ lon: toLon, lat: toLat, heading: toHeading, t: now });
            // keep only last two
            if (state.apiHistory.length > 2) state.apiHistory.shift();
        }

        // If feature doesn't exist yet — create it at the API position immediately.
        if (!curFeature) {
            this.currentMapFeatures[flightId] = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [toLon, toLat] },
                properties: newProperties
            };

            // Initialize animation state so there's no visible teleport.
            this.airborneFlightState.set(flightId, {
                fromPos: [toLon, toLat],
                toPos: [toLon, toLat],
                fromHeading: toHeading,
                toHeading: toHeading,
                startTime: now,
                duration: Math.max(300, packetDuration || 500),
                apiSpeedKt: newProperties.speed || 0,
                apiHeadingDeg: toHeading,
                apiHistory: state.apiHistory
            });
            return;
        }

        // For existing features: set up new target with blending
        const animationDuration = Math.max(300, packetDuration || 500);
        const newState = {
            fromPos: curFeature.geometry.coordinates.slice(), // [lon, lat] current rendered
            toPos: [toLon, toLat],
            fromHeading: (curFeature.properties && curFeature.properties.heading) ? Number(curFeature.properties.heading) : toHeading,
            toHeading: toHeading,
            startTime: now,
            duration: animationDuration,
            apiSpeedKt: newProperties.speed || 0,
            apiHeadingDeg: toHeading,
            apiHistory: state.apiHistory
        };

        // Update stored props (callsign, etc.) but not geometry (loop will animate)
        this.currentMapFeatures[flightId].properties = newProperties;
        this.airborneFlightState.set(flightId, newState);
    }

    removeFlight(flightId) {
        delete this.currentMapFeatures[flightId];
        this.airborneFlightState.delete(flightId);
    }

    _animationLoop() {
        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            this.animationFrameId = requestAnimationFrame(this._animationLoop);
            return;
        }

        const now = performance.now();
        const KTS_TO_KMS_PER_MS = 1.852 / 3600000;

        for (const [flightId, state] of this.airborneFlightState.entries()) {
            const feature = this.currentMapFeatures[flightId];
            if (!feature) {
                this.airborneFlightState.delete(flightId);
                continue;
            }

            const timeElapsedMs = now - state.startTime;
            const progressRaw = state.duration > 0 ? (timeElapsedMs / state.duration) : 1;
            const progress = Math.min(Math.max(progressRaw, 0), 1);

            // ---------- 1) Compute P_extrap (dead reckoning) ----------
            const distanceToMoveKm = (state.apiSpeedKt * KTS_TO_KMS_PER_MS) * (now - (state.apiHistory && state.apiHistory[state.apiHistory.length - 1]?.t || now));
            let P_extrap = { lon: state.toPos[0], lat: state.toPos[1] };
            if (distanceToMoveKm > 0.000001) {
                P_extrap = this._getDestinationPoint(state.toPos[1], state.toPos[0], state.apiHeadingDeg, distanceToMoveKm);
            }

            // ---------- 2) Compute P_interp using Cubic Hermite (if we have history) ----------
            let P_interp = { lon: state.toPos[0], lat: state.toPos[1] }; // fallback to direct
            const hist = state.apiHistory || [];
            if (hist.length >= 2) {
                // hist[0] = prev, hist[1] = curr (new API point)
                const prev = hist[0];
                const curr = hist[1];

                // times and positions
                const dtPrev = curr.t - prev.t || 1; // ms
                const dtCurr = state.duration || 500; // use duration to scale tangents

                // velocities (deg per ms) approximate in lon/lat degrees
                const vPrev = { lon: (curr.lon - prev.lon) / dtPrev, lat: (curr.lat - prev.lat) / dtPrev };
                // Use most recent velocity for tangent at curr; for previous tangent use vPrev as well
                const m0 = { lon: vPrev.lon * dtCurr, lat: vPrev.lat * dtCurr };
                const m1 = { lon: vPrev.lon * dtCurr, lat: vPrev.lat * dtCurr };

                // cubic hermite between previous point and current API point with normalized t within the correction window
                const t = progress; // 0..1 across the correction duration
                const herm = this._cubicHermite({ lon: prev.lon, lat: prev.lat }, { lon: curr.lon, lat: curr.lat }, m0, m1, t);
                P_interp = { lon: herm.lon, lat: herm.lat };
            } else {
                // fallback: eased LERP between fromPos and toPos
                const fromLon = state.fromPos[0], fromLat = state.fromPos[1];
                const toLon = state.toPos[0], toLat = state.toPos[1];
                const easedT = this._easeInOutCubic(progress);
                P_interp.lon = fromLon + (toLon - fromLon) * easedT;
                P_interp.lat = fromLat + (toLat - fromLat) * easedT;
            }

            // ---------- 3) Blend P_interp toward P_extrap (progress weights) ----------
            // We use eased progress to produce a smoother handoff
            const blendT = this._easeInOutCubic(progress);
            const finalLon = P_interp.lon + (P_extrap.lon - P_interp.lon) * blendT;
            const finalLat = P_interp.lat + (P_extrap.lat - P_interp.lat) * blendT;

            // ---------- 4) Heading interpolation (shortest path) ----------
            let finalHeading;
            // choose fromHeading & toHeading if present, else apiHeading
            const fromH = Number(state.fromHeading || state.apiHeadingDeg || 0);
            const toH = Number(state.toHeading || state.apiHeadingDeg || fromH);
            let deltaH = toH - fromH;
            if (deltaH > 180) deltaH -= 360;
            if (deltaH < -180) deltaH += 360;
            finalHeading = fromH + deltaH * Math.min(1, progress);
            finalHeading = ((finalHeading % 360) + 360) % 360;

            // Update rendered feature
            feature.geometry.coordinates = [Number(finalLon), Number(finalLat)];
            // keep properties.heading consistent for other code that reads it
            feature.properties.heading = finalHeading;
        }

        // push all features out
        source.setData({
            type: 'FeatureCollection',
            features: Object.values(this.currentMapFeatures)
        });

        this.animationFrameId = requestAnimationFrame(this._animationLoop);
    }

    /** Cubic Hermite interpolation for 2D lon/lat points.
     *  p0, p1 = {lon, lat}, m0, m1 = tangents in same units as lon/lat
     *  t in [0,1]
     */
    _cubicHermite(p0, p1, m0, m1, t) {
        const t2 = t * t, t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        return {
            lon: h00 * p0.lon + h10 * m0.lon + h01 * p1.lon + h11 * m1.lon,
            lat: h00 * p0.lat + h10 * m0.lat + h01 * p1.lat + h11 * m1.lat
        };
    }

    _easeInOutCubic(t) {
        // standard smooth ease
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    _getDestinationPoint(lat, lon, bearing, distanceKm) {
        const R = 6371;
        const toRad = (deg) => (deg * Math.PI) / 180;
        const toDeg = (rad) => (rad * 180) / Math.PI;
        const latRad = toRad(lat);
        const lonRad = toRad(lon);
        const brRad = toRad(bearing);
        const ang = distanceKm / R;
        const destLatRad = Math.asin(Math.sin(latRad) * Math.cos(ang) +
            Math.cos(latRad) * Math.sin(ang) * Math.cos(brRad));
        let destLonRad = lonRad + Math.atan2(Math.sin(brRad) * Math.sin(ang) * Math.cos(latRad),
            Math.cos(ang) - Math.sin(latRad) * Math.sin(destLatRad));
        destLonRad = (destLonRad + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        return { lat: toDeg(destLatRad), lon: toDeg(destLonRad) };
    }
}
