import SwiftUI

public struct ImageGenerationView: View {
    @State private var engine = ImageEngine()
    @State private var promptText: String = ""
    @State private var selectedImage: GeneratedImageItem?

    public init() {}

    public var body: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Generate Image")
                    .font(.title2)
                    .fontWeight(.bold)

                ImageModelSelector(selectedModelId: $engine.activeModelId)

                Text("Prompt")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                TextEditor(text: $promptText)
                    .frame(height: 80)
                    .padding(4)
                    .background(Color(nsColor: .controlBackgroundColor))
                    .cornerRadius(6)

                if engine.isGenerating {
                    ProgressView(value: engine.progress, total: 1.0)
                        .tint(.blue)
                }

                Button {
                    Task {
                        selectedImage = await engine.generate(prompt: promptText)
                    }
                } label: {
                    Label(engine.isGenerating ? "Generating..." : "Generate", systemImage: "wand.and.stars")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(promptText.trimmingCharacters(in: .whitespaces).isEmpty || engine.isGenerating)

                Divider()

                Text("History")
                    .font(.headline)

                ImageHistoryView(history: engine.history) { item in
                    selectedImage = item
                }
            }
            .padding(14)
            .frame(minWidth: 280, idealWidth: 320)

            // Preview pane
            VStack {
                if let selected = selectedImage, let img = selected.image {
                    VStack(spacing: 8) {
                        Image(nsImage: img)
                            .resizable()
                            .scaledToFit()
                            .cornerRadius(8)
                            .shadow(radius: 4)
                        Text(selected.prompt)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(20)
                } else {
                    VStack(spacing: 8) {
                        Image(systemName: "photo.on.rectangle")
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                        Text("Generated image will appear here")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(minWidth: 340)
        }
    }
}
