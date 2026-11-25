import DraggyCore
import OSLog
import SwiftUI

@main
struct DraggyApp: App {
    @State private var model = AppModel()
    @State private var shell = ShellState()

    init() {
        Fonts.register()
        // The core writes its own log files here; Swift code logs through OSLog (see Log.swift).
        guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        let folder = library.appendingPathComponent("Logs/Draggy", isDirectory: true)
        if initLogging(dir: folder.path) {
            Logger.app.info("core logs in \(folder.path, privacy: .public)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView(model: model, shell: shell)
                .onAppear { model.appearance.apply() }
        }
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button(model.mode == .code ? "New session" : "New chat") {
                    shell.page = .chat
                    model.newConversation()
                }
                .keyboardShortcut("n")
                .disabled(model.isRunning)
                Button("Search") { shell.isSearching = true }
                    .keyboardShortcut("k")
            }
            CommandGroup(replacing: .sidebar) {
                Button(shell.sidebarOpen ? "Hide sidebar" : "Show sidebar") {
                    withAnimation(.easeOut(duration: 0.24)) { shell.sidebarOpen.toggle() }
                }
                .keyboardShortcut("b")
                Divider()
                Button("Project files") { shell.open(.files) }
                    .keyboardShortcut("f", modifiers: [.command, .shift])
                Button("Open changes") { shell.open(.diff) }
                    .keyboardShortcut("d", modifiers: [.command, .shift])
                Button("Browser") { shell.open(.browser) }
                    .keyboardShortcut("b", modifiers: [.command, .shift])
                Button("Terminal") { shell.open(.terminal) }
                    .keyboardShortcut("t", modifiers: [.command, .shift])
                Button("Plan") { shell.open(.plan) }
                    .keyboardShortcut("l", modifiers: [.command, .shift])
                Divider()
            }
        }
        Settings {
            TabView {
                SettingsView(model: model)
                    .tabItem { Label("General", systemImage: "gearshape") }
                AppearanceView(appearance: model.appearance)
                    .tabItem { Label("Appearance", systemImage: "paintpalette") }
                ModelsView(models: model.models, engine: model.engine)
                    .tabItem { Label("Models", systemImage: "square.stack.3d.up") }
                SkillsView(skills: model.skills)
                    .tabItem { Label("Skills", systemImage: "sparkles") }
                McpView(mcp: model.mcp)
                    .tabItem { Label("Servers", systemImage: "server.rack") }
            }
            .frame(width: 640, height: 620)
            .tint(model.appearance.accent.color(\.base))
        }
    }
}
