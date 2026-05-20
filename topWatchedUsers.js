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
// Matches LandingUI's own responsive breakpoint (the current mobile UI),
// not the legacy sector-ops-mobile-ui.js one.
const MOBILE_BREAKPOINT = 768;

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

            /* Mobile presentation (matches LandingUI's own 768px breakpoint).
               The stack moves to the very top-left, taking the slot where
               LandingUI's server pill normally sits (we hide that pill and
               recreate it as the Server card). Both cards default to
               collapsed so they read as two compact pills and never blanket
               the map; one tap expands either. Tapping a pilot flies the map. */
            @media (max-width: ${MOBILE_BREAKPOINT}px) {
                .twu-stack {
                    top: calc(env(safe-area-inset-top, 0px) + 15px);
                    left: 15px;
                    right: auto;
                    width: auto;
                    align-items: flex-start;
                    gap: 8px;
                }
                /* Collapsed cards hug their header (compact pills that clear
                   the top-right search blade); expanding one widens it to a
                   readable column. */
                .twu-card { width: max-content; max-width: calc(100vw - 30px); }
                .twu-card.is-open { width: min(calc(100vw - 30px), 300px); }
                .twu-card-head { padding: 10px 14px; }
                .twu-card-title { font-size: 0.8rem; }
                .twu-stack .twu-list { max-height: 220px; }
                .twu-item { padding: 11px 8px; }
                .twu-name { font-size: 0.95rem; }
                /* Drop the "Trending" tab on mobile — vertical space is tight
                   and there's only one tab anyway. */
                .twu-tabs { display: none; }
            }
        `;
        document.head.appendChild(style);
    },

    // ---------------- mount ----------------
    //
    // Mount inside LandingUI's tactical root (#inflight-tactical-ui) so the
    // stack inherits the active theme variables and fades in/out together
    // with the rest of the overlay — including when a flight is opened on
    // mobile (LandingUI.update(false) drops `.active`). The tactical root is
    // created during LandingUI.init() which runs after us, so poll for it.

    _mount() {
        if (document.getElementById('twu-stack')) return;
        const root = document.getElementById('inflight-tactical-ui');
        if (!root) {
            if (!this._mountTries) this._mountTries = 0;
            if (this._mountTries++ > 60) return; // ~30s then give up
            setTimeout(() => this._mount(), 500);
            return;
        }

        const stack = document.createElement('div');
        stack.id = 'twu-stack';
        stack.className = 'twu-stack';
        stack.setAttribute('data-theme', this._theme);
        stack.innerHTML = `
            ${this._cardTrackedHTML()}
            ${this._cardServerHTML()}
        `;
        root.appendChild(stack);
        requestAnimationFrame(() => stack.classList.add('ready'));

        this._wireCards(stack);
        // We may have mounted after the first fetch resolved; paint now.
        this._render();
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
            // Re-fetch shortly so live dots can re-light once flights stream in.
            setTimeout(() => this._refresh(), 1500);
        });
        window.addEventListener('puiThemeChanged', (e) => {
            const t = e && e.detail && e.detail.theme;
            if (t === 'light' || t === 'dark') this._theme = t;
            const stack = document.getElementById('twu-stack');
            if (stack) stack.setAttribute('data-theme', this._theme);
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
        } else if (typeof window.showGlobalNotification === 'function') {
            window.showGlobalNotification(`${username || 'This flight'} is not currently flying on this server.`, 'info');
        }
    },
};

if (typeof window !== 'undefined') {
    window.TopWatchedUsers = TopWatchedUsers;
}
