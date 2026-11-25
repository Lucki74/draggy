import Foundation

/// A tab the side panel can hold, as the Windows dock offers them.
enum DockPane: String, Codable, CaseIterable, Sendable {
    case plan, files, diff, browser, terminal

    var glyph: Glyph {
        switch self {
        case .plan: .check
        case .files: .folderSimple
        case .diff: .gitDiff
        case .browser: .globeSimple
        case .terminal: .terminalWindow
        }
    }

    var title: String {
        switch self {
        case .plan: String(localized: "Plan")
        case .files: String(localized: "Project files")
        case .diff: String(localized: "Review")
        case .browser: String(localized: "Browser")
        case .terminal: String(localized: "Terminal")
        }
    }
}

/// The side panel's tabs, split and width: the pure rules of win/src/app/dockLayout.ts.
struct DockLayout: Codable, Equatable, Sendable {
    static let widths: ClosedRange<Double> = 260...1200
    static let defaultWidth: Double = 500

    var panes: [DockPane] = []
    var active: DockPane?
    /// A second tab shown under the active one.
    var split: DockPane?
    var width: Double = DockLayout.defaultWidth
    /// Tabs shown over the whole chat area. Each tab keeps its own choice.
    var maximized: Set<DockPane> = []

    var isOpen: Bool { !panes.isEmpty && active != nil }

    var isMaximized: Bool { active.map { maximized.contains($0) } ?? false }

    /// Adds the tab if it is not there and brings it forward, or shows it under the active one.
    mutating func open(_ pane: DockPane, split asSplit: Bool = false) {
        if !panes.contains(pane) { panes.append(pane) }
        if asSplit, let active, active != pane {
            split = pane
            return
        }
        active = pane
        if split == pane { split = nil }
    }

    /// Removes the tab. The one after it, or else the one before, becomes active.
    mutating func close(_ pane: DockPane) {
        guard let index = panes.firstIndex(of: pane) else { return }
        panes.remove(at: index)
        if active == pane {
            active = panes.indices.contains(index) ? panes[index] : panes.last
        }
        if split == pane || split == active { split = nil }
        maximized.remove(pane)
    }

    mutating func move(from: Int, to: Int) {
        guard panes.indices.contains(from), panes.indices.contains(to), from != to else { return }
        let pane = panes.remove(at: from)
        panes.insert(pane, at: to)
    }

    /// Splits with the first other tab, or joins the two halves again.
    mutating func toggleSplit() {
        if split != nil {
            split = nil
        } else {
            split = panes.first { $0 != active }
        }
    }

    mutating func setWidth(_ value: Double) {
        width = min(max(value.rounded(), Self.widths.lowerBound), Self.widths.upperBound)
    }

    mutating func toggleMaximized(_ pane: DockPane) {
        if maximized.contains(pane) { maximized.remove(pane) } else { maximized.insert(pane) }
    }
}
