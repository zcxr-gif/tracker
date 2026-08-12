import SwiftUI

/// Expert / Training / Casual. Switching clears the map and re-polls, because
/// the aircraft on one server are not on another.
struct ServerPickerSheet: View {
    @EnvironmentObject private var store: LiveTrafficStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if store.sessions.isEmpty {
                    Section {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Loading servers…").foregroundStyle(.secondary)
                        }
                    }
                }

                ForEach(store.sessions) { session in
                    Button {
                        store.select(session)
                        dismiss()
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(session.name)
                                    .font(.body.weight(.medium))
                                    .foregroundStyle(.primary)
                                if let subtitle = occupancy(for: session) {
                                    Text(subtitle)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if session.id == store.selectedSession?.id {
                                Image(systemName: "checkmark")
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(Color.accentColor)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func occupancy(for session: Session) -> String? {
        guard let users = session.userCount else { return nil }
        if let capacity = session.maxUsers, capacity > 0 {
            return "\(users) of \(capacity) pilots online"
        }
        return "\(users) pilots online"
    }
}
