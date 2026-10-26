import Foundation

@MainActor
@Observable
public final class ShellSession: Identifiable {
    public let id: UUID
    public let shell: ShellInfo
    public var output: String = ""
    public var isRunning: Bool = false
    public var workingDirectory: String

    private var process: Process?
    private var inputPipe: Pipe?
    private var outputPipe: Pipe?

    public init(shell: ShellInfo = ShellDetection.shared.defaultShell(), workingDirectory: String = FileManager.default.currentDirectoryPath) {
        self.id = UUID()
        self.shell = shell
        self.workingDirectory = workingDirectory
    }

    public func start() {
        guard !isRunning else { return }

        let process = Process()
        let inPipe = Pipe()
        let outPipe = Pipe()

        process.executableURL = URL(fileURLWithPath: shell.path)
        process.arguments = ["-l"]
        process.currentDirectoryURL = URL(fileURLWithPath: workingDirectory)

        var env = ProcessInfo.processInfo.environment
        env["TERM"] = "xterm-256color"
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

        process.terminationHandler = { [weak self] _ in
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
        } catch {
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
        isRunning = false
    }
}
