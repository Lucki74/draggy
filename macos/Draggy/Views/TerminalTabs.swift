import SwiftUI

public struct TerminalTabs: View {
    @Binding var sessions: [ShellSession]
    @Binding var selectedId: UUID?
    let onNewSession: () -> Void
    let onCloseSession: (UUID) -> Void

    public init(
        sessions: Binding<[ShellSession]>,
        selectedId: Binding<UUID?>,
        onNewSession: @escaping () -> Void,
        onCloseSession: @escaping (UUID) -> Void
    ) {
        self._sessions = sessions
        self._selectedId = selectedId
        self.onNewSession = onNewSession
        self.onCloseSession = onCloseSession
    }

    public var body: some View {
        HStack(spacing: 4) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 2) {
                    ForEach(sessions) { session in
                        HStack(spacing: 6) {
                            Circle()
                                .fill(session.isRunning ? Color.green : Color.gray)
                                .frame(width: 7, height: 7)
                            Text(session.shell.name)
                                .font(.caption)
                                .lineLimit(1)
                            if sessions.count > 1 {
                                Button {
                                    onCloseSession(session.id)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9, weight: .bold))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(selectedId == session.id ? Color.accentColor.opacity(0.18) : Color.clear)
                        .cornerRadius(6)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            selectedId = session.id
                        }
                    }
                }
            }

            Spacer()

            Button(action: onNewSession) {
                Image(systemName: "plus")
                    .font(.caption)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 8)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color(nsColor: .controlBackgroundColor))
    }
}
