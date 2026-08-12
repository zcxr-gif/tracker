import Combine
import Foundation
import MapKit

/// Owns the live picture: which server is selected, what is on it, and which
/// subset of that is worth handing to the map right now.
///
/// Two clocks run here and they do different jobs.
///
/// * The **poll** (every `pollInterval`) fetches a fresh snapshot. That is the
///   only time the app talks to the network.
/// * The **tick** (every `tickInterval`) re-projects the snapshot forward with
///   dead reckoning and re-culls it against the visible region. No network, no
///   allocation beyond the rendered slice.
///
/// Splitting them is what makes a thousand-aircraft server usable: SwiftUI only
/// ever sees a few hundred annotations, and they move smoothly between the
/// backend's 15-second reports.
@MainActor
final class LiveTrafficStore: ObservableObject {
    /// A busy Expert Server carries well over a thousand aircraft. Handing all
    /// of them to SwiftUI drops the map to single-digit frame rates, and they
    /// would be sub-pixel specks anyway — so render the ones nearest the centre
    /// of what the user is actually looking at.
    private static let maxRenderedFlights = 300

    /// Never dead-reckon further than this. A flight whose reports have stopped
    /// should sit still and go stale, not fly a straight line across the ocean.
    private static let maxExtrapolationSeconds: TimeInterval = 90

    private static let pollInterval: TimeInterval = 15
    private static let tickInterval: TimeInterval = 1

    private static let preferredServerKey = "preferredServerName"

    enum ConnectionState: Equatable {
        case idle
        case loading
        case live
        case failed(String)
    }

    // MARK: - Published state

    @Published private(set) var sessions: [Session] = []
    @Published private(set) var selectedSession: Session?
    /// Dead-reckoned and culled — this is what the map renders.
    @Published private(set) var visibleFlights: [Flight] = []
    /// Total on the server, before culling. Shown in the status pill.
    @Published private(set) var totalFlightCount: Int = 0
    @Published private(set) var state: ConnectionState = .idle
    @Published private(set) var lastSnapshotAt: Date?
    /// The dead-reckoned copy of the selected flight, refreshed every tick so
    /// the detail sheet's numbers move with the map.
    @Published private(set) var selectedFlight: Flight?
    /// Off by default: parked aircraft are most of a busy server and none of
    /// the interest.
    @Published private(set) var showsParkedAircraft = false

    @Published var selectedFlightID: String? {
        didSet {
            guard selectedFlightID != oldValue else { return }
            refreshSelection()
        }
    }

    // MARK: - Private state

    /// The last snapshot exactly as the backend sent it. Not published: it
    /// changes wholesale every 15 s and nothing renders from it directly.
    private var snapshot: [Flight] = []
    private var snapshotTakenAt: Date = .distantPast
    private var region: MKCoordinateRegion?

    private var pollTask: Task<Void, Never>?
    private var tickTask: Task<Void, Never>?

    // MARK: - Lifecycle

    func start() {
        guard pollTask == nil else { return }

        pollTask = Task { [weak self] in
            await self?.loadSessionsIfNeeded()
            while !Task.isCancelled {
                guard let self else { break }
                await self.poll()
                try? await Task.sleep(nanoseconds: UInt64(Self.pollInterval * 1_000_000_000))
            }
        }

        tickTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(Self.tickInterval * 1_000_000_000))
                guard let self else { break }
                self.tick()
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        tickTask?.cancel()
        pollTask = nil
        tickTask = nil
    }

    // MARK: - Input from the UI

    /// Called as the camera moves. Cheap on purpose: it records the region and
    /// lets the next tick do the culling, so a pan gesture doesn't re-filter a
    /// thousand aircraft on every frame.
    func setRegion(_ region: MKCoordinateRegion) {
        self.region = region
    }

    func select(_ session: Session) {
        guard session.id != selectedSession?.id else { return }
        selectedSession = session
        UserDefaults.standard.set(session.name, forKey: Self.preferredServerKey)

        // The old server's aircraft are not on the new one. Clearing now avoids
        // a couple of seconds of stale traffic under a new server's name.
        snapshot = []
        snapshotTakenAt = .distantPast
        visibleFlights = []
        totalFlightCount = 0
        selectedFlightID = nil
        state = .loading

        Task { await poll() }
    }

    func setShowParkedAircraft(_ show: Bool) {
        guard show != showsParkedAircraft else { return }
        showsParkedAircraft = show
        recomputeVisible()
    }

    func refresh() {
        Task {
            await loadSessionsIfNeeded(force: true)
            await poll()
        }
    }

    /// Callsign / pilot / registration / route search over the whole snapshot,
    /// not just what is on screen.
    func search(_ query: String) -> [Flight] {
        let needle = query.trimmed.lowercased()
        guard needle.count >= 1 else { return [] }

        let matches = snapshot.filter { flight in
            flight.callsign.lowercased().contains(needle)
                || flight.username?.lowercased().contains(needle) == true
                || flight.registration?.lowercased().contains(needle) == true
                || flight.departureIcao?.lowercased().contains(needle) == true
                || flight.arrivalIcao?.lowercased().contains(needle) == true
                || flight.operatorLabel?.lowercased().contains(needle) == true
        }

        // A callsign that starts with what was typed is almost always the one
        // being looked for; rank those first.
        return matches.sorted { lhs, rhs in
            let lhsPrefix = lhs.callsign.lowercased().hasPrefix(needle)
            let rhsPrefix = rhs.callsign.lowercased().hasPrefix(needle)
            if lhsPrefix != rhsPrefix { return lhsPrefix }
            return lhs.callsign < rhs.callsign
        }
        .prefix(60)
        .map { $0 }
    }

    /// The current position of a flight by id, dead-reckoned. Used to centre
    /// the camera on a search result.
    func currentPosition(of flightID: String) -> Flight? {
        guard let flight = snapshot.first(where: { $0.id == flightID }) else { return nil }
        return flight.advanced(by: extrapolationAge)
    }

    // MARK: - Networking

    private func loadSessionsIfNeeded(force: Bool = false) async {
        guard force || sessions.isEmpty else { return }
        do {
            let fetched = try await TrackerAPI.sessions()
            guard !fetched.isEmpty else { return }
            sessions = fetched

            if selectedSession == nil || !fetched.contains(where: { $0.id == selectedSession?.id }) {
                let preferred = UserDefaults.standard.string(forKey: Self.preferredServerKey)
                selectedSession = fetched.first { $0.name == preferred } ?? fetched.first
            } else if let current = selectedSession,
                      let updated = fetched.first(where: { $0.id == current.id }) {
                // Keep the live user count fresh in the server pill.
                selectedSession = updated
            }
        } catch {
            if sessions.isEmpty {
                state = .failed(message(for: error))
            }
        }
    }

    private func poll() async {
        // Session ids rotate; if we lost them, get them back before asking for
        // traffic on an id that no longer exists.
        if selectedSession == nil {
            await loadSessionsIfNeeded(force: true)
        }
        guard let session = selectedSession else { return }

        if snapshot.isEmpty { state = .loading }

        do {
            let flights = try await TrackerAPI.flights(sessionID: session.id)

            // A poll that lands after the user switched servers describes the
            // server we just left. Dropping it is correct.
            guard session.id == selectedSession?.id else { return }

            snapshot = flights
            snapshotTakenAt = Date()
            lastSnapshotAt = snapshotTakenAt
            totalFlightCount = flights.count
            state = .live
            recomputeVisible()
            refreshSelection()
        } catch {
            // Keep showing the last good snapshot rather than blanking the map;
            // the status pill is what tells the user it has gone stale.
            state = .failed(message(for: error))
        }
    }

    private func message(for error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? "Connection lost"
    }

    // MARK: - Projection and culling

    /// How far past the last snapshot to dead-reckon, capped.
    private var extrapolationAge: TimeInterval {
        guard snapshotTakenAt != .distantPast else { return 0 }
        return min(Date().timeIntervalSince(snapshotTakenAt), Self.maxExtrapolationSeconds)
    }

    private func tick() {
        guard !snapshot.isEmpty else { return }
        recomputeVisible()
        refreshSelection()
    }

    private func refreshSelection() {
        guard let id = selectedFlightID else {
            if selectedFlight != nil { selectedFlight = nil }
            return
        }
        selectedFlight = currentPosition(of: id)
    }

    private func recomputeVisible() {
        guard !snapshot.isEmpty else {
            if !visibleFlights.isEmpty { visibleFlights = [] }
            return
        }

        let age = extrapolationAge
        let candidates = showsParkedAircraft ? snapshot : snapshot.filter { !$0.isParked }

        guard let region, region.span.latitudeDelta < 170 else {
            // Zoomed all the way out: no meaningful cull, just cap the count.
            visibleFlights = candidates.prefix(Self.maxRenderedFlights).map { $0.advanced(by: age) }
            return
        }

        let latPadding = region.span.latitudeDelta * 0.25
        let lonPadding = region.span.longitudeDelta * 0.25
        let minLat = region.center.latitude - region.span.latitudeDelta / 2 - latPadding
        let maxLat = region.center.latitude + region.span.latitudeDelta / 2 + latPadding
        let minLon = region.center.longitude - region.span.longitudeDelta / 2 - lonPadding
        let maxLon = region.center.longitude + region.span.longitudeDelta / 2 + lonPadding

        // Near the antimeridian the padded box straddles ±180 and a plain
        // range test would exclude everything. At that width the latitude
        // filter alone is enough.
        let checkLongitude = minLon > -180 && maxLon < 180

        var inView: [(flight: Flight, distanceSq: Double)] = []
        inView.reserveCapacity(min(candidates.count, Self.maxRenderedFlights * 2))

        for flight in candidates {
            let projected = flight.advanced(by: age)
            let lat = projected.position.lat
            guard lat >= minLat, lat <= maxLat else { continue }
            if checkLongitude {
                let lon = projected.position.lon
                guard lon >= minLon, lon <= maxLon else { continue }
            }
            let dLat = lat - region.center.latitude
            let dLon = projected.position.lon - region.center.longitude
            inView.append((projected, dLat * dLat + dLon * dLon))
        }

        if inView.count > Self.maxRenderedFlights {
            inView.sort { $0.distanceSq < $1.distanceSq }
            inView = Array(inView.prefix(Self.maxRenderedFlights))
        }

        var rendered = inView.map { $0.flight }

        // The selected aircraft always stays on the map, even after it drifts
        // out of the culled set — otherwise tapping a search result far from
        // the centre selects something that isn't drawn.
        if let id = selectedFlightID, !rendered.contains(where: { $0.id == id }),
           let selected = currentPosition(of: id) {
            rendered.append(selected)
        }

        visibleFlights = rendered
    }
}
