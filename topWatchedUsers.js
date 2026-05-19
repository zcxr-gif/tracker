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

// Looks up a live flight by pilot name and returns enrichment fields.
function lookupLive(username) {
    const target = String(username || '').toLowerCase();
    if (!target) return null;
    const flights = (typeof window.getLiveFlightData === 'function')
        ? (window.getLiveFlightData() || [])
        : [];
    for (const f of flights) {
        const p = f && f.properties;
        if (!p) continue;
        if (String(p.username || '').toLowerCase() === target) {
            let acData = p.aircraft;
            if (typeof acData === 'string') {
                try { acData = JSON.parse(acData); } catch { acData = null; }
            }
            return {
                feature: f,
                flightId: p.flightId,
                callsign: p.callsign || '',
                category: p.category || (acData && acData.aircraftName) || '',
                aircraftName: (acData && acData.aircraftName) || p.aircraftName || '',
                departureIcao: p.departureIcao || '',
                arrivalIcao: p.arrivalIcao || '',
                coords: f.geometry && f.geometry.coordinates,
            };
        }
    }
    return null;
}

export const TopWatchedUsers = {
    _apiBase: null,
    _data: [],
    _theme: 'dark',
    _timer: null,
    _liveTimer: null,
    _serverOpen: false,
    _trackedOpen: true,

    init(apiBaseUrl) {
        if (this._apiBase) return;
        this._apiBase = apiBaseUrl;
        this._theme = getStoredTheme();

        this._injectStyles();
        this._mountDesktop();
        this._hookMobile();
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

            /* Leaderboard rows */
            .twu-list { list-style: none; margin: 0; padding: 0 6px; max-height: 360px; overflow-y: auto; }
            .twu-list::-webkit-scrollbar { width: 6px; }
            .twu-list::-webkit-scrollbar-thumb {
                background: var(--lui-border-base, rgba(255, 255, 255, 0.08));
                border-radius: 3px;
            }
            .twu-item {
                display: grid;
                grid-template-columns: 22px 30px 1fr;
                column-gap: 12px;
                align-items: start;
                padding: 10px 8px;
                border-radius: 10px;
                cursor: pointer;
                transition: background 0.2s ease;
            }
            .twu-item:hover, .twu-item:focus-visible {
                background: var(--lui-hover-bg, rgba(255, 255, 255, 0.05));
                outline: none;
            }
            .twu-rank {
                font-size: 0.85rem;
                font-weight: 700;
                color: var(--lui-text-gray-2, #71717a);
                text-align: center;
                padding-top: 4px;
                font-variant-numeric: tabular-nums;
            }
            .twu-icon {
                width: 30px; height: 30px;
                border-radius: 8px;
                display: grid; place-items: center;
                background: var(--lui-border-base, rgba(255, 255, 255, 0.05));
                color: var(--lui-text-gray-1, #a1a1aa);
                font-size: 0.85rem;
                margin-top: 2px;
            }
            .twu-item.is-live .twu-icon {
                background: rgba(56, 189, 248, 0.12);
                color: var(--lui-accent, #38bdf8);
            }
            .twu-icon i { transform: rotate(-45deg); }

            .twu-row-main { min-width: 0; }
            .twu-row-top {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-wrap: wrap;
            }
            .twu-name {
                font-size: 0.95rem;
                font-weight: 700;
                color: var(--lui-text-main, #fff);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 130px;
            }
            .twu-stack[data-theme="light"] .twu-name { color: #111827; }
            .twu-tag {
                font-size: 0.65rem;
                font-weight: 700;
                letter-spacing: 0.5px;
                color: var(--lui-text-gray-1, #a1a1aa);
                background: var(--lui-border-base, rgba(255, 255, 255, 0.05));
                border: 1px solid var(--lui-border-base, rgba(255, 255, 255, 0.05));
                padding: 2px 7px;
                border-radius: 5px;
                white-space: nowrap;
            }
            .twu-row-sub {
                font-size: 0.78rem;
                color: var(--lui-text-gray-2, #71717a);
                margin-top: 3px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
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

            /* Desktop stack hidden on mobile — the bottom sheet takes over. */
            @media (max-width: ${MOBILE_BREAKPOINT}px) {
                .twu-stack { display: none; }
            }

            /* Mobile bottom sheet — re-uses the visual language of the
               existing server sheet for consistency. */
            #twu-sheet-overlay {
                position: absolute; inset: 0;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
                z-index: 2000;
                opacity: 0; pointer-events: none;
                transition: opacity 0.3s ease;
            }
            #twu-sheet-overlay.visible { opacity: 1; pointer-events: auto; }

            .twu-sheet {
                position: absolute;
                bottom: 0; left: 0; right: 0;
                background: #18181b;
                color: #fff;
                border-top: 1px solid #333;
                border-radius: 20px 20px 0 0;
                padding: 20px 14px calc(20px + env(safe-area-inset-bottom, 20px));
                z-index: 2001;
                transform: translateY(100%);
                transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                max-height: 85vh;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 14px;
            }
            .twu-sheet.visible { transform: translateY(0); }
            .twu-sheet[data-theme="light"] {
                background: #ffffff;
                color: #111827;
                border-top-color: #e5e7eb;
            }

            .twu-sheet-bar {
                display: flex; justify-content: space-between; align-items: center;
                padding: 0 6px 2px;
            }
            .twu-sheet-bar h3 { margin: 0; font-size: 1.05rem; font-weight: 700; }
            #twu-sheet-close {
                background: rgba(255,255,255,0.1); border: none; color: #ccc;
                width: 32px; height: 32px; border-radius: 50%;
                display: grid; place-items: center; cursor: pointer;
            }
            .twu-sheet[data-theme="light"] #twu-sheet-close {
                background: rgba(0, 0, 0, 0.06); color: #4b5563;
            }
        `;
        document.head.appendChild(style);
    },

    // ---------------- desktop mount ----------------

    _mountDesktop() {
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

    // ---------------- mobile hook ----------------

    _hookMobile() {
        // Override MobileUIHandler.openServerSheet so the mobile server
        // pill opens our unified sheet (server + Most Tracked) instead of
        // the server-only sheet. The handler script is loaded with `defer`
        // before flight.js, so it should already be on window, but poll
        // briefly just in case.
        const install = () => {
            if (window.MobileUIHandler && typeof window.MobileUIHandler.openServerSheet === 'function') {
                window.MobileUIHandler.openServerSheet = () => this._openMobileSheet();
                return true;
            }
            return false;
        };
        if (install()) return;
        const iv = setInterval(() => { if (install()) clearInterval(iv); }, 200);
        setTimeout(() => clearInterval(iv), 5000);
    },

    _openMobileSheet() {
        const map = document.getElementById('sector-ops-map-fullscreen');
        if (!map) return;

        const prevSheet = document.getElementById('twu-mobile-sheet');
        const prevOverlay = document.getElementById('twu-sheet-overlay');
        if (prevSheet) prevSheet.remove();
        if (prevOverlay) prevOverlay.remove();

        const overlay = document.createElement('div');
        overlay.id = 'twu-sheet-overlay';

        const sheet = document.createElement('div');
        sheet.id = 'twu-mobile-sheet';
        sheet.className = 'twu-sheet';
        sheet.setAttribute('data-theme', this._theme);
        sheet.innerHTML = `
            <div class="twu-sheet-bar">
                <h3>Live</h3>
                <button id="twu-sheet-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <div class="twu-card is-open" data-card="tracked">
                <div class="twu-card-head" style="cursor:default;">
                    <span class="twu-card-title">Most Tracked</span>
                </div>
                <div class="twu-card-body">
                    <div class="twu-card-body-inner">
                        <ul class="twu-list" id="twu-list-mobile" role="listbox">
                            <li class="twu-loading">Loading…</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div class="twu-card is-open" data-card="server">
                <div class="twu-card-head" style="cursor:default;">
                    <span class="twu-card-title">Server</span>
                    <span class="twu-card-meta">
                        <span class="twu-meta-dot"></span>
                        <span data-server-tag>${esc(getActiveServerShort().toUpperCase())}</span>
                    </span>
                </div>
                <div class="twu-card-body">
                    <div class="twu-card-body-inner">
                        <div class="twu-server-list" data-server-list>
                            ${this._serverOptionsHTML(getActiveServerShort())}
                        </div>
                    </div>
                </div>
            </div>
        `;

        const close = () => {
            sheet.classList.remove('visible');
            overlay.classList.remove('visible');
            setTimeout(() => { sheet.remove(); overlay.remove(); }, 300);
        };
        overlay.addEventListener('click', close);

        map.appendChild(overlay);
        map.appendChild(sheet);
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
            sheet.classList.add('visible');
        });

        sheet.querySelector('#twu-sheet-close').addEventListener('click', close);

        // Server option clicks (re-uses _selectServer, then closes).
        sheet.querySelectorAll('.twu-server-opt').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const val = btn.dataset.server;
                this._selectServer(val);
                // Reflect new server visually before closing.
                const tag = sheet.querySelector('[data-server-tag]');
                if (tag) tag.textContent = val.toUpperCase();
                sheet.querySelectorAll('.twu-server-opt').forEach(o => {
                    o.classList.toggle('active', o.dataset.server === val);
                });
                // Update mobile pill label too, since we hijacked its click.
                const pillLabel = document.getElementById('mobile-server-name');
                if (pillLabel) pillLabel.textContent = val;
                // Mirror MobileUIHandler's path: click the matching desktop
                // server-btn so any legacy listeners still fire.
                const fullName = `${val} Server`;
                const legacy = document.querySelector(`.server-btn[data-server="${fullName}"]`);
                if (legacy) legacy.click();
                setTimeout(close, 200);
            });
        });

        // Item clicks (delegated).
        sheet.addEventListener('click', (e) => {
            const item = e.target.closest && e.target.closest('.twu-item');
            if (!item) return;
            this._focus(item.dataset.username);
            close();
        });

        this._renderInto('twu-list-mobile');
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
            const sheet = document.getElementById('twu-mobile-sheet');
            if (sheet) sheet.setAttribute('data-theme', this._theme);
        });
    },

    // ---------------- data + render ----------------

    async _refresh() {
        try {
            const res = await fetch(`${this._apiBase}/api/leaderboard/top`);
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
            const go = () => this._focus(li.dataset.username);
            li.addEventListener('click', go);
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
            });
        });
    },

    _rowHTML(row, i) {
        const name = String(row.pilotName || '').trim();
        const count = Number(row.viewCount || 0);
        const safe = esc(name);
        const live = lookupLive(name);

        const tags = [];
        if (live && live.category) tags.push(`<span class="twu-tag">${esc(live.category)}</span>`);
        if (live && live.callsign) tags.push(`<span class="twu-tag">${esc(live.callsign)}</span>`);
        if (!tags.length) tags.push(`<span class="twu-tag">${count} views</span>`);

        let sub = '';
        if (live && (live.departureIcao || live.arrivalIcao)) {
            const dep = live.departureIcao || '???';
            const arr = live.arrivalIcao || '???';
            sub = `${esc(dep)} <i class="fa-solid fa-arrow-right" style="font-size:0.6rem;opacity:0.5;"></i> ${esc(arr)}`;
        } else {
            sub = `${count} ${count === 1 ? 'view' : 'views'} today`;
        }

        return `
            <li class="twu-item ${live ? 'is-live' : ''}" data-username="${safe}"
                role="option" tabindex="0"
                title="${safe}${live ? ' — live now' : ''}">
                <span class="twu-rank">${i + 1}</span>
                <span class="twu-icon" aria-hidden="true"><i class="fa-solid fa-plane"></i></span>
                <div class="twu-row-main">
                    <div class="twu-row-top">
                        <span class="twu-name">${safe}</span>
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

    _focus(username) {
        if (!username) return;
        const live = lookupLive(username);
        if (live && live.flightId && live.coords && typeof window.onSearchResultClick === 'function') {
            try {
                window.onSearchResultClick(live.flightId, live.coords[1], live.coords[0]);
            } catch (err) {
                console.warn('[TopWatched] focus failed:', err);
            }
        } else if (typeof window.showGlobalNotification === 'function') {
            window.showGlobalNotification(`${username} is not currently flying on this server.`, 'info');
        }
    },
};

if (typeof window !== 'undefined') {
    window.TopWatchedUsers = TopWatchedUsers;
}
