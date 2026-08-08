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
// wants a tail. Past this many vertices the trails cost more than they show,
// so they are thinned rather than dropped — a shorter tail on every aircraft
// beats a full tail on an arbitrary few.
const MAX_TRAIL_VERTICES = 40000;

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
    let flights = [];                // { flightId, callsign, username, category, points[] }
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
    function getAltColor(alt) {
        const stops = [
            [0, [56, 189, 248]],
            [10000, [45, 212, 191]],
            [20000, [163, 230, 53]],
            [30000, [250, 204, 21]],
            [40000, [248, 113, 113]]
        ];
        const a = Math.max(0, Math.min(40000, alt || 0));
        for (let i = 0; i < stops.length - 1; i++) {
            const [lo, c0] = stops[i], [hi, c1] = stops[i + 1];
            if (a <= hi) {
                const f = (a - lo) / (hi - lo || 1);
                const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
                return `rgb(${c[0]},${c[1]},${c[2]})`;
            }
        }
        return 'rgb(248,113,113)';
    }

    // The sprite sheet the live map already loaded. 'default' has no frame in
    // it, so an unknown airframe resolves to a real icon rather than making
    // Mapbox re-request a missing image on every frame.
    function categoryFor(aircraftName) {
        if (typeof window.getAircraftCategory === 'function') {
            try {
                const c = window.getAircraftCategory(aircraftName);
                if (c && c !== 'default') return c;
            } catch (_) { /* fall through */ }
        }
        return 'B737';
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
    function normalizePath(packed, startMs) {
        const out = [];
        for (const p of packed || []) {
            if (!Array.isArray(p) || p.length < 3) continue;
            const t = startMs + p[0] * 1000;
            if (typeof p[1] !== 'number' || typeof p[2] !== 'number') continue;
            out.push({ t, lat: p[1], lon: p[2], alt: p[3] || 0, gs: p[4] || 0, hdg: p[5] || 0 });
        }
        return out;
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

    // A flight's position at absolute time absT, or null when absT falls
    // outside its recorded track — which is how aircraft enter and leave the
    // replay at the moments they actually did.
    function positionAt(points, absT) {
        if (!points || !points.length) return null;
        if (absT < points[0].t || absT > points[points.length - 1].t) return null;
        if (absT === points[0].t) return points[0];

        let lo = 0, hi = points.length - 1;
        while (lo + 1 < hi) {
            const mid = (lo + hi) >> 1;
            if (points[mid].t <= absT) lo = mid; else hi = mid;
        }
        const a = points[lo], b = points[hi];
        const f = (absT - a.t) / ((b.t - a.t) || 1);

        // Heading is an angle, so it has to be interpolated the short way round
        // — lerping 350° to 10° through 180° spins every aircraft on the map
        // through a full turn as it crosses north.
        let delta = b.hdg - a.hdg;
        if (delta > 180) delta -= 360; else if (delta < -180) delta += 360;

        return {
            lat: a.lat + (b.lat - a.lat) * f,
            lon: a.lon + (b.lon - a.lon) * f,
            alt: a.alt + (b.alt - a.alt) * f,
            gs: a.gs + (b.gs - a.gs) * f,
            hdg: (a.hdg + delta * f + 360) % 360,
            t: absT
        };
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
                    'line-width': 1.6,
                    'line-opacity': 0.55
                }
            });
        }

        if (!map.getSource(SRC_PLANES)) {
            map.addSource(SRC_PLANES, { type: 'geojson', data: EMPTY_FC });
        }
        if (!map.getLayer(LYR_PLANES)) {
            map.addLayer({
                id: LYR_PLANES, type: 'symbol', source: SRC_PLANES,
                layout: {
                    'icon-image': ['concat', 'icon-', ['coalesce', ['get', 'category'], 'B737']],
                    'icon-rotate': ['get', 'heading'],
                    'icon-rotation-alignment': 'map',
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                    'icon-size': (window.mapFilters?.planeIconSize || 0.16)
                },
                paint: { 'icon-color': ['coalesce', ['get', 'color'], '#ffffff'] }
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
                    // Labels for a whole server would be an unreadable mat of
                    // text at low zoom. Let them appear as the map is zoomed in.
                    'text-optional': true
                },
                paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 1.4 },
                minzoom: 5
            });
        }
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

    function buildPlaneFeatures(absT) {
        const features = [];
        for (const f of flights) {
            const pos = positionAt(f.points, absT);
            if (!pos) continue;
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
                properties: {
                    flightId: f.flightId,
                    callsign: f.callsign,
                    category: f.category,
                    heading: pos.hdg,
                    color: getAltColor(pos.alt)
                }
            });
        }
        return { type: 'FeatureCollection', features };
    }

    function buildTrailFeatures(absT) {
        if (!showTrails) return EMPTY_FC;
        const from = absT - TRAIL_WINDOW_MS;
        const features = [];

        // Two passes would be exact; one pass with a running budget is enough,
        // because the flights are ordered by first appearance and a global
        // window rarely gets near the cap. When it does, the tails simply stop
        // lengthening rather than the frame rate collapsing.
        let vertices = 0;
        for (const f of flights) {
            if (vertices >= MAX_TRAIL_VERTICES) break;
            const pos = positionAt(f.points, absT);
            if (!pos) continue;

            const startIdx = firstIndexAtOrAfter(f.points, from);
            const coords = [];
            for (let i = startIdx; i < f.points.length; i++) {
                const p = f.points[i];
                if (p.t > absT) break;
                coords.push([p.lon, p.lat]);
            }
            coords.push([pos.lon, pos.lat]);
            if (coords.length < 2) continue;

            vertices += coords.length;
            features.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: { color: getAltColor(pos.alt) }
            });
        }
        return { type: 'FeatureCollection', features };
    }

    function renderFrame() {
        if (!map || !map.getSource(SRC_PLANES)) return;
        const absT = spanStart + currentMs;

        const planes = buildPlaneFeatures(absT);
        try { map.getSource(SRC_PLANES).setData(planes); } catch (_) { return; }
        try {
            const trailSrc = map.getSource(SRC_TRAILS);
            if (trailSrc) trailSrc.setData(buildTrailFeatures(absT));
        } catch (_) { /* style swapped mid-frame */ }

        updateHUD(planes.features.length, absT);
    }

    function tick(now) {
        rafId = null;
        if (!isPlaying) return;

        const dt = lastFrameAt ? Math.min(now - lastFrameAt, 250) : 16;
        lastFrameAt = now;

        if (!isScrubbing) {
            currentMs += dt * speed;
            if (currentMs >= totalDurationMs) {
                currentMs = totalDurationMs;
                renderFrame();
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
                        Watch every flight${serverName ? ` on the <b>${serverName}</b> server` : ''} exactly as it flew.
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
                    <span id="gpb-airborne">0</span> airborne
                    <span class="gpb-dot">•</span>
                    <span id="gpb-total">0</span> flights in window
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
                    renderFrame();
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
            const seek = () => {
                currentMs = (Number(range.value) / 1000) * totalDurationMs;
                renderFrame();
                updateScrubber();
            };
            range.addEventListener('input', () => { isScrubbing = true; seek(); });
            range.addEventListener('change', () => { isScrubbing = false; seek(); });
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

    function updateHUD(airborne, absT) {
        if (!panelEl) return;
        const zulu = panelEl.querySelector('#gpb-zulu');
        if (zulu) zulu.textContent = fmtZulu(absT);
        const date = panelEl.querySelector('#gpb-date');
        if (date) date.textContent = new Date(absT).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const air = panelEl.querySelector('#gpb-airborne');
        if (air) air.textContent = String(airborne);
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
                renderFrame();
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
            category: categoryFor(f.aircraft?.aircraftName),
            points: normalizePath(f.path, windowMeta.start)
        })).filter(f => f.points.length >= 2);

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
                hideLiveTraffic();
                renderFrame();
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
        removeLayers();
        restoreLiveTraffic();
        destroyPanel();
        flights = [];
        windowMeta = null;
        spanStart = 0;
        totalDurationMs = 0;
        currentMs = 0;
        isScrubbing = false;
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
        .gpb-dot { margin: 0 6px; color: #475569; }
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
            .gpb-stats { display: none; }
            .gpb-speeds { display: none; }
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

    return { open, close, isOpen: () => !!(panelEl || pickerEl) };
})();

// Mirrored for non-module callers (the mobile chrome builds its tab bar
// outside the module graph).
try { window.InflightGlobalPlayback = GlobalPlayback; } catch (_) { /* no window */ }
