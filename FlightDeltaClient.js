/**
 * FlightDeltaClient.js
 *
 * Rebuilds a full `all_flights_update`-shaped snapshot from the backend's
 * incremental flight stream, so nothing downstream has to know deltas exist.
 *
 * WHY
 * ---
 * The old wire format re-sent every flight in full on every poll — on a busy
 * Expert Server that is ~600 KB every 15 seconds, of which the part that
 * actually changed is a few kilobytes of coordinates. The backend now diffs its
 * own snapshot and sends only what moved. This module puts the snapshot back
 * together on the client, and hands `handleSocketFlightUpdate()` exactly the
 * payload it has always received.
 *
 * PROTOCOL (mirror of Infinte-Flight-backend/flight_delta.cjs)
 * ------------------------------------------------------------
 *   all_flights_sync   { server, sessionId, t, q, c, f: [[slot, flight], …] }
 *   all_flights_delta  { server, sessionId, t, q, b, c, a, p, m, r }
 *
 * Each flight holds a small integer "slot" for its lifetime, so a position
 * update costs a couple of characters of identifier instead of a 36-character
 * GUID. `q` is the packet's sequence and `b` the sequence it builds on: if `b`
 * doesn't match what we last applied we have missed a packet and must resync
 * rather than render drifting state.
 *
 * The backend does not send `position.lastReport` (the ISO string) because
 * `lastReportMs` carries the same instant in a fraction of the bytes; we
 * restore the field from the epoch value, which every consumer already accepts.
 */

// Position tuple layout: [slot, lat, lon, alt_ft, gs_kt, vs_fpm, heading_deg, lastReportMs]
const P_SLOT = 0, P_LAT = 1, P_LON = 2, P_ALT = 3, P_GS = 4, P_VS = 5, P_HDG = 6, P_TS = 7;

export class FlightDeltaClient {
    /**
     * @param {object} [opts]
     * @param {Function} [opts.onResyncNeeded] - called with the server name when
     *        a sequence gap is detected; should ask the backend for a fresh sync.
     */
    constructor(opts = {}) {
        this.onResyncNeeded = opts.onResyncNeeded || null;

        /** @type {Map<number, object>} slot -> full flight object */
        this.bySlot = new Map();
        this.server = null;
        this.sessionId = null;
        this.timestamp = null;
        this.seq = -1;

        this.stats = { syncs: 0, deltas: 0, dropped: 0, resyncs: 0 };
    }

    /** True once a sync has landed and deltas can be applied. */
    get ready() {
        return this.seq >= 0;
    }

    /**
     * Forget everything — used on disconnect and when switching servers.
     *
     * @param {string} [expectedServer] the server we are about to be synced
     *        for. Worth passing on a server switch: packets for the room we
     *        just left can still be in flight, and knowing which server we want
     *        lets us drop them quietly instead of mistaking them for a gap and
     *        asking for a resync we don't need.
     */
    reset(expectedServer = null) {
        this.bySlot.clear();
        this.server = expectedServer || null;
        this.sessionId = null;
        this.timestamp = null;
        this.seq = -1;
    }

    /**
     * Apply a full-state packet.
     * @returns {object} a snapshot in `all_flights_update` shape.
     */
    applySync(packet) {
        this.bySlot.clear();
        this.server = packet.server;
        this.sessionId = packet.sessionId;
        this.timestamp = packet.t;
        this.seq = packet.q;
        this.stats.syncs++;

        for (const entry of (packet.f || [])) {
            this.bySlot.set(entry[0], hydrate(entry[1]));
        }
        return this._snapshot();
    }

    /**
     * Apply an incremental packet.
     * @returns {object|null} a snapshot, or null when the packet could not be
     *          applied (a resync has been requested in that case).
     */
    applyDelta(packet) {
        // A packet for a server we aren't tracking is stale routing, not a gap;
        // dropping it silently is correct. Compared case-insensitively, as the
        // rest of the app does — server names round-trip through room names.
        if (!sameServer(this.server, packet.server)) return null;

        if (!this.ready || packet.b !== this.seq) {
            // We missed something. Everything we would render from here is
            // guesswork, so throw the state away and ask for the truth.
            this.stats.dropped++;
            this._requestResync(packet.server);
            return null;
        }

        this.seq = packet.q;
        this.timestamp = packet.t;
        if (packet.sessionId) this.sessionId = packet.sessionId;
        this.stats.deltas++;

        for (const slot of (packet.r || [])) {
            this.bySlot.delete(slot);
        }

        for (const entry of (packet.a || [])) {
            this.bySlot.set(entry[0], hydrate(entry[1]));
        }

        // Positions. A new position object (and a new flight object wrapping
        // it) is created rather than mutating in place: the full-snapshot
        // protocol handed consumers fresh objects every tick, and some of them
        // hold references across ticks.
        for (const t of (packet.p || [])) {
            const prev = this.bySlot.get(t[P_SLOT]);
            if (!prev) continue;
            this.bySlot.set(t[P_SLOT], {
                ...prev,
                position: {
                    lat: t[P_LAT],
                    lon: t[P_LON],
                    alt_ft: t[P_ALT],
                    gs_kt: t[P_GS],
                    vs_fpm: t[P_VS],
                    heading_deg: t[P_HDG],
                    lastReport: t[P_TS],
                    lastReportMs: t[P_TS],
                },
            });
        }

        // Metadata (callsign edits, a flight plan filed mid-flight, the VA
        // roster poll landing). Rare, so a partial object is cheaper than a
        // tuple here.
        for (const [slot, changed] of (packet.m || [])) {
            const prev = this.bySlot.get(slot);
            if (!prev) continue;
            const next = { ...prev, ...changed };
            if (changed.aircraft) next.aircraft = { ...prev.aircraft, ...changed.aircraft };
            this.bySlot.set(slot, next);
        }

        // The backend tells us how many flights should remain. A mismatch means
        // our view has drifted from the server's, which deltas cannot repair.
        if (typeof packet.c === 'number' && packet.c !== this.bySlot.size) {
            console.warn(`[FlightDelta] Count drift: have ${this.bySlot.size}, expected ${packet.c}. Resyncing.`);
            this._requestResync(packet.server);
            return null;
        }

        return this._snapshot();
    }

    _requestResync(serverName) {
        this.reset();
        this.stats.resyncs++;
        if (this.onResyncNeeded) this.onResyncNeeded(serverName);
    }

    /** Rebuild the `all_flights_update`-shaped payload consumers expect. */
    _snapshot() {
        const flights = new Array(this.bySlot.size);
        let i = 0;
        for (const f of this.bySlot.values()) flights[i++] = f;

        return {
            server: this.server,
            sessionId: this.sessionId,
            count: flights.length,
            flights,
            timestamp: this.timestamp,
        };
    }
}

/** True unless both names are known and differ. */
function sameServer(a, b) {
    if (!a || !b) return true;
    return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * Turn a wire flight into the shape the rest of the app expects — which means
 * putting back the `lastReport` field the backend leaves off.
 */
function hydrate(wire) {
    const p = wire.position || {};
    return {
        ...wire,
        position: { ...p, lastReport: p.lastReportMs ?? null },
    };
}
