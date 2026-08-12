import Foundation

/// An array that drops elements it cannot decode instead of failing the whole
/// container.
///
/// A thousand-aircraft snapshot with one malformed entry should render 999
/// aircraft, not zero. `Flight` already defaults almost every field, so in
/// practice this only skips entries with no usable coordinate.
struct LossyArray<Element: Decodable>: Decodable {
    let elements: [Element]

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var kept: [Element] = []
        kept.reserveCapacity(container.count ?? 0)

        while !container.isAtEnd {
            let indexBefore = container.currentIndex

            if let element = try? container.decode(Element.self) {
                kept.append(element)
            }

            // JSONDecoder leaves `currentIndex` untouched when a decode throws,
            // so a failed element has to be consumed by something that accepts
            // any JSON value — otherwise this loop never terminates.
            if container.currentIndex == indexBefore {
                _ = try? container.decode(AnyDecodableValue.self)
            }

            // If the container still refuses to advance, stop rather than spin.
            if container.currentIndex == indexBefore { break }
        }

        elements = kept
    }
}

/// Decodes successfully from any JSON value and keeps none of it. Used purely
/// to step over an element that failed to decode.
private struct AnyDecodableValue: Decodable {
    init(from decoder: Decoder) throws {}
}

extension KeyedDecodingContainer {
    /// A number that may arrive as a JSON number or as a numeric string.
    /// Both shapes turn up in this backend's payloads.
    func lenientDouble(forKey key: Key) -> Double? {
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return value }
        if let text = try? decodeIfPresent(String.self, forKey: key) { return Double(text) }
        return nil
    }

    func lenientInt(forKey key: Key) -> Int? {
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = lenientDouble(forKey: key), value.isFinite { return Int(value) }
        return nil
    }
}

extension ISO8601DateFormatter {
    /// The backend's timestamps sometimes carry fractional seconds and
    /// sometimes do not; one formatter cannot parse both.
    ///
    /// `ISO8601DateFormatter` is documented as thread-safe for parsing, and
    /// this instance is never mutated after construction.
    nonisolated(unsafe) static let flexible = FlexibleISO8601()

    struct FlexibleISO8601: @unchecked Sendable {
        private let withFraction: ISO8601DateFormatter = {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return formatter
        }()

        private let plain = ISO8601DateFormatter()

        func date(from string: String) -> Date? {
            withFraction.date(from: string) ?? plain.date(from: string)
        }
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

extension Double {
    /// Keeps a longitude in −180...180 after dead reckoning has walked it past
    /// the antimeridian.
    var wrappedLongitude: Double {
        guard isFinite else { return 0 }
        var value = self
        while value > 180 { value -= 360 }
        while value < -180 { value += 360 }
        return value
    }
}
