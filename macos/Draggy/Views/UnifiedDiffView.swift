import SwiftUI

public struct UnifiedDiffView: View {
    public let diff: FileDiff

    public init(diff: FileDiff) {
        self.diff = diff
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 1) {
                ForEach(diff.lines) { line in
                    HStack(spacing: 8) {
                        Text(formatLineNumber(line))
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .frame(width: 44, alignment: .trailing)

                        Text(prefixChar(line.type))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(lineColor(line.type))
                            .frame(width: 12)

                        Text(line.content)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(lineColor(line.type))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, 4)
                    .background(lineBackground(line.type))
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func formatLineNumber(_ line: DiffLine) -> String {
        if let n = line.newLineNumber { return "\(n)" }
        if let o = line.oldLineNumber { return "\(o)" }
        return ""
    }

    private func prefixChar(_ type: DiffLineType) -> String {
        switch type {
        case .add: return "+"
        case .delete: return "-"
        case .context: return " "
        case .header: return "@"
        }
    }

    private func lineColor(_ type: DiffLineType) -> Color {
        switch type {
        case .add: return .green
        case .delete: return .red
        case .header: return .blue
        case .context: return .primary
        }
    }

    private func lineBackground(_ type: DiffLineType) -> Color {
        switch type {
        case .add: return Color.green.opacity(0.12)
        case .delete: return Color.red.opacity(0.12)
        case .header: return Color.blue.opacity(0.08)
        case .context: return Color.clear
        }
    }
}
