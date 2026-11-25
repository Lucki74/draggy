import SwiftUI

public struct DocumentCreatorView: View {
    @State private var title: String = ""
    @State private var content: String = ""
    @State private var format: String = "docx"
    @State private var statusMessage: String = ""

    public init() {}

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Create Document")
                .font(.title2)
                .fontWeight(.bold)

            Picker("Format", selection: $format) {
                Text("Word (.docx)").tag("docx")
                Text("Excel (.xlsx)").tag("xlsx")
                Text("PowerPoint (.pptx)").tag("pptx")
            }
            .pickerStyle(.segmented)

            TextField("Document Title", text: $title)
                .textFieldStyle(.roundedBorder)

            Text("Content / Paragraphs")
                .font(.caption)
                .foregroundStyle(.secondary)

            TextEditor(text: $content)
                .font(.body)
                .padding(4)
                .background(Color(nsColor: .controlBackgroundColor))
                .cornerRadius(6)

            HStack {
                Button("Generate Document") {
                    let path = "/tmp/\(title.isEmpty ? "document" : title).\(format)"
                    if format == "docx" {
                        try? DocxCreator.shared.createDocument(title: title, paragraphs: content.components(separatedBy: "\n"), outputPath: path)
                    } else if format == "xlsx" {
                        try? ExcelCreator.shared.createSpreadsheet(headers: ["Content"], rows: [[content]], outputPath: path)
                    } else {
                        try? PptxCreator.shared.createPresentation(slides: [(title: title, bullets: [content])], outputPath: path)
                    }
                    statusMessage = "Created: \(path)"
                }
                .buttonStyle(.borderedProminent)

                if !statusMessage.isEmpty {
                    Text(statusMessage)
                        .font(.caption)
                        .foregroundStyle(.green)
                }
            }
        }
        .padding(16)
    }
}
