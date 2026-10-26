import SwiftUI

public struct GitHistoryView: View {
    public let commits: [GitCommit]
    public let onSelectCommit: (GitCommit) -> Void

    public init(commits: [GitCommit], onSelectCommit: @escaping (GitCommit) -> Void) {
        self.commits = commits
        self.onSelectCommit = onSelectCommit
    }

    public var body: some View {
        ScrollView {
            LazyVStack(spacing: 2) {
                ForEach(commits) { commit in
                    HStack(spacing: 8) {
                        Text(commit.hash)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.blue)
                            .frame(width: 60, alignment: .leading)

                        Text(commit.message)
                            .font(.caption)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Text(commit.author)
                            .font(.caption2)
                            .foregroundStyle(.secondary)

                        Text(commit.date)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.clear)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        onSelectCommit(commit)
                    }
                }
            }
        }
    }
}
