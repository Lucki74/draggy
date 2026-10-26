import SwiftUI

public struct TerminalPane: View {
    @State private var sessions: [ShellSession] = []
    @State private var selectedId: UUID?

    public init() {}

    public var body: some View {
        VStack(spacing: 0) {
            TerminalTabs(
                sessions: $sessions,
                selectedId: $selectedId,
                onNewSession: {
                    let newSession = ShellSession()
                    sessions.append(newSession)
                    selectedId = newSession.id
                },
                onCloseSession: { id in
                    if let index = sessions.firstIndex(where: { $0.id == id }) {
                        sessions[index].terminate()
                        sessions.remove(at: index)
                        if selectedId == id {
                            selectedId = sessions.last?.id
                        }
                    }
                }
            )

            Divider()

            if let activeSession = sessions.first(where: { $0.id == selectedId }) {
                TerminalView(session: activeSession)
            } else {
                VStack(spacing: 12) {
                    Text("No terminal sessions open")
                        .foregroundStyle(.secondary)
                    Button("Open Terminal") {
                        let session = ShellSession()
                        sessions.append(session)
                        selectedId = session.id
                    }
                    .buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black.opacity(0.92))
            }
        }
        .onAppear {
            if sessions.isEmpty {
                let session = ShellSession()
                sessions.append(session)
                selectedId = session.id
            }
        }
    }
}
