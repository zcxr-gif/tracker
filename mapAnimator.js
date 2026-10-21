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
 * --- Glide (the iOS app's FlightMotion) ---
 * Between reports each moving aircraft is carried forward at the heading
 * and ground speed it last reported. A report starts a *leg*: a straight
 * line, flown at one constant speed, from where the plane is drawn to where
 * the report says it will be two report-gaps later; the next report
 * normally lands halfway along and starts the next leg from wherever the
 * plane has got to. So the error is spread over seconds, and the plane never
 * surges, stalls or reverses. Headings ease towards the report's on a 0.7 s
 * time constant. Exactly as the iOS app (FlightMotion.swift), whose numbers
 * these are.
 *
 * Every moving aircraft on screen is carried, at every zoom, and written to
 * a `dynamic` source with `updateData()` once it has moved a tenth of a
 * pixel or turned half a degree — thirty times a second, and the open
 * flight on every frame (TrackerMapView.flyOneFrame). MapLibre (free map
 * mode) has no compatible `updateData`, so there aircraft keep moving
 * report to report.
 * ===================================================================
 */

// Properties no map layer reads. Kept out of the render copy so they are
// never serialised to the worker; handlers fetch them from the cache.
const HEAVY_PROPS = new Set([
    'position', 'aircraft', '__acSig', 'last_update',
    'communityImageUrl', 'communityImageUrls', 'imageContributors', 'contributorName',
    // Read only by handlers (via liveFlightProps, from the cache), never by
    // a layer expression. (isStaff / isVAMember stay: the Staff-only and
    // VA-only filters read them in the legacy ['==', 'isStaff', true] form.)
    'verticalSpeed', 'userId', 'pilotState', '__lastUpdateMs'
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
const angleDelta = (from, to) => ((to - from + 540) % 360) - 180;

// Whether the style itself is in place, so the source can take data.
// isStyleLoaded() is not that: Mapbox and MapLibre both answer false while
// any source still has tiles in flight — and this source has them after its
// own every write. A tilted camera following the open flight keeps tiles
// loading almost every frame, so behind isStyleLoaded() the flushes were
// dropped and the 3D aircraft stood still while its flown path ran on ahead.
export function styleReady(map) {
    const style = map.style;
    if (!style) return false;
    return typeof style._loaded === 'boolean' ? style._loaded : map.isStyleLoaded();
}

export class MapAnimator {
    // Longest a source update may be held back by camera interaction. A pinch
    // held mid-gesture, or a slow flyTo, must not stall live traffic forever.
    static MAX_DEFER_MS = 2000;

    // Longest a pending flush keeps retrying while the map reports it isn't
    // ready (style swapping, sources still loading). See _updateMapSource().
    static MAX_RETRY_MS = 10000;

    // --- Glide tuning (iOS FlightMotion) ---
    // The gap between packets assumed before two have been seen: the
    // simulator's feed, every few seconds.
    static FEED_INTERVAL_S = 4;
    // How many packet-gaps a leg spans, and the shortest leg.
    static LEG_SPAN = 2;
    static SHORTEST_LEG_S = 1;
    // How far ahead of its last packet an aircraft may be carried.
    static MAX_LEAD_S = 12;
    // Beyond this a correction is a cut rather than a slide.
    static SNAP_METRES = 4000;
    // The heading's easing time constant.
    static HEADING_TAU_S = 0.7;
    // Written out when moved this far or turned this much…
    static WRITE_PX = 0.1;
    static WRITE_HEADING_DEG = 0.5;
    // …this often, and the open flight on every frame.
    static WRITE_ALL_MS = 1000 / 30;

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
        //   m:       motion state for glide (see _report)
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
        this._lastWriteAll = -Infinity;
        this._loadStart = 0;        // when the last all-traffic write went out
        this._loadMs = 0;           // how long Mapbox took to load it
        this._glideGate = null;     // optional () => boolean from the host
        this._focus = null;         // optional () => the open flight's id
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
     * cover zoom, pan, rotate, pitch and programmatic flyTo alike. The glide
     * does not wait: its `updateData()` writes touch only the aircraft that
     * moved, and aircraft keep flying through a gesture as they do in the
     * iOS app.
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
     * Names the open flight, which is carried and written on every frame
     * whatever the gate says, so the camera, the 3D aircraft and the flown
     * path's head always have a smooth position to follow.
     * @param {() => (string|number|null)} focus
     */
    setFocus(focus) {
        this._focus = typeof focus === 'function' ? focus : null;
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
        if (!source || !styleReady(this.map)) {
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
     * array to hand Mapbox. Picks up new reports into each aircraft's motion
     * and writes each feature at the position it is *drawn* at, so a flush
     * never yanks a gliding plane back to its (older) report position.
     */
    _syncRender(now) {
        const feats = this.currentMapFeatures;
        const render = this._render;
        const list = this._featureList;
        const gen = ++this._gen;
        const rebuildAll = this._propsStale;
        this._propsStale = false;
        const gliding = !!this._glideSource();
        const allowed = gliding && this._glideAllowed();
        const focus = this._focusId();
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
                    // Where the copy was last written (see _write).
                    drawLon: NaN, drawLat: NaN, drawHeading: NaN
                };
                render.set(key, r);
            }
            if (f.id != null) r.feature.id = f.id;
            if (rebuildAll || r.src !== f.properties) {
                r.feature.properties = slimProps(f.properties);
                r.src = f.properties;
            }
            this._report(r, f, now);
            this._carry(r, gliding && (allowed || key === focus), now);
            this._write(r, now);
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

    // --- Motion (iOS FlightMotion) -----------------------------------------

    /**
     * Folds a cached feature's report into its motion. The same fix twice is
     * nothing at all: the map's own flushes hand the same packet back many
     * times, and taking it as new would haul the aeroplane back along its
     * track to where the packet put it. (FlightMotion.report)
     */
    _report(r, f, now) {
        const p = f.properties;
        const lon = f.geometry.coordinates[0];
        const lat = f.geometry.coordinates[1];
        const heading = Number(p.heading) || 0;
        const knots = Number(p.speed) || 0;
        const mps = knots > 0 && Number.isFinite(knots) ? knots * KT_TO_MS : 0;
        const worth = isWorthSmoothing(p, knots);
        let m = r.m;

        if (!m) {
            r.m = {
                repLon: lon, repLat: lat, repAt: now, heading, mps, worth,
                interval: MapAnimator.FEED_INTERVAL_S,
                carried: false,
                legFromLon: lon, legFromLat: lat, legToLon: lon, legToLat: lat,
                legStart: now, legMs: 0,
                hDrawn: heading, hAt: now
            };
            return;
        }
        if (lon === m.repLon && lat === m.repLat && heading === m.heading && mps === m.mps) return;

        // Where it is drawn at this moment, under the leg being replaced.
        const from = this._position(m, now);

        // How far apart this aircraft's packets come, eased so one late
        // packet does not stretch the next leg out of shape.
        const gap = (now - m.repAt) / 1000;
        if (gap > 0.25 && gap < MapAnimator.MAX_LEAD_S) m.interval = m.interval * 0.6 + gap * 0.4;

        m.repLon = lon; m.repLat = lat; m.repAt = now;
        m.heading = heading; m.mps = mps; m.worth = worth;

        if (!m.carried) return;
        // Not a gap but a different place: a cut, not a slide.
        if (metres(from[0], from[1], lon, lat) > MapAnimator.SNAP_METRES) {
            m.legMs = 0;
            m.hDrawn = heading;
            return;
        }
        this._startLeg(m, from, now);
    }

    /**
     * Starts or stops carrying an aircraft between its packets. Starting is
     * a moment like any other: it begins from where the aeroplane is already
     * drawn, not from where it was last reported. (FlightMotion.init, and
     * TrackerMapView's beginMotion / endMotion.)
     */
    _carry(r, want, now) {
        const m = r.m;
        const on = !!(want && m.worth);
        if (on === m.carried) return;
        if (on) {
            const from = Number.isFinite(r.drawLon) ? [r.drawLon, r.drawLat] : [m.repLon, m.repLat];
            m.carried = true;
            m.hDrawn = Number.isFinite(r.drawHeading) ? r.drawHeading : m.heading;
            m.hAt = now;
            this._startLeg(m, from, now);
        } else {
            m.carried = false;
            m.legMs = 0;
        }
    }

    // A straight leg, at one speed, from `from` to where the last packet puts
    // the aeroplane LEG_SPAN packet-gaps from now.
    _startLeg(m, from, now) {
        const s = Math.min(Math.max(m.interval * MapAnimator.LEG_SPAN, MapAnimator.SHORTEST_LEG_S), MapAnimator.MAX_LEAD_S);
        const to = this._predicted(m, now + s * 1000);
        m.legFromLon = from[0]; m.legFromLat = from[1];
        m.legToLon = to[0]; m.legToLat = to[1];
        m.legStart = now;
        m.legMs = s * 1000;
    }

    // Dead reckoning from the last packet, at its heading and ground speed,
    // for at most MAX_LEAD_S.
    _predicted(m, now) {
        const lead = Math.min(Math.max((now - m.repAt) / 1000, 0), MapAnimator.MAX_LEAD_S);
        if (!(lead > 0) || !(m.mps > 0)) return [m.repLon, m.repLat];
        return greatCircle(m.repLon, m.repLat, m.heading, m.mps * lead);
    }

    // Where the aeroplane is drawn at a moment: on its packet when it is not
    // being carried; along the leg while it lasts, and on the prediction
    // after — the two meet where the leg ends.
    _position(m, now) {
        if (!m.carried) return [m.repLon, m.repLat];
        if (m.legMs > 0) {
            const share = (now - m.legStart) / m.legMs;
            if (share < 1) {
                const along = Math.max(share, 0);
                const lat0 = m.legFromLat;
                const north = (m.legToLat - lat0) * M_PER_DEG;
                const east = angleDelta(m.legFromLon, m.legToLon) * M_PER_DEG * Math.cos(lat0 * DEG2RAD);
                return moved(m.legFromLon, lat0, north * along, east * along);
            }
        }
        return this._predicted(m, now);
    }

    // The heading the aeroplane is turned to, eased towards its packet's on
    // a 0.7 s time constant; taken whole after a pause of a second or more.
    _heading(m, now) {
        if (!m.carried) return ((m.heading % 360) + 360) % 360;
        const elapsed = (now - m.hAt) / 1000;
        if (elapsed !== 0) {
            const target = unwrap(m.hDrawn, m.heading);
            if (elapsed > 0 && elapsed < 1) {
                m.hDrawn += (target - m.hDrawn) * (1 - Math.exp(-elapsed / MapAnimator.HEADING_TAU_S));
            } else if (elapsed > 0) {
                m.hDrawn = target;
            }
            if (elapsed > 0) m.hAt = now;
        }
        return ((m.hDrawn % 360) + 360) % 360;
    }

    /**
     * Where a flight is drawn at `now` — [lon, lat, heading] — so the 3D
     * aircraft (aircraftEngine.js), the camera and the flown path's head are
     * all on the icon. Null until the flight has been through a flush.
     */
    pose(flightId, now = performance.now()) {
        const r = this._render.get(String(flightId));
        if (!r || !r.m) return null;
        const pos = this._position(r.m, now);
        return [pos[0], pos[1], this._heading(r.m, now)];
    }

    _write(r, now) {
        const m = r.m;
        const pos = this._position(m, now);
        const heading = this._heading(m, now);
        const c = r.feature.geometry.coordinates;
        c[0] = pos[0];
        c[1] = pos[1];
        r.drawLon = pos[0];
        r.drawLat = pos[1];
        r.drawHeading = heading;
        if (r.feature.properties) r.feature.properties.heading = heading;
    }

    // Whether a carried aircraft has moved or turned enough since it was
    // last written to be worth writing again: a tenth of a pixel, or half a
    // degree. (FlightMarker.needsWrite)
    _needsWrite(r, now, pxPerDeg, cosLat) {
        if (!Number.isFinite(r.drawLon)) return true;
        const m = r.m;
        const pos = this._position(m, now);
        if (Math.abs(angleDelta(r.drawHeading, this._heading(m, now))) > MapAnimator.WRITE_HEADING_DEG) return true;
        const dx = angleDelta(r.drawLon, pos[0]) * pxPerDeg;
        const dy = (pos[1] - r.drawLat) * pxPerDeg / cosLat;
        return Math.hypot(dx, dy) >= MapAnimator.WRITE_PX;
    }

    // --- The frame clock -------------------------------------------------

    // The dynamic source to write to, or null when nothing glides at all
    // (free map, hidden tab, stopped).
    _glideSource() {
        if (this._stopped || document.hidden) return null;
        const map = this.map;
        if (!map) return null;
        const source = map.getSource(this.sourceName);
        // Mapbox `dynamic` sources only: MapLibre's updateData takes a
        // different diff format and isn't used.
        if (!source || typeof source.updateData !== 'function'
            || !(source._options && source._options.dynamic)) return null;
        return source;
    }

    // Whether the host lets traffic in general be carried (a user setting,
    // the 3D traffic view). The open flight is carried regardless.
    _glideAllowed() {
        return !this._glideGate || !!this._glideGate();
    }

    _focusId() {
        const id = this._focus ? this._focus() : null;
        return id == null ? null : String(id);
    }

    _kickGlide() {
        if (this._glideHandle !== null || !this._glideSource()) return;
        this._glideHandle = requestAnimationFrame(() => this._glideFrame());
    }

    /**
     * One frame of the frame clock (TrackerMapView.flyOneFrame): every
     * moving aircraft on screen is carried, and written out when it has
     * moved a tenth of a pixel — thirty times a second, and the open flight
     * on every frame. Waits only for the previous write or flush to finish
     * loading; the motion runs on the clock, so a skipped frame loses
     * nothing, the next write puts each aeroplane where it has got to.
     */
    _glideFrame() {
        this._glideHandle = null;
        const source = this._glideSource();
        if (!source) return; // restarted by the next flush / visibility

        const map = this.map;
        const now = performance.now();
        // A flush held back by a camera move is not waited for: the motion
        // already on the map is written meanwhile, and the flush folds the
        // new reports in when it lands.
        if (source._pendingLoad || !styleReady(map)) {
            this._glideHandle = requestAnimationFrame(() => this._glideFrame());
            return;
        }

        // How long the last write of all the traffic took to load. A busy
        // screen takes Mapbox longer than a frame, and while it loads nothing
        // can be written; so the traffic is written no more often than every
        // other load, which leaves the frames between for the open flight.
        if (this._loadStart) {
            this._loadMs = now - this._loadStart;
            this._loadStart = 0;
        }
        const allowed = this._glideAllowed();
        const focus = this._focusId();
        const allEvery = Math.max(MapAnimator.WRITE_ALL_MS, 2 * this._loadMs);
        const writesAll = now - this._lastWriteAll >= allEvery - 4;
        if (writesAll) this._lastWriteAll = now;

        const bounds = map.getBounds();
        const west = bounds.getWest(), east = bounds.getEast();
        const south = bounds.getSouth(), north = bounds.getNorth();
        const padLon = (east - west) * 0.1, padLat = (north - south) * 0.1;
        const wraps = east - west >= 360;
        const pxPerDeg = 512 * Math.pow(2, map.getZoom()) / 360;
        const cosLat = Math.max(Math.cos(map.getCenter().lat * DEG2RAD), 0.01);

        const batch = [];
        let flying = 0;
        for (const [key, r] of this._render) {
            const m = r.m;
            if (!m) continue;
            const isFocus = key === focus;
            const c = r.feature.geometry.coordinates;
            let inView = c[1] >= south - padLat && c[1] <= north + padLat;
            if (inView && !wraps) {
                // Bounds may extend past ±180; test the longitude unwrapped
                // into the viewport's range.
                let lon = c[0];
                while (lon < west - padLon) lon += 360;
                inView = lon <= east + padLon;
            }
            const was = m.carried;
            if (!inView && !was && !isFocus) continue;

            this._carry(r, (inView || isFocus) && (allowed || isFocus), now);
            const switched = m.carried !== was;
            if (m.carried) flying++;
            if (!m.carried && !was) continue;
            if (!(writesAll || switched || isFocus)) continue;
            if (switched || this._needsWrite(r, now, pxPerDeg, cosLat)) {
                this._write(r, now);
                batch.push(r.feature);
            }
        }

        if (batch.length) {
            source.updateData({ type: 'FeatureCollection', features: batch });
            if (writesAll) this._loadStart = now;
        }
        // Nothing being carried: stand down until the next flush, camera
        // move or visibility change restarts the clock.
        if (flying || batch.length) this._glideHandle = requestAnimationFrame(() => this._glideFrame());
    }
}

// --- Which aircraft are carried ------------------------------------------

/**
 * Moving fast enough for a heading to mean something: flying, or taxiing.
 * An aeroplane at a gate reports a heading that is whichever way the nose
 * happens to point and a ground speed that is noise, so one parked or barely
 * moving is drawn exactly where its packets put it. (Flight.isWorthSmoothing)
 */
function isWorthSmoothing(p, knots) {
    if (!Number.isFinite(knots) || !Number.isFinite(Number(p.heading))) return false;
    const phase = String(p.phase || '').toLowerCase();
    const onGround = /ground|taxi|park|gate|pushback|stand/.test(phase);
    return knots >= (onGround ? 5 : 40);
}

// --- Geometry (iOS FlightMotion / GreatCircle) ---------------------------

const EARTH_RADIUS_M = 6371000;

// Walking a bearing and a distance across the planet.
function greatCircle(lon, lat, bearingDeg, dist) {
    const a = dist / EARTH_RADIUS_M;
    const b = bearingDeg * DEG2RAD;
    const la = lat * DEG2RAD, lo = lon * DEG2RAD;
    const la2 = Math.asin(Math.sin(la) * Math.cos(a) + Math.cos(la) * Math.sin(a) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(a) * Math.cos(la), Math.cos(a) - Math.sin(la) * Math.sin(la2));
    return [wrapLon(lo2 / DEG2RAD), la2 / DEG2RAD];
}

// A flat step north and east from a point: only ever metres to a few
// kilometres, the gap between where a plane is drawn and where it is going.
function moved(lon, lat, north, east) {
    const shrink = Math.max(Math.cos(lat * DEG2RAD), 0.01);
    return [
        wrapLon(lon + east / (M_PER_DEG * shrink)),
        Math.min(Math.max(lat + north / M_PER_DEG, -89.9), 89.9)
    ];
}

function metres(lon0, lat0, lon1, lat1) {
    const north = (lat1 - lat0) * M_PER_DEG;
    const east = angleDelta(lon0, lon1) * M_PER_DEG * Math.cos(lat0 * DEG2RAD);
    return Math.hypot(north, east);
}

// The reported bearing on the same continuous line as the drawn one, so the
// shorter way round is the way it turns.
function unwrap(continuous, reported) {
    if (!Number.isFinite(reported)) return continuous;
    let delta = reported - (continuous % 360);
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return continuous + delta;
}
