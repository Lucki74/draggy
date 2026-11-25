import SwiftUI

public struct MemoryEditorView: View {
    let filePath: String
    @State private var content: String = ""

    public init(filePath: String) {
        self.filePath = filePath
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(URL(fileURLWithPath: filePath).lastPathComponent)
                    .font(.headline)
                Spacer()
                Button("Save") {
                    try? content.write(toFile: filePath, atomically: true, encoding: .utf8)
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(10)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            TextEditor(text: $content)
                .font(.system(.body, design: .monospaced))
                .padding(8)
        }
        .onAppear {
            if let saved = try? String(contentsOfFile: filePath, encoding: .utf8) {
                content = saved
            }
        }
    }
}
