import SwiftUI

public struct SearchPreviewView: View {
    public let result: SearchResultItem?

    public init(result: SearchResultItem?) {
        self.result = result
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let result {
                HStack {
                    Text(result.fileName)
                        .font(.headline)
                    Text("Line \(result.lineNumber)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Open in Default App") {
                        FileOperations.shared.openFile(at: result.filePath)
                    }
                    .controlSize(.small)
                }
                .padding(10)
                .background(Color(nsColor: .controlBackgroundColor))

                Divider()

                ScrollView {
                    Text(loadFileSnippet(result: result))
                        .font(.system(.body, design: .monospaced))
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("Select a search result to preview")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private func loadFileSnippet(result: SearchResultItem) -> String {
        guard let content = try? String(contentsOfFile: result.filePath, encoding: .utf8) else {
            return result.snippet
        }
        let lines = content.components(separatedBy: .newlines)
        let targetIdx = max(0, result.lineNumber - 1)
        let start = max(0, targetIdx - 10)
        let end = min(lines.count, targetIdx + 11)

        var rendered: [String] = []
        for i in start..<end {
            let lineNum = String(format: "%4d", i + 1)
            let prefix = (i == targetIdx) ? ">" : " "
            rendered.append("\(prefix) \(lineNum) | \(lines[i])")
        }
        return rendered.joined(separator: "\n")
    }
}
