import DraggyCore
import SwiftUI

/// The rules the chip and the list follow for the background commands the model started.
enum BackgroundTasks {
    static func running(_ tasks: [TaskRecord]) -> [TaskRecord] {
        tasks.filter { $0.status == "running" }
    }

    /// Failed tasks whose list the person has not opened yet.
    static func unseenFailures(_ tasks: [TaskRecord], seen: Set<String>) -> [TaskRecord] {
        tasks.filter { $0.status == "failed" && !seen.contains($0.id) }
    }

    /// `2:05`, or `1:02:03` past an hour.
    static func runtime(_ milliseconds: UInt64) -> String {
        let seconds = milliseconds / 1000
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let rest = seconds % 60
        if hours > 0 {
            return String(format: "%llu:%02llu:%02llu", hours, minutes, rest)
        }
        return String(format: "%llu:%02llu", minutes, rest)
    }

    static func status(_ task: TaskRecord) -> String {
        switch task.status {
        case "running":
            return String(localized: "Running")
        case "failed":
            guard let code = task.exitCode else { return String(localized: "Failed") }
            return String(format: String(localized: "Failed, exit %lld"), Int(code))
        case "stopped":
            return String(localized: "Stopped")
        default:
            return String(localized: "Done")
        }
    }
}

/// The "2 running" chip under the transcript. It turns red while a failed task is still unseen.
struct TaskChip: View {
    let model: AppModel

    var body: some View {
        let running = BackgroundTasks.running(model.tasks).count
        let failed = BackgroundTasks.unseenFailures(model.tasks, seen: model.seenFailures).count
        if running > 0 || failed > 0 {
            HStack {
                Button { model.showTasks() } label: {
                    Label(
                        running > 0
                            ? String(format: String(localized: "%lld running"), running)
                            : String(format: String(localized: "%lld failed"), failed),
                        systemImage: failed > 0 ? "exclamationmark.triangle" : "terminal"
                    )
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .foregroundStyle(failed > 0 ? Color.red : Color.primary)
                .help(String(localized: "Tasks"))
                Spacer()
            }
            .padding(.horizontal)
            .padding(.top, 6)
        }
    }
}

/// The conversation's background commands, each with a Stop button while it runs.
struct TasksSheet: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Tasks").font(.headline)
            List(model.tasks, id: \.id) { task in
                TaskRow(task: task) { model.stopTask(task.id) }
            }
            HStack {
                Spacer()
                Button("Close") { dismiss() }
            }
        }
        .padding()
        .frame(minWidth: 520, minHeight: 320)
    }
}

private struct TaskRow: View {
    let task: TaskRecord
    let stop: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(task.command)
                    .font(.system(.body, design: .monospaced))
                    .lineLimit(2)
                    .textSelection(.enabled)
                Spacer()
                if task.status == "running" {
                    Button("Stop", action: stop)
                }
            }
            HStack(spacing: 8) {
                Text(BackgroundTasks.status(task))
                    .foregroundStyle(task.status == "failed" ? Color.red : Color.secondary)
                Text(BackgroundTasks.runtime(task.runningForMs))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            .font(.caption)
            if !task.lastLine.isEmpty {
                Text(task.lastLine)
                    .font(.system(.caption, design: .monospaced))
                    .lineLimit(1)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
