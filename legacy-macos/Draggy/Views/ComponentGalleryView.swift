import SwiftUI

public struct ComponentGalleryView: View {
    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("UI Component Gallery")
                    .font(.title)
                    .fontWeight(.bold)

                GroupBox("Signature Marks") {
                    SignatureView(modelName: "Llama-3.2-3B")
                }

                GroupBox("Dock Panel") {
                    DockPanelView()
                }

                GroupBox("Download Progress") {
                    DownloadProgressBar(progress: 0.65)
                }
            }
            .padding(16)
        }
    }
}
