import SwiftUI

struct ChatView: View {
    @Bindable var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            TranscriptView(lines: model.transcript.lines)
            if let message = model.errorMessage {
                Text(message)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal)
                    .padding(.top, 8)
            }
            composer
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom) {
            TextField("Message", text: $model.draft, axis: .vertical)
                .lineLimit(1...6)
                .textFieldStyle(.roundedBorder)
                .onSubmit { Task { await model.send() } }
            if model.isRunning {
                Button("Stop") { model.stop() }
            } else {
                Button("Send") { Task { await model.send() } }
                    .keyboardShortcut(.return, modifiers: .command)
                    .disabled(model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding()
    }
}
