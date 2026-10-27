import SwiftUI

public struct DownloadProgressBar: View {
    public let progress: Double
    public let label: String

    public init(progress: Double, label: String = "Downloading model...") {
        self.progress = progress
        self.label = label
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text("\(Int(progress * 100))%").font(.caption).fontWeight(.semibold)
            }
            ProgressView(value: progress, total: 1.0)
                .tint(.blue)
        }
    }
}
