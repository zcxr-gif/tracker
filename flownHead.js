/**
 * flownHead.js
 * -------------------------------------------------------------------
 * The open flight's flown path, ending on the aeroplane — the iOS app's
 * flown head (TrackerMapView.Coordinator.updateFlownHead), on the website.
 *
 * The flown line is built from breadcrumbs, and the newest breadcrumb is not
 * where the aeroplane is drawn: the plane glides between reports, and the
 * report pipelines (history, the live feed, the map's own feed) do not agree
 * on what is newest. Ending the line on the newest report therefore leaves
 * it running ahead of the aeroplane whenever the aeroplane is drawn behind
 * that report, and no trim by timestamp can promise otherwise.
 *
 * So, as on iOS, the line is cut by where the aeroplane is drawn rather than
 * by any clock:
 *   - the line itself ends on the last breadcrumb the aeroplane has passed
 *     (trimAhead, applied when the line is built);
 *   - one short segment, from there to the aeroplane as it is drawn, is
 *     rewritten on the frame clock, whenever the aeroplane has moved a
 *     fifth of a pixel off it, so the two travel together;
 *   - when the aeroplane passes a breadcrumb held back from the line, the
 *     line is rebuilt to take it in.
 *
 * Public API:
 *   init(map, host)  host: {
 *     selected()        the open flight's id, or null
 *     pose(id)          [lon, lat, heading] where it is drawn now, or null
 *     flownLayer(id)    the flight's flown-path layer id
 *     rebuild(id)       rebuild the flight's flown line now
 *     colour(altFt)     the flown path's colour at a height
 *     anchor()          the layer id to draw the head under
 *   }
 *   noteEnd(id, end)    where the line built for `id` ends: { lon, lat,
 *                       alt, trail, kept } — `kept` being how many of
 *                       `trail`'s points it took in — or null
 *   trimAhead(points, pose, lonLat)
 *                       how many of `points` to keep: all but the newest
 *                       ones the aeroplane at `pose` has yet to reach
 *   isAhead(lon, lat, pose)
 * ===================================================================
 */

export const FlownHead = (() => {
    const SOURCE = 'flown-head-source';
    const LAYER = 'flown-head-layer';
    const M_PER_DEG = 111320;
    const DEG2RAD = Math.PI / 180;
    // How far ahead of the aeroplane a breadcrumb can be and still be one it
    // is about to fly over (iOS FlightMotion.maximumLeadMetres). Further than
    // this it is a different place — a respawn, a broken clock — and is left
    // in the line rather than taken as a lead.
    const MAX_LEAD_M = 7000;
    // Rewritten once the aeroplane is this far off the written head.
    const REWRITE_PX = 0.2;
    // At most one rebuild of the whole line this often.
    const REBUILD_MS = 250;

    let map = null;
    let host = null;
    let end = null;
    let written = null;     // { id, lon, lat, colour, width, opacity, vis }
    let lastRebuild = -Infinity;

    // Whether a point lies in front of the aeroplane, along its heading, and
    // near enough to be one it is about to reach.
    function isAhead(lon, lat, pose) {
        if (!pose) return false;
        const north = (lat - pose[1]) * M_PER_DEG;
        const east = (((lon - pose[0] + 540) % 360) - 180) * M_PER_DEG * Math.cos(pose[1] * DEG2RAD);
        const h = (Number(pose[2]) || 0) * DEG2RAD;
        const along = north * Math.cos(h) + east * Math.sin(h);
        return along > 0 && Math.hypot(north, east) < MAX_LEAD_M;
    }

    function trimAhead(points, pose, lonLat) {
        let n = points.length;
        if (!pose) return n;
        while (n > 0) {
            const ll = lonLat(points[n - 1]);
            if (!ll || !isAhead(ll[0], ll[1], pose)) break;
            n--;
        }
        return n;
    }

    // Paint values may be expressions: compared by what they say.
    const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

    function noteEnd(id, e) {
        end = e && id != null ? { ...e, id: String(id) } : null;
    }

    function clear() {
        if (!written) return;
        written = null;
        const src = map.getSource(SOURCE);
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
    }

    function tick() {
        requestAnimationFrame(tick);
        try { step(); } catch (_) { /* a style mid-swap; next frame */ }
    }

    function step() {
        const id = host.selected();
        const layer = id != null ? host.flownLayer(id) : null;
        if (id == null || !end || end.id !== String(id) || !layer || !map.getLayer(layer)) { clear(); return; }
        const vis = map.getLayoutProperty(layer, 'visibility') || 'visible';
        const pose = host.pose(id);
        if (!pose || vis === 'none') { clear(); return; }

        // A breadcrumb held back from the line that the aeroplane has now
        // passed: the line takes it in.
        const now = performance.now();
        const next = !end.stalled && end.trail && end.kept < end.trail.length ? end.trail[end.kept] : null;
        if (next && now - lastRebuild > REBUILD_MS) {
            const lon = next.longitude != null ? next.longitude : next.lon;
            const lat = next.latitude != null ? next.latitude : next.lat;
            if (Number.isFinite(lon) && Number.isFinite(lat) && !isAhead(lon, lat, pose)) {
                lastRebuild = now;
                const before = end;
                host.rebuild(id);
                if (!end || end.id !== String(id)) { clear(); return; }
                // The rebuild left it out anyway (the line's own trims): not
                // asked again until the line is next built.
                if (end === before || (end.trail === before.trail && end.kept <= before.kept)) end.stalled = true;
            }
        }

        if (!map.getSource(SOURCE)) {
            written = null;
            map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getLayer(LAYER)) {
            written = null;
            const anchor = host.anchor();
            map.addLayer({
                id: LAYER,
                type: 'line',
                source: SOURCE,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-width': 3, 'line-color': '#38bdf8', 'line-opacity': 1 }
            }, anchor && map.getLayer(anchor) ? anchor : undefined);
        }

        // Drawn as the line it grows from is.
        const colour = host.colour(end.alt);
        const width = map.getPaintProperty(layer, 'line-width');
        const opacity = map.getPaintProperty(layer, 'line-opacity');
        const w = written;
        if (!w || !same(w.width, width)) map.setPaintProperty(LAYER, 'line-width', width != null ? width : 3);
        if (!w || !same(w.opacity, opacity)) map.setPaintProperty(LAYER, 'line-opacity', opacity != null ? opacity : 1);
        if (!w || w.colour !== colour) map.setPaintProperty(LAYER, 'line-color', colour);

        if (w && w.id === end.id && w.endLon === end.lon && w.endLat === end.lat) {
            const a = map.project([w.lon, w.lat]);
            const b = map.project([pose[0], pose[1]]);
            if (Math.hypot(a.x - b.x, a.y - b.y) < REWRITE_PX) {
                written = { ...w, colour, width, opacity };
                return;
            }
        }
        // Unwrapped onto the line's end, so the antimeridian is a short hop.
        let lon = pose[0];
        while (lon - end.lon > 180) lon -= 360;
        while (lon - end.lon < -180) lon += 360;
        map.getSource(SOURCE).setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [[end.lon, end.lat], [lon, pose[1]]] }
        });
        written = { id: end.id, lon: pose[0], lat: pose[1], endLon: end.lon, endLat: end.lat, colour, width, opacity };
    }

    function init(m, h) {
        if (map) return;
        map = m;
        host = h;
        requestAnimationFrame(tick);
    }

    return { init, noteEnd, trimAhead, isAhead };
})();
