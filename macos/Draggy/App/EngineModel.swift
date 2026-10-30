import AppKit
import DraggyCore
import Foundation
import Metal
import Observation

/// Forwards the engine download's progress to the main actor. The core calls it from the install's own thread.
private final class InstallSink: InstallObserver, @unchecked Sendable {
    private let show: @MainActor @Sendable (InstallProgressRecord) -> Void

    init(show: @escaping @MainActor @Sendable (InstallProgressRecord) -> Void) {
        self.show = show
    }

    func onProgress(progress: InstallProgressRecord) {
        let show = show
        Task { @MainActor in show(progress) }
    }
}

/// Forwards the steps of a model load to the main actor. The core calls it from the load's own thread.
private final class LoadSink: LoadObserver, @unchecked Sendable {
    private let show: @MainActor @Sendable (LoadStageRecord) -> Void

    init(show: @escaping @MainActor @Sendable (LoadStageRecord) -> Void) {
        self.show = show
    }

    func onStage(stage: LoadStageRecord) {
        let show = show
        Task { @MainActor in show(stage) }
    }
}

/// Runs the local llama-server for the chat: which program and model file, and whether it is up.
@MainActor
@Observable
final class EngineModel {
    enum Phase: Equatable {
        case stopped
        case starting
        case running(String)
        case failed(String)
    }

    private enum Key {
        static let binary = "engineBinary"
        static let modelFile = "engineModelFile"
    }

    private let defaults: UserDefaults
    @ObservationIgnored private var engine: LocalEngine?
    @ObservationIgnored private var quitObserver: (any NSObjectProtocol)?
    /// Called when a server is up, with the address and model name the chat should use.
    @ObservationIgnored var onReady: (EngineInfo) -> Void = { _ in }

    private(set) var phase = Phase.stopped
    /// The engine download, as a percentage. Nil when none is running.
    private(set) var installPercent: Double?
    private(set) var installError: String?
    /// The current step of a model load, with numbers measured from the engine. Nil outside a load.
    private(set) var loadStage: String?

    var binaryPath: String {
        didSet { defaults.set(binaryPath, forKey: Key.binary) }
    }

    var modelPath: String {
        didSet { defaults.set(modelPath, forKey: Key.modelFile) }
    }

    /// True on Apple silicon, where MLX models can run. Elsewhere an MLX model is refused and never falls back to llama.cpp.
    var supportsMLX: Bool { mlxSupported() }

    /// The engine a model of `format` ("gguf" or "mlx") runs on. Throws for MLX where it cannot run.
    func engineName(forFormat format: String) throws -> String {
        try engineForModelFormat(format: format)
    }

    var isBusy: Bool { phase == .starting }

    var isInstalling: Bool { installPercent != nil }

    var isRunning: Bool {
        if case .running = phase { return true }
        return false
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        binaryPath = defaults.string(forKey: Key.binary) ?? ""
        modelPath = defaults.string(forKey: Key.modelFile) ?? ""
    }

    /// Downloads the llama.cpp engine into Application Support when it is not there yet, and points the app at it.
    func installEngine() async {
        guard !isInstalling else { return }
        installError = nil
        installPercent = 0
        defer { installPercent = nil }
        do {
            let support = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
            ).appendingPathComponent("Draggy", isDirectory: true)
            let installer = try EngineInstaller(userData: support.path)
            let sink = InstallSink { [weak self] progress in self?.installPercent = progress.percent }
            let installed = try await installer.install(gpuMemoryGb: Self.gpuMemoryGB(), observer: sink)
            binaryPath = installed.binaryPath
        } catch let error as CoreError {
            installError = AppModel.message(for: error)
        } catch {
            installError = error.localizedDescription
        }
    }

    func start() async {
        guard !isBusy, !binaryPath.isEmpty, !modelPath.isEmpty else { return }
        phase = .starting
        loadStage = nil
        defer { loadStage = nil }
        let engine = currentEngine()
        let sink = LoadSink { [weak self] stage in self?.loadStage = Self.loadText(stage) }
        do {
            let info = try await engine.start(
                binary: binaryPath,
                model: modelPath,
                contextTokens: nil,
                gpuMemoryGb: Self.gpuMemoryGB(),
                observer: sink
            )
            phase = .running(info.model)
            onReady(info)
        } catch let error as CoreError {
            phase = .failed(AppModel.message(for: error))
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    func stop() async {
        guard let engine else { return }
        await engine.stop()
        phase = .stopped
    }

    private func currentEngine() -> LocalEngine {
        if let engine { return engine }
        let created = LocalEngine(host: EngineHost(
            totalRamBytes: ProcessInfo.processInfo.physicalMemory,
            gpuMemoryGb: Self.gpuMemoryGB()
        ))
        engine = created
        // The server is a child process; it must not outlive the app.
        quitObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.willTerminateNotification, object: nil, queue: .main
        ) { _ in
            let done = DispatchSemaphore(value: 0)
            Task.detached {
                await created.stop()
                done.signal()
            }
            _ = done.wait(timeout: .now() + 3)
        }
        return created
    }

    /// The words for one load step. A step with no measured number shows none.
    static func loadText(_ stage: LoadStageRecord) -> String {
        let model = stage.model
        let percent = stage.percent.map { Int($0) }
        switch stage.kind {
        case .disk:
            return String(localized: "Getting \(model) from disk\u{2026}")
        case .ram:
            guard let percent else { return String(localized: "Loading \(model) into RAM\u{2026}") }
            return String(localized: "Loading \(model) into RAM \(percent)%\u{2026}")
        case .extending:
            guard let percent else { return String(localized: "Extending context\u{2026}") }
            return String(localized: "Extending context \(percent)%\u{2026}")
        case .reading:
            let shown = percent ?? 0
            guard let rate = stage.tokensPerSecond else { return String(localized: "Reading \(shown)%\u{2026}") }
            let speed = Int(rate.rounded())
            return String(localized: "Reading \(shown)% (\(speed) tok/s)\u{2026}")
        case .readying:
            return String(localized: "\(model) is readying\u{2026}")
        }
    }

    /// Unified memory the GPU may use, in GiB.
    private static func gpuMemoryGB() -> Double {
        guard let device = MTLCreateSystemDefaultDevice() else { return 0 }
        return Double(device.recommendedMaxWorkingSetSize) / 1_073_741_824
    }
}
