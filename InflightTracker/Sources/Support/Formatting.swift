import Foundation

/// Aviation-shaped number formatting. Altitudes read as flight levels above the
/// transition altitude and as feet below it, which is how pilots say them.
enum Format {
    /// Configured once and only ever read from. Formatting is thread-safe.
    private static let grouped: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter
    }()

    static func integer(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        return grouped.string(from: NSNumber(value: value.rounded())) ?? "—"
    }

    /// "FL350" above 18 000 ft, "8,200 ft" below it.
    static func altitude(_ feet: Double) -> String {
        guard feet.isFinite else { return "—" }
        if feet >= 18_000 {
            return String(format: "FL%03d", Int((feet / 100).rounded()))
        }
        return "\(integer(max(0, feet))) ft"
    }

    static func speed(_ knots: Double) -> String {
        "\(integer(max(0, knots))) kt"
    }

    /// Vertical speed always carries its sign — the sign is the whole point.
    static func verticalSpeed(_ fpm: Double) -> String {
        guard fpm.isFinite else { return "—" }
        let rounded = fpm.rounded()
        if abs(rounded) < 50 { return "level" }
        return "\(rounded > 0 ? "+" : "−")\(integer(abs(rounded))) fpm"
    }

    static func heading(_ degrees: Double) -> String {
        guard degrees.isFinite else { return "—" }
        var normalised = degrees.truncatingRemainder(dividingBy: 360)
        if normalised < 0 { normalised += 360 }
        return String(format: "%03.0f°", normalised)
    }

    /// "just now", "40s ago", "3m ago" — for the last position report.
    static func relative(_ date: Date?, now: Date = Date()) -> String {
        guard let date else { return "unknown" }
        let seconds = Int(now.timeIntervalSince(date))
        switch seconds {
        case ..<5: return "just now"
        case ..<60: return "\(seconds)s ago"
        case ..<3600: return "\(seconds / 60)m ago"
        default: return "\(seconds / 3600)h ago"
        }
    }

    static func pilotState(_ state: Int?) -> String? {
        switch state {
        case 1: return "Away"
        case 2: return "Parked"
        default: return nil
        }
    }
}
