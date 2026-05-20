/**
 * MobileLandingUI.js - Optimized for State Persistence & Responsive Inputs
 */

export const MobileLandingUI = {
    _isOpen: false,

    init(parentUI) {
        this.parent = parentUI;
        this.injectMobileStyles();
        this.renderMobileContainer();
        this.attachMobileListeners();

        // Purpose-built mobile top bar (search + server + trending). Replaces
        // the desktop tactical header and the floating "Most Tracked" stack,
        // which are hidden on phones — see injectTopBarStyles().
        this.injectTopBarStyles();
        this.renderTopBar();
        this.attachTopBarListeners();
    },

    renderMobileContainer() {
        const existing = document.getElementById('mobile-tactical-nexus');
        if (existing) existing.remove();

        const html = `
            <div id="mobile-tactical-nexus" class="mobile-only-ui">
                <div id="mobile-overlay" class="mobile-sheet-overlay"></div>

                <div class="mobile-bottom-sheet">
                    <div class="sheet-handle"></div>
                    
                    <div class="mobile-title">
                        <i class="fa-solid fa-sliders"></i>
                        <span>Tactical Filters</span>
                    </div>

                    <div class="sheet-content custom-scroll">
                        <div class="mobile-section-header">Active Rules</div>
                        <div id="mobile-active-rules-container"></div>
                        
                        <div class="mobile-section-header">Add Filters</div>
                        <div class="mobile-filter-grid">
                            ${this.renderFilterGrid()}
                        </div>
                    </div>

                    <div class="sheet-footer">
                        <button id="mobile-reset-btn" class="m-btn m-secondary">Reset</button>
                        <button id="mobile-apply-btn" class="m-btn m-primary">Apply Changes</button>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('sector-ops-map-fullscreen')?.insertAdjacentHTML('beforeend', html);
    },

    renderFilterGrid() {
        let html = '';
        Object.values(this.parent.filterGroups).forEach(group => {
            group.filters.forEach(f => {
                html += `
                    <button class="m-grid-item" data-id="${f.id}">
                        <i class="fa-solid ${f.icon}"></i>
                        <span>${f.label}</span>
                    </button>
                `;
            });
        });
        return html;
    },

    attachMobileListeners() {
        const sheet = document.querySelector('.mobile-bottom-sheet');
        const overlay = document.getElementById('mobile-overlay');
        const container = document.getElementById('mobile-active-rules-container');

        window.addEventListener('openMobileUI', () => {
            this._isOpen = true;
            sheet.classList.add('open');
            overlay.classList.add('visible');
            this.syncActiveRules();
        });

        const closeUI = () => {
            this._isOpen = false;
            sheet.classList.remove('open');
            overlay.classList.remove('visible');
        };

        overlay.addEventListener('click', closeUI);

        // Grid selection for adding new filters
        document.querySelectorAll('.m-grid-item').forEach(btn => {
            btn.addEventListener('click', () => {
                this.parent.activateFilter(btn.dataset.id);
                this.syncActiveRules();
            });
        });

        // CRITICAL: Listen for typing/inputs within the mobile container
        container?.addEventListener('input', (e) => {
            const target = e.target;
            const id = target.dataset.id;
            
            if (target.classList.contains('data-input-min')) {
                this.parent.updateFilterValue(id, target.value, 'min');
            } else if (target.classList.contains('data-input-max')) {
                this.parent.updateFilterValue(id, target.value, 'max');
            } else if (target.classList.contains('data-input')) {
                this.parent.updateFilterValue(id, target.value);
            }
        });

        document.getElementById('mobile-apply-btn').addEventListener('click', () => {
            this.parent.dispatchFilterUpdate();
            closeUI();
        });

        document.getElementById('mobile-reset-btn').addEventListener('click', () => {
            this.parent._activeFilters = {};
            this.syncActiveRules();
            this.parent.dispatchFilterUpdate();
        });
    },

    syncActiveRules() {
        const container = document.getElementById('mobile-active-rules-container');
        if (!container) return;

        const activeEntries = Object.entries(this.parent._activeFilters);
        if (activeEntries.length === 0) {
            container.innerHTML = `<p class="m-empty-text">No active filters. Tap below to add.</p>`;
            return;
        }

        container.innerHTML = activeEntries.map(([id, value]) => {
            const def = this.parent.allFilters.find(f => f.id === id);
            return `
                <div class="m-active-card">
                    <div class="m-card-info">
                        <i class="fa-solid ${def.icon}"></i>
                        <span>${def.label}</span>
                    </div>
                    <div class="m-card-input-wrapper">
                        ${this.parent.renderInputControl(id, value)}
                    </div>
                    <button class="m-card-remove" onclick="MobileLandingUI.removeRule('${id}')">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;
        }).join('');
    },

    removeRule(id) {
        this.parent.removeFilter(id);
        this.syncActiveRules();
    },

    injectMobileStyles() {
    const css = `
        @media (min-width: 769px) { .mobile-only-ui { display: none; } }
        @media (max-width: 768px) {

        /* Shrink Grid Icons */
            .m-grid-item {
                padding: 12px 4px !important; /* Tighter padding */
                gap: 5px !important;
            }

            .m-grid-item i {
                font-size: 0.85rem !important; /* Smaller icon size */
            }

            .m-grid-item span {
                font-size: 0.65rem !important; /* Smaller label text */
            }

            /* Ensure Active Card icons are also slightly smaller */
            .m-card-info i {
                font-size: 0.9rem !important;
            }
            /* 1. FORCE BOX-SIZING GLOBALLY FOR MOBILE UI */
            .mobile-only-ui, .mobile-only-ui * {
                box-sizing: border-box !important;
            }

            .mobile-sheet-overlay {
                position: fixed; inset: 0; background: rgba(0,0,0,0.7); 
                backdrop-filter: blur(4px); opacity: 0; visibility: hidden; transition: 0.3s; z-index: 5000;
            }
            .mobile-sheet-overlay.visible { opacity: 1; visibility: visible; }

            .mobile-bottom-sheet {
                position: fixed; bottom: 0; left: 0; right: 0;
                background: #0a0a0b; border-top: 1px solid rgba(255,255,255,0.1);
                border-radius: 24px 24px 0 0; z-index: 5001;
                height: 85vh; transform: translateY(100%); transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                display: flex; flex-direction: column; color: #fff;
                box-shadow: 0 -10px 40px rgba(0,0,0,0.5);
            }
            .mobile-bottom-sheet.open { transform: translateY(0); }

            .sheet-handle { width: 40px; height: 5px; background: rgba(255,255,255,0.2); border-radius: 10px; margin: 12px auto; }
            
            .mobile-title { 
                padding: 5px 20px 15px; text-align: center; font-weight: 800; color: #38bdf8; 
                display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 1.1rem;
                text-transform: uppercase; letter-spacing: 1px;
            }

            .sheet-content { flex: 1; overflow-y: auto; padding: 0 20px 100px; }
            .mobile-section-header { font-size: 0.7rem; font-weight: 900; color: #52525b; text-transform: uppercase; letter-spacing: 1.5px; margin: 25px 0 12px; }
            
            .mobile-filter-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
            .m-grid-item { 
                background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); 
                border-radius: 16px; padding: 15px 5px; color: #a1a1aa; display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 0.7rem;
                transition: all 0.2s;
            }
            .m-grid-item:active { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border-color: #38bdf8; }

            .m-active-card { 
                background: #141416; border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; 
                padding: 20px; margin-bottom: 12px; position: relative;
                width: 100%; /* Ensure card doesn't exceed parent */
                overflow: hidden; /* Safety clip */
            }
            .m-card-info { display: flex; align-items: center; gap: 12px; font-weight: 700; margin-bottom: 15px; font-size: 0.95rem; }
            .m-card-info i { color: #38bdf8; font-size: 1rem; }
            .m-card-remove { position: absolute; top: 18px; right: 18px; background: none; border: none; color: #ef4444; font-size: 1.1rem; opacity: 0.8; }

            /* 2. REFINED INPUT WRAPPER */
            .m-card-input-wrapper {
                width: 100%;
                display: block;
            }

            .m-card-input-wrapper .row-input, 
            .m-card-input-wrapper .row-input-select,
            .m-card-input-wrapper .range-pill-container {
                width: 100% !important;
                max-width: 100% !important; /* Prevents escaping the card */
                background: #1c1c1f !important;
                font-size: 16px !important;
                margin: 0 !important; /* Remove any external margins */
            }

            .m-card-input-wrapper .range-input {
                font-size: 16px !important;
                width: 100% !important;
            }

            .sheet-footer { 
                padding: 20px; background: #0a0a0b; border-top: 1px solid rgba(255,255,255,0.05); 
                display: flex; gap: 12px; position: sticky; bottom: 0;
            }
            .m-btn { flex: 1; padding: 16px; border-radius: 14px; font-weight: 700; border: none; font-size: 1rem; }
            .m-primary { background: #38bdf8; color: #000; }
            .m-secondary { background: rgba(255,255,255,0.08); color: #fff; }
            
            .m-empty-text { color: #3f3f46; font-size: 0.9rem; text-align: center; margin: 30px 0; font-style: italic; }
        }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    },

    // ──────────────────────────────────────────────────────────────────────
    //  Mobile Top Bar  (search · server · trending)
    //  A self-contained bar that replaces the desktop tactical header and the
    //  floating "Most Tracked" stack on phones. Data is pulled from the same
    //  global hooks the rest of the app exposes (runGlobalSearch, the live
    //  flight cache, the leaderboard endpoint and the serverChange event) but
    //  the UI is built and owned here.
    // ──────────────────────────────────────────────────────────────────────

    _servers: [
        { val: 'Expert',   label: 'Expert',   color: '#eab308', icon: 'fa-trophy' },
        { val: 'Training', label: 'Training', color: '#a855f7', icon: 'fa-graduation-cap' },
        { val: 'Casual',   label: 'Casual',   color: '#22c55e', icon: 'fa-plane-arrival' },
    ],
    _activePanel: null,
    _trendingData: [],

    _esc(s) {
        return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({
            '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
        }[c]));
    },

    _activeServerShort() {
        try {
            return (localStorage.getItem('preferredServer') || 'Expert Server').split(' ')[0];
        } catch (_) { return 'Expert'; }
    },

    renderTopBar() {
        if (document.getElementById('m-topbar')) return;
        const host = document.getElementById('sector-ops-map-fullscreen') || document.body;
        const theme = (localStorage.getItem('pui-theme') === 'light') ? 'light' : 'dark';
        const active = this._activeServerShort();

        const html = `
            <div id="m-topbar" data-theme="${theme}">
                <div class="m-tb-bar">
                    <button type="button" class="m-tb-icon" id="m-tb-trending-btn" aria-label="Trending pilots">
                        <i class="fa-solid fa-arrow-trend-up"></i>
                    </button>
                    <button type="button" class="m-tb-server-btn" id="m-tb-server-btn" aria-label="Change server">
                        <span class="m-tb-server-dot"></span>
                        <span id="m-tb-server-label">${this._esc(active.toUpperCase())}</span>
                        <i class="fa-solid fa-chevron-down"></i>
                    </button>
                    <div class="m-tb-search">
                        <i class="fa-solid fa-magnifying-glass"></i>
                        <input type="text" id="m-tb-search-input" placeholder="Search flights, airports…" autocomplete="off" enterkeyhint="search">
                        <button type="button" class="m-tb-search-clear" id="m-tb-search-clear" aria-label="Clear search" hidden>
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>

                <div class="m-tb-panel" id="m-tb-panel-search">
                    <div class="m-tb-panel-scroll" id="m-tb-search-results">
                        <div class="m-tb-hint">Search live flights, airports and airlines.</div>
                    </div>
                </div>

                <div class="m-tb-panel" id="m-tb-panel-trending">
                    <div class="m-tb-panel-head">Most Tracked <span class="m-tb-live"><span class="m-tb-live-dot"></span>LIVE</span></div>
                    <div class="m-tb-panel-scroll" id="m-tb-trending-list">
                        <div class="m-tb-hint">Loading…</div>
                    </div>
                </div>

                <div class="m-tb-panel" id="m-tb-panel-server">
                    <div class="m-tb-panel-head">Select Server</div>
                    <div class="m-tb-server-list" id="m-tb-server-list">
                        ${this._servers.map(s => this._serverOptionHTML(s, active)).join('')}
                    </div>
                </div>
            </div>
            <div class="m-tb-scrim" id="m-tb-scrim"></div>
        `;
        host.insertAdjacentHTML('beforeend', html);
    },

    _serverOptionHTML(s, active) {
        return `
            <button type="button" class="m-tb-server-opt ${s.val === active ? 'active' : ''}" data-server="${s.val}">
                <span class="m-tb-opt-icon" style="color:${s.color};background:${s.color}1a;"><i class="fa-solid ${s.icon}"></i></span>
                <span class="m-tb-opt-name">${s.label}</span>
                <i class="fa-solid fa-check m-tb-opt-check"></i>
            </button>`;
    },

    attachTopBarListeners() {
        const trendingBtn  = document.getElementById('m-tb-trending-btn');
        const serverBtn    = document.getElementById('m-tb-server-btn');
        const input        = document.getElementById('m-tb-search-input');
        const clearBtn     = document.getElementById('m-tb-search-clear');
        const scrim        = document.getElementById('m-tb-scrim');
        const serverList   = document.getElementById('m-tb-server-list');
        const searchResults= document.getElementById('m-tb-search-results');
        const trendingList = document.getElementById('m-tb-trending-list');

        trendingBtn?.addEventListener('click', () => {
            if (this._activePanel === 'trending') { this._closeAll(); return; }
            this._openPanel('trending');
            this._loadTrending();
        });

        serverBtn?.addEventListener('click', () => {
            if (this._activePanel === 'server') { this._closeAll(); return; }
            this._openPanel('server');
        });

        let debounce;
        input?.addEventListener('focus', () => this._openPanel('search'));
        input?.addEventListener('input', (e) => {
            const q = e.target.value;
            if (clearBtn) clearBtn.hidden = !q;
            if (this._activePanel !== 'search') this._openPanel('search');
            clearTimeout(debounce);
            debounce = setTimeout(() => this._onSearchInput(q), 120);
        });
        clearBtn?.addEventListener('click', () => { this._clearSearch(); input?.focus(); });

        scrim?.addEventListener('click', () => this._closeAll());

        serverList?.addEventListener('click', (e) => {
            const opt = e.target.closest('.m-tb-server-opt');
            if (opt) this._setServer(opt.dataset.server);
        });

        searchResults?.addEventListener('click', (e) => {
            const btn = e.target.closest('.m-tb-res');
            if (!btn) return;
            const type = btn.dataset.type;
            if (type === 'flight' && typeof window.onSearchResultClick === 'function') {
                window.onSearchResultClick(btn.dataset.id, parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lon));
            } else if (type === 'airport' && typeof window.onAirportSearchResultClick === 'function') {
                window.onAirportSearchResultClick({ icao: btn.dataset.icao, lat: parseFloat(btn.dataset.lat), lon: parseFloat(btn.dataset.lon) });
            } else if (type === 'airline' && typeof window.onAirlineSearchResultClick === 'function') {
                window.onAirlineSearchResultClick(btn.dataset.name);
            }
            this._clearSearch();
            this._closeAll();
        });

        trendingList?.addEventListener('click', (e) => {
            const row = e.target.closest('.m-tb-trend-row');
            if (!row) return;
            const fid = row.dataset.fid;
            if (fid) {
                const live = (typeof window.getLiveFlightData === 'function') ? (window.getLiveFlightData() || []) : [];
                const m = live.find(f => f?.properties?.flightId === fid);
                const lat = m?.geometry?.coordinates?.[1];
                const lon = m?.geometry?.coordinates?.[0];
                if (typeof window.onSearchResultClick === 'function') window.onSearchResultClick(fid, lat, lon);
            }
            this._closeAll();
        });

        // Keep the bar in sync when the server is changed from anywhere else.
        window.addEventListener('serverChange', (e) => {
            const v = e?.detail?.server;
            if (!v) return;
            const label = document.getElementById('m-tb-server-label');
            if (label) label.textContent = String(v).toUpperCase();
            document.querySelectorAll('.m-tb-server-opt').forEach(o => o.classList.toggle('active', o.dataset.server === v));
        });

        // Mirror live theme switches from profileUI.js.
        window.addEventListener('puiThemeChanged', (e) => {
            const t = e?.detail?.theme === 'light' ? 'light' : 'dark';
            document.getElementById('m-topbar')?.setAttribute('data-theme', t);
        });
    },

    _openPanel(name) {
        this._activePanel = name;
        document.querySelectorAll('#m-topbar .m-tb-panel').forEach(p => p.classList.remove('open'));
        document.getElementById('m-tb-panel-' + name)?.classList.add('open');
        document.getElementById('m-tb-scrim')?.classList.add('visible');
        document.getElementById('m-tb-trending-btn')?.classList.toggle('active', name === 'trending');
        document.getElementById('m-tb-server-btn')?.classList.toggle('active', name === 'server');
    },

    _closeAll() {
        this._activePanel = null;
        document.querySelectorAll('#m-topbar .m-tb-panel').forEach(p => p.classList.remove('open'));
        document.getElementById('m-tb-scrim')?.classList.remove('visible');
        document.getElementById('m-tb-trending-btn')?.classList.remove('active');
        document.getElementById('m-tb-server-btn')?.classList.remove('active');
        document.getElementById('m-tb-search-input')?.blur();
    },

    _setServer(val) {
        const label = document.getElementById('m-tb-server-label');
        if (label) label.textContent = val.toUpperCase();
        document.querySelectorAll('.m-tb-server-opt').forEach(o => o.classList.toggle('active', o.dataset.server === val));
        try { localStorage.setItem('preferredServer', val + ' Server'); } catch (_) {}
        window.dispatchEvent(new CustomEvent('serverChange', { detail: { server: val } }));
        this._closeAll();
    },

    // ---- Trending ----------------------------------------------------------

    async _loadTrending() {
        const list = document.getElementById('m-tb-trending-list');
        if (!list) return;
        const base = window.API_BASE_URL;
        if (!base) { list.innerHTML = `<div class="m-tb-hint">Trending is unavailable.</div>`; return; }
        try {
            const res = await fetch(`${base}/api/leaderboard/top`);
            if (!res.ok) throw new Error('bad response');
            const data = await res.json();
            this._trendingData = Array.isArray(data) ? data : [];
            this._renderTrending();
        } catch (_) {
            if (!this._trendingData.length) {
                list.innerHTML = `<div class="m-tb-hint">Couldn't load trending right now.</div>`;
            }
        }
    },

    _matchFlight(row, live) {
        if (row.flightId) {
            const m = live.find(f => f?.properties?.flightId === row.flightId);
            if (m) return m;
        }
        const t = String(row.pilotName || '').toLowerCase();
        if (!t) return null;
        return live.find(f => String(f?.properties?.username || '').toLowerCase() === t) || null;
    },

    _renderTrending() {
        const list = document.getElementById('m-tb-trending-list');
        if (!list) return;
        const rows = (this._trendingData || []).slice(0, 5);
        if (!rows.length) { list.innerHTML = `<div class="m-tb-hint">No flights tracked yet today.</div>`; return; }
        const live = (typeof window.getLiveFlightData === 'function') ? (window.getLiveFlightData() || []) : [];
        list.innerHTML = rows.map((r, i) => {
            const m = this._matchFlight(r, live);
            const sub = m ? (m.properties.callsign || m.properties.username || 'In flight') : `${r.viewCount || 0} views today`;
            return `
                <button type="button" class="m-tb-trend-row ${m ? 'is-live' : ''}" data-fid="${m ? this._esc(m.properties.flightId) : ''}">
                    <span class="m-tb-trend-rank">${i + 1}</span>
                    <span class="m-tb-trend-main">
                        <span class="m-tb-trend-name">${this._esc(r.pilotName || 'Unknown')}</span>
                        <span class="m-tb-trend-sub">${this._esc(sub)}</span>
                    </span>
                    <span class="m-tb-trend-views">${r.viewCount || 0}<small>views</small></span>
                </button>`;
        }).join('');
    },

    // ---- Search ------------------------------------------------------------

    _onSearchInput(q) {
        const results = document.getElementById('m-tb-search-results');
        if (!results) return;
        if (!q || q.trim().length < 2) {
            results.innerHTML = `<div class="m-tb-hint">Search live flights, airports and airlines.</div>`;
            return;
        }
        const r = (typeof window.runGlobalSearch === 'function')
            ? window.runGlobalSearch(q)
            : { flights: [], airports: [], airlines: [] };
        const total = (r.flights?.length || 0) + (r.airports?.length || 0) + (r.airlines?.length || 0);
        if (!total) {
            results.innerHTML = `<div class="m-tb-hint">No matches for “${this._esc(q)}”.</div>`;
            return;
        }
        let html = '';
        if (r.flights?.length)  html += this._searchSection('Live flights', r.flights.map(e => this._flightRow(e)).join(''));
        if (r.airports?.length) html += this._searchSection('Airports',     r.airports.map(e => this._airportRow(e)).join(''));
        if (r.airlines?.length) html += this._searchSection('Airlines',     r.airlines.map(e => this._airlineRow(e)).join(''));
        results.innerHTML = html;
    },

    _searchSection(title, rowsHtml) {
        return `<div class="m-tb-sec"><div class="m-tb-sec-h">${title}</div>${rowsHtml}</div>`;
    },

    _flightRow(entry) {
        const f = entry.feature || {};
        const p = f.properties || {};
        const lat = f.geometry?.coordinates?.[1];
        const lon = f.geometry?.coordinates?.[0];
        let ac = p.aircraft;
        if (typeof ac === 'string') { try { ac = JSON.parse(ac); } catch { ac = {}; } }
        const acName = (ac && ac.aircraftName) || p.aircraftName || '';
        const sub = `${this._esc(p.username || 'Anonymous')}${acName ? ' · ' + this._esc(acName) : ''}`;
        return `
            <button type="button" class="m-tb-res" data-type="flight" data-id="${this._esc(p.flightId)}" data-lat="${lat}" data-lon="${lon}">
                <span class="m-tb-res-ic" style="color:#38bdf8;"><i class="fa-solid fa-plane"></i></span>
                <span class="m-tb-res-main">
                    <span class="m-tb-res-t">${this._esc(p.callsign || 'N/A')}</span>
                    <span class="m-tb-res-s">${sub}</span>
                </span>
                <span class="m-tb-res-x">${Math.round(p.altitude || 0).toLocaleString()}<small>ft</small></span>
            </button>`;
    },

    _airportRow(entry) {
        const a = entry.airport || {};
        return `
            <button type="button" class="m-tb-res" data-type="airport" data-icao="${this._esc(a.icao)}" data-lat="${a.lat}" data-lon="${a.lon}">
                <span class="m-tb-res-ic" style="color:#22c55e;"><i class="fa-solid fa-tower-control"></i></span>
                <span class="m-tb-res-main">
                    <span class="m-tb-res-t">${this._esc(a.icao)}</span>
                    <span class="m-tb-res-s">${this._esc(a.name || '')}</span>
                </span>
            </button>`;
    },

    _airlineRow(entry) {
        const count = entry.count || 0;
        return `
            <button type="button" class="m-tb-res" data-type="airline" data-name="${this._esc(entry.name)}">
                <span class="m-tb-res-ic" style="color:#c084fc;"><i class="fa-solid fa-plane-departure"></i></span>
                <span class="m-tb-res-main">
                    <span class="m-tb-res-t">${this._esc(entry.name)}</span>
                    <span class="m-tb-res-s">${count} active flight${count === 1 ? '' : 's'}</span>
                </span>
            </button>`;
    },

    _clearSearch() {
        const input = document.getElementById('m-tb-search-input');
        if (input) input.value = '';
        const clearBtn = document.getElementById('m-tb-search-clear');
        if (clearBtn) clearBtn.hidden = true;
        this._onSearchInput('');
    },

    injectTopBarStyles() {
        if (document.getElementById('m-topbar-styles')) return;
        const css = `
            @media (min-width: 769px) {
                #m-topbar, .m-tb-scrim { display: none !important; }
            }
            @media (max-width: 768px) {
                /* The mobile bar replaces the desktop chrome on phones. */
                #inflight-tactical-ui .tactical-header { display: none !important; }
                #twu-stack { display: none !important; }

                #m-topbar, #m-topbar * { box-sizing: border-box; }
                #m-topbar {
                    position: fixed; top: 0; left: 0; right: 0;
                    z-index: 4000; pointer-events: none;
                    padding: calc(env(safe-area-inset-top, 0px) + 8px) 10px 0;
                    font-family: 'Inter', sans-serif;
                }

                .m-tb-bar {
                    display: flex; align-items: center; gap: 8px;
                    height: 52px; padding: 7px; border-radius: 16px;
                    background: rgba(12,12,14,0.92);
                    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
                    border: 1px solid rgba(255,255,255,0.08);
                    box-shadow: 0 10px 30px rgba(0,0,0,0.45);
                    pointer-events: auto;
                }

                .m-tb-icon {
                    flex: 0 0 auto; width: 38px; height: 38px; border-radius: 11px;
                    display: grid; place-items: center; font-size: 0.95rem;
                    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
                    color: #e5e7eb;
                }
                .m-tb-icon.active { background: rgba(56,189,248,0.16); color: #38bdf8; border-color: #38bdf8; }

                .m-tb-server-btn {
                    flex: 0 0 auto; display: flex; align-items: center; gap: 7px;
                    height: 38px; padding: 0 11px; border-radius: 11px; white-space: nowrap;
                    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
                    color: #e5e7eb; font-weight: 800; font-size: 0.72rem; letter-spacing: 0.4px;
                }
                .m-tb-server-btn.active { background: rgba(56,189,248,0.16); color: #38bdf8; border-color: #38bdf8; }
                .m-tb-server-btn .fa-chevron-down { font-size: 0.6rem; opacity: 0.6; }
                .m-tb-server-dot { width: 7px; height: 7px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px rgba(16,185,129,0.7); }

                .m-tb-search {
                    flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px;
                    height: 38px; padding: 0 12px; border-radius: 11px; color: #9ca3af;
                    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
                }
                .m-tb-search > i { font-size: 0.85rem; }
                #m-tb-search-input {
                    flex: 1 1 auto; min-width: 0; background: none; border: none; outline: none;
                    color: #fff; font-size: 16px; font-weight: 500;
                }
                #m-tb-search-input::placeholder { color: #71717a; }
                .m-tb-search-clear { flex: 0 0 auto; background: none; border: none; color: #9ca3af; font-size: 0.9rem; padding: 4px; }

                .m-tb-panel {
                    pointer-events: auto; margin-top: 8px; overflow: hidden; display: none;
                    border-radius: 18px; border: 1px solid rgba(255,255,255,0.08);
                    background: rgba(16,16,19,0.97);
                    backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
                    box-shadow: 0 20px 50px rgba(0,0,0,0.6);
                    max-height: calc(100vh - 90px);
                    max-height: calc(100dvh - env(safe-area-inset-top, 0px) - 80px);
                }
                .m-tb-panel.open { display: flex; flex-direction: column; animation: m-tb-pop 0.18s ease; }
                @keyframes m-tb-pop { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

                .m-tb-panel-head {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 14px 16px 8px; font-size: 0.72rem; font-weight: 900;
                    letter-spacing: 1px; text-transform: uppercase; color: #71717a;
                }
                .m-tb-live { display: inline-flex; align-items: center; gap: 6px; color: #10b981; font-size: 0.62rem; }
                .m-tb-live-dot { width: 6px; height: 6px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px rgba(16,185,129,0.7); }
                .m-tb-panel-scroll { overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 6px; }
                .m-tb-hint { padding: 24px 18px; color: #52525b; font-size: 0.85rem; text-align: center; font-style: italic; }

                .m-tb-sec { padding: 0 0 8px; }
                .m-tb-sec-h { padding: 10px 12px 6px; font-size: 0.66rem; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; color: #52525b; }

                .m-tb-res, .m-tb-trend-row {
                    display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
                    background: none; border: none; color: #fff; padding: 11px 12px; border-radius: 12px;
                }
                .m-tb-res:active, .m-tb-trend-row:active { background: rgba(255,255,255,0.06); }
                .m-tb-res-ic {
                    flex: 0 0 auto; width: 34px; height: 34px; border-radius: 10px;
                    display: grid; place-items: center; background: rgba(255,255,255,0.05);
                }
                .m-tb-res-main, .m-tb-trend-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
                .m-tb-res-t, .m-tb-trend-name { font-weight: 800; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .m-tb-res-s, .m-tb-trend-sub { font-size: 0.8rem; color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .m-tb-res-x, .m-tb-trend-views { flex: 0 0 auto; font-weight: 700; font-size: 0.85rem; color: #a1a1aa; }
                .m-tb-res-x small, .m-tb-trend-views small { font-size: 0.6rem; opacity: 0.7; margin-left: 3px; }

                .m-tb-trend-rank { flex: 0 0 auto; width: 22px; text-align: center; font-weight: 700; color: #71717a; font-variant-numeric: tabular-nums; }
                .m-tb-trend-row.is-live .m-tb-trend-name::after {
                    content: ''; display: inline-block; width: 6px; height: 6px; margin-left: 7px;
                    border-radius: 50%; background: #10b981; box-shadow: 0 0 8px rgba(16,185,129,0.7); vertical-align: middle;
                }

                .m-tb-server-list { padding: 6px 8px 10px; display: flex; flex-direction: column; gap: 6px; }
                .m-tb-server-opt {
                    display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
                    background: none; border: 1px solid rgba(255,255,255,0.06); color: #a1a1aa;
                    padding: 11px 12px; border-radius: 12px;
                }
                .m-tb-server-opt.active { background: rgba(56,189,248,0.1); color: #38bdf8; border-color: #38bdf8; }
                .m-tb-opt-icon { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; font-size: 0.9rem; }
                .m-tb-opt-name { flex: 1 1 auto; font-weight: 800; font-size: 0.9rem; }
                .m-tb-opt-check { opacity: 0; color: #38bdf8; }
                .m-tb-server-opt.active .m-tb-opt-check { opacity: 1; }

                .m-tb-scrim {
                    position: fixed; inset: 0; z-index: 3990; background: rgba(0,0,0,0.4);
                    opacity: 0; visibility: hidden; transition: opacity 0.2s;
                }
                .m-tb-scrim.visible { opacity: 1; visibility: visible; }

                /* Light theme */
                #m-topbar[data-theme="light"] .m-tb-bar,
                #m-topbar[data-theme="light"] .m-tb-panel { background: rgba(255,255,255,0.96); border-color: rgba(0,0,0,0.08); }
                #m-topbar[data-theme="light"] .m-tb-icon,
                #m-topbar[data-theme="light"] .m-tb-server-btn,
                #m-topbar[data-theme="light"] .m-tb-search { background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.08); color: #1f2937; }
                #m-topbar[data-theme="light"] #m-tb-search-input { color: #111827; }
                #m-topbar[data-theme="light"] .m-tb-res,
                #m-topbar[data-theme="light"] .m-tb-trend-row,
                #m-topbar[data-theme="light"] .m-tb-res-t,
                #m-topbar[data-theme="light"] .m-tb-trend-name,
                #m-topbar[data-theme="light"] .m-tb-opt-name { color: #111827; }
                #m-topbar[data-theme="light"] .m-tb-server-opt { border-color: rgba(0,0,0,0.08); color: #4b5563; }
            }
        `;
        const style = document.createElement('style');
        style.id = 'm-topbar-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }
};

window.MobileLandingUI = MobileLandingUI;