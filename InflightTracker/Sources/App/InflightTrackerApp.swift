import SwiftUI

@main
struct InflightTrackerApp: App {
    @StateObject private var store = LiveTrafficStore()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            MapScreen()
                .environmentObject(store)
        }
        .onChange(of: scenePhase) { _, phase in
            // Polling a live-traffic API from the background burns battery for
            // a map nobody is looking at.
            switch phase {
            case .active: store.start()
            case .background: store.stop()
            default: break
            }
        }
    }
}
