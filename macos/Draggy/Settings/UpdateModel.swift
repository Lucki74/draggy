import AppKit
import DraggyCore
import Foundation
import Observation

/// Handles launch checks, background downloads, SHA-256 verification and in-place bundle swapping.
@MainActor
@Observable
final class UpdateModel {
    private static let repository = "Lucki74/draggy"
    private static let tagPrefix = "b-"

    private let checker: UpdateChecker?
    private let currentBuild: UInt32

    private(set) var available: UpdateRecord?
    var isDismissed = false
    var isUpdating = false
    var isReadyToRestart = false
    var isNotWritable = false
    var downloadProgress: Double = 0.0
    var statusMessage: String = ""

    private var pendingNewAppURL: URL?
    private var updateWindow: NSWindow?

    init(bundle: Bundle = .main) {
        currentBuild = UInt32(bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0
        checker = try? UpdateChecker(repository: Self.repository, tagPrefix: Self.tagPrefix)
    }

    private var isPackaged: Bool {
        #if DEBUG
        return false
        #else
        return Bundle.main.bundleURL.pathExtension == "app"
        #endif
    }

    /// Checks for updates at startup with a 4 second budget.
    func start() async {
        guard isPackaged, let checker else { return }

        let foundUpdate: UpdateRecord? = await withTaskGroup(of: UpdateRecord?.self) { group in
            group.addTask {
                try? await checker.check(currentBuild: self.currentBuild, includePrereleases: true)
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                return nil
            }
            if let first = await group.next() {
                group.cancelAll()
                return first
            }
            return nil
        }

        if let update = foundUpdate {
            await performLaunchUpdate(update)
        } else {
            startPeriodicChecks()
        }
    }

    /// Background check every 6 hours.
    private func startPeriodicChecks() {
        Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 6 * 3600 * 1_000_000_000)
                await self?.checkBackground()
            }
        }
    }

    func check() async {
        await start()
    }

    private func checkBackground() async {
        guard isPackaged, let checker, available == nil else { return }
        guard let update = try? await checker.check(currentBuild: currentBuild, includePrereleases: true) else {
            return
        }
        await prepareUpdate(update, isLaunch: false)
    }

    private func performLaunchUpdate(_ update: UpdateRecord) async {
        openUpdateWindow(update)
        await prepareUpdate(update, isLaunch: true)
    }

    private func prepareUpdate(_ update: UpdateRecord, isLaunch: Bool) async {
        guard let checker else { return }
        available = update

        let appParent = Bundle.main.bundleURL.deletingLastPathComponent()
        if !FileManager.default.isWritableFile(atPath: appParent.path) {
            isNotWritable = true
            closeUpdateWindow()
            return
        }

        let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

        let observer = UpdateObserverBridge { [weak self] record in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if let total = record.totalBytes, total > 0 {
                    self.downloadProgress = Double(record.bytes) / Double(total)
                }
                self.statusMessage = record.phase == "verify" ? "Verifying…" : "Downloading…"
                self.updateWindowView()
            }
        }

        do {
            let zipPath = try await checker.downloadUpdate(update: update, destDir: tempDir.path, observer: observer)
            let unpackDir = tempDir.appendingPathComponent("unpacked")
            try FileManager.default.createDirectory(at: unpackDir, withIntermediateDirectories: true)

            let ditto = Process()
            ditto.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            ditto.arguments = ["-x", "-k", zipPath, unpackDir.path]
            try ditto.run()
            ditto.waitUntilExit()

            let newAppURL = unpackDir.appendingPathComponent("Draggy.app")
            guard FileManager.default.fileExists(atPath: newAppURL.path) else {
                throw NSError(domain: "DraggyUpdate", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unpacked app missing"])
            }

            self.pendingNewAppURL = newAppURL
            self.isReadyToRestart = true

            if isLaunch {
                statusMessage = "Restarting…"
                updateWindowView()
                applyRestart()
            }
        } catch {
            closeUpdateWindow()
        }
    }

    func applyRestart() {
        guard let newAppURL = pendingNewAppURL else { return }
        let currentAppURL = Bundle.main.bundleURL
        let pid = ProcessInfo.processInfo.processIdentifier

        let script = """
        while kill -0 "$1" 2>/dev/null; do sleep 0.1; done
        rm -rf "$2"
        mv "$3" "$2"
        open "$2"
        """

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", script, "sh", "\(pid)", currentAppURL.path, newAppURL.path]
        try? process.run()
        NSApp.terminate(nil)
    }

    private func openUpdateWindow(_ update: UpdateRecord) {
        isUpdating = true
        statusMessage = "Downloading…"
        downloadProgress = 0.0

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 160),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Updating Draggy"
        window.center()
        window.isReleasedWhenClosed = false
        self.updateWindow = window
        updateWindowView()
        window.makeKeyAndOrderFront(nil)
    }

    private func updateWindowView() {
        guard let window = updateWindow else { return }
        let view = UpdateProgressView(progress: downloadProgress, status: statusMessage)
        window.contentView = NSHostingView(rootView: view)
    }

    private func closeUpdateWindow() {
        isUpdating = false
        updateWindow?.close()
        updateWindow = nil
    }
}

private final class UpdateObserverBridge: UpdateObserver, @unchecked Sendable {
    private let callback: @Sendable (UpdateProgressRecord) -> Void

    init(callback: @escaping @Sendable (UpdateProgressRecord) -> Void) {
        self.callback = callback
    }

    func onProgress(progress: UpdateProgressRecord) {
        callback(progress)
    }
}
