import Foundation

public final class SearchEngine: Sendable {
    public static let shared = SearchEngine()

    private let ignoredDirectories: Set<String> = [
        ".git", "node_modules", "target", "dist", "dist-electron", ".build", "Packages"
    ]

    private let textExtensions: Set<String> = [
        "swift", "rs", "ts", "tsx", "js", "jsx", "json", "toml", "yaml", "yml", "md", "txt", "css", "html", "sh", "c", "h", "cpp", "py"
    ]

    public init() {}

    public func search(query: String, in rootPath: String, maxResults: Int = 100) -> [SearchResultItem] {
        guard !query.trimmingCharacters(in: .whitespaces).isEmpty else { return [] }

        var results: [SearchResultItem] = []
        let fileManager = FileManager.default
        let url = URL(fileURLWithPath: rootPath)

        guard let enumerator = fileManager.enumerator(
            at: url,
            includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }

        for case let fileUrl as URL in enumerator {
            let pathComponents = fileUrl.pathComponents
            if pathComponents.contains(where: { ignoredDirectories.contains($0) }) {
                continue
            }

            guard let resourceValues = try? fileUrl.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey]),
                  let isDirectory = resourceValues.isDirectory, !isDirectory,
                  let fileSize = resourceValues.fileSize, fileSize < 2_000_000 else {
                continue
            }

            let ext = fileUrl.pathExtension.lowercased()
            if !textExtensions.contains(ext) {
                continue
            }

            guard let content = try? String(contentsOf: fileUrl, encoding: .utf8) else {
                continue
            }

            let lines = content.components(separatedBy: .newlines)
            for (index, line) in lines.enumerated() {
                if let range = line.range(of: query, options: .caseInsensitive) {
                    let nsRange = NSRange(range, in: line)
                    results.append(SearchResultItem(
                        filePath: fileUrl.path,
                        lineNumber: index + 1,
                        snippet: line.trimmingCharacters(in: .whitespaces),
                        matchRange: nsRange
                    ))

                    if results.count >= maxResults {
                        return results
                    }
                }
            }
        }

        return results
    }
}
