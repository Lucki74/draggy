import SwiftUI

public struct ExtensionsPanelView: View {
    @State private var store = ExtensionStore()
    @State private var selectedTab: Int = 0

    public init() {}

    public var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $selectedTab) {
                Text("Skills").tag(0)
                Text("Remote Servers").tag(1)
            }
            .pickerStyle(.segmented)
            .padding(10)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            if selectedTab == 0 {
                SkillsTabView(store: store)
            } else {
                RemoteServersView(store: store)
            }
        }
    }
}
