import DraggyCore
import SwiftUI

/// The plan the model keeps: one line per step with its state, and a button that clears it.
struct PlanStrip: View {
    let steps: [PlanStepRecord]
    let clear: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Plan").font(.headline)
                Text(PlanStrip.progress(steps)).foregroundStyle(.secondary)
                Spacer()
                Button("Clear plan", action: clear).buttonStyle(.borderless)
            }
            ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
                HStack(spacing: 6) {
                    Image(systemName: PlanStrip.symbol(step.status))
                        .foregroundStyle(step.status == "done" ? Color.green : Color.secondary)
                    Text(step.text)
                        .strikethrough(step.status == "done")
                        .foregroundStyle(step.status == "todo" ? .secondary : .primary)
                }
                .font(.callout)
                .accessibilityElement(children: .combine)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary)
    }

    /// `3 of 7`, counting the steps that are done.
    static func progress(_ steps: [PlanStepRecord]) -> String {
        String(format: String(localized: "%lld of %lld"), steps.filter { $0.status == "done" }.count, steps.count)
    }

    static func symbol(_ status: String) -> String {
        switch status {
        case "done": "checkmark.circle.fill"
        case "doing": "arrow.right.circle"
        default: "circle"
        }
    }
}
