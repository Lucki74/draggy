import Foundation

public struct GitRef: Equatable, Sendable {
    public enum Kind: Sendable {
        case head, branch, remote, tag
    }

    public let name: String
    public let kind: Kind
}

public struct GitCommit: Identifiable, Sendable {
    public let id: String
    public let hash: String
    public let author: String
    public let date: String
    public let message: String
    public var parents: [String] = []
    public var refs: [GitRef] = []
}

public struct GitBranch: Identifiable, Sendable {
    public let name: String
    public let current: Bool
    public var id: String { name }
}

public struct GitStatusSummary: Sendable {
    public let modified: [String]
    public let staged: [String]
    public let untracked: [String]
}

public final class GitOperations: Sendable {
    public static let shared = GitOperations()

    public init() {}

    public func diff(in workingDir: String, ignoreWhitespace: Bool = false) -> String {
        return runGit(["diff"] + (ignoreWhitespace ? ["-w"] : []), in: workingDir)
    }

    /// The changes one commit made, against its first parent. Empty when the text is not a commit id.
    public func show(_ hash: String, in workingDir: String, ignoreWhitespace: Bool = false) -> String {
        guard hash.range(of: "^[0-9a-f]{4,64}$", options: [.regularExpression, .caseInsensitive]) != nil else { return "" }
        let flags = ["show", "--format=", "--no-color", "--no-ext-diff", "--no-textconv", "--diff-merges=first-parent"]
        return runGit(flags + (ignoreWhitespace ? ["-w"] : []) + [hash, "--"], in: workingDir)
    }

    public func diffCached(in workingDir: String) -> String {
        return runGit(["diff", "--cached"], in: workingDir)
    }

    public func status(in workingDir: String) -> GitStatusSummary {
        let output = runGit(["status", "--porcelain"], in: workingDir)
        var modified: [String] = []
        var staged: [String] = []
        var untracked: [String] = []

        for line in output.components(separatedBy: .newlines) {
            guard line.count >= 3 else { continue }
            let indexStatus = line.prefix(1)
            let workStatus = line.dropFirst().prefix(1)
            let file = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)

            if indexStatus == "M" || indexStatus == "A" || indexStatus == "D" {
                staged.append(file)
            }
            if workStatus == "M" || workStatus == "D" {
                modified.append(file)
            }
            if indexStatus == "?" && workStatus == "?" {
                untracked.append(file)
            }
        }

        return GitStatusSummary(modified: modified, staged: staged, untracked: untracked)
    }

    /// The latest commits on the current branch, or on every branch with `all`, newest first.
    public func log(in workingDir: String, maxCount: Int = 20, all: Bool = false) -> [GitCommit] {
        let format = "--format=%H%x1f%an%x1f%ad%x1f%s%x1f%P%x1f%D%x1e"
        let args = ["log", "-n", "\(maxCount)", "--topo-order", "--no-show-signature", "--decorate=short", "--date=short"]
        let output = runGit(args + (all ? ["--all"] : []) + [format], in: workingDir)
        var commits: [GitCommit] = []
        for record in output.components(separatedBy: "\u{1e}") {
            let parts = record.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\u{1f}")
            guard parts.count >= 5 else { continue }
            commits.append(GitCommit(
                id: parts[0],
                hash: String(parts[0].prefix(7)),
                author: parts[1],
                date: parts[2],
                message: parts[3],
                parents: parts[4].split(separator: " ").map(String.init),
                refs: parts.count > 5 ? refList(parts[5]) : []
            ))
        }
        return commits
    }

    /// The names in a `%D` decoration: "HEAD -> main, origin/main, tag: v1" gives each ref with its kind.
    func refList(_ text: String) -> [GitRef] {
        let names = text.components(separatedBy: ", ").map { $0.trimmingCharacters(in: .whitespaces) }
        return names.filter { !$0.isEmpty }.map { (part: String) -> GitRef in
            if part.hasPrefix("HEAD -> ") { return GitRef(name: String(part.dropFirst(8)), kind: .head) }
            if part == "HEAD" { return GitRef(name: part, kind: .head) }
            if part.hasPrefix("tag: ") { return GitRef(name: String(part.dropFirst(5)), kind: .tag) }
            return GitRef(name: part, kind: part.contains("/") ? .remote : .branch)
        }
    }

    /// The branch HEAD is on, or "HEAD" when it is detached.
    public func currentBranch(in workingDir: String) -> String {
        let name = runGit(["rev-parse", "--abbrev-ref", "HEAD"], in: workingDir).trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty || name.hasPrefix("fatal") ? "HEAD" : name
    }

    public func branches(in workingDir: String) -> [GitBranch] {
        let output = runGit(["for-each-ref", "--format=%(HEAD)%1f%(refname:short)", "refs/heads"], in: workingDir)
        return output.components(separatedBy: .newlines).compactMap { (line: String) -> GitBranch? in
            let parts = line.components(separatedBy: "\u{1f}")
            guard parts.count == 2, !parts[1].isEmpty else { return nil }
            return GitBranch(name: parts[1], current: parts[0] == "*")
        }
    }

    /// Switches branch. Returns git's message when it refuses, nil when it worked.
    public func switchBranch(_ name: String, in workingDir: String) -> String? {
        guard !name.hasPrefix("-") else { return name }
        let result = run(["switch", name], in: workingDir)
        return result.status == 0 ? nil : result.output.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func runGit(_ args: [String], in workingDir: String) -> String {
        return run(args, in: workingDir).output
    }

    private func run(_ args: [String], in workingDir: String) -> (status: Int32, output: String) {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = args
        process.currentDirectoryURL = URL(fileURLWithPath: workingDir)
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            return (process.terminationStatus, String(data: data, encoding: .utf8) ?? "")
        } catch {
            return (-1, "")
        }
    }
}
