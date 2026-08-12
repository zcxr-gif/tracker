import MapKit
import SwiftUI

/// The whole app: a map, the live traffic on it, and the controls needed to
/// choose a server, find a flight and read one.
struct MapScreen: View {
    @EnvironmentObject private var store: LiveTrafficStore

    @State private var camera: MapCameraPosition = .region(.initialWorldView)
    @State private var mapStyleMode: MapStyleMode = .standard
    /// One sheet enum rather than several `.sheet` modifiers on one view —
    /// stacked sheet modifiers on the same view do not reliably coexist.
    @State private var activeSheet: ActiveSheet?
    @State private var showLegend = false
    /// Lets `MapUserLocationButton` live in my own control stack instead of in
    /// `.mapControls`, whose default placement is the top-trailing corner —
    /// exactly where the search button is.
    @Namespace private var mapScope

    var body: some View {
        // A ZStack rather than `.overlay` on the map: the map ignores the safe
        // area, and overlays attached to it would inherit that and slide under
        // the notch and the home indicator.
        ZStack(alignment: .top) {
            Map(position: $camera, scope: mapScope) {
                ForEach(store.visibleFlights) { flight in
                    Annotation(flight.callsign, coordinate: flight.coordinate, anchor: .center) {
                        AircraftMarker(flight: flight, isSelected: flight.id == store.selectedFlightID)
                            .onTapGesture { store.selectedFlightID = flight.id }
                    }
                    .annotationTitles(.hidden)
                }
                UserAnnotation()
            }
            .trackerMapStyle(mapStyleMode)
            // Recording the region is cheap; the store re-culls on its own 1 Hz
            // tick rather than on every frame of a pan.
            .onMapCameraChange(frequency: .continuous) { context in
                store.setRegion(context.region)
            }
            .ignoresSafeArea()

            statusBar
                .frame(maxHeight: .infinity, alignment: .top)
            controlStack
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            legendPanel
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        }
        .mapScope(mapScope)
        .sheet(item: $activeSheet, onDismiss: { handleSheetDismiss() }) { sheet in
            sheetContent(for: sheet)
        }
        .onChange(of: store.selectedFlightID) { _, id in
            activeSheet = id == nil ? nil : .flight
        }
        .task { store.start() }
    }

    // MARK: - Status bar

    private var statusBar: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                // Padding and background belong inside the label: applied to
                // the Button itself they would grow the frame without growing
                // the tappable area.
                Button { activeSheet = .servers } label: {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 8, height: 8)
                        Text(store.selectedSession?.shortName ?? "Loading")
                            .font(.subheadline.weight(.semibold))
                        Image(systemName: "chevron.down")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(.regularMaterial, in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)

                Spacer(minLength: 0)

                Button { activeSheet = .search } label: {
                    Image(systemName: "magnifyingglass")
                        .font(.subheadline.weight(.semibold))
                        .frame(width: 38, height: 38)
                        .background(.regularMaterial, in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 6) {
                Text(trafficSummary)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.regularMaterial, in: Capsule())
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 6)
    }

    private var statusColor: Color {
        switch store.state {
        case .live: return isStale ? .orange : .green
        case .loading, .idle: return .yellow
        case .failed: return .red
        }
    }

    /// The poll runs every 15 s; nothing for three of those means the picture
    /// on screen is no longer live, whatever the last request returned.
    private var isStale: Bool {
        guard let last = store.lastSnapshotAt else { return true }
        return Date().timeIntervalSince(last) > 45
    }

    private var trafficSummary: String {
        if case .failed(let message) = store.state {
            return store.totalFlightCount > 0 ? "\(message) · showing last known" : message
        }
        let total = store.totalFlightCount
        guard total > 0 else {
            return store.state == .live ? "No traffic" : "Loading traffic…"
        }
        let shown = store.visibleFlights.count
        return shown < total
            ? "\(shown) of \(total) aircraft · zoom in for more"
            : "\(total) aircraft"
    }

    // MARK: - Controls

    private var controlStack: some View {
        VStack(spacing: 10) {
            MapUserLocationButton(scope: mapScope)
                .buttonBorderShape(.circle)
            circleButton(mapStyleMode.iconName) {
                mapStyleMode = mapStyleMode.next
            }
            circleButton(store.showsParkedAircraft ? "parkingsign.circle.fill" : "parkingsign.circle") {
                store.setShowParkedAircraft(!store.showsParkedAircraft)
            }
            circleButton(showLegend ? "list.bullet.circle.fill" : "list.bullet.circle") {
                withAnimation(.easeInOut(duration: 0.2)) { showLegend.toggle() }
            }
            circleButton("arrow.clockwise") {
                store.refresh()
            }
        }
        .padding(.trailing, 14)
        .padding(.bottom, 14)
    }

    private func circleButton(_ systemName: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 42, height: 42)
                .background(.regularMaterial, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var legendPanel: some View {
        if showLegend {
            VStack(alignment: .leading, spacing: 5) {
                ForEach(AltitudePalette.legend) { entry in
                    HStack(spacing: 7) {
                        Circle().fill(entry.color).frame(width: 8, height: 8)
                        Text(entry.label).font(.caption2)
                    }
                }
            }
            .padding(10)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.leading, 14)
            .padding(.bottom, 14)
            .transition(.opacity)
        }
    }

    // MARK: - Sheets

    private enum ActiveSheet: Int, Identifiable {
        case servers, search, flight
        var id: Int { rawValue }
    }

    @ViewBuilder
    private func sheetContent(for sheet: ActiveSheet) -> some View {
        switch sheet {
        case .servers:
            ServerPickerSheet()
                .environmentObject(store)
                .presentationDetents([.medium])

        case .search:
            // Selecting a result flips `selectedFlightID`, and `onChange` swaps
            // this sheet for the detail one — a single state change rather than
            // a dismiss-then-present race.
            SearchSheet { flight in
                focus(on: flight, andSelect: true)
            }
            .environmentObject(store)
            .presentationDetents([.large])

        case .flight:
            FlightDetailSheet(onLocate: { flight in focus(on: flight, andSelect: false) })
                .environmentObject(store)
                .presentationDetents([.height(300), .large])
                // Leaves the map pannable underneath while the sheet is at its
                // small detent, so the aircraft stays watchable.
                .presentationBackgroundInteraction(.enabled(upThrough: .height(300)))
        }
    }

    private func handleSheetDismiss() {
        // Closing the detail sheet is how the user deselects.
        if store.selectedFlightID != nil, activeSheet == nil {
            store.selectedFlightID = nil
        }
    }

    private func focus(on flight: Flight, andSelect select: Bool) {
        if select { store.selectedFlightID = flight.id }
        // Zoom only if the user is further out than this; otherwise keep the
        // zoom they chose and just recentre.
        let span = MKCoordinateSpan(latitudeDelta: 1.6, longitudeDelta: 1.6)
        withAnimation(.easeInOut(duration: 0.45)) {
            camera = .region(MKCoordinateRegion(center: flight.coordinate, span: span))
        }
    }
}

// MARK: - Map style

enum MapStyleMode: CaseIterable {
    case standard, hybrid, satellite

    var iconName: String {
        switch self {
        case .standard: return "map"
        case .hybrid: return "globe.americas"
        case .satellite: return "globe.americas.fill"
        }
    }

    var next: MapStyleMode {
        let all = Self.allCases
        let index = all.firstIndex(of: self) ?? 0
        return all[(index + 1) % all.count]
    }
}

extension View {
    /// `MapStyle` is a protocol, so the three styles have three different
    /// concrete types and cannot come back from one computed property. A
    /// `@ViewBuilder` switch is the way to pick between them.
    @ViewBuilder
    func trackerMapStyle(_ mode: MapStyleMode) -> some View {
        switch mode {
        case .standard:
            // Points of interest are noise under a traffic layer.
            mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        case .hybrid:
            mapStyle(.hybrid(elevation: .flat, pointsOfInterest: .excludingAll))
        case .satellite:
            mapStyle(.imagery(elevation: .flat))
        }
    }
}

extension MKCoordinateRegion {
    /// Opens on the North Atlantic, which is where the traffic is at almost
    /// any hour — an empty ocean is a bad first impression.
    static let initialWorldView = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 40, longitude: -30),
        span: MKCoordinateSpan(latitudeDelta: 60, longitudeDelta: 70)
    )
}
