import SwiftUI

/// One row of a split diff: the old side and the new side. A hunk header spans both.
struct SplitRow: Identifiable {
    let id: Int
    let left: DiffLine?
    let right: DiffLine?

    var isHeader: Bool { left?.type == .header }

    /// Pairs each run of removed lines with the run of added lines that follows, so changes sit side by side.
    static func pair(_ lines: [DiffLine]) -> [SplitRow] {
        var rows: [SplitRow] = []
        var removed: [DiffLine] = []
        var added: [DiffLine] = []
        func flush() {
            for index in 0..<max(removed.count, added.count) {
                rows.append(SplitRow(
                    id: rows.count,
                    left: index < removed.count ? removed[index] : nil,
                    right: index < added.count ? added[index] : nil
                ))
            }
            removed = []
            added = []
        }
        for line in lines {
            switch line.type {
            case .delete:
                removed.append(line)
            case .add:
                added.append(line)
            case .header:
                flush()
                rows.append(SplitRow(id: rows.count, left: line, right: nil))
            case .context:
                flush()
                rows.append(SplitRow(id: rows.count, left: line, right: line))
            }
        }
        flush()
        return rows
    }
}

public struct SplitDiffView: View {
    public let diff: FileDiff

    public init(diff: FileDiff) {
        self.diff = diff
    }

    public var body: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(SplitRow.pair(diff.lines)) { row in
                if row.isHeader, let header = row.left {
                    Text(header.content)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.blue)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 6)
                        .background(Color.blue.opacity(0.08))
                } else {
                    HStack(alignment: .top, spacing: 0) {
                        SplitHalf(line: row.left, number: row.left?.oldLineNumber, tint: .red)
                        Divider()
                        SplitHalf(line: row.right, number: row.right?.newLineNumber, tint: .green)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// One side of a split row. Code wraps inside its column, so the pane never scrolls sideways.
private struct SplitHalf: View {
    let line: DiffLine?
    let number: Int?
    let tint: Color

    private var fill: Color {
        guard let line else { return Color.secondary.opacity(0.06) }
        return line.type == .context ? Color.clear : tint.opacity(0.12)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Text(number.map { "\($0)" } ?? "")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 32, alignment: .trailing)
            Text(line?.content ?? "")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(line.map { $0.type == .context ? Color.primary : tint } ?? Color.primary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(fill)
    }
}
