import Foundation
import Observation

/// What the window shows besides the conversation, shared by the views and the menu bar commands.
@MainActor
@Observable
final class ShellState {
    /// What fills the main column. Files, review, browser, terminal and plan open in the side panel.
    enum Page: Hashable {
        case chat, search, canvas, images, extensions, stats, talk, diagnostics
    }

    private enum Key {
        static let sidebarOpen = "sidebarOpen"
        static let sidebarWidth = "sidebarWidth"
        static let dock = "dockLayout"
    }

    /// The Windows sidebar limits, in points.
    static let sidebarWidths: ClosedRange<Double> = 220...360

    @ObservationIgnored private let defaults: UserDefaults

    var page: Page = .chat
    var isSearching = false

    var sidebarOpen: Bool {
        didSet { defaults.set(sidebarOpen, forKey: Key.sidebarOpen) }
    }

    var sidebarWidth: Double {
        didSet { defaults.set(sidebarWidth, forKey: Key.sidebarWidth) }
    }

    /// The side panel on the right, remembered between launches.
    var dock: DockLayout {
        didSet {
            guard dock != oldValue, let data = try? JSONEncoder().encode(dock) else { return }
            defaults.set(data, forKey: Key.dock)
        }
    }

    /// Opens a pane in the side panel and goes back to the chat beside it.
    func open(_ pane: DockPane) {
        dock.open(pane)
        page = .chat
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        sidebarOpen = defaults.object(forKey: Key.sidebarOpen) as? Bool ?? true
        let width = defaults.object(forKey: Key.sidebarWidth) as? Double ?? 264
        sidebarWidth = min(max(width, Self.sidebarWidths.lowerBound), Self.sidebarWidths.upperBound)
        dock = defaults.data(forKey: Key.dock).flatMap { try? JSONDecoder().decode(DockLayout.self, from: $0) }
            ?? DockLayout()
    }
}
