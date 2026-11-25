import SwiftUI

public struct FileExplorerPane: View {
    @State private var currentPath: String = FileManager.default.currentDirectoryPath
    @State private var showingNewFileModal: Bool = false
    @State private var showingNewFolderModal: Bool = false
    @State private var newNameBuffer: String = ""

    public init(initialPath: String = FileManager.default.currentDirectoryPath) {
        self._currentPath = State(initialValue: initialPath)
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Text(URL(fileURLWithPath: currentPath).lastPathComponent)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                Spacer()
                Button {
                    newNameBuffer = ""
                    showingNewFileModal = true
                } label: {
                    Image(systemName: "doc.badge.plus")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .help("New File")

                Button {
                    newNameBuffer = ""
                    showingNewFolderModal = true
                } label: {
                    Image(systemName: "folder.badge.plus")
                        .font(.caption)
                }
                .buttonStyle(.plain)
                .help("New Folder")
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(Color(nsColor: .controlBackgroundColor))

            Divider()

            FileExplorerView(rootPath: currentPath)
        }
        .sheet(isPresented: $showingNewFileModal) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Create New File").font(.headline)
                TextField("File name (e.g. index.ts)", text: $newNameBuffer)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Spacer()
                    Button("Cancel") { showingNewFileModal = false }
                    Button("Create") {
                        if !newNameBuffer.isEmpty {
                            _ = try? FileOperations.shared.createFile(at: currentPath, name: newNameBuffer)
                            showingNewFileModal = false
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(16)
            .frame(width: 320)
        }
        .sheet(isPresented: $showingNewFolderModal) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Create New Folder").font(.headline)
                TextField("Folder name", text: $newNameBuffer)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    Spacer()
                    Button("Cancel") { showingNewFolderModal = false }
                    Button("Create") {
                        if !newNameBuffer.isEmpty {
                            _ = try? FileOperations.shared.createDirectory(at: currentPath, name: newNameBuffer)
                            showingNewFolderModal = false
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(16)
            .frame(width: 320)
        }
    }
}
