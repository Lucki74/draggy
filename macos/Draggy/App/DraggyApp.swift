import SwiftUI

@main
struct DraggyApp: App {
    @State private var model = AppModel()

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
            }
            .frame(width: 520, height: 560)
        }
    }
}
