import Foundation

@MainActor
@Observable
public final class GitStatusMonitor {
    public var status: GitStatusSummary = GitStatusSummary(modified: [], staged: [], untracked: [])
    public var rootPath: String

    public init(rootPath: String = FileManager.default.currentDirectoryPath) {
        self.rootPath = rootPath
    }

    public func refresh() {
        status = GitOperations.shared.status(in: rootPath)
    }
}
