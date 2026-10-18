import AppKit
import DraggyCore
import SwiftUI
import UniformTypeIdentifiers

struct ChatView: View {
    @Bindable var model: AppModel
    @State private var isPickingFile = false

    var body: some View {
        VStack(spacing: 0) {
            if let update = model.updates.available, !model.updates.isDismissed {
                updateBanner(update)
            }
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

    private func updateBanner(_ update: UpdateRecord) -> some View {
        HStack {
            Text("\(update.name) is available.")
            Button("Download") { NSWorkspace.shared.open(URL(string: update.url)!) }
            Spacer()
            Button("Dismiss") { model.updates.isDismissed = true }
        }
        .padding(8)
        .background(.quaternary)
    }

    private var composer: some View {
        HStack(alignment: .bottom) {
            Button { isPickingFile = true } label: { Image(systemName: "paperclip") }
                .help("Add the text of a Word, PowerPoint, Excel or PDF file")
                .accessibilityLabel("Attach a file")
                .accessibilityHint("Add the text of a Word, PowerPoint, Excel or PDF file")
                .disabled(model.isRunning)
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
        .fileImporter(isPresented: $isPickingFile, allowedContentTypes: Self.documentTypes) { result in
            if case let .success(url) = result { Task { await model.attach(url) } }
        }
    }

    private static let documentTypes: [UTType] = ["docx", "pptx", "xlsx", "pdf"]
        .compactMap { UTType(filenameExtension: $0) }
}
