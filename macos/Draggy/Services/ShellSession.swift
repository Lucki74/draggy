import Foundation
import OSLog

@MainActor
@Observable
public final class ShellSession: Identifiable {
    public let id: UUID
    public let shell: ShellInfo
    public var output: String = ""
    public var isRunning: Bool = false
    public var workingDirectory: String
    /// When set, the shell runs under sandbox-exec with this spec; nil keeps the unboxed shell.
    public var sandbox: SandboxSpec?

    private var process: Process?
    private var inputPipe: Pipe?
    private var outputPipe: Pipe?

    public init(
        shell: ShellInfo = ShellDetection.shared.defaultShell(),
        workingDirectory: String = FileManager.default.currentDirectoryPath,
        sandbox: SandboxSpec? = nil
    ) {
        self.id = UUID()
        self.shell = shell
        self.workingDirectory = workingDirectory
        self.sandbox = sandbox
    }

    public func start() {
        guard !isRunning else { return }

        let process = Process()
        let inPipe = Pipe()
        let outPipe = Pipe()

        var env = ProcessInfo.processInfo.environment
        env["TERM"] = "xterm-256color"
        var launch: (executable: String, arguments: [String]) = (shell.path, ["-l"])
        if let sandbox {
            guard SandboxPolicy.isAvailable() else {
                Logger.shell.error("Shell not started, sandbox unavailable")
                output.append("The sandbox is not available, so the shell was not started.\n")
                return
            }
            env = SandboxPolicy.scrubEnv(env)
            launch = SandboxPolicy.wrap(sandbox, command: [shell.path, "-l"])
        }

        process.executableURL = URL(fileURLWithPath: launch.executable)
        process.arguments = launch.arguments
        process.currentDirectoryURL = URL(fileURLWithPath: workingDirectory)
        process.environment = env

        process.standardInput = inPipe
        process.standardOutput = outPipe
        process.standardError = outPipe

        outPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.output.append(text)
                if self.output.count > 200_000 {
                    self.output = String(self.output.suffix(100_000))
                }
            }
        }

        process.terminationHandler = { [weak self] proc in
            let status = proc.terminationStatus
            Logger.shell.info("Shell exited with status \(status, privacy: .public)")
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.isRunning = false
                self.outputPipe?.fileHandleForReading.readabilityHandler = nil
            }
        }

        do {
            try process.run()
            self.process = process
            self.inputPipe = inPipe
            self.outputPipe = outPipe
            self.isRunning = true
            Logger.shell.info("Shell started, sandboxed \(self.sandbox != nil, privacy: .public)")
        } catch {
            Logger.shell.error("Failed to start shell: \(error.localizedDescription, privacy: .public)")
            self.output.append("Failed to start shell: \(error.localizedDescription)\n")
            self.isRunning = false
        }
    }

    public func writeInput(_ text: String) {
        guard isRunning, let data = text.data(using: .utf8) else { return }
        inputPipe?.fileHandleForWriting.write(data)
    }

    public func terminate() {
        guard isRunning else { return }
        process?.terminate()
        Logger.shell.info("Shell terminated by request")
        isRunning = false
    }
}
