import AppKit
import Foundation

public final class FileOperations: Sendable {
    public static let shared = FileOperations()

    public init() {}

    public func listDirectory(at path: String) throws -> [FileTreeItem] {
        let url = URL(fileURLWithPath: path)
        let keys: [URLResourceKey] = [.nameKey, .isDirectoryKey, .fileSizeKey, .contentModificationDateKey]
        let items = try FileManager.default.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        )

        return items.compactMap { fileUrl in
            guard let values = try? fileUrl.resourceValues(forKeys: Set(keys)),
                  let name = values.name,
                  let isDir = values.isDirectory else {
                return nil
            }
            let size = Int64(values.fileSize ?? 0)
            let modDate = values.contentModificationDate ?? Date()
            return FileTreeItem(
                name: name,
                path: fileUrl.path,
                isDirectory: isDir,
                size: size,
                modifiedDate: modDate,
                children: isDir ? [] : nil
            )
        }.sorted { (a, b) -> Bool in
            if a.isDirectory != b.isDirectory {
                return a.isDirectory
            }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
    }

    public func openFile(at path: String) {
        let url = URL(fileURLWithPath: path)
        NSWorkspace.shared.open(url)
    }

    public func revealInFinder(path: String) {
        let url = URL(fileURLWithPath: path)
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }

    public func deleteFile(at path: String) throws {
        try FileManager.default.removeItem(atPath: path)
    }

    public func renameFile(at path: String, newName: String) throws -> String {
        let oldUrl = URL(fileURLWithPath: path)
        let newUrl = oldUrl.deletingLastPathComponent().appendingPathComponent(newName)
        try FileManager.default.moveItem(at: oldUrl, to: newUrl)
        return newUrl.path
    }

    public func createDirectory(at parentPath: String, name: String) throws -> String {
        let newUrl = URL(fileURLWithPath: parentPath).appendingPathComponent(name)
        try FileManager.default.createDirectory(at: newUrl, withIntermediateDirectories: true)
        return newUrl.path
    }

    public func createFile(at parentPath: String, name: String, content: String = "") throws -> String {
        let newUrl = URL(fileURLWithPath: parentPath).appendingPathComponent(name)
        try content.write(to: newUrl, atomically: true, encoding: .utf8)
        return newUrl.path
    }
}
