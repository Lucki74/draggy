import Foundation

public struct GitCommit: Identifiable, Sendable {
    public let id: String
    public let hash: String
    public let author: String
    public let date: String
    public let message: String
}

public struct GitStatusSummary: Sendable {
    public let modified: [String]
    public let staged: [String]
    public let untracked: [String]
}

public final class GitOperations: Sendable {
    public static let shared = GitOperations()

    public init() {}

    public func diff(in workingDir: String) -> String {
        return runGit(["diff"], in: workingDir)
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

    public func log(in workingDir: String, maxCount: Int = 20) -> [GitCommit] {
        let output = runGit(["log", "-n", "\(maxCount)", "--pretty=format:%H|%an|%ad|%s", "--date=short"], in: workingDir)
        var commits: [GitCommit] = []
        for line in output.components(separatedBy: .newlines) {
            let parts = line.components(separatedBy: "|")
            if parts.count >= 4 {
                commits.append(GitCommit(
                    id: parts[0],
                    hash: String(parts[0].prefix(7)),
                    author: parts[1],
                    date: parts[2],
                    message: parts[3]
                ))
            }
        }
        return commits
    }

    private func runGit(_ args: [String], in workingDir: String) -> String {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = args
        process.currentDirectoryURL = URL(fileURLWithPath: workingDir)
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return String(data: data, encoding: .utf8) ?? ""
        } catch {
            return ""
        }
    }
}
