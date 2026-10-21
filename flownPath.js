/**
 * flownPath.js
 * -------------------------------------------------------------------
 * The flown path, built the way the iOS app builds it — the same trail, the
 * same curve, the same colours — so the website and the app draw one track.
 *
 *   FlownTrail      FlightTrailStore: the breadcrumbs each aircraft has
 *                   flown, thinned by distance, seeded from /history.
 *   buildFlownPath  FlownPath + PathSmoothing + FlownPathProfile: the track
 *                   as runs of one colour each, curved through every
 *                   breadcrumb, with each point's height for the path in the
 *                   air.
 *   altitudeColour  AltitudeBand.color(forFeet:), and haloFor
 *                   FlownPathStyle.halo(for:).
 *   FLOWN_STYLE     FlownPathStyle / MapLayerStyle: the widths and opacities.
 *
 * What the map does with these (flight.js, flownHead.js, aircraftEngine.js):
 * the path is rebuilt only when the trail takes a new breadcrumb, ending on
 * the live position at that moment; between rebuilds one short segment, the
 * flown head, runs from where the path ends to wherever the aeroplane is
 * drawn, on every frame (TrackerMapView.updateFlownHead). Beside the 3D
 * aircraft the same runs are drawn at their heights and end on the model;
 * the flat line stays under them as their shadow.
 * ===================================================================
 */

const DEG = Math.PI / 180;
const EARTH_NM = 3440.065;

export function distanceNM(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * DEG;
    const dLon = (lon2 - lon1) * DEG;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// TrackPoint.isAirborne: the one notion of "on the ground" in the app.
export function isAirborne(p) {
    return !(p.gs < 40 && p.alt < 10000);
}

// A breadcrumb in the shape the store keeps: { lat, lon, alt (ft), gs (kt),
// date (ms) }, from a /history route point or anything shaped like one.
export function trackPoint(p) {
    if (!p) return null;
    const lat = Number(p.latitude != null ? p.latitude : p.lat);
    const lon = Number(p.longitude != null ? p.longitude : p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const alt = Number(p.altitude != null ? p.altitude : (p.alt_ft != null ? p.alt_ft : p.alt));
    const gs = Number(p.groundSpeed != null ? p.groundSpeed : (p.gs_kt != null ? p.gs_kt : p.gs));
    const date = typeof p.date === 'number' ? p.date : Date.parse(p.date);
    return {
        lat, lon,
        alt: Number.isFinite(alt) ? alt : 0,
        gs: Number.isFinite(gs) ? gs : 0,
        date: Number.isFinite(date) ? date : NaN
    };
}

// --- The trail (FlightTrailStore) ------------------------------------------

export const FlownTrail = (() => {
    // Two miles is a handful of seconds at cruise, so nearly every packet is
    // kept and the path is dense.
    const INITIAL_SPACING_NM = 2;
    // Past this many points the trail halves its resolution and doubles its
    // spacing, rather than forgetting where it came from.
    const MAXIMUM_POINTS = 260;

    // id -> { points, spacingNM, isSeeded, revision }
    const trails = new Map();

    // A sample from one aircraft's packet.
    function record(id, sample) {
        const key = String(id);
        const p = trackPoint(sample);
        if (!p) return;
        const trail = trails.get(key);
        if (!trail) {
            trails.set(key, { points: [p], spacingNM: INITIAL_SPACING_NM, isSeeded: false, revision: 0 });
            return;
        }
        const last = trail.points[trail.points.length - 1];
        if (last && distanceNM(last.lat, last.lon, p.lat, p.lon) < trail.spacingNM) return;
        trail.points.push(p);
        if (trail.points.length > MAXIMUM_POINTS) {
            trail.points = trail.points.filter((_, i) => i % 2 === 0);
            trail.spacingNM *= 2;
        }
    }

    // Aircraft that have stopped reporting keep no trail.
    function prune(live) {
        if (trails.size <= live.size) return;
        for (const key of trails.keys()) if (!live.has(key)) trails.delete(key);
    }

    // The backend's full history in place of the fragment seen live; anything
    // recorded after its last point is kept on the end, so a path fetched
    // mid-flight doesn't rewind.
    function seed(id, history) {
        const key = String(id);
        const points = (history || []).map(trackPoint).filter(Boolean);
        if (!points.length) return;
        const merged = points;
        const cutoff = points[points.length - 1].date;
        const existing = trails.get(key);
        if (existing && Number.isFinite(cutoff)) {
            for (const p of existing.points) if (Number.isFinite(p.date) && p.date > cutoff) merged.push(p);
        }
        const spacingNM = Math.max(INITIAL_SPACING_NM, merged.length / MAXIMUM_POINTS * INITIAL_SPACING_NM);
        trails.set(key, { points: merged, spacingNM, isSeeded: true, revision: (existing ? existing.revision : 0) + 1 });
    }

    const points = (id) => (trails.get(String(id)) || {}).points || [];
    const revision = (id) => (trails.get(String(id)) || {}).revision || 0;
    const hasHistory = (id) => !!(trails.get(String(id)) || {}).isSeeded;
    const clear = () => trails.clear();

    return { record, prune, seed, points, revision, hasHistory, clear };
})();

// --- Colours (AltitudeBand, FlownPathStyle.halo) ---------------------------

// The upper bound of each band in feet; the last band is open.
const CEILINGS = [2500, 10000, 18000, 25000, 31000, 37000];
// Pale and cool at the bottom, hot at the top, ending in red above FL370.
const BAND_COLOURS = [
    [0.753, 0.902, 0.980, 0.95], // ice
    [0.470, 0.800, 0.925, 0.95], // sky
    [0.549, 0.855, 0.549, 0.95], // light green
    [0.925, 0.871, 0.396, 0.95], // light yellow
    [0.969, 0.741, 0.247, 0.95], // amber
    [0.957, 0.502, 0.161, 0.95], // orange
    [0.871, 0.161, 0.184, 0.95]  // red
];
// Where the height was never sent: an admission about the data.
export const UNKNOWN_COLOUR = [0.62, 0.62, 0.62, 0.95];
// On the ground: the aircraft's own trail over the airport diagram.
export const GROUND_COLOUR = [1, 1, 1, 0.95];
// A core every channel of which is at least this bright gets a dark halo.
const PALE_CORE = 0.70;

export function altitudeBand(feet) {
    if (!Number.isFinite(feet)) return 0;
    for (let i = 0; i < CEILINGS.length; i++) if (feet < CEILINGS[i]) return i;
    return CEILINGS.length;
}

// The open top band's stop sits at its floor, so the ramp reaches red at
// FL370 and holds it.
function midpoint(band) {
    if (band >= CEILINGS.length) return CEILINGS[CEILINGS.length - 1];
    const low = band === 0 ? 0 : CEILINGS[band - 1];
    return (low + CEILINGS[band]) / 2;
}

// The ramp between the band stops.
export function altitudeColour(feet) {
    if (!Number.isFinite(feet)) return BAND_COLOURS[0];
    const f = Math.max(feet, 0);
    const top = BAND_COLOURS.length - 1;
    if (f <= midpoint(0)) return BAND_COLOURS[0];
    if (f >= midpoint(top)) return BAND_COLOURS[top];
    for (let upper = 1; upper <= top; upper++) {
        const high = midpoint(upper);
        if (f > high) continue;
        const low = midpoint(upper - 1);
        const t = high > low ? Math.min(Math.max((f - low) / (high - low), 0), 1) : 0;
        const a = BAND_COLOURS[upper - 1], b = BAND_COLOURS[upper];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
    return BAND_COLOURS[top];
}

// Ordinarily the path's own colour; a core too pale to lift itself off the
// map gets a dark halo instead — a shadow rather than a glow.
export function haloFor(c) {
    return Math.min(c[0], c[1], c[2]) >= PALE_CORE ? [0, 0, 0, c[3]] : c;
}

export function rgba(c) {
    return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${Math.round(c[3] * 1000) / 1000})`;
}

// A sample's colour: grey where no height was sent, white on the ground, the
// height everywhere else — asked in that order.
function sampleColour(band, p) {
    if (band == null) return UNKNOWN_COLOUR;
    if (!isAirborne(p)) return GROUND_COLOUR;
    return altitudeColour(p.alt);
}

// How far a path can run at exactly zero feet before the zero is read as
// missing rather than low.
const UNKNOWN_HEIGHT_RUN_NM = 20;

// The band of each sample, or null where its height is missing.
export function heightBands(points) {
    const bands = points.map((p) => altitudeBand(p.alt));
    let start = 0;
    while (start < points.length) {
        if (points[start].alt !== 0) { start++; continue; }
        let end = start;
        while (end + 1 < points.length && points[end + 1].alt === 0) end++;
        const span = distanceNM(points[start].lat, points[start].lon, points[end].lat, points[end].lon);
        if (span > UNKNOWN_HEIGHT_RUN_NM) for (let i = start; i <= end; i++) bands[i] = null;
        start = end + 1;
    }
    return bands;
}

// --- Heights (FlownPathProfile) --------------------------------------------

const FEET = 0.3048;

// Gaps closed by straight lines; held level past either end.
function filled(values) {
    const first = values.findIndex((v) => v != null);
    if (first < 0) return values.map(() => 0);
    const out = values.map(() => values[first]);
    let previous = first;
    for (let i = first + 1; i < values.length; i++) {
        if (values[i] == null) continue;
        out[i] = values[i];
        const start = values[previous];
        const span = i - previous;
        for (let g = previous + 1; g < i; g++) out[g] = start + (values[i] - start) * (g - previous) / span;
        previous = i;
    }
    for (let i = previous + 1; i < values.length; i++) out[i] = values[previous];
    return out;
}

// Each sample's height above the field it last stood on (or the first one
// after, before any), in metres; and that field's altitude in feet.
export function sampleHeights(points, bands) {
    let lastGround = null;
    const reference = points.map((p, i) => {
        if (bands[i] != null && !isAirborne(p)) lastGround = p.alt;
        return lastGround;
    });
    const firstIdx = points.findIndex((p, i) => bands[i] != null && !isAirborne(p));
    const firstGround = firstIdx >= 0 ? points[firstIdx].alt : null;
    const known = points.map((p, i) => {
        if (bands[i] == null) return null;
        if (!isAirborne(p)) return 0;
        const field = reference[i] != null ? reference[i] : (firstGround != null ? firstGround : 0);
        return Math.max(p.alt - field, 0) * FEET;
    });
    return { heights: filled(known), groundFeet: lastGround };
}

// Each sample's altitude above the sea, in metres.
export function seaHeights(points, bands) {
    return filled(points.map((p, i) => (bands[i] != null ? p.alt * FEET : null)));
}

function planarDistance(aLat, aLon, bLat, bLon) {
    const scale = Math.cos((aLat + bLat) / 2 * DEG);
    const dx = (bLon - aLon) * scale, dy = bLat - aLat;
    return Math.sqrt(dx * dx + dy * dy);
}

// The height at a point of the curve on the piece of track starting at
// sample `origin`: a Catmull–Rom through the samples around it, never past
// either end's height.
function heightAt(lat, lon, origin, points, heights) {
    const n = heights.length;
    if (!n) return 0;
    const i1 = Math.min(Math.max(origin, 0), n - 1);
    const i2 = Math.min(i1 + 1, n - 1);
    if (i1 === i2) return heights[i1];
    const a = planarDistance(points[i1].lat, points[i1].lon, lat, lon);
    const b = planarDistance(lat, lon, points[i2].lat, points[i2].lon);
    const t = a + b > 0 ? a / (a + b) : 0;
    const p0 = heights[Math.max(i1 - 1, 0)], p1 = heights[i1], p2 = heights[i2], p3 = heights[Math.min(i2 + 1, n - 1)];
    const t2 = t * t, t3 = t2 * t;
    const curve = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
    return Math.min(Math.max(curve, Math.min(p1, p2)), Math.max(p1, p2));
}

// --- The curve (PathSmoothing) ---------------------------------------------

const MIN_SUBDIVISIONS = 4;
const MAX_SUBDIVISIONS = 14;
const POINT_BUDGET = 3000;
const MAXIMUM_INPUT = 4000;
const ALPHA = 0.5;
const DATE_LINE_JUMP = 180;

function knotSpan(a, b) {
    const dx = b.lon - a.lon, dy = b.lat - a.lat;
    return Math.pow(Math.sqrt(dx * dx + dy * dy), ALPHA);
}

// Barry–Goldman: the non-uniform Catmull–Rom without its basis matrix.
function interpolate(p0, p1, p2, p3, t0, t1, t2, t3, t) {
    const a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1;
    const a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2;
    const a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3;
    const b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2;
    const b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3;
    return (t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2;
}

// A denser line curved through every point (centripetal Catmull–Rom), and
// which input point each output point came from. `straight` marks points on
// pavement, whose segments are emitted as the straight lines they are.
export function smoothedWithOrigins(coords, straight = []) {
    const n = coords.length;
    if (n < 3 || n > MAXIMUM_INPUT) return { coords: coords.slice(), origins: coords.map((_, i) => i) };
    const pinned = straight.length === n ? straight : null;
    const sub = Math.min(Math.max(Math.floor(POINT_BUDGET / n), MIN_SUBDIVISIONS), MAX_SUBDIVISIONS);
    const out = [coords[0]];
    const origins = [0];
    for (let i = 0; i < n - 1; i++) {
        const p1 = coords[i], p2 = coords[i + 1];
        const p0 = coords[Math.max(i - 1, 0)], p3 = coords[Math.min(i + 2, n - 1)];
        const straddles = Math.abs(p0.lon - p1.lon) > DATE_LINE_JUMP
            || Math.abs(p1.lon - p2.lon) > DATE_LINE_JUMP
            || Math.abs(p2.lon - p3.lon) > DATE_LINE_JUMP;
        const pavement = !!pinned && (pinned[i] || pinned[i + 1]);
        if (straddles || pavement) { out.push(p2); origins.push(i); continue; }
        const t0 = 0, t1 = t0 + knotSpan(p0, p1), t2 = t1 + knotSpan(p1, p2), t3 = t2 + knotSpan(p2, p3);
        if (!(t1 > t0 && t2 > t1 && t3 > t2)) { out.push(p2); origins.push(i); continue; }
        for (let s = 1; s <= sub; s++) {
            const t = t1 + (t2 - t1) * s / sub;
            out.push({
                lat: interpolate(p0.lat, p1.lat, p2.lat, p3.lat, t0, t1, t2, t3, t),
                lon: interpolate(p0.lon, p1.lon, p2.lon, p3.lon, t0, t1, t2, t3, t)
            });
            origins.push(i);
        }
    }
    return { coords: out, origins };
}

// --- The path (FlownPath) --------------------------------------------------

// At most this many samples are coloured individually; the geometry keeps
// every point either way.
const MAXIMUM_COLOUR_SAMPLES = 256;

const unwrapAfter = (lon, prev) => {
    while (lon - prev > 180) lon -= 360;
    while (prev - lon > 180) lon += 360;
    return lon;
};

/**
 * The track as runs of one colour each.
 *
 * @param {Array<{lat, lon, alt, gs}>} points  oldest first
 * @param {{ onPavement?: boolean[], air?: boolean }} [options]
 *        onPavement parallel to points: geometry already matched onto the
 *        taxiways, left uncurved; air: work out each point's height too.
 * @returns {null | { runs: Array<{ coords: [lon, lat][], colour, heights,
 *          sea }>, tail: [lon, lat], tailColour, tailHeight, groundFeet }}
 */
export function buildFlownPath(points, options = {}) {
    const n = points.length;
    if (n < 2) return null;
    const bands = heightBands(points);
    let heights = [], sea = [], groundFeet = null;
    if (options.air) {
        const profile = sampleHeights(points, bands);
        heights = profile.heights;
        groundFeet = profile.groundFeet;
        sea = seaHeights(points, bands);
    }

    // The colour at each sample, recomputed on a stride, at every take-off
    // and landing, and at the ends.
    const step = Math.max(1, Math.ceil(n / MAXIMUM_COLOUR_SAMPLES));
    const colours = new Array(n);
    let last = sampleColour(bands[0], points[0]);
    for (let i = 0; i < n; i++) {
        const leaves = i > 0 && isAirborne(points[i]) !== isAirborne(points[i - 1]);
        if (i % step === 0 || leaves || i === n - 1) last = sampleColour(bands[i], points[i]);
        colours[i] = last;
    }

    const smoothed = smoothedWithOrigins(points, options.onPavement || []);
    if (smoothed.coords.length < 2) return null;

    // The curve, each point's colour and height, longitudes continuous.
    const coords = [], cols = [], hs = [], ss = [];
    for (let k = 0; k < smoothed.coords.length; k++) {
        const c = smoothed.coords[k];
        if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
        const origin = Math.min(smoothed.origins[k], n - 1);
        const lon = coords.length ? unwrapAfter(c.lon, coords[coords.length - 1][0]) : c.lon;
        coords.push([lon, c.lat]);
        cols.push(colours[origin]);
        if (heights.length) hs.push(heightAt(c.lat, c.lon, origin, points, heights));
        if (sea.length) ss.push(heightAt(c.lat, c.lon, origin, points, sea));
    }
    if (coords.length < 2) return null;

    // Segment i runs from point i to point i + 1 in point i's colour; a run
    // ends where the colour changes, and the next starts on its last point.
    const keys = cols.map(rgba);
    const runs = [];
    const segments = coords.length - 1;
    let start = 0;
    while (start < segments) {
        let end = start;
        while (end + 1 < segments && keys[end + 1] === keys[start]) end++;
        runs.push({
            coords: coords.slice(start, end + 2),
            colour: cols[start],
            heights: hs.length ? hs.slice(start, end + 2) : [],
            sea: ss.length ? ss.slice(start, end + 2) : []
        });
        start = end + 1;
    }
    return {
        runs,
        tail: coords[coords.length - 1],
        tailColour: cols[cols.length - 1],
        tailHeight: hs.length ? hs[hs.length - 1] : null,
        groundFeet
    };
}

// --- Style (FlownPathStyle, MapLayerStyle) ---------------------------------

const CLOSE_WIDTH = 4.6, FAR_WIDTH = 3.2;
const CLOSE_DISTANCE = 150000, FAR_DISTANCE = 8000000;

function widthForDistance(d) {
    if (!(d > 0) || d <= CLOSE_DISTANCE) return CLOSE_WIDTH;
    if (d >= FAR_DISTANCE) return FAR_WIDTH;
    const travel = Math.log(d / CLOSE_DISTANCE) / Math.log(FAR_DISTANCE / CLOSE_DISTANCE);
    return CLOSE_WIDTH + (FAR_WIDTH - CLOSE_WIDTH) * travel;
}

// A width that tapers the further back the camera stands, as a zoom ramp.
function zoomRamp(width) {
    const expr = ['interpolate', ['linear'], ['zoom']];
    for (let z = 1; z <= 16; z += 1.5) expr.push(z, Math.round(width(77500000 / Math.pow(2, z)) * 100) / 100);
    return expr;
}

const inferredWidth = (d) => Math.max(1.1, widthForDistance(d) * 0.41 * 0.9);

export const FLOWN_STYLE = {
    width: zoomRamp(widthForDistance),
    haloWidth: zoomRamp((d) => widthForDistance(d) * 2.2),
    glowOpacity: 0.26,
    // How much of the flat path stays under the one in the air.
    shadowOpacity: 0.3,
    inferredWidth: zoomRamp(inferredWidth),
    inferredDash: [2, 7].map((p) => p / Math.max(inferredWidth(CLOSE_DISTANCE), 0.5)),
    inferredColour: 'rgba(255,255,255,0.34)'
};
