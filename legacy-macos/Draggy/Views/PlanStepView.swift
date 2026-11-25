import SwiftUI

public struct PlanStepView: View {
    public let step: PlanStepItem
    public let onStatusChange: ((StepStatus) -> Void)?

    public init(step: PlanStepItem, onStatusChange: ((StepStatus) -> Void)? = nil) {
        self.step = step
        self.onStatusChange = onStatusChange
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 8) {
            statusIcon
                .frame(width: 16, height: 16)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 2) {
                Text(step.title)
                    .font(.body)
                    .strikethrough(step.status == .completed)
                    .foregroundStyle(step.status == .completed ? .secondary : .primary)

                if let details = step.details, !details.isEmpty {
                    Text(details)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .background(backgroundColor)
        .cornerRadius(6)
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch step.status {
        case .pending:
            Circle()
                .strokeBorder(Color.secondary, lineWidth: 1.5)
        case .inProgress:
            ProgressView()
                .controlSize(.mini)
        case .completed:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .failed:
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(.red)
        }
    }

    private var backgroundColor: Color {
        switch step.status {
        case .inProgress:
            return Color.accentColor.opacity(0.1)
        case .completed:
            return Color.green.opacity(0.08)
        case .failed:
            return Color.red.opacity(0.08)
        case .pending:
            return Color.clear
        }
    }
}
