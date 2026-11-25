import AppKit
import DraggyCore
import SwiftUI

struct ChatView: View {
    @Bindable var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            if let update = model.updates.available, !model.updates.isDismissed {
                updateBanner(update)
            }
            TranscriptView(lines: model.transcript.lines, textSize: model.appearance.textSize)
            TaskChip(model: model)
            if let message = model.errorMessage {
                Text(message)
                    .font(.ui(13))
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: 720, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .frame(maxWidth: .infinity)
            }
            ComposerView(model: model)
        }
        .background(Theme.surfaceBase)
        .sheet(isPresented: $model.isShowingTasks) { TasksSheet(model: model) }
        .task { await pollTasks() }
    }

    /// Reads the background commands about once a second, but only while a turn runs or some exist.
    private func pollTasks() async {
        while !Task.isCancelled {
            if model.isRunning || !model.tasks.isEmpty { model.refreshTasks() }
            try? await Task.sleep(for: .seconds(1))
        }
    }

    private func updateBanner(_ update: UpdateRecord) -> some View {
        HStack {
            if model.updates.isReadyToRestart {
                Text("\(update.name) is ready to install.")
                Button("Restart to Update") { model.updates.applyRestart() }
            } else if model.updates.isNotWritable {
                Text("\(update.name) is available. Download manually.")
                Button("Download") { NSWorkspace.shared.open(URL(string: update.url)!) }
            } else {
                Text("\(update.name) is available.")
                Button("Download") { NSWorkspace.shared.open(URL(string: update.url)!) }
            }
            Spacer()
            Button("Dismiss") { model.updates.isDismissed = true }
        }
        .font(.ui(13))
        .padding(8)
        .background(Theme.surfaceRaised)
    }
}
