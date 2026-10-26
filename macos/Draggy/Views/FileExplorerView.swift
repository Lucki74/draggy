import SwiftUI

public struct FileExplorerView: View {
    let rootPath: String
    @State private var items: [FileTreeItem] = []
    @State private var expandedPaths: Set<String> = []
    @State private var selectedPath: String?
    @State private var isRenaming: String?
    @State private var renameBuffer: String = ""
    private let watcher = FileSystemWatcher()

    public init(rootPath: String = FileManager.default.currentDirectoryPath) {
        self.rootPath = rootPath
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("EXPLORER")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    loadDirectory()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.caption)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)

            Divider()

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(items) { item in
                        renderItem(item, depth: 0)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .onAppear {
            loadDirectory()
            watcher.start(watching: rootPath) {
                Task { @MainActor in
                    loadDirectory()
                }
            }
        }
        .onDisappear {
            watcher.stop()
        }
    }

    @ViewBuilder
    private func renderItem(_ item: FileTreeItem, depth: Int) -> some View {
        HStack(spacing: 4) {
            Spacer().frame(width: CGFloat(depth * 14))

            if item.isDirectory {
                Image(systemName: expandedPaths.contains(item.path) ? "chevron.down" : "chevron.right")
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .frame(width: 12)
                Image(systemName: expandedPaths.contains(item.path) ? "folder.fill" : "folder")
                    .font(.caption)
                    .foregroundStyle(.blue)
            } else {
                Spacer().frame(width: 12)
                Image(systemName: iconForFile(item.name))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if isRenaming == item.path {
                TextField("Name", text: $renameBuffer)
                    .font(.caption)
                    .textFieldStyle(.plain)
                    .onSubmit {
                        if !renameBuffer.isEmpty {
                            _ = try? FileOperations.shared.renameFile(at: item.path, newName: renameBuffer)
                            loadDirectory()
                        }
                        isRenaming = nil
                    }
            } else {
                Text(item.name)
                    .font(.caption)
                    .lineLimit(1)
            }

            Spacer()
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 6)
        .background(selectedPath == item.path ? Color.accentColor.opacity(0.15) : Color.clear)
        .cornerRadius(4)
        .contentShape(Rectangle())
        .onTapGesture {
            selectedPath = item.path
            if item.isDirectory {
                toggleExpand(item)
            } else {
                FileOperations.shared.openFile(at: item.path)
            }
        }
        .contextMenu {
            Button("Open") {
                FileOperations.shared.openFile(at: item.path)
            }
            Button("Reveal in Finder") {
                FileOperations.shared.revealInFinder(path: item.path)
            }
            Divider()
            Button("Rename") {
                renameBuffer = item.name
                isRenaming = item.path
            }
            Button("Delete", role: .destructive) {
                _ = try? FileOperations.shared.deleteFile(at: item.path)
                loadDirectory()
            }
        }

        if item.isDirectory && expandedPaths.contains(item.path), let children = item.children {
            ForEach(children) { child in
                renderItem(child, depth: depth + 1)
            }
        }
    }

    private func toggleExpand(_ item: FileTreeItem) {
        if expandedPaths.contains(item.path) {
            expandedPaths.remove(item.path)
        } else {
            expandedPaths.insert(item.path)
            if let index = items.firstIndex(where: { $0.id == item.id }) {
                if let subItems = try? FileOperations.shared.listDirectory(at: item.path) {
                    items[index].children = subItems
                }
            }
        }
    }

    private func loadDirectory() {
        if let list = try? FileOperations.shared.listDirectory(at: rootPath) {
            items = list
        }
    }

    private func iconForFile(_ name: String) -> String {
        let ext = (name as NSString).pathExtension.lowercased()
        switch ext {
        case "swift", "rs", "ts", "js", "py", "json", "yaml", "yml", "toml":
            return "chevron.left.forwardslash.chevron.right"
        case "png", "jpg", "jpeg", "webp", "gif", "svg":
            return "photo"
        case "pdf":
            return "doc.richtext"
        case "md", "txt":
            return "doc.plaintext"
        default:
            return "doc"
        }
    }
}
