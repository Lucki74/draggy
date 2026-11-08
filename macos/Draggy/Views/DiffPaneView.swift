import SwiftUI

/// Review: the working changes, or one commit's, as files that open into their diffs, over the commit graph.
public struct DiffPaneView: View {
    let workingDirectory: String
    @State private var files: [FileDiff] = []
    @State private var commit: GitCommit?
    @State private var commits: [GitCommit] = []
    @State private var branches: [GitBranch] = []
    @State private var branch = "HEAD"
    @State private var problem: String?
    /// Nil until the reader opens or closes a file; then the first file starts open.
    @State private var expanded: Set<String>?
    @State private var split = false
    @State private var hideWhitespace = false
    @State private var searching = false
    @State private var query = ""
    @State private var graphOpen = true

    /// Split needs room for two columns of code.
    private static let splitMinWidth: CGFloat = 700

    public init(workingDirectory: String = FileManager.default.currentDirectoryPath) {
        self.workingDirectory = workingDirectory
    }

    public var body: some View {
        GeometryReader { proxy in
            let canSplit = proxy.size.width >= Self.splitMinWidth
            VStack(spacing: 0) {
                toolbar(canSplit: canSplit)
                Divider()
                if searching {
                    TextField("Filter files", text: $query)
                        .textFieldStyle(.roundedBorder)
                        .controlSize(.small)
                        .padding(6)
                    Divider()
                }
                if let problem {
                    Text(problem)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let commit {
                    Button { showCommit(nil) } label: {
                        Label("Back to changes", systemImage: "chevron.left")
                            .font(.caption)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    Text("\(commit.hash) \(commit.message)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .padding(.horizontal, 10)
                        .padding(.bottom, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Divider()
                }
                fileList(split: split && canSplit)
                Divider()
                graph
            }
        }
        .onAppear { reload() }
        .onChange(of: hideWhitespace) { _, _ in reload() }
    }

    private func toolbar(canSplit: Bool) -> some View {
        HStack(spacing: 8) {
            Menu {
                if branches.isEmpty {
                    Button("No branches") {}.disabled(true)
                }
                ForEach(branches) { item in
                    Button {
                        if !item.current { checkout(item.name) }
                    } label: {
                        if item.current {
                            Label(item.name, systemImage: "checkmark")
                        } else {
                            Text(item.name)
                        }
                    }
                }
            } label: {
                Label(branch == "HEAD" ? String(localized: "Detached HEAD") : branch, systemImage: "arrow.triangle.branch")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .help(String(localized: "Switch branch"))

            Text(files.isEmpty
                ? String(localized: "No working tree changes")
                : String(format: String(localized: "%lld changed files"), files.count))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Spacer(minLength: 0)

            Button { searching.toggle(); query = "" } label: { Image(systemName: "magnifyingglass") }
                .buttonStyle(.plain)
                .help(String(localized: "Search"))

            Menu {
                Toggle("View split diff", isOn: $split).disabled(!canSplit)
                Toggle("Hide whitespace changes", isOn: $hideWhitespace)
                Divider()
                Button(LocalizedStringKey(allOpen ? "Collapse all" : "Expand all")) {
                    expanded = allOpen ? [] : Set(shown.map(\.id))
                }
            } label: {
                Image(systemName: "ellipsis")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()

            Button { reload() } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.plain)
                .help(String(localized: "Refresh"))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color(nsColor: .controlBackgroundColor))
    }

    @ViewBuilder
    private func fileList(split: Bool) -> some View {
        if files.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "checkmark.circle")
                    .font(.largeTitle)
                    .foregroundStyle(.green)
                Text(LocalizedStringKey(commit == nil ? "No working tree changes" : "No diff to show"))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(shown) { file in
                        ReviewFileRow(file: file, open: openSet.contains(file.id), split: split) {
                            var next = openSet
                            if next.contains(file.id) { next.remove(file.id) } else { next.insert(file.id) }
                            expanded = next
                        }
                    }
                }
            }
        }
    }

    private var graph: some View {
        VStack(spacing: 0) {
            Button { graphOpen.toggle() } label: {
                HStack(spacing: 4) {
                    Image(systemName: graphOpen ? "chevron.down" : "chevron.right")
                    Text("Graph").textCase(.uppercase)
                    Spacer()
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .frame(height: 28)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if graphOpen {
                if commits.isEmpty {
                    Text("No commits")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(16)
                } else {
                    GitGraphView(commits: commits, selected: commit?.id) { showCommit($0) }
                        .frame(height: 220)
                }
            }
        }
        .background(Color(nsColor: .controlBackgroundColor))
    }

    private var shown: [FileDiff] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return needle.isEmpty ? files : files.filter { $0.id.lowercased().contains(needle) }
    }

    private var openSet: Set<String> {
        if let expanded { return expanded }
        guard commit == nil, let first = files.first else { return [] }
        return [first.id]
    }

    private var allOpen: Bool {
        !shown.isEmpty && shown.allSatisfy { openSet.contains($0.id) }
    }

    private func showCommit(_ next: GitCommit?) {
        commit = next
        expanded = nil
        reload()
    }

    private func checkout(_ name: String) {
        if let message = GitOperations.shared.switchBranch(name, in: workingDirectory) {
            problem = message
            return
        }
        showCommit(nil)
    }

    private func reload() {
        let git = GitOperations.shared
        problem = nil
        let raw = commit.map { git.show($0.id, in: workingDirectory, ignoreWhitespace: hideWhitespace) }
            ?? git.diff(in: workingDirectory, ignoreWhitespace: hideWhitespace)
        files = DiffParser.shared.parse(diffText: raw)
        branch = git.currentBranch(in: workingDirectory)
        branches = git.branches(in: workingDirectory)
        commits = git.log(in: workingDirectory, maxCount: 200, all: true)
    }
}

/// A file as one row with its change counts that opens into its diff.
private struct ReviewFileRow: View {
    let file: FileDiff
    let open: Bool
    let split: Bool
    let onToggle: () -> Void

    private var name: String { (file.id as NSString).lastPathComponent }
    private var folder: String { (file.id as NSString).deletingLastPathComponent }

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onToggle) {
                HStack(spacing: 8) {
                    Text(name).lineLimit(1).truncationMode(.middle)
                    Text(folder)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        .truncationMode(.head)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("+\(file.lines.filter { $0.type == .add }.count)").foregroundStyle(.green)
                    Text("-\(file.lines.filter { $0.type == .delete }.count)").foregroundStyle(.red)
                    Image(systemName: open ? "chevron.down" : "chevron.right").foregroundStyle(.tertiary)
                }
                .font(.caption)
                .padding(.horizontal, 12)
                .frame(height: 32)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                Divider()
                Group {
                    if split {
                        SplitDiffView(diff: file)
                    } else {
                        UnifiedDiffView(diff: file)
                    }
                }
                .background(Color(nsColor: .textBackgroundColor))
            }
            Divider()
        }
    }
}
