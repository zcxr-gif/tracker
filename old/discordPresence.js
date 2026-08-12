/**
 * discordPresence.js
 *
 * Discord Rich Presence for the live map. When a pilot connects a flight from
 * their profile, their Discord status turns into a live flight strip —
 * callsign, type, route, phase, altitude, a countdown to touchdown, and the
 * community photo of the actual airframe as the large image:
 *
 *     ┌──────────────────────────────────────┐
 *     │ ┌────────┐  Inflight                 │
 *     │ │  📷    │  BA278 · Boeing 777-300ER │
 *     │ │ plane  │  KJFK → EGLL · FL380      │
 *     │ └───┬────┘  Cruising · 512 kt        │
 *     │   [phase]   02:14 left               │
 *     │  [ Track this flight ] [ Live map ]  │
 *     └──────────────────────────────────────┘
 *
 * ── How this works in a browser ────────────────────────────────────────────
 * The Discord desktop client runs a local RPC websocket server on one of ports
 * 6463-6472. A web page may talk to it directly, with two conditions:
 *
 *   • The page's origin must be listed in the application's RPC Origins in the
 *     Discord developer portal. The browser sets the Origin header itself and
 *     Discord closes the socket with code 4002 if it isn't allowlisted.
 *   • SET_ACTIVITY usually works straight after the handshake. When a build
 *     insists on authentication we run AUTHORIZE, hand the resulting code to
 *     the backend (which holds the client secret), and AUTHENTICATE with the
 *     token that comes back. The token is cached so consent is a one-time
 *     dialog rather than something the pilot sees on every visit.
 *
 * There is no Discord desktop client in a browser-only or mobile session, so
 * every failure path here is soft: the panel reports what happened and the rest
 * of the map carries on untouched.
 *
 * ── Public API ─────────────────────────────────────────────────────────────
 *   DiscordPresence.init()                  → probe the backend for config
 *   DiscordPresence.connect()               → open RPC (asks consent if needed)
 *   DiscordPresence.disconnect({forget})    → clear activity, close socket
 *   DiscordPresence.follow({flightId, username, label})
 *   DiscordPresence.unfollow()              → back to the idle "browsing" card
 *   DiscordPresence.onChange(cb) → unsubscribe
 *   DiscordPresence.getState()              → snapshot for the UI
 *
 * @typedef {'unsupported'|'idle'|'connecting'|'connected'|'error'} PresenceStatus
 */

import { socketDataHub } from './SocketDataHub.js';

const BACKEND = (typeof window !== 'undefined' && window.APP_CONFIG?.backendUrl)
    || 'https://site--acars-backend--6dmjph8ltlhv.code.run';
const COMMUNITY_BACKEND = (typeof window !== 'undefined' && window.APP_CONFIG?.communityBackendUrl)
    || 'https://site--indgo-backend--6dmjph8ltlhv.code.run';
const SITE_ORIGIN = 'https://inflight.info';

// Discord's local RPC server takes the first free port in this range.
const RPC_PORTS = [6463, 6464, 6465, 6466, 6467, 6468, 6469, 6470, 6471, 6472];
const RPC_VERSION = 1;
const PORT_PROBE_MS = 2500;
const COMMAND_TIMEOUT_MS = 12000;
// AUTHORIZE puts a consent dialog in front of the user — they need longer than
// a machine does.
const AUTHORIZE_TIMEOUT_MS = 120000;

// SET_ACTIVITY is rate limited to 5 calls per 20 seconds. Spending that as a
// burst rather than a fixed floor is what makes picking a flight feel instant:
// a user-driven change goes out immediately while there's budget, and only
// queues once the window is genuinely full. One slot is held back as headroom.
const RATE_WINDOW_MS = 20000;
const RATE_BURST = 4;
// How often a steady cruise refreshes its numbers when nothing else prompts it.
const UPDATE_CADENCE_MS = 15000;

const RECONNECT_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];

// Static assets uploaded under Rich Presence → Art Assets in the developer
// portal. The large one is only reached when a flight has no community photo.
const ASSET_FALLBACK_LARGE = 'inflight_logo';
const PHASE_ASSETS = {
    'Taxiing': 'phase_taxi',
    'Takeoff / Landing Roll': 'phase_takeoff',
    'Climbing': 'phase_climb',
    'Descending': 'phase_descent',
    'Cruising': 'phase_cruise',
    'Ground / Unknown': 'phase_ground',
};

// Discord truncates past these; trimming ourselves keeps the ellipsis sensible.
const MAX_DETAILS = 128;
const MAX_STATE = 128;
const MAX_ASSET_TEXT = 128;
const MAX_BUTTON_LABEL = 31;

const TOKEN_KEY = 'inflight.discordPresence.token';
const FOLLOW_KEY = 'inflight.discordPresence.follow';
const AUTOCONNECT_KEY = 'inflight.discordPresence.autoconnect';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clamp = (text, max) => {
    const s = String(text ?? '').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
};

const nowMs = () => Date.now();

/** Great-circle distance in nautical miles. */
function distanceNm(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Mirrors TelemetryAnalyticsEngine so both surfaces name the phase the same. */
function phaseOfFlight(alt, gs, vs) {
    if (alt < 100 && gs <= 45) return 'Taxiing';
    if (alt < 200 && gs > 45 && vs >= 0) return 'Takeoff / Landing Roll';
    if (alt >= 200 && vs > 300) return 'Climbing';
    if (alt >= 200 && vs < -300) return 'Descending';
    if (alt > 3000 && Math.abs(vs) <= 300 && gs > 100) return 'Cruising';
    return 'Ground / Unknown';
}

/** "FL380" above the transition altitude, "12,000 ft" below it. */
function formatAltitude(altFt) {
    const alt = Math.round(altFt || 0);
    if (alt >= 18000) return `FL${String(Math.round(alt / 100)).padStart(3, '0')}`;
    return `${alt.toLocaleString()} ft`;
}

function readJson(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
}

function writeJson(key, value) {
    try {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
    } catch (_) { /* private mode — presence still works, consent just repeats */ }
}

// ---------------------------------------------------------------------------
// RPC socket — one connection, nonce-matched command replies
// ---------------------------------------------------------------------------

class RpcSocket {
    constructor(ws, clientId) {
        this.ws = ws;
        this.clientId = clientId;
        this.pending = new Map(); // nonce -> { resolve, reject, timer }
        this.onClose = null;
        this.user = null;

        ws.addEventListener('message', (event) => this._handleMessage(event));
        ws.addEventListener('close', (event) => {
            const err = new Error(`Discord closed the connection (${event.code})`);
            err.closeCode = event.code;
            for (const [, entry] of this.pending) {
                clearTimeout(entry.timer);
                entry.reject(err);
            }
            this.pending.clear();
            if (this.onClose) this.onClose(event);
        });
    }

    get open() { return this.ws.readyState === WebSocket.OPEN; }

    _handleMessage(event) {
        let frame;
        try { frame = JSON.parse(event.data); } catch (_) { return; }
        const entry = frame?.nonce ? this.pending.get(frame.nonce) : null;
        if (!entry) return; // DISPATCH events we didn't ask for

        this.pending.delete(frame.nonce);
        clearTimeout(entry.timer);

        if (frame.evt === 'ERROR') {
            const err = new Error(frame.data?.message || 'Discord rejected the command');
            err.rpcCode = frame.data?.code;
            entry.reject(err);
        } else {
            entry.resolve(frame.data);
        }
    }

    command(cmd, args, timeoutMs = COMMAND_TIMEOUT_MS) {
        if (!this.open) return Promise.reject(new Error('Discord connection is closed'));
        const nonce = (crypto.randomUUID && crypto.randomUUID())
            || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(nonce);
                reject(new Error(`Discord did not answer ${cmd} in time`));
            }, timeoutMs);
            this.pending.set(nonce, { resolve, reject, timer });
            try {
                this.ws.send(JSON.stringify({ cmd, args, nonce }));
            } catch (e) {
                this.pending.delete(nonce);
                clearTimeout(timer);
                reject(e);
            }
        });
    }

    close() {
        this.onClose = null;
        try { this.ws.close(); } catch (_) { /* already gone */ }
    }
}

/**
 * Open the handshake on a single port. Resolves once Discord dispatches READY,
 * which is the only proof the socket is a real RPC endpoint rather than some
 * other local service that happened to accept the upgrade.
 */
function probePort(port, clientId) {
    return new Promise((resolve, reject) => {
        let ws;
        try {
            ws = new WebSocket(`ws://127.0.0.1:${port}/?v=${RPC_VERSION}&client_id=${encodeURIComponent(clientId)}&encoding=json`);
        } catch (e) {
            reject(e);
            return;
        }

        let settled = false;
        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn(value);
        };

        const timer = setTimeout(() => {
            try { ws.close(); } catch (_) { /* nothing to close */ }
            finish(reject, new Error(`Port ${port} did not respond`));
        }, PORT_PROBE_MS);

        ws.addEventListener('message', (event) => {
            let frame;
            try { frame = JSON.parse(event.data); } catch (_) { return; }
            if (frame?.cmd === 'DISPATCH' && frame?.evt === 'READY') {
                const socket = new RpcSocket(ws, clientId);
                socket.user = frame.data?.user || null;
                finish(resolve, socket);
            }
        });

        ws.addEventListener('close', (event) => {
            // 4002 is Discord telling us this page's origin is not on the
            // application's RPC Origins list — a setup problem, not a missing
            // client, and worth surfacing verbatim.
            const err = new Error(`Port ${port} closed (${event.code})`);
            err.closeCode = event.code;
            finish(reject, err);
        });

        ws.addEventListener('error', () => {
            finish(reject, new Error(`Port ${port} refused the connection`));
        });
    });
}

/**
 * Race every port at once. Sequential probing costs up to ten timeouts before
 * admitting Discord isn't running, which is far too long to sit behind a button
 * press; in parallel the whole scan is bounded by one probe timeout.
 */
async function openRpc(clientId) {
    const attempts = RPC_PORTS.map((port) => probePort(port, clientId));
    const results = await Promise.allSettled(attempts);

    let winner = null;
    let originRejected = false;
    for (const result of results) {
        if (result.status === 'fulfilled') {
            // A second port answering is a stale/duplicate client — close it.
            if (winner) result.value.close();
            else winner = result.value;
        } else if (result.reason?.closeCode === 4002) {
            originRejected = true;
        }
    }

    if (winner) return winner;
    if (originRejected) {
        throw new Error('Discord rejected this site\'s origin. Add it to the application\'s RPC Origins in the Discord developer portal.');
    }
    throw new Error('No Discord desktop app found. Open Discord on this computer and try again.');
}

// ---------------------------------------------------------------------------
// The presence controller
// ---------------------------------------------------------------------------

export const DiscordPresence = {
    // ---- configuration, resolved once from the backend ----
    _config: null,          // { enabled, clientId, externalAssets }
    _configPromise: null,

    // ---- connection ----
    _socket: null,
    _status: 'idle',        // PresenceStatus
    _statusDetail: '',      // human-readable line for the panel
    _discordUser: null,     // { username, global_name, id } once connected
    _connecting: null,      // in-flight connect() promise, shared by callers
    _reconnectAttempt: 0,
    _reconnectTimer: null,
    _intentionalClose: false,
    __pid: null,            // stand-in process id, minted once per session
    __authRetried: false,   // one OAuth fallback per socket, not per update

    // ---- what we're showing ----
    _follow: null,          // { flightId, username, label }
    _flight: null,          // last resolved live flight for _follow
    _flightSeenAtMs: 0,     // when we first saw this flight (timestamp fallback)
    _lastActivityKey: '',   // dedupe identical payloads
    _lastSentAtMs: 0,
    _sendTimes: [],         // send timestamps inside the current rate window
    _pendingTimer: null,
    _pendingAtMs: 0,
    _totalAirborne: 0,
    _lastFlights: [],       // most recent live packet, for immediate resolves
    _server: '',            // session name, for the deep link on the button

    // ---- caches ----
    _assetCache: new Map(),     // image url -> 'mp:external/...' | null
    _assetInFlight: new Map(),  // image url -> Promise
    _airportCoords: new Map(),  // ICAO -> [lat, lon] | null
    _coordsInFlight: new Map(),

    _listeners: new Set(),
    _feedUnsubscribe: null,
    _booted: false,

    // =======================================================================
    // Lifecycle
    // =======================================================================

    /**
     * Probe the backend once for the application id. Safe to call repeatedly —
     * the promise is memoised — and it never throws: an unreachable or
     * unconfigured backend simply leaves the feature reported as unsupported.
     */
    init() {
        if (this._configPromise) return this._configPromise;

        this._configPromise = fetch(`${BACKEND}/api/discord/presence/config`)
            .then((r) => (r.ok ? r.json() : null))
            .then((json) => {
                this._config = (json && json.enabled && json.clientId) ? json : null;
                if (!this._config) this._setStatus('unsupported', 'Discord presence is not enabled on this deployment.');
                else if (this._status === 'unsupported') this._setStatus('idle', '');
                return this._config;
            })
            .catch(() => {
                this._config = null;
                this._setStatus('unsupported', 'Could not reach the presence service.');
                return null;
            });

        return this._configPromise;
    },

    /**
     * Wire up the live feed and, if the pilot had presence running last visit,
     * quietly bring it back. Called once from the map bootstrap.
     */
    async boot() {
        if (this._booted) return;
        this._booted = true;

        this._subscribeFeed();

        const config = await this.init();
        if (!config) return;

        const savedFollow = readJson(FOLLOW_KEY);
        if (savedFollow && savedFollow.username) this._follow = savedFollow;

        // Only auto-reconnect for someone who explicitly turned this on before:
        // a cold visitor should never see a Discord consent dialog they didn't
        // ask for, and the port scan is not free.
        if (readJson(AUTOCONNECT_KEY) === true) {
            this.connect({ silent: true }).catch(() => { /* panel shows why */ });
        }
    },

    _subscribeFeed() {
        if (this._feedUnsubscribe) return;
        this._feedUnsubscribe = socketDataHub.subscribe('all_flights_update', (payload) => {
            const flights = payload?.flights;
            if (!Array.isArray(flights)) return;
            this._lastFlights = flights;
            this._server = payload.server || this._server;
            this._totalAirborne = flights.length;
            this._resolveFollowedFlight(flights);
            this._scheduleUpdate();
        });
    },

    // =======================================================================
    // Connection
    // =======================================================================

    /**
     * Open the RPC socket and push the current activity.
     * @param {{silent?: boolean}} [options] silent suppresses the "connecting"
     *        chatter used by the auto-reconnect path.
     */
    async connect(options = {}) {
        if (this._socket?.open) return true;
        if (this._connecting) return this._connecting;

        const config = await this.init();
        if (!config) throw new Error('Discord presence is not enabled on this deployment.');

        this._intentionalClose = false;
        if (!options.silent) this._setStatus('connecting', 'Looking for the Discord desktop app…');

        this._connecting = (async () => {
            const socket = await openRpc(config.clientId);
            socket.onClose = () => this._handleSocketClose();
            this._socket = socket;
            this._discordUser = socket.user;
            this._reconnectAttempt = 0;

            writeJson(AUTOCONNECT_KEY, true);
            this._setStatus('connected', this._follow ? '' : 'Connected — pick a flight to broadcast.');

            // Force the first frame out: nothing has been sent on this socket,
            // and a fresh socket gets a fresh shot at the auth fallback.
            this._lastActivityKey = '';
            this._lastSentAtMs = 0;
            this._sendTimes = [];
            this.__authRetried = false;
            await this._pushActivity();
            return true;
        })()
            .catch((err) => {
                this._socket = null;
                this._setStatus('error', err.message || 'Could not connect to Discord.');
                throw err;
            })
            .finally(() => { this._connecting = null; });

        return this._connecting;
    },

    /**
     * @param {{forget?: boolean}} [options] forget also drops the cached OAuth
     *        token, so the next connect asks for consent again.
     */
    async disconnect(options = {}) {
        this._intentionalClose = true;
        clearTimeout(this._reconnectTimer);
        clearTimeout(this._pendingTimer);
        this._reconnectTimer = null;
        this._pendingTimer = null;
        writeJson(AUTOCONNECT_KEY, false);

        if (this._socket?.open) {
            // Best effort — a dead socket must not stop us tearing down.
            try { await this._socket.command('SET_ACTIVITY', { pid: this._pid(), activity: null }, 4000); } catch (_) { /* gone */ }
        }
        if (this._socket) this._socket.close();

        this._socket = null;
        this._discordUser = null;
        this._lastActivityKey = '';
        if (options.forget) writeJson(TOKEN_KEY, null);
        this._setStatus('idle', 'Disconnected.');
    },

    _handleSocketClose() {
        this._socket = null;
        this._discordUser = null;
        this._lastActivityKey = '';
        if (this._intentionalClose) return;

        // Discord was quit or restarted. Back off rather than hammering the
        // port scan, and stop once it's clearly not coming back.
        const delay = RECONNECT_DELAYS_MS[Math.min(this._reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
        this._reconnectAttempt += 1;

        if (this._reconnectAttempt > RECONNECT_DELAYS_MS.length) {
            this._setStatus('error', 'Lost the connection to Discord. Reconnect when it\'s running again.');
            return;
        }

        this._setStatus('connecting', 'Lost Discord — reconnecting…');
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = setTimeout(() => {
            this.connect({ silent: true }).catch(() => { /* status already set */ });
        }, delay);
    },

    /**
     * The RPC server wants a process id. A browser tab has none, so we mint a
     * stable stand-in per session — Discord only uses it to tell concurrent
     * presences apart.
     */
    _pid() {
        if (!this.__pid) this.__pid = 1000 + Math.floor(Math.random() * 60000);
        return this.__pid;
    },

    // =======================================================================
    // Authentication (only when a Discord build demands it)
    // =======================================================================

    async _ensureAuthenticated() {
        const cached = readJson(TOKEN_KEY);
        if (cached?.accessToken && cached.clientId === this._config.clientId
            && cached.expiresAt && cached.expiresAt > nowMs() + 60000) {
            try {
                await this._socket.command('AUTHENTICATE', { access_token: cached.accessToken });
                return true;
            } catch (_) {
                // Revoked or rejected — fall through and ask for consent again.
                writeJson(TOKEN_KEY, null);
            }
        }

        this._setStatus('connecting', 'Waiting for you to approve Inflight in Discord…');

        const authorized = await this._socket.command('AUTHORIZE', {
            client_id: this._config.clientId,
            scopes: ['rpc', 'rpc.activities.write'],
        }, AUTHORIZE_TIMEOUT_MS);

        const code = authorized?.code;
        if (!code) throw new Error('Discord did not return an authorisation code.');

        const res = await fetch(`${BACKEND}/api/discord/presence/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.accessToken) {
            throw new Error(json?.error?.message || 'Could not complete the Discord sign-in.');
        }

        await this._socket.command('AUTHENTICATE', { access_token: json.accessToken });

        writeJson(TOKEN_KEY, {
            clientId: this._config.clientId,
            accessToken: json.accessToken,
            expiresAt: nowMs() + ((json.expiresIn || 604800) * 1000),
        });
        this._setStatus('connected', '');
        return true;
    },

    // =======================================================================
    // What to broadcast
    // =======================================================================

    /**
     * Bind the presence to a flight. Tracking carries the username as well as
     * the flight id so the card survives the pilot respawning or the session
     * rolling over to a new flight id mid-route.
     *
     * @param {{flightId?: string, username: string, label?: string}} target
     */
    follow(target) {
        if (!target?.username) return;
        this._follow = {
            flightId: target.flightId ? String(target.flightId) : null,
            username: target.username,
            label: target.label || target.username,
        };
        this._flight = null;
        this._flightSeenAtMs = 0;
        writeJson(FOLLOW_KEY, this._follow);

        // Resolve against the packet already in hand so the card fills in
        // immediately rather than on the next backend tick.
        this._resolveFollowedFlight(this._lastFlights);

        this._scheduleUpdate({ immediate: true });
        this._emit();
    },

    unfollow() {
        this._follow = null;
        this._flight = null;
        writeJson(FOLLOW_KEY, null);
        this._scheduleUpdate({ immediate: true });
        this._emit();
    },

    /** Match the followed target against a live packet, id first then pilot. */
    _resolveFollowedFlight(flights) {
        if (!Array.isArray(flights)) return;
        if (!this._follow) {
            this._flight = null;
            return;
        }

        const wantedId = this._follow.flightId;
        const wantedUser = this._follow.username.toLowerCase();

        let match = null;
        for (const flight of flights) {
            if (!flight) continue;
            if (wantedId && String(flight.flightId) === wantedId) { match = flight; break; }
            if (!match && flight.username && flight.username.toLowerCase() === wantedUser) match = flight;
        }

        if (!match) {
            this._flight = null;
            this._flightSeenAtMs = 0;
            return;
        }

        // The pilot started a new leg: adopt the new id so subsequent ticks
        // match on the fast path again.
        if (String(match.flightId) !== this._follow.flightId) {
            this._follow.flightId = String(match.flightId);
            writeJson(FOLLOW_KEY, this._follow);
            this._flightSeenAtMs = 0;
        }

        if (!this._flightSeenAtMs) this._flightSeenAtMs = nowMs();
        this._flight = match;
    },

    // =======================================================================
    // Activity payload
    // =======================================================================

    /**
     * Every line of copy on the card, derived synchronously from the flight.
     * Both the Discord payload and the panel's live preview read this, so what
     * a pilot sees before connecting is exactly what their friends get.
     *
     * @returns {{details: string, state: string, largeText: string,
     *            smallText: string, phase: string, imageUrl: string|null}}
     */
    describe() {
        const flight = this._flight;

        if (!flight) {
            const airborne = this._totalAirborne;
            return {
                idle: true,
                details: this._follow
                    ? clamp(`Waiting for ${this._follow.label}`, MAX_DETAILS)
                    : 'Browsing the live map',
                state: airborne
                    ? clamp(`${airborne.toLocaleString()} aircraft airborne`, MAX_STATE)
                    : 'Infinite Flight live traffic',
                largeText: 'Inflight · inflight.info',
                smallText: '',
                phase: '',
                imageUrl: null,
            };
        }

        const position = flight.position || {};
        const alt = Math.round(position.alt_ft || 0);
        const gs = Math.round(position.gs_kt || 0);
        const vs = Math.round(position.vs_fpm || 0);
        const phase = phaseOfFlight(alt, gs, vs);

        const callsign = flight.callsign || flight.username || 'Unknown flight';
        const aircraftName = flight.aircraft?.aircraftName || 'Unknown aircraft';
        const liveryName = flight.aircraft?.liveryName || '';
        const registration = flight.aircraft?.registration || flight.tailNumber || '';
        const dep = flight.departureIcao || '';
        const arr = flight.arrivalIcao || '';

        // Line 1: who and what. Line 2: where, and how high.
        const details = clamp(`${callsign} · ${aircraftName}`, MAX_DETAILS);

        let state;
        if (dep && arr) state = `${dep} → ${arr}`;
        else if (arr) state = `Inbound ${arr}`;
        else if (dep) state = `Out of ${dep}`;
        else state = 'No flight plan filed';
        if (alt >= 200) state += ` · ${formatAltitude(alt)}`;
        else if (dep || arr) state += ' · On the ground';
        state = clamp(state, MAX_STATE);

        const smallText = alt >= 200
            ? `${phase} · ${gs} kt · ${vs >= 0 ? '+' : ''}${vs.toLocaleString()} fpm`
            : `${phase} · ${gs} kt`;

        const largeText = [liveryName, registration].filter(Boolean).join(' · ') || aircraftName;

        return {
            idle: false,
            details,
            state,
            largeText: clamp(largeText, MAX_ASSET_TEXT),
            smallText: clamp(smallText, MAX_ASSET_TEXT),
            phase,
            imageUrl: this._communityImageUrl(flight),
        };
    },

    /**
     * Build the Discord activity for the flight we're following, or the idle
     * "browsing the map" card when there isn't one.
     */
    async _buildActivity() {
        const flight = this._flight;
        const copy = this.describe();

        if (!flight) {
            return {
                type: 0,
                details: copy.details,
                state: copy.state,
                assets: {
                    large_image: ASSET_FALLBACK_LARGE,
                    large_text: copy.largeText,
                },
                buttons: [{ label: 'Open the live map', url: SITE_ORIGIN }],
            };
        }

        const gs = Math.round(flight.position?.gs_kt || 0);

        return {
            // Type 0 (Playing) is the one every Discord build accepts over RPC.
            type: 0,
            details: copy.details,
            state: copy.state,
            timestamps: await this._buildTimestamps(flight, gs),
            assets: {
                large_image: await this._resolveLargeImage(flight),
                large_text: copy.largeText,
                small_image: PHASE_ASSETS[copy.phase] || PHASE_ASSETS['Ground / Unknown'],
                small_text: copy.smallText,
            },
            buttons: this._buildButtons(flight),
        };
    },

    /**
     * Live countdown for the preview card — the panel renders its own timer
     * rather than waiting on Discord to tell it what it already knows.
     */
    async previewEndsAt() {
        if (!this._flight) return null;
        const stamps = await this._buildTimestamps(this._flight, Math.round(this._flight.position?.gs_kt || 0));
        return stamps.end || null;
    },

    /**
     * `end` makes Discord render a live countdown to touchdown, which is the
     * single nicest thing on the card — so we prefer it whenever a destination
     * and a usable groundspeed let us estimate one. Otherwise `start` gives a
     * time-elapsed counter.
     */
    async _buildTimestamps(flight, gs) {
        const start = this._flightSeenAtMs || nowMs();
        const position = flight.position || {};
        const arr = flight.arrivalIcao;

        if (arr && gs > 60 && typeof position.lat === 'number' && typeof position.lon === 'number') {
            const coords = await this._airportCoord(arr);
            if (coords) {
                const remainingNm = distanceNm(position.lat, position.lon, coords[0], coords[1]);
                const remainingMs = (remainingNm / gs) * 3600 * 1000;
                // Sanity bounds: under a minute reads as noise, and anything
                // past a day means the estimate has gone wrong.
                if (remainingMs > 60000 && remainingMs < 24 * 3600 * 1000) {
                    return { start, end: Math.round(nowMs() + remainingMs) };
                }
            }
        }

        return { start };
    },

    _buildButtons(flight) {
        const buttons = [];
        if (flight.flightId) {
            const params = new URLSearchParams({ flight: String(flight.flightId) });
            // The tracker needs the session name to find a flight id again.
            if (this._server) params.set('server', this._server);
            buttons.push({
                label: clamp('Track this flight', MAX_BUTTON_LABEL),
                url: `${SITE_ORIGIN}/?${params.toString()}`,
            });
        }
        buttons.push({ label: clamp('Live map', MAX_BUTTON_LABEL), url: SITE_ORIGIN });
        return buttons.slice(0, 2);
    },

    /**
     * The community photo of this exact airframe, minted into an activity asset
     * key by the backend. Falls back to the portal asset whenever anything in
     * that chain is missing — a presence without a photo still beats no
     * presence at all.
     */
    async _resolveLargeImage(flight) {
        if (!this._config?.externalAssets) return ASSET_FALLBACK_LARGE;

        const url = this._communityImageUrl(flight);
        if (!url) return ASSET_FALLBACK_LARGE;

        if (this._assetCache.has(url)) return this._assetCache.get(url) || ASSET_FALLBACK_LARGE;
        if (this._assetInFlight.has(url)) {
            const key = await this._assetInFlight.get(url);
            return key || ASSET_FALLBACK_LARGE;
        }

        const request = fetch(`${BACKEND}/api/discord/presence/assets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: [url] }),
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((json) => json?.assets?.[url] || null)
            .catch(() => null)
            .then((key) => {
                // Cache misses too: a photo Discord won't proxy will not start
                // working, and retrying it every tick is pure waste.
                this._assetCache.set(url, key);
                this._assetInFlight.delete(url);
                return key;
            });

        this._assetInFlight.set(url, request);
        const key = await request;
        return key || ASSET_FALLBACK_LARGE;
    },

    /**
     * Live packets carry no photo; the map resolves those asynchronously onto
     * its own features, so read from there when the flight is on screen.
     */
    _communityImageUrl(flight) {
        if (flight.communityImageUrl) return flight.communityImageUrl;
        if (typeof window === 'undefined' || typeof window.getLiveFlightData !== 'function') return null;
        try {
            const feature = window.getLiveFlightData()
                .find((f) => String(f?.properties?.flightId) === String(flight.flightId));
            return feature?.properties?.communityImageUrl || null;
        } catch (_) { return null; }
    },

    async _airportCoord(icao) {
        const key = String(icao).toUpperCase();
        if (this._airportCoords.has(key)) return this._airportCoords.get(key);
        if (this._coordsInFlight.has(key)) return this._coordsInFlight.get(key);

        const request = fetch(`${COMMUNITY_BACKEND}/api/airport/${encodeURIComponent(key)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((json) => (
                (json && typeof json.latitude === 'number' && typeof json.longitude === 'number')
                    ? [json.latitude, json.longitude]
                    : null
            ))
            .catch(() => null)
            .then((coords) => {
                this._airportCoords.set(key, coords);
                this._coordsInFlight.delete(key);
                return coords;
            });

        this._coordsInFlight.set(key, request);
        return request;
    },

    // =======================================================================
    // Pushing to Discord
    // =======================================================================

    /**
     * The earliest moment a send would stay inside Discord's window, dropping
     * timestamps that have aged out on the way past.
     */
    _earliestSendMs() {
        const now = nowMs();
        this._sendTimes = this._sendTimes.filter((t) => now - t < RATE_WINDOW_MS);
        if (this._sendTimes.length < RATE_BURST) return now;
        return this._sendTimes[0] + RATE_WINDOW_MS;
    },

    /**
     * Coalesce updates onto the rate-limit budget. Telemetry arrives every few
     * seconds but a Discord card only needs refreshing at cadence — except when
     * the flight itself changes, which should show up straight away.
     */
    _scheduleUpdate(options = {}) {
        if (!this._socket?.open) return;

        const now = nowMs();
        const earliest = this._earliestSendMs();
        const dueAtMs = options.immediate
            ? earliest
            : Math.max(earliest, this._lastSentAtMs + UPDATE_CADENCE_MS);
        const wait = Math.max(0, dueAtMs - now);

        if (wait === 0) {
            clearTimeout(this._pendingTimer);
            this._pendingTimer = null;
            this._pushActivity();
            return;
        }

        // One coalesced flush is enough, but an immediate request arriving
        // behind a cadence timer has to pull that flush forward.
        const dueAt = nowMs() + wait;
        if (this._pendingTimer) {
            if (dueAt >= this._pendingAtMs) return;
            clearTimeout(this._pendingTimer);
        }

        this._pendingAtMs = dueAt;
        this._pendingTimer = setTimeout(() => {
            this._pendingTimer = null;
            this._pushActivity();
        }, wait);
    },

    async _pushActivity() {
        if (!this._socket?.open) return;

        let activity;
        try {
            activity = await this._buildActivity();
        } catch (_) {
            return; // a build failure must never take the socket down
        }
        if (!this._socket?.open) return;

        // Skip identical frames — a parked aircraft would otherwise reprint the
        // same card every cadence tick.
        const key = JSON.stringify(activity);
        if (key === this._lastActivityKey) return;

        try {
            await this._socket.command('SET_ACTIVITY', { pid: this._pid(), activity });
            this._lastActivityKey = key;
            this._lastSentAtMs = nowMs();
            this._sendTimes.push(this._lastSentAtMs);
            if (this._status !== 'connected') this._setStatus('connected', '');
            this._emit();
        } catch (err) {
            // Some Discord builds refuse SET_ACTIVITY until the app has been
            // authorised. That is the one error worth retrying, once, behind
            // the OAuth flow.
            if (!this.__authRetried) {
                this.__authRetried = true;
                try {
                    await this._ensureAuthenticated();
                    await this._socket.command('SET_ACTIVITY', { pid: this._pid(), activity });
                    this._lastActivityKey = key;
                    this._lastSentAtMs = nowMs();
                    this._setStatus('connected', '');
                    this._emit();
                    return;
                } catch (authErr) {
                    this._setStatus('error', authErr.message || 'Discord refused the presence update.');
                    return;
                }
            }
            this._setStatus('error', err.message || 'Discord refused the presence update.');
        }
    },

    // =======================================================================
    // Observation
    // =======================================================================

    onChange(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    },

    /** The latest live packet, for the panel's flight picker. */
    getLiveFlights() {
        return this._lastFlights;
    },

    getState() {
        return {
            supported: !!this._config,
            status: this._status,
            detail: this._statusDetail,
            connected: !!this._socket?.open,
            discordUser: this._discordUser,
            follow: this._follow,
            flight: this._flight,
            airborne: this._totalAirborne,
        };
    },

    _setStatus(status, detail) {
        this._status = status;
        this._statusDetail = detail || '';
        this._emit();
    },

    _emit() {
        const state = this.getState();
        for (const listener of this._listeners) {
            try { listener(state); } catch (_) { /* a bad panel must not stop the rest */ }
        }
    },
};

if (typeof window !== 'undefined') {
    window.DiscordPresence = DiscordPresence;
}

export default DiscordPresence;
