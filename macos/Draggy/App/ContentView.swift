import DraggyCore
import SwiftUI

struct ContentView: View {
    @Bindable var model: AppModel
    @State private var page: Page = .chat

    enum Page: Hashable {
        case chat, browser, terminal, files, search, diff, canvas, images, extensions, stats, talk, diagnostics
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $page) {
                Label("Chat", systemImage: "bubble.left").tag(Page.chat)
                Label("Browser", systemImage: "globe").tag(Page.browser)
                Label("Terminal", systemImage: "terminal").tag(Page.terminal)
                Label("Files", systemImage: "folder").tag(Page.files)
                Label("Search", systemImage: "magnifyingglass").tag(Page.search)
                Label("Diff", systemImage: "arrow.left.and.right").tag(Page.diff)
                Label("Canvas", systemImage: "pencil.and.outline").tag(Page.canvas)
                Label("Images", systemImage: "wand.and.stars").tag(Page.images)
                Label("Extensions", systemImage: "puzzlepiece").tag(Page.extensions)
                Label("Stats", systemImage: "chart.bar").tag(Page.stats)
                Label("Talk", systemImage: "waveform").tag(Page.talk)
                Label("Diagnostics", systemImage: "stethoscope").tag(Page.diagnostics)
                if !model.conversations.isEmpty {
                    Section("History") {
                        ForEach(model.conversations) { item in
                            Button {
                                model.open(item.id)
                                page = .chat
                            } label: {
                                Text(item.title).lineLimit(1)
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button("Delete", role: .destructive) { model.delete(item.id) }
                            }
                            .disabled(model.isRunning)
                        }
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 160, ideal: 200)
        } detail: {
            switch page {
            case .chat:
                ChatView(model: model)
                    .toolbar {
                        ToolbarItem {
                            Button("New chat", systemImage: "square.and.pencil") { model.newConversation() }
                                .disabled(model.isRunning)
                        }
                    }
            case .browser:
                BrowserView(browser: model.browser)
            case .terminal:
                TerminalPane()
            case .files:
                FileExplorerPane()
            case .search:
                SearchView()
            case .diff:
                DiffPaneView()
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
        .frame(minWidth: 720, minHeight: 480)
        .task { await model.updates.check() }
        .sheet(isPresented: Binding(
            get: { model.pendingApproval != nil },
            set: { shown in if !shown { model.answerApproval(.no) } }
        )) {
            if let request = model.pendingApproval {
                ApprovalSheet(request: request) { model.answerApproval($0) }
            }
        }
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
