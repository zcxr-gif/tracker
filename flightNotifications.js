// flightNotifications.js — the thing that actually tells you something happened.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// The watchlist has had a "notify me when they come online" feature for a long
// time, and it never delivered a single notification outside the old Capacitor
// iOS shell. Both dashboards (profileUI on desktop, MobileDashboardUI on
// phones) carried their own copy of the same block, and both ended it with:
//
//     window.InflightLiveActivity?.presentLocalNotification?.({ ... })
//
// `window.InflightLiveActivity` is defined by the native bridge that only ships
// inside the wrapped iOS app. In a browser — which is where nearly everybody
// uses this — the optional chaining swallowed the whole call and the pilot got
// an in-app toast if they happened to be looking at the tab, and nothing at
// all otherwise. No error, no console warning, no notification. That is the
// bug: not a permission problem, not a delivery problem, but a call to a
// function that was never there.
//
// Two more things were quietly broken behind it:
//
//   • `notification_watchlist_enabled` was read from, and written to, a COLUMN
//     of `user_preferences` that does not exist. That table holds one `prefs`
//     JSON blob (see entitlement-and-preferences.sql). The read fell into a
//     catch, the write failed silently, and the setting could never be turned
//     off — or on again.
//
//   • Only one event was ever detected — a watched pilot appearing on the feed.
//     Not their takeoff, not their landing, not their flight ending, and
//     nothing whatsoever about YOUR flight, which is the one everybody asks
//     for: the thing an airline app does when it says "we begin our descent in
//     half an hour".
//
// So the delivery, the preferences and the detection all live here now, once,
// and both dashboards call into it instead of each carrying a copy.
//
// ── How a notification gets out ─────────────────────────────────────────────
// In order, stopping at the first that works:
//
//   1. The native iOS bridge, when the app is running inside the wrapper. It
//      raises a real system banner and works with the app backgrounded.
//   2. The service worker's `showNotification`. This is the only path that
//      works on Android Chrome — constructing `new Notification()` there
//      throws an `Illegal constructor` TypeError — and it is the only path
//      that survives the tab being closed. sw.js handles the tap.
//   3. `new Notification()`, for desktop browsers with no controlled worker
//      yet (a first visit, a hard reload with the worker still installing).
//   4. The in-app card, which is not a fallback so much as a companion: it is
//      what you see when you are already looking at the map, and the system
//      notification is what you see when you are not.
//
// Every step is guarded, and `describe()` reports which one is available and
// why — because the previous failure mode was silence, and silence is what
// took months to notice.
//
// ── What it watches ─────────────────────────────────────────────────────────
// One subscription to the same `all_flights_update` packet the map draws from.
// Both dashboards used to walk that packet themselves for this; now they don't.
//
//   Watched pilots   online, offline, took off, landed
//   Your own flight  took off, N minutes from destination, landed
//
// The feed carries no ETA, so the approach notice is computed here: great
// circle distance from where the aeroplane is to where its flight plan says it
// is going, over ground speed. See `_ownFlightTick`.

import { socketDataHub } from './SocketDataHub.js';

// ── Tunables ────────────────────────────────────────────────────────────────

/** localStorage key. Also the key preferenceSync carries between devices. */
const PREFS_KEY = 'inflight_notifications';

/**
 * A flight missing from one packet is not a pilot who went offline — the feed
 * drops rows for a tick fairly often, and a "left the server" notice that fires
 * every few minutes on a pilot who never went anywhere is worse than no notice.
 * Two and a half minutes of absence is a real disconnection.
 */
const OFFLINE_GRACE_MS = 150000;

/**
 * Consecutive packets agreeing before a ground/air flip is believed. The map
 * can afford to flicker a phase chip; a notification cannot be taken back.
 */
const GROUND_FLIP_SAMPLES = 2;

/** Below this ground speed an ETA is meaningless — taxiing, or parked. */
const MIN_GS_FOR_ETA_KT = 60;

/**
 * The approach notice needs two consecutive samples under the threshold. A
 * single ground-speed spike in one packet should not announce a descent.
 */
const APPROACH_CONFIRM_SAMPLES = 2;

/**
 * How far out the notice is still honest. Somebody who opens the app already
 * inside the window should hear about it — the message says how long is
 * actually left — but firing "approaching" at ninety seconds out is noise.
 */
const APPROACH_FLOOR_MIN = 3;

/** Watchlist re-read cadence, as a backstop to the change event. */
const WATCHLIST_REFRESH_MS = 300000;

const DEFAULT_PREFS = {
    enabled:            true,
    // Watched pilots
    watchOnline:        true,
    watchOffline:       false,
    watchTakeoff:       true,
    watchLanding:       true,
    // Your own flight
    ownApproach:        true,
    ownApproachMinutes: 30,
    ownTakeoff:         false,
    ownLanding:         true,
    // How they arrive
    sound:              true,
    inApp:              true,
};

const APPROACH_CHOICES = [15, 30, 45, 60];

// ── Small helpers ───────────────────────────────────────────────────────────

const EARTH_NM = 3440.065;

function haversineNm(aLat, aLon, bLat, bLon) {
    const toRad = Math.PI / 180;
    const dLat = (bLat - aLat) * toRad;
    const dLon = (bLon - aLon) * toRad;
    const s = Math.sin(dLat / 2) ** 2 +
        Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * The position fields, under whichever names this packet used.
 *
 * The socket path and the delta path (FlightDeltaClient) agree on `gs_kt` /
 * `vs_fpm`, but the map's own feature properties carry `speed` / `altitude`,
 * and flight.js already reads both spellings in places. Normalising once here
 * means a rename upstream degrades to "no notification" rather than to
 * "notification about an aeroplane we think is stationary at sea level".
 * Returns null when there is nothing usable to read.
 */
function readPosition(flight) {
    const pos = flight?.position || flight;
    if (!pos) return null;
    const lat = pos.lat ?? pos.latitude ?? null;
    const lon = pos.lon ?? pos.longitude ?? null;
    const gs = Number(pos.gs_kt ?? pos.gs ?? pos.speed);
    const vs = Number(pos.vs_fpm ?? pos.vs);
    const alt = Number(pos.alt_ft ?? pos.altitude);
    if (!Number.isFinite(gs)) return null;
    return {
        lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
        lon: Number.isFinite(Number(lon)) ? Number(lon) : null,
        gs,
        vs: Number.isFinite(vs) ? vs : 0,
        alt: Number.isFinite(alt) ? alt : 0,
    };
}

/**
 * On the ground, from position alone.
 *
 * The feed carries MSL altitude only, so height above the field is unknowable
 * and an altitude threshold would read a field on a plateau as airborne. Ground
 * speed and vertical speed carry the decision on their own, which they can:
 * nothing in the cruise is doing under forty knots.
 */
function looksOnGround(pos) {
    if (!pos) return null;
    return pos.gs < 40 && Math.abs(pos.vs) < 200;
}

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** "1 h 05" / "24 min" — a duration a pilot reads without converting it. */
function humanMinutes(mins) {
    const m = Math.max(0, Math.round(mins));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return `${h} h ${String(m % 60).padStart(2, '0')}`;
}

function routeLabel(flight) {
    const dep = flight?.departureIcao;
    const arr = flight?.arrivalIcao;
    if (dep && arr) return `${dep} → ${arr}`;
    if (arr) return `to ${arr}`;
    if (dep) return `from ${dep}`;
    return '';
}

function aircraftLabel(flight) {
    return flight?.aircraft?.aircraftName || flight?.aircraft?.liveryName || '';
}

// ── The module ──────────────────────────────────────────────────────────────

export const FlightNotifications = {

    _supabase:   null,
    _user:       null,
    _booted:     false,
    _unsubscribe: null,
    _refreshTimer: null,

    _prefs:      { ...DEFAULT_PREFS },

    /** Rows from user_watchlist, lowercased usernames only. */
    _watched:    [],

    /**
     * Per-pilot detector state, keyed by lowercased username:
     *   { online, lastSeen, ground, pending, pendingCount, flightId }
     * `ground` is null until enough packets agree, so a pilot first seen in
     * the cruise never produces a phantom "landed".
     */
    _pilotState: new Map(),

    /** Detector state for the signed-in pilot's own aeroplane. */
    _own: null,

    /** Last delivery attempt, for describe() and the settings panel. */
    _lastDelivery: null,

    /** Whether the "turn these on" card has already been offered this session. */
    _nudged: false,

    // ─── Boot ───────────────────────────────────────────────────────────────

    /**
     * Started from flight.js next to the other stores, NOT from a dashboard.
     *
     * The point of a notification is that it arrives when you are not looking,
     * so it cannot depend on a panel somebody opened. This subscribes to the
     * feed once at boot and keeps running whether or not any UI exists.
     */
    init(supabaseClient) {
        if (this._booted) return;
        this._booted = true;
        this._supabase = supabaseClient || null;

        this._loadPrefs();

        if (this._supabase?.auth?.onAuthStateChange) {
            this._supabase.auth.onAuthStateChange((_event, session) => {
                const user = session?.user || null;
                const changed = (user?.id || null) !== (this._user?.id || null);
                this._user = user;
                if (changed) {
                    // A different pilot means every detector's memory is about
                    // somebody else. Starting clean is the only safe reset:
                    // stale state would announce the previous account's
                    // aeroplane landing.
                    this._pilotState.clear();
                    this._own = null;
                    this._watched = [];
                }
                if (user) this.refreshWatchlist();
            });
        }

        this._subscribe();

        // Belt and braces on the watchlist: the change event below is exact,
        // and this catches a row added on another device or another tab.
        this._refreshTimer = setInterval(() => this.refreshWatchlist(), WATCHLIST_REFRESH_MS);

        if (typeof window !== 'undefined') {
            window.addEventListener('inflight:watchlist-changed', () => this.refreshWatchlist());
            window.InflightNotifications = this;
        }

        // A notification the service worker raised is dismissed by the service
        // worker, so its tap comes back as a message rather than an onclick.
        // sw.js focuses the tab and posts this.
        if (typeof navigator !== 'undefined' && navigator.serviceWorker?.addEventListener) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event?.data?.type !== 'inflight:notification-click') return;
                this.openFromNotification(event.data.data || {});
            });
        }
    },

    /**
     * What a tapped notification does: open the aeroplane it was about.
     *
     * Anything less makes the notification a dead end — you are told a pilot
     * took off, you tap it, and you land on the map with the same job of
     * finding them you had before.
     */
    openFromNotification(data) {
        try {
            const wanted = String(
                data?.username || (String(data?.kind || '').startsWith('own_') ? this._ifUsername() : '')
            ).toLowerCase();
            if (!wanted || typeof window.getLiveFlightData !== 'function') return;

            const match = window.getLiveFlightData()
                .find(f => String(f?.properties?.username || '').toLowerCase() === wanted);
            if (match?.properties && typeof window.onSearchResultClick === 'function') {
                window.onSearchResultClick(match.properties);
            }
        } catch (err) {
            console.warn('[notify] could not open flight from notification:', err?.message || err);
        }
    },

    _subscribe() {
        if (this._unsubscribe) return;
        this._unsubscribe = socketDataHub.subscribe('all_flights_update', (payload) => {
            try { this._onPacket(payload); }
            catch (err) { console.warn('[notify] packet handling failed:', err?.message || err); }
        });
    },

    async refreshWatchlist() {
        if (!this._user || !this._supabase) { this._watched = []; return; }
        try {
            const { data, error } = await this._supabase
                .from('user_watchlist')
                .select('watched_username')
                .eq('user_id', this._user.id);
            if (error) throw error;
            const next = [...new Set((data || [])
                .map(r => String(r.watched_username || '').trim().toLowerCase())
                .filter(Boolean))];
            this._watched = next;
            // Drop detector state for pilots no longer watched, so removing and
            // re-adding somebody does not announce them from a stale memory.
            const keep = new Set(next);
            for (const key of [...this._pilotState.keys()]) {
                if (!keep.has(key)) this._pilotState.delete(key);
            }
        } catch (err) {
            console.warn('[notify] could not load watchlist:', err?.message || err);
        }
    },

    // ─── Preferences ────────────────────────────────────────────────────────
    //
    // localStorage is the store of record, and preferenceSync carries the same
    // key between a Pro pilot's devices. Deliberately NOT the `user_preferences`
    // column the old code invented: that column never existed, which is how the
    // toggle came to be unturnoffable.

    _loadPrefs() {
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); }
        catch (_) { stored = null; }
        this._prefs = { ...DEFAULT_PREFS, ...(stored && typeof stored === 'object' ? stored : {}) };
        if (!APPROACH_CHOICES.includes(Number(this._prefs.ownApproachMinutes))) {
            this._prefs.ownApproachMinutes = DEFAULT_PREFS.ownApproachMinutes;
        }
    },

    getPrefs() { return { ...this._prefs }; },

    setPref(key, value) {
        if (!(key in DEFAULT_PREFS)) return;
        this._prefs[key] = value;
        try { localStorage.setItem(PREFS_KEY, JSON.stringify(this._prefs)); } catch (_) {}
        // Changing the threshold re-arms the notice: a pilot who moves it from
        // 30 to 60 while airborne means "tell me now", not "tell me next leg".
        if (key === 'ownApproachMinutes' && this._own) {
            this._own.approachFired = false;
            this._own.approachStreak = 0;
        }
    },

    // ─── Permission and delivery ────────────────────────────────────────────

    get _bridge() {
        return (typeof window !== 'undefined' && window.InflightLiveActivity) || null;
    },

    get permission() {
        if (typeof Notification === 'undefined') return 'unsupported';
        return Notification.permission;
    },

    /**
     * Must be called from a user gesture — every browser requires it, and a
     * request made outside one is auto-denied permanently on Safari. The
     * settings panel's button is the only caller.
     */
    async requestPermission() {
        const bridge = this._bridge;
        if (bridge?.requestNotificationPermission) {
            try {
                const res = await bridge.requestNotificationPermission({ force: true });
                if (res?.granted || res?.status === 'authorized') return 'granted';
            } catch (_) { /* fall through to the web API */ }
        }
        if (typeof Notification === 'undefined') return 'unsupported';
        try { return await Notification.requestPermission(); }
        catch (_) { return Notification.permission; }
    },

    /**
     * What a pilot who is hearing nothing needs to be told, and what the
     * settings panel prints. The old code had no equivalent, which is why the
     * feature could be dead for months without anybody being able to say so.
     */
    describe() {
        const bridge = !!this._bridge?.presentLocalNotification;
        const sw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
        return {
            permission:  this.permission,
            nativeBridge: bridge,
            serviceWorker: sw,
            enabled:     this._prefs.enabled,
            watching:    this._watched.length,
            signedIn:    !!this._user,
            ifUsername:  this._ifUsername() || null,
            lastDelivery: this._lastDelivery,
        };
    },

    /**
     * Raise one notification. Returns the route it went out by, or null.
     *
     * `tag` collapses repeats: a second notice about the same pilot and the
     * same event replaces the first rather than stacking under it.
     */
    async deliver({ title, subtitle, body, tag, data, toastIcon, toastKind }) {
        if (!title) return null;

        // The in-app card first, and unconditionally on its own switch: it is
        // instant, and it is what a pilot looking at the map actually sees.
        if (this._prefs.inApp) this._toast(title, subtitle, body, toastIcon, toastKind);

        // The nudge. Somebody who has never opened the notification settings
        // has permission 'default', which means every alert below is dropped
        // and the only sign of it is the in-app card they happen to catch. Ask
        // once per session, on the card for a real event rather than as an
        // unprompted banner at load — the ask makes sense precisely when there
        // is something they just missed.
        if (this._prefs.inApp && !this._nudged && this.permission === 'default' && !this._bridge) {
            this._nudged = true;
            try {
                window.InflightNotify?.notify?.(
                    'Inflight can only show these while you are looking at this tab.',
                    'info',
                    {
                        title: 'Turn on notifications?',
                        timeout: 12000,
                        id: 'inflight-notify-nudge',
                        action: { label: 'Turn on', onClick: () => this.requestPermission() },
                    }
                );
            } catch (_) {}
        }

        const composed = [subtitle, body].filter(Boolean).join(' · ');
        const silent = !this._prefs.sound;

        // 1. Native shell.
        const bridge = this._bridge;
        if (bridge?.presentLocalNotification) {
            try {
                const res = await bridge.presentLocalNotification({
                    title, subtitle, body,
                    identifier: tag,
                    threadIdentifier: 'inflight-flights',
                    sound: !silent,
                    userInfo: data || {},
                });
                if (res?.ok) return (this._lastDelivery = { route: res.source || 'native', at: Date.now() }).route;
            } catch (_) { /* fall through */ }
        }

        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            this._lastDelivery = { route: null, at: Date.now(), reason: this.permission };
            return null;
        }

        const options = {
            body: composed,
            tag,
            renotify: true,
            silent,
            icon: '/Images/inflight.png',
            badge: '/Images/inflight.png',
            data: { ...(data || {}), url: '/' },
        };

        // 2. Service worker. The only route that works on Android Chrome, and
        //    the only one that outlives the tab.
        if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
            try {
                const reg = navigator.serviceWorker.controller
                    ? await navigator.serviceWorker.ready
                    : await Promise.race([
                        navigator.serviceWorker.ready,
                        new Promise(r => setTimeout(() => r(null), 1500)),
                    ]);
                if (reg?.showNotification) {
                    await reg.showNotification(title, options);
                    return (this._lastDelivery = { route: 'serviceworker', at: Date.now() }).route;
                }
            } catch (_) { /* fall through */ }
        }

        // 3. Page-level notification. This one IS dismissed by the page, so
        //    its tap is an onclick rather than a message from the worker.
        try {
            const n = new Notification(title, options);
            n.onclick = () => {
                try { window.focus(); } catch (_) {}
                this.openFromNotification(options.data);
                n.close();
            };
            return (this._lastDelivery = { route: 'page', at: Date.now() }).route;
        } catch (err) {
            this._lastDelivery = { route: null, at: Date.now(), reason: err?.message || 'failed' };
            return null;
        }
    },

    _toast(title, subtitle, body, icon, kind) {
        const line = [subtitle, body].filter(Boolean).join(' · ');
        const html = `<i class="fa-solid ${icon || 'fa-bell'}" style="margin-right:8px;"></i><strong>${esc(title)}</strong>${line ? ` — ${esc(line)}` : ''}`;
        try {
            if (window.InflightNotify?.notify) {
                window.InflightNotify.notify(line || title, kind || 'info', { title });
                return;
            }
        } catch (_) {}
        try { window.showNotification?.(html, kind || 'info'); } catch (_) {}
    },

    /** The settings panel's "does this work at all" button. */
    async sendTest() {
        return this.deliver({
            title: 'Inflight',
            subtitle: 'Notifications are working',
            body: 'This is what a flight alert will look like.',
            tag: 'inflight-test',
            data: { kind: 'test' },
            toastIcon: 'fa-bell',
            toastKind: 'success',
        });
    },

    // ─── Detection ──────────────────────────────────────────────────────────

    _ifUsername() {
        const name = this._user?.user_metadata?.if_username;
        return name ? String(name).trim().toLowerCase() : '';
    },

    _onPacket(payload) {
        const flights = payload?.flights;
        // An EMPTY array is a real packet and has to be processed: it is
        // everybody going offline at once. It is `undefined` — a malformed or
        // partial payload — that must be ignored, because that says nothing
        // about who is flying. The offline grace window below is what keeps a
        // momentarily empty packet from announcing a server-wide disconnection.
        if (!Array.isArray(flights)) return;
        if (!this._prefs.enabled) return;
        if (!this._user) return;

        // One pass, shared by both detectors below — the same index the
        // dashboards build, built once here instead of twice there.
        const byUser = new Map();
        for (let i = 0; i < flights.length; i++) {
            const f = flights[i];
            const un = f?.username && String(f.username).toLowerCase();
            if (!un) continue;
            if (!byUser.has(un)) byUser.set(un, f);
        }

        this._watchedTick(byUser);
        this._ownFlightTick(byUser);
    },

    // ── Watched pilots ──────────────────────────────────────────────────────

    _watchedTick(byUser) {
        if (!this._watched.length) return;
        const now = Date.now();

        for (const un of this._watched) {
            const flight = byUser.get(un) || null;
            let st = this._pilotState.get(un);
            if (!st) {
                st = { online: false, lastSeen: 0, ground: null, pending: null, pendingCount: 0, flightId: null, primed: false };
                this._pilotState.set(un, st);
            }

            if (flight) {
                const wasOnline = st.online;
                st.online = true;
                st.lastSeen = now;

                const display = flight.username || un;
                const fid = String(flight.flightId || '');

                // A new flight id is a new leg. Ground/air memory belongs to
                // the previous one and would announce a takeoff that is really
                // just the first packet of the next flight.
                if (fid && fid !== st.flightId) {
                    st.flightId = fid;
                    st.ground = null;
                    st.pending = null;
                    st.pendingCount = 0;
                }

                if (!wasOnline) {
                    // `primed` is false only for the very first packet after
                    // the app loads, where "not seen before" means "we weren't
                    // watching yet" rather than "just connected". Announcing
                    // then would greet every watched pilot on every reload.
                    if (st.primed && this._prefs.watchOnline) {
                        this.deliver({
                            title: display,
                            subtitle: 'Now online',
                            body: [routeLabel(flight), aircraftLabel(flight)].filter(Boolean).join(' · ')
                                || 'Just connected',
                            tag: `watch-online-${un}`,
                            data: { kind: 'watchlist_online', username: display },
                            toastIcon: 'fa-plane-departure',
                            toastKind: 'info',
                        });
                    }
                    st.primed = true;
                }

                this._groundTick(st, flight, display, un);
            } else if (st.online && now - st.lastSeen > OFFLINE_GRACE_MS) {
                st.online = false;
                st.ground = null;
                st.pending = null;
                st.pendingCount = 0;
                st.flightId = null;
                if (this._prefs.watchOffline) {
                    this.deliver({
                        title: un,
                        subtitle: 'Flight ended',
                        body: 'No longer on the server.',
                        tag: `watch-offline-${un}`,
                        data: { kind: 'watchlist_offline', username: un },
                        toastIcon: 'fa-plane-slash',
                        toastKind: 'info',
                    });
                }
            }
        }
    },

    /**
     * Ground/air transitions, with hysteresis.
     *
     * The first believed reading only seeds `ground` — it never announces.
     * A pilot who was already in the cruise when you added them should not be
     * told to have "taken off" the moment we work out they are airborne.
     */
    _groundTick(st, flight, display, un) {
        const reading = looksOnGround(readPosition(flight));
        if (reading === null) return;

        if (st.pending === reading) st.pendingCount++;
        else { st.pending = reading; st.pendingCount = 1; }
        if (st.pendingCount < GROUND_FLIP_SAMPLES) return;

        if (st.ground === null) { st.ground = reading; return; }
        if (st.ground === reading) return;

        const wasGround = st.ground;
        st.ground = reading;

        if (wasGround && !reading && this._prefs.watchTakeoff) {
            this.deliver({
                title: display,
                subtitle: 'Airborne',
                body: [routeLabel(flight), aircraftLabel(flight)].filter(Boolean).join(' · ')
                    || 'Just took off',
                tag: `watch-takeoff-${un}`,
                data: { kind: 'watchlist_takeoff', username: display },
                toastIcon: 'fa-plane-departure',
                toastKind: 'success',
            });
        } else if (!wasGround && reading && this._prefs.watchLanding) {
            const where = flight.arrivalIcao ? `at ${flight.arrivalIcao}` : '';
            this.deliver({
                title: display,
                subtitle: 'On the ground',
                body: [where, aircraftLabel(flight)].filter(Boolean).join(' · ') || 'Just landed',
                tag: `watch-landing-${un}`,
                data: { kind: 'watchlist_landing', username: display },
                toastIcon: 'fa-plane-arrival',
                toastKind: 'success',
            });
        }
    },

    // ── Your own flight ─────────────────────────────────────────────────────

    /**
     * The approach notice, and the bookends around it.
     *
     * The feed publishes no ETA, so it is worked out the way a pilot would from
     * the same three numbers: distance to run over ground speed. That is a
     * straight-line estimate and it will be a few minutes optimistic against a
     * STAR that doubles back — which is the right direction to be wrong in for
     * a notice whose job is "start paying attention".
     *
     * It needs a filed arrival airport. A flight with no plan gets the takeoff
     * and landing notices and nothing in between, rather than a guess.
     */
    _ownFlightTick(byUser) {
        const me = this._ifUsername();
        if (!me) return;

        const flight = byUser.get(me) || null;
        if (!flight) {
            // Held rather than cleared for one grace window, so a dropped
            // packet mid-cruise doesn't re-arm an approach notice already sent.
            if (this._own && Date.now() - this._own.lastSeen > OFFLINE_GRACE_MS) this._own = null;
            return;
        }

        const fid = String(flight.flightId || '');
        if (!this._own || this._own.flightId !== fid) {
            this._own = {
                flightId: fid,
                lastSeen: Date.now(),
                ground: null,
                pending: null,
                pendingCount: 0,
                approachFired: false,
                approachStreak: 0,
                primed: false,
            };
        }
        const st = this._own;
        st.lastSeen = Date.now();

        // Takeoff / landing, on the same hysteresis the watchlist uses.
        const reading = looksOnGround(readPosition(flight));
        if (reading !== null) {
            if (st.pending === reading) st.pendingCount++;
            else { st.pending = reading; st.pendingCount = 1; }

            if (st.pendingCount >= GROUND_FLIP_SAMPLES) {
                if (st.ground === null) st.ground = reading;
                else if (st.ground !== reading) {
                    const wasGround = st.ground;
                    st.ground = reading;
                    if (wasGround && !reading && this._prefs.ownTakeoff) {
                        this.deliver({
                            title: 'Airborne',
                            subtitle: routeLabel(flight) || 'Your flight',
                            body: aircraftLabel(flight) || 'You are off the ground.',
                            tag: `own-takeoff-${fid}`,
                            data: { kind: 'own_takeoff' },
                            toastIcon: 'fa-plane-departure',
                            toastKind: 'success',
                        });
                    } else if (!wasGround && reading) {
                        // Landing closes the approach notice out too: the same
                        // aeroplane taxiing in must not re-trigger it.
                        st.approachFired = true;
                        if (this._prefs.ownLanding) {
                            this.deliver({
                                title: 'On the ground',
                                subtitle: flight.arrivalIcao ? `Welcome to ${flight.arrivalIcao}` : 'Your flight',
                                body: aircraftLabel(flight) || 'Nice landing.',
                                tag: `own-landing-${fid}`,
                                data: { kind: 'own_landing' },
                                toastIcon: 'fa-plane-arrival',
                                toastKind: 'success',
                            });
                        }
                    }
                }
            }
        }

        if (!this._prefs.ownApproach || st.approachFired) return;
        if (st.ground !== false) return;          // still on the ground, or unknown

        const eta = this._minutesToDestination(flight);
        if (eta == null) { st.approachStreak = 0; return; }

        const threshold = Number(this._prefs.ownApproachMinutes) || DEFAULT_PREFS.ownApproachMinutes;
        if (eta > threshold || eta < APPROACH_FLOOR_MIN) { st.approachStreak = 0; return; }

        st.approachStreak++;
        if (st.approachStreak < APPROACH_CONFIRM_SAMPLES) return;

        st.approachFired = true;
        const dest = flight.arrivalIcao;
        const name = (typeof window !== 'undefined' && window.getAirportName)
            ? window.getAirportName(dest) : '';

        this.deliver({
            title: `${humanMinutes(eta)} from ${dest}`,
            subtitle: name || routeLabel(flight) || 'Approaching destination',
            body: 'Time to start thinking about the descent.',
            tag: `own-approach-${fid}`,
            data: { kind: 'own_approach', arrival: dest },
            toastIcon: 'fa-plane-arrival',
            toastKind: 'info',
        });
    },

    /** Minutes to the filed destination, or null when it cannot be known. */
    _minutesToDestination(flight) {
        const dest = flight?.arrivalIcao;
        if (!dest || dest === 'N/A') return null;

        const lookup = (typeof window !== 'undefined' && window.getAirportCoords)
            ? window.getAirportCoords(dest) : null;
        if (!lookup || lookup.lat == null || lookup.lon == null) return null;

        const pos = readPosition(flight);
        if (!pos || pos.lat == null || pos.lon == null) return null;
        if (pos.gs < MIN_GS_FOR_ETA_KT) return null;

        const nm = haversineNm(pos.lat, pos.lon, lookup.lat, lookup.lon);
        return (nm / pos.gs) * 60;
    },
};

// ── Settings ────────────────────────────────────────────────────────────────
//
// One panel, opened from both the desktop dashboard and the mobile settings
// sheet, rather than a copy of the controls in each. The two surfaces already
// drifted apart on the notification code itself, which is most of why it went
// unnoticed that neither worked.

const PANEL_ID = 'inflight-notify-settings';

const SECTIONS = [
    {
        title: 'Pilots you watch',
        note: 'Everyone on your watchlist, while the app is running.',
        rows: [
            { key: 'watchOnline',  icon: 'fa-plane-departure', label: 'Comes online',  hint: 'They appear on the server.' },
            { key: 'watchTakeoff', icon: 'fa-arrow-up-from-bracket', label: 'Takes off', hint: 'Wheels up, confirmed over several reports.' },
            { key: 'watchLanding', icon: 'fa-plane-arrival',   label: 'Lands',         hint: 'Back on the ground.' },
            { key: 'watchOffline', icon: 'fa-plane-slash',     label: 'Flight ends',   hint: 'Off the server for more than a couple of minutes.' },
        ],
    },
    {
        title: 'Your own flight',
        note: 'Matched to your Infinite Flight username on the live map.',
        rows: [
            { key: 'ownApproach', icon: 'fa-hourglass-half', label: 'Approaching destination', hint: 'Worked out from your distance to run and ground speed.', extra: 'approachMinutes' },
            { key: 'ownTakeoff',  icon: 'fa-plane-departure', label: 'You take off', hint: '' },
            { key: 'ownLanding',  icon: 'fa-plane-arrival',   label: 'You land',     hint: '' },
        ],
    },
    {
        title: 'How they arrive',
        rows: [
            { key: 'sound', icon: 'fa-volume-high', label: 'Sound',        hint: 'System notifications make a noise.' },
            { key: 'inApp', icon: 'fa-window-restore', label: 'In-app cards', hint: 'The card that slides in while you have Inflight open.' },
        ],
    },
];

function injectPanelStyles() {
    if (document.getElementById('inflight-notify-settings-styles')) return;
    const style = document.createElement('style');
    style.id = 'inflight-notify-settings-styles';
    style.textContent = `
        .ifns-overlay {
            position: fixed; inset: 0; z-index: 100000;
            background: rgba(6,8,13,0.62);
            -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
            display: flex; align-items: center; justify-content: center;
            padding: 20px; opacity: 0; transition: opacity .22s ease;
        }
        .ifns-overlay.is-in { opacity: 1; }
        .ifns-sheet {
            width: min(520px, 100%); max-height: min(86vh, 780px);
            display: flex; flex-direction: column;
            background: rgba(20,22,29,0.96);
            border: 0.5px solid rgba(255,255,255,0.14);
            border-radius: 20px; overflow: hidden;
            box-shadow: 0 26px 70px rgba(0,0,0,0.6);
            color: #eef1f6;
            font: 500 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
            transform: translateY(14px) scale(0.985);
            transition: transform .26s cubic-bezier(0.16,1,0.3,1);
        }
        .ifns-overlay.is-in .ifns-sheet { transform: none; }
        .ifns-head {
            display: flex; align-items: center; gap: 12px;
            padding: 18px 18px 14px; border-bottom: 0.5px solid rgba(255,255,255,0.10);
        }
        .ifns-head i { color: #60a5fa; font-size: 17px; }
        .ifns-head h2 { margin: 0; font-size: 16px; font-weight: 750; letter-spacing: -0.01em; }
        .ifns-head p { margin: 2px 0 0; font-size: 12px; color: rgba(238,241,246,0.55); }
        .ifns-close {
            margin-left: auto; background: rgba(255,255,255,0.08); border: 0;
            width: 30px; height: 30px; border-radius: 50%; color: #eef1f6;
            cursor: pointer; font-size: 13px;
        }
        .ifns-close:hover { background: rgba(255,255,255,0.16); }
        .ifns-body { overflow-y: auto; padding: 6px 18px 18px; -webkit-overflow-scrolling: touch; }

        .ifns-banner {
            margin: 14px 0 4px; padding: 13px 14px; border-radius: 13px;
            border: 0.5px solid rgba(255,255,255,0.12);
            background: rgba(96,165,250,0.10);
            display: flex; gap: 11px; align-items: flex-start;
        }
        .ifns-banner.is-ok   { background: rgba(52,211,153,0.10); }
        .ifns-banner.is-warn { background: rgba(251,191,36,0.12); }
        .ifns-banner i { margin-top: 2px; }
        .ifns-banner strong { display: block; font-size: 13px; }
        .ifns-banner span { font-size: 12px; color: rgba(238,241,246,0.68); }
        .ifns-banner button {
            margin-top: 9px; padding: 7px 13px; border-radius: 9px; cursor: pointer;
            background: #2563eb; border: 0; color: #fff; font: 700 12.5px/1 inherit;
        }
        .ifns-banner button:hover { filter: brightness(1.12); }

        .ifns-section { margin-top: 20px; }
        .ifns-section > h3 {
            margin: 0 0 3px; font-size: 11px; font-weight: 800;
            letter-spacing: 0.08em; text-transform: uppercase;
            color: rgba(238,241,246,0.45);
        }
        .ifns-section > p.ifns-note { margin: 0 0 10px; font-size: 12px; color: rgba(238,241,246,0.48); }
        .ifns-list {
            border: 0.5px solid rgba(255,255,255,0.10); border-radius: 13px;
            overflow: hidden; background: rgba(255,255,255,0.03);
        }
        .ifns-row {
            display: flex; align-items: center; gap: 12px; padding: 12px 14px;
            border-bottom: 0.5px solid rgba(255,255,255,0.07);
        }
        .ifns-row:last-child { border-bottom: 0; }
        .ifns-row > i { width: 18px; text-align: center; color: #93c5fd; font-size: 14px; }
        .ifns-row-text { flex: 1 1 auto; min-width: 0; }
        .ifns-row-text b { display: block; font-weight: 600; font-size: 13.5px; }
        .ifns-row-text span { font-size: 11.5px; color: rgba(238,241,246,0.5); }

        .ifns-switch { flex: 0 0 auto; width: 46px; height: 28px; position: relative; cursor: pointer; }
        .ifns-switch input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
        .ifns-switch span {
            position: absolute; inset: 0; border-radius: 999px;
            background: rgba(255,255,255,0.16); transition: background .2s ease;
            pointer-events: none;
        }
        .ifns-switch span::after {
            content: ''; position: absolute; top: 3px; left: 3px;
            width: 22px; height: 22px; border-radius: 50%; background: #fff;
            transition: transform .2s cubic-bezier(0.16,1,0.3,1);
        }
        .ifns-switch input:checked + span { background: #34c759; }
        .ifns-switch input:checked + span::after { transform: translateX(18px); }
        .ifns-switch input:disabled + span { opacity: 0.4; }

        .ifns-minutes { display: flex; gap: 7px; padding: 0 14px 13px; flex-wrap: wrap; }
        .ifns-minutes button {
            padding: 7px 13px; border-radius: 9px; cursor: pointer;
            background: rgba(255,255,255,0.07); border: 0.5px solid rgba(255,255,255,0.10);
            color: rgba(238,241,246,0.75); font: 700 12.5px/1 inherit;
        }
        .ifns-minutes button.is-on { background: #2563eb; border-color: transparent; color: #fff; }

        .ifns-foot { display: flex; gap: 9px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
        .ifns-foot button {
            padding: 9px 15px; border-radius: 10px; cursor: pointer;
            background: rgba(255,255,255,0.09); border: 0.5px solid rgba(255,255,255,0.12);
            color: #fff; font: 700 12.5px/1 inherit;
        }
        .ifns-foot button:hover { background: rgba(255,255,255,0.16); }
        .ifns-diag {
            margin-top: 12px; font-size: 11px; line-height: 1.7;
            color: rgba(238,241,246,0.42); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .ifns-body.is-off .ifns-section { opacity: 0.42; pointer-events: none; }

        @media (max-width: 640px) {
            .ifns-overlay { padding: 0; align-items: flex-end; }
            .ifns-sheet {
                width: 100%; max-height: 92vh;
                border-radius: 20px 20px 0 0;
                padding-bottom: env(safe-area-inset-bottom, 0px);
            }
        }`;
    document.head.appendChild(style);
}

function switchHTML(key, checked, disabled) {
    return `<label class="ifns-switch">
        <input type="checkbox" data-pref="${key}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span></span>
    </label>`;
}

function renderBody(root) {
    const prefs = FlightNotifications.getPrefs();
    const info = FlightNotifications.describe();

    let banner;
    if (info.permission === 'unsupported') {
        banner = `<div class="ifns-banner is-warn">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <div><strong>This browser can't show notifications</strong>
            <span>In-app cards still work while Inflight is open. On an iPhone, add Inflight to your Home Screen and open it from there — Safari only allows notifications for installed web apps.</span></div>
        </div>`;
    } else if (info.permission === 'granted') {
        banner = `<div class="ifns-banner is-ok">
            <i class="fa-solid fa-circle-check"></i>
            <div><strong>Notifications are allowed</strong>
            <span>Alerts arrive while Inflight is open in a tab${info.serviceWorker ? ', including in the background' : ''}.</span></div>
        </div>`;
    } else if (info.permission === 'denied') {
        banner = `<div class="ifns-banner is-warn">
            <i class="fa-solid fa-bell-slash"></i>
            <div><strong>Notifications are blocked</strong>
            <span>Your browser is refusing them for this site. Allow notifications for Inflight in your browser or system settings, then reopen this panel.</span></div>
        </div>`;
    } else {
        banner = `<div class="ifns-banner">
            <i class="fa-solid fa-bell"></i>
            <div><strong>Turn on notifications</strong>
            <span>Inflight needs your permission before it can tell you anything with the tab in the background.</span>
            <button type="button" data-act="permission">Allow notifications</button></div>
        </div>`;
    }

    const sections = SECTIONS.map(section => {
        const rows = section.rows.map(row => {
            const extra = (row.extra === 'approachMinutes')
                ? `<div class="ifns-minutes">${APPROACH_CHOICES.map(m =>
                    `<button type="button" data-minutes="${m}" class="${Number(prefs.ownApproachMinutes) === m ? 'is-on' : ''}">${m} min</button>`
                  ).join('')}</div>`
                : '';
            return `<div class="ifns-row">
                <i class="fa-solid ${row.icon}"></i>
                <div class="ifns-row-text">
                    <b>${esc(row.label)}</b>
                    ${row.hint ? `<span>${esc(row.hint)}</span>` : ''}
                </div>
                ${switchHTML(row.key, prefs[row.key], false)}
            </div>${extra}`;
        }).join('');
        return `<div class="ifns-section">
            <h3>${esc(section.title)}</h3>
            ${section.note ? `<p class="ifns-note">${esc(section.note)}</p>` : ''}
            <div class="ifns-list">${rows}</div>
        </div>`;
    }).join('');

    const diag = [
        `permission   ${info.permission}`,
        `delivery     ${info.nativeBridge ? 'native' : info.serviceWorker ? 'service worker' : 'page only'}`,
        `watching     ${info.watching} pilot${info.watching === 1 ? '' : 's'}`,
        `your handle  ${info.ifUsername || '— set an Infinite Flight username on your profile'}`,
        info.lastDelivery ? `last sent    ${info.lastDelivery.route || 'failed: ' + (info.lastDelivery.reason || 'unknown')}` : null,
    ].filter(Boolean).join('\n');

    root.className = `ifns-body${prefs.enabled ? '' : ' is-off'}`;
    root.innerHTML = `
        ${banner}
        <div class="ifns-section">
            <div class="ifns-list">
                <div class="ifns-row">
                    <i class="fa-solid fa-bell"></i>
                    <div class="ifns-row-text">
                        <b>Flight notifications</b>
                        <span>The master switch. Off means nothing below fires.</span>
                    </div>
                    ${switchHTML('enabled', prefs.enabled, false)}
                </div>
            </div>
        </div>
        ${sections}
        <div class="ifns-foot">
            <button type="button" data-act="test"><i class="fa-solid fa-paper-plane"></i>&nbsp; Send a test</button>
        </div>
        <pre class="ifns-diag">${esc(diag)}</pre>`;
}

/**
 * Open the settings panel. Safe to call twice — the second call re-renders the
 * one that is already up rather than stacking a second overlay.
 */
FlightNotifications.openSettings = function openSettings() {
    injectPanelStyles();

    let overlay = document.getElementById(PANEL_ID);
    if (overlay) {
        renderBody(overlay.querySelector('.ifns-body'));
        return;
    }

    overlay = document.createElement('div');
    overlay.id = PANEL_ID;
    overlay.className = 'ifns-overlay';
    overlay.innerHTML = `
        <div class="ifns-sheet" role="dialog" aria-modal="true" aria-label="Notification settings">
            <div class="ifns-head">
                <i class="fa-solid fa-bell"></i>
                <div>
                    <h2>Notifications</h2>
                    <p>What Inflight tells you, and when.</p>
                </div>
                <button type="button" class="ifns-close" aria-label="Close">✕</button>
            </div>
            <div class="ifns-body"></div>
        </div>`;
    document.body.appendChild(overlay);

    const body = overlay.querySelector('.ifns-body');
    renderBody(body);

    const close = () => {
        overlay.classList.remove('is-in');
        setTimeout(() => { try { overlay.remove(); } catch (_) {} }, 240);
    };

    overlay.querySelector('.ifns-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function onKey(e) {
        if (e.key !== 'Escape') return;
        if (!document.getElementById(PANEL_ID)) { document.removeEventListener('keydown', onKey); return; }
        close();
        document.removeEventListener('keydown', onKey);
    });

    body.addEventListener('change', (e) => {
        const key = e.target?.dataset?.pref;
        if (!key) return;
        FlightNotifications.setPref(key, !!e.target.checked);
        if (key === 'enabled') body.classList.toggle('is-off', !e.target.checked);
    });

    body.addEventListener('click', async (e) => {
        const minutes = e.target.closest('[data-minutes]');
        if (minutes) {
            FlightNotifications.setPref('ownApproachMinutes', Number(minutes.dataset.minutes));
            renderBody(body);
            return;
        }
        const act = e.target.closest('[data-act]')?.dataset?.act;
        if (act === 'permission') {
            await FlightNotifications.requestPermission();
            renderBody(body);
        } else if (act === 'test') {
            const route = await FlightNotifications.sendTest();
            if (!route) {
                // The whole reason this panel exists: say why, rather than
                // doing nothing and leaving the pilot to guess.
                await FlightNotifications.requestPermission();
                await FlightNotifications.sendTest();
            }
            renderBody(body);
        }
    });

    requestAnimationFrame(() => overlay.classList.add('is-in'));
};

if (typeof window !== 'undefined') window.InflightNotifications = FlightNotifications;

export default FlightNotifications;
