// preferenceSync.js — carry a Pro pilot's settings between their devices.
//
// The app has always kept preferences in localStorage, which means they are
// per-browser: sign in on a phone and the theme, the units, the playback speed
// and the server you always fly on are all back to defaults. One setting —
// mapFilters — already syncs, through profiles.map_filters in flight.js. This
// does the same for everything else, in one place, so adding a setting does not
// mean remembering to add a sync for it.
//
// mapFilters is deliberately NOT in the list below. flight.js owns it and
// writes it to its own column; two writers for one setting is a bug factory.
//
// ── What is synced ──────────────────────────────────────────────────────────
// An explicit allowlist, never "everything in localStorage". Storage also holds
// a Discord token, a remembered email, crew session keys, the Pro flag itself
// and several caches, and none of those may leave the device — a sync that
// scoops up a bearer token is a credential leak with a progress spinner.
// Anything not named here stays local, including keys added later, which is the
// safe direction to fail in.
//
// ── Who gets it ─────────────────────────────────────────────────────────────
// Pro accounts, matching how map_filters already behaves. A free account keeps
// working exactly as before, per device.
//
// ── How conflicts are settled ───────────────────────────────────────────────
// Last writer wins, by timestamp, per whole blob. Not per key: two devices
// changing two different settings within the same minute is rare, and the
// alternative — merging field by field with no vector clock — resolves that
// rare case at the cost of being much harder to reason about when it goes
// wrong. The device only pushes when something actually changed, so an idle
// second device cannot overwrite an active first one.

const TABLE = 'user_preferences';
const LOCAL_STAMP_KEY = 'inflight_prefs_local_changed_at';
const LOCAL_SYNC_KEY = 'inflight_prefs_synced_at';

// How often the device re-reads the allowlist looking for a change.
//
// The alternative was patching localStorage.setItem so writes announce
// themselves. That catches changes instantly but monkey-patches a global that
// every module and every third-party script on the page also uses, and a bug
// in it breaks storage app-wide. Reading two dozen short strings on a five
// second timer costs microseconds and touches nothing.
const POLL_MS = 5000;
// Settings are changed in bursts — open Settings, flip four things, close it.
// One push after the burst rather than four during it.
const PUSH_DEBOUNCE_MS = 2500;

/**
 * The allowlist.
 *
 * Grouped by where the setting lives so that when a module gains a preference
 * it is obvious which block to add it to — and obvious, from the exclusions at
 * the bottom, what must never be added.
 */
export const SYNCED_KEYS = [
    // Appearance (profileUI, crew centre)
    'pui-theme', 'pui-accent', 'pui-locale', 'pui-density', 'crew-theme',

    // Where and how the map opens
    'preferredServer', 'mobileDisplayMode', 'landingUI_visible',
    'inflightSimpleLayout', 'acWindowDock', 'inflight_window_choice',
    'inflight_share_map_style',

    // Units and readouts
    'inflightFuelUnit',

    // Global playback (globalPlayback.js)
    'globalPlaybackSpeed', 'globalPlaybackSpanMs', 'globalPlaybackTrails',
    'globalPlaybackFilters',

    // ATC replay (atcReplay.js)
    'atcReplayAltBand', 'atcReplayCollapsed', 'atcReplayPathMode',
    'atcReplayTrailWindowMs',

    // Things the pilot curated and would be annoyed to rebuild
    'inflight_va_favorites', 'airlineLogoBlocklist', 'inflight_nearby_radar',

    // Discord presence — the two switches, never the token two lines below
    // them in storage.
    'inflight.discordPresence.autoconnect', 'inflight.discordPresence.follow'
];

/**
 * Keys that must never sync, named rather than merely omitted.
 *
 * The allowlist already excludes them; this is here so that anyone adding to
 * the list above reads the reasons first, and so a test can assert they are
 * absent. Adding one of these would be a security bug, not a feature.
 */
export const NEVER_SYNC = [
    'inflight.discordPresence.token',   // a bearer token
    'inflight_remembered_email',        // credential-adjacent, and device-local by intent
    'inflight_remember_preference',
    'inflight_pending_signup',
    'inflight_is_pro',                  // the entitlement — a device must ask, not remember
    'inflight_pro_detail',
    'inflight_pro_pending_activation',  // a specific browser's unfinished checkout
    'inflight_legal_accepted',          // a record of what this person accepted, not a setting
    'mapFilters',                       // flight.js owns it (profiles.map_filters)
    'landingUI_data',                   // cache
    'communityTrackerFlights'           // cache
];

function readLocal(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
}
function writeLocal(key, value) {
    try {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, String(value));
    } catch (_) { /* private mode */ }
}

export const PreferenceSync = {
    _supabase: null,
    _timer: null,
    _pushTimer: null,
    _lastSeen: null,        // serialised snapshot, to notice changes
    _started: false,
    _applying: false,       // guards the poll against seeing our own pull as a local edit

    /** Everything on the allowlist that this device actually has a value for. */
    snapshot() {
        const out = {};
        for (const key of SYNCED_KEYS) {
            const value = readLocal(key);
            if (value !== null) out[key] = value;
        }
        return out;
    },

    /**
     * Write a pulled blob into localStorage.
     *
     * Only allowlisted keys are applied however the row got its contents — the
     * blob comes back over the network, and a row that somehow contained
     * `inflight_is_pro` must not be able to grant itself Pro on the way in.
     */
    apply(blob) {
        if (!blob || typeof blob !== 'object') return 0;
        this._applying = true;
        let applied = 0;
        try {
            for (const key of SYNCED_KEYS) {
                if (!Object.prototype.hasOwnProperty.call(blob, key)) continue;
                const value = blob[key];
                if (value === null || typeof value === 'object') continue;
                if (readLocal(key) === String(value)) continue;
                writeLocal(key, value);
                applied++;
            }
        } finally {
            this._applying = false;
        }
        // Most of these are read once at start-up, so a reload is what fully
        // applies them. The event lets anything that can re-read live do so.
        if (applied) {
            try {
                window.dispatchEvent(new CustomEvent('preferencesRestored', { detail: { count: applied } }));
            } catch (_) { /* no window */ }
        }
        return applied;
    },

    isEligible() {
        try { return typeof window.isInflightPro === 'function' && window.isInflightPro(); }
        catch (_) { return false; }
    },

    async _userId() {
        try {
            const { data } = await this._supabase.auth.getSession();
            return data?.session?.user?.id || null;
        } catch (_) { return null; }
    },

    /**
     * Fetch the cloud copy and take it if it is newer than this device's last
     * local edit.
     *
     * "Newer than the last local edit", not "newer than the last pull": a
     * device that has been sitting on an unsent change must not have it
     * silently replaced by an older cloud copy just because it reconnected.
     */
    async pull() {
        if (!this._supabase || !this.isEligible()) return { applied: 0, reason: 'not-eligible' };
        const userId = await this._userId();
        if (!userId) return { applied: 0, reason: 'signed-out' };

        try {
            const { data, error } = await this._supabase
                .from(TABLE)
                .select('preferences, preferences_updated_at')
                .eq('user_id', userId)
                .maybeSingle();
            if (error) return { applied: 0, reason: 'error:' + error.message };
            if (!data?.preferences) {
                // Nothing in the cloud yet — this device seeds it.
                await this.push({ force: true });
                return { applied: 0, reason: 'seeded' };
            }

            const remoteAt = Date.parse(data.preferences_updated_at || '') || 0;
            const localAt = Number(readLocal(LOCAL_STAMP_KEY)) || 0;
            if (remoteAt <= localAt) {
                await this.push({ force: true });
                return { applied: 0, reason: 'local-newer' };
            }

            const applied = this.apply(data.preferences);
            this._lastSeen = JSON.stringify(this.snapshot());
            writeLocal(LOCAL_SYNC_KEY, String(remoteAt));
            writeLocal(LOCAL_STAMP_KEY, String(remoteAt));
            return { applied, reason: 'applied' };
        } catch (e) {
            return { applied: 0, reason: 'error:' + (e.message || e) };
        }
    },

    /** Write this device's snapshot up. Debounced unless forced. */
    async push(options) {
        if (!this._supabase || !this.isEligible()) return false;
        if (!options?.force) {
            clearTimeout(this._pushTimer);
            this._pushTimer = setTimeout(() => this.push({ force: true }), PUSH_DEBOUNCE_MS);
            return false;
        }
        clearTimeout(this._pushTimer);
        this._pushTimer = null;

        const userId = await this._userId();
        if (!userId) return false;

        const preferences = this.snapshot();
        const at = new Date().toISOString();
        try {
            const { error } = await this._supabase
                .from(TABLE)
                .upsert({ user_id: userId, preferences, preferences_updated_at: at }, { onConflict: 'user_id' });
            if (error) {
                console.warn('[PreferenceSync] push failed:', error.message);
                return false;
            }
            this._lastSeen = JSON.stringify(preferences);
            writeLocal(LOCAL_SYNC_KEY, String(Date.parse(at)));
            writeLocal(LOCAL_STAMP_KEY, String(Date.parse(at)));
            return true;
        } catch (e) {
            console.warn('[PreferenceSync] push failed:', e.message || e);
            return false;
        }
    },

    /** Notice a local edit and schedule a push. */
    _poll() {
        if (this._applying || !this.isEligible()) return;
        const now = JSON.stringify(this.snapshot());
        if (this._lastSeen === null) { this._lastSeen = now; return; }
        if (now === this._lastSeen) return;
        this._lastSeen = now;
        writeLocal(LOCAL_STAMP_KEY, String(Date.now()));
        this.push();
    },

    /**
     * Start syncing. Safe to call more than once.
     *
     * Pulls whenever the entitlement resolves — the app decides Pro after this
     * runs, so waiting for `proStatusChanged` is what makes the first pull
     * happen at all — and on sign-in, since a second account on the same
     * browser must not inherit the first one's settings.
     */
    init(supabase) {
        if (this._started || typeof window === 'undefined') return;
        this._supabase = supabase;
        this._started = true;

        this._timer = setInterval(() => this._poll(), POLL_MS);

        window.addEventListener('proStatusChanged', () => { this.pull(); });
        try {
            supabase.auth.onAuthStateChange((event) => {
                if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') this.pull();
                if (event === 'SIGNED_OUT') this._lastSeen = null;
            });
        } catch (_) { /* older client */ }

        // A tab being closed is the commonest way a debounced push is lost.
        const flush = () => {
            if (this._pushTimer) this.push({ force: true });
        };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flush();
        });

        this.pull();
    },

    stop() {
        clearInterval(this._timer);
        clearTimeout(this._pushTimer);
        this._timer = this._pushTimer = null;
        this._started = false;
    }
};

if (typeof window !== 'undefined') window.InflightPreferenceSync = PreferenceSync;
