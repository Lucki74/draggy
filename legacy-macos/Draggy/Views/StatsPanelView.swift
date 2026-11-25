import Charts
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

                if store.turns.isEmpty {
                    Text("Replies appear here once they finish.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                // Cost cards
                HStack(spacing: 12) {
                    summaryCard(
                        title: "Spent",
                        value: CostFormat.money(store.spentMicros, estimated: store.isEstimated(.billed)),
                        color: .orange)
                    summaryCard(
                        title: "Plan value",
                        value: CostFormat.money(store.planValueMicros, estimated: store.isEstimated(.account)),
                        color: .purple)
                    summaryCard(
                        title: "Saved locally",
                        value: CostFormat.money(store.savedMicros, estimated: true),
                        color: .green)
                }

                if store.unpricedTurns > 0 {
                    Text("\(store.unpricedTurns) replies had no known price and are left out of the totals.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                // Token summary cards
                HStack(spacing: 12) {
                    summaryCard(title: "Prompt Tokens", value: "\(store.totalPromptTokens)", color: .blue)
                    summaryCard(title: "Completion Tokens", value: "\(store.totalCompletionTokens)", color: .teal)
                }

                CostOverTimeView(days: store.days())

                VStack(alignment: .leading, spacing: 16) {
                    CostTableView(title: "By provider", nameTitle: "Provider", rows: store.rows(by: \.provider))
                    CostTableView(title: "By model", nameTitle: "Model", rows: store.rows(by: \.model))
                    CostTableView(title: "By workspace", nameTitle: "Workspace", rows: store.rows(by: \.workspace))
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(nsColor: .controlBackgroundColor))
                .cornerRadius(8)

                Text("Costs are in US dollars. A ~ marks a figure estimated from token totals. Plan value is what the same tokens cost through the API; nothing is charged for it. Stats cover this session only.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

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

    private func summaryCard(title: LocalizedStringKey, value: String, color: Color) -> some View {
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

    private func metricCard(title: LocalizedStringKey, value: String) -> some View {
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

/// The three amounts a day can hold, in the order the chart and its legend show them.
private enum CostSeries: CaseIterable {
    case spent
    case planValue
    case saved

    var title: String {
        switch self {
        case .spent: String(localized: "Spent")
        case .planValue: String(localized: "Plan value")
        case .saved: String(localized: "Saved locally")
        }
    }

    var color: Color {
        switch self {
        case .spent: .orange
        case .planValue: .purple
        case .saved: .green
        }
    }

    func dollars(_ day: CostDay) -> Double {
        switch self {
        case .spent: Double(day.spentMicros) / 1_000_000
        case .planValue: Double(day.planValueMicros) / 1_000_000
        case .saved: Double(day.savedMicros) / 1_000_000
        }
    }
}

private struct CostOverTimeView: View {
    let days: [CostDay]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("COST OVER TIME")
                .font(.caption2)
                .fontWeight(.bold)
                .foregroundStyle(.secondary)

            if days.isEmpty {
                Text("No cost data yet")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .frame(height: 80)
            } else {
                Chart {
                    ForEach(days) { day in
                        ForEach(CostSeries.allCases, id: \.self) { series in
                            BarMark(
                                x: .value("Day", day.day, unit: .day),
                                y: .value("Amount", series.dollars(day))
                            )
                            .foregroundStyle(by: .value("Series", series.title))
                            .position(by: .value("Series", series.title))
                        }
                    }
                }
                .chartForegroundStyleScale(
                    domain: CostSeries.allCases.map(\.title),
                    range: CostSeries.allCases.map(\.color)
                )
                .frame(height: 150)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor))
        .cornerRadius(8)
    }
}

/// One grouping of the replies: a name, how many replies and tokens it holds, and what each kind of money came to.
private struct CostTableView: View {
    let title: LocalizedStringKey
    let nameTitle: LocalizedStringKey
    let rows: [CostRow]

    var body: some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.caption2)
                    .fontWeight(.bold)
                    .foregroundStyle(.secondary)

                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                    GridRow {
                        Text(nameTitle)
                        Text("Turns")
                        Text("Tokens")
                        Text("Spent")
                        Text("Plan value")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)

                    ForEach(rows) { row in
                        GridRow {
                            Text(row.name)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Text("\(row.turns)")
                            Text("\(row.tokens)")
                            Text(amount(row.spentMicros, estimated: row.estimated))
                            Text(amount(row.planValueMicros, estimated: row.estimated))
                        }
                        .font(.callout)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func amount(_ micros: Int64?, estimated: Bool) -> String {
        micros.map { CostFormat.money($0, estimated: estimated) } ?? "—"
    }
}
