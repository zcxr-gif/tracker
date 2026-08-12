import CoreLocation
import Foundation

/// One aircraft on one Infinite Flight server.
///
/// The wire format is the ACARS backend's, documented in `old/SocketDataHub.js`
/// under "CHANNEL: all_flights_update". Decoding is deliberately forgiving:
/// everything except an identifier and a position has a default, because a
/// single flight with a null livery must not blank the whole map.
struct Flight: Identifiable, Equatable, Sendable {
    let id: String
    let callsign: String
    let username: String?
    let userId: String?
    let departureIcao: String?
    let arrivalIcao: String?
    /// 0 = active, 1 = away, 2 = parked. Nil when the backend omits it.
    let pilotState: Int?
    let aircraftName: String?
    let liveryName: String?
    let registration: String?
    var position: Position

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: position.lat, longitude: position.lon)
    }

    /// Parked aircraft are the bulk of a busy server and none of the interest.
    /// The ground-speed test catches the ones the backend hasn't flagged yet.
    var isParked: Bool {
        pilotState == 2 || position.gsKt < 1
    }

    var isOnGround: Bool {
        position.altFt < 1_000 && position.gsKt < 80
    }

    /// "EGLL → KJFK", or nil when no flight plan was filed.
    var route: String? {
        let dep = departureIcao?.trimmed
        let arr = arrivalIcao?.trimmed
        switch (dep?.isEmpty == false ? dep : nil, arr?.isEmpty == false ? arr : nil) {
        case let (dep?, arr?): return "\(dep) → \(arr)"
        case let (dep?, nil): return "\(dep) → ????"
        case let (nil, arr?): return "???? → \(arr)"
        default: return nil
        }
    }

    /// Livery first — "Delta Air Lines" identifies a flight far better than
    /// "Airbus A320-200" does — falling back to the airframe.
    var operatorLabel: String? {
        if let livery = liveryName?.trimmed, !livery.isEmpty, livery.lowercased() != "generic" {
            return livery
        }
        return aircraftName?.trimmed
    }

    /// Where this aircraft will be `seconds` from its last position report,
    /// assuming it holds its heading, speed and vertical rate.
    ///
    /// The backend ticks every ~15 s. Without this the map would be a slideshow;
    /// with it, aircraft move continuously and land within a few hundred metres
    /// of where the next real report puts them. Extrapolation is capped by the
    /// caller — see `LiveTrafficStore.maxExtrapolationSeconds` — so a flight
    /// whose reports have stopped parks itself instead of flying off the map.
    func advanced(by seconds: TimeInterval) -> Flight {
        guard seconds > 0, position.gsKt > 1 else { return self }

        let distanceNm = position.gsKt * (seconds / 3600)
        let headingRad = position.headingDeg * .pi / 180
        let latRad = position.lat * .pi / 180

        // One nautical mile is one minute of latitude; a minute of longitude
        // shrinks by cos(latitude). Flat-earth is accurate to metres over the
        // couple of nautical miles a 15-second tick covers.
        let deltaLat = distanceNm * cos(headingRad) / 60
        let cosLat = cos(latRad)
        let deltaLon = abs(cosLat) < 0.01 ? 0 : distanceNm * sin(headingRad) / (60 * cosLat)

        var moved = self
        moved.position.lat = (position.lat + deltaLat).clamped(to: -90...90)
        moved.position.lon = (position.lon + deltaLon).wrappedLongitude
        moved.position.altFt = max(0, position.altFt + position.vsFpm * (seconds / 60))
        return moved
    }

    struct Position: Equatable, Sendable {
        var lat: Double
        var lon: Double
        var altFt: Double
        var gsKt: Double
        var vsFpm: Double
        var headingDeg: Double
        var lastReport: Date?
    }
}

// MARK: - Decoding

extension Flight: Decodable {
    private enum CodingKeys: String, CodingKey {
        case flightId, callsign, username, userId, position, aircraft
        case departureIcao, arrivalIcao, pilotState
    }

    private enum AircraftKeys: String, CodingKey {
        case aircraftName, liveryName, registration
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        position = try container.decode(Position.self, forKey: .position)
        callsign = (try? container.decode(String.self, forKey: .callsign))?.trimmed ?? "UNKNOWN"

        // Every flight the backend sends carries a flightId, but the map keys
        // off `id` and duplicate keys would make annotations flicker, so fall
        // back to something stable rather than to a shared empty string.
        if let flightId = container.lenientString(forKey: .flightId), !flightId.isEmpty {
            id = flightId
        } else {
            id = "\(callsign)@\(position.lat),\(position.lon)"
        }

        username = try? container.decode(String.self, forKey: .username)
        userId = try? container.decode(String.self, forKey: .userId)
        departureIcao = try? container.decode(String.self, forKey: .departureIcao)
        arrivalIcao = try? container.decode(String.self, forKey: .arrivalIcao)
        pilotState = container.lenientInt(forKey: .pilotState)

        if let aircraft = try? container.nestedContainer(keyedBy: AircraftKeys.self, forKey: .aircraft) {
            aircraftName = try? aircraft.decode(String.self, forKey: .aircraftName)
            liveryName = try? aircraft.decode(String.self, forKey: .liveryName)
            registration = try? aircraft.decode(String.self, forKey: .registration)
        } else {
            aircraftName = nil
            liveryName = nil
            registration = nil
        }
    }
}

extension Flight.Position: Decodable {
    private enum CodingKeys: String, CodingKey {
        case lat, lon
        case altFt = "alt_ft"
        case gsKt = "gs_kt"
        case vsFpm = "vs_fpm"
        case headingDeg = "heading_deg"
        case lastReportMs, lastReport
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Coordinates are the one thing a flight cannot be rendered without, so
        // this is the only place decoding is allowed to fail.
        guard let lat = container.lenientDouble(forKey: .lat),
              let lon = container.lenientDouble(forKey: .lon),
              lat.isFinite, lon.isFinite, abs(lat) <= 90, abs(lon) <= 180
        else {
            throw DecodingError.dataCorruptedError(
                forKey: .lat, in: container, debugDescription: "Flight has no usable coordinate"
            )
        }
        self.lat = lat
        self.lon = lon
        altFt = container.lenientDouble(forKey: .altFt) ?? 0
        gsKt = container.lenientDouble(forKey: .gsKt) ?? 0
        vsFpm = container.lenientDouble(forKey: .vsFpm) ?? 0
        headingDeg = container.lenientDouble(forKey: .headingDeg) ?? 0

        // The delta stream sends epoch milliseconds; the REST endpoint sends an
        // ISO-8601 string for the same instant. Accept both, like the web app.
        if let ms = container.lenientDouble(forKey: .lastReportMs) {
            lastReport = Date(timeIntervalSince1970: ms / 1000)
        } else if let ms = container.lenientDouble(forKey: .lastReport) {
            lastReport = Date(timeIntervalSince1970: ms / 1000)
        } else if let iso = try? container.decode(String.self, forKey: .lastReport) {
            lastReport = ISO8601DateFormatter.flexible.date(from: iso)
        } else {
            lastReport = nil
        }
    }
}

/// The `/flights/:sessionId` response, which has been seen as a bare array, as
/// `{ flights: [...] }` and as `{ data: [...] }`. `old/flight.js:9571` accepts
/// all three; so does this.
struct FlightsPayload: Decodable {
    let flights: [Flight]

    private enum CodingKeys: String, CodingKey { case flights, data, results }

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let array = try? single.decode(LossyArray<Flight>.self) {
            flights = array.elements
            return
        }

        // Assigned once, after the loop: definite initialization will not let a
        // `let` be written inside a loop body.
        var found: [Flight] = []
        let container = try decoder.container(keyedBy: CodingKeys.self)
        for key in [CodingKeys.flights, .data, .results] {
            if let array = try? container.decode(LossyArray<Flight>.self, forKey: key) {
                found = array.elements
                break
            }
        }
        flights = found
    }
}
