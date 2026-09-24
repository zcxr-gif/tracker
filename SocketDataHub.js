/**
 * SocketDataHub.js
 * * High-performance, decoupled Event Bus for WebSocket data.
 * Allows independent modules to tap into live data streams without
 * modifying the core socket connection file.
 * * ============================================================================
 * 📖 DATA DICTIONARY & SCHEMA DEFINITIONS
 * ============================================================================
 * The following types define the exact structure of the payloads 
 * broadcasted by the hub. 
 * * ----------------------------------------------------------------------------
 * CHANNEL: 'all_flights_update'
 * ----------------------------------------------------------------------------
 * Published on every backend tick. The payload is either the socket packet of
 * the same name, or — when the backend supports the incremental protocol — a
 * snapshot reassembled by FlightDeltaClient.js from the delta stream. The two
 * are identical in shape, with one detail worth knowing: on the delta path
 * `position.lastReport` carries the epoch milliseconds rather than the ISO
 * string, because the string is redundant with `lastReportMs` and costs real
 * bandwidth at a thousand aircraft a tick. Anything reading it should keep
 * going through `new Date(...)` / `Date.parse(...)`, which accept both.
 *
 * @typedef {Object} AllFlightsUpdatePayload
 * @property {number|string} timestamp - Server-side timestamp of the data packet.
 * @property {string} server - The active server name (e.g., "Expert Server").
 * @property {FlightData[]} flights - Array of all currently active flights.
 * * @typedef {Object} FlightData
 * @property {string} flightId - Unique identifier for the flight session.
 * @property {string} callsign - Aircraft callsign (e.g., "DAL123").
 * @property {string} username - The pilot's community username.
 * @property {string} userId - Unique identifier for the pilot.
 * @property {FlightPosition} position - Real-time spatial telemetry.
 * @property {AircraftDetails} aircraft - Metadata regarding the airframe.
 * @property {string} [departureIcao] - Origin airport 4-letter code.
 * @property {string} [arrivalIcao] - Destination airport 4-letter code.
 * @property {number} pilotState - Numerical pilot state (0=Active, 1=Away, 2=Parked).
 * * @typedef {Object} FlightPosition
 * @property {number} lat - Latitude of the aircraft.
 * @property {number} lon - Longitude of the aircraft.
 * @property {number} alt_ft - Altitude in feet.
 * @property {number} gs_kt - Ground speed in knots.
 * @property {number} vs_fpm - Vertical speed in feet per minute.
 * @property {number} heading_deg - True heading in degrees.
 * @property {number|string} [lastReport] - Timestamp of the last position report.
 * * @typedef {Object} AircraftDetails
 * @property {string} aircraftName - Full name of the aircraft (e.g., "Airbus A320-200").
 * @property {string} liveryName - Airline or livery name (e.g., "Delta Air Lines").
 * @property {string} [registration] - Aircraft tail number or registration.
 * * ----------------------------------------------------------------------------
 * CHANNEL: 'secondary_data_update'
 * ----------------------------------------------------------------------------
 * @typedef {Object} SecondaryDataUpdatePayload
 * @property {string} server - The active server name.
 * @property {AtcFacility[]} atc - Array of active Air Traffic Control facilities.
 * @property {Array} [notams] - Active NOTAMs for the session.
 *
 * Note: the IF world status (`world`) is deliberately NOT on this channel. It
 * is ~100 KB of airport/flight-ID lists that nothing here reads, so the backend
 * keeps it server-side and serves it from GET /api/live/world/:sessionId for
 * the rare caller that wants it.
 * * @typedef {Object} AtcFacility
 * @property {number} type - ATC Type ID (0: GND, 1: TWR, 4/5: APP, 6: Center).
 * @property {string} username - Controller's username.
 * @property {string} airportName - Associated Airport ICAO or FIR identifier.
 * @property {number|string} startTime - When the controller opened the frequency.
 * ============================================================================
 */

// Each delivery runs as its own macrotask. Microtasks (the old
// Promise.resolve().then) drain inside the same task as the socket handler
// and the map update, so every subscriber still landed in one long task and
// the frame could not be painted until all of them had finished. A
// MessageChannel post is a real task boundary without setTimeout's clamping.
const scheduleTask = (() => {
    if (typeof MessageChannel !== 'function') return (fn) => setTimeout(fn, 0);
    const queue = [];
    const mc = new MessageChannel();
    mc.port1.onmessage = () => { const fn = queue.shift(); if (fn) fn(); };
    return (fn) => { queue.push(fn); mc.port2.postMessage(null); };
})();

// Per-packet index of flights by lowercased username. Several subscribers
// (profile, mobile dashboard) need the same lookup; building it once per
// packet instead of once per subscriber halves that work on a busy server.
const _usernameIndex = new WeakMap();

/**
 * @param {AllFlightsUpdatePayload} payload
 * @returns {Map<string, FlightData[]>} lowercased username -> that pilot's flights
 */
export function flightsByUsername(payload) {
    let index = _usernameIndex.get(payload);
    if (index) return index;
    index = new Map();
    const flights = payload.flights || [];
    for (let i = 0; i < flights.length; i++) {
        const f = flights[i];
        const un = f.username && f.username.toLowerCase();
        if (!un) continue;
        const bucket = index.get(un);
        if (bucket) bucket.push(f);
        else index.set(un, [f]);
    }
    _usernameIndex.set(payload, index);
    return index;
}

class SocketDistributor {
    constructor() {
        this.channels = new Map();
        // channel -> Map(listener -> newest undelivered payload)
        this.pending = new Map();
        this.metrics = { published: 0, errors: 0, coalesced: 0 };
    }

    /**
     * Subscribe to a data channel.
     * @param {string} channel - The socket event name (e.g., 'all_flights_update').
     * @param {Function} listener - Callback receiving the data.
     * @returns {Function} - Unsubscribe method for memory safety.
     */
    subscribe(channel, listener) {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set());
        }
        
        this.channels.get(channel).add(listener);
        
        // Return a self-contained teardown function for premium memory management
        return () => {
            const subs = this.channels.get(channel);
            if (subs) subs.delete(listener);
            this.pending.get(channel)?.delete(listener);
        };
    }

    /**
     * Broadcasts data to all subscribers on a channel.
     * @param {string} channel - The socket event name.
     * @param {any} payload - The raw data from the WebSocket.
     */
    publish(channel, payload) {
        const subs = this.channels.get(channel);
        if (!subs || !subs.size) return;

        this.metrics.published++;

        let pending = this.pending.get(channel);
        if (!pending) this.pending.set(channel, pending = new Map());

        for (const listener of subs) {
            // Every channel carries full state, so a subscriber that hasn't
            // run yet only needs the newest packet — replace rather than
            // queue, and a slow consumer can never fall behind.
            if (pending.has(listener)) {
                this.metrics.coalesced++;
                pending.set(listener, payload);
                continue;
            }
            pending.set(listener, payload);
            scheduleTask(() => this._deliver(channel, listener));
        }
    }

    _deliver(channel, listener) {
        const pending = this.pending.get(channel);
        if (!pending || !pending.has(listener)) return;
        const payload = pending.get(listener);
        pending.delete(listener);

        // Unsubscribed between publish and delivery.
        if (!this.channels.get(channel)?.has(listener)) return;

        try {
            listener(payload);
        } catch (err) {
            this.metrics.errors++;
            console.error(`[SocketDataHub] Uncaught exception in channel '${channel}':`, err);
        }
    }
    
    getHealth() {
        return {
            activeChannels: this.channels.size,
            totalSubscribers: Array.from(this.channels.values()).reduce((acc, set) => acc + set.size, 0),
            metrics: this.metrics
        };
    }
}

// Export a frozen singleton to prevent external mutation of the instance
export const socketDataHub = new SocketDistributor();
Object.freeze(socketDataHub);