import SwiftUI

/// Everything the bare-bones tracker knows about one aircraft.
///
/// Reads `store.selectedFlight`, which the store re-projects every second, so
/// the altitude and speed here tick along with the marker on the map instead of
/// freezing at whatever the last poll returned.
struct FlightDetailSheet: View {
    @EnvironmentObject private var store: LiveTrafficStore
    let onLocate: (Flight) -> Void

    var body: some View {
        NavigationStack {
            Group {
                if let flight = store.selectedFlight {
                    content(for: flight)
                } else {
                    ContentUnavailableView(
                        "Flight ended",
                        systemImage: "airplane.arrival",
                        description: Text("This aircraft is no longer on the server.")
                    )
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { store.selectedFlightID = nil }
                }
            }
        }
    }

    private func content(for flight: Flight) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header(for: flight)
                telemetry(for: flight)
                details(for: flight)
            }
            .padding(.horizontal, 20)
            .padding(.top, 4)
            .padding(.bottom, 28)
        }
    }

    // MARK: - Sections

    private func header(for flight: Flight) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(flight.callsign)
                    .font(.title2.weight(.bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)

                if let state = Format.pilotState(flight.pilotState) {
                    Text(state)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(Color.secondary.opacity(0.18), in: Capsule())
                }

                Spacer(minLength: 0)

                Button {
                    onLocate(flight)
                } label: {
                    Label("Centre", systemImage: "scope")
                        .font(.footnote.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
            }

            if let route = flight.route {
                Text(route)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func telemetry(for flight: Flight) -> some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 2),
            spacing: 10
        ) {
            metric("Altitude", Format.altitude(flight.position.altFt), "arrow.up.to.line")
            metric("Ground speed", Format.speed(flight.position.gsKt), "speedometer")
            metric("Vertical speed", Format.verticalSpeed(flight.position.vsFpm), "arrow.up.arrow.down")
            metric("Heading", Format.heading(flight.position.headingDeg), "location.north.line")
        }
    }

    private func metric(_ label: String, _ value: String, _ symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(label, systemImage: symbol)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
                .labelStyle(.titleAndIcon)
            Text(value)
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder
    private func details(for flight: Flight) -> some View {
        VStack(spacing: 0) {
            row("Pilot", flight.username)
            row("Aircraft", flight.aircraftName)
            row("Livery", flight.liveryName)
            row("Registration", flight.registration)
            row("Position", coordinateText(for: flight))
            row("Last report", Format.relative(flight.position.lastReport))
        }
        .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder
    private func row(_ label: String, _ value: String?) -> some View {
        if let value, !value.trimmed.isEmpty {
            HStack(alignment: .firstTextBaseline) {
                Text(label)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 12)
                Text(value)
                    .font(.subheadline.weight(.medium))
                    .multilineTextAlignment(.trailing)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(Color.secondary.opacity(0.15))
                    .frame(height: 0.5)
                    .padding(.leading, 14)
            }
        }
    }

    private func coordinateText(for flight: Flight) -> String {
        String(
            format: "%.3f%@, %.3f%@",
            abs(flight.position.lat), flight.position.lat >= 0 ? "°N" : "°S",
            abs(flight.position.lon), flight.position.lon >= 0 ? "°E" : "°W"
        )
    }
}
