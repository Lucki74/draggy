import SwiftUI

public struct UpdateSettingsView: View {
    @State private var channel: String = "stable"
    @State private var autoCheck: Bool = true

    public init() {}

    public var body: some View {
        Form {
            Picker("Update Channel", selection: $channel) {
                Text("Stable").tag("stable")
                Text("Beta").tag("beta")
            }
            Toggle("Check for updates automatically", isOn: $autoCheck)
        }
        .padding(14)
    }
}
