import SwiftUI

public struct PaletteCommand: Identifiable, Sendable {
    public let id: String
    public let title: String
    public let icon: String
    public let action: @Sendable () -> Void

    public init(id: String = UUID().uuidString, title: String, icon: String, action: @escaping @Sendable () -> Void) {
        self.id = id
        self.title = title
        self.icon = icon
        self.action = action
    }
}

public struct CommandPaletteView: View {
    @State private var query: String = ""
    public let commands: [PaletteCommand]
    public let onDismiss: () -> Void

    public init(commands: [PaletteCommand], onDismiss: @escaping () -> Void) {
        self.commands = commands
        self.onDismiss = onDismiss
    }

    public var filteredCommands: [PaletteCommand] {
        if query.isEmpty { return commands }
        return commands.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Type a command...", text: $query)
                    .textFieldStyle(.plain)
                    .font(.body)
            }
            .padding(12)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(filteredCommands) { cmd in
                        Button {
                            cmd.action()
                            onDismiss()
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: cmd.icon)
                                    .frame(width: 20)
                                Text(cmd.title)
                                    .font(.body)
                                Spacer()
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(6)
            }
        }
        .frame(width: 480, height: 300)
        .background(Color(nsColor: .windowBackgroundColor))
        .cornerRadius(12)
        .shadow(radius: 16)
    }
}
