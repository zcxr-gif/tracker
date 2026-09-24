/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * Pushes live traffic to the Mapbox GeoJSON source, and makes aircraft
 * glide between position reports instead of jumping.
 *
 * --- Frame-coalesced flushes ---
 * flight.js writes each packet into the shared feature cache
 * (currentMapFeatures) and asks for one flush; a single setData() runs on
 * the next animation frame with the final state of the tick, and is held
 * while the camera moves (see bindInteraction).
 *
 * --- Slim render features ---
 * setData() JSON-stringifies the whole FeatureCollection on the main thread.
 * The cached properties carry fields no layer ever reads — the full
 * position and aircraft objects as JSON strings, photo URL lists — which
 * more than doubled that string. Benchmarked with mapbox-gl 3.16 and 1,500
 * aircraft, a flush took ~34 ms of main thread with them and ~12 ms
 * without (~4 ms with the `dynamic` source flight.js now creates). The map
 * therefore gets its own lean copy of each feature; click/hover handlers
 * read the full record from currentMapFeatures by flightId.
 *
 * --- Glide ---
 * Between reports each visible aircraft is dead-reckoned along its ground
 * track. When a new report lands, the gap between where the plane was
 * drawn and where it really is gets eased out over CORRECTION_MS rather
 * than snapped, and heading changes rotate over HEADING_MS. Only aircraft
 * in the viewport are touched, through `updateData()` on a `dynamic`
 * source, which re-tiles just the features sent. The update rate follows
 * on-screen speed — about GLIDE_STEP_PX per push — so a zoomed-out view
 * where planes crawl a pixel a minute costs nothing, and a close-up
 * approaches the display rate. MapLibre (free map mode) has no compatible
 * `updateData`, so there aircraft keep moving report to report.
 * ===================================================================
 */

// Properties no map layer reads. Kept out of the render copy so they are
// never serialised to the worker; handlers fetch them from the cache.
const HEAVY_PROPS = new Set([
    'position', 'aircraft', '__acSig', 'last_update',
    'communityImageUrl', 'communityImageUrls', 'imageContributors', 'contributorName'
]);

function slimPropsGeneric(props) {
    const out = {};
    for (const k in props) {
        if (!HEAVY_PROPS.has(k)) out[k] = props[k];
    }
    return out;
}

// Every packet hands us ~1,500 fresh properties objects that all share one
// literal shape (flight.js builds them the same way each time). A generic
// for-in copy of those cost ~5.5 ms a flush — as much as the serialisation it
// saves — so the copy is compiled once per key layout into a plain object
// literal (~0.3 ms). The layout check compares the key arrays element by
// element, so an object with any other shape gets its own copier.
const _copierByShape = new Map();
let _lastKeys = null;
let _lastCopier = null;

function compileCopier(keys) {
    try {
        const fields = keys
            .filter((k) => !HEAVY_PROPS.has(k))
            .map((k) => `${JSON.stringify(k)}:p[${JSON.stringify(k)}]`);
        // eslint-disable-next-line no-new-func
        return new Function('p', `return {${fields.join(',')}};`);
    } catch (_) {
        return slimPropsGeneric; // e.g. a CSP without 'unsafe-eval'
    }
}

function slimProps(props) {
    const keys = Object.keys(props);
    let same = _lastKeys !== null && keys.length === _lastKeys.length;
    for (let i = 0; same && i < keys.length; i++) {
        if (keys[i] !== _lastKeys[i]) same = false;
    }
    if (!same) {
        const sig = keys.join('\u0001');
        let copier = _copierByShape.get(sig);
        if (!copier) {
            copier = compileCopier(keys);
            if (_copierByShape.size < 32) _copierByShape.set(sig, copier);
        }
        _lastKeys = keys;
        _lastCopier = copier;
    }
    return _lastCopier(props);
}

const DEG2RAD = Math.PI / 180;
const M_PER_DEG = 111320;
const KT_TO_MS = 0.514444;

const wrapLon = (lon) => ((lon + 540) % 360) - 180;
const smoothstep = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const angleDelta = (from, to) => ((to - from + 540) % 360) - 180;

export class MapAnimator {
    // Longest a source update may be held back by camera interaction. A pinch
    // held mid-gesture, or a slow flyTo, must not stall live traffic forever.
    static MAX_DEFER_MS = 2000;

    // Longest a pending flush keeps retrying while the map reports it isn't
    // ready (style swapping, sources still loading). See _updateMapSource().
    static MAX_RETRY_MS = 10000;

    // --- Glide tuning ---
    // Below this zoom a jetliner moves well under a pixel a second; there is
    // nothing to smooth.
    static GLIDE_MIN_ZOOM = 7;
    // More movers than this in view and gliding is skipped for the tick —
    // the aircraft simply move report to report, as before.
    static GLIDE_MAX_FEATURES = 400;
    // Target on-screen distance per push; sets the update rate.
    static GLIDE_STEP_PX = 0.5;
    static GLIDE_MIN_INTERVAL_MS = 16;
    static GLIDE_MAX_INTERVAL_MS = 1000;
    // While a correction or turn is easing, push at least this often.
    static GLIDE_EASE_INTERVAL_MS = 33;
    static CORRECTION_MS = 1200;
    static HEADING_MS = 900;
    // Stop extrapolating a contact this long after its last report, so a
    // stalled feed can't send it sailing across the map.
    static MAX_DR_MS = 20000;
    // A correction bigger than this (~55 km) is a teleport, not drift: snap.
    static SNAP_DEG = 0.5;
    // Ground speeds under this are parked/taxi noise: don't extrapolate.
    static MIN_GLIDE_KT = 3;
    // Sanity cap on a velocity derived from two reports (m/s, ~Mach 2).
    static MAX_SPEED_MS = 700;

    /**
     * @param {mapboxgl.Map} map - The Mapbox map instance.
     * @param {string} sourceName - The name of the GeoJSON source to update.
     * @param {Object} featuresObject - A *reference* to the master features object (currentMapFeatures) in flight.js.
     */
    constructor(map, sourceName, featuresObject) {
        this.map = map;
        this.sourceName = sourceName;
        this.currentMapFeatures = featuresObject; // This is a SHARED REFERENCE

        // Frame-coalescing state.
        this._frameHandle = null;   // pending requestAnimationFrame id
        this._dirty = false;        // feature data changed since the last flush
        this._stopped = false;
        this._retryingSince = 0;    // when the current not-ready retry began

        // Render copies: flightId -> { feature, src, m, gen }.
        //   feature: the lean Feature handed to Mapbox (reused across flushes)
        //   src:     the cached properties object `feature.properties` was built from
        //   m:       motion state for glide (see _noteFix)
        this._render = new Map();
        this._featureList = [];
        this._gen = 0;
        this._nextId = 1e9;         // ids for features that arrive without one
        this._propsStale = true;    // rebuild every render copy on next flush

        // Camera-interaction gating (see bindInteraction).
        this._interacting = false;
        this._deferredSince = 0;
        this._unbindInteraction = null;

        // Glide loop state.
        this._glideHandle = null;
        this._lastGlidePush = 0;
        this._glideInterval = MapAnimator.GLIDE_MAX_INTERVAL_MS;
        this._glideGate = null;     // optional () => boolean from the host
        this._onVisibility = () => { if (!document.hidden) this._kickGlide(); };
        document.addEventListener('visibilitychange', this._onVisibility);
    }

    /**
     * Suspends source updates while the camera is moving.
     *
     * `setData()` is not a cheap assignment: Mapbox throws away the source's
     * tile index, rebuilds it, and re-runs symbol layout — glyph and icon
     * quads, collision boxes — for every tile, across all four layers drawn
     * from this source. When that lands in the middle of a pinch or a wheel
     * zoom it competes with the tiles the gesture is already asking for, and
     * the freshly rebuilt tiles swap in underneath the user: aircraft and
     * labels visibly blink out and back. That is the "loading in and out"
     * during zoom.
     *
     * Live positions arrive every few seconds, so holding one update for the
     * length of a gesture costs nothing perceptible — the flush happens the
     * moment the camera settles, with the newest data. `movestart`/`moveend`
     * cover zoom, pan, rotate, pitch and programmatic flyTo alike. Glide
     * pauses for the same window and resumes on `moveend`.
     *
     * @param {mapboxgl.Map} [map] Defaults to the map this animator drives.
     */
    bindInteraction(map) {
        const target = map || this.map;
        if (!target || this._unbindInteraction) return;

        const onStart = () => { this._interacting = true; };
        const onEnd = () => {
            this._interacting = false;
            this._deferredSince = 0;
            // Repaint immediately rather than waiting for the next frame, so
            // the map is correct the instant the camera stops.
            if (this._dirty && !this._stopped) this._updateMapSource();
            this._kickGlide();
        };

        target.on('movestart', onStart);
        target.on('moveend', onEnd);

        this._unbindInteraction = () => {
            target.off('movestart', onStart);
            target.off('moveend', onEnd);
            this._unbindInteraction = null;
        };
    }

    /**
     * Whether a flush should be held back right now. A gesture can be held
     * indefinitely (a finger resting mid-pinch, a long flyTo), so updates are
     * only ever deferred for MAX_DEFER_MS before being let through.
     */
    _shouldDefer() {
        if (!this._interacting) return false;
        const now = Date.now();
        if (!this._deferredSince) { this._deferredSince = now; return true; }
        return (now - this._deferredSince) < MapAnimator.MAX_DEFER_MS;
    }

    /**
     * Starts the animator. (Flushes are frame-driven; glide starts itself.)
     */
    start() {
        this._stopped = false;
        this._kickGlide();
    }

    /**
     * Stops the animator and cancels any pending flush or glide frame.
     */
    stop() {
        this._stopped = true;
        if (this._frameHandle !== null) {
            cancelAnimationFrame(this._frameHandle);
            this._frameHandle = null;
        }
        if (this._glideHandle !== null) {
            cancelAnimationFrame(this._glideHandle);
            this._glideHandle = null;
        }
        if (this._unbindInteraction) this._unbindInteraction();
    }

    /**
     * Lets the host veto gliding (a user setting, or the 3D traffic view
     * hiding the flat icons). Checked every glide frame.
     * @param {() => boolean} gate
     */
    setGlideGate(gate) {
        this._glideGate = typeof gate === 'function' ? gate : null;
        this._kickGlide();
    }

    /**
     * Updates or creates a flight's state based on new data.
     *
     * flight.js owns the same cache and has usually written the feature
     * already, so the common path here is an in-place refresh.
     *
     * @param {object} newPosition - {lon, lat, heading_deg}
     * @param {object} newProperties - The full properties object.
     */
    updateFlight(newPosition, newProperties) {
        const flightId = newProperties.flightId;
        const existing = this.currentMapFeatures[flightId];

        if (existing && existing.geometry) {
            existing.properties = newProperties;
            existing.geometry.coordinates[0] = newPosition.lon;
            existing.geometry.coordinates[1] = newPosition.lat;
        } else {
            this.currentMapFeatures[flightId] = {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [newPosition.lon, newPosition.lat]
                },
                properties: newProperties
            };
        }

        this.scheduleUpdate();
    }

    /**
     * Removes a flight from the map.
     * @param {string} flightId
     */
    removeFlight(flightId) {
        if (!(flightId in this.currentMapFeatures)) return;
        delete this.currentMapFeatures[flightId];
        this.scheduleUpdate();
    }

    /**
     * Marks the source dirty and queues a single flush for the next frame.
     * Cheap to call repeatedly — the whole point is that a tick's worth of
     * per-aircraft updates collapses into one `setData()`.
     */
    scheduleUpdate() {
        this._dirty = true;
        if (this._frameHandle !== null || this._stopped) return;

        this._frameHandle = requestAnimationFrame(() => {
            this._frameHandle = null;
            if (!this._dirty) return;
            // Hold the update while the camera is moving; moveend flushes it.
            // Re-arming here is what lets the MAX_DEFER_MS escape hatch fire
            // during a gesture that never seems to end.
            if (this._shouldDefer()) {
                this.scheduleUpdate();
                return;
            }
            this._updateMapSource();
        });
    }

    /**
     * Kept for callers of the old API. The render list is rebuilt from the
     * cache on every flush, so there is no snapshot to invalidate.
     */
    invalidateRoster() {}

    /**
     * Call after mutating a cached feature's properties *in place* (re-tags
     * like pilotRelation or __inRadius, a late-arriving tail number): render
     * copies are otherwise only rebuilt when the properties object changes.
     */
    invalidateProps() {
        this._propsStale = true;
    }

    /**
     * Pushes the current state to the map right now, skipping the frame
     * coalescing and camera gating — for user-initiated re-tags that should
     * show immediately.
     */
    flushNow() {
        this._dirty = true;
        if (!this._stopped) this._updateMapSource();
    }

    /**
     * Pushes the current state of *all* features to the map source
     * immediately. Callers that need the map in sync right now (rather than
     * next frame) can still call this directly.
     */
    _updateMapSource() {
        const source = this.map.getSource(this.sourceName);
        if (!source || !this.map.isStyleLoaded()) {
            // Not ready yet — most often mid style-change, where the source has
            // just been re-created empty and the style's own tiles are still
            // arriving. Dropping the flush here left the map bare until the
            // next socket packet happened to land (seconds, or far longer on a
            // quiet server), which read as "the planes never came back after
            // switching the map". Retry on the following frame instead, bounded
            // so a removed or permanently wedged map can't spin forever.
            if (this._stopped || !this._dirty) return;
            const now = Date.now();
            if (!this._retryingSince) this._retryingSince = now;
            if (now - this._retryingSince < MapAnimator.MAX_RETRY_MS) {
                this.scheduleUpdate();
            } else {
                this._retryingSince = 0; // give up; the next packet tries again
            }
            return;
        }

        this._retryingSince = 0;
        this._dirty = false;

        // The wrapper is fresh each flush (Mapbox holds on to the object it
        // is given); the feature objects inside are reused.
        source.setData({
            type: 'FeatureCollection',
            features: this._syncRender(performance.now())
        });
        this._kickGlide();
    }

    /**
     * Brings the render copies in line with the cache and returns them as the
     * array to hand Mapbox. Picks up new reports into the glide state and
     * writes each feature at the position it is *drawn* at, so a flush never
     * yanks a gliding plane back to its (older) report position.
     */
    _syncRender(now) {
        const feats = this.currentMapFeatures;
        const render = this._render;
        const list = this._featureList;
        const gen = ++this._gen;
        const rebuildAll = this._propsStale;
        this._propsStale = false;
        // Off (zoomed out, free map, user setting): draw reports as they are.
        const glide = !!this._glideSource();
        list.length = 0;

        for (const key in feats) {
            const f = feats[key];
            if (!f || !f.geometry || !f.properties) continue;

            let r = render.get(key);
            if (!r) {
                r = {
                    feature: {
                        type: 'Feature',
                        id: f.id != null ? f.id : this._nextId++,
                        geometry: { type: 'Point', coordinates: [0, 0] },
                        properties: null
                    },
                    src: null,
                    m: null,
                    gen,
                    // Where and when this copy was last drawn (see _write).
                    drawLon: 0, drawLat: 0, drawT: -Infinity
                };
                render.set(key, r);
            }
            if (f.id != null) r.feature.id = f.id;
            if (rebuildAll || r.src !== f.properties) {
                r.feature.properties = slimProps(f.properties);
                r.src = f.properties;
            }
            this._noteFix(r, f, now, glide);
            r.gen = gen;
            list.push(r.feature);
        }

        if (render.size > list.length) {
            for (const [key, r] of render) {
                if (r.gen !== gen) render.delete(key);
            }
        }
        return list;
    }

    /**
     * Folds a cached feature's reported position into its motion state and
     * writes the drawn position/heading onto the render copy.
     */
    _noteFix(r, f, now, glide) {
        const p = f.properties;
        const lon = f.geometry.coordinates[0];
        const lat = f.geometry.coordinates[1];
        const fixMs = p.__lastUpdateMs;
        const heading = Number(p.heading) || 0;
        let m = r.m;

        if (!m) {
            m = r.m = {
                fixLon: lon, fixLat: lat, fixMs, t0: now,
                vLon: 0, vLat: 0,
                offLon: 0, offLat: 0, offT0: 0,
                hFrom: heading, hTo: heading, hT0: 0
            };
            this._setReportedVelocity(m, p, lat);
        } else if (m.fixMs !== fixMs || m.fixLon !== lon || m.fixLat !== lat) {
            // Where the plane is on screen, before taking the new report. The
            // last drawn point, not the extrapolated one: after a pause (camera
            // move, hidden tab) the two differ, and easing from the drawn point
            // is what keeps the plane from jumping.
            const drawn = Number.isFinite(r.drawT) ? [r.drawLon, r.drawLat] : this._position(m, now);
            const drawnHeading = this._heading(m, now);

            // Ground track from consecutive reports captures wind and turns
            // that heading + ground speed alone miss.
            let derived = false;
            if (typeof fixMs === 'number' && typeof m.fixMs === 'number') {
                const dt = (fixMs - m.fixMs) / 1000;
                if (dt >= 0.5 && dt <= 30) {
                    const vLon = angleDelta(m.fixLon, lon) / dt;
                    const vLat = (lat - m.fixLat) / dt;
                    const speed = Math.hypot(vLon * Math.cos(lat * DEG2RAD), vLat) * M_PER_DEG;
                    if (speed <= MapAnimator.MAX_SPEED_MS) {
                        m.vLon = vLon;
                        m.vLat = vLat;
                        derived = true;
                    }
                }
            }
            if (!derived) this._setReportedVelocity(m, p, lat);
            if ((Number(p.speed) || 0) < MapAnimator.MIN_GLIDE_KT) { m.vLon = 0; m.vLat = 0; }

            m.fixLon = lon;
            m.fixLat = lat;
            m.fixMs = fixMs;
            m.t0 = now;

            // Carry the drawn-vs-reported gap forward and ease it out.
            const offLon = angleDelta(lon, drawn[0]);
            const offLat = drawn[1] - lat;
            if (Math.abs(offLon) > MapAnimator.SNAP_DEG || Math.abs(offLat) > MapAnimator.SNAP_DEG) {
                m.offLon = 0; m.offLat = 0;
            } else {
                m.offLon = offLon; m.offLat = offLat;
            }
            m.offT0 = now;

            m.hFrom = drawnHeading;
            m.hTo = heading;
            m.hT0 = now;
        }

        if (!glide) {
            // Anchor to the report as of now, so gliding can pick up from
            // exactly what is on screen if it switches on later.
            m.t0 = now;
            m.offLon = 0; m.offLat = 0;
            m.hFrom = heading; m.hTo = heading;
        }

        this._write(r, m, now);
    }

    _setReportedVelocity(m, p, lat) {
        const kt = Number(p.speed) || 0;
        if (kt < MapAnimator.MIN_GLIDE_KT) { m.vLon = 0; m.vLat = 0; return; }
        const ms = kt * KT_TO_MS;
        const h = (Number(p.heading) || 0) * DEG2RAD;
        m.vLat = (ms * Math.cos(h)) / M_PER_DEG;
        m.vLon = (ms * Math.sin(h)) / (M_PER_DEG * Math.max(0.01, Math.cos(lat * DEG2RAD)));
    }

    // Dead-reckoned position, before any correction offset (unwrapped).
    _base(m, now) {
        const dt = Math.min(now - m.t0, MapAnimator.MAX_DR_MS) / 1000;
        return [m.fixLon + m.vLon * dt, m.fixLat + m.vLat * dt];
    }

    _position(m, now) {
        const b = this._base(m, now);
        let lon = b[0], lat = b[1];
        const w = 1 - smoothstep((now - m.offT0) / MapAnimator.CORRECTION_MS);
        if (w > 0) {
            lon += m.offLon * w;
            lat += m.offLat * w;
        }
        return [wrapLon(lon), Math.max(-85, Math.min(85, lat))];
    }

    _heading(m, now) {
        const u = smoothstep((now - m.hT0) / MapAnimator.HEADING_MS);
        return (m.hFrom + angleDelta(m.hFrom, m.hTo) * u + 360) % 360;
    }

    _write(r, m, now) {
        const pos = this._position(m, now);
        const c = r.feature.geometry.coordinates;
        c[0] = pos[0];
        c[1] = pos[1];
        r.drawLon = pos[0];
        r.drawLat = pos[1];
        r.drawT = now;
        if (r.feature.properties) r.feature.properties.heading = this._heading(m, now);
    }

    _isMoving(m, now) {
        return ((m.vLon !== 0 || m.vLat !== 0) && now - m.t0 < MapAnimator.MAX_DR_MS)
            || this._isEasing(m, now);
    }

    _isEasing(m, now) {
        return ((m.offLon !== 0 || m.offLat !== 0) && now - m.offT0 < MapAnimator.CORRECTION_MS)
            || (m.hFrom !== m.hTo && now - m.hT0 < MapAnimator.HEADING_MS);
    }

    // --- Glide loop -------------------------------------------------------

    _glideSource() {
        if (this._stopped || document.hidden) return null;
        if (this._glideGate && !this._glideGate()) return null;
        const map = this.map;
        if (!map || map.getZoom() < MapAnimator.GLIDE_MIN_ZOOM) return null;
        const source = map.getSource(this.sourceName);
        // Mapbox `dynamic` sources only: MapLibre's updateData takes a
        // different diff format and isn't used.
        if (!source || typeof source.updateData !== 'function'
            || !(source._options && source._options.dynamic)) return null;
        return source;
    }

    _kickGlide() {
        if (this._glideHandle !== null || !this._glideSource()) return;
        this._glideHandle = requestAnimationFrame(() => this._glideFrame());
    }

    _glideFrame() {
        this._glideHandle = null;
        const source = this._glideSource();
        if (!source) return; // restarted by the next flush / moveend / visibility

        const now = performance.now();
        const due = now - this._lastGlidePush >= this._glideInterval;
        // Let a full flush, a camera move, or the previous push finish first.
        // Pushing while Mapbox has a load in flight makes it merge the diff
        // into the whole collection and re-send all of it; waiting for the
        // source's tiles to finish re-laying-out is the back-pressure that
        // lets a slower device settle at the rate it can actually sustain.
        if (!due || this._dirty || this._interacting || source._pendingLoad
            || !this.map.isStyleLoaded() || !this.map.isSourceLoaded(this.sourceName)) {
            this._glideHandle = requestAnimationFrame(() => this._glideFrame());
            return;
        }

        const bounds = this.map.getBounds();
        const west = bounds.getWest(), east = bounds.getEast();
        const south = bounds.getSouth(), north = bounds.getNorth();
        const padLon = (east - west) * 0.1, padLat = (north - south) * 0.1;
        const wraps = east - west >= 360;

        const batch = [];
        const movers = [];
        let maxDegPerSec = 0;
        let easing = false;
        for (const r of this._render.values()) {
            const m = r.m;
            if (!m || !this._isMoving(m, now)) continue;
            const c = r.feature.geometry.coordinates;
            if (c[1] < south - padLat || c[1] > north + padLat) continue;
            if (!wraps) {
                // Bounds may extend past ±180; test the longitude unwrapped
                // into the viewport's range.
                let lon = c[0];
                while (lon < west - padLon) lon += 360;
                if (lon > east + padLon) continue;
            }
            movers.push(r);
            batch.push(r.feature);
            if (batch.length > MapAnimator.GLIDE_MAX_FEATURES) break;
            const sp = Math.hypot(m.vLon * Math.cos(c[1] * DEG2RAD), m.vLat);
            if (sp > maxDegPerSec) maxDegPerSec = sp;
            if (!easing && this._isEasing(m, now)) easing = true;
        }

        if (!batch.length || batch.length > MapAnimator.GLIDE_MAX_FEATURES) {
            // Nothing to move, or too much to move smoothly: stand down until
            // the next flush restarts the loop.
            return;
        }

        for (const r of movers) {
            const m = r.m;
            // Glide was paused (camera move, hidden tab, a load in flight):
            // continue from where the plane was last drawn and ease onto its
            // track, instead of jumping by however far it travelled meanwhile.
            if (now - r.drawT > 250) {
                const b = this._base(m, now);
                const oLon = angleDelta(b[0], r.drawLon);
                const oLat = r.drawLat - b[1];
                if (Math.abs(oLon) <= MapAnimator.SNAP_DEG && Math.abs(oLat) <= MapAnimator.SNAP_DEG) {
                    m.offLon = oLon; m.offLat = oLat; m.offT0 = now;
                    easing = true;
                }
            }
            this._write(r, m, now);
        }
        source.updateData({ type: 'FeatureCollection', features: batch });
        this._lastGlidePush = now;

        // Next push when the fastest visible plane has moved GLIDE_STEP_PX.
        const worldPx = 512 * Math.pow(2, this.map.getZoom());
        const pxPerSec = maxDegPerSec * worldPx / 360;
        let interval = pxPerSec > 0
            ? (MapAnimator.GLIDE_STEP_PX / pxPerSec) * 1000
            : MapAnimator.GLIDE_MAX_INTERVAL_MS;
        if (easing) interval = Math.min(interval, MapAnimator.GLIDE_EASE_INTERVAL_MS);
        this._glideInterval = Math.max(MapAnimator.GLIDE_MIN_INTERVAL_MS,
            Math.min(MapAnimator.GLIDE_MAX_INTERVAL_MS, interval));

        this._glideHandle = requestAnimationFrame(() => this._glideFrame());
    }
}
