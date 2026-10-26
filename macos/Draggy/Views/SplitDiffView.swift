import SwiftUI

public struct SplitDiffView: View {
    public let diff: FileDiff

    public init(diff: FileDiff) {
        self.diff = diff
    }

    public var body: some View {
        ScrollView {
            HStack(alignment: .top, spacing: 0) {
                // Left pane: old / deletions
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(diff.lines.filter { $0.type != .add }) { line in
                        HStack(spacing: 6) {
                            Text(line.oldLineNumber.map { "\($0)" } ?? "")
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .frame(width: 32, alignment: .trailing)
                            Text(line.content)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(line.type == .delete ? .red : .primary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .background(line.type == .delete ? Color.red.opacity(0.12) : Color.clear)
                    }
                }
                .frame(maxWidth: .infinity)

                Divider()

                // Right pane: new / additions
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(diff.lines.filter { $0.type != .delete }) { line in
                        HStack(spacing: 6) {
                            Text(line.newLineNumber.map { "\($0)" } ?? "")
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .frame(width: 32, alignment: .trailing)
                            Text(line.content)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(line.type == .add ? .green : .primary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .background(line.type == .add ? Color.green.opacity(0.12) : Color.clear)
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .padding(.vertical, 4)
        }
    }
}
