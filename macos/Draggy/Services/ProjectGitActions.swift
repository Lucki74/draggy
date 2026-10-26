import Foundation

public final class ProjectGitActions: Sendable {
    public static let shared = ProjectGitActions()

    public init() {}

    public func stage(files: [String], in dir: String) {
        _ = runGit(["add"] + files, in: dir)
    }

    public func commit(message: String, in dir: String) {
        _ = runGit(["commit", "-m", message], in: dir)
    }

    public func pull(in dir: String) {
        _ = runGit(["pull"], in: dir)
    }

    public func push(in dir: String) {
        _ = runGit(["push"], in: dir)
    }

    private func runGit(_ args: [String], in workingDir: String) -> String {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = args
        process.currentDirectoryURL = URL(fileURLWithPath: workingDir)
        process.standardOutput = pipe
        process.standardError = pipe
        try? process.run()
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8) ?? ""
    }
}
