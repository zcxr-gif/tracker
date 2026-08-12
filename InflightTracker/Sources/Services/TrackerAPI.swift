import Foundation

/// The ACARS backend that the web tracker reads from — see
/// `old/flight.js:469` for the same base URL.
///
/// The web app takes live traffic over a Socket.IO delta stream
/// (`old/FlightDeltaClient.js`). This app polls the equivalent REST snapshot
/// instead: it needs no third-party dependency, which keeps the Codemagic build
/// free of SPM and CocoaPods, and `Flight.advanced(by:)` covers the gap between
/// ticks so the map still moves continuously. The seam is deliberately narrow —
/// anything that produces `[Flight]` on a timer can replace this.
enum TrackerAPI {
    static let baseURL = URL(string: "https://site--acars-backend--6dmjph8ltlhv.code.run")!

    enum Failure: LocalizedError {
        case badStatus(Int)
        case offline

        var errorDescription: String? {
            switch self {
            case .badStatus(let code): return "Server returned \(code)"
            case .offline: return "No connection"
            }
        }
    }

    /// The available multiplayer servers, Expert first.
    static func sessions() async throws -> [Session] {
        let data = try await get("if-sessions")
        let payload = try JSONDecoder().decode(SessionsPayload.self, from: data)
        return payload.sessions
            .filter { !$0.name.isEmpty }
            .sorted { ($0.sortRank, $0.name) < ($1.sortRank, $1.name) }
    }

    /// Every aircraft currently on `sessionID`.
    static func flights(sessionID: String) async throws -> [Flight] {
        let encoded = sessionID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? sessionID
        let data = try await get("flights/\(encoded)")
        return try JSONDecoder().decode(FlightsPayload.self, from: data).flights
    }

    // MARK: - Transport

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        // The poller re-requests every 15 s, so a stale cached body would show
        // as a frozen map. Always go to the network.
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

    private static func get(_ path: String) async throws -> Data {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("InflightTracker-iOS", forHTTPHeaderField: "X-Client")

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { return data }
            guard (200..<300).contains(http.statusCode) else {
                throw Failure.badStatus(http.statusCode)
            }
            return data
        } catch let error as URLError where error.code == .notConnectedToInternet {
            throw Failure.offline
        }
    }
}
