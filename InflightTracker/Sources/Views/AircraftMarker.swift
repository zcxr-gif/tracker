import SwiftUI

/// A single aircraft on the map.
///
/// Kept deliberately cheap — up to 300 of these are laid out every second, so
/// there is no shadow, no gradient and no material behind the unselected state.
struct AircraftMarker: View {
    let flight: Flight
    let isSelected: Bool

    var body: some View {
        ZStack {
            if isSelected {
                Circle()
                    .fill(Color.accentColor.opacity(0.25))
                    .frame(width: 38, height: 38)
                Circle()
                    .strokeBorder(Color.accentColor, lineWidth: 2)
                    .frame(width: 38, height: 38)
            }

            Image(systemName: "airplane")
                .font(.system(size: isSelected ? 17 : 14, weight: .black))
                .foregroundStyle(isSelected ? Color.accentColor : AltitudePalette.color(for: flight))
                // SF Symbol "airplane" points east, headings are measured from
                // north, hence the 90° offset.
                .rotationEffect(.degrees(flight.position.headingDeg - 90))
                .shadow(color: .black.opacity(isSelected ? 0.5 : 0), radius: 3)
        }
        // Give the tap target some slack — a 14pt glyph is a hard thing to hit.
        .frame(width: 44, height: 44)
        .contentShape(Rectangle())
        .accessibilityLabel(Text(flight.callsign))
    }
}

/// Altitude banding, the convention every flight tracker uses: aircraft on or
/// near the ground read warm, cruising traffic reads cool.
enum AltitudePalette {
    static func color(for flight: Flight) -> Color {
        if flight.isOnGround { return Color(red: 0.62, green: 0.64, blue: 0.68) }

        switch flight.position.altFt {
        case ..<10_000: return Color(red: 0.98, green: 0.76, blue: 0.20)
        case ..<20_000: return Color(red: 0.97, green: 0.55, blue: 0.20)
        case ..<30_000: return Color(red: 0.42, green: 0.78, blue: 0.45)
        case ..<40_000: return Color(red: 0.30, green: 0.68, blue: 0.95)
        default: return Color(red: 0.66, green: 0.55, blue: 0.98)
        }
    }

    /// Legend rows, top of the band downwards. A struct rather than a tuple
    /// because `ForEach` needs a key path, and key paths cannot address tuple
    /// elements.
    struct LegendEntry: Identifiable {
        let label: String
        let color: Color
        var id: String { label }
    }

    static let legend: [LegendEntry] = [
        LegendEntry(label: "FL400+", color: Color(red: 0.66, green: 0.55, blue: 0.98)),
        LegendEntry(label: "FL300–400", color: Color(red: 0.30, green: 0.68, blue: 0.95)),
        LegendEntry(label: "FL200–300", color: Color(red: 0.42, green: 0.78, blue: 0.45)),
        LegendEntry(label: "FL100–200", color: Color(red: 0.97, green: 0.55, blue: 0.20)),
        LegendEntry(label: "Below FL100", color: Color(red: 0.98, green: 0.76, blue: 0.20)),
        LegendEntry(label: "On ground", color: Color(red: 0.62, green: 0.64, blue: 0.68)),
    ]
}
