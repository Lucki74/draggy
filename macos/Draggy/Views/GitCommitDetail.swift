import SwiftUI

public struct GitCommitDetail: View {
    public let commit: GitCommit?

    public init(commit: GitCommit?) {
        self.commit = commit
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let commit {
                VStack(alignment: .leading, spacing: 4) {
                    Text(commit.message)
                        .font(.headline)
                    HStack(spacing: 8) {
                        Text(commit.hash)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.blue)
                        Text(commit.author)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(commit.date)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(10)
                .background(Color(nsColor: .controlBackgroundColor))

                Divider()

                Text("Commit changes:")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .padding(.top, 4)

                Spacer()
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("Select a commit from history")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}
