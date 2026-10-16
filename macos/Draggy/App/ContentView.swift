import SwiftUI

struct ContentView: View {
    @Bindable var model: AppModel

    var body: some View {
        NavigationSplitView {
            List {
                Label("Chat", systemImage: "bubble.left")
            }
            .navigationSplitViewColumnWidth(min: 160, ideal: 200)
        } detail: {
            ChatView(model: model)
        }
        .frame(minWidth: 720, minHeight: 480)
    }
}
