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
            if (this._dirty) this._updateMapSource();
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
            // If source/style isn't ready, it's fine.
            // The next update will catch it.
            return;
        }

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
