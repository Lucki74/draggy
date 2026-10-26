import Foundation

public struct ShellInfo: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let path: String
    public let isDefault: Bool

    public init(id: String, name: String, path: String, isDefault: Bool = false) {
        self.id = id
        self.name = name
        self.path = path
        self.isDefault = isDefault
    }
}

public final class ShellDetection: Sendable {
    public static let shared = ShellDetection()

    public init() {}

    public func defaultShell() -> ShellInfo {
        let envShell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let name = (envShell as NSString).lastPathComponent
        return ShellInfo(id: name, name: name, path: envShell, isDefault: true)
    }

    public func availableShells() -> [ShellInfo] {
        var shells: [ShellInfo] = []
        let defaultPath = defaultShell().path

        if let content = try? String(contentsOfFile: "/etc/shells", encoding: .utf8) {
            let lines = content.components(separatedBy: .newlines)
            for line in lines {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
                if FileManager.default.isExecutableFile(atPath: trimmed) {
                    let name = (trimmed as NSString).lastPathComponent
                    shells.append(ShellInfo(
                        id: trimmed,
                        name: name,
                        path: trimmed,
                        isDefault: trimmed == defaultPath
                    ))
                }
            }
        }

        if shells.isEmpty {
            shells.append(defaultShell())
        }
        return shells
    }
}
