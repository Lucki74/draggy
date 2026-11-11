import Foundation
import OSLog

/// What a sandboxed shell may see and do. Mirrors `SandboxSpec` in core/crates/tools/src/sandbox.rs: the same
/// scrub rules and the same Seatbelt profile, pinned by shared/fixtures/sandbox/policy.json.
public struct SandboxSpec: Equatable, Sendable {
    public var project: String
    public var cwd: String
    /// Folders the command may read, such as toolchains.
    public var readOnly: [String]
    /// Folders the command may write: the project, plus its own scratch folder.
    public var readWrite: [String]
    public var network: Bool

    public init(project: String, cwd: String, readOnly: [String], readWrite: [String], network: Bool) {
        self.project = project
        self.cwd = cwd
        self.readOnly = readOnly
        self.readWrite = readWrite
        self.network = network
    }
}

/// Builds the `sandbox-exec` launch for a shell. Fails closed: callers must refuse to run when `isAvailable()` is false.
public enum SandboxPolicy {
    public static let sandboxExecPath = "/usr/bin/sandbox-exec"

    private static let secretSegments: Set<String> = [
        "KEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD", "CREDENTIAL", "CREDENTIALS", "AUTH",
    ]
    private static let secretPrefixes = ["AWS_", "AZURE_", "GCP_", "DRAGGY_"]
    private static let systemFolders = [
        "/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", "/dev", "/private/var/db",
    ]

    public static func isAvailable() -> Bool {
        let available = FileManager.default.isExecutableFile(atPath: sandboxExecPath)
        if !available {
            Logger.sandbox.error("sandbox-exec is not executable, sandbox unavailable")
        }
        return available
    }

    /// True when the name looks like a key, token or credential, matched per `_` segment, case-insensitively.
    public static func isSecretName(_ name: String) -> Bool {
        let upper = name.uppercased()
        if secretPrefixes.contains(where: { upper.hasPrefix($0) }) {
            return true
        }
        if upper.hasSuffix("APIKEY") {
            return true
        }
        return upper.split(separator: "_", omittingEmptySubsequences: false).contains { part in
            secretSegments.contains(String(part))
        }
    }

    public static func scrubEnv(_ env: [String: String]) -> [String: String] {
        env.filter { !isSecretName($0.key) }
    }

    /// A profile that denies everything, then allows reading the system and the listed folders, and writing only
    /// the read-write ones. Same lines as `seatbelt_profile` in the Rust core.
    public static func seatbeltProfile(_ spec: SandboxSpec) -> String {
        var lines = [
            "(version 1)",
            "(deny default)",
            "(allow process-fork)",
            "(allow process-exec)",
            "(allow sysctl-read)",
            "(allow mach-lookup)",
            "(allow signal (target self))",
            "(allow file-read-metadata)",
        ]
        for system in systemFolders {
            lines.append("(allow file-read* (subpath \"\(system)\"))")
        }
        for folder in spec.readOnly {
            lines.append("(allow file-read* (subpath \"\(quote(folder))\"))")
        }
        for folder in spec.readWrite {
            lines.append("(allow file-read* file-write* (subpath \"\(quote(folder))\"))")
        }
        lines.append("(allow file-write* (literal \"/dev/null\"))")
        if spec.network {
            lines.append("(allow network*)")
        }
        return lines.joined(separator: "\n") + "\n"
    }

    /// The executable and arguments that run `command` inside the sandbox.
    public static func wrap(_ spec: SandboxSpec, command: [String]) -> (executable: String, arguments: [String]) {
        Logger.sandbox.debug("Wrapping command in sandbox, network \(spec.network, privacy: .public), readOnly \(spec.readOnly.count, privacy: .public), readWrite \(spec.readWrite.count, privacy: .public)")
        return (sandboxExecPath, ["-p", seatbeltProfile(spec), "--"] + command)
    }

    private static func quote(_ path: String) -> String {
        path.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    }
}
