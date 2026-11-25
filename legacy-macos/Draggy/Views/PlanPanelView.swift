import SwiftUI

public struct PlanPanelView: View {
    @Bindable var store: PlanStore

    public init(store: PlanStore) {
        self.store = store
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let plan = store.currentPlan {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("AGENT PLAN")
                            .font(.caption2)
                            .fontWeight(.bold)
                            .foregroundStyle(.secondary)
                        Spacer()
                        let completed = plan.steps.filter { $0.status == .completed }.count
                        Text("\(completed)/\(plan.steps.count) completed")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    Text(plan.goal)
                        .font(.headline)
                        .lineLimit(2)

                    ProgressView(
                        value: Double(plan.steps.filter { $0.status == .completed }.count),
                        total: Double(max(1, plan.steps.count))
                    )
                    .tint(.green)
                }
                .padding(10)
                .background(Color(nsColor: .controlBackgroundColor))

                Divider()

                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(plan.steps) { step in
                            PlanStepView(step: step) { newStatus in
                                store.updateStepStatus(id: step.id, status: newStatus)
                            }
                        }
                    }
                    .padding(8)
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "checklist")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("No active execution plan")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}
