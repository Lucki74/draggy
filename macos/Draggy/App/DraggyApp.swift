import SwiftUI

@main
struct DraggyApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
        }
        Settings {
            SettingsView(model: model)
        }
    }
}
