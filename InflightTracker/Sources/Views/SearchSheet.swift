import SwiftUI

/// Find a flight by callsign, pilot, registration, route or operator.
///
/// Searches the whole snapshot rather than what is on screen — the point of a
/// search is to reach the aircraft you cannot currently see.
struct SearchSheet: View {
    @EnvironmentObject private var store: LiveTrafficStore
    @Environment(\.dismiss) private var dismiss

    let onSelect: (Flight) -> Void

    @State private var query = ""
    /// Held in state rather than recomputed in `body`. The store publishes
    /// every second, so a computed property would re-scan the whole snapshot
    /// once a second for a list nobody asked to be re-sorted.
    @State private var results: [Flight] = []

    var body: some View {
        NavigationStack {
            Group {
                if query.trimmed.isEmpty {
                    ContentUnavailableView(
                        "Search live traffic",
                        systemImage: "magnifyingglass",
                        description: Text("Callsign, pilot, registration, or an airport ICAO.")
                    )
                } else if results.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    List(results) { flight in
                        Button {
                            onSelect(flight)
                        } label: {
                            resultRow(flight)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
        .onChange(of: query) { _, newValue in
            results = store.search(newValue)
        }
    }

    private func resultRow(_ flight: Flight) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "airplane")
                .font(.system(size: 13, weight: .black))
                .foregroundStyle(AltitudePalette.color(for: flight))
                .rotationEffect(.degrees(flight.position.headingDeg - 90))
                .frame(width: 26)

            VStack(alignment: .leading, spacing: 2) {
                Text(flight.callsign)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.primary)

                Text(subtitle(for: flight))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Text(Format.altitude(flight.position.altFt))
                .font(.caption.weight(.medium))
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    private func subtitle(for flight: Flight) -> String {
        [flight.username, flight.route, flight.operatorLabel]
            .compactMap { $0?.trimmed }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }
}
