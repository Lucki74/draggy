import Foundation

public enum DiffLineType: Sendable {
    case add
    case delete
    case context
    case header
}

public struct DiffLine: Identifiable, Sendable {
    public let id: String
    public let type: DiffLineType
    public let oldLineNumber: Int?
    public let newLineNumber: Int?
    public let content: String

    public init(id: String = UUID().uuidString, type: DiffLineType, oldLineNumber: Int?, newLineNumber: Int?, content: String) {
        self.id = id
        self.type = type
        self.oldLineNumber = oldLineNumber
        self.newLineNumber = newLineNumber
        self.content = content
    }
}

public struct FileDiff: Identifiable, Sendable {
    public let id: String
    public let oldPath: String
    public let newPath: String
    public let lines: [DiffLine]

    public init(oldPath: String, newPath: String, lines: [DiffLine]) {
        self.id = newPath.isEmpty ? oldPath : newPath
        self.oldPath = oldPath
        self.newPath = newPath
        self.lines = lines
    }
}

public final class DiffParser: Sendable {
    public static let shared = DiffParser()

    public init() {}

    public func parse(diffText: String) -> [FileDiff] {
        var fileDiffs: [FileDiff] = []
        var currentOldPath = ""
        var currentNewPath = ""
        var currentLines: [DiffLine] = []

        var oldNum = 0
        var newNum = 0

        let lines = diffText.components(separatedBy: .newlines)
        for line in lines {
            if line.hasPrefix("diff --git") {
                if !currentLines.isEmpty {
                    fileDiffs.append(FileDiff(oldPath: currentOldPath, newPath: currentNewPath, lines: currentLines))
                    currentLines = []
                }
            } else if line.hasPrefix("--- a/") {
                currentOldPath = String(line.dropFirst(6))
            } else if line.hasPrefix("+++ b/") {
                currentNewPath = String(line.dropFirst(6))
            } else if line.hasPrefix("@@") {
                currentLines.append(DiffLine(type: .header, oldLineNumber: nil, newLineNumber: nil, content: line))
            } else if line.hasPrefix("+") {
                newNum += 1
                currentLines.append(DiffLine(type: .add, oldLineNumber: nil, newLineNumber: newNum, content: String(line.dropFirst())))
            } else if line.hasPrefix("-") {
                oldNum += 1
                currentLines.append(DiffLine(type: .delete, oldLineNumber: oldNum, newLineNumber: nil, content: String(line.dropFirst())))
            } else if line.hasPrefix(" ") {
                oldNum += 1
                newNum += 1
                currentLines.append(DiffLine(type: .context, oldLineNumber: oldNum, newLineNumber: newNum, content: String(line.dropFirst())))
            }
        }

        if !currentLines.isEmpty {
            fileDiffs.append(FileDiff(oldPath: currentOldPath, newPath: currentNewPath, lines: currentLines))
        }

        return fileDiffs
    }
}
