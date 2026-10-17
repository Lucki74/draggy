import AppKit
import DraggyCore
import Foundation
import Metal
import Observation

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

    var binaryPath: String {
        didSet { defaults.set(binaryPath, forKey: Key.binary) }
    }

    var modelPath: String {
        didSet { defaults.set(modelPath, forKey: Key.modelFile) }
    }

    var isBusy: Bool { phase == .starting }

    var isRunning: Bool {
        if case .running = phase { return true }
        return false
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        binaryPath = defaults.string(forKey: Key.binary) ?? ""
        modelPath = defaults.string(forKey: Key.modelFile) ?? ""
    }

    func start() async {
        guard !isBusy, !binaryPath.isEmpty, !modelPath.isEmpty else { return }
        phase = .starting
        let engine = currentEngine()
        do {
            let info = try await engine.start(
                binary: binaryPath,
                model: modelPath,
                contextTokens: nil,
                gpuMemoryGb: Self.gpuMemoryGB()
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

    /// Unified memory the GPU may use, in GiB.
    private static func gpuMemoryGB() -> Double {
        guard let device = MTLCreateSystemDefaultDevice() else { return 0 }
        return Double(device.recommendedMaxWorkingSetSize) / 1_073_741_824
    }
}
