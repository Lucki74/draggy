import SwiftUI

public struct UsageChartView: View {
    public let history: [UsageDataPoint]

    public init(history: [UsageDataPoint]) {
        self.history = history
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("TOKEN USAGE OVER TIME")
                .font(.caption2)
                .fontWeight(.bold)
                .foregroundStyle(.secondary)

            if history.isEmpty {
                Text("No session token history yet")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .frame(height: 80)
            } else {
                let maxTokens = max(1, history.map(\.totalTokens).max() ?? 1)
                HStack(alignment: .bottom, spacing: 6) {
                    ForEach(history) { point in
                        VStack(spacing: 2) {
                            let ratio = CGFloat(point.totalTokens) / CGFloat(maxTokens)
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color.accentColor.gradient)
                                .frame(height: max(4, ratio * 70))

                            Text(point.label)
                                .font(.system(size: 8))
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 90)
            }
        }
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }
}
