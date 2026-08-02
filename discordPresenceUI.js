/**
 * discordPresenceUI.js
 *
 * The Discord Rich Presence panel that lives in Profile → Settings, plus the
 * flight picker it opens. Kept out of profileUI.js on purpose: that file is
 * already ten thousand lines, and everything here is self-contained — mount a
 * host element, and the panel renders, wires its own listeners and re-renders
 * itself off DiscordPresence's change events until the host goes away.
 *
 * The panel's centrepiece is a live mock of the Discord card, built from the
 * same DiscordPresence.describe() copy that gets pushed over RPC. A pilot can
 * see the aircraft photo, the route and the countdown before they connect
 * anything, which is the honest way to sell the feature.
 *
 *   DiscordPresenceUI.mount(hostEl)   → render into a container, wire listeners
 *   DiscordPresenceUI.unmount()       → drop listeners (called on tab change)
 */

import { DiscordPresence } from './discordPresence.js';

const DISCORD_BLURPLE = '#5865F2';

const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** "2h 14m", "14m", "—" — the countdown Discord itself renders on the card. */
function formatCountdown(endsAtMs) {
    if (!endsAtMs) return null;
    const remainingMs = endsAtMs - Date.now();
    if (remainingMs <= 0) return 'Arriving';
    const totalMinutes = Math.round(remainingMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours}h ${minutes}m left` : `${minutes}m left`;
}

let _stylesInjected = false;

function injectStyles() {
    if (_stylesInjected || typeof document === 'undefined') return;
    _stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'inflight-dpui-styles';
    style.textContent = `
        .dpui-status-row { display:flex; align-items:center; gap:10px; margin-bottom:14px; flex-wrap:wrap; }
        .dpui-pill {
            display:inline-flex; align-items:center; gap:6px;
            padding:4px 10px; border-radius:999px;
            font-size:0.72rem; font-weight:600; letter-spacing:0.02em;
            background:rgba(255,255,255,0.06); color:var(--pui-text-secondary);
        }
        .dpui-pill .fa-circle { font-size:0.5rem; }
        .dpui-pill[data-status="connected"] { background:rgba(34,197,94,0.14); color:#22c55e; }
        .dpui-pill[data-status="connecting"] { background:rgba(234,179,8,0.14); color:#eab308; }
        .dpui-pill[data-status="error"] { background:rgba(239,68,68,0.14); color:#ef4444; }
        .dpui-account { font-size:0.78rem; color:var(--pui-text-tertiary); }
        .dpui-account strong { color:var(--pui-text-secondary); font-weight:600; }

        /* ── The Discord card mock ─────────────────────────────────────── */
        .dpui-card {
            border-radius:14px; padding:16px;
            background:#232428; border:1px solid rgba(255,255,255,0.06);
            color:#f2f3f5; box-shadow:0 8px 24px rgba(0,0,0,0.28);
        }
        .dpui-card-label {
            font-size:0.66rem; font-weight:700; letter-spacing:0.08em;
            text-transform:uppercase; color:#b5bac1; margin-bottom:12px;
        }
        .dpui-card-body { display:flex; gap:14px; align-items:flex-start; }
        .dpui-art { position:relative; flex:0 0 auto; width:80px; height:80px; }
        .dpui-art-large {
            width:80px; height:80px; border-radius:10px; overflow:hidden;
            background:#1e1f22 center/cover no-repeat;
            display:flex; align-items:center; justify-content:center;
            color:#4e5058; font-size:1.6rem;
        }
        .dpui-art-small {
            position:absolute; right:-6px; bottom:-6px;
            width:28px; height:28px; border-radius:50%;
            background:#1e1f22; border:3px solid #232428;
            display:flex; align-items:center; justify-content:center;
            color:#b5bac1; font-size:0.7rem;
        }
        .dpui-lines { min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
        .dpui-app { font-size:0.86rem; font-weight:700; color:#fff; }
        .dpui-line { font-size:0.8rem; color:#dbdee1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dpui-line-dim { font-size:0.78rem; color:#b5bac1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dpui-buttons { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
        .dpui-fake-btn {
            flex:1 1 auto; min-width:120px; text-align:center;
            padding:7px 10px; border-radius:6px;
            background:#4e5058; color:#fff;
            font-size:0.76rem; font-weight:600;
        }

        .dpui-remote {
            margin-top:14px; padding:12px 14px; border-radius:12px;
            background:rgba(88,101,242,0.08); border:1px solid rgba(88,101,242,0.22);
        }
        .dpui-remote-head {
            display:flex; align-items:center; gap:9px;
            font-size:0.84rem; font-weight:600; color:var(--pui-text-secondary);
        }
        .dpui-remote-head i { color:${DISCORD_BLURPLE}; }

        .dpui-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
        .dpui-empty {
            padding:18px; border-radius:12px; text-align:center;
            border:1px dashed rgba(255,255,255,0.12);
            color:var(--pui-text-tertiary); font-size:0.82rem;
        }

        /* ── Flight picker ─────────────────────────────────────────────── */
        .dpui-picker-overlay {
            position:fixed; inset:0; z-index:10001;
            display:flex; align-items:center; justify-content:center;
            background:rgba(0,0,0,0.55); padding:20px;
        }
        .dpui-picker {
            width:min(520px, 100%); max-height:min(640px, 88vh);
            display:flex; flex-direction:column;
            border-radius:16px; overflow:hidden;
            background:var(--pui-surface, #1c1d21);
            border:1px solid rgba(255,255,255,0.08);
            box-shadow:0 24px 60px rgba(0,0,0,0.45);
        }
        .dpui-picker-head { padding:18px 20px 12px; }
        .dpui-picker-head h3 { margin:0 0 4px; font-size:1rem; color:var(--pui-text-primary, #fff); }
        .dpui-picker-head p { margin:0; font-size:0.8rem; color:var(--pui-text-tertiary); }
        .dpui-search {
            margin:12px 20px 0; padding:9px 12px; border-radius:9px;
            border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04);
            color:inherit; font-size:0.85rem; font-family:inherit;
        }
        .dpui-results { overflow-y:auto; padding:12px 20px 20px; flex:1; }
        .dpui-group-label {
            font-size:0.66rem; font-weight:700; letter-spacing:0.08em;
            text-transform:uppercase; color:var(--pui-text-tertiary);
            margin:14px 0 6px;
        }
        .dpui-group-label:first-child { margin-top:0; }
        .dpui-result {
            width:100%; display:flex; align-items:center; gap:12px;
            padding:10px 12px; margin-bottom:6px;
            border-radius:10px; border:1px solid transparent;
            background:rgba(255,255,255,0.03); color:inherit;
            font-family:inherit; text-align:left; cursor:pointer;
            transition:background-color .12s ease, border-color .12s ease;
        }
        .dpui-result:hover { background:rgba(255,255,255,0.07); border-color:rgba(255,255,255,0.12); }
        .dpui-result[data-active="true"] { border-color:${DISCORD_BLURPLE}; background:rgba(88,101,242,0.12); }
        .dpui-result-icon {
            flex:0 0 auto; width:34px; height:34px; border-radius:9px;
            display:flex; align-items:center; justify-content:center;
            background:rgba(88,101,242,0.15); color:${DISCORD_BLURPLE};
        }
        .dpui-result-main { min-width:0; flex:1; }
        .dpui-result-title {
            font-size:0.86rem; font-weight:600;
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        }
        .dpui-result-sub {
            font-size:0.74rem; color:var(--pui-text-tertiary);
            overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        }
        .dpui-picker-foot {
            padding:12px 20px; border-top:1px solid rgba(255,255,255,0.06);
            display:flex; justify-content:flex-end; gap:8px;
        }
        .dpui-no-results { padding:24px 0; text-align:center; font-size:0.82rem; color:var(--pui-text-tertiary); }
    `;
    document.head.appendChild(style);
}

export const DiscordPresenceUI = {
    _host: null,
    _unsubscribe: null,
    _tickTimer: null,
    _endsAtMs: null,
    _countdownLabel: null,
    _countdownPending: false,
    _busy: false,
    _error: '',

    // Supplied by profileUI so the picker can lead with the pilot's own flight
    // and the pilots they already watch.
    _context: { ifUsername: '', watchlist: [] },

    /**
     * @param {HTMLElement} host
     * @param {{ifUsername?: string, watchlist?: string[]}} [context]
     */
    mount(host, context = {}) {
        if (!host) return;
        injectStyles();

        this.unmount();
        this._host = host;
        this._context = {
            ifUsername: context.ifUsername || '',
            watchlist: Array.isArray(context.watchlist) ? context.watchlist : [],
        };

        DiscordPresence.init().then(() => this._render());
        this._unsubscribe = DiscordPresence.onChange(() => this._render());

        // The countdown is ours to animate; a minute is as fine-grained as the
        // card ever gets.
        this._tickTimer = setInterval(() => {
            if (!document.body.contains(this._host)) { this.unmount(); return; }
            if (this._endsAtMs) this._render();
        }, 30000);

        this._render();
    },

    unmount() {
        if (this._unsubscribe) this._unsubscribe();
        this._unsubscribe = null;
        clearInterval(this._tickTimer);
        this._tickTimer = null;
        this._host = null;
    },

    // =======================================================================
    // Rendering
    // =======================================================================

    _render() {
        const host = this._host;
        if (!host || !document.body.contains(host)) return;

        const state = DiscordPresence.getState();

        if (!state.supported) {
            host.innerHTML = `
                <div class="dpui-empty">
                    <i class="fa-brands fa-discord" style="font-size:1.4rem; color:${DISCORD_BLURPLE}; display:block; margin-bottom:8px;"></i>
                    Discord presence isn't available on this deployment yet.
                </div>`;
            return;
        }

        const copy = DiscordPresence.describe();
        this._refreshCountdown(state);

        const footnote = state.connected
            ? 'Your status updates while this tab is open and clears when you disconnect. You can switch flights from your phone.'
            : (state.hostCapable
                ? 'Needs the Discord desktop app running on this computer.'
                : 'Rich Presence is sent by your computer — this picks what it shows.');

        host.innerHTML = `
            ${this._statusRowHTML(state)}
            ${this._cardHTML(state, copy)}
            ${state.connected ? '' : this._remoteHTML(state)}
            ${this._error ? `<div class="pui-alert" style="margin-top:12px;">${esc(this._error)}</div>` : ''}
            ${this._actionsHTML(state)}
            <p class="pui-help-text" style="margin-top:12px;">${esc(footnote)}</p>
        `;

        this._wire();
    },

    _statusRowHTML(state) {
        const labels = {
            // On a phone "not connected" would read as a fault; it's simply
            // what every phone is, so name the role instead.
            idle: state.hostCapable ? 'Not connected' : 'Remote control',
            connecting: 'Connecting…',
            connected: state.follow ? 'Broadcasting' : 'Connected',
            error: 'Problem',
            unsupported: 'Unavailable',
        };
        const account = state.discordUser
            ? `<span class="dpui-account">as <strong>${esc(state.discordUser.global_name || state.discordUser.username || '')}</strong></span>`
            : '';

        return `
            <div class="dpui-status-row">
                <span class="dpui-pill" data-status="${esc(state.status)}">
                    <i class="fa-solid fa-circle"></i> ${esc(labels[state.status] || state.status)}
                </span>
                ${account}
                ${state.detail ? `<span class="dpui-account">${esc(state.detail)}</span>` : ''}
            </div>`;
    },

    /** The mock of what friends see, driven by the real activity copy. */
    _cardHTML(state, copy) {
        const countdown = formatCountdown(this._endsAtMs);
        const art = copy.imageUrl
            ? `<div class="dpui-art-large" style="background-image:url('${esc(copy.imageUrl)}')"></div>`
            : `<div class="dpui-art-large"><i class="fa-solid fa-plane-up"></i></div>`;

        const phaseIcon = {
            'Taxiing': 'fa-road',
            'Takeoff / Landing Roll': 'fa-plane-departure',
            'Climbing': 'fa-arrow-trend-up',
            'Descending': 'fa-arrow-trend-down',
            'Cruising': 'fa-plane',
        }[copy.phase] || 'fa-plane-up';

        const buttons = state.flight
            ? ['Track this flight', 'Live map']
            : ['Open the live map'];

        return `
            <div class="dpui-card">
                <div class="dpui-card-label">Playing a game</div>
                <div class="dpui-card-body">
                    <div class="dpui-art" title="${esc(copy.largeText)}">
                        ${art}
                        ${copy.phase ? `<div class="dpui-art-small"><i class="fa-solid ${phaseIcon}"></i></div>` : ''}
                    </div>
                    <div class="dpui-lines">
                        <div class="dpui-app">Inflight</div>
                        <div class="dpui-line">${esc(copy.details)}</div>
                        <div class="dpui-line-dim">${esc(copy.state)}</div>
                        ${copy.smallText ? `<div class="dpui-line-dim">${esc(copy.smallText)}</div>` : ''}
                        ${countdown ? `<div class="dpui-line-dim">${esc(countdown)}</div>` : ''}
                    </div>
                </div>
                <div class="dpui-buttons">
                    ${buttons.map(label => `<div class="dpui-fake-btn">${esc(label)}</div>`).join('')}
                </div>
            </div>`;
    },

    /**
     * On a device that cannot reach Discord — a phone, or a desktop with
     * Discord closed — the panel becomes a remote for whichever machine can.
     * The pilot still picks the flight here; the laptop is what broadcasts it.
     */
    _remoteHTML(state) {
        const host = state.host || {};
        const onPhone = !state.hostCapable;

        if (!state.remoteAvailable) {
            return `<div class="dpui-empty" style="margin-top:14px;">
                ${onPhone
                    ? 'Discord Rich Presence has to be sent from a computer. Open Inflight on your laptop with Discord running to switch it on.'
                    : 'Sign in to pick a flight here and have your laptop broadcast it.'}
            </div>`;
        }

        const laptop = host.connected
            ? `<span class="dpui-pill" data-status="connected"><i class="fa-solid fa-circle"></i> Laptop broadcasting</span>`
            : (host.online
                ? `<span class="dpui-pill" data-status="connecting"><i class="fa-solid fa-circle"></i> Laptop open, Discord not connected</span>`
                : `<span class="dpui-pill"><i class="fa-solid fa-circle"></i> Laptop offline</span>`);

        return `
            <div class="dpui-remote">
                <div class="dpui-remote-head">
                    <i class="fa-solid fa-mobile-screen-button"></i>
                    <span>${onPhone ? 'Controlling your computer from here' : 'This device isn\'t connected to Discord'}</span>
                </div>
                <div class="dpui-status-row" style="margin:10px 0 0;">${laptop}</div>
                ${host.online ? '' : `
                <p class="pui-help-text" style="margin-top:10px;">
                    Whatever you pick is saved — your computer will start broadcasting it
                    the next time Inflight is open there with Discord running.
                </p>`}
            </div>`;
    },

    _actionsHTML(state) {
        if (this._busy) {
            return `<div class="dpui-actions">
                <button class="pui-btn-primary" disabled><i class="fa-solid fa-spinner fa-spin"></i> Working…</button>
            </div>`;
        }

        // A phone has no local Discord to connect to, so offering the button
        // would only ever produce an error. It gets the picker and nothing else.
        if (!state.connected && !state.hostCapable) {
            return `<div class="dpui-actions">
                <button class="pui-btn-primary" data-dpui="pick">
                    <i class="fa-solid fa-plane-up"></i> ${state.follow ? 'Change flight' : 'Choose a flight'}
                </button>
                ${state.follow ? `
                <button class="pui-btn-secondary" data-dpui="unfollow">
                    <i class="fa-solid fa-circle-stop"></i> Stop broadcasting
                </button>` : ''}
            </div>`;
        }

        if (!state.connected) {
            return `<div class="dpui-actions">
                <button class="pui-btn-primary" data-dpui="connect" style="background:${DISCORD_BLURPLE}; border-color:${DISCORD_BLURPLE};">
                    <i class="fa-brands fa-discord"></i> Connect Discord
                </button>
                <button class="pui-btn-secondary" data-dpui="pick">
                    <i class="fa-solid fa-plane-up"></i> ${state.follow ? 'Change flight' : 'Choose a flight'}
                </button>
            </div>`;
        }

        return `<div class="dpui-actions">
            <button class="pui-btn-primary" data-dpui="pick">
                <i class="fa-solid fa-plane-up"></i> ${state.follow ? 'Change flight' : 'Choose a flight'}
            </button>
            ${state.follow ? `
            <button class="pui-btn-secondary" data-dpui="unfollow">
                <i class="fa-solid fa-circle-stop"></i> Stop broadcasting
            </button>` : ''}
            <button class="pui-btn-ghost" data-dpui="disconnect">
                <i class="fa-solid fa-link-slash"></i> Disconnect
            </button>
        </div>`;
    },

    /**
     * The ETA needs the destination's coordinates, so it resolves after the
     * paint that asked for it. Re-rendering is gated on the *label* changing,
     * not the raw timestamp: the estimate drifts by milliseconds on every
     * recompute, and reacting to that would spin the panel forever.
     */
    _refreshCountdown(state) {
        if (!state.flight) {
            this._endsAtMs = null;
            this._countdownLabel = null;
            return;
        }
        if (this._countdownPending) return;

        this._countdownPending = true;
        DiscordPresence.previewEndsAt()
            .catch(() => null)
            .then((endsAt) => {
                this._countdownPending = false;
                this._endsAtMs = endsAt;
                const label = formatCountdown(endsAt);
                if (label === this._countdownLabel) return;
                this._countdownLabel = label;
                this._render();
            });
    },

    _wire() {
        const host = this._host;
        if (!host) return;

        host.querySelector('[data-dpui="connect"]')?.addEventListener('click', async () => {
            this._busy = true;
            this._error = '';
            this._render();
            try {
                await DiscordPresence.connect();
            } catch (err) {
                this._error = err.message || 'Could not connect to Discord.';
            } finally {
                this._busy = false;
                this._render();
            }
        });

        host.querySelector('[data-dpui="disconnect"]')?.addEventListener('click', async () => {
            this._busy = true;
            this._render();
            await DiscordPresence.disconnect();
            this._busy = false;
            this._render();
        });

        host.querySelector('[data-dpui="unfollow"]')?.addEventListener('click', () => {
            DiscordPresence.unfollow();
        });

        host.querySelector('[data-dpui="pick"]')?.addEventListener('click', () => {
            this._openPicker();
        });
    },

    // =======================================================================
    // Flight picker
    // =======================================================================

    _openPicker() {
        injectStyles();
        document.getElementById('dpui-picker')?.remove();

        const overlay = document.createElement('div');
        overlay.id = 'dpui-picker';
        overlay.className = 'dpui-picker-overlay';
        overlay.innerHTML = `
            <div class="dpui-picker" role="dialog" aria-modal="true" aria-label="Choose a flight to broadcast">
                <div class="dpui-picker-head">
                    <h3>Broadcast a flight</h3>
                    <p>Your Discord status follows this flight until it lands or you stop it.</p>
                </div>
                <input class="dpui-search" id="dpui-search" type="search" autocomplete="off"
                       placeholder="Search by callsign, pilot or airport…">
                <div class="dpui-results" id="dpui-results"></div>
                <div class="dpui-picker-foot">
                    <button class="pui-btn-ghost" data-dpui="picker-close">Cancel</button>
                </div>
            </div>`;

        document.body.appendChild(overlay);

        const close = () => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
        };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', onKey);

        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('[data-dpui="picker-close"]').addEventListener('click', close);

        const results = overlay.querySelector('#dpui-results');
        const search = overlay.querySelector('#dpui-search');

        const paint = () => {
            results.innerHTML = this._resultsHTML(search.value.trim().toLowerCase());
            results.querySelectorAll('.dpui-result').forEach((btn) => {
                btn.addEventListener('click', () => {
                    DiscordPresence.follow({
                        flightId: btn.dataset.flightId || null,
                        username: btn.dataset.username,
                        label: btn.dataset.label || btn.dataset.username,
                    });
                    close();
                    // Connecting on pick saves a second click for anyone who
                    // opened the picker before connecting. On a phone there is
                    // nothing to connect to — the pick alone is the whole job.
                    const picked = DiscordPresence.getState();
                    if (!picked.connected && picked.hostCapable) {
                        this._busy = true;
                        this._render();
                        DiscordPresence.connect()
                            .catch((err) => { this._error = err.message || 'Could not connect to Discord.'; })
                            .finally(() => { this._busy = false; this._render(); });
                    }
                });
            });
        };

        let debounce = null;
        search.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(paint, 120);
        });

        paint();
        search.focus();
    },

    /**
     * Grouped candidates: the pilot's own flight, then the pilots they watch,
     * then everyone else — filtered by the search box once it has a query.
     */
    _resultsHTML(query) {
        const flights = DiscordPresence.getLiveFlights() || [];
        if (!flights.length) {
            return `<div class="dpui-no-results">No live flights right now. The map is still loading, or the server is quiet.</div>`;
        }

        const active = DiscordPresence.getState().follow;
        const me = (this._context.ifUsername || '').toLowerCase();
        const watched = new Set(this._context.watchlist.map((w) => String(w).toLowerCase()));

        const matches = (flight) => {
            if (!query) return true;
            return [flight.callsign, flight.username, flight.departureIcao, flight.arrivalIcao,
                flight.aircraft?.aircraftName, flight.aircraft?.liveryName]
                .some((field) => field && String(field).toLowerCase().includes(query));
        };

        const groups = { mine: [], watchlist: [], all: [] };
        for (const flight of flights) {
            if (!flight?.username || !matches(flight)) continue;
            const user = flight.username.toLowerCase();
            if (me && user === me) groups.mine.push(flight);
            else if (watched.has(user)) groups.watchlist.push(flight);
            else groups.all.push(flight);
        }

        // The full server list runs to thousands; without a query, show a
        // useful slice rather than building DOM for all of them.
        const cap = query ? 40 : 12;
        groups.all = groups.all
            .sort((a, b) => (b.position?.alt_ft || 0) - (a.position?.alt_ft || 0))
            .slice(0, cap);

        const row = (flight) => {
            const cs = flight.callsign || flight.username;
            const dep = flight.departureIcao || '????';
            const arr = flight.arrivalIcao || '????';
            const acft = flight.aircraft?.aircraftName || 'Unknown aircraft';
            const alt = Math.round(flight.position?.alt_ft || 0);
            const isActive = active && String(active.flightId) === String(flight.flightId);

            return `
                <button type="button" class="dpui-result"
                        data-active="${isActive}"
                        data-flight-id="${esc(flight.flightId)}"
                        data-username="${esc(flight.username)}"
                        data-label="${esc(cs)}">
                    <span class="dpui-result-icon"><i class="fa-solid fa-plane-up"></i></span>
                    <span class="dpui-result-main">
                        <span class="dpui-result-title">${esc(cs)} · ${esc(dep)} → ${esc(arr)}</span>
                        <span class="dpui-result-sub">${esc(flight.username)} · ${esc(acft)} · ${alt.toLocaleString()} ft</span>
                    </span>
                    ${isActive ? '<i class="fa-solid fa-check" style="color:' + DISCORD_BLURPLE + ';"></i>' : ''}
                </button>`;
        };

        const section = (label, list) => (list.length
            ? `<div class="dpui-group-label">${esc(label)}</div>${list.map(row).join('')}`
            : '');

        const html = section('Your flight', groups.mine)
            + section('Pilots you watch', groups.watchlist)
            + section(query ? 'Search results' : 'Live right now', groups.all);

        return html || `<div class="dpui-no-results">Nothing matched "${esc(query)}".</div>`;
    },
};

if (typeof window !== 'undefined') {
    window.DiscordPresenceUI = DiscordPresenceUI;
}

export default DiscordPresenceUI;
