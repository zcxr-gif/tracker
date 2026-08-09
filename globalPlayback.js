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
// The chrome is a mode, not a panel. While a window is playing the app's own
// top bar, tab bar and orbs stand down and the replay owns three edges:
//
//   top           preset traffic filters — All Traffic, Airlines, Heavies,
//                 Cargo, Business, GA, Military, Watchlist — each carrying the
//                 count behind it, with "another moment" and "leave" pinned to
//                 the right so they never scroll away
//   left/bottom   the transport: clock, counts, scrubber, speeds
//   bottom right  the map overlays as bubbles — weather, ATC airspace, trails
//
// The same three on a phone, laid along the bottom edge either side of the
// thumb rather than stacked. See buildPanel() and the .gpb-mode rules.
//
// Public API:
//   GlobalPlayback.open({ map, apiBase, sessionId?, serverName?, onClose? })
//   GlobalPlayback.close()
//   GlobalPlayback.isOpen()

import {
    TRAFFIC_PRESETS as FILTER_PRESETS,
    classifyFlight,
    T_AIRLINE, T_HEAVY, T_CARGO, T_BUSINESS, T_GA, T_MILITARY
} from './trafficClasses.js';

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
// gets a tail. What is capped is how many points each tail is drawn with
// (TRAIL_POINTS) — a shorter tail on every aircraft beats a full tail on some
// of them and nothing on the rest.

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
// Trails are rebuilt on every push, with the planes.
//
// They used to run on their own slower cadence, on the reasoning that nobody
// can see a comet tail lag by a twentieth of a second. That reasoning forgot
// the speed multiplier: a tenth of a real second at 120x is twelve seconds of
// flight, and at 600x it is a full minute — so the aircraft floated several
// miles ahead of its own trail, detached, which is precisely what "the planes
// aren't following their paths" looks like. The trail's head is the aircraft's
// position; the two cannot be allowed to drift apart.
// Vertices per comet tail. A tail says where something came from; a dozen
// points draw that as well as sixty and cost a fifth as much geometry.
const TRAIL_POINTS = 12;
// Vertices per tail. A tail says where something came from; a dozen points draw
// that as well as sixty and cost a fifth as much geometry.
//
// There is deliberately no cap on how many aircraft get one. There used to be —
// 700, against a drawn set of up to 1500 — which meant more than half the
// aircraft on screen had no path under them at all. Half the map trailing
// nothing does not read as a tasteful limit; it reads as broken.
// How far outside the viewport an aircraft is still worth drawing. Enough that
// one flies in from off-screen already moving, rather than appearing at the
// edge, and enough to cover a flick-pan before the next push lands.
const CULL_MARGIN_FRACTION = 0.35;

// The full flown route is drawn only for aircraft you have singled out — the
// selected one, and the pilots on your watchlist. A full track costs an order
// of magnitude more vertices than a comet tail, so the count is what keeps it
// affordable; a watchlist is a handful of people, and this is generous for it.
const MAX_PATHS = 24;
const PATH_POINTS = 180;

const SPEED_STORAGE_KEY = 'globalPlaybackSpeed';
const SPAN_STORAGE_KEY = 'globalPlaybackSpanMs';
const TRAILS_STORAGE_KEY = 'globalPlaybackTrails';
const FILTER_STORAGE_KEY = 'globalPlaybackFilters';

// The filter rail's vocabulary lives in trafficClasses.js, shared with the
// live map's preset rail. Tapping Cargo, rewinding an hour and tapping Cargo
// again has to show the same fleet, which two copies of the list would not
// manage for a week.

export const GlobalPlayback = (() => {
    // ---------- state ----------
    let map = null;
    let apiBase = '';
    let sessionId = null;            // Infinite Flight server GUID, or null for all
    let serverName = '';
    let onCloseCallback = null;

    let limits = null;               // the server's answer to "what may I ask for?"
    let flights = [];                // { flightId, callsign, username, category, points[], cursor }
    let visibleFlights = [];         // the subset the filter rail is letting through
    let flightsById = new Map();     // flightId -> the same objects, for hit-testing
    let windowMeta = null;           // { start, end, stepMs } of the loaded window
    let classCounts = null;          // preset id -> how many flights in this window match

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
    // Filter rail selection. Empty and 'all' mean the same thing — everything —
    // so the rail can never end up showing an empty map with no way back.
    let activeFilters = new Set(['all']);
    // The two map overlays the bubbles own. Neither belongs to this module: the
    // rain radar is flight.js's `weatherToggle` listener and the airspace is
    // mapFilters.showAtcBoundaries, so the bubbles drive the app's own state
    // and only mirror it here so the button can light up.
    let weatherOn = false;
    let airspaceOn = false;
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
    const pathPool = [];                 // slot -> Feature (full flown route)
    const planeList = [];                // persistent; truncated, never replaced
    const trailList = [];
    const pathList = [];
    const planeCollection = { type: 'FeatureCollection', features: planeList };
    const trailCollection = { type: 'FeatureCollection', features: trailList };
    const pathCollection = { type: 'FeatureCollection', features: pathList };

    // Push scheduling (see the header note on setData cost).
    let lastPlanePush = 0;
    let frameCostEMA = 3;                // ms, exponential moving average
    let pushIntervalMs = TARGET_PUSH_INTERVAL_MS;
    let onMoveStart = null, onMove = null, onMoveEnd = null;
    let onVisibilityChange = null;
    let wasPlayingWhenHidden = false;
    let onStylesChanged = null;
    let onWatchlistChanged = null;

    // Hover / selection.
    let hoverPopup = null;
    let onPlaneEnter = null, onPlaneLeave = null, onPlaneClick = null;
    let selectedFlightId = null;
    // Keep the camera on the selected aircraft. Off by default: a replay you
    // cannot pan away from is a replay you cannot look around in.
    let followSelected = false;

    let airborneCount = 0;               // aircraft with a position this frame
    let drawnCount = 0;                  // …of which are inside the viewport

    const SRC_PLANES = 'global-playback-planes-source';
    const LYR_PLANES = 'global-playback-planes-layer';        // SDF, tintable
    const LYR_PLANES_NAT = 'global-playback-planes-natural';  // full-detail sprite
    const LYR_PLANE_LABELS = 'global-playback-plane-labels';
    const SRC_TRAILS = 'global-playback-trails-source';
    const LYR_TRAILS = 'global-playback-trails-layer';
    const LYR_PLANE_HALO = 'global-playback-plane-halo';      // ring under the ones you care about
    const SRC_PATHS = 'global-playback-paths-source';
    const LYR_PATHS = 'global-playback-paths-layer';          // the whole flown route, so far

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

    /* =========================
     * Filter rail
     * ========================= */

    function filterIsAll() {
        return activeFilters.size === 0 || activeFilters.has('all');
    }

    // Rebuild the drawn set from the rail's selection. Called on load and on
    // every chip, and nowhere per-frame: renderFrame reads visibleFlights.
    function applyFilters() {
        if (filterIsAll()) { visibleFlights = flights; return; }

        let mask = 0;
        let wantMine = false;
        for (const id of activeFilters) {
            const preset = FILTER_PRESETS.find(p => p.id === id);
            if (!preset) continue;
            if (preset.relation) wantMine = true;
            else if (preset.mask) mask |= preset.mask;
        }
        if (!mask && !wantMine) { visibleFlights = flights; return; }

        visibleFlights = flights.filter(f =>
            (mask !== 0 && (f.classMask & mask) !== 0) ||
            (wantMine && f.pilotRelation && f.pilotRelation !== 'none'));
    }

    // How many flights in the loaded window each preset would show. Counted
    // once per window: a chip that says how much is behind it is the difference
    // between a filter you trust and one you poke at.
    function countClasses() {
        const counts = { all: flights.length };
        for (const preset of FILTER_PRESETS) {
            if (preset.id === 'all') continue;
            let n = 0;
            for (const f of flights) {
                if (preset.relation) {
                    if (f.pilotRelation && f.pilotRelation !== 'none') n++;
                } else if ((f.classMask & preset.mask) !== 0) n++;
            }
            counts[preset.id] = n;
        }
        return counts;
    }

    function loadSavedFilters() {
        try {
            const raw = localStorage.getItem(FILTER_STORAGE_KEY);
            if (!raw) return;
            const ids = JSON.parse(raw);
            if (!Array.isArray(ids) || !ids.length) return;
            const known = ids.filter(id => FILTER_PRESETS.some(p => p.id === id));
            if (known.length) activeFilters = new Set(known);
        } catch (_) { /* private mode, or something else wrote the key */ }
    }

    function saveFilters() {
        try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify([...activeFilters])); }
        catch (_) { /* private mode */ }
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

    // Your own past flights, and your watchlist's, wear the colours you chose
    // for them — the same ones the live map uses. Watching a replay and picking
    // your own aircraft out of it is most of the point.
    function pilotRelationFor(username) {
        if (typeof window.getPilotRelation === 'function') {
            try { return window.getPilotRelation(username); } catch (_) { /* fall through */ }
        }
        return 'none';
    }

    function refreshPilotRelations() {
        for (const f of flights) f.pilotRelation = pilotRelationFor(f.username);
        // The Watchlist chip counts and filters on this, so both have to be
        // redone rather than only the colours.
        classCounts = flights.length ? countClasses() : null;
        applyFilters();
        refreshFilterChips();
        // Signing in mid-replay can turn the open card into "your flight".
        buildInfoCard();
        renderFrame(true);
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
                hdg: p[5] || 0,
                // Filled in by computeTangents. Declared here so every point
                // shares one hidden class and the frame loop reads them off a
                // fixed offset instead of a dictionary.
                mLat: 0, mLon: 0,
                sLat: 0, sLon: 0,
                eLat: 0, eLon: 0,
                u0: 0, uInv: 1
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
        fitSegments(pts);
    }

    /* Stop the curve overshooting the samples it is drawn through.
     *
     * A Catmull-Rom tangent is inherited from a point's *neighbours*, so it
     * knows nothing about the segment it is about to be used on. When the two
     * sides of a point disagree — and the place they disagree most is a stop,
     * where one side is a taxi and the other is nothing — the tangent is far
     * longer than the chord it has to cross, and a cubic with a tangent longer
     * than its own chord runs past the far end and comes back.
     *
     * On the map that is an aircraft rolling past where it stopped and then
     * creeping backwards onto it: measured at 3.4 m over half a minute at a
     * hold short, on an aeroplane that was standing still. It reads as a
     * backtaxi that never happened, which is exactly how it was reported.
     *
     * So the tangent is rebuilt out of its two halves, which turn out to have
     * different right answers.
     *
     * Its *direction* comes from the neighbours, as before — that is the part
     * Catmull-Rom is good at, and it is what makes the path curve through a
     * turn instead of cornering at every sample.
     *
     * Its *length* comes from the recorded ground speed, which was sitting in
     * the data all along and was being ignored. A cubic whose end slopes are
     * the real speeds at the two ends is not an approximation of an
     * accelerating aircraft, it is exactly one: over a segment of constant
     * acceleration the cubic term falls out and the curve is the aeroplane's
     * own equation of motion. That is what takes a departing aircraft off the
     * runway at the right moment instead of a hundred metres early.
     *
     * The two speeds are scaled together so their average crosses the chord in
     * the segment's own time. It is their ratio that carries the acceleration;
     * the scale has to answer to where the aircraft was actually seen. A useful
     * side effect is that any constant error in reported ground speed cancels
     * out entirely, and a pair of speeds can never sum to more than the chord
     * needs — which is the Fritsch-Carlson monotonicity condition, met by
     * construction rather than by clamping.
     *
     * The limiter is kept anyway, for the segments where there is no usable
     * speed to work from, and the sideways component — the part that makes the
     * path a curve rather than a polyline — is bounded by the chord as well: a
     * segment may bow, it may not loop.
     *
     * Both tangents are folded into the segment's own duration and stored on
     * the point that starts the segment, because the limit depends on the
     * segment and a point's two segments can want different things from it.
     * Doing it here also takes four multiplications out of the frame loop.
     */
    const MAX_TANGENT_RATIO = 3;      // Fritsch-Carlson: the circle of radius 3
    const MAX_BOW_RATIO = 1;          // sideways travel, as a multiple of the chord

    /* The other half of the ground problem: time an aircraft spent stopped.
     *
     * The recorder drops a report only when the aircraft is stationary *and*
     * the last point it stored was stationary too (history.cjs). So a hold
     * short is stored as exactly two points — the one where it stopped and the
     * one where it started again — and everything suppressed between them was
     * suppressed because the aeroplane was not moving. The gap is not missing
     * data. It is a record of standing still, and it is the only place in the
     * feed where a two-minute gap means something specific.
     *
     * Spread evenly across that gap, an aircraft holding for two minutes is
     * drawn sliding gently up the taxiway the whole time, which is both wrong
     * and the sort of wrong somebody watching their own flight will spot.
     *
     * The speeds say how much of the gap was really spent moving: covering the
     * chord at the average of the two end speeds takes a certain time, and if
     * that is a fraction of the gap, the rest of the gap was the wait. The wait
     * goes next to whichever end was stopped. An aircraft that brakes to a halt
     * stops and stays stopped; one that is about to depart waits and then goes.
     */
    const STATIONARY_KT = 2;          // the recorder's own threshold
    const M_PER_DEG = 110946;
    const KT_M_PER_MS = 0.514444 / 1000;
    const MIN_MOVING_FRACTION = 0.05; // never squeeze motion into a jump

    function fitSegments(pts) {
        const n = pts.length;
        for (let i = 0; i < n - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            const dt = b.t - a.t;

            // Work in a locally square metric so a chord's direction means the
            // same thing in both axes; longitude is compressed by latitude
            // everywhere but the equator.
            const cosLat = Math.cos((a.lat + b.lat) * 0.5 * Math.PI / 180) || 1e-6;
            const cx = (b.lon - a.lon) * cosLat;
            const cy = b.lat - a.lat;
            const L = Math.hypot(cx, cy);

            a.u0 = 0; a.uInv = 1;

            if (!(dt > 0) || L <= 1e-12) {
                // The aircraft is where it was. Any tangent at all would send
                // it out and back for no reason — the commonest version of the
                // fault, since an aeroplane holding short is reported at the
                // same spot twice.
                a.sLat = 0; a.sLon = 0; a.eLat = 0; a.eLon = 0;
                continue;
            }

            const ux = cx / L, uy = cy / L;

            // Direction from the neighbours; the chord stands in wherever the
            // neighbours have nothing to say (the ends of a track, or a point
            // whose two neighbours are the same place).
            let adx = a.mLon * cosLat, ady = a.mLat;
            let aMag = Math.hypot(adx, ady);
            if (aMag > 1e-15) { adx /= aMag; ady /= aMag; } else { adx = ux; ady = uy; }

            let bdx = b.mLon * cosLat, bdy = b.mLat;
            let bMag = Math.hypot(bdx, bdy);
            if (bMag > 1e-15) { bdx /= bMag; bdy /= bMag; } else { bdx = ux; bdy = uy; }

            // Length from the recorded speeds, rescaled to the chord. Knots
            // need no conversion: the scaling cancels the units along with any
            // constant error in them.
            const sa = a.gs > 0 ? a.gs : 0;
            const sb = b.gs > 0 ? b.gs : 0;
            let aLen = L, bLen = L;
            if (sa + sb > 0.01) {
                const k = 2 * L / (sa + sb);
                aLen = sa * k;
                bLen = sb * k;

                // One end stopped and a chord too short for the time taken:
                // the aircraft was holding, and only part of the gap was
                // spent moving. Confine the motion to that part.
                if (Math.min(sa, sb) < STATIONARY_KT) {
                    const moving = 2 * L * M_PER_DEG / ((sa + sb) * KT_M_PER_MS * dt);
                    if (moving < 0.9) {
                        const f = Math.max(MIN_MOVING_FRACTION, moving);
                        // The wait sits against the stopped end.
                        a.u0 = sa < sb ? 1 - f : 0;
                        a.uInv = 1 / f;
                    }
                }
            }

            let ax = adx * aLen, ay = ady * aLen;
            let bx = bdx * bLen, by = bdy * bLen;

            // Split along the chord and across it.
            let aPar = ax * ux + ay * uy;
            let bPar = bx * ux + by * uy;
            const aPerpX = ax - aPar * ux, aPerpY = ay - aPar * uy;
            const bPerpX = bx - bPar * ux, bPerpY = by - bPar * uy;

            // Along: never negative (that is the backwards step itself), and
            // inside the radius-3 circle that makes the cubic monotone.
            if (aPar < 0) aPar = 0;
            if (bPar < 0) bPar = 0;
            const alpha = aPar / L, beta = bPar / L;
            const r2 = alpha * alpha + beta * beta;
            if (r2 > MAX_TANGENT_RATIO * MAX_TANGENT_RATIO) {
                const tau = MAX_TANGENT_RATIO / Math.sqrt(r2);
                aPar *= tau; bPar *= tau;
            }

            // Across: bounded, so a hard turn bows instead of looping.
            const cap = L * MAX_BOW_RATIO;
            let aPerpS = 1, bPerpS = 1;
            const aPerpMag = Math.hypot(aPerpX, aPerpY);
            const bPerpMag = Math.hypot(bPerpX, bPerpY);
            if (aPerpMag > cap) aPerpS = cap / aPerpMag;
            if (bPerpMag > cap) bPerpS = cap / bPerpMag;

            ax = aPar * ux + aPerpX * aPerpS;
            ay = aPar * uy + aPerpY * aPerpS;
            bx = bPar * ux + bPerpX * bPerpS;
            by = bPar * uy + bPerpY * bPerpS;

            a.sLon = ax / cosLat; a.sLat = ay;
            a.eLon = bx / cosLat; a.eLat = by;
        }
        if (n) {
            const z = pts[n - 1];
            z.sLat = 0; z.sLon = 0; z.eLat = 0; z.eLon = 0;
            z.u0 = 0; z.uInv = 1;
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
    // nothing. Callers must read what they need before the next call, or pass
    // their own object as positionAt's third argument.
    const SHARED_POS = { lat: 0, lon: 0, alt: 0, gs: 0, hdg: 0, t: 0, opacity: 1 };
    // A caller wanting to hold two positions at once makes one of these.
    const makePosition = () => ({ lat: 0, lon: 0, alt: 0, gs: 0, hdg: 0, t: 0, opacity: 1 });

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
     * Returns the shared POS object, so a second call invalidates the first.
     * That is deliberate — a fresh object per aircraft per frame is exactly the
     * allocation this module cannot afford — but it is a trap, and it has
     * already cost two misdiagnoses where a harness held two "positions" that
     * were the same object. Callers needing more than one at a time pass their
     * own `out`.
     */
    function positionAt(f, absT, out) {
        const POS = out || SHARED_POS;
        const pts = f.points;
        if (!pts || pts.length < 2) return null;

        const first = pts[0], last = pts[pts.length - 1];
        if (absT < first.t || absT > last.t) return null;

        const i = seek(f, absT);
        const a = pts[i], b = pts[i + 1];
        const dt = b.t - a.t;
        if (dt > MAX_INTERP_GAP_MS) return null;

        // The segment's own progress, with any time the aircraft spent standing
        // still taken out of it — see fitSegments.
        let u = dt > 0 ? (absT - a.t) / dt : 0;
        if (a.uInv !== 1) {
            u = (u - a.u0) * a.uInv;
            if (u < 0) u = 0; else if (u > 1) u = 1;
        }

        // Position, and the tangent to the path at the same instant. They come
        // out of the same curve on purpose — see the note on heading below.
        let dLat, dLon;

        if (dt > 0 && dt <= MAX_SPLINE_SEGMENT_MS) {
            // Cubic Hermite. h10/h11 carry the tangents — already folded into
            // this segment's duration and limited against its chord by
            // limitTangents, which is what keeps the curve from running past a
            // sample and reversing onto it.
            const u2 = u * u, u3 = u2 * u;
            const h00 = 2 * u3 - 3 * u2 + 1;
            const h10 = u3 - 2 * u2 + u;
            const h01 = -2 * u3 + 3 * u2;
            const h11 = u3 - u2;
            POS.lat = h00 * a.lat + h10 * a.sLat + h01 * b.lat + h11 * a.eLat;
            POS.lon = h00 * a.lon + h10 * a.sLon + h01 * b.lon + h11 * a.eLon;

            // The curve's own derivative. Scale factors are irrelevant — only
            // the direction is wanted — so dp/du is used as-is.
            const g00 = 6 * u2 - 6 * u;
            const g10 = 3 * u2 - 4 * u + 1;
            const g01 = -6 * u2 + 6 * u;
            const g11 = 3 * u2 - 2 * u;
            dLat = g00 * a.lat + g10 * a.sLat + g01 * b.lat + g11 * a.eLat;
            dLon = g00 * a.lon + g10 * a.sLon + g01 * b.lon + g11 * a.eLon;
        } else {
            POS.lat = a.lat + (b.lat - a.lat) * u;
            POS.lon = a.lon + (b.lon - a.lon) * u;
            dLat = b.lat - a.lat;
            dLon = b.lon - a.lon;
        }

        POS.alt = a.alt + (b.alt - a.alt) * u;
        POS.gs = a.gs + (b.gs - a.gs) * u;

        /* Heading comes from the path, not from the recorded heading field.
         *
         * Both were available and taking the recorded one looked obviously
         * right — it is what flightReplay and atcReplay do. It is right for
         * them, because they animate every recorded point and interpolate
         * straight between them, so the direction they draw an aircraft moving
         * and the heading they draw it pointing are the same thing.
         *
         * This replay is not that. Position follows a spline through points the
         * backend has already thinned to a time grid, and recorded heading is a
         * separate signal sampled at those same instants. Through a turn the
         * two part company — measured at up to 33 degrees on a realistic track
         * — and an aircraft drawn moving one way while pointing another does
         * not read as crabbing, it reads as the whole map swinging around.
         *
         * Taking the tangent of the curve actually being drawn makes that
         * impossible by construction: the aircraft always points exactly where
         * it is going. The crab angle is lost, which at fifteen pixels nobody
         * could see anyway.
         */
        //
        // Stateless, deliberately. Remembering the last heading on the flight
        // object is the obvious way to hold a direction through a stationary
        // moment, and it costs a boxed heap number per aircraft per frame —
        // the exact churn the render pass is built to avoid, and something the
        // GC budget in the tests caught within minutes of it being written. The
        // chord is a perfectly good second opinion and costs nothing.
        const cosLat = Math.cos(POS.lat * Math.PI / 180);
        if (Math.abs(dLat) > 1e-12 || Math.abs(dLon) > 1e-12) {
            POS.hdg = (Math.atan2(dLon * cosLat, dLat) * 180 / Math.PI + 360) % 360;
        } else if (Math.abs(b.lat - a.lat) > 1e-12 || Math.abs(b.lon - a.lon) > 1e-12) {
            // The tangent vanished mid-segment; the segment itself still has a
            // direction.
            POS.hdg = (Math.atan2((b.lon - a.lon) * cosLat, b.lat - a.lat) * 180 / Math.PI + 360) % 360;
        } else {
            // Genuinely stationary — parked, or holding. Nothing to derive a
            // direction from, so the recorded heading is all there is.
            let delta = b.hdg - a.hdg;
            if (delta > 180) delta -= 360; else if (delta < -180) delta += 360;
            POS.hdg = (a.hdg + delta * u + 360) % 360;
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

    /* =========================
     * Paint, borrowed from the live map
     * =========================
     * Everything here defers to flight.js rather than restating it. A replay
     * that invents its own palette is a replay that drifts out of step with the
     * app the moment either side is touched — and, more immediately, one that
     * ignores the colour the pilot actually chose.
     *
     * Each helper falls back to something sane if the host globals are missing,
     * because this module is also loadable on its own.
     */

    const FADE_OPACITY_EXPR = ['/', ['coalesce', ['get', 'opacity'], 100], 100];

    /* The aircraft you singled out.
     *
     * Colour alone was not enough. In White mode — the default — your own
     * aircraft and your watchlist's are the only ones tinted at all, which is
     * a real difference on a quiet map and completely invisible on a busy one:
     * an amber 12-pixel icon among two thousand white 12-pixel icons is not
     * something the eye finds. So they also get a ring under them and their
     * whole flown route drawn, which are visible at any density.
     *
     * The colours are the pilot's own settings, the same ones the live map
     * uses, so a friend is the same colour in both. */
    const HALO_FILTER = ['any',
        ['==', ['get', 'pilotRelation'], 'user'],
        ['==', ['get', 'pilotRelation'], 'watchlist'],
        ['boolean', ['get', 'selected'], false]
    ];
    // The chrome's accent, so the ring on the map, the route drawn from it and
    // the card's top edge are all obviously the same "this is the one you
    // picked". Distinct from both relation colours below.
    const SELECTED_COLOR = '#38bdf8';

    function relationColors() {
        const f = window.mapFilters || {};
        return {
            user: f.userPlaneColor || '#f97316',
            watchlist: f.friendPlaneColor || '#c084fc'
        };
    }

    // Relation wins over selection: singling out your own aircraft should not
    // repaint it somebody else's colour.
    function haloColorExpression(rel) {
        return ['case',
            ['==', ['get', 'pilotRelation'], 'user'], rel.user,
            ['==', ['get', 'pilotRelation'], 'watchlist'], rel.watchlist,
            SELECTED_COLOR
        ];
    }

    function pathColorFor(f) {
        const rel = relationColors();
        if (f.pilotRelation === 'user') return rel.user;
        if (f.pilotRelation === 'watchlist') return rel.watchlist;
        return SELECTED_COLOR;
    }

    function colorExpression() {
        if (typeof window.getPremiumColorExpression === 'function') {
            try { return window.getPremiumColorExpression(); } catch (_) { /* fall through */ }
        }
        return '#ffffff';
    }
    function tintedIconExpression() {
        if (typeof window.getTintedIconImageExpression === 'function') {
            try { return window.getTintedIconImageExpression(); } catch (_) { /* fall through */ }
        }
        return ['concat', 'icon-', ['coalesce', ['get', 'category'], 'B737']];
    }
    function naturalIconExpression() {
        if (typeof window.getNaturalIconImageExpression === 'function') {
            try { return window.getNaturalIconImageExpression(); } catch (_) { /* fall through */ }
        }
        return '';
    }

    function planeLayout(iconImage) {
        const baseSize = (window.mapFilters?.planeIconSize || 0.16);
        return {
            'icon-image': iconImage,
            'icon-rotate': ['get', 'heading'],
            'icon-rotation-alignment': 'map',
            // Overlap allowed and placement ignored on purpose: this skips
            // symbol collision detection, which is the expensive half of a
            // symbol layout and would otherwise be re-run for every tile on
            // every push.
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-size': ['case', ['boolean', ['get', 'selected'], false], baseSize * 1.5, baseSize]
        };
    }

    // Re-read the live map's settings and re-apply them. Called when the pilot
    // changes colour mode or icon size while a replay is open — without it the
    // replay keeps the palette it opened with, which reads as the setting not
    // working rather than as the replay being stale.
    function applyLiveMapStyles() {
        if (!map) return;
        try {
            if (map.getLayer(LYR_PLANES)) {
                map.setLayoutProperty(LYR_PLANES, 'icon-image', tintedIconExpression());
                map.setPaintProperty(LYR_PLANES, 'icon-color', colorExpression());
                map.setLayoutProperty(LYR_PLANES, 'icon-size', planeLayout(null)['icon-size']);
            }
            if (map.getLayer(LYR_PLANES_NAT)) {
                map.setLayoutProperty(LYR_PLANES_NAT, 'icon-image', naturalIconExpression());
                map.setLayoutProperty(LYR_PLANES_NAT, 'icon-size', planeLayout(null)['icon-size']);
            }
            // The halo wears the pilot's own "my aircraft" / "friend" colours,
            // so changing either has to reach it as well as the icons.
            if (map.getLayer(LYR_PLANE_HALO)) {
                const rel = relationColors();
                map.setPaintProperty(LYR_PLANE_HALO, 'circle-color', haloColorExpression(rel));
                map.setPaintProperty(LYR_PLANE_HALO, 'circle-stroke-color', haloColorExpression(rel));
            }
        } catch (_) { /* style mid-swap; the next open rebuilds */ }
        // The card's accent and the flown route are painted from the same two
        // colours, so they are re-read here too.
        buildInfoCard();
    }

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

        // The whole route flown so far, for the aircraft you have singled out —
        // the selected one and everyone on your watchlist. Separate from the
        // comet tails because it is a different statement: a tail says where
        // something came from in the last quarter hour, this says where the
        // flight has been since the window opened, and it grows as it flies.
        if (!map.getSource(SRC_PATHS)) {
            map.addSource(SRC_PATHS, { type: 'geojson', data: EMPTY_FC, tolerance: 0.35 });
        }
        if (!map.getLayer(LYR_PATHS)) {
            map.addLayer({
                id: LYR_PATHS, type: 'line', source: SRC_PATHS,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': ['get', 'color'],
                    'line-width': ['case', ['boolean', ['get', 'selected'], false],
                        ['interpolate', ['linear'], ['zoom'], 2, 2.2, 6, 3.2, 10, 4],
                        ['interpolate', ['linear'], ['zoom'], 2, 1.4, 6, 2.2, 10, 2.8]],
                    'line-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.95, 0.75]
                }
            });
        }

        if (!map.getSource(SRC_PLANES)) {
            map.addSource(SRC_PLANES, { type: 'geojson', data: EMPTY_FC });
        }

        // A ring under the aircraft that matter to you. Drawn from the plane
        // source rather than a source of its own, so it costs a filter and no
        // extra geometry at all — the features are already being pushed.
        if (!map.getLayer(LYR_PLANE_HALO)) {
            const rel = relationColors();
            map.addLayer({
                id: LYR_PLANE_HALO, type: 'circle', source: SRC_PLANES,
                filter: HALO_FILTER,
                paint: {
                    'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 7, 6, 11, 12, 18],
                    'circle-color': haloColorExpression(rel),
                    'circle-opacity': ['*', FADE_OPACITY_EXPR, 0.16],
                    'circle-stroke-width': 1.6,
                    'circle-stroke-color': haloColorExpression(rel),
                    'circle-stroke-opacity': ['*', FADE_OPACITY_EXPR, 0.8]
                }
            });
        }

        // Two layers over one source, exactly as the live map does it (see the
        // "TWO-LAYER SDF / NATURAL RENDERING" note in flight.js): Mapbox cannot
        // reliably tint when one symbol layer mixes SDF and non-SDF icons, so
        // the tintable silhouettes and the full-detail natural sprites are drawn
        // separately and each emits an empty icon-image for the planes it does
        // not own.
        //
        // Replaying traffic in a palette the pilot did not choose was the bug
        // this fixes: aircraft were coloured by altitude regardless of the
        // White / Blue / Orange / custom setting, so a paid custom colour simply
        // did not apply to playback.
        if (!map.getLayer(LYR_PLANES_NAT)) {
            map.addLayer({
                id: LYR_PLANES_NAT, type: 'symbol', source: SRC_PLANES,
                layout: planeLayout(naturalIconExpression()),
                paint: { 'icon-opacity': FADE_OPACITY_EXPR }
            });
        }
        if (!map.getLayer(LYR_PLANES)) {
            map.addLayer({
                id: LYR_PLANES, type: 'symbol', source: SRC_PLANES,
                layout: planeLayout(tintedIconExpression()),
                paint: {
                    'icon-color': colorExpression(),
                    // Carries the entry/exit fade, so aircraft arrive and leave
                    // instead of blinking into existence mid-window. Stored as
                    // 0–100 so the property stays a small integer; see
                    // buildPlanes() for why that matters.
                    'icon-opacity': FADE_OPACITY_EXPR
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

        /* A camera move is a reason to draw, not a reason to stop.
         *
         * This used to stand down for the first 350ms of every gesture, on the
         * theory that a pinch is competing for the same tiles a push would
         * rebuild. Measured, that was 89% of the screen with nothing drawn on
         * it halfway through a zoom out, and the replay frozen for the length
         * of the gesture — which is how it was reported: zooming "cuts off the
         * playback".
         *
         * It could not be otherwise. What gets drawn is chosen against the
         * viewport as it stood at the last push, so a viewport that has since
         * grown is a viewport with aircraft missing from everywhere it grew
         * into. Skipping pushes during the one gesture that changes the
         * viewport fastest is skipping them exactly when they are needed.
         *
         * The saving was never worth having either: a push is about two
         * milliseconds with fifteen hundred aircraft and their trails, against
         * a thirty-three millisecond frame. This module's rule everywhere else
         * is that the frame rate does not give way and the amount of detail
         * does; the camera is not an exception to it.
         */
        onMoveStart = () => {
            // Forced: this is the frame that sets the generous pad, and it is
            // worth nothing if the rate limiter holds it until the gesture is
            // already underway.
            gestureStarting = true;
            renderFrame(true);
        };
        onMove = () => renderFrame();
        onMoveEnd = () => renderFrame(true);
        map.on('movestart', onMoveStart);
        map.on('move', onMove);
        map.on('moveend', onMoveEnd);
        // A resize changes the viewport without moving the camera, and while
        // paused nothing else would notice.
        map.on('resize', onMoveEnd);

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

        // Colour mode, custom colour and icon size are the pilot's, and they
        // may change them while a replay is up.
        onStylesChanged = () => { applyLiveMapStyles(); renderFrame(true); };
        window.addEventListener('aircraftStylesChanged', onStylesChanged);

        // Signing in, or editing the watchlist, changes which aircraft wear the
        // highlight colours. `proStatusChanged` fires on the sign-in path and
        // is the cheapest signal we have for it.
        onWatchlistChanged = () => refreshPilotRelations();
        window.addEventListener('proStatusChanged', onWatchlistChanged);
        window.addEventListener('watchlistUpdated', onWatchlistChanged);

        onPlaneClick = (e) => {
            const feature = e.features && e.features[0];
            if (!feature) return;
            selectFlight(feature.properties.flightId);
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
        if (onStylesChanged) {
            try { window.removeEventListener('aircraftStylesChanged', onStylesChanged); } catch (_) {}
            onStylesChanged = null;
        }
        if (onWatchlistChanged) {
            try { window.removeEventListener('proStatusChanged', onWatchlistChanged); } catch (_) {}
            try { window.removeEventListener('watchlistUpdated', onWatchlistChanged); } catch (_) {}
            onWatchlistChanged = null;
        }
        wasPlayingWhenHidden = false;

        if (!map) return;
        if (onMoveStart) { try { map.off('movestart', onMoveStart); } catch (_) {} onMoveStart = null; }
        if (onMove) { try { map.off('move', onMove); } catch (_) {} onMove = null; }
        if (onMoveEnd) {
            try { map.off('moveend', onMoveEnd); } catch (_) {}
            try { map.off('resize', onMoveEnd); } catch (_) {}
            onMoveEnd = null;
        }
        if (onPlaneClick) { try { map.off('click', LYR_PLANES, onPlaneClick); } catch (_) {} onPlaneClick = null; }
        if (onPlaneEnter) { try { map.off('mouseenter', LYR_PLANES, onPlaneEnter); } catch (_) {} onPlaneEnter = null; }
        if (onPlaneLeave) { try { map.off('mouseleave', LYR_PLANES, onPlaneLeave); } catch (_) {} onPlaneLeave = null; }
        if (hoverPopup) { try { hoverPopup.remove(); } catch (_) {} hoverPopup = null; }
        try { if (map.getCanvas) map.getCanvas().style.cursor = ''; } catch (_) {}
    }

    function removeLayers() {
        if (!map) return;
        [LYR_PLANE_LABELS, LYR_PLANES, LYR_PLANES_NAT, LYR_PLANE_HALO, LYR_PATHS, LYR_TRAILS].forEach(id => {
            if (map.getLayer && map.getLayer(id)) { try { map.removeLayer(id); } catch (_) {} }
        });
        [SRC_PLANES, SRC_TRAILS, SRC_PATHS].forEach(id => {
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

    // How much the viewport grew at the last push. A zoom out reveals ground
    // that was not on screen when the drawn set was chosen, and if the margin
    // does not already cover it that ground is drawn empty for a frame — at
    // eighty times in a seventh of a second, measured, four fifths of the
    // screen. Padding by the growth already seen covers the growth about to
    // happen, and costs nothing when the camera is still.
    let lastSpanLat = 0, lastSpanLon = 0;
    const MAX_GROWTH_PAD = 2;
    // Growth can only be measured once it has happened, which leaves the first
    // frame of a gesture predicting from a still camera. So the first push of
    // each gesture is padded generously on spec — one frame, once per gesture,
    // and it covers a zoom that arrives faster than any hand could make it.
    let gestureStarting = false;
    const GESTURE_START_PAD = 1;

    function refreshCullBounds() {
        try {
            const b = map.getBounds();
            const spanLat = b.getNorth() - b.getSouth();
            const west = b.getWest(), east = b.getEast();
            const spanLon = Math.abs(east - west);

            let grow = 1;
            if (lastSpanLat > 0 && lastSpanLon > 0) {
                grow = Math.max(spanLat / lastSpanLat, spanLon / lastSpanLon);
            }
            lastSpanLat = spanLat; lastSpanLon = spanLon;
            let margin = CULL_MARGIN_FRACTION
                + Math.min(MAX_GROWTH_PAD, Math.max(0, grow - 1));
            if (gestureStarting) {
                gestureStarting = false;
                if (margin < GESTURE_START_PAD) margin = GESTURE_START_PAD;
            }

            const padLat = spanLat * margin;
            const padLon = spanLon * margin;

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
                    category: 'B737', heading: 0,
                    // Drives the live map's colour expression: 'user' and
                    // 'watchlist' get the pilot's chosen highlight colours,
                    // everyone else the active mode's colour. There is no
                    // per-aircraft colour any more — that was the bug.
                    pilotRelation: 'none',
                    opacity: 100, selected: false
                }
            };
        }
        return feat;
    }

    function pathSlot(i) {
        let feat = pathPool[i];
        if (!feat) {
            feat = pathPool[i] = {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [] },
                properties: { color: SELECTED_COLOR, selected: false }
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
            p.pilotRelation = f.pilotRelation;
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
            p.opacity = Math.round(candOpacity[i] * 100);
            p.selected = (f.flightId === selectedFlightId);

            planeList[s] = feat;
        }
        planeList.length = chosenCount;
    }

    /**
     * The full route flown so far, for the handful of aircraft that earn one.
     *
     * "So far" is the point: it is cut at the current clock, so it draws itself
     * across the map as the flight flies rather than appearing whole. That is
     * the difference between watching a replay and reading a map of one.
     *
     * Who earns one is deliberately a handful — the selected aircraft and the
     * pilots on your watchlist. A full track is up to a couple of hundred
     * vertices against a comet tail's twelve, so this is affordable for
     * twenty-odd aircraft and ruinous for two thousand. Everyone else keeps
     * the tail.
     */
    function buildPaths(absT) {
        let drawn = 0;

        // Walk the drawn set rather than every flight: a path for an aircraft
        // culled off-screen is geometry nobody can see. The selected one is
        // picked up here too, since selecting an aircraft you cannot see is
        // not something the map lets you do.
        for (let s = 0; s < chosenCount && drawn < MAX_PATHS; s++) {
            const i = chosen[s];
            const f = candFlight[i];
            const isSelected = f.flightId === selectedFlightId;
            const isKnown = f.pilotRelation && f.pilotRelation !== 'none';
            if (!isSelected && !isKnown) continue;

            const pts = f.points;
            // Everything recorded up to now. Binary search would save a walk,
            // but this runs for at most MAX_PATHS flights.
            let upTo = 0;
            while (upTo < pts.length && pts[upTo].t <= absT) upTo++;
            if (upTo < 1) continue;

            const feat = pathSlot(drawn);
            const coords = feat.geometry.coordinates;
            const take = Math.min(upTo, PATH_POINTS - 1);
            const stride = upTo / take;

            let w = 0;
            for (let k = 0; k < take; k++) {
                const p = pts[Math.floor(k * stride)];
                setCoord(coords, w++, p.lon, p.lat);
            }
            // Ends at the interpolated position, so the line stays welded to
            // the nose of the aircraft between recorded points.
            setCoord(coords, w++, candLon[i], candLat[i]);
            coords.length = w;
            if (w < 2) continue;

            feat.properties.color = pathColorFor(f);
            feat.properties.selected = isSelected;
            pathList[drawn++] = feat;
        }
        pathList.length = drawn;
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

        for (let s = 0; s < chosenCount; s++) {
            const i = chosen[s];
            const f = candFlight[i];
            const pts = f.points;

            const startIdx = firstIndexAtOrAfter(pts, from);
            // How many recorded points fall inside the tail window.
            let available = 0;
            for (let j = startIdx; j < pts.length && pts[j].t <= absT; j++) available++;
            if (available < 1) continue;

            // Slot by output position, not by loop index: a flight with
            // nothing to draw is skipped, and if the two diverged a pooled
            // feature would be written under one index and published under
            // another.
            const feat = trailSlot(drawn);
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

        if (!force && now - lastPlanePush < pushIntervalMs) return;

        const began = now;
        refreshCullBounds();
        refreshThinGrid();

        // Thinning only earns its keep once there is something to thin. Below
        // the threshold every aircraft is drawn, which is the zoomed-in case
        // and the one where individual smoothness is actually being watched.
        // `true` here means "thin if you must", not "thin" — selectVisible
        // only engages the grid once the visible set exceeds what a push can
        // carry, so an ordinary window is drawn whole.
        airborneCount = selectVisible(visibleFlights, absT, cull, true);
        drawnCount = chosenCount;

        buildPlanes();
        try {
            map.getSource(SRC_PLANES).setData(planeCollection);
        } catch (_) {
            return;   // style swapped underneath us; the next frame retries
        }

        try {
            const trailSrc = map.getSource(SRC_TRAILS);
            if (trailSrc) { buildTrails(absT); trailSrc.setData(trailCollection); }
        } catch (_) { /* same */ }

        try {
            const pathSrc = map.getSource(SRC_PATHS);
            if (pathSrc) { buildPaths(absT); pathSrc.setData(pathCollection); }
        } catch (_) { /* same */ }

        lastPlanePush = began;

        // Measured across both pushes, since they land on the same main thread.
        const cost = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - began;
        frameCostEMA = frameCostEMA * 0.85 + cost * 0.15;
        adaptPushInterval();

        updateHUD(absT);
        updateInfoCard(absT);
        if (followSelected) keepCameraOnSelection();
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
                <div class="gpb-picker-grip" aria-hidden="true"></div>
                <button type="button" class="gpb-picker-close" data-gpb="dismiss" aria-label="Close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
                <div class="gpb-picker-body">
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
                </div>

                <!-- Pinned, not scrolled with the fields above it. On a phone
                     the offset chips alone are taller than the viewport, and a
                     "Start playback" button you have to scroll to find is the
                     one control in here that must never be off screen. -->
                <div class="gpb-picker-foot">
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
                </div>
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
     * Replay chrome
     * =========================
     * Three pieces, each owning one edge of the screen, under one root so the
     * whole mode goes away in a single remove():
     *
     *   top          the filter rail — which traffic is on the map — with the
     *                two session controls (pick another moment, leave) pinned
     *                to its right so they never scroll away with the chips
     *   left/bottom  the transport: the clock, the scrubber and the speeds.
     *                A phone's thumb sits at the bottom-left and a desktop's
     *                eye starts there, so that is where the controls live
     *   bottom-right the map overlays — weather, airspace, trails — as bubbles,
     *                within thumb reach and clear of the transport
     *
     * The app's own chrome is stood down while this is up (see the .gpb-mode
     * rules in injectStyles): the replay is a mode, not a panel floating over
     * the live map, and two competing bottom bars is what it looked like
     * before.
     */

    function filterChipsHtml() {
        return FILTER_PRESETS.map(preset => {
            const on = preset.id === 'all' ? filterIsAll() : activeFilters.has(preset.id);
            const count = classCounts ? (classCounts[preset.id] ?? 0) : null;
            // A preset with nothing behind it in this window is shown, greyed,
            // rather than hidden — the rail keeping the same shape from one
            // window to the next is worth more than hiding an empty chip.
            const empty = count === 0 && preset.id !== 'all';
            return `<button type="button"
                        class="gpb-fchip${on ? ' on' : ''}${empty ? ' empty' : ''}"
                        data-gpb="filter" data-id="${preset.id}"
                        aria-pressed="${on ? 'true' : 'false'}">
                        <i class="fa-solid ${preset.icon}"></i>
                        <span class="gpb-fchip-label">${preset.label}</span>
                        ${count === null ? '' : `<span class="gpb-fchip-count">${count}</span>`}
                    </button>`;
        }).join('');
    }

    function refreshFilterChips() {
        const rail = panelEl?.querySelector('[data-gpb-rail]');
        if (rail) rail.innerHTML = filterChipsHtml();
    }

    // The dock's second meter: how many flights the rail is letting through,
    // against how many the window holds. Unfiltered the two are the same and
    // only one number is shown.
    function updateWindowCount() {
        const el = panelEl?.querySelector('#gpb-total');
        if (!el) return;
        el.textContent = String(visibleFlights.length);
        const of = panelEl.querySelector('#gpb-total-of');
        if (of) {
            of.textContent = (visibleFlights.length === flights.length) ? '' : ` / ${flights.length}`;
        }
    }

    function buildPanel() {
        destroyPanel();
        const ago = windowMeta ? fmtAgo(Date.now() - windowMeta.start) : '';

        panelEl = document.createElement('div');
        panelEl.id = 'global-playback-ui';
        panelEl.className = 'gpb-ui';
        panelEl.innerHTML = `
            <div class="gpb-rail">
                <div class="gpb-rail-track" data-gpb-rail>${filterChipsHtml()}</div>
                <div class="gpb-rail-pin">
                    <button type="button" class="gpb-bubble gpb-bubble-sm" data-gpb="rewindpicker"
                            title="Pick another moment" aria-label="Pick another moment">
                        <i class="fa-solid fa-calendar-day"></i>
                    </button>
                    <button type="button" class="gpb-bubble gpb-bubble-sm gpb-quit" data-gpb="close"
                            title="Leave replay (Esc)" aria-label="Leave replay">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <div class="gpb-left">
            <div class="gpb-card-host" id="gpb-card-host" aria-live="polite"></div>

            <section class="gpb-dock" aria-label="Playback transport">
                <header class="gpb-dock-head">
                    <div class="gpb-clock">
                        <span class="gpb-zulu" id="gpb-zulu">--:--Z</span>
                        <span class="gpb-date" id="gpb-date">—</span>
                    </div>
                    <span class="gpb-tag" id="gpb-ago">${escapeHtml(ago)}</span>
                </header>

                <div class="gpb-meters">
                    <div class="gpb-meter">
                        <span class="gpb-meter-val" id="gpb-airborne">0</span>
                        <span class="gpb-meter-key">airborne<span class="gpb-shown" id="gpb-shown"></span></span>
                    </div>
                    <div class="gpb-meter">
                        <span class="gpb-meter-val"><span id="gpb-total">0</span><span class="gpb-meter-of" id="gpb-total-of"></span></span>
                        <span class="gpb-meter-key">in window</span>
                    </div>
                </div>

                <div class="gpb-transport">
                    <button type="button" class="gpb-play" data-gpb="play" title="Play / pause (Space)" aria-label="Play or pause">
                        <i class="fa-solid fa-play"></i>
                    </button>
                    <div class="gpb-track">
                        <input type="range" class="gpb-range" id="gpb-range" min="0" max="1000" value="0" step="1"
                               aria-label="Playback position">
                        <div class="gpb-times">
                            <span id="gpb-elapsed">0:00</span>
                            <span id="gpb-duration">0:00</span>
                        </div>
                    </div>
                </div>

                <div class="gpb-speeds" id="gpb-speeds" role="group" aria-label="Playback speed">
                    ${SPEED_OPTIONS.map(s => `<button type="button" class="gpb-speed${s === speed ? ' on' : ''}" data-gpb="speed" data-speed="${s}">${s}×</button>`).join('')}
                </div>

                <div class="gpb-legend" aria-hidden="true">
                    <span class="gpb-legend-label">GND</span>
                    <span class="gpb-legend-ramp"></span>
                    <span class="gpb-legend-label">FL400</span>
                </div>
            </section>
            </div>

            <div class="gpb-bubbles" role="group" aria-label="Map overlays">
                <button type="button" class="gpb-bubble" data-gpb="weather" aria-pressed="false"
                        title="Rain radar" aria-label="Rain radar">
                    <i class="fa-solid fa-cloud-showers-heavy"></i>
                    <span class="gpb-bubble-name">Weather</span>
                </button>
                <button type="button" class="gpb-bubble" data-gpb="atc" aria-pressed="false"
                        title="ATC airspace" aria-label="ATC airspace">
                    <i class="fa-solid fa-tower-broadcast"></i>
                    <span class="gpb-bubble-name">ATC</span>
                </button>
                <button type="button" class="gpb-bubble${showTrails ? ' on' : ''}" data-gpb="trails"
                        aria-pressed="${showTrails ? 'true' : 'false'}" title="Trails (T)" aria-label="Trails">
                    <i class="fa-solid fa-wave-square"></i>
                    <span class="gpb-bubble-name">Trails</span>
                </button>
            </div>`;

        document.body.appendChild(panelEl);
        document.body.classList.add('gpb-mode');
        bindPanelEvents();
        syncOverlayBubbles();
        updateScrubber();
    }

    /* ---------- map overlays, driven through the app's own switches ---------- */

    // The rain radar belongs to flight.js — it owns the RainViewer source and
    // the frame it points at. Asking for it through the event the weather sheet
    // already fires means one implementation, and the sheet's own switch stays
    // truthful whichever surface flipped it.
    function setWeather(on) {
        weatherOn = !!on;
        try {
            window.dispatchEvent(new CustomEvent('weatherToggle', {
                detail: { type: 'precip', isActive: weatherOn }
            }));
        } catch (_) { /* nothing listening */ }
        const sheetSwitch = document.getElementById('weather-toggle-precip');
        if (sheetSwitch && sheetSwitch.checked !== weatherOn) sheetSwitch.checked = weatherOn;
        // Light the bubble now and check back afterwards. Turning the radar on
        // is a network fetch, so the layer does not exist for another moment —
        // and may never exist if RainViewer is down. Waiting for it would make
        // the button feel dead; not checking at all would leave it lying.
        paintBubbles();
        setTimeout(syncOverlayBubbles, 1500);
    }

    // Same reasoning for the FIR overlay: mapFilters is the app's state and
    // applyAtcBoundaryVisibility() builds the layers on demand, so this sets
    // the flag and lets the app do the work.
    function setAirspace(on) {
        airspaceOn = !!on;
        try {
            if (window.mapFilters) window.mapFilters.showAtcBoundaries = airspaceOn;
            if (typeof window.applyAtcBoundaryVisibility === 'function') {
                window.applyAtcBoundaryVisibility(map);
            }
        } catch (_) { /* boundaries unavailable on this style */ }
        const settingsSwitch = document.getElementById('set-atc-boundaries');
        if (settingsSwitch && settingsSwitch.checked !== airspaceOn) settingsSwitch.checked = airspaceOn;
        paintBubbles();
    }

    // Read the two overlays back off the app rather than trusting our own
    // copy: either can be flipped from Settings while the replay is up. Only
    // where the app can actually answer — a missing mapFilters means "unknown",
    // not "off", and reading it as off would blank a button the user just lit.
    function syncOverlayBubbles() {
        if (!panelEl) return;
        try { if (map && map.getLayer) weatherOn = !!map.getLayer('rainviewer-radar-layer'); } catch (_) {}
        try { if (window.mapFilters) airspaceOn = !!window.mapFilters.showAtcBoundaries; } catch (_) {}
        paintBubbles();
    }

    function paintBubbles() {
        if (!panelEl) return;
        const paint = (sel, on) => {
            const btn = panelEl.querySelector(sel);
            if (!btn) return;
            btn.classList.toggle('on', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        };
        paint('[data-gpb="weather"]', weatherOn);
        paint('[data-gpb="atc"]', airspaceOn);
        paint('[data-gpb="trails"]', showTrails);
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
                case 'weather': setWeather(!weatherOn); break;
                case 'atc': setAirspace(!airspaceOn); break;
                case 'deselect': selectFlight(selectedFlightId); break;
                case 'follow':
                    followSelected = !followSelected;
                    syncFollowButton();
                    if (followSelected) keepCameraOnSelection();
                    break;
                case 'trails':
                    showTrails = !showTrails;
                    try { localStorage.setItem(TRAILS_STORAGE_KEY, showTrails ? '1' : '0'); } catch (_) {}
                    paintBubbles();
                    renderFrame(true);
                    break;
                case 'rewindpicker':
                    // Back to the picker without tearing the map down twice —
                    // the layers go, the session stays open.
                    pause();
                    teardownPlayback();
                    buildPicker();
                    break;
                case 'filter': {
                    const id = target.dataset.id;
                    if (id === 'all') {
                        activeFilters = new Set(['all']);
                    } else {
                        activeFilters.delete('all');
                        if (activeFilters.has(id)) activeFilters.delete(id);
                        else activeFilters.add(id);
                        // Turning the last preset off is a request to see
                        // everything again, not a request for an empty map.
                        if (!activeFilters.size) activeFilters.add('all');
                    }
                    saveFilters();
                    applyFilters();
                    // Filtering away the aircraft whose card is open would
                    // leave a card describing something no longer on the map.
                    if (selectedFlightId && !visibleFlights.some(f => f.flightId === selectedFlightId)) {
                        selectedFlightId = null;
                        followSelected = false;
                        buildInfoCard();
                    }
                    refreshFilterChips();
                    updateWindowCount();
                    renderFrame(true);
                    break;
                }
                case 'speed': {
                    speed = Number(target.dataset.speed) || DEFAULT_SPEED;
                    try { localStorage.setItem(SPEED_STORAGE_KEY, String(speed)); } catch (_) {}
                    panelEl.querySelectorAll('[data-gpb="speed"]').forEach(el => el.classList.remove('on'));
                    target.classList.add('on');
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
        try { document.body.classList.remove('gpb-mode'); } catch (_) {}
        if (!panelEl) return;
        try { panelEl.remove(); } catch (_) {}
        panelEl = null;
    }

    function setPlayIcon() {
        const btn = panelEl?.querySelector('.gpb-play');
        if (!btn) return;
        btn.classList.toggle('playing', isPlaying);
        const icon = btn.querySelector('i');
        if (icon) icon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    }

    function updateScrubber() {
        if (!panelEl) return;
        const pct = totalDurationMs ? (currentMs / totalDurationMs) : 0;
        const range = panelEl.querySelector('#gpb-range');
        if (range) {
            if (!isScrubbing) range.value = String(Math.round(pct * 1000));
            // The filled part of the track is painted from this rather than
            // from a second element, so the fill can never lag the thumb.
            range.style.setProperty('--gpb-progress', `${(pct * 100).toFixed(2)}%`);
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

    /* =========================
     * Flight card
     * =========================
     * Tap an aircraft and the replay says what it was: who was flying it, what
     * they were flying, and what it was doing at this instant of the recording.
     *
     * The live flight window cannot be reused for this. It is built around a
     * flightId that is still being polled — photos, the live route, the ATC
     * frequencies in range — and none of that exists for a flight that landed
     * two weeks ago. So the card shows what the recording actually holds, and
     * says nothing it cannot support.
     *
     * Rebuilt only when the selection changes; the numbers are patched in place
     * every frame, because innerHTML thirty times a second on a card the user
     * is reading is both a re-layout and a lost text selection.
     */

    const CARD_NOW = makePosition();
    const CARD_THEN = makePosition();
    const VS_SAMPLE_MS = 60 * 1000;    // session time, so it reads as feet per minute

    // Cumulative track distance, in nautical miles, computed once per flight
    // the first time its card is opened. A few hundred points on a tap is
    // nothing; the same work per frame for every aircraft would not be.
    function ensureCumulative(f) {
        if (f.cumNm) return f.cumNm;
        const pts = f.points;
        const cum = new Float64Array(pts.length);
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const dLat = b.lat - a.lat;
            const dLon = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
            cum[i] = cum[i - 1] + Math.hypot(dLat, dLon) * 60;
        }
        f.cumNm = cum;
        return cum;
    }

    function relationLabel(relation) {
        if (relation === 'user') return 'Your flight';
        if (relation === 'watchlist') return 'Watchlist';
        return '';
    }

    function selectFlight(id) {
        selectedFlightId = (selectedFlightId === id) ? null : id;
        if (!selectedFlightId) followSelected = false;
        buildInfoCard();
        renderFrame(true);
    }

    function buildInfoCard() {
        const host = panelEl?.querySelector('#gpb-card-host');
        if (!host) return;

        const f = selectedFlightId ? flightsById.get(selectedFlightId) : null;
        if (!f) { host.innerHTML = ''; host.classList.remove('open'); return; }

        const relation = f.pilotRelation && f.pilotRelation !== 'none' ? f.pilotRelation : '';
        const badge = relationLabel(f.pilotRelation);
        const accent = pathColorFor(f);

        host.innerHTML = `
            <article class="gpb-card${relation ? ` rel-${relation}` : ''}" style="--gpb-card-accent:${accent}">
                <header class="gpb-card-head">
                    <div class="gpb-card-id">
                        <span class="gpb-card-call">${escapeHtml(f.callsign || '----')}</span>
                        ${badge ? `<span class="gpb-card-badge">${escapeHtml(badge)}</span>` : ''}
                    </div>
                    <div class="gpb-card-head-btns">
                        <button type="button" class="gpb-card-btn" data-gpb="follow" aria-pressed="false"
                                title="Keep the camera on this aircraft (F)" aria-label="Follow">
                            <i class="fa-solid fa-crosshairs"></i>
                        </button>
                        <button type="button" class="gpb-card-btn" data-gpb="deselect"
                                title="Close" aria-label="Close flight card">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </header>

                <div class="gpb-card-sub">
                    ${f.username ? `<span class="gpb-card-pilot">${escapeHtml(f.username)}</span>` : ''}
                    ${f.aircraftName ? `<span class="gpb-card-type">${escapeHtml(f.aircraftName)}</span>` : ''}
                </div>

                <div class="gpb-card-stats">
                    <div class="gpb-card-stat"><span id="gpb-card-alt">—</span><small>ALT FT</small></div>
                    <div class="gpb-card-stat"><span id="gpb-card-gs">—</span><small>GS KT</small></div>
                    <div class="gpb-card-stat"><span id="gpb-card-hdg">—</span><small>HDG</small></div>
                    <div class="gpb-card-stat"><span id="gpb-card-vs">—</span><small>V/S FPM</small></div>
                </div>

                <div class="gpb-card-track">
                    <div class="gpb-card-trackbar"><span id="gpb-card-trackfill"></span></div>
                    <div class="gpb-card-trackrow">
                        <span>${fmtZulu(f.t0)}</span>
                        <span id="gpb-card-flown">—</span>
                        <span>${fmtZulu(f.t1)}</span>
                    </div>
                </div>
            </article>`;
        host.classList.add('open');
        syncFollowButton();
    }

    function updateInfoCard(absT) {
        if (!selectedFlightId || !panelEl) return;
        const f = flightsById.get(selectedFlightId);
        if (!f) return;

        const set = (id, text) => {
            const el = panelEl.querySelector(id);
            if (el && el.textContent !== text) el.textContent = text;
        };

        const now = positionAt(f, absT, CARD_NOW);
        if (!now) {
            // Between the ends of its own track, or inside a hole in the
            // recording. The card stays — it is still the flight you picked —
            // but it stops asserting numbers it does not have.
            ['#gpb-card-alt', '#gpb-card-gs', '#gpb-card-hdg', '#gpb-card-vs'].forEach(id => set(id, '—'));
            return;
        }

        set('#gpb-card-alt', Math.round(now.alt).toLocaleString());
        set('#gpb-card-gs', String(Math.round(now.gs)));
        set('#gpb-card-hdg', `${String(Math.round(now.hdg)).padStart(3, '0')}°`);

        const then = positionAt(f, absT - VS_SAMPLE_MS, CARD_THEN);
        if (then) {
            const fpm = Math.round((now.alt - then.alt) / (VS_SAMPLE_MS / 60000));
            set('#gpb-card-vs', (fpm > 0 ? '+' : '') + fpm.toLocaleString());
        } else {
            set('#gpb-card-vs', '—');
        }

        // Progress through this flight's own track, which is not the same as
        // progress through the window — most flights start and end inside it.
        const span = Math.max(1, f.t1 - f.t0);
        const pct = Math.max(0, Math.min(1, (absT - f.t0) / span));
        const fill = panelEl.querySelector('#gpb-card-trackfill');
        if (fill) fill.style.width = `${(pct * 100).toFixed(1)}%`;

        const cum = ensureCumulative(f);
        const idx = Math.min(f.points.length - 1, firstIndexAtOrAfter(f.points, absT));
        set('#gpb-card-flown', `${Math.round(cum[idx]).toLocaleString()} nm flown`);
    }

    function syncFollowButton() {
        const btn = panelEl?.querySelector('[data-gpb="follow"]');
        if (!btn) return;
        btn.classList.toggle('on', followSelected);
        btn.setAttribute('aria-pressed', followSelected ? 'true' : 'false');
    }

    // Recentre without fighting the user: a pan or a zoom is a decision, and a
    // camera that snaps back from it is worse than one that never followed.
    // easeTo with a short duration keeps up with 600× without teleporting.
    function keepCameraOnSelection() {
        if (!map || !selectedFlightId) return;
        const f = flightsById.get(selectedFlightId);
        if (!f) return;
        const p = positionAt(f, spanStart + currentMs, CARD_NOW);
        if (!p) return;
        try {
            map.easeTo({ center: [p.lon, p.lat], duration: 260, essential: true });
        } catch (_) { /* camera busy */ }
    }

    function bindKeys() {
        unbindKeys();
        onKeyDown = (e) => {
            if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
            // Escape backs out one step at a time: a card you opened by tapping
            // an aircraft should not take the whole replay down with it.
            if (e.key === 'Escape') {
                e.preventDefault();
                if (selectedFlightId) selectFlight(selectedFlightId);
                else close();
                return;
            }
            if (!panelEl) return;
            if ((e.key === 'f' || e.key === 'F') && selectedFlightId) {
                const btn = panelEl.querySelector('[data-gpb="follow"]');
                if (btn) btn.click();
                return;
            }
            if (e.code === 'Space') { e.preventDefault(); isPlaying ? pause() : play(); return; }
            if (e.key === 't' || e.key === 'T') {
                const btn = panelEl.querySelector('[data-gpb="trails"]');
                if (btn) btn.click();
                return;
            }
            if (e.key === 'w' || e.key === 'W') { setWeather(!weatherOn); return; }
            if (e.key === 'a' || e.key === 'A') { setAirspace(!airspaceOn); return; }
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
            // Which filter-rail presets this flight belongs to. Resolved here,
            // once, so the rail costs a bitwise AND per aircraft rather than a
            // string scan.
            classMask: classifyFlight(f.aircraft?.aircraftName, f.callsign),
            // Resolved once per flight rather than per frame: it depends on the
            // signed-in pilot and their watchlist, neither of which moves while
            // a window is playing. Recomputed on sign-in or a watchlist change
            // by refreshPilotRelations() below.
            pilotRelation: pilotRelationFor(f.username),
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

        classCounts = countClasses();
        applyFilters();

        buildPanel();
        hideLoading();
        updateWindowCount();

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
        visibleFlights = [];
        classCounts = null;
        flightsById = new Map();
        // The pools themselves are kept: a session that opens a second window
        // reuses the features the first one warmed up, and the arrays inside
        // them, rather than starting the allocation over.
        planeList.length = 0;
        trailList.length = 0;
        pathList.length = 0;
        chosenCount = 0;
        thinGeneration++;

        windowMeta = null;
        spanStart = 0;
        totalDurationMs = 0;
        currentMs = 0;
        isScrubbing = false;
        selectedFlightId = null;
        followSelected = false;

        // Reset the rate limiter with the session. The next window may be a
        // quiet one on a fast device, and it should not inherit a slow window's
        // measured cost and open at a throttled rate for no reason.
        lastPlanePush = 0;
        frameCostEMA = 3;
        pushIntervalMs = TARGET_PUSH_INTERVAL_MS;
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
        loadSavedFilters();

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

        /* =====================================================================
         * Replay mode — palette
         * =====================================================================
         * The app's own, not one of its own invention. Every other surface in
         * the tracker — the info windows, the mobile island, atcReplay's panel —
         * is neutral dark glass with sky-blue as the "this is on" colour and
         * gold reserved for Pro, and the replay used to be the one screen that
         * wasn't. The values below are the same ones :root and the iOS chrome
         * publish (--bg-glass, --color-brand, --text-secondary, the 8/12/16
         * radii); they are restated as --gpb-* rather than consumed directly so
         * the chrome still renders standalone in tools/gpb-chrome-harness.html,
         * where flight.js's :root is not on the page.
         *
         * The one thing not drawn from this palette is the altitude ramp on the
         * trails. That is data, not chrome, and it is shared with flightReplay
         * and atcReplay so a track reads the same in all three.
         * ------------------------------------------------------------------ */
        .gpb-ui, .gpb-picker, #global-playback-loading, .gpb-popup {
            --gpb-shell:      rgba(24,26,32,0.94);
            --gpb-shell-2:    rgba(38,41,48,0.72);
            --gpb-raise:      rgba(255,255,255,0.06);
            --gpb-raise-2:    rgba(255,255,255,0.12);
            --gpb-line:       rgba(255,255,255,0.10);
            --gpb-line-2:     rgba(255,255,255,0.20);
            --gpb-text:       #fafafa;
            --gpb-dim:        #a1a1aa;
            --gpb-faint:      #71717a;
            /* Sky is the brand accent (--color-brand), indigo the far end of
               the same gradient atcReplay draws its frequency bars in. */
            --gpb-accent:     #38bdf8;
            --gpb-accent-2:   #6366f1;
            --gpb-on-accent:  #0b1220;
            --gpb-accent-soft: rgba(56,189,248,0.12);
            --gpb-accent-line: rgba(56,189,248,0.32);
            --gpb-glow:       rgba(56,189,248,0.28);
            /* Gold means Pro here and everywhere else (.res-pro-badge). */
            --gpb-gold:       #fbbf24;
            --gpb-gold-soft:  rgba(251,191,36,0.12);
            --gpb-gold-line:  rgba(251,191,36,0.32);
            --gpb-red:        #ef4444;
            --gpb-blur:       saturate(180%) blur(24px);
            --gpb-lift:       0 18px 44px rgba(0,0,0,0.5), inset 0 0.5px 0 rgba(255,255,255,0.10);
            --gpb-r-sm:       8px;
            --gpb-r-md:       12px;
            --gpb-r-lg:       16px;
            font-family: var(--font-ui, 'Inter', system-ui, -apple-system, sans-serif);
        }
        /* The clock, the counts and the timings are readings, so they are set
           in the app's data face like every other readout in the tracker. */
        .gpb-zulu, .gpb-meter-val, .gpb-times, .gpb-card-call,
        .gpb-card-stat span, .gpb-card-trackrow, .gpb-speed, .gpb-hint,
        .gpb-pop-nums, .gpb-fchip-count {
            font-family: var(--font-data, 'JetBrains Mono', ui-monospace, monospace);
        }

        /* =====================================================================
         * The mode takes the screen
         * =====================================================================
         * Replay is a mode, not a panel. While it is up the app's own chrome
         * stands down, so the rail owns the top, the dock owns the left and the
         * bubbles own the bottom right without two bottom bars fighting for the
         * same thumb. Purely declarative, so closing the replay puts every one
         * of them back by removing a single class.
         * ------------------------------------------------------------------ */
        body.gpb-mode #ios-landing-topbar,
        body.gpb-mode #ios-landing-tabbar,
        body.gpb-mode #ios-traffic-rail,
        body.gpb-mode #ios-map-bubbles,
        body.gpb-mode .tactical-header,
        body.gpb-mode .utility-nexus,
        body.gpb-mode .auth-nexus {
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
            transition: opacity .22s ease, visibility .22s ease;
        }

        /* =====================================================================
         * Root
         * ===================================================================== */
        .gpb-ui {
            position: fixed; inset: 0; z-index: 4100;
            pointer-events: none;                 /* the map still takes gestures */
            color: var(--gpb-text);
            -webkit-font-smoothing: antialiased;
        }
        .gpb-ui button { font-family: inherit; }
        .gpb-ui :focus-visible { outline: 2px solid var(--gpb-accent); outline-offset: 2px; }

        /* =====================================================================
         * Filter rail — the top edge
         * ===================================================================== */
        .gpb-rail {
            position: absolute;
            top: calc(env(safe-area-inset-top, 0px) + 12px);
            left: 12px; right: 12px;
            display: flex; align-items: center; gap: 8px;
            pointer-events: none;
        }
        .gpb-rail-track {
            flex: 1 1 auto; min-width: 0;
            display: flex; align-items: center; gap: 7px;
            overflow-x: auto; overflow-y: hidden;
            padding: 2px 26px 2px 2px;
            pointer-events: auto;
            scrollbar-width: none;
            -webkit-overflow-scrolling: touch;
        }
        /* Fade the chips out into the pinned controls rather than letting them
           slide under and collide with them. Only where the rail can actually
           overflow — above this the chips all fit and a fade would be dimming
           the last one for nothing. */
        @media (max-width: 1150px) {
            .gpb-rail-track {
                -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 30px), transparent);
                mask-image: linear-gradient(90deg, #000 calc(100% - 30px), transparent);
            }
        }
        .gpb-rail-track::-webkit-scrollbar { display: none; }
        .gpb-rail-pin { display: flex; gap: 7px; flex: 0 0 auto; pointer-events: auto; }

        .gpb-fchip {
            flex: 0 0 auto;
            display: inline-flex; align-items: center; gap: 7px;
            height: 36px; padding: 0 14px; border-radius: 999px;
            background: var(--gpb-shell); -webkit-backdrop-filter: var(--gpb-blur); backdrop-filter: var(--gpb-blur);
            border: 1px solid var(--gpb-line); color: var(--gpb-dim);
            font-size: 13px; font-weight: 650; letter-spacing: -0.01em; white-space: nowrap;
            cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,0.35);
            transition: color .16s ease, background .16s ease, border-color .16s ease, transform .16s ease;
        }
        .gpb-fchip i { font-size: 11.5px; opacity: .85; }
        .gpb-fchip:hover { color: var(--gpb-text); border-color: var(--gpb-line-2); }
        .gpb-fchip:active { transform: scale(0.96); }
        .gpb-fchip.on {
            background: linear-gradient(135deg, var(--gpb-accent), var(--gpb-accent-2));
            border-color: transparent; color: var(--gpb-on-accent); font-weight: 750;
            box-shadow: 0 8px 22px var(--gpb-glow);
        }
        .gpb-fchip.on i { opacity: 1; }
        .gpb-fchip.empty:not(.on) { color: var(--gpb-faint); opacity: .55; }
        .gpb-fchip-count {
            font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
            padding: 1px 6px; border-radius: 999px;
            background: var(--gpb-raise-2); color: var(--gpb-faint);
        }
        .gpb-fchip.on .gpb-fchip-count { background: rgba(11,18,32,0.22); color: var(--gpb-on-accent); }

        /* =====================================================================
         * Bubbles — overlays, bottom right (and the two pinned to the rail)
         * ===================================================================== */
        .gpb-bubbles {
            position: absolute;
            right: 14px;
            bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
            display: flex; flex-direction: column; gap: 10px;
            pointer-events: auto;
        }
        .gpb-bubble {
            position: relative;
            width: 48px; height: 48px; border-radius: 50%;
            display: grid; place-items: center;
            background: var(--gpb-shell); -webkit-backdrop-filter: var(--gpb-blur); backdrop-filter: var(--gpb-blur);
            border: 1px solid var(--gpb-line); color: var(--gpb-dim);
            font-size: 16px; cursor: pointer;
            box-shadow: var(--gpb-lift);
            transition: color .16s ease, background .16s ease, border-color .16s ease, transform .16s ease;
        }
        .gpb-bubble:hover { color: var(--gpb-text); border-color: var(--gpb-line-2); }
        .gpb-bubble:active { transform: scale(0.93); }
        .gpb-bubble.on {
            background: linear-gradient(140deg, var(--gpb-accent), var(--gpb-accent-2));
            border-color: transparent; color: var(--gpb-on-accent);
            box-shadow: 0 10px 26px var(--gpb-glow);
        }
        .gpb-bubble-sm { width: 36px; height: 36px; font-size: 13px; }
        .gpb-quit:hover { color: var(--gpb-red); border-color: rgba(239,68,68,0.45); }

        /* The label rides out of the bubble on hover, so a pointer user gets a
           name without three permanent captions cluttering the corner and a
           touch user gets a clean circle. */
        .gpb-bubble-name {
            position: absolute; right: calc(100% + 9px); top: 50%; transform: translateY(-50%) translateX(6px);
            padding: 5px 10px; border-radius: 8px; white-space: nowrap;
            background: var(--gpb-shell); border: 1px solid var(--gpb-line);
            color: var(--gpb-text); font-size: 11.5px; font-weight: 650;
            opacity: 0; pointer-events: none;
            transition: opacity .16s ease, transform .16s ease;
        }
        @media (hover: hover) {
            .gpb-bubble:hover .gpb-bubble-name { opacity: 1; transform: translateY(-50%) translateX(0); }
        }

        /* =====================================================================
         * Transport dock — the left edge
         * ===================================================================== */
        .gpb-dock {
            width: 100%; box-sizing: border-box;
            padding: 15px 16px 14px;
            display: flex; flex-direction: column; gap: 13px;
            border-radius: 18px;
            background: var(--gpb-shell);
            -webkit-backdrop-filter: var(--gpb-blur); backdrop-filter: var(--gpb-blur);
            border: 1px solid var(--gpb-line);
            box-shadow: var(--gpb-lift);
            pointer-events: auto;
        }

        .gpb-dock-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .gpb-clock { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .gpb-zulu {
            font-size: 30px; font-weight: 800; line-height: 1;
            letter-spacing: -0.025em; color: var(--gpb-text);
            font-variant-numeric: tabular-nums;
        }
        .gpb-date {
            font-size: 10.5px; font-weight: 700; letter-spacing: 0.1em;
            text-transform: uppercase; color: var(--gpb-faint);
        }
        .gpb-tag {
            flex: 0 0 auto;
            padding: 4px 9px; border-radius: 999px;
            background: var(--gpb-accent-soft); border: 1px solid var(--gpb-accent-line);
            color: var(--gpb-accent); font-size: 10.5px; font-weight: 750;
            letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap;
        }

        .gpb-meters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .gpb-meter {
            display: flex; flex-direction: column; gap: 2px;
            padding: 8px 10px; border-radius: var(--gpb-r-md);
            background: var(--gpb-raise); border: 1px solid var(--gpb-line);
        }
        .gpb-meter-val {
            font-size: 17px; font-weight: 800; line-height: 1;
            color: var(--gpb-text); font-variant-numeric: tabular-nums;
        }
        .gpb-meter-of { font-size: 12px; font-weight: 600; color: var(--gpb-faint); }
        .gpb-meter-key {
            font-size: 9.5px; font-weight: 700; letter-spacing: 0.09em;
            text-transform: uppercase; color: var(--gpb-faint);
        }
        .gpb-shown { text-transform: none; letter-spacing: 0; }

        .gpb-transport { display: flex; align-items: center; gap: 13px; }
        .gpb-play {
            flex: 0 0 auto; width: 50px; height: 50px; border-radius: 50%;
            display: grid; place-items: center; cursor: pointer; border: none;
            background: linear-gradient(140deg, var(--gpb-accent), var(--gpb-accent-2));
            color: var(--gpb-on-accent); font-size: 17px;
            box-shadow: 0 10px 26px var(--gpb-glow);
            transition: transform .16s ease, box-shadow .16s ease;
        }
        .gpb-play:hover { transform: scale(1.05); }
        .gpb-play:active { transform: scale(0.95); }
        /* Sitting still is the state worth marking: a paused replay looks like
           a broken one otherwise. */
        .gpb-play.playing { box-shadow: 0 10px 26px rgba(56,189,248,0.18); }
        .gpb-play i { margin-left: 1px; }
        .gpb-play.playing i { margin-left: 0; }

        .gpb-track { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
        .gpb-range {
            -webkit-appearance: none; appearance: none;
            width: 100%; height: 6px; border-radius: 999px; cursor: pointer;
            background: linear-gradient(90deg,
                var(--gpb-accent) 0%,
                var(--gpb-accent-2) var(--gpb-progress, 0%),
                rgba(255,255,255,0.15) var(--gpb-progress, 0%));
        }
        .gpb-range::-webkit-slider-thumb {
            -webkit-appearance: none; appearance: none;
            width: 16px; height: 16px; border-radius: 50%;
            background: #fff; border: 2px solid var(--gpb-accent);
            box-shadow: 0 2px 8px rgba(0,0,0,0.55); cursor: grab;
        }
        .gpb-range::-moz-range-thumb {
            width: 14px; height: 14px; border-radius: 50%;
            background: #fff; border: 2px solid var(--gpb-accent);
            box-shadow: 0 2px 8px rgba(0,0,0,0.55); cursor: grab;
        }
        .gpb-range::-moz-range-track { background: transparent; height: 6px; }
        .gpb-times {
            display: flex; justify-content: space-between;
            font-size: 10.5px; font-weight: 650; color: var(--gpb-faint);
            font-variant-numeric: tabular-nums;
        }

        /* One segmented control rather than five loose buttons: the speeds are
           a single choice and they should look like one. */
        .gpb-speeds {
            display: flex; gap: 3px; padding: 3px; border-radius: var(--gpb-r-md);
            background: var(--gpb-raise); border: 1px solid var(--gpb-line);
        }
        .gpb-speed {
            flex: 1 1 0; min-width: 0; padding: 7px 0; border: none; border-radius: var(--gpb-r-sm);
            background: transparent; color: var(--gpb-faint); cursor: pointer;
            font-size: 11.5px; font-weight: 750; font-variant-numeric: tabular-nums;
            transition: background .15s ease, color .15s ease;
        }
        .gpb-speed:hover { color: var(--gpb-text); background: var(--gpb-raise-2); }
        .gpb-speed.on {
            background: linear-gradient(135deg, var(--gpb-accent), var(--gpb-accent-2));
            color: var(--gpb-on-accent);
        }

        .gpb-legend { display: flex; align-items: center; gap: 8px; }
        .gpb-legend-ramp {
            flex: 1 1 auto; height: 4px; border-radius: 3px;
            background: linear-gradient(90deg,
                rgb(56,189,248) 0%, rgb(45,212,191) 25%, rgb(163,230,53) 50%,
                rgb(250,204,21) 75%, rgb(248,113,113) 100%);
        }
        .gpb-legend-label {
            font-size: 9px; font-weight: 700; letter-spacing: 0.09em;
            color: var(--gpb-faint); text-transform: uppercase;
        }

        /* =====================================================================
         * Flight card — what the recording holds about the one you tapped
         * =====================================================================
         * Sits directly above the transport, in the same left column, so the
         * thing you selected and the clock you selected it at read as one
         * panel rather than two floating cards.
         * ------------------------------------------------------------------ */
        /* The card and the transport are one bottom-anchored column, not two
           free-floating cards. Stacking them in a flex column rather than
           positioning each means the card sits on top of whatever height the
           dock happens to be — which changes with the viewport and with the
           rules that drop the counts and the legend on a short screen. */
        .gpb-left {
            position: absolute;
            left: 20px;
            bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
            width: 340px; box-sizing: border-box;
            display: flex; flex-direction: column; justify-content: flex-end;
            gap: 10px;
            max-height: calc(100vh - 96px);
            max-height: calc(100dvh - 96px);
            pointer-events: none;
        }
        .gpb-left > * { pointer-events: auto; }
        .gpb-card-host { min-width: 0; pointer-events: none; }
        .gpb-card-host.open { pointer-events: auto; }
        .gpb-card {
            padding: 14px 15px 13px;
            border-radius: 18px;
            background: var(--gpb-shell);
            -webkit-backdrop-filter: var(--gpb-blur); backdrop-filter: var(--gpb-blur);
            border: 1px solid var(--gpb-line);
            box-shadow: var(--gpb-lift);
            display: flex; flex-direction: column; gap: 11px;
            /* The accent is the aircraft's own colour: your orange, a friend's
               violet, or the selection sky — the same colour its route is
               drawn in, so the card and the line on the map are obviously the
               same aircraft. */
            border-top: 2px solid var(--gpb-card-accent, var(--gpb-accent));
        }
        .gpb-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
        .gpb-card-id { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
        .gpb-card-call {
            font-size: 20px; font-weight: 800; letter-spacing: -0.02em;
            color: var(--gpb-text); line-height: 1;
        }
        .gpb-card-badge {
            font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
            padding: 3px 7px; border-radius: 999px;
            color: var(--gpb-card-accent, var(--gpb-accent));
            background: color-mix(in srgb, var(--gpb-card-accent, #38bdf8) 16%, transparent);
            border: 1px solid color-mix(in srgb, var(--gpb-card-accent, #38bdf8) 40%, transparent);
        }
        .gpb-card-head-btns { display: flex; gap: 6px; flex: 0 0 auto; }
        .gpb-card-btn {
            width: 30px; height: 30px; border-radius: var(--gpb-r-sm); cursor: pointer;
            display: grid; place-items: center; font-size: 12px;
            background: var(--gpb-raise); border: 1px solid var(--gpb-line); color: var(--gpb-dim);
            transition: color .15s ease, background .15s ease, border-color .15s ease;
        }
        .gpb-card-btn:hover { color: var(--gpb-text); border-color: var(--gpb-line-2); }
        .gpb-card-btn.on {
            background: var(--gpb-card-accent, var(--gpb-accent)); border-color: transparent; color: var(--gpb-on-accent);
        }
        .gpb-card-sub { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: -4px; }
        .gpb-card-pilot { font-size: 12px; font-weight: 700; color: var(--gpb-card-accent, var(--gpb-accent)); }
        .gpb-card-type { font-size: 12px; color: var(--gpb-faint); }

        .gpb-card-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
        .gpb-card-stat {
            display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
            padding: 7px 8px; border-radius: var(--gpb-r-md);
            background: var(--gpb-raise); border: 1px solid var(--gpb-line);
        }
        .gpb-card-stat span {
            font-size: 14px; font-weight: 800; line-height: 1;
            color: var(--gpb-text); font-variant-numeric: tabular-nums;
        }
        .gpb-card-stat small {
            font-size: 8.5px; font-weight: 700; letter-spacing: 0.07em;
            text-transform: uppercase; color: var(--gpb-faint);
        }

        /* Where this aircraft is within its OWN track, which is rarely the
           whole window — most flights start or finish inside it. */
        .gpb-card-track { display: flex; flex-direction: column; gap: 5px; }
        .gpb-card-trackbar {
            height: 3px; border-radius: 999px; overflow: hidden;
            background: rgba(255,255,255,0.13);
        }
        .gpb-card-trackbar span {
            display: block; height: 100%; width: 0%;
            background: var(--gpb-card-accent, var(--gpb-accent));
            transition: width .12s linear;
        }
        .gpb-card-trackrow {
            display: flex; justify-content: space-between; gap: 8px;
            font-size: 10px; font-weight: 650; color: var(--gpb-faint);
            font-variant-numeric: tabular-nums;
        }

        /* =====================================================================
         * Hover card
         * ===================================================================== */
        .gpb-popup .mapboxgl-popup-content {
            background: var(--gpb-shell); -webkit-backdrop-filter: var(--gpb-blur); backdrop-filter: var(--gpb-blur);
            border: 1px solid var(--gpb-line); border-radius: var(--gpb-r-md);
            padding: 10px 13px; color: var(--gpb-text); font-size: 12px;
            box-shadow: var(--gpb-lift);
        }
        .gpb-popup .mapboxgl-popup-tip { display: none; }
        .gpb-pop-call { font-size: 14.5px; font-weight: 800; letter-spacing: -0.01em; color: var(--gpb-text); }
        .gpb-pop-user { font-size: 11px; font-weight: 650; color: var(--gpb-accent); margin-top: 1px; }
        .gpb-pop-type { font-size: 11px; color: var(--gpb-faint); margin-top: 1px; }
        .gpb-pop-nums {
            display: flex; gap: 10px; margin-top: 6px;
            font-variant-numeric: tabular-nums; color: var(--gpb-dim); font-weight: 650;
        }

        /* =====================================================================
         * Picker — choosing the moment
         * ===================================================================== */
        .gpb-picker { position: fixed; inset: 0; z-index: 4200; display: flex; align-items: center; justify-content: center; }
        .gpb-picker-backdrop {
            position: absolute; inset: 0;
            background: rgba(8,10,14,0.72);
            -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
        }
        /* A column of three: a grip (phones only), one scrolling region, and a
           footer that stays put. The card itself never scrolls — sizing the
           scroll to the card rather than the card to its contents is what keeps
           the whole thing inside the viewport at any height. */
        .gpb-picker-card {
            position: relative; width: min(560px, calc(100vw - 32px));
            display: flex; flex-direction: column;
            max-height: calc(100vh - 48px);
            /* dvh, so the mobile URL bar counts against the height it actually
               leaves rather than the height the page wishes it had. */
            max-height: min(calc(100dvh - 48px), 780px);
            overflow: hidden;
            background: var(--gpb-shell);
            -webkit-backdrop-filter: var(--gpb-blur); backdrop-filter: var(--gpb-blur);
            border: 1px solid var(--gpb-line); border-radius: var(--gpb-r-lg);
            color: var(--gpb-text);
            box-shadow: 0 34px 90px rgba(0,0,0,0.6), inset 0 0.5px 0 rgba(255,255,255,0.10);
            /* The datetime field opens a browser-drawn calendar. Without this
               it opens white, on a card that is not. */
            color-scheme: dark;
        }
        .gpb-picker-body {
            flex: 1 1 auto; min-height: 0;
            overflow-y: auto; overscroll-behavior: contain;
            -webkit-overflow-scrolling: touch;
            padding: 26px 26px 6px;
        }
        .gpb-picker-foot {
            flex: 0 0 auto;
            display: flex; flex-direction: column; gap: 12px;
            padding: 14px 26px calc(18px + env(safe-area-inset-bottom, 0px));
            border-top: 1px solid var(--gpb-line);
            background: var(--gpb-shell-2);
        }
        /* Only a sheet has something to grab. */
        .gpb-picker-grip { display: none; }
        .gpb-picker-close {
            position: absolute; top: 14px; right: 14px; width: 34px; height: 34px;
            z-index: 1;
            border: 1px solid var(--gpb-line); border-radius: 50%; cursor: pointer;
            background: var(--gpb-raise); color: var(--gpb-dim); font-size: 14px;
            display: grid; place-items: center;
        }
        .gpb-picker-close:hover { color: var(--gpb-red); border-color: rgba(239,68,68,0.4); }
        .gpb-eyebrow {
            font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase;
            color: var(--gpb-accent); font-weight: 800;
        }
        .gpb-picker-head { padding-right: 42px; }
        .gpb-title { margin: 8px 0 5px; font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: var(--gpb-text); }
        .gpb-sub { margin: 0 0 14px; font-size: 13px; color: var(--gpb-dim); line-height: 1.55; }
        .gpb-sub b { color: var(--gpb-text); }
        .gpb-tier-badge {
            display: inline-flex; align-items: center; gap: 7px;
            font-size: 11.5px; font-weight: 700; padding: 6px 12px; border-radius: 999px;
            background: var(--gpb-raise); color: var(--gpb-dim); border: 1px solid var(--gpb-line);
        }
        .gpb-tier-pro .gpb-tier-badge {
            background: var(--gpb-gold-soft); color: var(--gpb-gold); border-color: var(--gpb-gold-line);
        }
        .gpb-field { margin-top: 22px; }
        .gpb-label {
            display: block; font-size: 10.5px; font-weight: 800; text-transform: uppercase;
            letter-spacing: 0.11em; color: var(--gpb-faint); margin-bottom: 10px;
        }
        .gpb-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .gpb-chip {
            border: 1px solid var(--gpb-line); background: var(--gpb-raise);
            color: var(--gpb-dim); border-radius: 999px; padding: 9px 15px;
            font-size: 13px; font-weight: 650; cursor: pointer; font-family: inherit;
            transition: all .15s ease;
        }
        .gpb-chip:hover { border-color: var(--gpb-accent-line); color: var(--gpb-text); background: var(--gpb-accent-soft); }
        .gpb-chip.active {
            background: linear-gradient(135deg, var(--gpb-accent), var(--gpb-accent-2));
            border-color: transparent; color: var(--gpb-on-accent); font-weight: 750;
        }
        .gpb-chip.locked { color: var(--gpb-faint); border-style: dashed; }
        .gpb-chip.locked i { color: var(--gpb-gold); margin-left: 4px; font-size: 11px; }
        .gpb-chip.locked:hover { background: var(--gpb-gold-soft); border-color: var(--gpb-gold-line); color: var(--gpb-gold); }
        .gpb-input {
            width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: var(--gpb-r-md);
            background: rgba(0,0,0,0.30); border: 1px solid var(--gpb-line);
            color: var(--gpb-text); font-size: 14px; font-family: inherit;
        }
        .gpb-input:focus { outline: none; border-color: var(--gpb-accent); box-shadow: 0 0 0 3px var(--gpb-accent-soft); }
        .gpb-hint { margin-top: 7px; font-size: 12px; color: var(--gpb-faint); font-variant-numeric: tabular-nums; }
        .gpb-upsell {
            display: flex; align-items: center; gap: 12px; width: 100%;
            padding: 13px 14px; border-radius: var(--gpb-r-md); cursor: pointer; text-align: left;
            background: var(--gpb-gold-soft);
            border: 1px solid var(--gpb-gold-line); color: var(--gpb-gold); font-family: inherit;
        }
        .gpb-upsell:hover { border-color: rgba(251,191,36,0.58); }
        .gpb-upsell > i:first-child { font-size: 18px; color: var(--gpb-gold); }
        .gpb-upsell span { flex: 1; font-size: 12px; line-height: 1.55; }
        .gpb-upsell b { display: block; font-size: 13px; color: #fde68a; margin-bottom: 2px; }
        .gpb-go {
            width: 100%; padding: 14px; border: none; border-radius: var(--gpb-r-md);
            background: linear-gradient(135deg, var(--gpb-accent), var(--gpb-accent-2)); color: var(--gpb-on-accent);
            font-size: 15px; font-weight: 800; cursor: pointer; font-family: inherit;
            box-shadow: 0 12px 30px var(--gpb-glow);
        }
        .gpb-go:hover { filter: brightness(1.06); }

        /* =====================================================================
         * Loading
         * ===================================================================== */
        #global-playback-loading {
            position: fixed; inset: 0; z-index: 4300; display: flex; flex-direction: column;
            align-items: center; justify-content: center; gap: 18px;
            background: rgba(8,10,14,0.78);
            -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
            transition: opacity .2s ease;
        }
        #global-playback-loading.fade-out { opacity: 0; }
        .gpb-spinner {
            width: 44px; height: 44px; border-radius: 50%;
            border: 3px solid rgba(255,255,255,0.16); border-top-color: var(--gpb-accent);
            animation: gpb-spin .8s linear infinite;
        }
        @keyframes gpb-spin { to { transform: rotate(360deg); } }
        .gpb-loading-text { text-align: center; }
        .gpb-loading-title { font-size: 15.5px; font-weight: 800; color: var(--gpb-text); letter-spacing: -0.01em; }
        .gpb-loading-sub { margin-top: 5px; font-size: 12px; color: var(--gpb-dim); }

        /* =====================================================================
         * Narrow — the dock and the bubbles share the bottom edge
         * =====================================================================
         * The dock stops being a card on the left and becomes the bottom-left
         * of the screen, with the bubble column held out of its way rather than
         * stacked on top of it. Nothing is dropped on the way down except the
         * legend: the transport is the reason the panel exists.
         * ------------------------------------------------------------------ */
        @media (max-width: 780px) {
            .gpb-left {
                left: 10px; right: 72px; width: auto;
                /* Anchored left and held off the bubbles, but never let loose to
                   fill a wide screen — a scrubber three hundred pixels long is
                   easier to place a thumb on than one seven hundred long. */
                max-width: 460px;
                bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
                max-height: calc(100vh - 78px);
                max-height: calc(100dvh - 78px);
                gap: 8px;
            }
            .gpb-dock { padding: 13px 14px 12px; gap: 11px; border-radius: var(--gpb-r-lg); }
            .gpb-bubbles { right: 10px; bottom: calc(env(safe-area-inset-bottom, 0px) + 12px); gap: 9px; }
            .gpb-bubble { width: 46px; height: 46px; }
            .gpb-card { padding: 12px 13px; border-radius: var(--gpb-r-lg); gap: 10px; }
        }
        @media (max-width: 620px) {
            .gpb-rail { top: calc(env(safe-area-inset-top, 0px) + 10px); left: 10px; right: 10px; }
            .gpb-rail-track { gap: 6px; }
            .gpb-fchip { height: 34px; padding: 0 11px; gap: 6px; font-size: 12px; }
            .gpb-fchip-count { font-size: 10px; padding: 1px 5px; }
            .gpb-zulu { font-size: 26px; }
            .gpb-play { width: 46px; height: 46px; font-size: 16px; }
            .gpb-legend { display: none; }
            .gpb-title { font-size: 22px; }

            /* A phone gets the app's own modal idiom — the bottom sheet the
               settings and info panels use — instead of a centred card taller
               than the screen. Anchored to the bottom edge, so the fields and
               the CTA are where the thumb already is. */
            .gpb-picker { align-items: flex-end; }
            .gpb-picker-card {
                width: 100%; max-width: none;
                max-height: 92vh;
                max-height: min(92dvh, calc(100dvh - 20px));
                border-radius: 22px 22px 0 0;
                border-bottom: none;
                box-shadow: 0 -12px 44px rgba(0,0,0,0.55);
            }
            .gpb-picker-grip {
                display: block; flex: 0 0 auto;
                width: 38px; height: 5px; border-radius: 10px;
                background: var(--gpb-raise-2);
                margin: 9px auto 0;
            }
            .gpb-picker-body { padding: 14px 18px 6px; }
            .gpb-picker-foot { padding: 12px 18px calc(14px + env(safe-area-inset-bottom, 0px)); gap: 10px; }
            .gpb-picker-close { top: 12px; right: 12px; width: 32px; height: 32px; }
            .gpb-field { margin-top: 18px; }
            /* Two per row beats a ragged wrap when nine of them have to fit. */
            .gpb-chips { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
            .gpb-chip { text-align: center; padding: 11px 10px; }
            .gpb-upsell { padding: 11px 12px; gap: 10px; }
            .gpb-upsell > i:first-child { font-size: 15px; }
            .gpb-go { padding: 15px; }
        }
        /* A phone on its side has no vertical room to spare — the counts are
           the first thing that can go, the clock and the scrubber the last. */
        @media (max-width: 620px) {
            .gpb-card-call { font-size: 18px; }
            .gpb-card-stat span { font-size: 13px; }
        }
        /* A phone on its side, or a short desktop window: the header is the
           only part of the picker that is pure introduction, so it gives up its
           room first and the fields keep theirs. Without this the scroll region
           is entirely title and the choices are all below the fold. */
        @media (max-height: 560px) {
            .gpb-picker-card { max-height: min(calc(100dvh - 16px), 780px); }
            .gpb-picker-body { padding: 18px 22px 4px; }
            .gpb-title { font-size: 19px; margin: 5px 0 0; }
            .gpb-sub { display: none; }
            .gpb-tier-badge { margin-top: 10px; padding: 5px 10px; font-size: 11px; }
            .gpb-field { margin-top: 14px; }
            .gpb-label { margin-bottom: 7px; }
            .gpb-chip { padding: 7px 13px; }
            .gpb-picker-foot { padding: 10px 22px calc(12px + env(safe-area-inset-bottom, 0px)); gap: 9px; }
            .gpb-upsell { padding: 9px 12px; }
            .gpb-upsell span { font-size: 11.5px; line-height: 1.4; }
            .gpb-go { padding: 11px; }
        }

        @media (max-height: 520px) {
            .gpb-meters { display: none; }
            .gpb-legend { display: none; }
            .gpb-dock { gap: 10px; }
            .gpb-zulu { font-size: 22px; }
            /* No room for both. The card is what you asked for by tapping, so
               it stays and the counts go. */
            .gpb-card-track { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
            .gpb-ui *, .gpb-picker * { transition: none !important; animation: none !important; }
        }
        `;
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
            makePosition,
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
            buildPaths,
            setSelectedForTest: (id) => { selectedFlightId = id; },
            __pathFeatures: () => pathList,
            setThinGridForTest: (degLat, degLon) => { cellDegLat = degLat; cellDegLon = degLon; },
            // A camera gesture decides what is on screen, and until it was
            // measured it was deciding wrongly — see the zoom section of
            // tools/test-global-playback.js. A stub map is enough to drive it.
            __setMapForTest: (m) => { map = m; },
            bindMapInteractions,
            unbindMapInteractions,
            classifyFlight,
            countClasses,
            filterMasks: { T_AIRLINE, T_HEAVY, T_CARGO, T_BUSINESS, T_GA, T_MILITARY },
            setFiltersForTest: (ids) => { activeFilters = new Set(ids); applyFilters(); },
            visibleFlights: () => visibleFlights,
            setFlightsForTest: (list) => {
                flights = list;
                classCounts = countClasses();
                applyFilters();
            },
            // Mount the replay chrome against no map at all, so the layout can
            // be looked at — in a browser or a screenshot test — without a
            // Mapbox context, an API and an hour of recorded traffic. The chrome
            // is most of what this module is judged on and it was the one part
            // nothing could reach.
            __mountChromeForTest: (opts = {}) => {
                injectStyles();
                limits = opts.limits || {
                    tier: 'free', lookbackMs: DAY_MS,
                    earliest: Date.now() - DAY_MS, latest: Date.now(), maxSpanMs: 6 * HOUR_MS
                };
                serverName = opts.serverName || '';
                flights = opts.flights || [];
                windowMeta = opts.windowMeta || { start: Date.now() - 2 * HOUR_MS, end: Date.now() - HOUR_MS };
                spanStart = windowMeta.start;
                totalDurationMs = Math.max(1, windowMeta.end - windowMeta.start);
                currentMs = totalDurationMs * (opts.at ?? 0.42);
                classCounts = countClasses();
                applyFilters();
                if (opts.picker) { buildPicker(); return; }
                buildPanel();
                updateWindowCount();
                airborneCount = opts.airborne ?? visibleFlights.length;
                drawnCount = opts.drawn ?? airborneCount;
                updateHUD(spanStart + currentMs);
                updateScrubber();
                if (opts.select) {
                    flightsById = new Map(flights.map(f => [f.flightId, f]));
                    selectedFlightId = opts.select;
                    buildInfoCard();
                    updateInfoCard(spanStart + currentMs);
                }
            },
            refreshCullBounds,
            refreshThinGrid,
            renderFrame,
            cullBounds: () => cull,
            __planeIds: () => planeList.map(f => f.properties.flightId),
            __planeFeatures: () => planeList,
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
            MAX_PATHS,
            PATH_POINTS,
            MAX_INTERP_GAP_MS,
            MAX_SPLINE_SEGMENT_MS,
            FADE_MS
        }
    };
})();

// Mirrored for non-module callers (the mobile chrome builds its tab bar
// outside the module graph).
try { window.InflightGlobalPlayback = GlobalPlayback; } catch (_) { /* no window */ }
