import AppKit
import DraggyCore
import SwiftUI

struct ContentView: View {
    @Bindable var model: AppModel
    @Bindable var shell: ShellState
    /// The window's size, so a sheet over it never grows past it.
    @State private var windowSize = CGSize(width: 1200, height: 800)

    var body: some View {
        Group {
            if model.setup.isShowing {
                SetupView(model: model, setup: model.setup)
            } else {
                shellBody
            }
        }
        .onAppear { model.setup.showIfNeeded(model) }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { windowSize = $0 }
        .sheet(isPresented: $model.isShowingModels) {
            ModelsSheet(model: model)
                .frame(width: max(min(720, windowSize.width - 80), 420),
                       height: max(min(640, windowSize.height - 80), 360))
        }
    }

    private var shellBody: some View {
        VStack(spacing: 0) {
            TitleBar(model: model, shell: shell)
            HStack(spacing: 0) {
                if shell.sidebarOpen {
                    SidebarView(model: model, shell: shell)
                        .frame(width: shell.sidebarWidth)
                        .transition(.move(edge: .leading))
                    SidebarResizeHandle(width: $shell.sidebarWidth)
                }
                workArea
            }
        }
        .ignoresSafeArea(.container, edges: .top)
        .background(Theme.surfaceCanvas)
        .font(.ui(13))
        .foregroundStyle(Theme.textPrimary)
        .tint(model.appearance.accent.color(\.base))
        .frame(minWidth: 720, minHeight: 480)
        .task { await model.updates.check() }
        .task {
            // Tests run inside the app; they must never load the user's real model.
            guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil else { return }
            await model.startEngineIfReady()
        }
        .sheet(isPresented: $shell.isSearching) {
            SearchPalette(model: model, shell: shell)
        }
        .sheet(isPresented: Binding(
            get: { model.pendingApproval != nil },
            set: { shown in if !shown { model.answerApproval(.no) } }
        )) {
            if let request = model.pendingApproval {
                ApprovalSheet(request: request) { model.answerApproval($0) }
            }
        }
    }

    /// The main column with the side panel on its right. A maximized panel covers the column, which
    /// stays mounted underneath so nothing in it restarts.
    private var workArea: some View {
        let maximized = shell.dock.isOpen && shell.dock.isMaximized
        return HStack(spacing: 0) {
            detail
                .frame(maxWidth: maximized ? 0 : .infinity, maxHeight: .infinity)
                .frame(minWidth: maximized ? 0 : 360)
                .background(Theme.surfaceBase)
                .opacity(maximized ? 0 : 1)
                .allowsHitTesting(!maximized)
                .accessibilityHidden(maximized)
            if shell.dock.isOpen {
                if !maximized {
                    DockResizeHandle(width: $shell.dock.width)
                }
                DockView(model: model, shell: shell)
                    .frame(width: maximized ? nil : shell.dock.width)
                    .frame(maxWidth: maximized ? .infinity : nil)
                    .transition(.move(edge: .trailing))
            }
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch shell.page {
        case .chat:
            if model.mode == .code, model.activeProject == nil {
                CodeHome(model: model)
            } else {
                ChatView(model: model)
            }
        case .search:
            SearchView()
        case .canvas:
            CanvasView(store: CanvasStore())
        case .images:
            ImageGenerationView()
        case .extensions:
            ExtensionsPanelView()
        case .stats:
            StatsPanelView(store: model.stats)
        case .talk:
            TalkModeView()
        case .diagnostics:
            DiagnosticsView()
        }
    }
}

/// Code with no project yet: the Windows project picker, reduced to opening a folder.
struct CodeHome: View {
    @Bindable var model: AppModel

    var body: some View {
        VStack(spacing: 16) {
            DragonMark(size: 40)
                .foregroundStyle(Theme.textTertiary)
            Text("Open a project")
                .font(.ui(20, .semibold))
            Text("Code works inside a folder on your computer. Pick one to read, edit and run its files with the model.")
                .font(.ui(13))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            Button {
                let panel = NSOpenPanel()
                panel.canChooseDirectories = true
                panel.canChooseFiles = false
                panel.prompt = String(localized: "Open folder")
                if panel.runModal() == .OK, let url = panel.url { model.addProject(url) }
            } label: {
                HStack(spacing: 6) {
                    Icon(glyph: .folderOpen, size: 16)
                    Text("Open a folder")
                }
                .font(.ui(13, .medium))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .frame(maxWidth: 420)
        .padding(32)
    }
}

/// The core's question about a tool call: what it wants to do, and how long the answer should hold.
struct ApprovalSheet: View {
    let request: ApprovalRecord
    let answer: (ApprovalChoice) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Allow \(request.tool)?")
                .font(.headline)
            if let target = request.target {
                Text(target)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
            }
            Text(request.reason)
                .foregroundStyle(.secondary)
            HStack {
                Button("Don't allow") { answer(.no) }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button("This task") { answer(.task) }
                Button("This workspace") { answer(.workspace) }
                Button("Once") { answer(.once) }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding()
        .frame(width: 520)
    }
}
