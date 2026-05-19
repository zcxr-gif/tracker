/**
 * topWatchedUsers.js
 *
 * Renders a small leaderboard of the most-watched Infinite Flight
 * pilots across all user watchlists. Pinned top-left on desktop,
 * collapsible dropdown on mobile.
 */

const REFRESH_MS = 5 * 60 * 1000;
const TOP_N = 5;
const MOBILE_BREAKPOINT = 992;

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export const TopWatchedUsers = {
    _supabase: null,
    _data: [],
    _open: false,
    _timer: null,

    init(supabase) {
        if (this._supabase) return;
        this._supabase = supabase;
        this._mount();
        this._bind();
        this._refresh();
        this._timer = setInterval(() => this._refresh(), REFRESH_MS);
    },

    _mount() {
        if (document.getElementById('top-watched-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'top-watched-panel';
        panel.className = 'twu-panel';
        panel.innerHTML = `
            <button type="button" id="twu-toggle" class="twu-header" aria-expanded="false" aria-controls="twu-list">
                <i class="fa-solid fa-binoculars twu-icon" aria-hidden="true"></i>
                <span class="twu-title">Top Watched</span>
                <i class="fa-solid fa-chevron-down twu-chevron" aria-hidden="true"></i>
            </button>
            <div class="twu-body">
                <ul id="twu-list" class="twu-list" role="listbox">
                    <li class="twu-empty">Loading…</li>
                </ul>
            </div>
        `;
        document.body.appendChild(panel);
    },

    _bind() {
        const toggle = document.getElementById('twu-toggle');
        if (toggle) {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this._setOpen(!this._open);
            });
        }
        // Close mobile dropdown when tapping outside.
        document.addEventListener('click', (e) => {
            if (!this._open) return;
            const panel = document.getElementById('top-watched-panel');
            if (panel && !panel.contains(e.target)) this._setOpen(false);
        });
        // If the viewport crosses the desktop breakpoint, keep state sane.
        window.addEventListener('resize', () => {
            if (window.innerWidth > MOBILE_BREAKPOINT) this._setOpen(false);
        });
    },

    _setOpen(open) {
        this._open = !!open;
        const panel = document.getElementById('top-watched-panel');
        const toggle = document.getElementById('twu-toggle');
        if (panel) panel.classList.toggle('twu-open', this._open);
        if (toggle) toggle.setAttribute('aria-expanded', this._open ? 'true' : 'false');
    },

    async _refresh() {
        try {
            const { data, error } = await this._supabase
                .rpc('get_top_watched_users', { p_limit: TOP_N });
            if (error) throw error;
            this._data = Array.isArray(data) ? data : [];
        } catch (err) {
            console.warn('[TopWatched] fetch failed:', err && err.message ? err.message : err);
            // Keep previous data on failure so the panel doesn't flicker.
        }
        this._render();
    },

    _render() {
        const list = document.getElementById('twu-list');
        if (!list) return;
        if (!this._data.length) {
            list.innerHTML = `<li class="twu-empty">No watched pilots yet</li>`;
            return;
        }
        list.innerHTML = this._data.map((row, i) => {
            const name = String(row.watched_username || '').trim();
            const count = Number(row.watcher_count || 0);
            const safeName = escapeHtml(name);
            const plural = count === 1 ? 'watcher' : 'watchers';
            return `
                <li class="twu-item" data-username="${safeName}" role="option" tabindex="0"
                    title="${safeName} — ${count} ${plural}">
                    <span class="twu-rank">${i + 1}</span>
                    <span class="twu-name">${safeName}</span>
                    <span class="twu-count"><i class="fa-solid fa-eye" aria-hidden="true"></i>${count}</span>
                </li>
            `;
        }).join('');

        list.querySelectorAll('.twu-item').forEach(li => {
            const go = () => this._focus(li.dataset.username);
            li.addEventListener('click', go);
            li.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
            });
        });
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
                    // Signature: (flightId, lat, lng)
                    window.onSearchResultClick(flightId, coords[1], coords[0]);
                } catch (err) {
                    console.warn('[TopWatched] focus failed:', err);
                }
            }
        } else if (typeof window.showGlobalNotification === 'function') {
            window.showGlobalNotification(`${username} is not currently flying.`, 'info');
        }

        if (window.innerWidth <= MOBILE_BREAKPOINT) this._setOpen(false);
    },
};

if (typeof window !== 'undefined') {
    window.TopWatchedUsers = TopWatchedUsers;
}
