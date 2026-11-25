import AppKit
import DraggyCore
import SwiftUI

/// The Windows dock: a strip of pill tabs over the active pane, with maximize and split on the right.
/// Every open tab stays alive behind the active one, so a terminal or page keeps its state.
struct DockView: View {
    @Bindable var model: AppModel
    @Bindable var shell: ShellState

    /// The panes work in the open project, or in the home folder outside one.
    private var folder: String {
        model.toolFolder.isEmpty ? FileManager.default.homeDirectoryForCurrentUser.path : model.toolFolder
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let split = shell.dock.split {
                VStack(spacing: 0) {
                    stack(excluding: split)
                    Rectangle().fill(Theme.rule).frame(height: 1)
                    PaneHeader(pane: split) { shell.dock.split = nil }
                    content(split)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                stack(excluding: nil)
            }
        }
        .background(Theme.surfaceCanvas)
    }

    private var header: some View {
        HStack(spacing: 4) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(Array(shell.dock.panes.enumerated()), id: \.element) { index, pane in
                        DockTab(
                            pane: pane,
                            isActive: pane == shell.dock.active,
                            onSelect: { shell.dock.open(pane) },
                            onClose: { shell.dock.close(pane) }
                        )
                        .draggable(pane.rawValue)
                        .dropDestination(for: String.self) { items, _ in
                            guard let raw = items.first, let moved = DockPane(rawValue: raw),
                                  let from = shell.dock.panes.firstIndex(of: moved) else { return false }
                            shell.dock.move(from: from, to: index)
                            return true
                        }
                    }
                }
                .padding(.vertical, 4)
            }
            addMenu
            if let active = shell.dock.active {
                let maximized = shell.dock.isMaximized
                IconButton(glyph: maximized ? .arrowsInSimple : .arrowsOutSimple,
                           label: maximized ? String(localized: "Restore") : String(localized: "Maximize"),
                           size: 14) {
                    withAnimation(.easeOut(duration: 0.2)) { shell.dock.toggleMaximized(active) }
                }
            }
            if shell.dock.panes.count > 1 {
                IconButton(glyph: shell.dock.split == nil ? .table : .arrowsInSimple,
                           label: shell.dock.split == nil ? String(localized: "Split pane") : String(localized: "Join panes"),
                           size: 14) { shell.dock.toggleSplit() }
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 36)
        .background(Theme.surfaceBase)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.rule).frame(height: 1) }
    }

    /// The panes not open yet, to add beside the others.
    private var addMenu: some View {
        let closed = DockPane.allCases.filter { !shell.dock.panes.contains($0) }
        return Menu {
            ForEach(closed, id: \.self) { pane in
                Button(pane.title) { shell.dock.open(pane) }
            }
        } label: {
            Icon(glyph: .plus, size: 14)
                .foregroundStyle(Theme.textSecondary)
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .disabled(closed.isEmpty)
        .help("Panes")
        .accessibilityLabel("Panes")
    }

    private func stack(excluding hidden: DockPane?) -> some View {
        ZStack {
            ForEach(shell.dock.panes.filter { $0 != hidden }, id: \.self) { pane in
                let shown = pane == shell.dock.active
                content(pane)
                    .opacity(shown ? 1 : 0)
                    .allowsHitTesting(shown)
                    .accessibilityHidden(!shown)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func content(_ pane: DockPane) -> some View {
        switch pane {
        case .plan:
            PlanPane(model: model)
        case .files:
            FileExplorerPane(initialPath: folder).id(folder)
        case .diff:
            DiffPaneView(workingDirectory: folder).id(folder)
        case .browser:
            BrowserView(browser: model.browser)
        case .terminal:
            TerminalPane(workingDirectory: folder).id(folder)
        }
    }
}

/// One pill in the strip: icon, title, and a close button shown on the active tab or on hover.
private struct DockTab: View {
    let pane: DockPane
    let isActive: Bool
    let onSelect: () -> Void
    let onClose: () -> Void
    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 6) {
            Icon(glyph: pane.glyph, size: 14)
            Text(pane.title)
                .lineLimit(1)
            Button(action: onClose) {
                Icon(glyph: .x, size: 12)
                    .frame(width: 16, height: 16)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.textSecondary)
            .opacity(isActive || isHovered ? 1 : 0)
            .help("Close pane")
            .accessibilityLabel(Text("Close pane") + Text(verbatim: " ") + Text(pane.title))
        }
        .font(.ui(12, .medium))
        .foregroundStyle(isActive || isHovered ? Theme.textPrimary : Theme.textSecondary)
        .padding(.leading, 10)
        .padding(.trailing, 6)
        .frame(height: 28)
        .background(fill, in: Capsule())
        .overlay(Capsule().strokeBorder(isActive ? Theme.ruleControl : .clear))
        .contentShape(Capsule())
        .onTapGesture(perform: onSelect)
        .onHover { isHovered = $0 }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(isActive ? [.isSelected, .isButton] : .isButton)
    }

    private var fill: Color {
        if isActive { return Theme.surfaceCanvas }
        return isHovered ? Theme.surfaceRaised : .clear
    }
}

/// The header over the lower half of a split, as Windows draws PaneHeader.
private struct PaneHeader: View {
    let pane: DockPane
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Icon(glyph: pane.glyph, size: 16)
                .foregroundStyle(Theme.textSecondary)
            Text(pane.title)
                .font(.ui(13, .medium))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
            Spacer()
            IconButton(glyph: .x, label: String(localized: "Close pane"), size: 14, action: onClose)
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
        .background(Theme.surfaceBase)
        .overlay(alignment: .bottom) { Rectangle().fill(Theme.rule).frame(height: 1) }
    }
}

/// The model's plan for this conversation, one row per step, as the Windows plan panel lists it.
private struct PlanPane: View {
    @Bindable var model: AppModel

    var body: some View {
        if model.plan.isEmpty {
            VStack(spacing: 8) {
                Icon(glyph: .check, size: 24)
                    .foregroundStyle(Theme.textTertiary)
                Text("No plan yet")
                    .font(.ui(13))
                    .foregroundStyle(Theme.textSecondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(PlanStrip.progress(model.plan))
                            .font(.ui(12, .medium))
                            .foregroundStyle(Theme.textSecondary)
                        Spacer()
                        Button("Clear plan") { model.clearPlan() }
                            .buttonStyle(.plain)
                            .font(.ui(12))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    ForEach(Array(model.plan.enumerated()), id: \.offset) { _, step in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Icon(glyph: Self.glyph(step.status), size: 14, filled: step.status == "done")
                                .foregroundStyle(step.status == "done" ? Theme.ok : Theme.textSecondary)
                            Text(step.text)
                                .font(.ui(13))
                                .strikethrough(step.status == "done")
                                .foregroundStyle(step.status == "todo" ? Theme.textSecondary : Theme.textPrimary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                .padding(16)
            }
        }
    }

    static func glyph(_ status: String) -> Glyph {
        switch status {
        case "done": .checkCircle
        case "doing", "in_progress": .circleHalf
        default: .circle
        }
    }
}

/// The strip on the panel's left edge: dragging it left widens the panel.
struct DockResizeHandle: View {
    @Binding var width: Double
    @State private var start: Double?
    @State private var isHovered = false

    var body: some View {
        Rectangle()
            .fill(isHovered || start != nil ? Theme.ruleStrong : Theme.rule)
            .frame(width: 1)
            .overlay {
                Color.clear
                    .frame(width: 6)
                    .contentShape(Rectangle())
                    .onHover { hovering in
                        isHovered = hovering
                        if hovering { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
                    }
                    .gesture(
                        DragGesture(minimumDistance: 1, coordinateSpace: .global)
                            .onChanged { drag in
                                let origin = start ?? width
                                start = origin
                                width = min(max(origin - drag.translation.width, DockLayout.widths.lowerBound),
                                            DockLayout.widths.upperBound)
                            }
                            .onEnded { _ in start = nil }
                    )
            }
    }
}
