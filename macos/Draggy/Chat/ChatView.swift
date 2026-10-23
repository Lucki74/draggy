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
            if !model.plan.isEmpty {
                PlanStrip(steps: model.plan) { model.clearPlan() }
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
        VStack(alignment: .leading, spacing: 6) {
            if !model.pendingImages.isEmpty { imageChips }
            composerRow
        }
        .padding()
        .fileImporter(isPresented: $isPickingFile, allowedContentTypes: Self.attachmentTypes) { result in
            if case let .success(url) = result { Task { await model.attach(url) } }
        }
    }

    private var imageChips: some View {
        HStack {
            ForEach(Array(model.pendingImages.enumerated()), id: \.offset) { index, image in
                HStack(spacing: 4) {
                    Image(systemName: "photo")
                    Text(image.name).lineLimit(1)
                    Button { model.removeImage(at: index) } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove picture")
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(.quaternary, in: Capsule())
            }
        }
    }

    private var composerRow: some View {
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
    }

    private static let attachmentTypes: [UTType] = ["docx", "pptx", "xlsx", "pdf", "png", "jpg", "jpeg", "gif", "webp"]
        .compactMap { UTType(filenameExtension: $0) }
}
