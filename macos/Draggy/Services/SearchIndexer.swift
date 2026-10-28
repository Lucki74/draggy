import Foundation

public final class SearchIndexer: Sendable {
    public static let shared = SearchIndexer()

    public init() {}

    public func startIndexing(in path: String) async -> [String] {
        let task = Task.detached(priority: .utility) { () -> [String] in
            let fm = FileManager.default
            let rootUrl = URL(fileURLWithPath: path)
            var indexedFiles: [String] = []

            guard let enumerator = fm.enumerator(at: rootUrl, includingPropertiesForKeys: [.isRegularFileKey]) else {
                return []
            }

            while let url = enumerator.nextObject() as? URL {
                if let vals = try? url.resourceValues(forKeys: [.isRegularFileKey]),
                   vals.isRegularFile == true {
                    indexedFiles.append(url.path)
                }
            }
            return indexedFiles
        }
        return await task.value
    }
}
