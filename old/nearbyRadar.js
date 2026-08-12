/**
 * nearbyRadar.js
 *
 * "Nearby" — a live radar scope around a point you choose.
 *
 * The app could already answer "what is happening at this airport" (the
 * airport window) and "what is the whole server flying" (NetworkBoardUI).
 * Neither answers the question a tracker gets asked most: *what is flying
 * near here, right now* — where "here" is wherever you are standing, wherever
 * the map is pointed, or any field you name.
 *
 * The scope is a north-up PPI: range rings, a sweep, and one blip per aircraft
 * placed by true bearing and great-circle distance from the origin, rotated to
 * its heading and tinted by altitude band. Under it is the same set of
 * contacts as a list — callsign, type, distance, bearing, altitude and trend —
 * and tapping either the blip or the row opens that flight, through the same
 * window.onSearchResultClick the search dropdown uses.
 *
 * Everything is derived on the client from the live feature cache that already
 * drives the map (window.getLiveFlightData), so a refresh costs one pass over
 * current traffic and no network request. The one exception is the "My
 * location" origin, which asks the browser for a fix once per session (or when
 * the user re-taps the mode) and never stores it anywhere.
 *
 * ── Hosting ───────────────────────────────────────────────────────────────
 * Like NetworkBoardUI, the view is host-agnostic: it paints into any container
 * it is handed, so the desktop .info-window and the mobile "Airports & ATC"
 * sheet share one implementation instead of two.
 *
 *   • Desktop (>768px) — #nearby-radar-window, opened by the `openNearbyRadar`
 *     event that the Nearby orb in landingUI's nexus fires.
 *   • Mobile (<=768px) — the "Nearby" segment of the iOS ATC sheet, which
 *     listens for the same event. This module's own toggle() stands down below
 *     768px so the two can never both open.
 */

// Viewports at or below this width get the iOS chrome, which presents this
// board inside its "Airports & ATC" sheet. Must match the width
// MobileLandingChromeUI.init() bails out above, or the two disagree about who
// owns the board.
const MOBILE_CHROME_MAX_WIDTH = 768;

const REFRESH_MS = 4000;

// Selectable ranges, in nautical miles. 25 is "the circuit and the approach",
// 500 is "most of a FIR" — beyond that the scope stops being a radar and
// becomes a small world map, which the map itself already is.
const RANGES_NM = [25, 50, 100, 250, 500];
const DEFAULT_RANGE_NM = 100;

// Blips are drawn, rows are listed. Both are capped: a scope with 300 blips is
// a solid disc, and a list nobody scrolls to the end of costs layout for
// nothing. The counts in the summary line are always the true totals, so the
// cap is a drawing limit and never a lie about how much traffic is out there.
const MAX_BLIPS = 80;
const MAX_ROWS = 40;

// SVG user units. The scope is drawn once at this size and scaled by CSS, so
// these are the only numbers the geometry has to agree on.
const SCOPE_SIZE = 220;
const SCOPE_CX = SCOPE_SIZE / 2;
const SCOPE_CY = SCOPE_SIZE / 2;
const SCOPE_R = 100;

const STORE_KEY = 'inflight_nearby_radar';

const EARTH_R_NM = 3440.065;

const MODES = [
    { id: 'me',      label: 'My Location', icon: 'fa-location-crosshairs' },
    { id: 'map',     label: 'Map Centre',  icon: 'fa-map-location-dot' },
    { id: 'airport', label: 'Airport',     icon: 'fa-tower-control' },
];

// Altitude bands, highest first so the first match wins. `max` is exclusive.
// Ground traffic is split out before this table is consulted — it is a state,
// not a height, and an aircraft holding short at 400 ft AMSL should not look
// like one on final.
const ALT_BANDS = [
    { min: 35000, color: '#f472b6', label: 'FL350+' },
    { min: 24000, color: '#c084fc', label: 'FL240+' },
    { min: 10000, color: '#34d399', label: '10k+' },
    { min: 1000,  color: '#38bdf8', label: '1k+' },
    { min: -2000, color: '#facc15', label: 'Low' },
];
const GROUND_COLOR = '#94a3b8';

const COMPASS_16 = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

/**
 * Great-circle distance in nautical miles.
 * Exported, with the handful of pure helpers below it, for
 * tools/test-nearby-radar.js — the geometry is the part of this feature that
 * can be wrong without looking wrong, so it is checked against known answers.
 */
export function distanceNm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial true bearing from point 1 to point 2, 0–360°. */
export function bearingDeg(lat1, lon1, lat2, lon2) {
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export const compassPoint = (deg) => COMPASS_16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

/**
 * Aircraft/livery names, preferring the flat mirrors on the feature.
 * Live features carry aircraftName/liveryName as top-level properties; the
 * JSON blob is only parsed when they are missing, so the common path avoids a
 * JSON.parse per flight per refresh. Mirrors networkBoard.js's aircraftFields.
 */
function aircraftFields(p) {
    let acName = p.aircraftName;
    let livName = p.liveryName;
    if (acName == null || livName == null) {
        let acData = p.aircraft;
        if (typeof acData === 'string') {
            try { acData = JSON.parse(acData); } catch { acData = null; }
        }
        acData = acData || {};
        if (acName == null) acName = acData.aircraftName;
        if (livName == null) livName = acData.liveryName;
    }
    return { acName: acName || '', livName: livName || '' };
}

export function bandFor(altFt, onGround) {
    if (onGround) return { color: GROUND_COLOR, label: 'Ground' };
    for (const b of ALT_BANDS) if (altFt >= b.min) return b;
    return ALT_BANDS[ALT_BANDS.length - 1];
}

/** Altitude the way a controller would read it back. */
export function altText(altFt, onGround) {
    if (onGround) return 'GND';
    if (!Number.isFinite(altFt)) return '—';
    if (altFt >= 18000) return `FL${String(Math.round(altFt / 100)).padStart(3, '0')}`;
    return `${Math.round(altFt).toLocaleString()} ft`;
}

/** ▲ / ▼ / · for the vertical trend, with the fpm that earned it. */
export function trend(vs) {
    if (!Number.isFinite(vs) || Math.abs(vs) < 300) return { glyph: '·', title: 'Level' };
    return vs > 0
        ? { glyph: '▲', title: `Climbing ${Math.round(vs).toLocaleString()} fpm` }
        : { glyph: '▼', title: `Descending ${Math.abs(Math.round(vs)).toLocaleString()} fpm` };
}

export function distText(nm) {
    if (!Number.isFinite(nm)) return '—';
    return nm < 10 ? nm.toFixed(1) : String(Math.round(nm));
}

/**
 * Every live flight within `rangeNm` of the origin, nearest first.
 * Cheap enough to run on every tick: one pass, one haversine per aircraft, and
 * a bearing only for the ones that survive the range test.
 */
export function collectContacts(origin, rangeNm) {
    const flights = (typeof window.getLiveFlightData === 'function')
        ? window.getLiveFlightData() : [];

    const out = [];
    let airborne = 0;
    let ground = 0;

    for (const f of flights) {
        const coords = f && f.geometry && f.geometry.coordinates;
        if (!coords || coords.length < 2) continue;
        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const nm = distanceNm(origin.lat, origin.lon, lat, lon);
        if (nm > rangeNm) continue;

        const p = f.properties || {};
        const onGround = p.phase === 'Ground';
        if (onGround) ground++; else airborne++;

        const { acName, livName } = aircraftFields(p);
        out.push({
            flightId: p.flightId,
            lat,
            lon,
            nm,
            brg: bearingDeg(origin.lat, origin.lon, lat, lon),
            callsign: String(p.callsign || '').trim(),
            username: String(p.username || '').trim(),
            acName,
            livName,
            alt: Number(p.altitude),
            speed: Number(p.speed),
            vs: Number(p.verticalSpeed),
            heading: Number(p.heading) || 0,
            dep: String(p.departureIcao || '').toUpperCase(),
            arr: String(p.arrivalIcao || '').toUpperCase(),
            onGround,
        });
    }

    out.sort((a, b) => a.nm - b.nm);
    return { contacts: out, airborne, ground };
}

export const NearbyRadarUI = {
    _visible: false,
    _timer: null,
    // Container currently displaying the scope — see renderInto().
    _host: null,
    // The delegated listener bound to the root this module painted, kept so a
    // repaint can drop the old one instead of stacking handlers.
    _boundRoot: null,

    _mode: 'map',
    _rangeNm: DEFAULT_RANGE_NM,
    _icao: '',
    _selectedId: null,
    _alerts: false,

    // { state: 'idle'|'locating'|'ok'|'denied'|'unavailable'|'error', lat, lon, accuracyM, message }
    _geo: { state: 'idle' },

    // flightIds inside the ring on the previous tick, so an arrival can be
    // told apart from something that was already there. Null until the first
    // tick has run — otherwise turning alerts on would announce the entire
    // current picture as if it had just flown in.
    _prevInRange: null,

    // Last computed picture, so a click can resolve a row without recomputing.
    _contacts: [],

    // Styles and saved preferences are needed by whichever shell shows the
    // scope first, and the mobile sheet can reach renderInto() before flight.js
    // has run init(). Both steps are idempotent, so this can be called freely.
    _ready: false,
    _ensureReady() {
        if (this._ready) return;
        this._ready = true;
        this._restore();
        this._injectStyles();
    },

    init() {
        if (document.getElementById('nearby-radar-window')) return;
        const mapContainer = document.getElementById('sector-ops-map-fullscreen');
        if (!mapContainer) return;

        this._ensureReady();

        mapContainer.insertAdjacentHTML('beforeend', `
            <div id="nearby-radar-window" class="info-window nr-window">
                <div class="info-window-header">
                    <h3><i class="fa-solid fa-satellite-dish" style="margin-right: 10px;"></i> Nearby</h3>
                    <div class="info-window-actions">
                        <button id="nearby-radar-close-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div id="nearby-radar-content" class="info-window-content nr-content"></div>
            </div>
        `);

        document.getElementById('nearby-radar-close-btn')
            ?.addEventListener('click', () => this.toggle(false));

        window.addEventListener('openNearbyRadar', () => this.toggle(!this._visible));
    },

    toggle(show) {
        // On phones the scope is presented inside the iOS "Airports & ATC"
        // sheet, not this panel — MobileLandingChromeUI initialises at the same
        // <=768px and listens for the same openNearbyRadar event. Without this
        // guard both would open, and the desktop panel would float over the
        // mobile chrome that is already showing the scope.
        if (MOBILE_CHROME_MAX_WIDTH >= window.innerWidth) return;

        const el = document.getElementById('nearby-radar-window');
        if (!el) return;
        this._visible = show === undefined ? !this._visible : !!show;

        if (this._visible) {
            this.renderInto(document.getElementById('nearby-radar-content'));
            el.classList.add('visible');
            this.startAutoRefresh();
        } else {
            el.classList.remove('visible');
            this.stopAutoRefresh();
        }

        document.getElementById('tile-nearby')?.classList.toggle('active', this._visible);
    },

    // ---------------- host-agnostic view ----------------

    /** Adopt `hostEl` as the container and paint it. */
    renderInto(hostEl) {
        if (!hostEl) return;
        this._ensureReady();
        this._host = hostEl;
        // A fresh host means a fresh picture: forget what was in range so the
        // first tick after opening is treated as the baseline, not as eighty
        // aircraft simultaneously entering the ring.
        this._prevInRange = null;
        this._paintChrome();
        // "My location" only asks the browser once; re-opening the panel with
        // that mode already selected should show the fix, not a dead prompt.
        if (this._mode === 'me' && this._geo.state === 'idle') this._locate();
        this._paintData();
    },

    /** Release a host when its shell closes, so a stale node isn't repainted. */
    detach(hostEl) {
        if (!hostEl || this._host === hostEl) {
            this._host = null;
            this._boundRoot = null;
        }
    },

    // Polling only runs while a shell is showing the scope — it reads the live
    // cache, so there is nothing to refresh into a panel nobody can see.
    startAutoRefresh() {
        if (!this._timer) this._timer = setInterval(() => this._paintData(), REFRESH_MS);
    },

    stopAutoRefresh() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },

    // ---------------- origin ----------------

    /**
     * Where the scope is centred, or null when that cannot be answered yet
     * (no fix, no ICAO typed, map not up). The caller renders the reason.
     */
    _origin() {
        if (this._mode === 'me') {
            if (this._geo.state !== 'ok') return null;
            return {
                lat: this._geo.lat,
                lon: this._geo.lon,
                label: 'My location',
                sub: this._nearestFieldLabel(this._geo.lat, this._geo.lon),
            };
        }

        if (this._mode === 'airport') {
            const icao = this._icao;
            if (!/^[A-Z]{3,4}$/.test(icao)) return null;
            const c = (typeof window.getAirportCoords === 'function')
                ? window.getAirportCoords(icao) : null;
            if (!c) return null;
            const name = (typeof window.getAirportName === 'function')
                ? window.getAirportName(icao) : '';
            return { lat: c.lat, lon: c.lon, label: icao, sub: name || 'Airport' };
        }

        // Map centre. Re-read on every tick rather than cached, so panning the
        // map moves the scope with it.
        const c = window.InflightMapCamera && typeof window.InflightMapCamera.center === 'function'
            ? window.InflightMapCamera.center() : null;
        if (!c) return null;
        return {
            lat: c.lat,
            lon: c.lon,
            label: 'Map centre',
            sub: this._nearestFieldLabel(c.lat, c.lon),
        };
    },

    /** "12 NM from EGLL" for a point, or its coordinates when no field is near. */
    _nearestFieldLabel(lat, lon) {
        try {
            const near = (typeof window.findNearestAirports === 'function')
                ? window.findNearestAirports(lat, lon, 1) : [];
            if (near && near[0]) {
                const nm = near[0].km / 1.852;
                if (nm < 1) return `At ${near[0].icao}`;
                return `${distText(nm)} NM from ${near[0].icao}`;
            }
        } catch (_) { /* airports may not be loaded yet */ }
        return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    },

    /**
     * Ask the browser where we are. One shot, cached for five minutes, and the
     * fix never leaves this object — it is used to centre the scope and to name
     * the nearest field, nothing else.
     */
    _locate() {
        if (!navigator.geolocation) {
            this._geo = { state: 'unavailable', message: 'This browser cannot share a location.' };
            this._paintData();
            return;
        }
        this._geo = { state: 'locating' };
        this._paintData();

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                this._geo = {
                    state: 'ok',
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    accuracyM: pos.coords.accuracy,
                };
                this._prevInRange = null;
                this._paintData();
            },
            (err) => {
                // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
                this._geo = err && err.code === 1
                    ? { state: 'denied', message: 'Location permission was declined.' }
                    : { state: 'error', message: 'Could not get a location fix.' };
                this._paintData();
            },
            { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60 * 1000 }
        );
    },

    // ---------------- persistence ----------------

    _restore() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
            if (MODES.some(m => m.id === saved.mode)) this._mode = saved.mode;
            if (RANGES_NM.includes(saved.rangeNm)) this._rangeNm = saved.rangeNm;
            if (typeof saved.icao === 'string') this._icao = saved.icao.toUpperCase().slice(0, 4);
            if (typeof saved.alerts === 'boolean') this._alerts = saved.alerts;
        } catch (_) { /* first run, or storage unavailable */ }
    },

    _save() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({
                mode: this._mode,
                rangeNm: this._rangeNm,
                icao: this._icao,
                alerts: this._alerts,
            }));
        } catch (_) { /* storage unavailable — the session still works */ }
    },

    // ---------------- interaction ----------------

    /**
     * One delegated listener on the root this module painted. Bound here rather
     * than exposed as a handleClick() for the host to call, because the airport
     * field needs `input` as well as `click` and a host that only forwards
     * clicks would leave it dead.
     */
    _bindRoot(root) {
        if (!root || this._boundRoot === root) return;
        this._boundRoot = root;

        root.addEventListener('click', (e) => {
            const mode = e.target.closest('[data-nr-mode]');
            if (mode) {
                this._setMode(mode.dataset.nrMode);
                return;
            }
            const range = e.target.closest('[data-nr-range]');
            if (range) {
                window.InflightHaptics?.tap?.();
                this._rangeNm = Number(range.dataset.nrRange) || DEFAULT_RANGE_NM;
                this._prevInRange = null;
                this._save();
                this._paintChrome();
                this._paintData();
                return;
            }
            if (e.target.closest('[data-nr-retry]')) {
                this._locate();
                return;
            }
            if (e.target.closest('[data-nr-alerts]')) {
                this._toggleAlerts();
                return;
            }
            const contact = e.target.closest('[data-nr-flight]');
            if (contact) {
                this._openFlight(contact.dataset.nrFlight);
            }
        });

        const field = root.querySelector('[data-nr-icao]');
        if (field) {
            field.addEventListener('input', () => {
                this._icao = field.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
                if (field.value !== this._icao) field.value = this._icao;
                this._prevInRange = null;
                this._save();
                this._paintData();
            });
            // Enter should dismiss the keyboard on a phone rather than submit
            // anything — the scope updates as you type.
            field.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); field.blur(); }
            });
        }
    },

    _setMode(mode) {
        if (!MODES.some(m => m.id === mode) || mode === this._mode) return;
        window.InflightHaptics?.tap?.();
        this._mode = mode;
        this._prevInRange = null;
        this._save();
        this._paintChrome();
        if (mode === 'me' && this._geo.state !== 'ok' && this._geo.state !== 'locating') {
            this._locate();
        } else {
            this._paintData();
        }
    },

    _toggleAlerts() {
        this._alerts = !this._alerts;
        // Arriving traffic is judged against the previous tick, so a toggle has
        // to reset that baseline — otherwise switching alerts on would announce
        // everything already inside the ring.
        this._prevInRange = null;
        this._save();
        window.InflightHaptics?.tap?.();
        this._paintChrome();
        this._paintData();
        if (typeof window.showNotification === 'function') {
            window.showNotification(
                this._alerts
                    ? `Nearby alerts on — you'll be told when traffic enters ${this._rangeNm} NM.`
                    : 'Nearby alerts off.',
                'info'
            );
        }
    },

    /**
     * Open a contact in the flight window, through the same entry point the
     * search dropdown uses so the window, the camera and the pin all behave
     * exactly as they do from a search result.
     */
    _openFlight(flightId) {
        const c = this._contacts.find(x => String(x.flightId) === String(flightId));
        if (!c) return;
        this._selectedId = String(flightId);
        window.InflightHaptics?.tap?.();
        this._paintData();

        // Lets the mobile chrome drop its sheet — the flight window it just
        // opened is behind it otherwise.
        window.dispatchEvent(new CustomEvent('nearbyRadarOpenedFlight', {
            detail: { flightId: c.flightId },
        }));

        if (typeof window.onSearchResultClick === 'function') {
            window.onSearchResultClick(c.flightId, c.lat, c.lon);
        }
    },

    // ---------------- alerts ----------------

    /**
     * Announce traffic that has just crossed into the ring. Compares this tick
     * against the last, so an aircraft is announced once however long it then
     * loiters. Several arrivals in one tick collapse into a single line —
     * five toasts at once is noise, not an alert.
     */
    _runAlerts(contacts) {
        const now = new Set(contacts.map(c => String(c.flightId)));
        const prev = this._prevInRange;
        this._prevInRange = now;
        if (!this._alerts || !prev) return;

        const fresh = contacts.filter(c => !prev.has(String(c.flightId)));
        if (!fresh.length || typeof window.showNotification !== 'function') return;

        const name = (c) => c.callsign || c.username || 'Unknown traffic';
        const msg = fresh.length === 1
            ? `${name(fresh[0])} entered your ${this._rangeNm} NM ring — ${distText(fresh[0].nm)} NM ${compassPoint(fresh[0].brg)}.`
            : `${fresh.length} aircraft entered your ${this._rangeNm} NM ring.`;
        window.showNotification(msg, 'info');
        window.InflightHaptics?.tap?.();
    },

    // ---------------- painting ----------------
    //
    // Two passes rather than one. The chrome — mode segment, range chips, the
    // rings and the sweep — is static between interactions, and rebuilding it
    // every four seconds would restart the sweep animation mid-turn and blow
    // away the airport field's focus and caret while someone is typing into it.
    // _paintData() therefore only writes the parts that actually change.

    _paintChrome() {
        if (!this._host || !this._host.isConnected) return;
        this._host.innerHTML = this._chromeHTML();
        this._bindRoot(this._host.querySelector('.nr-root'));
    },

    _chromeHTML() {
        const modeBtns = MODES.map(m => `
            <button type="button" class="nr-mode ${m.id === this._mode ? 'is-on' : ''}"
                    data-nr-mode="${m.id}" aria-pressed="${m.id === this._mode}">
                <i class="fa-solid ${m.icon}"></i><span>${esc(m.label)}</span>
            </button>
        `).join('');

        const rangeBtns = RANGES_NM.map(r => `
            <button type="button" class="nr-range ${r === this._rangeNm ? 'is-on' : ''}"
                    data-nr-range="${r}" aria-pressed="${r === this._rangeNm}">${r}</button>
        `).join('');

        const legend = [...ALT_BANDS].reverse().map(b => `
            <span class="nr-key"><i style="background:${b.color}"></i>${esc(b.label)}</span>
        `).join('') + `<span class="nr-key"><i style="background:${GROUND_COLOR}"></i>Ground</span>`;

        return `
            <div class="nr-root">
                <div class="nr-modes" role="group" aria-label="Radar centre">${modeBtns}</div>

                <div class="nr-icao-row" ${this._mode === 'airport' ? '' : 'hidden'}>
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" data-nr-icao class="nr-icao-input"
                           value="${esc(this._icao)}" maxlength="4" placeholder="ICAO — e.g. EGLL"
                           autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false"
                           aria-label="Centre the radar on an airport">
                </div>

                <div class="nr-head">
                    <div class="nr-head-text">
                        <span class="nr-head-label" data-nr-label>—</span>
                        <span class="nr-head-sub" data-nr-sub></span>
                    </div>
                    <button type="button" class="nr-bell ${this._alerts ? 'is-on' : ''}" data-nr-alerts
                            aria-pressed="${this._alerts}"
                            title="Tell me when traffic enters the ring">
                        <i class="fa-solid ${this._alerts ? 'fa-bell' : 'fa-bell-slash'}"></i>
                    </button>
                </div>

                <div class="nr-scope-wrap">
                    <svg class="nr-scope" viewBox="0 0 ${SCOPE_SIZE} ${SCOPE_SIZE}" role="img"
                         aria-label="Radar scope, north up">
                        ${this._ringsSVG()}
                        <g class="nr-sweep">
                            <path d="M ${SCOPE_CX} ${SCOPE_CY} L ${SCOPE_CX} ${SCOPE_CY - SCOPE_R} A ${SCOPE_R} ${SCOPE_R} 0 0 1 ${(SCOPE_CX + SCOPE_R * Math.sin(toRad(38))).toFixed(2)} ${(SCOPE_CY - SCOPE_R * Math.cos(toRad(38))).toFixed(2)} Z"
                                  fill="url(#nr-sweep-grad)"></path>
                        </g>
                        <g data-nr-blips></g>
                        <circle cx="${SCOPE_CX}" cy="${SCOPE_CY}" r="2.6" class="nr-origin-dot"></circle>
                    </svg>
                    <div class="nr-scope-note" data-nr-note hidden></div>
                </div>

                <div class="nr-ranges" role="group" aria-label="Radar range in nautical miles">
                    ${rangeBtns}<span class="nr-range-unit">NM</span>
                </div>

                <div class="nr-legend">${legend}</div>

                <div class="nr-summary" data-nr-summary></div>
                <div class="nr-list" data-nr-list></div>
            </div>
        `;
    },

    /** Range rings, the cardinal ticks and the sweep gradient. Static markup. */
    _ringsSVG() {
        const rings = [0.25, 0.5, 0.75, 1].map(f => `
            <circle cx="${SCOPE_CX}" cy="${SCOPE_CY}" r="${(SCOPE_R * f).toFixed(1)}"
                    class="nr-ring ${f === 1 ? 'is-outer' : ''}"></circle>
        `).join('');

        const ticks = [
            { deg: 0,   label: 'N' },
            { deg: 90,  label: 'E' },
            { deg: 180, label: 'S' },
            { deg: 270, label: 'W' },
        ].map(t => {
            const rad = toRad(t.deg);
            const x = SCOPE_CX + (SCOPE_R + 8) * Math.sin(rad);
            const y = SCOPE_CY - (SCOPE_R + 8) * Math.cos(rad);
            return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" class="nr-tick">${t.label}</text>`;
        }).join('');

        const cross = `
            <line x1="${SCOPE_CX}" y1="${SCOPE_CY - SCOPE_R}" x2="${SCOPE_CX}" y2="${SCOPE_CY + SCOPE_R}" class="nr-cross"></line>
            <line x1="${SCOPE_CX - SCOPE_R}" y1="${SCOPE_CY}" x2="${SCOPE_CX + SCOPE_R}" y2="${SCOPE_CY}" class="nr-cross"></line>
        `;

        return `
            <defs>
                <radialGradient id="nr-sweep-grad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.30"></stop>
                    <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"></stop>
                </radialGradient>
            </defs>
            ${rings}${cross}${ticks}
            <!-- Ring distances sit just inside their ring on the north axis.
                 Outside it they collide with the N tick, which is the one
                 label on the scope that has to stay readable. -->
            <text x="${SCOPE_CX + 4}" y="${(SCOPE_CY - SCOPE_R * 0.5 + 8).toFixed(1)}" class="nr-ring-label" data-nr-ring-mid></text>
            <text x="${SCOPE_CX + 4}" y="${(SCOPE_CY - SCOPE_R + 9).toFixed(1)}" class="nr-ring-label" data-nr-ring-outer></text>
        `;
    },

    _paintData() {
        if (!this._host || !this._host.isConnected) return;
        const root = this._host.querySelector('.nr-root');
        if (!root) return;

        const labelEl = root.querySelector('[data-nr-label]');
        const subEl = root.querySelector('[data-nr-sub]');
        const blipsEl = root.querySelector('[data-nr-blips]');
        const noteEl = root.querySelector('[data-nr-note]');
        const listEl = root.querySelector('[data-nr-list]');
        const summaryEl = root.querySelector('[data-nr-summary]');

        const midEl = root.querySelector('[data-nr-ring-mid]');
        const outerEl = root.querySelector('[data-nr-ring-outer]');
        if (midEl) midEl.textContent = String(Math.round(this._rangeNm / 2));
        if (outerEl) outerEl.textContent = String(this._rangeNm);

        const origin = this._origin();
        if (!origin) {
            this._contacts = [];
            if (labelEl) labelEl.textContent = this._blockedTitle();
            if (subEl) subEl.textContent = '';
            if (blipsEl) blipsEl.innerHTML = '';
            if (summaryEl) summaryEl.innerHTML = '';
            if (listEl) listEl.innerHTML = '';
            if (noteEl) { noteEl.hidden = false; noteEl.innerHTML = this._blockedNoteHTML(); }
            return;
        }

        if (noteEl) { noteEl.hidden = true; noteEl.innerHTML = ''; }
        if (labelEl) labelEl.textContent = origin.label;
        if (subEl) subEl.textContent = origin.sub || '';

        const { contacts, airborne, ground } = collectContacts(origin, this._rangeNm);
        this._contacts = contacts;
        this._runAlerts(contacts);

        if (blipsEl) blipsEl.innerHTML = this._blipsHTML(contacts);

        if (summaryEl) {
            summaryEl.innerHTML = contacts.length
                ? `<span><strong>${contacts.length}</strong> within ${this._rangeNm} NM</span>
                   <span class="nr-summary-split">${airborne} airborne · ${ground} on the ground</span>`
                : '';
        }

        if (listEl) {
            listEl.innerHTML = contacts.length
                ? contacts.slice(0, MAX_ROWS).map(c => this._rowHTML(c)).join('')
                    + (contacts.length > MAX_ROWS
                        ? `<div class="nr-more">+ ${contacts.length - MAX_ROWS} more inside the ring</div>`
                        : '')
                : `<div class="nr-empty">
                       <i class="fa-solid fa-radar"></i>
                       <span>Nothing within ${this._rangeNm} NM.</span>
                       <span class="nr-empty-sub">Widen the range, or move the centre.</span>
                   </div>`;
        }
    },

    /** Why the scope has no centre yet, as a title. */
    _blockedTitle() {
        if (this._mode === 'me') {
            if (this._geo.state === 'locating') return 'Finding you…';
            if (this._geo.state === 'denied') return 'Location declined';
            if (this._geo.state === 'unavailable') return 'Location unavailable';
            if (this._geo.state === 'error') return 'No fix';
            return 'Location needed';
        }
        if (this._mode === 'airport') return this._icao ? `${this._icao} not found` : 'Pick an airport';
        return 'Map not ready';
    },

    _blockedNoteHTML() {
        if (this._mode === 'me') {
            if (this._geo.state === 'locating') {
                return `<i class="fa-solid fa-location-crosshairs fa-fade"></i><span>Asking your device where you are…</span>`;
            }
            const msg = this._geo.message || 'Share your location to centre the scope on you.';
            return `<i class="fa-solid fa-location-crosshairs"></i>
                    <span>${esc(msg)}</span>
                    <button type="button" class="nr-note-btn" data-nr-retry>Try again</button>`;
        }
        if (this._mode === 'airport') {
            return this._icao
                ? `<i class="fa-solid fa-circle-question"></i><span>No airport matches ${esc(this._icao)}.</span>`
                : `<i class="fa-solid fa-keyboard"></i><span>Type an ICAO code above.</span>`;
        }
        return `<i class="fa-solid fa-map-location-dot"></i><span>Waiting for the map.</span>`;
    },

    /**
     * One blip per contact. Position is bearing + scaled range from the centre;
     * the arrow is rotated to the aircraft's heading so a glance at the scope
     * shows which way the traffic is pointing, not just where it is.
     */
    _blipsHTML(contacts) {
        return contacts.slice(0, MAX_BLIPS).map(c => {
            const r = SCOPE_R * Math.min(1, c.nm / this._rangeNm);
            const rad = toRad(c.brg);
            const x = SCOPE_CX + r * Math.sin(rad);
            const y = SCOPE_CY - r * Math.cos(rad);
            const { color } = bandFor(c.alt, c.onGround);
            const selected = this._selectedId && String(c.flightId) === this._selectedId;
            const name = c.callsign || c.username || '';

            return `
                <g class="nr-blip ${selected ? 'is-selected' : ''}"
                   transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${(c.heading || 0).toFixed(1)})"
                   data-nr-flight="${esc(c.flightId)}" role="button" tabindex="0"
                   aria-label="${esc(name)} — ${distText(c.nm)} nautical miles ${compassPoint(c.brg)}">
                    ${selected ? `<circle r="8" class="nr-blip-halo"></circle>` : ''}
                    <path d="M 0 -5.2 L 3.4 4.4 L 0 2.4 L -3.4 4.4 Z" fill="${color}"></path>
                    <circle r="9" fill="transparent"></circle>
                </g>
            `;
        }).join('');
    },

    _rowHTML(c) {
        const { color } = bandFor(c.alt, c.onGround);
        const t = trend(c.vs);
        const selected = this._selectedId && String(c.flightId) === this._selectedId;
        const title = c.callsign || c.username || 'Unknown';
        const subBits = [];
        if (c.acName) subBits.push(c.acName);
        if (c.dep && c.arr) subBits.push(`${c.dep} → ${c.arr}`);
        else if (c.username && c.username !== title) subBits.push(c.username);

        return `
            <button type="button" class="nr-row ${selected ? 'is-selected' : ''}" data-nr-flight="${esc(c.flightId)}">
                <span class="nr-row-bar" style="background:${color}"></span>
                <span class="nr-row-main">
                    <span class="nr-row-title">${esc(title)}</span>
                    <span class="nr-row-sub">${esc(subBits.join(' · ')) || '&nbsp;'}</span>
                </span>
                <span class="nr-row-nums">
                    <span class="nr-row-dist">${distText(c.nm)}<small> NM</small></span>
                    <span class="nr-row-brg">${String(Math.round(c.brg)).padStart(3, '0')}° ${compassPoint(c.brg)}</span>
                </span>
                <span class="nr-row-alt">
                    <span class="nr-row-fl" style="color:${color}">${altText(c.alt, c.onGround)}</span>
                    <span class="nr-row-spd" title="${esc(t.title)}">${Number.isFinite(c.speed) ? Math.round(c.speed) : '—'} kt <em>${t.glyph}</em></span>
                </span>
            </button>
        `;
    },

    // ---------------- styles ----------------

    _injectStyles() {
        if (document.getElementById('nearby-radar-styles')) return;
        const style = document.createElement('style');
        style.id = 'nearby-radar-styles';
        style.textContent = `
            /* Scoped to .nr-root so both shells get the same look — the mobile
               sheet tags its own body .nr-window and is not an .info-window. */
            .nr-root { --nr-dim: #71717a; font-family: var(--font-ui, sans-serif); }

            /* Width is desktop-panel-only: doubled up so it beats
               .info-window's own width regardless of which stylesheet is
               injected first, since equal specificity would otherwise make the
               winner depend on boot order. */
            .info-window.nr-window { width: 420px; }
            .nr-window .nr-content { padding: 14px 16px 16px; overflow-y: auto; }

            /* --- origin selector --- */
            .nr-modes {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 6px;
                margin-bottom: 10px;
            }
            .nr-mode {
                display: flex; flex-direction: column; align-items: center; gap: 4px;
                padding: 8px 4px;
                background: var(--bg-subtle, rgba(255,255,255,0.05));
                border: 1px solid var(--border-glass, rgba(255,255,255,0.1));
                border-radius: var(--radius-sm, 8px);
                color: var(--text-secondary, #a1a1aa);
                font-size: 0.68rem; font-weight: 600; letter-spacing: 0.02em;
                cursor: pointer;
                transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
            }
            .nr-mode i { font-size: 0.9rem; }
            .nr-mode:hover { color: var(--text-primary, #fafafa); }
            .nr-mode.is-on {
                background: rgba(56, 189, 248, 0.16);
                border-color: rgba(56, 189, 248, 0.45);
                color: #e0f2fe;
            }

            .nr-icao-row {
                display: flex; align-items: center; gap: 8px;
                margin-bottom: 10px; padding: 8px 12px;
                background: var(--bg-subtle, rgba(255,255,255,0.05));
                border: 1px solid var(--border-glass, rgba(255,255,255,0.1));
                border-radius: var(--radius-sm, 8px);
                color: var(--nr-dim);
            }
            .nr-icao-row[hidden] { display: none; }
            .nr-icao-input {
                flex: 1; min-width: 0;
                background: transparent; border: 0; outline: none;
                color: var(--text-primary, #fafafa);
                font-family: var(--font-data, monospace);
                font-size: 0.9rem; letter-spacing: 0.12em; text-transform: uppercase;
            }
            .nr-icao-input::placeholder { color: var(--nr-dim); letter-spacing: 0.02em; }

            /* --- header --- */
            .nr-head {
                display: flex; align-items: center; justify-content: space-between; gap: 10px;
                margin-bottom: 8px;
            }
            .nr-head-text { display: flex; flex-direction: column; min-width: 0; }
            .nr-head-label {
                font-size: 0.95rem; font-weight: 700;
                color: var(--text-primary, #fafafa);
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .nr-head-sub { font-size: 0.7rem; color: var(--nr-dim); }
            .nr-bell {
                flex: none; width: 34px; height: 34px; border-radius: 50%;
                background: var(--bg-subtle, rgba(255,255,255,0.05));
                border: 1px solid var(--border-glass, rgba(255,255,255,0.1));
                color: var(--nr-dim); cursor: pointer;
                transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
            }
            .nr-bell.is-on {
                background: rgba(56, 189, 248, 0.18);
                border-color: rgba(56, 189, 248, 0.45);
                color: #7dd3fc;
            }

            /* --- scope --- */
            .nr-scope-wrap { position: relative; display: grid; place-items: center; margin: 2px 0 10px; }
            .nr-scope { width: 100%; max-width: 260px; height: auto; display: block; }
            .nr-ring { fill: none; stroke: rgba(255,255,255,0.10); stroke-width: 0.8; }
            .nr-ring.is-outer { stroke: rgba(56, 189, 248, 0.35); stroke-width: 1.1; }
            .nr-cross { stroke: rgba(255,255,255,0.07); stroke-width: 0.7; }
            .nr-tick {
                fill: var(--nr-dim); font-size: 8px; font-weight: 700;
                text-anchor: middle; font-family: var(--font-data, monospace);
            }
            .nr-ring-label {
                fill: rgba(148,163,184,0.75); font-size: 7px;
                font-family: var(--font-data, monospace);
            }
            .nr-origin-dot { fill: #38bdf8; }
            .nr-sweep { transform-origin: ${SCOPE_CX}px ${SCOPE_CY}px; animation: nr-sweep 4s linear infinite; }
            @keyframes nr-sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .nr-blip { cursor: pointer; }
            .nr-blip:focus { outline: none; }
            .nr-blip-halo { fill: none; stroke: #ffffff; stroke-width: 1.2; opacity: 0.9; }
            .nr-blip:focus-visible .nr-blip-halo,
            .nr-blip:focus-visible path { stroke: #ffffff; stroke-width: 1; }

            .nr-scope-note {
                position: absolute; inset: 0;
                display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
                padding: 12px; text-align: center;
                background: radial-gradient(circle at center, rgba(24,24,27,0.92), rgba(24,24,27,0.72));
                border-radius: 50%;
                color: var(--text-secondary, #a1a1aa); font-size: 0.75rem; line-height: 1.35;
            }
            .nr-scope-note[hidden] { display: none; }
            .nr-scope-note i { font-size: 1.2rem; color: #38bdf8; }
            .nr-note-btn {
                padding: 5px 12px; border-radius: 999px;
                background: rgba(56, 189, 248, 0.18);
                border: 1px solid rgba(56, 189, 248, 0.4);
                color: #e0f2fe; font-size: 0.7rem; font-weight: 600; cursor: pointer;
            }

            /* --- range + legend --- */
            .nr-ranges { display: flex; align-items: center; gap: 5px; margin-bottom: 8px; }
            .nr-range {
                flex: 1; padding: 6px 0;
                background: var(--bg-subtle, rgba(255,255,255,0.05));
                border: 1px solid var(--border-glass, rgba(255,255,255,0.1));
                border-radius: var(--radius-sm, 8px);
                color: var(--text-secondary, #a1a1aa);
                font-family: var(--font-data, monospace); font-size: 0.72rem; font-weight: 700;
                cursor: pointer; transition: background 0.18s ease, color 0.18s ease;
            }
            .nr-range.is-on {
                background: rgba(56, 189, 248, 0.16);
                border-color: rgba(56, 189, 248, 0.45);
                color: #e0f2fe;
            }
            .nr-range-unit { font-size: 0.62rem; color: var(--nr-dim); letter-spacing: 0.08em; }

            .nr-legend {
                display: flex; flex-wrap: wrap; gap: 4px 10px;
                margin-bottom: 10px; font-size: 0.6rem; color: var(--nr-dim);
            }
            .nr-key { display: inline-flex; align-items: center; gap: 4px; }
            .nr-key i { width: 7px; height: 7px; border-radius: 2px; display: inline-block; }

            /* --- list --- */
            .nr-summary {
                display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
                margin-bottom: 6px; font-size: 0.7rem; color: var(--nr-dim);
            }
            .nr-summary strong { color: var(--text-primary, #fafafa); font-size: 0.85rem; }
            .nr-summary-split { font-size: 0.65rem; }

            .nr-list { display: flex; flex-direction: column; gap: 4px; }
            .nr-row {
                display: grid;
                grid-template-columns: 3px minmax(0, 1fr) auto auto;
                align-items: center; gap: 10px;
                width: 100%; padding: 8px 10px 8px 0; text-align: left;
                background: var(--bg-subtle, rgba(255,255,255,0.05));
                border: 1px solid var(--border-glass, rgba(255,255,255,0.1));
                border-radius: var(--radius-sm, 8px);
                color: inherit; cursor: pointer; overflow: hidden;
                transition: background 0.16s ease, border-color 0.16s ease;
            }
            .nr-row:hover { background: rgba(255,255,255,0.09); }
            .nr-row.is-selected { border-color: rgba(56, 189, 248, 0.55); background: rgba(56, 189, 248, 0.10); }
            .nr-row-bar { align-self: stretch; }
            .nr-row-main { display: flex; flex-direction: column; min-width: 0; padding-left: 8px; }
            .nr-row-title {
                font-size: 0.8rem; font-weight: 700; color: var(--text-primary, #fafafa);
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .nr-row-sub {
                font-size: 0.65rem; color: var(--nr-dim);
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            }
            .nr-row-nums, .nr-row-alt { display: flex; flex-direction: column; align-items: flex-end; }
            .nr-row-dist {
                font-family: var(--font-data, monospace); font-size: 0.85rem; font-weight: 700;
                color: var(--text-primary, #fafafa); line-height: 1.15;
            }
            .nr-row-dist small { font-size: 0.55rem; color: var(--nr-dim); font-weight: 500; }
            .nr-row-brg, .nr-row-spd {
                font-family: var(--font-data, monospace); font-size: 0.6rem; color: var(--nr-dim);
            }
            .nr-row-fl { font-family: var(--font-data, monospace); font-size: 0.78rem; font-weight: 700; line-height: 1.15; }
            .nr-row-spd em { font-style: normal; }

            .nr-more, .nr-empty {
                padding: 14px 8px; text-align: center;
                font-size: 0.7rem; color: var(--nr-dim);
            }
            .nr-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; }
            .nr-empty i { font-size: 1.1rem; opacity: 0.7; }
            .nr-empty-sub { font-size: 0.62rem; opacity: 0.8; }

            /* A sweeping radar is decoration, not information — it is the first
               thing to go when the viewer has asked for less motion. */
            @media (prefers-reduced-motion: reduce) {
                .nr-sweep { animation: none; opacity: 0.35; }
            }

            @media (max-width: 480px) {
                .info-window.nr-window { width: 95vw; }
                .nr-scope { max-width: 300px; }
                .nr-mode { font-size: 0.64rem; }
            }
        `;
        document.head.appendChild(style);
    },
};

if (typeof window !== 'undefined') {
    window.NearbyRadarUI = NearbyRadarUI;
}

export default NearbyRadarUI;
