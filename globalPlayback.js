// globalPlayback.js
// Rewind the whole map. Pick a moment in the past and watch the world's
// traffic move as it actually did — every flight on the server, not one
// aircraft and not one controller's airspace.
//
// This is the third replay in the app and deliberately the widest. flightReplay
// follows a single aircraft; atcReplay reconstructs one controller's session.
// This one has no subject at all: the subject is the map.
//
// The paid line is how far back you may reach:
//
//   free   the last 24 hours
//   Pro    the last 14 days
//
// That is enforced on the server (see global_playback.cjs) — the picker below
// locks the out-of-reach options so a free pilot is told what Pro buys before
// they click, rather than after a refusal. The lock is courtesy; the server is
// the authority.
//
// Public API:
//   GlobalPlayback.open({ map, apiBase, sessionId?, serverName?, onClose? })
//   GlobalPlayback.close()
//   GlobalPlayback.isOpen()

const SPEED_OPTIONS = [15, 60, 120, 300, 600];
const DEFAULT_SPEED = 120;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Window lengths on offer. Trimmed at open() to whatever the server says it
// will actually serve, so the two can never drift apart.
const SPAN_CHOICES = [
    { ms: 30 * 60 * 1000, label: '30 min' },
    { ms: HOUR_MS, label: '1 hour' },
    { ms: 3 * HOUR_MS, label: '3 hours' },
    { ms: 6 * HOUR_MS, label: '6 hours' }
];
const DEFAULT_SPAN_MS = HOUR_MS;

// How much flown history trails behind each aircraft, in session time.
const TRAIL_WINDOW_MS = 15 * 60 * 1000;
// A world-scale replay can hold thousands of aircraft, and every one of them
// wants a tail. How many actually get one, and how many points each is drawn
// with, are capped below (MAX_TRAIL_FEATURES / TRAIL_POINTS) — a shorter tail
// on the aircraft you can pick out beats a full tail on all of them.

/* =========================
 * Motion
 * =========================
 * The recorder throttles a cruising aircraft to one position report every two
 * minutes (history.cjs, CRUISE_THROTTLE_MS). At 450 knots that is a fifteen-mile
 * gap between samples, so drawing straight lines between them gives a track
 * made of long chords with the heading snapping at every corner — the exact
 * "teleporting" look this is here to avoid.
 *
 * Aircraft do not fly like that. A Catmull-Rom spline, with tangents taken from
 * each sample's neighbours, reconstructs the curve they actually flew: position
 * and direction are both continuous, so a turn arrives as a turn rather than as
 * a corner. It costs a handful of multiplies per visible aircraft per frame.
 */

// Past this long without a position report the aircraft was not being tracked,
// and interpolating across the hole would slide it smoothly over ground it was
// never seen covering. Smooth nonsense is still nonsense — it leaves the map
// until reporting resumes.
const MAX_INTERP_GAP_MS = 10 * 60 * 1000;

// A spline is only worth it while the samples describe a curve. Across a very
// long gap the tangents are guesses, so those segments fall back to a straight
// line rather than bowing out to a shape nothing flew.
const MAX_SPLINE_SEGMENT_MS = 4 * 60 * 1000;

// How long an aircraft takes to fade in when its track begins, and out when it
// ends — in session time, so it scales with playback speed. Without it, a
// couple of thousand aircraft blink in and out of existence mid-window.
const FADE_MS = 20 * 1000;

/* =========================
 * Frame scheduling
 * =========================
 * `setData()` is not a cheap assignment: Mapbox throws away the source's tile
 * index, rebuilds it, and re-runs symbol layout for every tile. MapAnimator
 * learned this the hard way on live traffic — see its header — and a world-wide
 * replay pushes far more features far more often than live traffic ever does.
 *
 * So the clock and the pushes are decoupled. Position is always evaluated
 * against real elapsed time, which keeps playback honest; how often that gets
 * handed to Mapbox is governed by what Mapbox can actually absorb, measured
 * rather than assumed.
 *
 * This self-balances against zoom, which is what makes it work at both ends.
 * Zoomed in, culling leaves a handful of aircraft, pushes cost almost nothing
 * and run every frame — visibly smooth. Zoomed out to the whole Atlantic there
 * are thousands, pushes cost more and run less often, but at that scale each
 * aircraft moves a fraction of a pixel between them, so the lower rate cannot
 * be seen.
 */

// The rate to hold. Thirty pushes a second is smooth to the eye, and leaving
// headroom under the display's own 60 Hz means a push that runs long lands in
// the gap rather than dropping a frame.
const TARGET_PUSH_INTERVAL_MS = 33;
// Share of wall-clock time pushing may consume before the rate gives way. The
// rate is the *last* thing to give — screen-space thinning caps the work first.
const PUSH_DUTY_CYCLE = 0.4;
// The floor, for a device that cannot hold the target even with the drawn set
// capped. Below this the stepping is plainly visible, so there is no point
// degrading further; something else has to give instead.
const MAX_PUSH_INTERVAL_MS = 80;
// Trails are a background element and a heavier geometry rebuild. They run on
// their own slower cadence; nobody can see a comet tail lag by a twentieth of a
// second behind the aircraft drawing it.
const TRAIL_PUSH_INTERVAL_MS = 100;
// Vertices per comet tail. A tail says where something came from; a dozen
// points draw that as well as sixty and cost a fifth as much geometry.
const TRAIL_POINTS = 12;
// How many aircraft get a tail at all. Past this the tails are a wash rather
// than information, and they are the most expensive geometry on the map.
const MAX_TRAIL_FEATURES = 700;
// How far outside the viewport an aircraft is still worth drawing. Enough that
// one flies in from off-screen already moving, rather than appearing at the
// edge, and enough to cover a flick-pan before the next push lands.
const CULL_MARGIN_FRACTION = 0.35;
// A pinch or wheel-zoom is competing for the same tiles a push would rebuild,
// so pushes stand down while the camera moves — but only briefly, because here
// the content is moving too and a frozen world reads as a stall.
const MAX_CAMERA_DEFER_MS = 350;

const SPEED_STORAGE_KEY = 'globalPlaybackSpeed';
const SPAN_STORAGE_KEY = 'globalPlaybackSpanMs';
const TRAILS_STORAGE_KEY = 'globalPlaybackTrails';

export const GlobalPlayback = (() => {
    // ---------- state ----------
    let map = null;
    let apiBase = '';
    let sessionId = null;            // Infinite Flight server GUID, or null for all
    let serverName = '';
    let onCloseCallback = null;

    let limits = null;               // the server's answer to "what may I ask for?"
    let flights = [];                // { flightId, callsign, username, category, points[], cursor }
    let flightsById = new Map();     // flightId -> the same objects, for hit-testing
    let windowMeta = null;           // { start, end, stepMs } of the loaded window

    // One clock for the whole world. Everything is drawn against it, which is
    // the only reason the picture is coherent: aircraft that were in the air
    // together move together.
    let spanStart = 0;
    let totalDurationMs = 0;
    let currentMs = 0;
    let speed = DEFAULT_SPEED;
    let spanMs = DEFAULT_SPAN_MS;
    let isPlaying = false;
    let isScrubbing = false;
    let showTrails = true;
    let rafId = null;
    let lastFrameAt = 0;

    let panelEl = null;
    let pickerEl = null;
    let loadingEl = null;
    let onKeyDown = null;
    let onProStatusChanged = null;
    let abortLoad = null;

    // Persistent GeoJSON. These objects are written, never rebuilt: a few
    // thousand features and tens of thousands of coordinate pairs, reallocated
    // several times a second, is tens of megabytes per second of garbage — on
    // a phone that is not slow, it is a crash after a few minutes of playing.
    // Pools are keyed by draw slot rather than by aircraft, because nothing
    // downstream tracks a feature's identity from one push to the next.
    const planePool = [];                // slot -> Feature
    const trailPool = [];                // slot -> Feature (coordinates reused)
    const planeList = [];                // persistent; truncated, never replaced
    const trailList = [];
    const planeCollection = { type: 'FeatureCollection', features: planeList };
    const trailCollection = { type: 'FeatureCollection', features: trailList };

    // Push scheduling (see the header note on setData cost).
    let lastPlanePush = 0;
    let lastTrailPush = 0;
    let frameCostEMA = 3;                // ms, exponential moving average
    let pushIntervalMs = TARGET_PUSH_INTERVAL_MS;
    let cameraMoving = false;
    let cameraDeferredSince = 0;
    let onMoveStart = null, onMoveEnd = null;
    let onVisibilityChange = null;
    let wasPlayingWhenHidden = false;

    // Hover / selection.
    let hoverPopup = null;
    let onPlaneEnter = null, onPlaneLeave = null, onPlaneClick = null;
    let selectedFlightId = null;

    let airborneCount = 0;               // aircraft with a position this frame
    let drawnCount = 0;                  // …of which are inside the viewport

    const SRC_PLANES = 'global-playback-planes-source';
    const LYR_PLANES = 'global-playback-planes-layer';
    const LYR_PLANE_LABELS = 'global-playback-plane-labels';
    const SRC_TRAILS = 'global-playback-trails-source';
    const LYR_TRAILS = 'global-playback-trails-layer';

    // Live traffic is blanked while the replay is up, exactly as flightReplay
    // and atcReplay do it: snapshot each layer's filter, hide everything, put
    // the filters back on close. Anything less leaves live aircraft flying
    // through a historical picture.
    let prevTrafficFilters = null;
    const TRAFFIC_LAYER_IDS = [
        'sector-ops-live-flights-layer',
        'sector-ops-live-flights-natural-layer',
        'sector-ops-live-flights-hover-layer',
        'sector-ops-live-flights-labels'
    ];
    const HIDE_ALL_FILTER = ['==', ['get', 'flightId'], '__none__'];

    /* =========================
     * Small helpers
     * ========================= */

    // Altitude ramp, matched to flightReplay/atcReplay so a track means the
    // same thing whichever replay you are looking at.
    //
    // Quantised into bands and precomputed, because the obvious version builds
    // an `rgb(…)` string per aircraft per push — a few hundred throwaway
    // strings thirty times a second, which is exactly the kind of quiet churn
    // this module cannot afford. Two hundred bands is finer than the eye can
    // separate on a ramp this wide.
    const ALT_BANDS = 200;
    const ALT_CEIL = 40000;
    const ALT_COLORS = (() => {
        const stops = [
            [0, [56, 189, 248]],
            [10000, [45, 212, 191]],
            [20000, [163, 230, 53]],
            [30000, [250, 204, 21]],
            [40000, [248, 113, 113]]
        ];
        const out = new Array(ALT_BANDS + 1);
        for (let b = 0; b <= ALT_BANDS; b++) {
            const a = (b / ALT_BANDS) * ALT_CEIL;
            let color = 'rgb(248,113,113)';
            for (let i = 0; i < stops.length - 1; i++) {
                const [lo, c0] = stops[i], [hi, c1] = stops[i + 1];
                if (a <= hi) {
                    const f = (a - lo) / (hi - lo || 1);
                    color = `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * f)},`
                          + `${Math.round(c0[1] + (c1[1] - c0[1]) * f)},`
                          + `${Math.round(c0[2] + (c1[2] - c0[2]) * f)})`;
                    break;
                }
            }
            out[b] = color;
        }
        return out;
    })();

    function getAltColor(alt) {
        const a = alt > 0 ? (alt < ALT_CEIL ? alt : ALT_CEIL) : 0;
        return ALT_COLORS[(a / ALT_CEIL * ALT_BANDS) | 0];
    }

    // The sprite sheet the live map already loaded.
    //
    // The fallback is not politeness. A symbol layer whose `icon-image`
    // resolves to a frame that is not registered makes Mapbox re-request the
    // missing image — on every frame, for as long as the layer is drawn. At
    // sixty frames a second across a replay left playing, that is the leak
    // atcReplay's own comment records as eventually crashing the iOS web view.
    // So the resolved name is checked against the map before it is used, and
    // anything unknown becomes a real aircraft instead.
    const FALLBACK_CATEGORY = 'B737';
    const categoryCache = new Map();

    function categoryFor(aircraftName) {
        const key = aircraftName || '';
        const cached = categoryCache.get(key);
        if (cached !== undefined) return cached;

        let cat = FALLBACK_CATEGORY;
        if (typeof window.getAircraftCategory === 'function') {
            try {
                const c = window.getAircraftCategory(aircraftName);
                if (c && c !== 'default') cat = c;
            } catch (_) { /* keep the fallback */ }
        }
        // hasImage() is only meaningful once the map exists and its sprites are
        // registered; before that we take the mapping on trust, which is the
        // same trust the live map places in it.
        try {
            if (map && map.hasImage && !map.hasImage(`icon-${cat}`)) {
                if (map.hasImage(`icon-${FALLBACK_CATEGORY}`)) cat = FALLBACK_CATEGORY;
            }
        } catch (_) { /* keep what we have */ }

        categoryCache.set(key, cat);
        return cat;
    }

    function fmtZulu(epochMs) {
        const d = new Date(epochMs);
        const p = (n) => String(n).padStart(2, '0');
        return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}Z`;
    }
    function fmtZuluDate(epochMs) {
        const d = new Date(epochMs);
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${fmtZulu(epochMs)}`;
    }
    function fmtClock(ms) {
        const total = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const p = (n) => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
    }
    // "3 hours ago", "2 days ago" — how a pilot actually thinks about when
    // something happened, rather than a timestamp they have to decode.
    function fmtAgo(ms) {
        if (ms < HOUR_MS) return `${Math.round(ms / 60000)} min ago`;
        if (ms < DAY_MS) {
            const h = Math.round(ms / HOUR_MS);
            return `${h} hour${h === 1 ? '' : 's'} ago`;
        }
        const d = Math.round(ms / DAY_MS);
        return `${d} day${d === 1 ? '' : 's'} ago`;
    }

    // Callsigns, pilot names and aircraft types are recorded from what pilots
    // typed into Infinite Flight, so they are not ours and they go into the
    // hover card as text, never as markup.
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function isProUser() {
        try {
            if (typeof window.isInflightPro === 'function' && window.isInflightPro()) return true;
        } catch (_) { /* ignore */ }
        try {
            if (localStorage.getItem('inflight_is_pro') === 'true') return true;
        } catch (_) { /* storage unavailable */ }
        return false;
    }

    function promptUpgrade(source) {
        showToast('Playback beyond 24 hours is an Inflight Pro feature.');
        try {
            window.dispatchEvent(new CustomEvent('pro-upgrade-requested', {
                bubbles: true, cancelable: true, detail: { source: source || 'global-playback' }
            }));
        } catch (_) { /* nothing listening */ }
    }

    function showToast(msg, type = 'info') {
        if (typeof window.showGlobalNotification === 'function') {
            try { window.showGlobalNotification(msg, type); return; } catch (_) { /* fall through */ }
        }
        if (typeof window.showNotification === 'function') {
            try { window.showNotification(msg, type); return; } catch (_) { /* fall through */ }
        }
        console.info('[GlobalPlayback]', msg);
    }

    /* =========================
     * Data
     * ========================= */

    // Every request carries the pilot's Supabase token when there is one. The
    // tier is derived from it server-side — nothing here tells the backend what
    // it is entitled to, it only asks.
    async function authHeaders() {
        try {
            if (typeof window.getInflightAccessToken === 'function') {
                const token = await window.getInflightAccessToken();
                if (token) return { Authorization: `Bearer ${token}` };
            }
        } catch (_) { /* signed out */ }
        return {};
    }

    async function fetchLimits() {
        const res = await fetch(`${apiBase}/api/playback/limits`, {
            headers: await authHeaders(),
            cache: 'no-store'
        });
        if (!res.ok) throw new Error(`limits ${res.status}`);
        return res.json();
    }

    // Points arrive as [dt, lat, lon, alt, gs, hdg] with dt in seconds from the
    // window start — see global_playback.cjs. Rehydrated once here so the
    // animation loop never touches the wire format.
    //
    // Longitude is *unwrapped* as it goes: a flight crossing the antimeridian
    // reports 179.9 then -179.9, and taken literally that is a jump three
    // quarters of the way around the planet. Left alone it draws the aircraft
    // streaking backwards across the whole map and its trail as a horizontal
    // line through everything. Accumulating past ±180 instead keeps the track
    // continuous, and Mapbox wraps it back onto the globe when it draws.
    function normalizePath(packed, startMs) {
        const out = [];
        let prevLon = null;
        for (const p of packed || []) {
            if (!Array.isArray(p) || p.length < 3) continue;
            if (typeof p[1] !== 'number' || typeof p[2] !== 'number') continue;

            let lon = p[2];
            if (prevLon !== null) {
                // Move lon into the branch nearest the previous point. A real
                // step is never more than a few tenths of a degree, so anything
                // over half a turn is the wrap, not the aircraft.
                while (lon - prevLon > 180) lon -= 360;
                while (lon - prevLon < -180) lon += 360;
            }
            prevLon = lon;

            out.push({
                t: startMs + p[0] * 1000,
                lat: p[1],
                lon,
                alt: p[3] || 0,
                gs: p[4] || 0,
                hdg: p[5] || 0
            });
        }
        computeTangents(out);
        return out;
    }

    // The track's own extent, in time and in space, measured once at load.
    //
    // This is what keeps a zoomed-in view cheap. Interpolating every one of a
    // few thousand flights on every push, only to throw nearly all of them away
    // for being off-screen, is most of the frame budget spent on aircraft
    // nobody can see. Two comparisons against these bounds reject them first,
    // and only what might actually be on screen costs a spline evaluation.
    function measureTrack(f) {
        const pts = f.points;
        let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
        for (const p of pts) {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.lon < minLon) minLon = p.lon;
            if (p.lon > maxLon) maxLon = p.lon;
        }
        f.minLat = minLat; f.maxLat = maxLat;
        f.minLon = minLon; f.maxLon = maxLon;
        f.t0 = pts[0].t;
        f.t1 = pts[pts.length - 1].t;
        return f;
    }

    // Catmull-Rom tangents for a non-uniformly sampled track: each sample's
    // direction is the slope through its two neighbours, per unit time. Ends
    // use a one-sided difference, which is the same thing with the missing
    // neighbour collapsed onto the point itself.
    //
    // Computed once per flight at load rather than per frame — this is the part
    // that does not change as the clock moves.
    function computeTangents(pts) {
        const n = pts.length;
        for (let i = 0; i < n; i++) {
            const prev = pts[i > 0 ? i - 1 : i];
            const next = pts[i < n - 1 ? i + 1 : i];
            const dt = next.t - prev.t;
            if (dt <= 0) {
                pts[i].mLat = 0;
                pts[i].mLon = 0;
            } else {
                pts[i].mLat = (next.lat - prev.lat) / dt;
                pts[i].mLon = (next.lon - prev.lon) / dt;
            }
        }
    }

    async function loadWindow(startMs, requestedSpanMs) {
        if (abortLoad) { try { abortLoad.abort(); } catch (_) {} }
        abortLoad = new AbortController();

        const end = Math.min(startMs + requestedSpanMs, Date.now());
        const url = new URL(`${apiBase}/api/playback/global`);
        url.searchParams.set('start', String(Math.round(startMs)));
        url.searchParams.set('end', String(Math.round(end)));
        if (sessionId) url.searchParams.set('sessionId', sessionId);

        const res = await fetch(url.toString(), {
            headers: await authHeaders(),
            signal: abortLoad.signal
        });

        let body = null;
        try { body = await res.json(); } catch (_) { /* non-JSON error page */ }

        if (!res.ok) {
            const detail = body?.error || {};
            const err = new Error(detail.message || `Playback request failed (${res.status})`);
            err.status = res.status;
            // The one case worth a different ending: the window was well-formed
            // and simply past the tier.
            err.upgradeRequired = !!detail.upgradeRequired;
            err.limits = detail.limits || null;
            throw err;
        }
        if (!body || !body.ok) throw new Error('Playback returned no data.');
        return body;
    }

    /* =========================
     * Geometry
     * ========================= */

    // Reused so evaluating a couple of thousand aircraft per frame allocates
    // nothing. Callers must read what they need before the next call.
    const POS = { lat: 0, lon: 0, alt: 0, gs: 0, hdg: 0, t: 0, opacity: 1 };

    // Find the sample at or before absT, starting from the flight's last known
    // cursor. Playback advances monotonically, so the answer is almost always
    // the cursor itself or the one after it — scrubbing is the only thing that
    // jumps, and the search falls back to a walk that handles it.
    function seek(f, absT) {
        const pts = f.points;
        let i = f.cursor;
        if (i >= pts.length - 1) i = pts.length - 2;
        if (i < 0) i = 0;

        if (absT >= pts[i].t) {
            while (i < pts.length - 2 && pts[i + 1].t <= absT) i++;
        } else {
            while (i > 0 && pts[i].t > absT) i--;
        }
        f.cursor = i;
        return i;
    }

    /**
     * A flight's state at absolute time absT, or null when it has nothing to
     * say — either absT is outside its recorded track (which is how aircraft
     * enter and leave the replay at the moments they actually did) or it falls
     * inside a hole in the recording.
     *
     * That second case matters. Sliding an aircraft smoothly across a
     * half-hour reporting gap looks convincing and is a fabrication: it was not
     * seen flying that ground. Better to let it go and pick it up again when
     * the data resumes.
     *
     * Returns the shared POS object — do not retain it.
     */
    function positionAt(f, absT) {
        const pts = f.points;
        if (!pts || pts.length < 2) return null;

        const first = pts[0], last = pts[pts.length - 1];
        if (absT < first.t || absT > last.t) return null;

        const i = seek(f, absT);
        const a = pts[i], b = pts[i + 1];
        const dt = b.t - a.t;
        if (dt > MAX_INTERP_GAP_MS) return null;

        const u = dt > 0 ? (absT - a.t) / dt : 0;

        if (dt > 0 && dt <= MAX_SPLINE_SEGMENT_MS) {
            // Cubic Hermite with Catmull-Rom tangents. h10/h11 carry the
            // tangents, which are per-unit-time, so they are scaled by the
            // segment's own duration — that is what makes this correct on an
            // unevenly sampled track instead of only on a regular one.
            const u2 = u * u, u3 = u2 * u;
            const h00 = 2 * u3 - 3 * u2 + 1;
            const h10 = u3 - 2 * u2 + u;
            const h01 = -2 * u3 + 3 * u2;
            const h11 = u3 - u2;
            POS.lat = h00 * a.lat + h10 * dt * a.mLat + h01 * b.lat + h11 * dt * b.mLat;
            POS.lon = h00 * a.lon + h10 * dt * a.mLon + h01 * b.lon + h11 * dt * b.mLon;
        } else {
            POS.lat = a.lat + (b.lat - a.lat) * u;
            POS.lon = a.lon + (b.lon - a.lon) * u;
        }

        POS.alt = a.alt + (b.alt - a.alt) * u;
        POS.gs = a.gs + (b.gs - a.gs) * u;

        // Heading is an angle, so it has to be interpolated the short way round
        // — lerping 350° to 10° through 180° spins every aircraft on the map
        // through a full turn as it crosses north.
        let delta = b.hdg - a.hdg;
        if (delta > 180) delta -= 360; else if (delta < -180) delta += 360;
        POS.hdg = (a.hdg + delta * u + 360) % 360;

        // A recorded heading of exactly 0 is usually a missing value rather
        // than due north, and an aircraft frozen pointing north while tracking
        // west is more obviously wrong than a slightly noisy heading. Fall back
        // to the direction it is actually moving.
        if (a.hdg === 0 && b.hdg === 0) {
            const dLon = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
            const dLat = b.lat - a.lat;
            if (dLon || dLat) POS.hdg = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
        }

        // Fade in off the start of the track and out into the end, so aircraft
        // arrive and leave rather than blinking.
        const inFade = Math.min(absT - first.t, last.t - absT);
        POS.opacity = inFade >= FADE_MS ? 1 : Math.max(0.05, inFade / FADE_MS);
        POS.t = absT;
        return POS;
    }

    function firstIndexAtOrAfter(points, t) {
        let lo = 0, hi = points.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (points[mid].t < t) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    /* =========================
     * Map layers
     * ========================= */

    function hideLiveTraffic() {
        if (!map) return;
        if (!prevTrafficFilters) {
            prevTrafficFilters = {};
            TRAFFIC_LAYER_IDS.forEach(id => {
                if (!map.getLayer || !map.getLayer(id)) return;
                try { prevTrafficFilters[id] = map.getFilter(id) || null; } catch (_) { prevTrafficFilters[id] = null; }
            });
        }
        TRAFFIC_LAYER_IDS.forEach(id => {
            if (!map.getLayer || !map.getLayer(id)) return;
            try { map.setFilter(id, HIDE_ALL_FILTER); } catch (_) {}
        });
    }
    function restoreLiveTraffic() {
        if (!map || !prevTrafficFilters) return;
        TRAFFIC_LAYER_IDS.forEach(id => {
            if (!map.getLayer || !map.getLayer(id)) return;
            try { map.setFilter(id, prevTrafficFilters[id] || null); } catch (_) {}
        });
        prevTrafficFilters = null;
    }

    const EMPTY_FC = { type: 'FeatureCollection', features: [] };

    function ensureLayers() {
        if (!map) return;

        if (!map.getSource(SRC_TRAILS)) {
            map.addSource(SRC_TRAILS, { type: 'geojson', data: EMPTY_FC, tolerance: 0.5 });
        }
        if (!map.getLayer(LYR_TRAILS)) {
            map.addLayer({
                id: LYR_TRAILS, type: 'line', source: SRC_TRAILS,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': ['get', 'color'],
                    // Thin and faint zoomed out, where thousands of tails would
                    // otherwise mat together into a solid wash; heavier close
                    // in, where each one is a track you are actually reading.
                    'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1, 6, 1.8, 10, 2.6],
                    'line-opacity': ['*', ['/', ['coalesce', ['get', 'opacity'], 100], 100],
                        ['interpolate', ['linear'], ['zoom'], 2, 0.35, 6, 0.55, 10, 0.7]]
                }
            });
        }

        if (!map.getSource(SRC_PLANES)) {
            map.addSource(SRC_PLANES, { type: 'geojson', data: EMPTY_FC });
        }
        if (!map.getLayer(LYR_PLANES)) {
            const baseSize = (window.mapFilters?.planeIconSize || 0.16);
            map.addLayer({
                id: LYR_PLANES, type: 'symbol', source: SRC_PLANES,
                layout: {
                    'icon-image': ['concat', 'icon-', ['coalesce', ['get', 'category'], 'B737']],
                    'icon-rotate': ['get', 'heading'],
                    'icon-rotation-alignment': 'map',
                    // Overlap allowed and placement ignored on purpose: this
                    // skips symbol collision detection, which is the expensive
                    // half of a symbol layout and would otherwise be re-run for
                    // every tile on every push.
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                    'icon-size': ['case', ['boolean', ['get', 'selected'], false], baseSize * 1.5, baseSize]
                },
                paint: {
                    'icon-color': ['coalesce', ['get', 'color'], '#ffffff'],
                    // Carries the entry/exit fade, so aircraft arrive and leave
                    // instead of blinking into existence mid-window. Stored as
                    // 0–100 so the property stays a small integer; see
                    // buildPlanes() for why that matters.
                    'icon-opacity': ['/', ['coalesce', ['get', 'opacity'], 100], 100]
                }
            });
        }
        if (!map.getLayer(LYR_PLANE_LABELS)) {
            map.addLayer({
                id: LYR_PLANE_LABELS, type: 'symbol', source: SRC_PLANES,
                layout: {
                    'text-field': ['get', 'callsign'],
                    // Free glyph servers don't host the Mapbox font stacks;
                    // flight.js swaps in Noto Sans through window.mapTextFont.
                    'text-font': window.mapTextFont
                        ? window.mapTextFont(['Inter Regular', 'Arial Unicode MS Regular'])
                        : ['Inter Regular', 'Arial Unicode MS Regular'],
                    'text-size': 10,
                    'text-offset': [0, 1.4],
                    'text-anchor': 'top',
                    'text-allow-overlap': false,
                    'text-optional': true
                },
                paint: {
                    'text-color': '#ffffff',
                    'text-halo-color': 'rgba(0,0,0,0.8)',
                    'text-halo-width': 1.4,
                    'text-opacity': ['/', ['coalesce', ['get', 'opacity'], 100], 100]
                },
                // Callsigns for a whole server at world zoom would be an
                // unreadable mat of text — and, worse, the collision detection
                // behind placing them is the single most expensive thing a push
                // can ask for. Below this zoom the layer is out of range and
                // costs nothing at all, which is what keeps the wide view fast.
                minzoom: 5
            });
        }
    }

    /* =========================
     * Map interaction
     * ========================= */

    function bindMapInteractions() {
        unbindMapInteractions();
        if (!map) return;

        // Stand down while the camera moves — see deferForCamera().
        onMoveStart = () => { cameraMoving = true; };
        onMoveEnd = () => {
            cameraMoving = false;
            cameraDeferredSince = 0;
            // Repaint at once rather than waiting for the rate limiter, so the
            // world is correct the instant the camera settles.
            renderFrame(true);
        };
        map.on('movestart', onMoveStart);
        map.on('moveend', onMoveEnd);

        // A backgrounded tab still holds every buffer this is pushing, and
        // browsers throttle rAF unevenly rather than stopping it. Pausing on
        // hide means a replay left playing behind another app stops consuming
        // anything at all, instead of grinding on unwatched.
        onVisibilityChange = () => {
            if (document.hidden) {
                if (isPlaying) { wasPlayingWhenHidden = true; pause(); }
            } else if (wasPlayingWhenHidden) {
                wasPlayingWhenHidden = false;
                play();
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        onPlaneClick = (e) => {
            const feature = e.features && e.features[0];
            if (!feature) return;
            const id = feature.properties.flightId;
            selectedFlightId = (selectedFlightId === id) ? null : id;
            renderFrame(true);
        };
        map.on('click', LYR_PLANES, onPlaneClick);

        // Hover detail on pointer devices only. On touch there is no hover, and
        // a tooltip that appears under the finger that summoned it is worse
        // than none — tapping selects instead.
        const hasPointer = typeof window.matchMedia === 'function'
            ? window.matchMedia('(hover: hover)').matches
            : true;

        onPlaneEnter = (e) => {
            if (map.getCanvas) map.getCanvas().style.cursor = 'pointer';
            if (!hasPointer) return;
            const feature = e.features && e.features[0];
            if (!feature) return;
            const gl = window.mapboxgl;
            if (!gl) return;

            // Detail comes from the flight record and the clock, not from the
            // feature — see buildPlanes() for why the feature carries as
            // little as it does.
            const f = flightsById.get(feature.properties.flightId);
            if (!f) return;
            const pos = positionAt(f, spanStart + currentMs);

            if (!hoverPopup) {
                hoverPopup = new gl.Popup({ closeButton: false, closeOnClick: false, className: 'gpb-popup', offset: 12 });
            }
            hoverPopup
                .setLngLat(feature.geometry.coordinates)
                .setHTML(`
                    <div class="gpb-pop-call">${escapeHtml(f.callsign || '----')}</div>
                    ${f.username ? `<div class="gpb-pop-user">${escapeHtml(f.username)}</div>` : ''}
                    ${f.aircraftName ? `<div class="gpb-pop-type">${escapeHtml(f.aircraftName)}</div>` : ''}
                    <div class="gpb-pop-nums">
                        <span>${Math.round(pos ? pos.alt : 0).toLocaleString()} ft</span>
                        <span>${Math.round(pos ? pos.gs : 0)} kt</span>
                    </div>`)
                .addTo(map);
        };
        onPlaneLeave = () => {
            if (map.getCanvas) map.getCanvas().style.cursor = '';
            if (hoverPopup) { try { hoverPopup.remove(); } catch (_) {} }
        };
        map.on('mouseenter', LYR_PLANES, onPlaneEnter);
        map.on('mouseleave', LYR_PLANES, onPlaneLeave);
    }

    function unbindMapInteractions() {
        // This one is on `document`, not the map, so it has to come off even
        // when the map is already gone — otherwise a torn-down session keeps a
        // listener that closes over it.
        if (onVisibilityChange) {
            try { document.removeEventListener('visibilitychange', onVisibilityChange); } catch (_) {}
            onVisibilityChange = null;
        }
        wasPlayingWhenHidden = false;

        if (!map) return;
        if (onMoveStart) { try { map.off('movestart', onMoveStart); } catch (_) {} onMoveStart = null; }
        if (onMoveEnd) { try { map.off('moveend', onMoveEnd); } catch (_) {} onMoveEnd = null; }
        if (onPlaneClick) { try { map.off('click', LYR_PLANES, onPlaneClick); } catch (_) {} onPlaneClick = null; }
        if (onPlaneEnter) { try { map.off('mouseenter', LYR_PLANES, onPlaneEnter); } catch (_) {} onPlaneEnter = null; }
        if (onPlaneLeave) { try { map.off('mouseleave', LYR_PLANES, onPlaneLeave); } catch (_) {} onPlaneLeave = null; }
        if (hoverPopup) { try { hoverPopup.remove(); } catch (_) {} hoverPopup = null; }
        try { if (map.getCanvas) map.getCanvas().style.cursor = ''; } catch (_) {}
    }

    function removeLayers() {
        if (!map) return;
        [LYR_PLANE_LABELS, LYR_PLANES, LYR_TRAILS].forEach(id => {
            if (map.getLayer && map.getLayer(id)) { try { map.removeLayer(id); } catch (_) {} }
        });
        [SRC_PLANES, SRC_TRAILS].forEach(id => {
            if (map.getSource && map.getSource(id)) { try { map.removeSource(id); } catch (_) {} }
        });
    }

    /* =========================
     * Frames
     * ========================= */

    // The viewport, grown by CULL_MARGIN_FRACTION. Anything outside it is not
    // drawn: at a city-level zoom that is all but a handful of aircraft, which
    // is what makes a push there cheap enough to run every single frame.
    //
    // Bounds are read in the same unwrapped longitude space the tracks live in,
    // so an aircraft at lon 190 (one that crossed the dateline eastbound) is
    // still tested against a viewport sitting at -170.
    const cull = { minLat: -90, maxLat: 90, minLon: -180, maxLon: 180, wrapped: false };

    function refreshCullBounds() {
        try {
            const b = map.getBounds();
            const padLat = (b.getNorth() - b.getSouth()) * CULL_MARGIN_FRACTION;
            const west = b.getWest(), east = b.getEast();
            const padLon = Math.abs(east - west) * CULL_MARGIN_FRACTION;

            cull.minLat = b.getSouth() - padLat;
            cull.maxLat = b.getNorth() + padLat;
            cull.minLon = west - padLon;
            cull.maxLon = east + padLon;
            // Past ~340° of longitude on screen there is nothing left to cull,
            // and the wrap arithmetic below only adds cost.
            cull.wrapped = (cull.maxLon - cull.minLon) >= 340;
        } catch (_) {
            cull.minLat = -90; cull.maxLat = 90;
            cull.minLon = -180; cull.maxLon = 180;
            cull.wrapped = true;
        }
    }

    // Bounds are passed in rather than read off the module's `cull` so these
    // stay pure functions — the wrap arithmetic below is the kind of thing that
    // is wrong in one direction only, silently, and pure means testable.

    // Bring a (possibly unwrapped) longitude into the viewport's branch, so a
    // track carried past ±180 by normalizePath still compares correctly.
    function toViewBranch(lon, b) {
        let l = lon;
        while (l - b.minLon > 360) l -= 360;
        while (l - b.minLon < 0) l += 360;
        return l;
    }

    function inView(lat, lon, b = cull) {
        if (lat < b.minLat || lat > b.maxLat) return false;
        if (b.wrapped) return true;
        return toViewBranch(lon, b) <= b.maxLon;
    }

    // Could this flight's track put it on screen at all? A cheap whole-track
    // rejection, so an aircraft on the far side of the world never costs a
    // spline evaluation. Conservative by construction: it can only say "maybe".
    function trackMayBeInView(f, b = cull) {
        if (f.maxLat < b.minLat || f.minLat > b.maxLat) return false;
        if (b.wrapped) return true;

        // In the viewport's branch the track occupies [west, west + span], with
        // west somewhere in [minLon, minLon + 360). It is on screen if it
        // starts inside the viewport — or if it starts east of it and runs far
        // enough to come back around and re-enter from the west, which a long
        // eastbound track genuinely does.
        const west = toViewBranch(f.minLon, b);
        const span = f.maxLon - f.minLon;
        return west <= b.maxLon || (west + span) >= b.minLon + 360;
    }

    /* =========================
     * Selection — bounding the work by pixels, not by traffic
     * =========================
     * The first cut bounded cost by lowering the frame rate when a window got
     * busy. That is exactly the wrong lever: a slower frame rate is *visible*,
     * and it is visible as the stepping this whole module exists to avoid.
     *
     * What is not visible is drawing fewer aircraft when they are stacked on
     * the same pixel. At world zoom on a phone, two thousand aircraft compete
     * for a few hundred distinguishable positions — most of them are literally
     * behind one another. So the drawn set is thinned in screen space: at most
     * one aircraft per cell of roughly an icon's size. The number pushed to
     * Mapbox is then governed by the size of the screen rather than by how busy
     * the server happened to be, which is what makes the cost flat across
     * zooms, devices and windows.
     *
     * Everything below writes into preallocated scratch. Nothing in the steady
     * state allocates — see the note above renderFrame() for why that stopped
     * being a nicety and became the difference between running and crashing.
     */

    // Thinning is a safety valve, not a policy — and getting that the wrong way
    // round is a trap worth naming, because the first attempt fell into it.
    //
    // At world zoom the *density* is the picture. A thousand overlapping
    // aircraft over the North Atlantic is what the map is for, and collapsing
    // them to one per icon-sized cell does not declutter it, it deletes it:
    // three thousand contacts become five hundred and a busy evening renders as
    // a quiet afternoon. That is a worse lie than a dropped frame.
    //
    // So thinning does not run at all until the drawn set would exceed what a
    // push can carry. Below that everything is drawn, at every zoom. Above it,
    // aircraft sharing a small screen cell — genuinely one blob, at that scale
    // — are collapsed until the set fits.
    const SOFT_CAP = 1500;
    const THIN_CELL_PX = 5;
    // The backstop, for a window busier than any grid can bound.
    const MAX_DRAWN = 2500;

    // Parallel scratch arrays — one slot per candidate aircraft. Grown when a
    // window needs more and never shrunk, so a long session settles at its
    // high-water mark and allocates nothing after that.
    let candCap = 0;
    let candFlight = [], candLat = null, candLon = null, candAlt = null,
        candGs = null, candHdg = null, candOpacity = null;
    // Which candidates the grid pass already took, stamped by generation so it
    // needs no clearing between pushes.
    let pickedGen = null;

    function ensureCandidateCapacity(n) {
        if (n <= candCap) return;
        const cap = Math.max(64, 1 << (32 - Math.clz32(Math.max(1, n - 1))));
        pickedGen = new Int32Array(cap);
        candFlight = new Array(cap);
        candLat = new Float64Array(cap);
        candLon = new Float64Array(cap);
        candAlt = new Float64Array(cap);
        candGs = new Float64Array(cap);
        candHdg = new Float64Array(cap);
        candOpacity = new Float32Array(cap);
        candCap = cap;
    }

    // The thinning grid, as an open-addressed hash table in typed arrays.
    //
    // A Map would read better, but `Map.clear()` throws away its backing table
    // and the next push allocates a new one — a few thousand entries thirty
    // times a second, which is the churn this whole pass exists to avoid. A
    // generation counter retires the previous push's entries in O(1) with no
    // allocation at all: a slot counts as occupied only if it was stamped this
    // generation.
    const CELL_SLOTS = 8192;                      // power of two, > 2 × MAX_DRAWN
    const CELL_MASK = CELL_SLOTS - 1;
    const cellKey = new Int32Array(CELL_SLOTS);   // the cell hash living in this slot
    const cellPos = new Int32Array(CELL_SLOTS);   // where its winner sits in `chosen`
    const cellGen = new Int32Array(CELL_SLOTS);   // which push last claimed the slot
    let thinGeneration = 0;

    // Winning candidate indices. A typed array sized to the hard cap with a
    // separate count, rather than a plain array truncated with `length = 0`:
    // shrinking a JS array trims its backing store, and pushing it back up to
    // a few hundred entries reallocates it — several kilobytes of quiet churn
    // per push, thirty times a second, for a list whose size barely changes.
    const chosen = new Int32Array(MAX_DRAWN);
    let chosenCount = 0;

    // Grid size in degrees, derived from how much world is on screen and how
    // many pixels that is being drawn into. Approximate — it ignores Mercator
    // stretch and bearing — which is entirely good enough for "are these two
    // aircraft on the same pixel?".
    let cellDegLat = 0, cellDegLon = 0;
    let invCellLat = 1, invCellLon = 1;
    // How many aircraft were visible before any thinning — the number the HUD
    // compares the drawn count against.
    let candidateCount = 0;

    function refreshThinGrid() {
        let w = 1024, h = 768;
        try {
            const canvas = map.getCanvas();
            if (canvas) { w = canvas.clientWidth || canvas.width || w; h = canvas.clientHeight || canvas.height || h; }
        } catch (_) { /* defaults */ }
        cellDegLon = ((cull.maxLon - cull.minLon) / Math.max(1, w)) * THIN_CELL_PX;
        cellDegLat = ((cull.maxLat - cull.minLat) / Math.max(1, h)) * THIN_CELL_PX;
    }

    // Stable tie-break inside a cell. Without one, whichever aircraft happened
    // to be visited first wins, that changes as tracks are reordered by the
    // clock, and the drawn aircraft flickers between neighbours. Hashing the
    // flight id makes the winner the same one every frame for as long as they
    // share a cell.
    function flightHash(f) {
        if (f.hash !== undefined) return f.hash;
        let h = 2166136261;
        const s = f.flightId || '';
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        f.hash = h >>> 0;
        return f.hash;
    }

    /**
     * Evaluate every flight at absT and choose what to draw.
     *
     * Writes into the scratch arrays above and fills `chosen` with the indices
     * that survived. Returns the airborne total, which is a different number
     * from the drawn total and worth reporting separately — "1,847 airborne,
     * 620 in view" is information, not an apology.
     *
     * @param {Array} flightList  every flight in the window
     * @param {number} absT       the clock, in epoch ms
     * @param {object} bounds     padded viewport, in unwrapped-longitude space
     * @param {boolean} thin      apply screen-space thinning
     */
    function selectVisible(flightList, absT, bounds, thin) {
        ensureCandidateCapacity(flightList.length);
        // Reciprocals, hoisted: a multiply per aircraft rather than a divide,
        // and it keeps the guard against a zero-sized grid out of the loop.
        invCellLat = 1 / (cellDegLat || 1);
        invCellLon = 1 / (cellDegLon || 1);
        chosenCount = 0;
        // Retires every slot from the previous push without touching them.
        thinGeneration++;

        let airborne = 0;
        let n = 0;

        for (let k = 0; k < flightList.length; k++) {
            const f = flightList[k];

            // Three rejections, cheapest first. Only what survives all of them
            // is worth interpolating.
            if (absT < f.t0 || absT > f.t1) continue;
            if (!trackMayBeInView(f, bounds)) { airborne++; continue; }

            const pos = positionAt(f, absT);
            // null here means absT landed in a hole in the recording, so the
            // aircraft was not being tracked and is not airborne as far as this
            // replay can honestly say.
            if (!pos) continue;
            airborne++;

            if (!inView(pos.lat, pos.lon, bounds)) continue;

            const i = n++;
            candFlight[i] = f;
            candLat[i] = pos.lat;
            candLon[i] = pos.lon;
            candAlt[i] = pos.alt;
            candGs[i] = pos.gs;
            candHdg[i] = pos.hdg;
            candOpacity[i] = pos.opacity;
        }

        candidateCount = n;

        // The common case, and the one worth protecting: everything visible is
        // drawn, exactly as recorded, at whatever zoom.
        if (!thin || n <= SOFT_CAP) {
            const take = n < MAX_DRAWN ? n : MAX_DRAWN;
            for (let i = 0; i < take; i++) chosen[i] = i;
            chosenCount = take;
            return airborne;
        }

        thinToFit(n);
        return airborne;
    }

    /**
     * Collapse candidates that share a screen cell until the set fits.
     *
     * Only reached when the visible traffic exceeds what a push can carry, so
     * by construction the aircraft being dropped are ones stacked within a few
     * pixels of a survivor.
     */
    function thinToFit(n) {
        for (let i = 0; i < n; i++) {
            if (chosenCount >= SOFT_CAP) break;
            // Hash the cell, then linear-probe. Winners are written straight
            // into `chosen`, so there is no collection pass afterwards and no
            // iterator to allocate.
            //
            // Math.imul, not `*`. The obvious multiply overflows the
            // small-integer range — a cell index of a few hundred times a
            // large prime is ~10^11 — and V8 boxes the result on the heap.
            // One box per aircraft per axis per push was, by measurement,
            // *all* of this pass's remaining allocation. imul returns an
            // int32 and allocates nothing.
            const key = (Math.imul(Math.floor(candLat[i] * invCellLat), 73856093)
                       ^ Math.imul(Math.floor(candLon[i] * invCellLon), 19349663)) | 0;
            let slot = (key ^ (key >>> 15)) & CELL_MASK;

            for (let probe = 0; probe < CELL_SLOTS; probe++) {
                if (cellGen[slot] !== thinGeneration) {
                    // Free slot — this aircraft owns the cell.
                    cellGen[slot] = thinGeneration;
                    cellKey[slot] = key;
                    cellPos[slot] = chosenCount;
                    pickedGen[i] = thinGeneration;
                    chosen[chosenCount++] = i;
                    break;
                }
                if (cellKey[slot] === key) {
                    // Taken. Lowest hash wins, so the same aircraft holds the
                    // cell frame after frame and the map does not sparkle.
                    const at = cellPos[slot];
                    if (flightHash(candFlight[i]) < flightHash(candFlight[chosen[at]])) {
                        pickedGen[chosen[at]] = 0;
                        pickedGen[i] = thinGeneration;
                        chosen[at] = i;
                    }
                    break;
                }
                slot = (slot + 1) & CELL_MASK;
            }
        }

        // The grid is sized in pixels, so it thins by however much the traffic
        // happens to overlap — which is usually far more than needed. Dropping
        // three thousand aircraft to five hundred when fifteen hundred would
        // have fitted is the density loss all over again, just less of it.
        //
        // So put back whatever there is room for. The result is the most
        // aircraft a push can carry, with the ones that were hidden behind a
        // neighbour the first to be left out.
        for (let i = 0; i < n && chosenCount < SOFT_CAP; i++) {
            if (pickedGen[i] === thinGeneration) continue;
            chosen[chosenCount++] = i;
        }
    }

    /* =========================
     * Feature pools
     * ========================= */

    // One Feature per drawn slot, reused for whichever aircraft occupies that
    // slot this frame. Slots are not stable across frames — an aircraft can
    // move between them — which is fine because nothing downstream tracks a
    // feature's identity between pushes.
    function planeSlot(i) {
        let feat = planePool[i];
        if (!feat) {
            feat = planePool[i] = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 0] },
                // Only what the map draws. Everything the hover card wants —
                // pilot, type, altitude, speed — is resolved from the flight
                // record at hover time instead of riding along on every
                // feature: these properties are structure-cloned to the worker
                // on every single push, and at a couple of thousand aircraft
                // thirty times a second the strings nobody is looking at cost
                // more than the geometry does.
                properties: {
                    flightId: '', callsign: '',
                    category: 'B737', heading: 0, color: '#fff',
                    opacity: 100, selected: false
                }
            };
        }
        return feat;
    }

    function trailSlot(i) {
        let feat = trailPool[i];
        if (!feat) {
            feat = trailPool[i] = {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [] },
                properties: { color: '#fff', opacity: 100 }
            };
        }
        return feat;
    }

    // Write a [lon, lat] pair into a coordinates array, reusing the pair that
    // is already there. `coords` is a persistent array on a pooled feature, so
    // in the steady state this touches numbers only.
    function setCoord(coords, i, lon, lat) {
        const pair = coords[i];
        if (pair) { pair[0] = lon; pair[1] = lat; }
        else coords[i] = [lon, lat];
    }

    function buildPlanes() {
        // Written by index and truncated once at the end. Clearing first and
        // pushing back up reallocates the backing store every push; assigning
        // into the existing one and setting the final length does not, because
        // the count barely moves from frame to frame.
        for (let s = 0; s < chosenCount; s++) {
            const i = chosen[s];
            const f = candFlight[i];
            const feat = planeSlot(s);

            feat.geometry.coordinates[0] = candLon[i];
            feat.geometry.coordinates[1] = candLat[i];

            const p = feat.properties;
            p.flightId = f.flightId;
            p.callsign = f.callsign;
            p.category = f.category;
            // Every numeric property is stored as a whole number on purpose.
            // A fractional value written into an object field is a boxed heap
            // number, and one box per aircraft per property, thirty times a
            // second, is most of what this pass still allocates. Integers are
            // small-integer values and cost nothing.
            //
            // Nothing is lost: a degree of rotation is finer than the icon can
            // show, and opacity is carried as 0–100 and divided back down in
            // the paint expression.
            p.heading = Math.round(candHdg[i]);
            p.color = getAltColor(candAlt[i]);
            p.opacity = Math.round(candOpacity[i] * 100);
            p.selected = (f.flightId === selectedFlightId);

            planeList[s] = feat;
        }
        planeList.length = chosenCount;
    }

    // Comet tails for the drawn aircraft, decimated to TRAIL_POINTS vertices.
    //
    // The first cut walked every recorded point inside the trail window, which
    // at world scale meant tens of thousands of freshly allocated coordinate
    // pairs several times a second. A tail is a visual cue about where
    // something came from; a dozen points draw that just as well as sixty, and
    // the geometry is now written into arrays that already exist.
    function buildTrails(absT) {
        if (!showTrails) { trailList.length = 0; return; }

        const from = absT - TRAIL_WINDOW_MS;
        let drawn = 0;

        for (let s = 0; s < chosenCount && s < MAX_TRAIL_FEATURES; s++) {
            const i = chosen[s];
            const f = candFlight[i];
            const pts = f.points;

            const startIdx = firstIndexAtOrAfter(pts, from);
            // How many recorded points fall inside the tail window.
            let available = 0;
            for (let j = startIdx; j < pts.length && pts[j].t <= absT; j++) available++;
            if (available < 1) continue;

            const feat = trailSlot(s);
            const coords = feat.geometry.coordinates;
            const take = Math.min(available, TRAIL_POINTS - 1);
            const stride = available / take;

            let w = 0;
            for (let k = 0; k < take; k++) {
                const p = pts[startIdx + Math.floor(k * stride)];
                setCoord(coords, w++, p.lon, p.lat);
            }
            // The head is the interpolated position, so the tail stays attached
            // to the aircraft between recorded points instead of lagging to the
            // last one.
            setCoord(coords, w++, candLon[i], candLat[i]);
            coords.length = w;
            if (w < 2) continue;

            feat.properties.color = getAltColor(candAlt[i]);
            feat.properties.opacity = Math.round(candOpacity[i] * 100);
            trailList[drawn++] = feat;
        }
        trailList.length = drawn;
    }

    // Should a push be held back right now? A camera gesture is competing for
    // the same tiles, but only for so long — a replay frozen mid-pan reads as a
    // crash, not as courtesy.
    function deferForCamera(now) {
        if (!cameraMoving) { cameraDeferredSince = 0; return false; }
        if (!cameraDeferredSince) { cameraDeferredSince = now; return true; }
        return (now - cameraDeferredSince) < MAX_CAMERA_DEFER_MS;
    }

    /**
     * Draw the world at the current clock.
     *
     * Two rules govern what happens here, both learned the hard way.
     *
     * The frame rate is not the adjustable one. Dropping to nine pushes a
     * second to save work produces visible stepping, which is the fault this
     * module exists to fix — so the target interval is fixed and it is the
     * amount of *detail* that gives way under load, via the screen-space
     * thinning above. Fewer aircraft where they overlap is invisible; a lower
     * frame rate is not.
     *
     * And nothing here may allocate in the steady state. Rebuilding a few
     * thousand features and tens of thousands of coordinate pairs several times
     * a second is tens of megabytes per second of garbage, which on a phone is
     * not slow — it is a crash after a few minutes of playing. Every object
     * below is pooled and rewritten.
     *
     * `force` bypasses the rate limiter for the frames a user is waiting on —
     * a scrub, a toggle, the first frame — where latency is felt directly
     * rather than averaged away.
     */
    function renderFrame(force = false) {
        if (!map || !map.getSource(SRC_PLANES)) return;
        const absT = spanStart + currentMs;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

        if (!force) {
            if (deferForCamera(now)) return;
            if (now - lastPlanePush < pushIntervalMs) return;
        }

        const began = now;
        refreshCullBounds();
        refreshThinGrid();

        // Thinning only earns its keep once there is something to thin. Below
        // the threshold every aircraft is drawn, which is the zoomed-in case
        // and the one where individual smoothness is actually being watched.
        // `true` here means "thin if you must", not "thin" — selectVisible
        // only engages the grid once the visible set exceeds what a push can
        // carry, so an ordinary window is drawn whole.
        airborneCount = selectVisible(flights, absT, cull, true);
        drawnCount = chosenCount;

        buildPlanes();
        try {
            map.getSource(SRC_PLANES).setData(planeCollection);
        } catch (_) {
            return;   // style swapped underneath us; the next frame retries
        }

        if (force || began - lastTrailPush >= TRAIL_PUSH_INTERVAL_MS) {
            lastTrailPush = began;
            try {
                const trailSrc = map.getSource(SRC_TRAILS);
                if (trailSrc) { buildTrails(absT); trailSrc.setData(trailCollection); }
            } catch (_) { /* same */ }
        }

        lastPlanePush = began;

        // Measured across both pushes, since they land on the same main thread.
        const cost = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - began;
        frameCostEMA = frameCostEMA * 0.85 + cost * 0.15;
        adaptPushInterval();

        updateHUD(absT);
    }

    /**
     * Hold the push rate at the target, and only give it up when the device
     * plainly cannot sustain it.
     *
     * The thinning already caps how much work a frame can be asked to do, so
     * this is the second line rather than the first: it exists for the case
     * where even the capped set is too much — an old phone, a busy tab — and
     * the honest answer is a lower rate rather than a stalled one.
     */
    function adaptPushInterval() {
        const affordable = frameCostEMA / PUSH_DUTY_CYCLE;
        const want = Math.max(TARGET_PUSH_INTERVAL_MS, Math.min(MAX_PUSH_INTERVAL_MS, affordable));
        // Ease toward the new interval so one expensive frame — a style change,
        // a GC pause — doesn't visibly change the cadence on its own.
        pushIntervalMs = pushIntervalMs * 0.8 + want * 0.2;
    }


    function tick(now) {
        rafId = null;
        if (!isPlaying) return;

        // The clock advances against real elapsed time regardless of whether
        // this frame pushes anything, so playback runs at the speed it claims
        // to on a slow device instead of quietly running in slow motion.
        const dt = lastFrameAt ? Math.min(now - lastFrameAt, 250) : 16;
        lastFrameAt = now;

        if (!isScrubbing) {
            currentMs += dt * speed;
            if (currentMs >= totalDurationMs) {
                currentMs = totalDurationMs;
                renderFrame(true);
                updateScrubber();
                pause();
                return;
            }
        }
        renderFrame();
        updateScrubber();
        rafId = requestAnimationFrame(tick);
    }

    function play() {
        if (isPlaying || !panelEl) return;
        if (currentMs >= totalDurationMs) currentMs = 0;
        isPlaying = true;
        lastFrameAt = 0;
        setPlayIcon();
        rafId = requestAnimationFrame(tick);
    }
    function pause() {
        isPlaying = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        setPlayIcon();
    }

    /* =========================
     * Picker — choosing the moment
     * ========================= */

    // The quick picks. Everything past 24 hours is Pro, and is shown rather
    // than hidden: a free pilot should be able to see that last Tuesday is
    // there, which is the whole argument for upgrading.
    function offsetChoices() {
        return [
            { ms: HOUR_MS, label: '1 hour ago' },
            { ms: 3 * HOUR_MS, label: '3 hours ago' },
            { ms: 6 * HOUR_MS, label: '6 hours ago' },
            { ms: 12 * HOUR_MS, label: '12 hours ago' },
            { ms: DAY_MS, label: 'Yesterday' },
            { ms: 2 * DAY_MS, label: '2 days ago' },
            { ms: 3 * DAY_MS, label: '3 days ago' },
            { ms: 7 * DAY_MS, label: 'A week ago' },
            { ms: 14 * DAY_MS, label: '2 weeks ago' }
        ];
    }

    function spanChoices() {
        const cap = limits?.maxSpanMs || 6 * HOUR_MS;
        return SPAN_CHOICES.filter(c => c.ms <= cap);
    }

    // The picker's own idea of what is reachable. It must agree with the
    // server's, so it is derived from the server's answer and never from a
    // constant duplicated here.
    function withinTier(offsetMs) {
        if (!limits) return true;
        return offsetMs <= limits.lookbackMs;
    }

    // A `datetime-local` input wants local wall-clock text, not an ISO instant.
    function toLocalInputValue(epochMs) {
        const d = new Date(epochMs);
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    function buildPicker() {
        destroyPicker();
        const tier = limits?.tier === 'pro' ? 'pro' : 'free';
        const earliest = limits?.earliest ?? (Date.now() - DAY_MS);
        const latest = limits?.latest ?? Date.now();
        const defaultStart = latest - HOUR_MS - spanMs;

        pickerEl = document.createElement('div');
        pickerEl.id = 'global-playback-picker';
        pickerEl.className = `gpb-picker gpb-tier-${tier}`;
        pickerEl.innerHTML = `
            <div class="gpb-picker-backdrop" data-gpb="dismiss"></div>
            <div class="gpb-picker-card" role="dialog" aria-label="Global playback">
                <button type="button" class="gpb-picker-close" data-gpb="dismiss" aria-label="Close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
                <div class="gpb-picker-head">
                    <span class="gpb-eyebrow">Global Playback</span>
                    <h2 class="gpb-title">Rewind the map</h2>
                    <p class="gpb-sub">
                        Watch every flight${serverName ? ` on the <b>${escapeHtml(serverName)}</b> server` : ''} exactly as it flew.
                    </p>
                    <div class="gpb-tier-badge">
                        ${tier === 'pro'
                            ? '<i class="fa-solid fa-crown"></i> Pro — reaching back 14 days'
                            : '<i class="fa-solid fa-clock-rotate-left"></i> Free — the last 24 hours'}
                    </div>
                </div>

                <div class="gpb-field">
                    <label class="gpb-label">Start from</label>
                    <div class="gpb-chips" data-gpb="offsets">
                        ${offsetChoices().map(c => {
                            const locked = !withinTier(c.ms);
                            return `<button type="button" class="gpb-chip${locked ? ' locked' : ''}"
                                        data-gpb="offset" data-ms="${c.ms}" ${locked ? 'data-locked="1"' : ''}>
                                        ${c.label}${locked ? ' <i class="fa-solid fa-crown"></i>' : ''}
                                    </button>`;
                        }).join('')}
                    </div>
                </div>

                <div class="gpb-field">
                    <label class="gpb-label" for="gpb-exact">Or an exact moment</label>
                    <input type="datetime-local" id="gpb-exact" class="gpb-input"
                           min="${toLocalInputValue(earliest)}"
                           max="${toLocalInputValue(latest)}"
                           value="${toLocalInputValue(defaultStart)}">
                    <div class="gpb-hint" id="gpb-exact-hint">${fmtZuluDate(defaultStart)}</div>
                </div>

                <div class="gpb-field">
                    <label class="gpb-label">Watch for</label>
                    <div class="gpb-chips" data-gpb="spans">
                        ${spanChoices().map(c => `
                            <button type="button" class="gpb-chip${c.ms === spanMs ? ' active' : ''}"
                                    data-gpb="span" data-ms="${c.ms}">${c.label}</button>
                        `).join('')}
                    </div>
                </div>

                ${tier === 'free' ? `
                    <button type="button" class="gpb-upsell" data-gpb="upgrade">
                        <i class="fa-solid fa-crown"></i>
                        <span>
                            <b>Go back two weeks with Inflight Pro</b>
                            Free playback covers the last 24 hours.
                        </span>
                        <i class="fa-solid fa-chevron-right"></i>
                    </button>` : ''}

                <button type="button" class="gpb-go" data-gpb="go">
                    <i class="fa-solid fa-play"></i> Start playback
                </button>
            </div>`;

        document.body.appendChild(pickerEl);
        bindPickerEvents();
    }

    function bindPickerEvents() {
        if (!pickerEl) return;
        const exact = pickerEl.querySelector('#gpb-exact');
        const hint = pickerEl.querySelector('#gpb-exact-hint');

        const syncHint = () => {
            if (!exact || !hint) return;
            const ms = Date.parse(exact.value);
            hint.textContent = Number.isFinite(ms) ? fmtZuluDate(ms) : '—';
        };
        if (exact) exact.addEventListener('change', syncHint);
        if (exact) exact.addEventListener('input', syncHint);

        pickerEl.addEventListener('click', (e) => {
            const target = e.target.closest('[data-gpb]');
            if (!target) return;
            const action = target.dataset.gpb;

            if (action === 'dismiss') { close(); return; }
            if (action === 'upgrade') { promptUpgrade('global-playback-picker'); return; }

            if (action === 'span') {
                spanMs = Number(target.dataset.ms) || DEFAULT_SPAN_MS;
                try { localStorage.setItem(SPAN_STORAGE_KEY, String(spanMs)); } catch (_) {}
                pickerEl.querySelectorAll('[data-gpb="span"]').forEach(el => el.classList.remove('active'));
                target.classList.add('active');
                return;
            }

            if (action === 'offset') {
                if (target.dataset.locked) { promptUpgrade('global-playback-locked-offset'); return; }
                const offset = Number(target.dataset.ms);
                if (!Number.isFinite(offset)) return;
                // A quick pick names when to *start* watching, so the window
                // runs forward from there — "3 hours ago" means the hour that
                // began three hours ago, not the hour that ended then.
                start(Date.now() - offset);
                return;
            }

            if (action === 'go') {
                const ms = exact ? Date.parse(exact.value) : NaN;
                if (!Number.isFinite(ms)) { showToast('Pick a moment to start from.', 'error'); return; }
                const offset = Date.now() - ms;
                if (offset < 0) { showToast('That moment has not happened yet.', 'error'); return; }
                if (!withinTier(offset)) { promptUpgrade('global-playback-exact'); return; }
                start(ms);
            }
        });
    }

    function destroyPicker() {
        if (!pickerEl) return;
        try { pickerEl.remove(); } catch (_) {}
        pickerEl = null;
    }

    /* =========================
     * Transport panel
     * ========================= */

    function buildPanel() {
        destroyPanel();
        panelEl = document.createElement('div');
        panelEl.id = 'global-playback-panel';
        panelEl.className = 'gpb-panel';
        panelEl.innerHTML = `
            <div class="gpb-panel-top">
                <div class="gpb-clock">
                    <span class="gpb-zulu" id="gpb-zulu">--:--Z</span>
                    <span class="gpb-date" id="gpb-date">—</span>
                </div>
                <div class="gpb-stats">
                    <span class="gpb-stat-airborne"><span id="gpb-airborne">0</span> airborne<span class="gpb-shown" id="gpb-shown"></span></span>
                    <span class="gpb-stat-total"><span class="gpb-dot">•</span><span id="gpb-total">0</span> flights in window</span>
                    <div class="gpb-legend" aria-hidden="true">
                        <span class="gpb-legend-label">GND</span>
                        <span class="gpb-legend-ramp"></span>
                        <span class="gpb-legend-label">FL400</span>
                    </div>
                </div>
                <div class="gpb-actions">
                    <button type="button" class="gpb-btn gpb-trails${showTrails ? ' active' : ''}" data-gpb="trails" title="Trails (T)">
                        <i class="fa-solid fa-wave-square"></i>
                    </button>
                    <button type="button" class="gpb-btn" data-gpb="rewindpicker" title="Pick another moment">
                        <i class="fa-solid fa-calendar-days"></i>
                    </button>
                    <button type="button" class="gpb-btn gpb-close" data-gpb="close" title="Close (Esc)">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>
            <div class="gpb-panel-scrub">
                <button type="button" class="gpb-btn gpb-play" data-gpb="play" title="Play / pause (Space)">
                    <i class="fa-solid fa-play"></i>
                </button>
                <span class="gpb-elapsed" id="gpb-elapsed">0:00</span>
                <input type="range" class="gpb-range" id="gpb-range" min="0" max="1000" value="0" step="1" aria-label="Playback position">
                <span class="gpb-elapsed" id="gpb-duration">0:00</span>
                <div class="gpb-speeds" id="gpb-speeds">
                    ${SPEED_OPTIONS.map(s => `<button type="button" class="gpb-speed${s === speed ? ' active' : ''}" data-gpb="speed" data-speed="${s}">${s}×</button>`).join('')}
                </div>
            </div>`;
        document.body.appendChild(panelEl);
        bindPanelEvents();
        updateScrubber();
    }

    function bindPanelEvents() {
        if (!panelEl) return;
        const range = panelEl.querySelector('#gpb-range');

        panelEl.addEventListener('click', (e) => {
            const target = e.target.closest('[data-gpb]');
            if (!target) return;
            switch (target.dataset.gpb) {
                case 'close': close(); break;
                case 'play': isPlaying ? pause() : play(); break;
                case 'trails':
                    showTrails = !showTrails;
                    target.classList.toggle('active', showTrails);
                    try { localStorage.setItem(TRAILS_STORAGE_KEY, showTrails ? '1' : '0'); } catch (_) {}
                    renderFrame(true);
                    break;
                case 'rewindpicker':
                    // Back to the picker without tearing the map down twice —
                    // the layers go, the session stays open.
                    pause();
                    teardownPlayback();
                    buildPicker();
                    break;
                case 'speed': {
                    speed = Number(target.dataset.speed) || DEFAULT_SPEED;
                    try { localStorage.setItem(SPEED_STORAGE_KEY, String(speed)); } catch (_) {}
                    panelEl.querySelectorAll('[data-gpb="speed"]').forEach(el => el.classList.remove('active'));
                    target.classList.add('active');
                    break;
                }
            }
        });

        if (range) {
            // Named for what it does to the transport, not `seek` — that is a
            // module-level function on tracks, with a different signature.
            const applyScrub = () => {
                currentMs = (Number(range.value) / 1000) * totalDurationMs;
                // Forced: a scrub is a frame the user is watching for, and the
                // rate limiter exists for frames nobody is waiting on.
                renderFrame(true);
                updateScrubber();
            };
            range.addEventListener('input', () => { isScrubbing = true; applyScrub(); });
            range.addEventListener('change', () => { isScrubbing = false; applyScrub(); });
        }
    }

    function destroyPanel() {
        if (!panelEl) return;
        try { panelEl.remove(); } catch (_) {}
        panelEl = null;
    }

    function setPlayIcon() {
        const icon = panelEl?.querySelector('.gpb-play i');
        if (icon) icon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    }

    function updateScrubber() {
        if (!panelEl) return;
        const range = panelEl.querySelector('#gpb-range');
        if (range && !isScrubbing) {
            range.value = String(totalDurationMs ? Math.round((currentMs / totalDurationMs) * 1000) : 0);
        }
        const elapsed = panelEl.querySelector('#gpb-elapsed');
        if (elapsed) elapsed.textContent = fmtClock(currentMs);
        const duration = panelEl.querySelector('#gpb-duration');
        if (duration) duration.textContent = fmtClock(totalDurationMs);
    }

    function updateHUD(absT) {
        if (!panelEl) return;
        const zulu = panelEl.querySelector('#gpb-zulu');
        if (zulu) zulu.textContent = fmtZulu(absT);
        const date = panelEl.querySelector('#gpb-date');
        if (date) date.textContent = new Date(absT).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const air = panelEl.querySelector('#gpb-airborne');
        if (air) air.textContent = String(airborneCount);
        // "of which drawn" only says something once culling or the density cap
        // is actually holding some back. When everything airborne is on screen
        // the two numbers are the same and the second is noise.
        const shown = panelEl.querySelector('#gpb-shown');
        if (shown) {
            shown.textContent = (airborneCount > drawnCount) ? ` · ${drawnCount} drawn` : '';
        }
    }

    function bindKeys() {
        unbindKeys();
        onKeyDown = (e) => {
            if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
            if (e.key === 'Escape') { e.preventDefault(); close(); return; }
            if (!panelEl) return;
            if (e.code === 'Space') { e.preventDefault(); isPlaying ? pause() : play(); return; }
            if (e.key === 't' || e.key === 'T') {
                const btn = panelEl.querySelector('.gpb-trails');
                if (btn) btn.click();
                return;
            }
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const step = (e.shiftKey ? 15 : 5) * 60 * 1000;   // session minutes
                currentMs = Math.max(0, Math.min(totalDurationMs, currentMs + (e.key === 'ArrowRight' ? step : -step)));
                renderFrame(true);
                updateScrubber();
            }
        };
        window.addEventListener('keydown', onKeyDown);
    }
    function unbindKeys() {
        if (!onKeyDown) return;
        try { window.removeEventListener('keydown', onKeyDown); } catch (_) {}
        onKeyDown = null;
    }

    /* =========================
     * Loading chrome
     * ========================= */

    function showLoading(sub) {
        hideLoading();
        loadingEl = document.createElement('div');
        loadingEl.id = 'global-playback-loading';
        loadingEl.innerHTML = `
            <div class="gpb-spinner"></div>
            <div class="gpb-loading-text">
                <div class="gpb-loading-title">Rewinding the map…</div>
                <div class="gpb-loading-sub">${sub || 'Reassembling every flight in the window.'}</div>
            </div>`;
        document.body.appendChild(loadingEl);
    }
    function hideLoading() {
        if (!loadingEl) return;
        const el = loadingEl; loadingEl = null;
        el.classList.add('fade-out');
        setTimeout(() => { try { el.remove(); } catch (_) {} }, 220);
    }

    /* =========================
     * Session lifecycle
     * ========================= */

    // Start playing a window. Separated from open() so the panel's "pick
    // another moment" button can run it again without re-opening the session.
    async function start(startMs) {
        destroyPicker();
        showLoading(`${fmtAgo(Date.now() - startMs)} · ${fmtZuluDate(startMs)}`);

        let payload;
        try {
            payload = await loadWindow(startMs, spanMs);
        } catch (e) {
            hideLoading();
            if (e.name === 'AbortError') return;
            if (e.upgradeRequired) {
                // The picker's lock should have caught this; the server saying
                // so is the backstop, and it gets the same ending rather than a
                // bare error.
                if (e.limits) limits = { ...limits, ...e.limits };
                promptUpgrade('global-playback-server-refusal');
                buildPicker();
                return;
            }
            showToast(e.message || 'Could not load that playback window.', 'error');
            buildPicker();
            return;
        }

        windowMeta = payload.window || { start: startMs, end: startMs + spanMs };
        if (payload.limits) limits = { ...limits, ...payload.limits, tier: payload.tier || limits?.tier };

        flights = (payload.flights || []).map(f => ({
            flightId: f.flightId,
            callsign: f.callsign || '----',
            username: f.username || '',
            aircraftName: f.aircraft?.aircraftName || '',
            category: categoryFor(f.aircraft?.aircraftName),
            points: normalizePath(f.path, windowMeta.start),
            // Where this flight's last lookup landed. Playback advances
            // monotonically, so seeking from here is O(1) per frame instead of
            // a binary search across every track, every frame.
            cursor: 0
        })).filter(f => f.points.length >= 2).map(measureTrack);

        flightsById = new Map(flights.map(f => [f.flightId, f]));

        if (!flights.length) {
            hideLoading();
            showToast('Nothing was flying in that window — try another moment.', 'info');
            buildPicker();
            return;
        }

        spanStart = windowMeta.start;
        totalDurationMs = Math.max(1, windowMeta.end - windowMeta.start);
        currentMs = 0;

        buildPanel();
        hideLoading();

        const total = panelEl?.querySelector('#gpb-total');
        if (total) total.textContent = String(flights.length);

        if (payload.truncated) {
            showToast(`That window was busy — showing the first ${flights.length} flights.`, 'info');
        }

        const setup = () => {
            try {
                ensureLayers();
                bindMapInteractions();
                hideLiveTraffic();
                renderFrame(true);
                play();
            } catch (e) {
                console.warn('[GlobalPlayback] setup failed:', e);
                showToast('Could not start playback on this device.', 'error');
                close();
            }
        };
        if (map.isStyleLoaded && !map.isStyleLoaded()) map.once('idle', setup);
        else setup();
    }

    // Drop the playing state but keep the session (map, callbacks) alive.
    function teardownPlayback() {
        pause();
        unbindMapInteractions();
        removeLayers();
        restoreLiveTraffic();
        destroyPanel();

        flights = [];
        flightsById = new Map();
        // The pools themselves are kept: a session that opens a second window
        // reuses the features the first one warmed up, and the arrays inside
        // them, rather than starting the allocation over.
        planeList.length = 0;
        trailList.length = 0;
        chosenCount = 0;
        thinGeneration++;

        windowMeta = null;
        spanStart = 0;
        totalDurationMs = 0;
        currentMs = 0;
        isScrubbing = false;
        selectedFlightId = null;

        // Reset the rate limiter with the session. The next window may be a
        // quiet one on a fast device, and it should not inherit a slow window's
        // measured cost and open at a throttled rate for no reason.
        lastPlanePush = 0;
        lastTrailPush = 0;
        frameCostEMA = 3;
        pushIntervalMs = TARGET_PUSH_INTERVAL_MS;
        cameraMoving = false;
        cameraDeferredSince = 0;
        airborneCount = 0;
        drawnCount = 0;
    }

    function close() {
        if (abortLoad) { try { abortLoad.abort(); } catch (_) {} abortLoad = null; }
        hideLoading();
        unbindKeys();
        destroyPicker();
        teardownPlayback();

        if (onProStatusChanged) {
            try { window.removeEventListener('proStatusChanged', onProStatusChanged); } catch (_) {}
            onProStatusChanged = null;
        }

        map = null;
        limits = null;
        sessionId = null;
        serverName = '';

        const cb = onCloseCallback; onCloseCallback = null;
        if (typeof cb === 'function') {
            try { cb(); } catch (e) { console.warn('[GlobalPlayback] onClose threw:', e); }
        }
    }

    async function open(opts) {
        if (!opts || !opts.map) {
            showToast('Playback error: the map is not ready yet.', 'error');
            return false;
        }
        close();
        injectStyles();

        map = opts.map;
        apiBase = String(opts.apiBase || '').replace(/\/+$/, '');
        sessionId = opts.sessionId || null;
        serverName = opts.serverName || '';
        onCloseCallback = (typeof opts.onClose === 'function') ? opts.onClose : null;

        try {
            const saved = Number(localStorage.getItem(SPEED_STORAGE_KEY));
            if (SPEED_OPTIONS.includes(saved)) speed = saved;
            const savedSpan = Number(localStorage.getItem(SPAN_STORAGE_KEY));
            if (SPAN_CHOICES.some(c => c.ms === savedSpan)) spanMs = savedSpan;
            const savedTrails = localStorage.getItem(TRAILS_STORAGE_KEY);
            if (savedTrails !== null) showTrails = savedTrails === '1';
        } catch (_) { /* private mode */ }

        showLoading('Checking how far back you can go.');
        try {
            limits = await fetchLimits();
        } catch (e) {
            console.warn('[GlobalPlayback] limits lookup failed:', e);
            // Fall back to the free window rather than refusing to open. A Pro
            // pilot briefly seeing the free range is recoverable; a dead button
            // is not, and the server still has the final say on the request.
            limits = {
                tier: isProUser() ? 'pro' : 'free',
                lookbackMs: isProUser() ? 14 * DAY_MS : DAY_MS,
                earliest: Date.now() - (isProUser() ? 14 * DAY_MS : DAY_MS),
                latest: Date.now(),
                maxSpanMs: 6 * HOUR_MS
            };
        }
        hideLoading();

        spanMs = Math.min(spanMs, limits.maxSpanMs || spanMs);
        buildPicker();
        bindKeys();

        // The entitlement often resolves after the panel is up. Rebuild the
        // picker when it lands so a Pro pilot who opened this early is not left
        // looking at the free range.
        if (!onProStatusChanged) {
            onProStatusChanged = async () => {
                if (!pickerEl) return;
                try { limits = await fetchLimits(); buildPicker(); } catch (_) { /* keep what we have */ }
            };
            window.addEventListener('proStatusChanged', onProStatusChanged);
        }
        try {
            if (window.InflightUser && !window.InflightUser.loaded && typeof window.refreshProStatus === 'function') {
                window.refreshProStatus();
            }
        } catch (_) { /* not signed in */ }

        return true;
    }

    /* =========================
     * Styles
     * ========================= */

    function injectStyles() {
        if (document.getElementById('global-playback-styles')) return;
        const style = document.createElement('style');
        style.id = 'global-playback-styles';
        style.textContent = `
        .gpb-picker { position: fixed; inset: 0; z-index: 4200; display: flex; align-items: center; justify-content: center; }
        .gpb-picker-backdrop { position: absolute; inset: 0; background: rgba(4,7,15,0.72); backdrop-filter: blur(6px); }
        .gpb-picker-card {
            position: relative; width: min(560px, calc(100vw - 32px));
            max-height: calc(100vh - 48px); overflow-y: auto;
            background: linear-gradient(180deg, #141a26 0%, #0d1119 100%);
            border: 1px solid rgba(148,163,184,0.18); border-radius: 20px;
            padding: 26px 24px 22px; color: #e2e8f0;
            box-shadow: 0 30px 80px rgba(0,0,0,0.6);
        }
        .gpb-picker-close {
            position: absolute; top: 14px; right: 14px; width: 32px; height: 32px;
            border: none; border-radius: 50%; cursor: pointer;
            background: rgba(148,163,184,0.12); color: #cbd5e1; font-size: 14px;
        }
        .gpb-picker-close:hover { background: rgba(148,163,184,0.22); }
        .gpb-eyebrow { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #818cf8; font-weight: 700; }
        .gpb-title { margin: 6px 0 4px; font-size: 24px; font-weight: 700; color: #f8fafc; }
        .gpb-sub { margin: 0 0 12px; font-size: 13px; color: #94a3b8; line-height: 1.5; }
        .gpb-sub b { color: #e2e8f0; }
        .gpb-tier-badge {
            display: inline-flex; align-items: center; gap: 7px;
            font-size: 12px; font-weight: 600; padding: 6px 11px; border-radius: 999px;
            background: rgba(99,102,241,0.14); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.3);
        }
        .gpb-tier-pro .gpb-tier-badge { background: rgba(250,204,21,0.12); color: #fde047; border-color: rgba(250,204,21,0.32); }
        .gpb-field { margin-top: 20px; }
        .gpb-label { display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 9px; }
        .gpb-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .gpb-chip {
            border: 1px solid rgba(148,163,184,0.2); background: rgba(148,163,184,0.08);
            color: #cbd5e1; border-radius: 999px; padding: 8px 14px;
            font-size: 13px; font-weight: 600; cursor: pointer; transition: all .15s ease;
        }
        .gpb-chip:hover { background: rgba(99,102,241,0.2); border-color: rgba(129,140,248,0.5); color: #e0e7ff; }
        .gpb-chip.active { background: rgba(99,102,241,0.32); border-color: #818cf8; color: #ffffff; }
        .gpb-chip.locked { color: #64748b; border-style: dashed; }
        .gpb-chip.locked i { color: #eab308; margin-left: 4px; font-size: 11px; }
        .gpb-chip.locked:hover { background: rgba(250,204,21,0.12); border-color: rgba(250,204,21,0.4); color: #fde047; }
        .gpb-input {
            width: 100%; box-sizing: border-box; padding: 11px 13px; border-radius: 12px;
            background: rgba(15,23,42,0.85); border: 1px solid rgba(148,163,184,0.22);
            color: #e2e8f0; font-size: 14px; font-family: inherit;
        }
        .gpb-input:focus { outline: none; border-color: #818cf8; }
        .gpb-hint { margin-top: 6px; font-size: 12px; color: #64748b; font-variant-numeric: tabular-nums; }
        .gpb-upsell {
            display: flex; align-items: center; gap: 12px; width: 100%; margin-top: 20px;
            padding: 13px 15px; border-radius: 14px; cursor: pointer; text-align: left;
            background: linear-gradient(135deg, rgba(250,204,21,0.14), rgba(249,115,22,0.1));
            border: 1px solid rgba(250,204,21,0.3); color: #fde68a; font-family: inherit;
        }
        .gpb-upsell:hover { border-color: rgba(250,204,21,0.55); }
        .gpb-upsell > i:first-child { font-size: 18px; color: #facc15; }
        .gpb-upsell span { flex: 1; font-size: 12px; line-height: 1.5; }
        .gpb-upsell b { display: block; font-size: 13px; color: #fef3c7; margin-bottom: 2px; }
        .gpb-go {
            width: 100%; margin-top: 20px; padding: 13px; border: none; border-radius: 14px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
            font-size: 15px; font-weight: 700; cursor: pointer; font-family: inherit;
        }
        .gpb-go:hover { filter: brightness(1.1); }

        .gpb-panel {
            position: fixed; left: 50%; transform: translateX(-50%);
            bottom: max(18px, env(safe-area-inset-bottom, 0px));
            width: min(760px, calc(100vw - 24px)); z-index: 4100;
            background: rgba(13,17,25,0.94); backdrop-filter: blur(14px);
            border: 1px solid rgba(148,163,184,0.16); border-radius: 18px;
            padding: 12px 14px; color: #e2e8f0;
            box-shadow: 0 20px 50px rgba(0,0,0,0.55);
        }
        .gpb-panel-top { display: flex; align-items: center; gap: 14px; }
        .gpb-clock { display: flex; flex-direction: column; line-height: 1.15; }
        .gpb-zulu { font-size: 20px; font-weight: 700; color: #f8fafc; font-variant-numeric: tabular-nums; }
        .gpb-date { font-size: 11px; color: #64748b; }
        .gpb-stats { flex: 1; font-size: 12px; color: #94a3b8; }
        .gpb-stats span[id] { color: #e2e8f0; font-weight: 700; }
        .gpb-shown { color: #64748b !important; font-weight: 400 !important; }
        .gpb-dot { margin: 0 6px; color: #475569; font-weight: 400; }
        /* The altitude ramp the aircraft and their trails are coloured by —
           the same stops as getAltColor(), so the key and the map agree. */
        .gpb-legend { display: flex; align-items: center; gap: 6px; margin-top: 5px; }
        .gpb-legend-ramp {
            width: 110px; height: 5px; border-radius: 3px;
            background: linear-gradient(90deg,
                rgb(56,189,248) 0%, rgb(45,212,191) 25%, rgb(163,230,53) 50%,
                rgb(250,204,21) 75%, rgb(248,113,113) 100%);
        }
        .gpb-legend-label { font-size: 9.5px; color: #64748b; letter-spacing: 0.04em; }

        .gpb-popup .mapboxgl-popup-content {
            background: rgba(13,17,25,0.95); backdrop-filter: blur(10px);
            border: 1px solid rgba(148,163,184,0.2); border-radius: 12px;
            padding: 9px 12px; color: #e2e8f0; font-size: 12px;
            box-shadow: 0 12px 30px rgba(0,0,0,0.5);
        }
        .gpb-popup .mapboxgl-popup-tip { display: none; }
        .gpb-pop-call { font-size: 14px; font-weight: 700; color: #f8fafc; }
        .gpb-pop-user { font-size: 11px; color: #a5b4fc; margin-top: 1px; }
        .gpb-pop-type { font-size: 11px; color: #64748b; margin-top: 1px; }
        .gpb-pop-nums { display: flex; gap: 10px; margin-top: 5px; font-variant-numeric: tabular-nums; color: #cbd5e1; }
        .gpb-actions { display: flex; gap: 6px; }
        .gpb-btn {
            width: 34px; height: 34px; border-radius: 10px; cursor: pointer;
            border: 1px solid rgba(148,163,184,0.18); background: rgba(148,163,184,0.08);
            color: #cbd5e1; font-size: 13px; display: inline-flex; align-items: center; justify-content: center;
        }
        .gpb-btn:hover { background: rgba(148,163,184,0.18); color: #f1f5f9; }
        .gpb-btn.active { background: rgba(99,102,241,0.28); border-color: #818cf8; color: #e0e7ff; }
        .gpb-close:hover { background: rgba(239,68,68,0.22); border-color: rgba(239,68,68,0.45); color: #fecaca; }
        .gpb-panel-scrub { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
        .gpb-play { width: 38px; height: 38px; border-radius: 50%; background: rgba(99,102,241,0.3); border-color: #818cf8; color: #fff; }
        .gpb-elapsed { font-size: 11px; color: #94a3b8; font-variant-numeric: tabular-nums; min-width: 42px; text-align: center; }
        .gpb-range { flex: 1; accent-color: #818cf8; height: 4px; cursor: pointer; }
        .gpb-speeds { display: flex; gap: 4px; }
        .gpb-speed {
            border: 1px solid rgba(148,163,184,0.18); background: rgba(148,163,184,0.08);
            color: #94a3b8; border-radius: 8px; padding: 5px 8px;
            font-size: 11px; font-weight: 700; cursor: pointer; font-family: inherit;
        }
        .gpb-speed.active { background: rgba(99,102,241,0.3); border-color: #818cf8; color: #fff; }

        #global-playback-loading {
            position: fixed; inset: 0; z-index: 4300; display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 16px;
            background: rgba(4,7,15,0.78); backdrop-filter: blur(5px);
            transition: opacity .2s ease;
        }
        #global-playback-loading.fade-out { opacity: 0; }
        .gpb-spinner {
            width: 42px; height: 42px; border-radius: 50%;
            border: 3px solid rgba(148,163,184,0.2); border-top-color: #818cf8;
            animation: gpb-spin .8s linear infinite;
        }
        @keyframes gpb-spin { to { transform: rotate(360deg); } }
        .gpb-loading-text { text-align: center; }
        .gpb-loading-title { font-size: 15px; font-weight: 700; color: #f1f5f9; }
        .gpb-loading-sub { margin-top: 4px; font-size: 12px; color: #94a3b8; }

        @media (max-width: 620px) {
            .gpb-panel { width: calc(100vw - 16px); padding: 10px 11px; border-radius: 16px; }
            /* No room for the legend or the window total beside the clock, but
               the airborne count is the one number worth keeping. */
            .gpb-legend { display: none; }
            .gpb-stat-total { display: none; }
            .gpb-stats { flex: 1; font-size: 11px; text-align: right; }
            /* The speeds get their own row rather than being dropped — without
               them a phone is stuck at whatever speed it opened on, and speed
               is the control this panel is mostly about. */
            .gpb-panel-scrub { flex-wrap: wrap; }
            .gpb-speeds { order: 3; width: 100%; justify-content: space-between; margin-top: 8px; }
            .gpb-speed { flex: 1; padding: 7px 0; }
            .gpb-picker-card { padding: 22px 18px 18px; border-radius: 18px; }
            .gpb-title { font-size: 21px; }
        }`;
        document.head.appendChild(style);
    }

    // Any unexpected failure in open() becomes a notification and a clean
    // teardown rather than an uncaught rejection that leaves the live map with
    // its traffic hidden.
    const openUnsafe = open;
    open = async function (opts) {
        try { return await openUnsafe(opts); }
        catch (e) {
            console.warn('[GlobalPlayback] open failed:', e);
            showToast('Could not open global playback.', 'error');
            try { close(); } catch (_) {}
            return false;
        }
    };

    return {
        open,
        close,
        isOpen: () => !!(panelEl || pickerEl),
        // The motion maths, exposed for tools/test-global-playback.js. Whether
        // aircraft move smoothly is the whole point of this module and it is
        // the one part that can be checked without a map, so it is checked.
        _internals: {
            normalizePath,
            positionAt,
            computeTangents,
            measureTrack,
            inView,
            trackMayBeInView,
            // The selection + build pass, so a test can run it thousands of
            // times and watch the heap. That it allocates nothing in the steady
            // state is not a performance detail — it is the difference between
            // playing for an hour and crashing after five minutes — and it is
            // not something you can see by reading the code.
            selectVisible,
            buildPlanes,
            buildTrails,
            setThinGridForTest: (degLat, degLon) => { cellDegLat = degLat; cellDegLon = degLon; },
            __planeIds: () => planeList.map(f => f.properties.flightId),
            __trailFeatures: () => trailList,
            poolSizes: () => ({
                planePool: planePool.length,
                trailPool: trailPool.length,
                planeList: planeList.length,
                trailList: trailList.length,
                chosen: chosenCount,
                candidates: candidateCount,
                candCap
            }),
            MAX_DRAWN,
            SOFT_CAP,
            TRAIL_POINTS,
            MAX_INTERP_GAP_MS,
            MAX_SPLINE_SEGMENT_MS,
            FADE_MS
        }
    };
})();

// Mirrored for non-module callers (the mobile chrome builds its tab bar
// outside the module graph).
try { window.InflightGlobalPlayback = GlobalPlayback; } catch (_) { /* no window */ }
