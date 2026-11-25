import SwiftUI

public struct SearchResultItem: Identifiable, Hashable, Sendable {
    public let id: String
    public let filePath: String
    public let fileName: String
    public let lineNumber: Int
    public let snippet: String
    public let matchRange: NSRange?

    public init(filePath: String, lineNumber: Int, snippet: String, matchRange: NSRange? = nil) {
        self.id = "\(filePath):\(lineNumber):\(snippet.hashValue)"
        self.filePath = filePath
        self.fileName = (filePath as NSString).lastPathComponent
        self.lineNumber = lineNumber
        self.snippet = snippet
        self.matchRange = matchRange
    }
}

public struct SearchResultView: View {
    public let item: SearchResultItem
    public let isSelected: Bool

    public init(item: SearchResultItem, isSelected: Bool = false) {
        self.item = item
        self.isSelected = isSelected
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(item.fileName)
                    .font(.caption)
                    .fontWeight(.semibold)
                Text(":\(item.lineNumber)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Text((item.filePath as NSString).deletingLastPathComponent)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
            Text(item.snippet)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.primary)
                .lineLimit(2)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 8)
        .background(isSelected ? Color.accentColor.opacity(0.15) : Color.clear)
        .cornerRadius(6)
    }
}
