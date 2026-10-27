import Foundation

public struct FileTreeItem: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let path: String
    public let isDirectory: Bool
    public let size: Int64
    public let modifiedDate: Date
    public var children: [FileTreeItem]?

    public init(
        name: String,
        path: String,
        isDirectory: Bool,
        size: Int64 = 0,
        modifiedDate: Date = Date(),
        children: [FileTreeItem]? = nil
    ) {
        self.id = path
        self.name = name
        self.path = path
        self.isDirectory = isDirectory
        self.size = size
        self.modifiedDate = modifiedDate
        self.children = children
    }
}
