import AppKit
import SwiftUI

/// The Windows title bar, drawn in the window's hidden title area: dragon mark, sidebar toggle and
/// project on the left, plan progress and the Views menu on the right, 40 points tall.
struct TitleBar: View {
    static let height: CGFloat = 40
    /// Room for the close, minimise and zoom buttons, which macOS keeps on the left.
    static let windowButtonsWidth: CGFloat = 72

    @Bindable var model: AppModel
    @Bindable var shell: ShellState

    var body: some View {
        HStack(spacing: 8) {
            Color.clear.frame(width: Self.windowButtonsWidth)
            DragonMark(size: 16)
                .foregroundStyle(Theme.textPrimary)
            IconButton(
                glyph: .sidebarSimple,
                label: shell.sidebarOpen ? String(localized: "Hide sidebar") : String(localized: "Show sidebar")
            ) {
                withAnimation(.easeOut(duration: 0.24)) { shell.sidebarOpen.toggle() }
            }
            if model.mode == .code, let project = model.activeProject {
                Text(URL(fileURLWithPath: project).lastPathComponent)
                    .font(.ui(12, .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: 130, alignment: .leading)
                    .help(project)
            }
            Spacer(minLength: 16)
            if !model.plan.isEmpty {
                Button {
                    shell.open(.plan)
                } label: {
                    HStack(spacing: 4) {
                        Icon(glyph: .circleHalf, size: 12)
                        Text(PlanStrip.progress(model.plan))
                            .monospacedDigit()
                    }
                    .font(.ui(11))
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Theme.surfaceTint, in: Capsule())
                    .overlay(Capsule().strokeBorder(Theme.rule))
                }
                .buttonStyle(.plain)
                .help("Plan")
            }
            ViewsMenu(shell: shell)
        }
        .padding(.trailing, 12)
        .frame(height: Self.height)
        .background {
            WindowChrome(barHeight: Self.height)
                .background(Theme.surfaceCanvas)
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.rule).frame(height: 1)
        }
    }
}

/// The bar's empty space: it drags the window, zooms it on a double click, and keeps the window
/// buttons centred in the bar, since AppKit lays them out for its own shorter title bar.
struct WindowChrome: NSViewRepresentable {
    let barHeight: CGFloat

    func makeNSView(context: Context) -> ChromeView {
        ChromeView(barHeight: barHeight)
    }

    func updateNSView(_ view: ChromeView, context: Context) {
        view.alignWindowButtons()
    }

    final class ChromeView: NSView {
        private let barHeight: CGFloat
        private var observers: [NSObjectProtocol] = []

        init(barHeight: CGFloat) {
            self.barHeight = barHeight
            super.init(frame: .zero)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { nil }

        override var mouseDownCanMoveWindow: Bool { true }

        override func mouseDown(with event: NSEvent) {
            if event.clickCount == 2 {
                window?.performZoom(nil)
            } else {
                window?.performDrag(with: event)
            }
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            observers.forEach(NotificationCenter.default.removeObserver)
            observers = []
            guard let window else { return }
            let names: [Notification.Name] = [
                NSWindow.didResizeNotification, NSWindow.didEndLiveResizeNotification,
                NSWindow.didExitFullScreenNotification, NSWindow.didBecomeKeyNotification,
                NSWindow.didResignKeyNotification,
            ]
            for name in names {
                observers.append(NotificationCenter.default.addObserver(
                    forName: name, object: window, queue: .main
                ) { [weak self] _ in
                    MainActor.assumeIsolated { self?.alignWindowButtons() }
                })
            }
            alignWindowButtons()
        }

        func alignWindowButtons() {
            guard let window, !window.styleMask.contains(.fullScreen) else { return }
            var x: CGFloat = 14
            for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
                guard let button = window.standardWindowButton(kind), let container = button.superview else { continue }
                let size = button.frame.size
                let fromTop = (barHeight - size.height) / 2
                let y = container.isFlipped ? fromTop : container.bounds.height - fromTop - size.height
                button.setFrameOrigin(NSPoint(x: x, y: y))
                x += size.width + 6
            }
        }
    }
}

/// The panes and tools, until they move into the docked side panel.
struct ViewsMenu: View {
    @Bindable var shell: ShellState

    var body: some View {
        Menu {
            item(.chat, String(localized: "Chat"))
            Section("Panes") {
                pane(.files)
                pane(.diff)
                pane(.browser)
                pane(.terminal)
                pane(.plan)
            }
            Section("Tools") {
                item(.search, String(localized: "Search files"))
                item(.canvas, String(localized: "Canvas"))
                item(.images, String(localized: "Images"))
                item(.extensions, String(localized: "Extensions"))
                item(.stats, String(localized: "Statistics"))
                item(.diagnostics, String(localized: "Diagnostics"))
            }
        } label: {
            HStack(spacing: 4) {
                Text("Views")
                Icon(glyph: .caretDown, size: 12)
            }
            .font(.ui(12, .medium))
            .foregroundStyle(Theme.textSecondary)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    /// A side panel tab, ticked while it is open there.
    private func pane(_ pane: DockPane) -> some View {
        Toggle(pane.title, isOn: Binding(
            get: { shell.dock.panes.contains(pane) },
            set: { open in
                if open { shell.open(pane) } else { shell.dock.close(pane) }
            }
        ))
    }

    private func item(_ page: ShellState.Page, _ title: String) -> some View {
        Toggle(title, isOn: Binding(get: { shell.page == page }, set: { if $0 { shell.page = page } }))
    }
}
