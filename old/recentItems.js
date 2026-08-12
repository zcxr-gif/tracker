/**
 * recentItems.js — what you were just looking at, one tap away.
 *
 * Closing a flight window and wanting it back meant remembering the callsign
 * and typing it again, and if the flight had landed in the meantime there was
 * nothing to type — the search only knows live traffic. Same for an airport you
 * had open a minute ago.
 *
 * This records the flights and airports you open and offers them back in the
 * search dropdown when the box is empty, which is exactly the moment you are
 * about to type one of them anyway. No new chrome: the search field and its
 * dropdown are already shared by the desktop blade and the phone's top bar, so
 * one implementation serves both.
 *
 * A recent flight is not necessarily a live one. Each row resolves at tap time:
 *  • still flying  → opens the flight window, as a search result would
 *  • landed / gone → opens the replay instead, which is the only thing left to
 *                    show and is usually what you wanted anyway
 * Deciding at tap time rather than at record time matters — the list can sit on
 * screen while a flight lands underneath it.
 *
 * Storage is localStorage and per-browser. These are a browsing history, not
 * settings: they are not worth syncing, and keeping them local means the
 * feature has no account, Pro or cloud path to go wrong.
 */

const KEY_FLIGHTS = 'inflight_recent_flights';
const KEY_AIRPORTS = 'inflight_recent_airports';

// Enough to cover "the ones I was just looking at" without turning the empty
// search into a wall. The dropdown shows fewer than this again (see MAX_SHOWN).
const MAX_STORED = 12;
const MAX_SHOWN = 5;

// Older than this and it is not "recent", it is history nobody asked for.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function read(key) {
    try {
        const raw = JSON.parse(localStorage.getItem(key) || '[]');
        if (!Array.isArray(raw)) return [];
        const cutoff = Date.now() - MAX_AGE_MS;
        return raw.filter(e => e && typeof e === 'object' && typeof e.at === 'number' && e.at > cutoff);
    } catch (_) {
        return [];
    }
}

function write(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list.slice(0, MAX_STORED))); }
    catch (_) { /* private mode, quota — the app works without a history */ }
}

/**
 * Move `entry` to the front of its list, replacing any earlier visit to the
 * same thing. Re-opening something should refresh its place, not add a second
 * row that says the same thing with an older timestamp.
 */
function remember(key, id, entry) {
    if (!id) return;
    const list = read(key).filter(e => e.id !== id);
    list.unshift({ ...entry, id, at: Date.now() });
    write(key, list);
}

export const RecentItems = {
    /** Record a flight the user opened. Called from the flight-window path. */
    rememberFlight(props) {
        if (!props) return;
        const id = props.flightId;
        if (!id) return;
        remember(KEY_FLIGHTS, id, {
            callsign: props.callsign || null,
            username: props.username || null,
            dep: (props.departureIcao || '').toUpperCase() || null,
            arr: (props.arrivalIcao || '').toUpperCase() || null,
            aircraft: props.aircraftName || null,
        });
    },

    /** Record an airport the user opened. */
    rememberAirport(icao) {
        const code = String(icao || '').trim().toUpperCase();
        if (!code) return;
        const name = (typeof window.getAirportName === 'function') ? window.getAirportName(code) : '';
        remember(KEY_AIRPORTS, code, { icao: code, name: name || null });
    },

    flights() { return read(KEY_FLIGHTS); },
    airports() { return read(KEY_AIRPORTS); },

    /** True when there is nothing worth showing — the caller renders nothing. */
    isEmpty() {
        return this.flights().length === 0 && this.airports().length === 0;
    },

    clear() {
        write(KEY_FLIGHTS, []);
        write(KEY_AIRPORTS, []);
    },

    /**
     * Whether a remembered flight is still in the live feed. Read at tap time,
     * never cached: the list can sit on screen while the flight lands.
     */
    isLive(flightId) {
        if (typeof window.getLiveFlightById !== 'function') return false;
        return !!window.getLiveFlightById(flightId);
    },

    /**
     * Open a remembered flight the best way still available.
     * @returns {'live'|'replay'|'none'} what it did, so the caller can report.
     */
    openFlight(flightId, meta = {}) {
        const feature = (typeof window.getLiveFlightById === 'function')
            ? window.getLiveFlightById(flightId) : null;

        if (feature && feature.geometry && feature.geometry.coordinates) {
            const [lon, lat] = feature.geometry.coordinates;
            if (typeof window.onSearchResultClick === 'function') {
                window.onSearchResultClick(flightId, lat, lon);
                return 'live';
            }
        }
        // Not flying any more. The replay is the only thing left that can show
        // this flight, and after a landing it is usually what was wanted.
        if (typeof window.openFlightReplayById === 'function') {
            try {
                window.openFlightReplayById(String(flightId), {
                    callsign: meta.callsign || meta.username || String(flightId),
                });
                return 'replay';
            } catch (_) { /* fall through */ }
        }
        return 'none';
    },

    /** Open a remembered airport, through the same path a search result takes. */
    openAirport(icao) {
        const code = String(icao || '').trim().toUpperCase();
        if (!code || typeof window.onAirportSearchResultClick !== 'function') return false;
        const c = (typeof window.getAirportCoords === 'function') ? window.getAirportCoords(code) : null;
        window.onAirportSearchResultClick({ icao: code, lat: c ? c.lat : NaN, lon: c ? c.lon : NaN });
        return true;
    },

    /** Rows for the search dropdown, newest first and capped. */
    forDisplay() {
        return {
            flights: this.flights().slice(0, MAX_SHOWN),
            airports: this.airports().slice(0, MAX_SHOWN),
        };
    },
};

if (typeof window !== 'undefined') {
    window.RecentItems = RecentItems;
}

export default RecentItems;
