/**
 * topWatchedUsers.js
 *
 * "Most Tracked" leaderboard panel, styled to match the LandingUI
 * tactical overlay. Lives in the top-left of the map on desktop
 * (below the server selector); on mobile it surfaces as a button in
 * the HUD action stack that opens a bottom sheet.
 *
 * Data: reuses the existing /api/leaderboard/top endpoint that
 * powers the "Most Tracked Today" card in panel-content.html.
 *
 * Reactivity:
 *   - Refreshes every 60s.
 *   - Refreshes again ~1.5s after a serverChange (so live-now dots
 *     reflect the new server's traffic).
 *   - Follows puiThemeChanged so dark/light theme switches in real time.
 */

const REFRESH_MS = 60 * 1000;
const TOP_N = 5;
const MOBILE_BREAKPOINT = 992;

function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function getStoredTheme() {
    try {
        const t = localStorage.getItem('pui-theme');
        return t === 'light' ? 'light' : 'dark';
    } catch (_) {
        return 'dark';
    }
}

export const TopWatchedUsers = {
    _apiBase: null,
    _data: [],
    _theme: 'dark',
    _timer: null,
    _hudObserver: null,

    init(apiBaseUrl) {
        if (this._apiBase) return;
        this._apiBase = apiBaseUrl;
        this._theme = getStoredTheme();

        this._injectStyles();
        this._mountDesktopPanel();
        this._installMobileButton();
        this._bindGlobalEvents();

        this._refresh();
        this._timer = setInterval(() => this._refresh(), REFRESH_MS);
    },

    // ---------------- styling ----------------

    _injectStyles() {
        if (document.getElementById('twu-styles')) return;
        const style = document.createElement('style');
        style.id = 'twu-styles';
        style.textContent = `
            .twu-panel {
                position: absolute;
                top: 90px;
                left: 40px;
                width: 280px;
                z-index: 1500;
                font-family: 'Inter', sans-serif;
                background: var(--lui-glass-bg, rgba(10, 10, 10, 0.85));
                border: 1px solid var(--lui-border-base, rgba(255, 255, 255, 0.08));
                border-radius: 18px;
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
                overflow: hidden;
                pointer-events: auto;
                opacity: 0;
                transform: translateY(-6px);
                transition: opacity 0.4s ease, transform 0.4s ease;
                color: var(--lui-text-main, #fff);
            }
            .twu-panel.ready {
                opacity: 1;
                transform: translateY(0);
            }

            .twu-panel[data-theme="light"] {
                background: rgba(255, 255, 255, 0.85);
                border-color: rgba(0, 0, 0, 0.08);
                color: #111827;
            }

            .twu-head {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 14px 18px 12px;
                border-bottom: 1px solid var(--lui-border-base, rgba(255, 255, 255, 0.06));
            }
            .twu-head .twu-flame {
                width: 26px;
                height: 26px;
                border-radius: 8px;
                display: grid;
                place-items: center;
                background: rgba(251, 191, 36, 0.12);
                color: #fbbf24;
                font-size: 0.8rem;
            }
            .twu-head .twu-title {
                flex: 1;
                font-size: 0.7rem;
                font-weight: 900;
                letter-spacing: 2px;
                color: var(--lui-text-gray-2, #71717a);
                text-transform: uppercase;
            }
            .twu-head .twu-server-tag {
                font-size: 0.6rem;
                font-weight: 800;
                letter-spacing: 1.5px;
                color: var(--lui-text-gray-3, #3f3f46);
                text-transform: uppercase;
            }

            .twu-list {
                list-style: none;
                margin: 0;
                padding: 6px;
                max-height: 320px;
                overflow-y: auto;
            }
            .twu-list::-webkit-scrollbar { width: 6px; }
            .twu-list::-webkit-scrollbar-thumb {
                background: var(--lui-border-base, rgba(255,255,255,0.08));
                border-radius: 3px;
            }

            .twu-item {
                display: grid;
                grid-template-columns: 20px 1fr auto;
                align-items: center;
                column-gap: 12px;
                padding: 10px 12px;
                border-radius: 12px;
                cursor: pointer;
                transition: background 0.2s ease;
            }
            .twu-item:hover,
            .twu-item:focus-visible {
                background: var(--lui-hover-bg, rgba(255, 255, 255, 0.05));
                outline: none;
            }
            .twu-item + .twu-item { margin-top: 2px; }

            .twu-rank {
                font-size: 0.75rem;
                font-weight: 800;
                color: var(--lui-text-gray-3, #3f3f46);
                text-align: center;
                font-variant-numeric: tabular-nums;
            }
            .twu-item:nth-child(1) .twu-rank { color: #fbbf24; }
            .twu-item:nth-child(2) .twu-rank { color: #cbd5e1; }
            .twu-item:nth-child(3) .twu-rank { color: #f59e0b; }

            .twu-name-wrap {
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 0;
            }
            .twu-live-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                background: var(--lui-text-gray-3, #3f3f46);
                flex-shrink: 0;
            }
            .twu-item.is-live .twu-live-dot {
                background: #10b981;
                box-shadow: 0 0 8px rgba(16, 185, 129, 0.7);
                animation: twu-pulse 2s ease-in-out infinite;
            }
            @keyframes twu-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.55; }
            }
            .twu-name {
                font-size: 0.88rem;
                font-weight: 600;
                color: var(--lui-text-main, #fff);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .twu-panel[data-theme="light"] .twu-name { color: #111827; }

            .twu-count {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                font-size: 0.72rem;
                font-weight: 700;
                color: var(--lui-text-gray-2, #71717a);
                font-variant-numeric: tabular-nums;
                background: var(--lui-border-base, rgba(255, 255, 255, 0.05));
                padding: 4px 9px;
                border-radius: 100px;
            }
            .twu-count i { font-size: 0.65rem; opacity: 0.7; }

            .twu-empty, .twu-loading {
                padding: 18px;
                font-size: 0.8rem;
                color: var(--lui-text-gray-2, #71717a);
                text-align: center;
                font-style: italic;
            }

            /* Hide the desktop panel on small viewports — the action-stack
               button + bottom sheet take over there. */
            @media (max-width: ${MOBILE_BREAKPOINT}px) {
                .twu-panel { display: none; }
            }

            /* ---- Mobile bottom sheet (matches the server sheet pattern) ---- */
            #twu-sheet-overlay {
                position: absolute;
                inset: 0;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
                z-index: 2000;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.3s ease;
            }
            #twu-sheet-overlay.visible { opacity: 1; pointer-events: auto; }

            .twu-sheet {
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
                background: #18181b;
                color: #fff;
                border-top: 1px solid #333;
                border-radius: 20px 20px 0 0;
                padding: 20px 16px calc(20px + env(safe-area-inset-bottom, 20px));
                z-index: 2001;
                transform: translateY(100%);
                transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                max-height: 70vh;
                overflow-y: auto;
            }
            .twu-sheet.visible { transform: translateY(0); }
            .twu-sheet[data-theme="light"] {
                background: #ffffff;
                color: #111827;
                border-top-color: #e5e7eb;
            }

            .twu-sheet-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 16px;
                padding: 0 6px;
            }
            .twu-sheet-header-title {
                display: flex;
                align-items: center;
                gap: 10px;
                font-weight: 700;
                font-size: 1rem;
            }
            .twu-sheet-header-title i { color: #fbbf24; }
            #twu-sheet-close {
                background: rgba(255, 255, 255, 0.1);
                border: none;
                color: #ccc;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: grid;
                place-items: center;
                cursor: pointer;
            }
            .twu-sheet[data-theme="light"] #twu-sheet-close {
                background: rgba(0, 0, 0, 0.06);
                color: #4b5563;
            }
            .twu-sheet-server {
                font-size: 0.65rem;
                font-weight: 800;
                letter-spacing: 1.5px;
                color: #71717a;
                text-transform: uppercase;
                padding: 0 6px 12px;
            }

            .twu-sheet-list {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .twu-sheet-list .twu-item {
                padding: 14px 12px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.04);
                column-gap: 14px;
            }
            .twu-sheet[data-theme="light"] .twu-sheet-list .twu-item {
                background: rgba(0, 0, 0, 0.03);
                border-color: rgba(0, 0, 0, 0.05);
            }
            .twu-sheet-list .twu-name { font-size: 0.95rem; }
        `;
        document.head.appendChild(style);
    },

    // ---------------- desktop panel ----------------

    _mountDesktopPanel() {
        const map = document.getElementById('sector-ops-map-fullscreen');
        if (!map || document.getElementById('twu-desktop-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'twu-desktop-panel';
        panel.className = 'twu-panel';
        panel.setAttribute('data-theme', this._theme);
        panel.innerHTML = `
            <div class="twu-head">
                <div class="twu-flame"><i class="fa-solid fa-fire"></i></div>
                <div class="twu-title">Most Tracked</div>
                <div class="twu-server-tag" id="twu-server-tag"></div>
            </div>
            <ul id="twu-desktop-list" class="twu-list" role="listbox">
                <li class="twu-loading">Loading…</li>
            </ul>
        `;
        map.appendChild(panel);
        requestAnimationFrame(() => panel.classList.add('ready'));
    },

    // ---------------- mobile button injection ----------------

    _installMobileButton() {
        const map = document.getElementById('sector-ops-map-fullscreen');
        if (!map) return;

        const tryInsert = () => {
            const stack = document.querySelector('.mobile-action-stack');
            if (!stack || document.getElementById('mobile-btn-watched')) return;
            const btn = document.createElement('button');
            btn.id = 'mobile-btn-watched';
            btn.className = 'mobile-glass-sq-btn';
            btn.setAttribute('aria-label', 'Most tracked pilots');
            btn.innerHTML = '<i class="fa-solid fa-fire"></i>';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._openMobileSheet();
            });
            // Place after weather, before filters when both exist; otherwise append.
            const filtersBtn = document.getElementById('mobile-btn-filters');
            if (filtersBtn && filtersBtn.parentNode === stack) {
                stack.insertBefore(btn, filtersBtn);
            } else {
                stack.appendChild(btn);
            }
        };

        tryInsert();
        // The mobile HUD is injected lazily by sector-ops-mobile-ui.js when
        // the viewport flips to mobile, so watch the map subtree for it.
        this._hudObserver = new MutationObserver(tryInsert);
        this._hudObserver.observe(map, { childList: true, subtree: true });
    },

    _openMobileSheet() {
        const map = document.getElementById('sector-ops-map-fullscreen');
        if (!map) return;
        // Single instance.
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
            <div class="twu-sheet-header">
                <div class="twu-sheet-header-title">
                    <i class="fa-solid fa-fire"></i>
                    <span>Most Tracked Today</span>
                </div>
                <button id="twu-sheet-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="twu-sheet-server" id="twu-sheet-server"></div>
            <ul id="twu-sheet-list" class="twu-sheet-list twu-list" role="listbox">
                <li class="twu-loading">Loading…</li>
            </ul>
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
        sheet.addEventListener('click', (e) => {
            const item = e.target.closest('.twu-item');
            if (!item) return;
            this._focus(item.dataset.username);
            close();
        });

        this._renderInto('twu-sheet-list');
        this._renderServerTag('twu-sheet-server');
    },

    // ---------------- events ----------------

    _bindGlobalEvents() {
        window.addEventListener('serverChange', () => {
            // Re-render immediately so live dots reflect the cleared
            // flight cache; refresh leaderboard data shortly after so
            // dots can re-light once the new server's flights stream in.
            this._render();
            setTimeout(() => this._refresh(), 1500);
        });
        window.addEventListener('puiThemeChanged', (e) => {
            const t = e && e.detail && e.detail.theme;
            if (t === 'light' || t === 'dark') this._theme = t;
            const desk = document.getElementById('twu-desktop-panel');
            if (desk) desk.setAttribute('data-theme', this._theme);
            const sheet = document.getElementById('twu-mobile-sheet');
            if (sheet) sheet.setAttribute('data-theme', this._theme);
        });
    },

    // ---------------- data ----------------

    async _refresh() {
        try {
            const res = await fetch(`${this._apiBase}/api/leaderboard/top`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const rows = await res.json();
            this._data = Array.isArray(rows) ? rows.slice(0, TOP_N) : [];
        } catch (err) {
            console.warn('[TopWatched] fetch failed:', err && err.message ? err.message : err);
            // Keep previous data on failure.
        }
        this._render();
    },

    _render() {
        this._renderInto('twu-desktop-list');
        this._renderInto('twu-sheet-list');
        this._renderServerTag('twu-server-tag');
        this._renderServerTag('twu-sheet-server');
    },

    _renderInto(listId) {
        const list = document.getElementById(listId);
        if (!list) return;

        if (!this._data.length) {
            list.innerHTML = `<li class="twu-empty">No flights tracked yet today</li>`;
            return;
        }

        const liveSet = this._buildLiveSet();
        list.innerHTML = this._data.map((row, i) => {
            const name = String(row.pilotName || '').trim();
            const count = Number(row.viewCount || 0);
            const live = liveSet.has(name.toLowerCase());
            const safe = esc(name);
            return `
                <li class="twu-item ${live ? 'is-live' : ''}" data-username="${safe}"
                    role="option" tabindex="0"
                    title="${safe} — ${count} view${count === 1 ? '' : 's'}${live ? ' • live now' : ''}">
                    <span class="twu-rank">${i + 1}</span>
                    <span class="twu-name-wrap">
                        <span class="twu-live-dot" aria-hidden="true"></span>
                        <span class="twu-name">${safe}</span>
                    </span>
                    <span class="twu-count"><i class="fa-solid fa-eye"></i>${count}</span>
                </li>
            `;
        }).join('');

        // Desktop list owns its own click handling; the sheet handles
        // delegated clicks in _openMobileSheet.
        if (listId === 'twu-desktop-list') {
            list.querySelectorAll('.twu-item').forEach(li => {
                const go = () => this._focus(li.dataset.username);
                li.addEventListener('click', go);
                li.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
                });
            });
        }
    },

    _renderServerTag(elId) {
        const el = document.getElementById(elId);
        if (!el) return;
        let server = '';
        try {
            server = (localStorage.getItem('preferredServer') || 'Expert Server').split(' ')[0];
        } catch (_) {
            server = 'Expert';
        }
        el.textContent = `${server} • Live`;
    },

    _buildLiveSet() {
        const out = new Set();
        const flights = (typeof window.getLiveFlightData === 'function')
            ? (window.getLiveFlightData() || [])
            : [];
        for (const f of flights) {
            const u = f && f.properties && f.properties.username;
            if (u) out.add(String(u).toLowerCase());
        }
        return out;
    },

    _focus(username) {
        if (!username) return;
        const target = username.toLowerCase();
        const flights = (typeof window.getLiveFlightData === 'function')
            ? (window.getLiveFlightData() || [])
            : [];
        const match = flights.find(f => {
            const u = (f && f.properties && f.properties.username || '').toLowerCase();
            return u === target;
        });

        if (match && typeof window.onSearchResultClick === 'function') {
            const flightId = match.properties.flightId;
            const coords = match.geometry && match.geometry.coordinates;
            if (flightId && coords && coords.length >= 2) {
                try {
                    window.onSearchResultClick(flightId, coords[1], coords[0]);
                } catch (err) {
                    console.warn('[TopWatched] focus failed:', err);
                }
            }
        } else if (typeof window.showGlobalNotification === 'function') {
            window.showGlobalNotification(`${username} is not currently flying on this server.`, 'info');
        }
    },
};

if (typeof window !== 'undefined') {
    window.TopWatchedUsers = TopWatchedUsers;
}
