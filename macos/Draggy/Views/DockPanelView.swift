import SwiftUI

public struct DockPanelView: View {
    public let onSelectChat: () -> Void
    public let onSelectBrowser: () -> Void
    public let onSelectTerminal: () -> Void
    public let onSelectFiles: () -> Void

    public init(
        onSelectChat: @escaping () -> Void = {},
        onSelectBrowser: @escaping () -> Void = {},
        onSelectTerminal: @escaping () -> Void = {},
        onSelectFiles: @escaping () -> Void = {}
    ) {
        self.onSelectChat = onSelectChat
        self.onSelectBrowser = onSelectBrowser
        self.onSelectTerminal = onSelectTerminal
        self.onSelectFiles = onSelectFiles
    }

    public var body: some View {
        HStack(spacing: 8) {
            dockButton(icon: "bubble.left", action: onSelectChat, help: "Chat")
            dockButton(icon: "globe", action: onSelectBrowser, help: "Browser")
            dockButton(icon: "terminal", action: onSelectTerminal, help: "Terminal")
            dockButton(icon: "folder", action: onSelectFiles, help: "Files")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial)
        .clipShape(Capsule())
        .shadow(radius: 6)
    }

    private func dockButton(icon: String, action: @escaping () -> Void, help: String) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .frame(width: 32, height: 32)
        }
        .buttonStyle(.plain)
        .help(help)
    }
}
