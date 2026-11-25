import SwiftUI

public struct UpdateProgressView: View {
    public let progress: Double
    public let status: String

    public init(progress: Double, status: String) {
        self.progress = progress
        self.status = status
    }

    public var body: some View {
        VStack(spacing: 8) {
            ProgressView(value: progress, total: 1.0)
            Text(status).font(.caption).foregroundStyle(.secondary)
        }
        .padding(12)
    }
}
