import DraggyCore
import SwiftUI

@main
struct DraggyApp: App {
    @State private var model = AppModel()

    init() {
        // The core writes its own log files here; Swift code logs through OSLog (see Log.swift).
        guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        let folder = library.appendingPathComponent("Logs/Draggy", isDirectory: true)
        if initLogging(dir: folder.path) {
            Log.app.info("core logs in \(folder.path, privacy: .public)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
        }
        Settings {
            TabView {
                SettingsView(model: model)
                    .tabItem { Label("General", systemImage: "gearshape") }
                ModelsView(models: model.models)
                    .tabItem { Label("Models", systemImage: "square.stack.3d.up") }
                SkillsView(skills: model.skills)
                    .tabItem { Label("Skills", systemImage: "sparkles") }
                McpView(mcp: model.mcp)
                    .tabItem { Label("Servers", systemImage: "server.rack") }
            }
            .frame(width: 520, height: 560)
        }
    }
}
