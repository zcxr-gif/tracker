/**
 * flownHead.js
 * -------------------------------------------------------------------
 * The open flight's flown path, grown to the aeroplane — the iOS app's
 * flown head (TrackerMapView.Coordinator.updateFlownHead), on the website.
 *
 * The track ends at the newest breadcrumb, and breadcrumbs are two nautical
 * miles apart at best (flownPath.js, FlownTrail) — so the aeroplane spends
 * most of its time flying off the end of its own path. This is one short
 * segment from where the path ends to the aeroplane as it is drawn,
 * rewritten on the frame clock whenever the aeroplane has moved a fifth of a
 * pixel off it, so the two travel together. It is drawn as the path is: in
 * the colour the path ends in, over its halo, at its width and opacity.
 *
 * The path's other layers (its halo, the inferred leg before it) follow the
 * flat line's visibility here too, so whatever hides or shows that line —
 * the flown-path button, the replay — takes them with it.
 *
 * Public API:
 *   init(map, host)  host: {
 *     selected()        the open flight's id, or null
 *     pose(id)          [lon, lat, heading] where it is drawn now, or null
 *     flownLayer(id)    the flight's flown-path layer id
 *     companions(id)    the path's other layer ids, shown and hidden with it
 *     haloLayer(id)     the flight's flown-path halo layer id
 *     anchor()          the layer id to draw the head under
 *   }
 *   noteEnd(id, end)    where the path built for `id` ends: { lon, lat,
 *                       colour, halo } (CSS colours) — or null
 * ===================================================================
 */

export const FlownHead = (() => {
    const SOURCE = 'flown-head-source';
    const LAYER = 'flown-head-layer';
    const HALO = 'flown-head-halo';
    // Rewritten once the aeroplane is this far off the written head.
    const REWRITE_PX = 0.2;
    const M_PER_DEG = 111320;
    const DEG2RAD = Math.PI / 180;
    const EARTH_CIRCUMFERENCE = 40075016.686;

    let map = null;
    let host = null;
    let end = null;
    let written = null;     // { id, lon, lat, endLon, endLat, colour, halo }
    let styled = null;      // the paint last copied from the path's layers

    function noteEnd(id, e) {
        end = e && id != null ? { ...e, id: String(id) } : null;
    }

    function clear() {
        if (!written) return;
        written = null;
        const src = map.getSource(SOURCE);
        if (src) src.setData({ type: 'FeatureCollection', features: [] });
    }

    // Paint values may be expressions: compared by what they say.
    const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

    function tick() {
        requestAnimationFrame(tick);
        try { step(); } catch (_) { /* a style mid-swap; next frame */ }
    }

    function ensureLayers() {
        if (!map.getSource(SOURCE)) {
            written = null;
            map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        const anchor = host.anchor();
        const before = anchor && map.getLayer(anchor) ? anchor : undefined;
        if (!map.getLayer(HALO)) {
            styled = null;
            map.addLayer({
                id: HALO, type: 'line', source: SOURCE,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': ['get', 'halo'], 'line-width': 8, 'line-opacity': 0.26, 'line-blur': 1 }
            }, before);
        }
        if (!map.getLayer(LAYER)) {
            styled = null;
            map.addLayer({
                id: LAYER, type: 'line', source: SOURCE,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 1 }
            }, before);
        }
    }

    function step() {
        const id = host.selected();
        const layer = id != null ? host.flownLayer(id) : null;
        if (id == null || !layer || !map.getLayer(layer)) { clear(); return; }

        const vis = map.getLayoutProperty(layer, 'visibility') || 'visible';
        for (const other of host.companions(id)) {
            if (map.getLayer(other) && (map.getLayoutProperty(other, 'visibility') || 'visible') !== vis) {
                map.setLayoutProperty(other, 'visibility', vis);
            }
        }

        const pose = host.pose(id);
        if (!end || end.id !== String(id) || !pose || vis === 'none') { clear(); return; }
        ensureLayers();

        // Drawn as the path it grows from is.
        const halo = host.haloLayer(id);
        const paint = {
            width: map.getPaintProperty(layer, 'line-width'),
            opacity: map.getPaintProperty(layer, 'line-opacity'),
            haloWidth: halo && map.getLayer(halo) ? map.getPaintProperty(halo, 'line-width') : null,
            haloOpacity: halo && map.getLayer(halo) ? map.getPaintProperty(halo, 'line-opacity') : 0
        };
        const s = styled;
        if (!s || !same(s.width, paint.width)) map.setPaintProperty(LAYER, 'line-width', paint.width != null ? paint.width : 4);
        if (!s || !same(s.opacity, paint.opacity)) map.setPaintProperty(LAYER, 'line-opacity', paint.opacity != null ? paint.opacity : 1);
        if (!s || !same(s.haloWidth, paint.haloWidth)) map.setPaintProperty(HALO, 'line-width', paint.haloWidth != null ? paint.haloWidth : 8);
        if (!s || !same(s.haloOpacity, paint.haloOpacity)) map.setPaintProperty(HALO, 'line-opacity', paint.haloOpacity != null ? paint.haloOpacity : 0);
        styled = paint;

        // How far it has moved, in pixels at the map's scale where it is
        // (iOS FlightMotion.pointsApart) — not through the projection, which
        // with the map tilted can put the ground under an aeroplane in the
        // air behind the camera, where every point projects to the same place.
        const w = written;
        if (w && w.id === end.id && w.endLon === end.lon && w.endLat === end.lat
            && w.colour === end.colour && w.halo === end.halo) {
            const cosLat = Math.max(Math.cos(pose[1] * DEG2RAD), 0.01);
            const pxPerMetre = 512 * Math.pow(2, map.getZoom()) / (EARTH_CIRCUMFERENCE * cosLat);
            const north = (pose[1] - w.lat) * M_PER_DEG;
            const east = (((pose[0] - w.lon + 540) % 360) - 180) * M_PER_DEG * cosLat;
            if (Math.hypot(north, east) * pxPerMetre < REWRITE_PX) return;
        }
        // Unwrapped onto the path's end, so the antimeridian is a short hop.
        let lon = pose[0];
        while (lon - end.lon > 180) lon -= 360;
        while (lon - end.lon < -180) lon += 360;
        map.getSource(SOURCE).setData({
            type: 'Feature',
            properties: { color: end.colour, halo: end.halo },
            geometry: { type: 'LineString', coordinates: [[end.lon, end.lat], [lon, pose[1]]] }
        });
        written = { id: end.id, lon: pose[0], lat: pose[1], endLon: end.lon, endLat: end.lat, colour: end.colour, halo: end.halo };
    }

    function init(m, h) {
        if (map) return;
        map = m;
        host = h;
        requestAnimationFrame(tick);
    }

    return { init, noteEnd };
})();
