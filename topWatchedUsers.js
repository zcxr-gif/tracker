/**
 * topWatchedUsers.js
 *
 * Unified left-rail panel that combines the server switcher with the
 * "Most Tracked" leaderboard into a single Planefinder-style stack of
 * collapsible cards. Replaces LandingUI's standalone server pill (and
 * the mobile server pill's default sheet) so the two features coexist
 * inside one component.
 *
 * Data source: existing /api/leaderboard/top endpoint.
 * Server changes: emits the same `serverChange` CustomEvent that
 * LandingUI does, so the rest of the app keeps working unchanged.
 */

const REFRESH_MS = 60 * 1000;
const TOP_N = 5;
const MOBILE_BREAKPOINT = 992;

const SERVERS = [
    { val: 'Expert',   label: 'Expert',   color: '#eab308', icon: 'fa-trophy' },
    { val: 'Training', label: 'Training', color: '#a855f7', icon: 'fa-graduation-cap' },
    { val: 'Casual',   label: 'Casual',   color: '#22c55e', icon: 'fa-plane-arrival' },
];

function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function getStoredTheme() {
    try {
        const t = localStorage.getItem('pui-theme');
        return t === 'light' ? 'light' : 'dark';
    } catch (_) { return 'dark'; }
}

function getActiveServerShort() {
    try {
        return (localStorage.getItem('preferredServer') || 'Expert Server').split(' ')[0];
    } catch (_) { return 'Expert'; }
}

// Pick the exact live flight a leaderboard row points at. The backend now
// tallies views per (pilot, flight, day), so each row carries a `flightId`
// — we look it up directly. If `flightId` is missing (older backend, or a
// NO_FLIGHT-bucketed row) we fall back to a heuristic over the pilot's
// concurrent flights: prefer ones with a real flight plan, tiebreak by
// altitude.
function describeFeature(f) {
    if (!f) return null;
    const p = f.properties || {};
    let acData = p.aircraft;
    if (typeof acData === 'string') {
        try { acData = JSON.parse(acData); } catch { acData = null; }
    }
    return {
        feature: f,
        flightId: p.flightId,
        callsign: p.callsign || '',
        category: p.category || '',
        aircraftName: (acData && acData.aircraftName) || p.aircraftName || '',
        registration: p.registration || (acData && acData.registration) || '',
        departureIcao: p.departureIcao || '',
        arrivalIcao: p.arrivalIcao || '',
        coords: f.geometry && f.geometry.coordinates,
    };
}

function lookupLive(row) {
    const flights = (typeof window.getLiveFlightData === 'function')
        ? (window.getLiveFlightData() || [])
        : [];

    // Preferred path: the backend told us exactly which flight this row is.
    const fid = row && row.flightId;
    if (fid) {
        const match = flights.find(f => f && f.properties && f.properties.flightId === fid);
        if (match) return describeFeature(match);
        // Backend has a flightId but the local cache doesn't (the flight may
        // have just ended on this server or we're viewing a different
        // server). Fall through to the username heuristic so we still show
        // something useful.
    }

    const target = String((row && row.pilotName) || '').toLowerCase();
    if (!target) return null;

    const matches = [];
    for (const f of flights) {
        const p = f && f.properties;
        if (!p) continue;
        if (String(p.username || '').toLowerCase() === target) matches.push(f);
    }
    if (!matches.length) return null;

    matches.sort((a, b) => {
        const pa = a.properties, pb = b.properties;
        const planA = (pa.departureIcao && pa.arrivalIcao) ? 1 : 0;
        const planB = (pb.departureIcao && pb.arrivalIcao) ? 1 : 0;
        if (planA !== planB) return planB - planA;
        return (Number(pb.altitude) || 0) - (Number(pa.altitude) || 0);
    });
    return describeFeature(matches[0]);
}

function lookupAirportCity(icao) {
    if (!icao) return '';
    const data = window.airportsData && window.airportsData[icao];
    if (!data) return '';
    return data.city || data.name || '';
}

export const TopWatchedUsers = {
    _apiBase: null,
    _data: [],
    _theme: 'dark',
    _timer: null,
    _liveTimer: null,
    _serverOpen: false,
    // Tracked card open by default on desktop, collapsed on mobile so it
    // doesn't blanket the map.
    _trackedOpen: typeof window === 'undefined' || window.innerWidth > MOBILE_BREAKPOINT,

    init(apiBaseUrl) {
        if (this._apiBase) return;
        this._apiBase = apiBaseUrl;
        this._theme = getStoredTheme();

        this._injectStyles();
        this._mount();
        this._bindGlobalEvents();

        this._refresh();
        this._timer = setInterval(() => this._refresh(), REFRESH_MS);
        // Cheap re-render every 10s so live indicators stay in sync without
        // hitting the leaderboard endpoint.
        this._liveTimer = setInterval(() => this._render(), 10_000);
    },

    // ---------------- styling ----------------

    _injectStyles() {
        if (document.getElementById('twu-styles')) return;
        const style = document.createElement('style');
        style.id = 'twu-styles';
        style.textContent = `
            /* Hide LandingUI's standalone server pill — the unified stack
               owns server switching now. */
            #inflight-tactical-ui #server-selector { display: none !important; }

            .twu-stack {
                position: absolute;
                top: 30px;
                left: 40px;
                width: 300px;
                z-index: 1500;
                font-family: 'Inter', sans-serif;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: auto;
                opacity: 0;
                transform: translateY(-6px);
                transition: opacity 0.4s ease, transform 0.4s ease;
                color: var(--lui-text-main, #fff);
            }
            .twu-stack.ready { opacity: 1; transform: translateY(0); }

            .twu-card {
                background: var(--lui-glass-bg, rgba(10, 10, 10, 0.85));
                border: 1px solid var(--lui-border-base, rgba(255, 255, 255, 0.08));
                border-radius: 16px;
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
                overflow: hidden;
            }
            .twu-stack[data-theme="light"] .twu-card {
                background: rgba(255, 255, 255, 0.85);
                border-color: rgba(0, 0, 0, 0.08);
            }

            .twu-card-head {
                display: flex;
                align-items: center;
                gap: 12px;
                width: 100%;
                padding: 14px 18px;
                background: transparent;
                border: none;
                cursor: pointer;
                color: inherit;
                text-align: left;
            }
            .twu-card-title {
                flex: 1;
                font-size: 0.95rem;
                font-weight: 700;
                color: var(--lui-text-main, #fff);
            }
            .twu-stack[data-theme="light"] .twu-card-title { color: #111827; }
            .twu-card-meta {
                font-size: 0.7rem;
                font-weight: 700;
                color: var(--lui-text-gray-2, #71717a);
                background: var(--lui-border-base, rgba(255, 255, 255, 0.05));
                padding: 4px 10px;
                border-radius: 100px;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .twu-card-meta .twu-meta-dot {
                width: 6px; height: 6px;
                background: #10b981;
                border-radius: 50%;
                box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
            }
            .twu-card-chev {
                font-size: 0.75rem;
                opacity: 0.55;
                transition: transform 0.3s ease;
            }
            .twu-card.is-open .twu-card-chev { transform: rotate(180deg); opacity: 0.9; }

            .twu-card-body {
                display: grid;
                grid-template-rows: 1fr;
                transition: grid-template-rows 0.3s ease;
            }
            .twu-card:not(.is-open) .twu-card-body { grid-template-rows: 0fr; }
            .twu-card-body-inner {
                overflow: hidden;
                min-height: 0;
            }
            .twu-card-body-pad {
                padding: 4px 8px 10px;
            }

            /* Tabs */
            .twu-tabs {
                display: flex;
                gap: 6px;
                padding: 4px 10px 12px;
            }
            .twu-tab {
                background: transparent;
                border: 1px solid var(--lui-border-base, rgba(255, 255, 255, 0.08));
                color: var(--lui-text-gray-1, #a1a1aa);
                padding: 7px 16px;
                border-radius: 100px;
                font-size: 0.78rem;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.2s;
            }
            .twu-tab.active {
                background: var(--lui-active-bg, rgba(255, 255, 255, 0.12));
                color: var(--lui-text-main, #fff);
                border-color: var(--lui-border-strong, rgba(255, 255, 255, 0.15));
            }
            .twu-tab:not(.active):hover {
                color: var(--lui-text-main, #fff);
                border-color: var(--lui-border-strong, rgba(255, 255, 255, 0.15));
            }
            .twu-stack[data-theme="light"] .twu-tab.active {
                background: rgba(0, 0, 0, 0.08);
                color: #111827;
            }

            /* Leaderboard rows. The desktop stack caps the list at ~3 rows
               so positions 4–5 require a quick scroll, matching the
               Planefinder Explore card. */
            .twu-list { list-style: none; margin: 0; padding: 0 6px; overflow-y: auto; }
            .twu-stack .twu-list { max-height: 210px; }
            .twu-stack .twu-list::-webkit-scrollbar { width: 6px; }
            .twu-stack .twu-list::-webkit-scrollbar-thumb {
                background: var(--lui-border-base, rgba(255, 255, 255, 0.08));
                border-radius: 3px;
            }
            .twu-item {
                display: grid;
                grid-template-columns: 22px 1fr;
                column-gap: 14px;
                align-items: start;
                padding: 12px 10px;
                border-radius: 10px;
                cursor: pointer;
                transition: background 0.2s ease;
            }
            .twu-item:hover, .twu-item:focus-visible {
                background: var(--lui-hover-bg, rgba(255, 255, 255, 0.05));
                outline: none;
            }
            .twu-rank {
                font-size: 0.95rem;
                font-weight: 600;
                color: var(--lui-text-gray-2, #71717a);
                text-align: center;
                padding-top: 2px;
                font-variant-numeric: tabular-nums;
            }

            .twu-row-main { min-width: 0; }
            .twu-row-top {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }
            .twu-name {
                font-size: 1rem;
                font-weight: 800;
                color: var(--lui-text-main, #fff);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 160px;
                letter-spacing: 0.2px;
            }
            .twu-stack[data-theme="light"] .twu-name { color: #111827; }
            .twu-tag {
                font-size: 0.7rem;
                font-weight: 600;
                color: var(--lui-text-gray-1, #a1a1aa);
                background: rgba(255, 255, 255, 0.06);
                padding: 3px 9px;
                border-radius: 100px;
                white-space: nowrap;
                line-height: 1.2;
            }
            .twu-stack[data-theme="light"] .twu-tag,
            .twu-sheet[data-theme="light"] .twu-tag {
                background: rgba(0, 0, 0, 0.06);
                color: #4b5563;
            }
            .twu-row-sub {
                font-size: 0.82rem;
                color: var(--lui-text-gray-1, #a1a1aa);
                margin-top: 4px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .twu-stack[data-theme="light"] .twu-row-sub,
            .twu-sheet[data-theme="light"] .twu-row-sub { color: #6b7280; }
            .twu-empty, .twu-loading {
                padding: 16px;
                font-size: 0.8rem;
                color: var(--lui-text-gray-2, #71717a);
                text-align: center;
                font-style: italic;
            }

            /* Server card body */
            .twu-server-list {
                display: flex;
                flex-direction: column;
                gap: 6px;
                padding: 0 6px 6px;
            }
            .twu-server-opt {
                display: flex;
                align-items: center;
                gap: 12px;
                width: 100%;
                background: transparent;
                border: 1px solid var(--lui-border-base, rgba(255, 255, 255, 0.05));
                color: var(--lui-text-gray-1, #a1a1aa);
                padding: 10px 12px;
                border-radius: 12px;
                cursor: pointer;
                text-align: left;
                transition: all 0.2s;
            }
            .twu-server-opt:hover {
                background: var(--lui-hover-bg, rgba(255, 255, 255, 0.05));
                color: var(--lui-text-main, #fff);
            }
            .twu-server-opt.active {
                background: var(--lui-accent-hover, rgba(56, 189, 248, 0.1));
                color: var(--lui-accent, #38bdf8);
                border-color: var(--lui-accent, #38bdf8);
            }
            .twu-server-opt .twu-server-icon {
                width: 32px; height: 32px;
                border-radius: 9px;
                display: grid; place-items: center;
                font-size: 0.9rem;
                background: rgba(255, 255, 255, 0.04);
            }
            .twu-server-opt .twu-server-name {
                flex: 1;
                font-weight: 700;
                font-size: 0.9rem;
            }
            .twu-server-opt .twu-server-check {
                opacity: 0;
                color: var(--lui-accent, #38bdf8);
            }
            .twu-server-opt.active .twu-server-check { opacity: 1; }

            /* Stay out of the way when a mobile flight/airport sheet is open
               (sector-ops-mobile-ui.js flips this class on the map container
               and hides the rest of the HUD the same way). */
            #sector-ops-map-fullscreen.mobile-window-open .twu-stack {
                opacity: 0;
                pointer-events: none;
            }

            /* Mobile: the desktop stack is hidden — the leaderboard lives
               inside a proper bottom-sheet (#twu-mobile-sheet) triggered
               from the mobile HUD action stack. Server switching is
               handled by the native mobile-server-pill. */
            @media (max-width: ${MOBILE_BREAKPOINT}px) {
                .twu-stack { display: none !important; }
            }

            /* ---- Mobile bottom-sheet ---- */
            #twu-mobile-overlay {
                position: absolute;
                inset: 0;
                background: rgba(0, 0, 0, 0.55);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                z-index: 2000;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.3s ease;
            }
            #twu-mobile-overlay.visible {
                opacity: 1;
                pointer-events: auto;
            }

            .twu-sheet {
                position: absolute;
                left: 0; right: 0; bottom: 0;
                background: rgba(20, 22, 32, 0.96);
                backdrop-filter: blur(28px);
                -webkit-backdrop-filter: blur(28px);
                border-top: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 22px 22px 0 0;
                padding: 8px 0 0;
                padding-bottom: env(safe-area-inset-bottom, 0px);
                z-index: 2001;
                transform: translateY(100%);
                transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
                box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.5);
                max-height: 75vh;
                display: flex;
                flex-direction: column;
                color: #fff;
                font-family: 'Inter', sans-serif;
            }
            .twu-sheet.visible { transform: translateY(0); }
            .twu-sheet[data-theme="light"] {
                background: rgba(255, 255, 255, 0.96);
                color: #111827;
                border-top-color: rgba(0, 0, 0, 0.08);
            }

            .twu-sheet-grabber {
                width: 38px; height: 4px;
                background: rgba(255, 255, 255, 0.18);
                border-radius: 999px;
                margin: 6px auto 12px;
            }
            .twu-sheet[data-theme="light"] .twu-sheet-grabber {
                background: rgba(0, 0, 0, 0.18);
            }

            .twu-sheet-head {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 0 18px 14px;
            }
            .twu-sheet-title {
                font-size: 1.1rem;
                font-weight: 700;
                flex: 1;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .twu-sheet-title i {
                color: #eab308;
                font-size: 1rem;
            }
            .twu-sheet-meta {
                font-size: 0.7rem;
                font-weight: 700;
                color: #94a3b8;
                background: rgba(255, 255, 255, 0.06);
                padding: 5px 10px;
                border-radius: 100px;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }
            .twu-sheet[data-theme="light"] .twu-sheet-meta {
                background: rgba(0, 0, 0, 0.06);
                color: #4b5563;
            }
            .twu-sheet-meta .twu-meta-dot {
                width: 6px; height: 6px;
                background: #10b981;
                border-radius: 50%;
                box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
            }
            .twu-sheet-close {
                width: 30px; height: 30px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.08);
                color: #ddd;
                border: none;
                display: grid;
                place-items: center;
                font-size: 0.85rem;
                cursor: pointer;
            }
            .twu-sheet-close:active { background: rgba(255, 255, 255, 0.15); }
            .twu-sheet[data-theme="light"] .twu-sheet-close {
                background: rgba(0, 0, 0, 0.06);
                color: #4b5563;
            }

            .twu-sheet .twu-list {
                padding: 4px 10px 16px;
                margin: 0;
                list-style: none;
                overflow-y: auto;
                -webkit-overflow-scrolling: touch;
                flex: 1;
            }
            .twu-sheet .twu-item {
                display: grid;
                grid-template-columns: 28px 1fr;
                column-gap: 12px;
                align-items: start;
                padding: 12px 8px;
                border-radius: 12px;
                cursor: pointer;
            }
            .twu-sheet .twu-item:active {
                background: rgba(255, 255, 255, 0.06);
            }
            .twu-sheet[data-theme="light"] .twu-sheet .twu-item:active,
            .twu-sheet[data-theme="light"] .twu-item:active {
                background: rgba(0, 0, 0, 0.05);
            }
            .twu-sheet .twu-rank {
                font-size: 1rem;
                font-weight: 700;
                color: #94a3b8;
                text-align: center;
                padding-top: 2px;
                font-variant-numeric: tabular-nums;
            }
            .twu-sheet .twu-row-main { min-width: 0; }
            .twu-sheet .twu-row-top {
                display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
            }
            .twu-sheet .twu-name {
                font-size: 1rem;
                font-weight: 700;
                color: inherit;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 60vw;
            }
            .twu-sheet .twu-row-sub {
                font-size: 0.82rem;
                color: #94a3b8;
                margin-top: 4px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .twu-sheet[data-theme="light"] .twu-sheet .twu-row-sub {
                color: #6b7280;
            }
            .twu-sheet .twu-empty,
            .twu-sheet .twu-loading {
                padding: 24px;
                text-align: center;
                color: #94a3b8;
                font-size: 0.85rem;
                font-style: italic;
            }
        `;
        document.head.appendChild(style);
    },

    // ---------------- mount ----------------
    //
    // The same stack ships to desktop and mobile. On mobile the CSS hides
    // the Server card (the native server pill already handles that) and
    // repositions/narrows the Most Tracked card so it sits below the pill
    // as a collapsible glance.

    _mount() {
        const map = document.getElementById('sector-ops-map-fullscreen');
        if (!map || document.getElementById('twu-stack')) return;

        const stack = document.createElement('div');
        stack.id = 'twu-stack';
        stack.className = 'twu-stack';
        stack.setAttribute('data-theme', this._theme);
        stack.innerHTML = `
            ${this._cardTrackedHTML()}
            ${this._cardServerHTML()}
        `;
        map.appendChild(stack);
        requestAnimationFrame(() => stack.classList.add('ready'));

        this._wireCards(stack);
    },

    _cardTrackedHTML() {
        return `
            <section class="twu-card ${this._trackedOpen ? 'is-open' : ''}" data-card="tracked">
                <button type="button" class="twu-card-head" data-toggle="tracked" aria-expanded="${this._trackedOpen}">
                    <span class="twu-card-title">Most Tracked</span>
                    <i class="fa-solid fa-chevron-up twu-card-chev"></i>
                </button>
                <div class="twu-card-body">
                    <div class="twu-card-body-inner">
                        <div class="twu-tabs" role="tablist">
                            <button type="button" class="twu-tab active" data-tab="trending">Trending</button>
                        </div>
                        <ul class="twu-list" id="twu-list-desktop" role="listbox">
                            <li class="twu-loading">Loading…</li>
                        </ul>
                    </div>
                </div>
            </section>
        `;
    },

    _cardServerHTML() {
        const active = getActiveServerShort();
        return `
            <section class="twu-card ${this._serverOpen ? 'is-open' : ''}" data-card="server">
                <button type="button" class="twu-card-head" data-toggle="server" aria-expanded="${this._serverOpen}">
                    <span class="twu-card-title">Server</span>
                    <span class="twu-card-meta">
                        <span class="twu-meta-dot"></span>
                        <span data-server-tag>${esc(active.toUpperCase())}</span>
                    </span>
                    <i class="fa-solid fa-chevron-up twu-card-chev"></i>
                </button>
                <div class="twu-card-body">
                    <div class="twu-card-body-inner">
                        <div class="twu-server-list" data-server-list>
                            ${this._serverOptionsHTML(active)}
                        </div>
                    </div>
                </div>
            </section>
        `;
    },

    _serverOptionsHTML(activeShort) {
        return SERVERS.map(s => `
            <button type="button" class="twu-server-opt ${s.val === activeShort ? 'active' : ''}"
                    data-server="${s.val}">
                <span class="twu-server-icon" style="color:${s.color};background:${s.color}1a;">
                    <i class="fa-solid ${s.icon}"></i>
                </span>
                <span class="twu-server-name">${s.label}</span>
                <i class="fa-solid fa-check twu-server-check"></i>
            </button>
        `).join('');
    },

    _wireCards(root) {
        root.querySelectorAll('[data-toggle]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.toggle;
                if (key === 'tracked') this._trackedOpen = !this._trackedOpen;
                else if (key === 'server') this._serverOpen = !this._serverOpen;
                const card = btn.closest('.twu-card');
                if (card) card.classList.toggle('is-open');
                btn.setAttribute('aria-expanded', card && card.classList.contains('is-open') ? 'true' : 'false');
            });
        });
        this._wireServerOpts(root);
    },

    _wireServerOpts(root) {
        root.querySelectorAll('.twu-server-opt').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const val = btn.dataset.server;
                this._selectServer(val);
            });
        });
    },

    _selectServer(val) {
        if (!val) return;
        // Keep LandingUI's internal state in sync (its tooltips read it).
        if (window.LandingUI) window.LandingUI._currentServer = val;
        window.dispatchEvent(new CustomEvent('serverChange', { detail: { server: val } }));
        this._renderServerCard();
    },

    // ---------------- events ----------------

    _bindGlobalEvents() {
        window.addEventListener('serverChange', () => {
            this._renderServerCard();
            this._render();
            // Keep the mobile sheet's server badge in sync.
            const sheet = document.getElementById('twu-mobile-sheet');
            if (sheet) {
                const tag = sheet.querySelector('.twu-sheet-meta > span:last-child');
                if (tag) tag.textContent = getActiveServerShort().toUpperCase();
            }
            // Re-fetch shortly so live dots can re-light once flights stream in.
            setTimeout(() => this._refresh(), 1500);
        });
        window.addEventListener('puiThemeChanged', (e) => {
            const t = e && e.detail && e.detail.theme;
            if (t === 'light' || t === 'dark') this._theme = t;
            const stack = document.getElementById('twu-stack');
            if (stack) stack.setAttribute('data-theme', this._theme);
            const sheet = document.getElementById('twu-mobile-sheet');
            if (sheet) sheet.setAttribute('data-theme', this._theme);
        });
    },

    // ---------------- data + render ----------------

    async _refresh() {
        try {
            const res = await fetch(`${this._apiBase}/api/leaderboard/top?limit=${TOP_N}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const rows = await res.json();
            this._data = Array.isArray(rows) ? rows.slice(0, TOP_N) : [];
        } catch (err) {
            console.warn('[TopWatched] fetch failed:', err && err.message ? err.message : err);
        }
        this._render();
    },

    _render() {
        this._renderInto('twu-list-desktop');
        this._renderInto('twu-list-mobile');
    },

    _renderInto(listId) {
        const list = document.getElementById(listId);
        if (!list) return;

        if (!this._data.length) {
            list.innerHTML = `<li class="twu-empty">No flights tracked yet today</li>`;
            return;
        }

        list.innerHTML = this._data.map((row, i) => this._rowHTML(row, i)).join('');

        list.querySelectorAll('.twu-item').forEach(li => {
            const go = () => this._focus(li.dataset.username, li.dataset.flightId);
            li.addEventListener('click', go);
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
            });
        });
    },

    _rowHTML(row, i) {
        const name = String(row.pilotName || '').trim();
        const count = Number(row.viewCount || 0);
        const safeName = esc(name);
        const live = lookupLive(row);

        // Primary label: live callsign if available, otherwise the pilot
        // name (e.g. "GILDA" in the reference design).
        const primary = live && live.callsign ? live.callsign : name;
        const safePrimary = esc(primary);

        // Tags: aircraft type code + registration (matches the
        // "[C17] [ZZ172]" style in the reference). Falls back to a
        // single "N views" pill when the pilot isn't currently flying.
        const tags = [];
        if (live && live.category) tags.push(`<span class="twu-tag">${esc(live.category)}</span>`);
        if (live && live.registration) tags.push(`<span class="twu-tag">${esc(live.registration)}</span>`);
        if (!tags.length) tags.push(`<span class="twu-tag">${count} views</span>`);

        // Subtitle: "City ICAO to City ICAO" when there's a plan,
        // otherwise the full aircraft name. Mirrors the screenshot
        // where ferries fall back to just the airframe.
        let sub = '';
        if (live && (live.departureIcao || live.arrivalIcao)) {
            const dep = live.departureIcao || '';
            const arr = live.arrivalIcao || '';
            const depCity = lookupAirportCity(dep);
            const arrCity = lookupAirportCity(arr);
            const depLabel = depCity ? `${esc(depCity)} ${esc(dep)}` : esc(dep || '???');
            const arrLabel = arrCity ? `${esc(arrCity)} ${esc(arr)}` : esc(arr || '???');
            sub = `${depLabel} to ${arrLabel}`;
        } else if (live && live.aircraftName) {
            sub = esc(live.aircraftName);
        } else {
            sub = `${count} ${count === 1 ? 'view' : 'views'} today`;
        }

        const title = live ? `${safePrimary} • ${esc(name)}` : safeName;
        const dataFlightId = row && row.flightId ? esc(row.flightId) : '';

        return `
            <li class="twu-item ${live ? 'is-live' : ''}" data-username="${safeName}" data-flight-id="${dataFlightId}"
                role="option" tabindex="0" title="${title}">
                <span class="twu-rank">${i + 1}</span>
                <div class="twu-row-main">
                    <div class="twu-row-top">
                        <span class="twu-name">${safePrimary}</span>
                        ${tags.join('')}
                    </div>
                    <div class="twu-row-sub">${sub}</div>
                </div>
            </li>
        `;
    },

    _renderServerCard() {
        const active = getActiveServerShort();
        // Desktop card
        const stack = document.getElementById('twu-stack');
        if (stack) {
            const tag = stack.querySelector('[data-server-tag]');
            if (tag) tag.textContent = active.toUpperCase();
            const list = stack.querySelector('[data-server-list]');
            if (list) {
                list.innerHTML = this._serverOptionsHTML(active);
                this._wireServerOpts(stack);
            }
        }
    },

    // ---------------- click-through to map ----------------

    _focus(username, flightId) {
        if (!username && !flightId) return;
        const live = lookupLive({ pilotName: username, flightId });
        if (live && live.flightId && live.coords && typeof window.onSearchResultClick === 'function') {
            try {
                window.onSearchResultClick(live.flightId, live.coords[1], live.coords[0]);
            } catch (err) {
                console.warn('[TopWatched] focus failed:', err);
            }
            this._closeMobileSheet();
        } else if (typeof window.showGlobalNotification === 'function') {
            window.showGlobalNotification(`${username || 'This flight'} is not currently flying on this server.`, 'info');
        }
    },

    // ---------------- mobile bottom-sheet ----------------

    openMobileSheet() {
        const map = document.getElementById('sector-ops-map-fullscreen');
        if (!map) return;

        // Close any previous instance so we always animate in fresh.
        this._closeMobileSheet(true);

        const overlay = document.createElement('div');
        overlay.id = 'twu-mobile-overlay';

        const sheet = document.createElement('section');
        sheet.id = 'twu-mobile-sheet';
        sheet.className = 'twu-sheet';
        sheet.setAttribute('data-theme', this._theme);
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-label', 'Most Tracked Pilots');
        sheet.innerHTML = `
            <div class="twu-sheet-grabber"></div>
            <div class="twu-sheet-head">
                <span class="twu-sheet-title">
                    <i class="fa-solid fa-trophy"></i>
                    Most Tracked
                </span>
                <span class="twu-sheet-meta">
                    <span class="twu-meta-dot"></span>
                    <span>${esc(getActiveServerShort().toUpperCase())}</span>
                </span>
                <button type="button" class="twu-sheet-close" aria-label="Close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <ul class="twu-list" id="twu-list-mobile" role="listbox">
                <li class="twu-loading">Loading…</li>
            </ul>
        `;

        map.appendChild(overlay);
        map.appendChild(sheet);

        // Animate in next frame so the transform transition runs.
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
            sheet.classList.add('visible');
        });

        const close = () => this._closeMobileSheet();
        overlay.addEventListener('click', close);
        sheet.querySelector('.twu-sheet-close').addEventListener('click', close);

        // Basic swipe-to-dismiss on the grabber/header.
        let touchStartY = null;
        const header = sheet.querySelector('.twu-sheet-head');
        const grabber = sheet.querySelector('.twu-sheet-grabber');
        const onTouchStart = (e) => {
            if (!e.touches || !e.touches.length) return;
            touchStartY = e.touches[0].clientY;
            sheet.style.transition = 'none';
        };
        const onTouchMove = (e) => {
            if (touchStartY == null || !e.touches || !e.touches.length) return;
            const dy = e.touches[0].clientY - touchStartY;
            if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
        };
        const onTouchEnd = (e) => {
            if (touchStartY == null) return;
            const endY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : touchStartY;
            const dy = endY - touchStartY;
            touchStartY = null;
            sheet.style.transition = '';
            sheet.style.transform = '';
            if (dy > 80) close();
        };
        [header, grabber].forEach(el => {
            if (!el) return;
            el.addEventListener('touchstart', onTouchStart, { passive: true });
            el.addEventListener('touchmove', onTouchMove, { passive: true });
            el.addEventListener('touchend', onTouchEnd);
            el.addEventListener('touchcancel', onTouchEnd);
        });

        // Populate immediately with whatever data we have, then refresh.
        this._renderInto('twu-list-mobile');
        this._refresh();
    },

    _closeMobileSheet(immediate = false) {
        const overlay = document.getElementById('twu-mobile-overlay');
        const sheet = document.getElementById('twu-mobile-sheet');
        if (!overlay && !sheet) return;
        if (immediate) {
            if (overlay) overlay.remove();
            if (sheet) sheet.remove();
            return;
        }
        if (overlay) overlay.classList.remove('visible');
        if (sheet) sheet.classList.remove('visible');
        setTimeout(() => {
            if (overlay) overlay.remove();
            if (sheet) sheet.remove();
        }, 320);
    },
};

if (typeof window !== 'undefined') {
    window.TopWatchedUsers = TopWatchedUsers;
}
