import SwiftUI

/// Placeholder transcript. The plan puts this on an NSTableView with TextKit 2, because LazyVStack re-lays out
/// variable-height rows while a reply streams. Replace this view before the performance budgets are measured.
struct ChatView: View {
    @Bindable var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(model.transcript.lines) { line in
                            MessageRow(line: line).id(line.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: model.transcript.lines.last?.text) { _, _ in
                    if let last = model.transcript.lines.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
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

private struct MessageRow: View {
    let line: Transcript.Line

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(line.role == .user ? "You" : "Draggy")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(line.text)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
