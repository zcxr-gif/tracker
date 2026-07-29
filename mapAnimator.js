/**
 * ===================================================================
 * MapAnimator.js
 * -------------------------------------------------------------------
 * A module to handle updating flight positions on a Mapbox GL JS map.
 *
 * --- Teleport model, frame-coalesced ---
 *
 * There is no interpolation: when new flight data arrives the GeoJSON
 * feature is moved straight to the new coordinates and its properties
 * are replaced.
 *
 * What *is* batched is the push to Mapbox. `updateFlight()` is called
 * once per aircraft per socket tick, so pushing the whole
 * FeatureCollection from inside it made every tick O(flights²) — with
 * 1,200 aircraft that was 1,200 `setData()` calls each re-serialising
 * 1,200 features. Updates now mutate the shared feature cache and mark
 * the source dirty; a single `setData()` runs on the next animation
 * frame with the final state of the tick.
 *
 * Two further allocations are avoided:
 *   • the `Object.values()` snapshot is rebuilt only when the *set* of
 *     tracked flights changes, since features are mutated in place and
 *     the array holds live references;
 *   • features are updated in place rather than replaced, which also
 *     preserves the numeric `id` flight.js assigns for feature-state.
 * ===================================================================
 */

/**
 * Main manager for the Mapbox map.
 * In this version, it does not "animate", it only handles
 * updating the map source when data changes.
 */
export class MapAnimator {
    // Longest a source update may be held back by camera interaction. A pinch
    // held mid-gesture, or a slow flyTo, must not stall live traffic forever.
    static MAX_DEFER_MS = 2000;

    // Longest a pending flush keeps retrying while the map reports it isn't
    // ready (style swapping, sources still loading). See _updateMapSource().
    static MAX_RETRY_MS = 10000;

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
        this._rosterDirty = true;   // the *set* of flight ids changed
        this._featureList = [];     // cached Object.values() snapshot
        this._stopped = false;
        this._retryingSince = 0;    // when the current not-ready retry began

        // Camera-interaction gating (see bindInteraction).
        this._interacting = false;
        this._deferredSince = 0;
        this._unbindInteraction = null;
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
     * cover zoom, pan, rotate, pitch and programmatic flyTo alike.
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
     * Starts the animator. (No animation loop — flushes are frame-driven.)
     */
    start() {
        this._stopped = false;
        console.log('MapAnimator (Teleport) started.');
    }

    /**
     * Stops the animator and cancels any pending flush.
     */
    stop() {
        this._stopped = true;
        if (this._frameHandle !== null) {
            cancelAnimationFrame(this._frameHandle);
            this._frameHandle = null;
        }
        if (this._unbindInteraction) this._unbindInteraction();
        console.log('MapAnimator (Teleport) stopped.');
    }

    /**
     * Updates or creates a flight's state based on new data.
     * This will "teleport" the feature to the new position.
     *
     * flight.js owns the same cache and has usually written the feature
     * already, so the common path here is an in-place refresh — no new
     * objects, no snapshot rebuild.
     *
     * @param {object} newPosition - {lon, lat, heading_deg}
     * @param {object} newProperties - The full properties object.
     */
    updateFlight(newPosition, newProperties) {
        const flightId = newProperties.flightId;
        const existing = this.currentMapFeatures[flightId];

        if (existing && existing.geometry) {
            // In-place update: keeps `id` (and any other caller-set field)
            // and keeps the cached feature list valid.
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
                properties: newProperties // Includes new heading, phase, etc.
            };
            // A flight appeared — the cached snapshot no longer matches.
            this._rosterDirty = true;
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
        this._rosterDirty = true;
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
     * Marks the cached feature snapshot stale. flight.js calls this when it
     * adds or deletes entries in the shared cache directly (e.g. the
     * end-of-tick sweep of flights that stopped reporting).
     */
    invalidateRoster() {
        this._rosterDirty = true;
    }

    /**
     * Returns the FeatureCollection array, rebuilding it only when the set of
     * tracked flights changed. Features are mutated in place, so between
     * roster changes the cached array already reflects current positions.
     */
    _getFeatureList() {
        if (this._rosterDirty) {
            this._featureList = Object.values(this.currentMapFeatures);
            this._rosterDirty = false;
        }
        return this._featureList;
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

        // This single call pushes all changes to the map at once. The wrapper
        // is fresh each flush (Mapbox holds on to the object it is given) but
        // the expensive part — the feature array — is reused.
        source.setData({
            type: 'FeatureCollection',
            features: this._getFeatureList()
        });
    }
}
