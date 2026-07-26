/**
 * networkBoard.js
 *
 * "Network" board — what the whole server is flying, right now.
 *
 * The app already answers "what is happening at this airport" (the airport
 * window) and "where is ATC online" (AtcBoardUI, which also ranks the busiest
 * fields). Nothing answered the network-wide question a tracker is expected to
 * answer: which routes are busy, which aircraft everyone is in, which airlines
 * are out. This board is that view.
 *
 * Every number is derived on the client from the live feature cache that already
 * drives the map (window.getLiveFlightData), so the board costs one pass over
 * the current traffic and no network request.
 *
 * Rows are not a dead read-out — each one applies the matching map filter
 * through the existing tactical-filter pipeline, so tapping "A350-900" leaves
 * only A350s on the map. That routes through LandingUI.dispatchFilterUpdate()
 * and writes LandingUI._activeFilters, which is what the Filters modal reads,
 * so the two stay in sync instead of fighting over the same state.
 */

const TOP_N = 8;
const REFRESH_MS = 10_000;

// Tabs, in display order. `filterKeys` are the tactical-filter fields a row in
// that tab writes; they're listed here so clearing a filter can blank exactly
// the fields the board set and nothing else.
const TABS = [
    { id: 'routes',   label: 'Routes',   icon: 'fa-route',          filterKeys: ['departureIcao', 'arrivalIcao'] },
    { id: 'aircraft', label: 'Aircraft', icon: 'fa-plane-up',       filterKeys: ['type'] },
    { id: 'airlines', label: 'Airlines', icon: 'fa-building-flag',  filterKeys: ['livery'] },
];

function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/**
 * Aircraft/livery names, preferring the flat mirrors on the feature.
 * Live features carry aircraftName/liveryName as top-level properties; the
 * JSON blob is only parsed when they're missing, so the common path avoids a
 * JSON.parse per flight per refresh. Mirrors searchEngine.js's aircraftFields.
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

const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

/**
 * Top `n` entries, highest count first.
 *
 * The tiebreak on label matters: Array.sort is stable, so without it a group of
 * equal counts would come back in Map insertion order — which is the order
 * traffic happened to arrive in the feed, and changes on every poll. Rows would
 * visibly reshuffle every refresh for no reason.
 */
function rank(map, n) {
    return [...map.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .slice(0, n)
        .map(([label, count]) => ({ label, count }));
}

// Real ICAO indicators only. Routes are keyed by airport pair and shown as
// text, so a local identifier or a blank field would produce a row nobody can
// act on — the map filter matches departureIcao/arrivalIcao exactly.
const ICAO_RE = /^[A-Z]{4}$/;

function collectStats() {
    const flights = (typeof window.getLiveFlightData === 'function')
        ? window.getLiveFlightData() : [];

    let airborne = 0;
    let ground = 0;
    const pilots = new Set();
    const routeCounts = new Map();  // "DEP-ARR" -> count
    const routeMeta = new Map();    // "DEP-ARR" -> { dep, arr }
    const types = new Map();
    const airlines = new Map();

    for (const f of flights) {
        const p = (f && f.properties) || {};

        if (p.phase === 'Ground') ground++; else airborne++;

        const username = String(p.username || '').trim();
        if (username && username.toLowerCase() !== 'anonymous') pilots.add(username.toLowerCase());

        const dep = String(p.departureIcao || '').toUpperCase();
        const arr = String(p.arrivalIcao || '').toUpperCase();
        if (ICAO_RE.test(dep) && ICAO_RE.test(arr) && dep !== arr) {
            const key = `${dep}-${arr}`;
            bump(routeCounts, key);
            if (!routeMeta.has(key)) routeMeta.set(key, { dep, arr });
        }

        const { acName, livName } = aircraftFields(p);
        if (acName) bump(types, acName.trim());
        // "Generic" is the default livery for an aircraft with no airline
        // painted on it — it would top the airline chart on every server while
        // telling you nothing about who is flying.
        const liv = livName.trim();
        if (liv && liv.toLowerCase() !== 'generic') bump(airlines, liv);
    }

    return {
        total: flights.length,
        airborne,
        ground,
        pilots: pilots.size,
        routes: rank(routeCounts, TOP_N).map(r => ({ ...r, ...routeMeta.get(r.label) })),
        aircraft: rank(types, TOP_N),
        airlines: rank(airlines, TOP_N),
    };
}

export const NetworkBoardUI = {
    _visible: false,
    _tab: 'routes',
    _timer: null,
    // The filter this board applied, so it can be described and cleared without
    // touching rules the user set in the Filters modal.
    _applied: null,

    init() {
        if (document.getElementById('network-board-window')) return;
        const mapContainer = document.getElementById('sector-ops-map-fullscreen');
        if (!mapContainer) return;

        this._injectStyles();
        mapContainer.insertAdjacentHTML('beforeend', `
            <div id="network-board-window" class="info-window nb-window">
                <div class="info-window-header">
                    <h3><i class="fa-solid fa-chart-simple" style="margin-right: 10px;"></i> Network</h3>
                    <div class="info-window-actions">
                        <button id="network-board-close-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div id="network-board-content" class="info-window-content nb-content"></div>
            </div>
        `);

        document.getElementById('network-board-close-btn')
            ?.addEventListener('click', () => this.toggle(false));

        window.addEventListener('openNetworkBoard', () => this.toggle(!this._visible));

        const content = document.getElementById('network-board-content');

        content?.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('[data-nb-tab]');
            if (tabBtn) {
                this._tab = tabBtn.dataset.nbTab;
                this.render();
                return;
            }
            if (e.target.closest('[data-nb-clear]')) {
                this._clearFilter();
                return;
            }
            const row = e.target.closest('[data-nb-row]');
            if (row) this._onRowClick(row);
        });

        // The toolbar button lives in index.html so it sits with its siblings;
        // wiring it here keeps the whole feature in one file.
        document.getElementById('toolbar-network-btn')
            ?.addEventListener('click', () => this.toggle(!this._visible));
    },

    toggle(show) {
        const el = document.getElementById('network-board-window');
        if (!el) return;
        this._visible = show === undefined ? !this._visible : !!show;

        if (this._visible) {
            this.render();
            el.classList.add('visible');
            // Only poll while the board is on screen. It reads the live cache,
            // so there is nothing to refresh into a hidden panel.
            if (!this._timer) this._timer = setInterval(() => this.render(), REFRESH_MS);
        } else {
            el.classList.remove('visible');
            if (this._timer) { clearInterval(this._timer); this._timer = null; }
        }

        document.getElementById('toolbar-network-btn')?.classList.toggle('active', this._visible);
    },

    // ---------------- filters ----------------

    /**
     * Merge a patch into the tactical filters and push it through the same
     * event the Filters modal uses. Writing LandingUI._activeFilters first
     * keeps the modal's own state in step — dispatching without it would leave
     * the modal showing stale rules that reappear on the next edit.
     */
    _applyFilter(patch) {
        const lui = window.LandingUI;
        if (!lui || typeof lui.dispatchFilterUpdate !== 'function') return false;
        lui._activeFilters = { ...(lui._activeFilters || {}), ...patch };
        lui.dispatchFilterUpdate();
        return true;
    },

    _onRowClick(row) {
        const tab = TABS.find(t => t.id === this._tab);
        if (!tab) return;

        let patch;
        let describe;
        if (this._tab === 'routes') {
            const { dep, arr } = row.dataset;
            if (!dep || !arr) return;
            patch = { departureIcao: dep, arrivalIcao: arr };
            describe = `${dep} → ${arr}`;
        } else {
            const value = row.dataset.value;
            if (!value) return;
            patch = this._tab === 'aircraft' ? { type: value } : { livery: value };
            describe = value;
        }

        if (!this._applyFilter(patch)) return;
        this._applied = { keys: tab.filterKeys, label: describe };
        this.render();
    },

    _clearFilter() {
        if (!this._applied) return;
        // Blank only what this board set. An empty string is what every
        // tactical rule treats as "no rule", so this is a removal, not a
        // filter that matches nothing.
        const patch = {};
        for (const key of this._applied.keys) patch[key] = '';
        this._applyFilter(patch);
        this._applied = null;
        this.render();
    },

    // ---------------- rendering ----------------

    render() {
        const content = document.getElementById('network-board-content');
        if (!content) return;

        const stats = collectStats();
        const rows = stats[this._tab] || [];
        const max = rows.length ? rows[0].count : 0;

        const statCell = (value, label) => `
            <div class="nb-stat">
                <span class="nb-stat-value">${value}</span>
                <span class="nb-stat-label">${label}</span>
            </div>`;

        const tabsHtml = TABS.map(t => `
            <button class="nb-tab ${t.id === this._tab ? 'active' : ''}" data-nb-tab="${t.id}">
                <i class="fa-solid ${t.icon}"></i> ${t.label}
            </button>`).join('');

        const appliedHtml = this._applied ? `
            <div class="nb-applied">
                <i class="fa-solid fa-filter"></i>
                <span>Map filtered to <b>${esc(this._applied.label)}</b></span>
                <button data-nb-clear title="Clear this filter">Clear</button>
            </div>` : '';

        let listHtml;
        if (!stats.total) {
            listHtml = `<div class="nb-empty"><i class="fa-solid fa-satellite-dish"></i><span>Waiting for live traffic…</span></div>`;
        } else if (!rows.length) {
            listHtml = `<div class="nb-empty"><i class="fa-regular fa-circle-question"></i><span>Nothing to rank yet — no ${esc(this._tab)} reported on this server.</span></div>`;
        } else {
            listHtml = rows.map((r, i) => {
                // Bar is scaled against the leader, not the total: shares here
                // are small (a busy route is a few percent of traffic) and a
                // total-relative bar would render every row as a sliver.
                const pct = max ? Math.max(4, Math.round((r.count / max) * 100)) : 0;
                const share = stats.total ? ((r.count / stats.total) * 100).toFixed(1) : '0.0';
                const attrs = this._tab === 'routes'
                    ? `data-dep="${esc(r.dep)}" data-arr="${esc(r.arr)}"`
                    : `data-value="${esc(r.label)}"`;
                const label = this._tab === 'routes'
                    ? `${esc(r.dep)} <i class="fa-solid fa-arrow-right nb-arrow"></i> ${esc(r.arr)}`
                    : esc(r.label);
                return `
                    <button class="nb-row ${i === 0 ? 'lead' : ''}" data-nb-row ${attrs}
                            title="Show only these on the map">
                        <span class="nb-rank">${i + 1}</span>
                        <span class="nb-body">
                            <span class="nb-label">${label}</span>
                            <span class="nb-track"><span class="nb-fill" style="width:${pct}%"></span></span>
                        </span>
                        <span class="nb-nums">
                            <span class="nb-count">${r.count}</span>
                            <span class="nb-share">${share}%</span>
                        </span>
                    </button>`;
            }).join('');
        }

        content.innerHTML = `
            <div class="nb-stats">
                ${statCell(stats.airborne, 'Airborne')}
                ${statCell(stats.ground, 'On Ground')}
                ${statCell(stats.pilots, 'Pilots')}
                ${statCell(stats.total, 'Total')}
            </div>
            <div class="nb-tabs">${tabsHtml}</div>
            ${appliedHtml}
            <div class="nb-list">${listHtml}</div>
            <div class="nb-foot">Live from this server · updates every ${REFRESH_MS / 1000}s · tap a row to filter the map</div>
        `;
    },

    _injectStyles() {
        if (document.getElementById('nb-styles')) return;
        const style = document.createElement('style');
        style.id = 'nb-styles';
        // Deliberately built from the app's neutral tokens — --bg-subtle,
        // --border-glass, --text-*, and --color-accent (a near-white grey) —
        // with amber reserved for the leading row. The shared .toolbar-btn
        // hover/active is overridden for this button for the same reason.
        style.textContent = `
            /* Doubled-up selectors so these beat .info-window /
               .info-window-content regardless of which stylesheet is injected
               first — both are single-class rules, so equal specificity would
               otherwise make the winner depend on boot order. */
            .info-window.nb-window {
                width: 420px;
                /* The app's --text-dim is slate (#94a3b8), which carries a
                   visible blue cast on small text like the rank column. This
                   board stays in the neutral zinc family the rest of the
                   chrome uses (#71717a is already the app's dim grey). */
                --nb-dim: #71717a;
            }
            .nb-window .nb-content { padding: 14px 16px 16px; overflow-y: auto; }

            .nb-stats {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 8px;
                margin-bottom: 14px;
            }
            .nb-stat {
                background: var(--bg-subtle);
                border: 1px solid var(--border-glass);
                border-radius: var(--radius-sm);
                padding: 8px 4px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 2px;
            }
            .nb-stat-value {
                font-family: var(--font-data);
                font-size: 1.05rem;
                font-weight: 700;
                color: var(--color-accent);
                line-height: 1.1;
            }
            .nb-stat-label {
                font-size: 0.58rem;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                color: var(--nb-dim);
                white-space: nowrap;
            }

            .nb-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
            .nb-tab {
                flex: 1;
                background: transparent;
                border: 1px solid var(--border-glass);
                border-radius: var(--radius-sm);
                color: var(--text-secondary);
                font-family: var(--font-ui);
                font-size: 0.66rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.06em;
                padding: 7px 4px;
                cursor: pointer;
                transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
                display: flex; align-items: center; justify-content: center; gap: 5px;
            }
            .nb-tab i { font-size: 0.72rem; }
            .nb-tab:hover { background: var(--bg-subtle); color: var(--text-primary); }
            .nb-tab.active {
                background: rgba(228, 228, 231, 0.14);
                border-color: var(--border-highlight);
                color: var(--text-primary);
            }

            .nb-applied {
                display: flex; align-items: center; gap: 8px;
                background: rgba(251, 191, 36, 0.10);
                border: 1px solid rgba(251, 191, 36, 0.28);
                border-radius: var(--radius-sm);
                padding: 7px 10px;
                margin-bottom: 10px;
                font-size: 0.72rem;
                color: #fde68a;
            }
            .nb-applied i { font-size: 0.7rem; }
            .nb-applied span { flex: 1; }
            .nb-applied b { color: #fbbf24; font-family: var(--font-data); }
            .nb-applied button {
                background: rgba(251, 191, 36, 0.16);
                border: 1px solid rgba(251, 191, 36, 0.3);
                color: #fde68a;
                border-radius: 6px;
                font-family: var(--font-ui);
                font-size: 0.64rem;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                padding: 3px 8px;
                cursor: pointer;
            }
            .nb-applied button:hover { background: rgba(251, 191, 36, 0.28); }

            .nb-list { display: flex; flex-direction: column; gap: 4px; }

            .nb-row {
                display: flex; align-items: center; gap: 10px;
                width: 100%;
                background: transparent;
                border: 1px solid transparent;
                border-radius: var(--radius-sm);
                padding: 7px 8px;
                cursor: pointer;
                text-align: left;
                font-family: var(--font-ui);
                transition: background 0.18s ease, border-color 0.18s ease;
            }
            .nb-row:hover { background: var(--bg-subtle); border-color: var(--border-glass); }

            .nb-rank {
                flex: 0 0 18px;
                font-family: var(--font-data);
                font-size: 0.7rem;
                font-weight: 700;
                color: var(--nb-dim);
                text-align: center;
            }
            .nb-row.lead .nb-rank { color: #fbbf24; }

            .nb-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
            .nb-label {
                font-family: var(--font-data);
                font-size: 0.76rem;
                font-weight: 600;
                color: var(--text-primary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .nb-arrow { font-size: 0.6rem; color: var(--nb-dim); margin: 0 2px; }

            .nb-track {
                height: 4px;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.06);
                overflow: hidden;
            }
            .nb-fill {
                display: block;
                height: 100%;
                border-radius: 999px;
                background: linear-gradient(90deg, rgba(228, 228, 231, 0.55), rgba(228, 228, 231, 0.18));
                transition: width 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .nb-row.lead .nb-fill {
                background: linear-gradient(90deg, rgba(251, 191, 36, 0.7), rgba(251, 191, 36, 0.2));
            }

            .nb-nums { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
            .nb-count {
                font-family: var(--font-data);
                font-size: 0.8rem;
                font-weight: 700;
                color: var(--text-primary);
                line-height: 1;
            }
            .nb-share { font-size: 0.58rem; color: var(--nb-dim); font-family: var(--font-data); }

            .nb-empty {
                display: flex; flex-direction: column; align-items: center; gap: 10px;
                padding: 34px 16px;
                color: var(--nb-dim);
                font-size: 0.78rem;
                text-align: center;
            }
            .nb-empty i { font-size: 1.4rem; opacity: 0.5; }

            .nb-foot {
                margin-top: 12px;
                padding-top: 10px;
                border-top: 1px solid var(--border-glass);
                font-size: 0.6rem;
                color: var(--nb-dim);
                text-align: center;
                letter-spacing: 0.02em;
            }

            /* The shared toolbar button hover/active is a saturated blue; keep
               this control in the same neutral family as the board it opens. */
            #toolbar-network-btn:hover,
            #toolbar-network-btn.active {
                background: rgba(228, 228, 231, 0.18);
                color: #fafafa;
                box-shadow: none;
            }

            @media (max-width: 768px) {
                .info-window.nb-window { width: 95vw; }
                .nb-stat-value { font-size: 0.95rem; }
                .nb-tab { font-size: 0.6rem; }
            }
        `;
        document.head.appendChild(style);
    },
};

if (typeof window !== 'undefined') {
    window.NetworkBoardUI = NetworkBoardUI;
}

export default NetworkBoardUI;
