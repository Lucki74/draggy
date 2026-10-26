import SwiftUI

public struct StatsPanelView: View {
    @Bindable var store: StatsStore

    public init(store: StatsStore) {
        self.store = store
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Session Statistics")
                    .font(.title2)
                    .fontWeight(.bold)

                // Token summary cards
                HStack(spacing: 12) {
                    summaryCard(title: "Prompt Tokens", value: "\(store.totalPromptTokens)", color: .blue)
                    summaryCard(title: "Completion Tokens", value: "\(store.totalCompletionTokens)", color: .green)
                    summaryCard(title: "Est. Cost", value: String(format: "$%.4f", store.totalCostDollars), color: .orange)
                }

                UsageChartView(history: store.recentHistory)

                // Hardware metrics section
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("SYSTEM HARDWARE")
                            .font(.caption2)
                            .fontWeight(.bold)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Refresh") {
                            store.refreshHardware()
                        }
                        .controlSize(.mini)
                    }

                    HStack(spacing: 12) {
                        let memUsedGB = Double(store.hardware.memoryUsedBytes) / 1_073_741_824.0
                        let memTotalGB = Double(store.hardware.memoryTotalBytes) / 1_073_741_824.0
                        metricCard(title: "RAM Used", value: String(format: "%.1f / %.1f GB", memUsedGB, memTotalGB))

                        let diskFreeGB = Double(store.hardware.diskFreeBytes) / 1_073_741_824.0
                        metricCard(title: "Disk Free", value: String(format: "%.1f GB", diskFreeGB))
                    }
                }
                .padding(10)
                .background(Color(nsColor: .controlBackgroundColor))
                .cornerRadius(8)
            }
            .padding(14)
        }
    }

    private func summaryCard(title: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title3)
                .fontWeight(.bold)
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }

    private func metricCard(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline)
                .fontWeight(.semibold)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
