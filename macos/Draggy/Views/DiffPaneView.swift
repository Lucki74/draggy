import SwiftUI

public struct DiffPaneView: View {
    let workingDirectory: String
    @State private var diffs: [FileDiff] = []
    @State private var selectedDiffId: String?
    @State private var isSplitMode: Bool = true
    @State private var showHistory: Bool = false
    @State private var commits: [GitCommit] = []
    @State private var selectedCommit: GitCommit?

    public init(workingDirectory: String = FileManager.default.currentDirectoryPath) {
        self.workingDirectory = workingDirectory
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Picker("Mode", selection: $isSplitMode) {
                    Text("Split").tag(true)
                    Text("Unified").tag(false)
                }
                .pickerStyle(.segmented)
                .frame(width: 140)

                Spacer()

                Button {
                    showHistory.toggle()
                    if showHistory {
                        commits = GitOperations.shared.log(in: workingDirectory)
                    }
                } label: {
                    Label(showHistory ? "Diff" : "History", systemImage: "clock")
                }
                .controlSize(.small)

                Button {
                    loadDiff()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            if showHistory {
                HSplitView {
                    GitHistoryView(commits: commits) { commit in
                        selectedCommit = commit
                    }
                    .frame(minWidth: 260)

                    GitCommitDetail(commit: selectedCommit)
                        .frame(minWidth: 320)
                }
            } else {
                if diffs.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "checkmark.circle")
                            .font(.largeTitle)
                            .foregroundStyle(.green)
                        Text("No working tree changes")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    HSplitView {
                        List(diffs, selection: $selectedDiffId) { diff in
                            Text(diff.newPath.isEmpty ? diff.oldPath : diff.newPath)
                                .font(.caption)
                                .lineLimit(1)
                                .tag(diff.id)
                        }
                        .frame(minWidth: 180, idealWidth: 220)

                        if let selected = diffs.first(where: { $0.id == selectedDiffId }) {
                            if isSplitMode {
                                SplitDiffView(diff: selected)
                            } else {
                                UnifiedDiffView(diff: selected)
                            }
                        } else {
                            Text("Select a file to view diff")
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                }
            }
        }
        .onAppear {
            loadDiff()
        }
    }

    private func loadDiff() {
        let diffRaw = GitOperations.shared.diff(in: workingDirectory)
        diffs = DiffParser.shared.parse(diffText: diffRaw)
        selectedDiffId = diffs.first?.id
    }
}
