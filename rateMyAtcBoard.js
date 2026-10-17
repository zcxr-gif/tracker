/**
 * rateMyAtcBoard.js
 *
 * The RateMyATC board: who pilots rate highest, who they thank most, and who
 * is on frequency right now with their rating — the place the ratings and
 * kudos from atcKudos.js add up to something.
 *
 * Three tabs:
 *   Top rated   Bayesian-ranked average (3+ ratings), over 30 days or all time.
 *   Most kudos  most 👍 / ☀️ over the same period.
 *   Live now    every controller online now (from window.InflightATC), with
 *               their average and the kudos / rate buttons, so the board is
 *               also the quickest way to rate someone who is working.
 *
 * Opened by the `openRateMyAtc` window event, which the nav orb, the map
 * toolbar, the phone ATC sheet, the airport window's On frequency card and the
 * profile all dispatch. Presented as a centred panel on desktop and a full
 * sheet on phones; one module, no second copy of the markup.
 *
 * Backend: atc_leaderboard() in Inflight-IOS
 * supabase/migrations/20261016000100_atc_leaderboard.sql. Rows link to the
 * controller's profile and the kudos/rate buttons are atcKudos.js's own, so
 * every interaction here behaves exactly as it does elsewhere.
 *
 * Each row wears the controller's InFlight profile when they have one — their
 * picture, and their banner behind the row — matched on their IF name, the
 * same unverified join the flight window's pilot card uses.
 */

import { PilotProfiles } from './pilotProfiles.js';

const TABS = [
    { id: 'top', label: 'Top rated', icon: 'fa-star' },
    { id: 'kudos', label: 'Most kudos', icon: 'fa-award' },
    { id: 'live', label: 'Live now', icon: 'fa-tower-broadcast' },
];
const PERIODS = [{ days: 30, label: '30 days' }, { days: 0, label: 'All time' }];
const CACHE_MS = 60 * 1000;
const FACILITY = {
    0: ['GND', 'gnd'], 1: ['TWR', 'twr'], 2: ['UNI', 'obs'], 3: ['CLR', 'gnd'],
    4: ['APP', 'app'], 5: ['DEP', 'app'], 6: ['CTR', 'ctr'], 7: ['ATIS', 'obs'],
};

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

export const RateMyAtcBoard = {
    _sb: null,
    _tab: 'top',
    _days: 30,
    _query: '',
    _cache: new Map(),   // days -> { at, data }
    _open: false,

    init(supabase) {
        if (this._sb || !supabase) return;
        this._sb = supabase;
        this._injectStyles();
        window.addEventListener('openRateMyAtc', (e) => this.open(e.detail || {}));
        window.addEventListener('activeAtcUpdated', () => { if (this._open && this._tab === 'live') this._render(); });
        window.RateMyAtcBoard = this;
    },

    open({ tab } = {}) {
        if (tab && TABS.some(t => t.id === tab)) this._tab = tab;
        let root = document.getElementById('rma-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'rma-root';
            root.className = 'rma-root';
            root.innerHTML = `
                <div class="rma-backdrop" data-rma="close"></div>
                <section class="rma-panel" role="dialog" aria-modal="true" aria-labelledby="rma-title">
                    <header class="rma-head">
                        <div class="rma-brand">
                            <span class="rma-logo" aria-hidden="true">★</span>
                            <span>
                                <h2 id="rma-title">RateMyATC</h2>
                                <span class="rma-sub" id="rma-sub">The controllers pilots rate and thank most</span>
                            </span>
                        </div>
                        <span class="rma-head-actions">
                            <a class="rma-page" href="/atc" target="_blank" rel="noopener" title="Open the full RateMyATC page">Full page <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                            <button type="button" class="rma-x" data-rma="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                        </span>
                    </header>
                    <nav class="rma-tabs" role="tablist">
                        ${TABS.map(t => `<button type="button" class="rma-tab" role="tab" data-rma-tab="${t.id}">
                            <i class="fa-solid ${t.icon}"></i> ${t.label}</button>`).join('')}
                    </nav>
                    <div class="rma-tools">
                        <div class="rma-period" id="rma-period">
                            ${PERIODS.map(p => `<button type="button" class="rma-chip" data-rma-days="${p.days}">${p.label}</button>`).join('')}
                        </div>
                        <label class="rma-search"><i class="fa-solid fa-magnifying-glass"></i>
                            <input type="search" id="rma-search" placeholder="Find a controller" autocomplete="off" spellcheck="false">
                        </label>
                    </div>
                    <div class="rma-stats" id="rma-stats"></div>
                    <div class="rma-body" id="rma-body"></div>
                    <footer class="rma-foot">
                        Stars are public. Comments on 1–3 star ratings go privately to the controller.
                        Rate anyone on frequency with ★ next to their name.
                    </footer>
                </section>`;
            document.body.appendChild(root);
            root.addEventListener('click', (e) => this._onClick(e));
            root.querySelector('#rma-search').addEventListener('input', (e) => {
                this._query = e.target.value.trim().toLowerCase();
                this._render();
            });
            this._onKey = (e) => { if (e.key === 'Escape' && this._open && !document.querySelector('#atcc-compose.is-open')) this.close(); };
            document.addEventListener('keydown', this._onKey);
        }
        root.classList.add('is-open');
        document.documentElement.classList.add('rma-lock');
        this._open = true;
        try { window.InflightHaptics?.select?.(); } catch (_) {}
        this._render();
    },

    close() {
        document.getElementById('rma-root')?.classList.remove('is-open');
        document.documentElement.classList.remove('rma-lock');
        this._open = false;
    },

    _onClick(e) {
        if (e.target.closest('[data-rma="close"]')) return this.close();
        const tab = e.target.closest('[data-rma-tab]');
        if (tab) { this._tab = tab.dataset.rmaTab; return this._render(); }
        const days = e.target.closest('[data-rma-days]');
        if (days) { this._days = Number(days.dataset.rmaDays); return this._render(); }
        // Opening a profile from the board: close the board so the profile
        // sheet is not hidden behind it. (atcKudos.js handles the click.)
        if (e.target.closest('[data-atcc-act="profile"]')) setTimeout(() => this.close(), 0);
    },

    async _data(days) {
        const hit = this._cache.get(days);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
        const { data, error } = await this._sb.rpc('atc_leaderboard', { p_days: days, p_limit: 50 });
        if (error) throw error;
        this._cache.set(days, { at: Date.now(), data });
        return data;
    },

    async _render() {
        const root = document.getElementById('rma-root');
        if (!root) return;
        root.querySelectorAll('[data-rma-tab]').forEach(b => {
            const on = b.dataset.rmaTab === this._tab;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        root.querySelectorAll('[data-rma-days]').forEach(b =>
            b.classList.toggle('is-on', Number(b.dataset.rmaDays) === this._days));
        root.querySelector('#rma-period').hidden = this._tab === 'live';

        const body = root.querySelector('#rma-body');
        const stats = root.querySelector('#rma-stats');
        if (this._tab === 'live') {
            stats.innerHTML = '';
            return this._renderLive(body);
        }

        const token = (this._renderToken = (this._renderToken || 0) + 1);
        if (!this._cache.get(this._days)) body.innerHTML = this._skeleton();
        let data;
        try { data = await this._data(this._days); }
        catch (_) {
            if (token === this._renderToken) body.innerHTML = '<p class="rma-empty">The board could not be loaded. Try again in a moment.</p>';
            return;
        }
        if (token !== this._renderToken) return;

        stats.innerHTML = `
            <span><b>${Number(data.controllers || 0).toLocaleString()}</b> controllers</span>
            <span><b>${Number(data.ratings || 0).toLocaleString()}</b> ratings</span>
            <span><b>${Number(data.kudos || 0).toLocaleString()}</b> kudos</span>
            ${data.ratings ? `<span>board avg <b>${Number(data.board_avg).toFixed(1)}★</b></span>` : ''}`;

        const list = (this._tab === 'top' ? data.top_rated : data.most_kudos) || [];
        const rows = list.filter(r => !this._query || String(r.username || '').toLowerCase().includes(this._query));
        if (!rows.length) {
            body.innerHTML = `<p class="rma-empty">${this._query
                ? 'No controller by that name on this board.'
                : this._tab === 'top'
                    ? 'Nobody has 3 or more ratings yet. Rate controllers with ★ next to their name while they are on frequency.'
                    : 'No kudos yet. Tap 👍 or ☀️ next to a controller to thank them.'}</p>`;
            return;
        }
        body.innerHTML = rows.map(r => this._rowHTML(r, list.indexOf(r) + 1)).join('');
        this._hydrateProfiles(body);
    },

    _avatarHTML(username) {
        const ini = String(username || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
        return `<span class="rma-avatar" data-rma-user="${esc(username || '')}" aria-hidden="true">${esc(ini)}</span>`;
    },

    // Pictures and banners for the rows on screen. Cached by PilotProfiles,
    // so switching tabs or periods does not ask again.
    _hydrateProfiles(body) {
        body.querySelectorAll('.rma-avatar[data-rma-user]').forEach((av) => {
            const name = av.dataset.rmaUser;
            if (!name) return;
            const apply = (p) => {
                if (!p || !av.isConnected) return;
                const row = av.closest('.rma-row');
                if (row) {
                    row.classList.add('has-profile');
                    row.style.setProperty('--rma-banner', p.bannerUrl ? `url("${p.bannerUrl}"), ${p.bannerGradient}` : p.bannerGradient);
                }
                if (p.avatarUrl) {
                    const img = new Image();
                    img.alt = '';
                    img.onload = () => { if (av.isConnected) { av.textContent = ''; av.appendChild(img); } };
                    img.src = p.avatarUrl;
                }
            };
            const hit = PilotProfiles.peek(name);
            if (hit !== undefined) apply(hit);
            else PilotProfiles.byIfUsername(name).then(apply);
        });
    },

    _rowHTML(r, rank) {
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `<span class="rma-rank-n">${rank}</span>`;
        const name = esc(r.username || 'Unknown controller');
        const rating = r.rating_count
            ? `<span class="rma-rating">${this._stars(r.rating_avg)} <b>${Number(r.rating_avg).toFixed(1)}</b>
                   <span class="rma-muted">(${Number(r.rating_count).toLocaleString()})</span></span>`
            : '<span class="rma-rating rma-muted">No ratings yet</span>';
        const kudos = r.kudos
            ? `<span class="rma-kudos" title="👍 ${r.thumbs_up} · ☀️ ${r.good_day}"><i class="fa-solid fa-award"></i> ${Number(r.kudos).toLocaleString()}</span>`
            : '';
        const where = r.last_airport ? `<span class="rma-apt">${esc(r.last_airport)}</span>` : '';
        return `
            <div class="rma-row${rank <= 3 ? ' is-podium' : ''}">
                <span class="rma-rank">${medal}</span>
                ${this._avatarHTML(r.username)}
                <span class="rma-main">
                    <button type="button" class="rma-name" data-atcc-act="profile"
                            data-atcc-user="${name}" data-atcc-id="${esc(r.controller_if_id)}">${name}</button>
                    <span class="rma-meta">${rating}${kudos}${where}</span>
                </span>
                <i class="fa-solid fa-chevron-right rma-chev" aria-hidden="true"></i>
            </div>`;
    },

    async _renderLive(body) {
        const api = window.InflightATC;
        const kudos = window.InflightKudos;
        const all = (api?.getFacilities?.() || [])
            .filter(f => f && f.userId && f.startTime && Number(f.type) !== 7)
            .filter(f => !this._query || String(f.username || '').toLowerCase().includes(this._query));
        if (!all.length) {
            body.innerHTML = `<p class="rma-empty">${this._query ? 'Nobody by that name is on frequency.' : 'No controllers are online right now.'}</p>`;
            return;
        }
        // Highest rated first, then those with no rating yet, by time on.
        if (kudos?._ensureCounts) await kudos._ensureCounts(all.map(f => f.userId));
        const c = (f) => kudos?._counts?.get(f.userId) || {};
        all.sort((a, b) => (c(b).rating_avg || 0) - (c(a).rating_avg || 0)
            || Date.parse(a.startTime) - Date.parse(b.startTime));
        body.innerHTML = all.slice(0, 120).map(f => {
            const [abbr, cls] = FACILITY[Number(f.type)] || ['ATC', 'obs'];
            const cc = c(f);
            const name = esc(f.username || 'Unknown controller');
            return `
                <div class="rma-row is-live">
                    <span class="atcc-type atcc-type-${cls}">${abbr}</span>
                    ${this._avatarHTML(f.username)}
                    <span class="rma-main">
                        <button type="button" class="rma-name" data-atcc-act="profile"
                                data-atcc-user="${name}" data-atcc-id="${esc(f.userId)}">${name}</button>
                        <span class="rma-meta">
                            ${f.airportName ? `<span class="rma-apt">${esc(f.airportName)}</span>` : ''}
                            ${cc.rating_count ? `<span class="rma-rating">${this._stars(cc.rating_avg)} <b>${Number(cc.rating_avg).toFixed(1)}</b>
                                <span class="rma-muted">(${cc.rating_count})</span></span>` : '<span class="rma-muted">Not rated yet</span>'}
                        </span>
                    </span>
                    ${kudos ? kudos.controlsHTML(f, { view: false }) : ''}
                </div>`;
        }).join('');
        this._hydrateProfiles(body);
    },

    _stars(avg) {
        const pct = Math.max(0, Math.min(100, (Number(avg) || 0) / 5 * 100));
        return `<span class="rma-stars" aria-hidden="true"><span class="rma-stars-bg">★★★★★</span><span class="rma-stars-fg" style="width:${pct}%">★★★★★</span></span>`;
    },

    _skeleton() {
        return Array.from({ length: 6 }, () => '<div class="rma-row rma-skel"><span class="rma-skel-b" style="width:28px"></span><span class="rma-skel-b" style="flex:1"></span></div>').join('');
    },

    _injectStyles() {
        if (document.getElementById('rma-styles')) return;
        const style = document.createElement('style');
        style.id = 'rma-styles';
        style.textContent = `
            html.rma-lock { overflow: hidden; }
            .rma-root { position: fixed; inset: 0; z-index: 9990; display: none; }
            .rma-root.is-open { display: block; }
            .rma-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.55); backdrop-filter: blur(3px); }
            .rma-panel { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                width: min(560px, calc(100vw - 32px)); max-height: min(760px, calc(100vh - 48px));
                display: flex; flex-direction: column; border-radius: 18px; overflow: hidden;
                background: #141416; border: 1px solid rgba(255,255,255,0.09); color: #e4e4e7;
                box-shadow: 0 30px 80px rgba(0,0,0,0.55); font-family: inherit; animation: rma-in .22s ease-out; }
            @keyframes rma-in { from { opacity: 0; transform: translate(-50%, -48%); } to { opacity: 1; transform: translate(-50%, -50%); } }
            .rma-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px 10px;
                background: radial-gradient(120% 140% at 0% 0%, rgba(250,204,21,0.16), transparent 60%); }
            .rma-brand { display: flex; align-items: center; gap: 12px; }
            .rma-logo { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; font-size: 1.3rem;
                background: linear-gradient(135deg, #facc15, #f97316); color: #1c1917; box-shadow: 0 6px 18px rgba(249,115,22,0.35); }
            .rma-head h2 { margin: 0; font-size: 1.15rem; font-weight: 800; color: #fff; letter-spacing: -.01em; }
            .rma-sub { display: block; font-size: 0.74rem; color: #a1a1aa; }
            .rma-head-actions { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; }
            .rma-page { padding: 6px 10px; border-radius: 999px; border: 1px solid rgba(250,204,21,0.4); background: rgba(250,204,21,0.1);
                color: #fde68a; font-size: 0.72rem; font-weight: 700; text-decoration: none; white-space: nowrap; }
            .rma-page:hover { background: rgba(250,204,21,0.2); }
            .rma-page i { font-size: 0.62rem; margin-left: 3px; }
            .rma-x { width: 32px; height: 32px; border-radius: 50%; border: 0; background: rgba(255,255,255,0.07); color: #a1a1aa; cursor: pointer; }
            .rma-tabs { display: flex; gap: 6px; padding: 6px 18px 0; border-bottom: 1px solid rgba(255,255,255,0.07); }
            .rma-tab { flex: 1 1 0; padding: 10px 6px; border: 0; border-bottom: 2px solid transparent; background: none; color: #a1a1aa;
                font-family: inherit; font-size: 0.78rem; font-weight: 700; cursor: pointer; white-space: nowrap; }
            .rma-tab i { margin-right: 4px; }
            .rma-tab.is-on { color: #fde68a; border-bottom-color: #facc15; }
            .rma-tools { display: flex; align-items: center; gap: 10px; padding: 12px 18px 6px; flex-wrap: wrap; }
            .rma-period { display: inline-flex; gap: 4px; padding: 3px; border-radius: 999px; background: rgba(255,255,255,0.05); }
            .rma-period[hidden] { display: none; }
            .rma-chip { padding: 5px 12px; border: 0; border-radius: 999px; background: none; color: #a1a1aa;
                font-family: inherit; font-size: 0.72rem; font-weight: 700; cursor: pointer; }
            .rma-chip.is-on { background: rgba(250,204,21,0.18); color: #fde68a; }
            .rma-search { flex: 1 1 160px; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px;
                background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: #71717a; font-size: 0.8rem; }
            .rma-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: none; color: #f4f4f5; font-family: inherit; font-size: 0.82rem; }
            .rma-stats { display: flex; flex-wrap: wrap; gap: 14px; padding: 4px 18px 8px; font-size: 0.7rem; color: #a1a1aa; }
            .rma-stats:empty { display: none; }
            .rma-stats b { color: #f4f4f5; }
            .rma-body { flex: 1 1 auto; overflow-y: auto; padding: 4px 10px 10px; }
            .rma-row { display: flex; align-items: center; gap: 12px; padding: 10px 8px; border-radius: 12px; }
            .rma-row + .rma-row { border-top: 1px solid rgba(255,255,255,0.05); }
            .rma-row:hover { background: rgba(255,255,255,0.03); }
            .rma-row.is-podium { background: linear-gradient(90deg, rgba(250,204,21,0.07), transparent 70%); }
            .rma-rank { flex: 0 0 34px; text-align: center; font-size: 1.25rem; }
            .rma-rank-n { font-size: 0.8rem; font-weight: 800; color: #71717a; }
            .rma-avatar { flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%; overflow: hidden;
                display: grid; place-items: center; background: #3f3f46; color: #e4e4e7; font-size: 0.7rem; font-weight: 800;
                border: 1.5px solid rgba(255,255,255,0.75); box-shadow: 0 2px 6px rgba(0,0,0,0.35); }
            .rma-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .rma-row.has-profile { background-image: linear-gradient(90deg, rgba(24,24,27,0.94) 0%, rgba(24,24,27,0.78) 60%, rgba(24,24,27,0.62) 100%), var(--rma-banner);
                background-size: cover; background-position: center; }
            .rma-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
            .rma-name { padding: 0; border: 0; background: none; text-align: left; cursor: pointer; font-family: inherit;
                font-size: 0.92rem; font-weight: 700; color: #f4f4f5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .rma-name:hover { color: #7dd3fc; }
            .rma-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 0.72rem; color: #d4d4d8; }
            .rma-rating b { color: #fde68a; }
            .rma-muted { color: #71717a; }
            .rma-kudos { color: #fcd34d; font-weight: 700; }
            .rma-kudos i { margin-right: 3px; }
            .rma-apt { padding: 1px 6px; border-radius: 6px; background: rgba(56,189,248,0.1); color: #7dd3fc; font-family: monospace; font-size: 0.68rem; }
            .rma-chev { color: #3f3f46; font-size: 0.7rem; }
            .rma-row.is-live .atcc-controls { margin-left: auto; }
            .rma-stars { position: relative; display: inline-block; font-size: 0.78rem; letter-spacing: 1px; line-height: 1; vertical-align: -1px; }
            .rma-stars-bg { color: #3f3f46; }
            .rma-stars-fg { position: absolute; inset: 0 auto 0 0; overflow: hidden; white-space: nowrap; color: #facc15; }
            .rma-empty { margin: 24px 16px; text-align: center; font-size: 0.82rem; line-height: 1.5; color: #a1a1aa; }
            .rma-foot { padding: 10px 18px 14px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 0.66rem; line-height: 1.45; color: #71717a; }
            .rma-skel .rma-skel-b { height: 14px; border-radius: 6px; background: rgba(255,255,255,0.06); animation: rma-pulse 1.2s ease-in-out infinite; }
            @keyframes rma-pulse { 50% { opacity: .45; } }
            @media (max-width: 768px) {
                .rma-panel { top: auto; bottom: 0; left: 0; transform: none; width: 100vw; max-height: 92vh;
                    border-radius: 18px 18px 0 0; animation: rma-up .25s ease-out; padding-bottom: env(safe-area-inset-bottom); }
                @keyframes rma-up { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
                .rma-head, .rma-tabs, .rma-tools, .rma-stats, .rma-foot { padding-left: 16px; padding-right: 16px; }
                .rma-tab { font-size: 0.74rem; }
            }
        `;
        document.head.appendChild(style);
    },
};

export default RateMyAtcBoard;
