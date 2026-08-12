import Foundation

/// One Infinite Flight multiplayer server, from `GET /if-sessions`.
struct Session: Identifiable, Equatable, Hashable, Decodable, Sendable {
    let id: String
    let name: String
    let userCount: Int?
    let maxUsers: Int?

    private enum CodingKeys: String, CodingKey {
        case id, name, userCount, maxUsers
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = ((try? container.decode(String.self, forKey: .name)) ?? "").trimmed
        userCount = container.lenientInt(forKey: .userCount)
        maxUsers = container.lenientInt(forKey: .maxUsers)
    }

    init(id: String, name: String, userCount: Int? = nil, maxUsers: Int? = nil) {
        self.id = id
        self.name = name
        self.userCount = userCount
        self.maxUsers = maxUsers
    }

    /// "Expert Server" → "Expert". The full names are too long for a pill.
    var shortName: String {
        name.replacingOccurrences(of: " Server", with: "").trimmed
    }

    /// Expert first, then Training, then Casual — the order pilots think in,
    /// which is not the order the API returns.
    var sortRank: Int {
        let lowered = name.lowercased()
        if lowered.contains("expert") { return 0 }
        if lowered.contains("training") { return 1 }
        if lowered.contains("casual") { return 2 }
        return 3
    }
}

struct SessionsPayload: Decodable {
    let sessions: [Session]

    private enum CodingKeys: String, CodingKey { case sessions, data, results }

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let array = try? single.decode(LossyArray<Session>.self), !array.elements.isEmpty {
            sessions = array.elements
            return
        }
        // Assigned once, after the loop: definite initialization will not let a
        // `let` be written inside a loop body.
        var found: [Session] = []
        let container = try decoder.container(keyedBy: CodingKeys.self)
        for key in [CodingKeys.sessions, .data, .results] {
            if let array = try? container.decode(LossyArray<Session>.self, forKey: key) {
                found = array.elements
                break
            }
        }
        sessions = found
    }
}
