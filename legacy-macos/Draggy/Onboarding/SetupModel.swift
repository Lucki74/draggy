import DraggyCore
import Foundation
import Observation

/// The first-run setup of win/src/onboarding: which screens show, when each may be left, and the
/// downloads it starts. Nothing is downloaded until the user leaves the model step with Continue.
@MainActor
@Observable
final class SetupModel {
    enum Step: CaseIterable, Sendable { case welcome, appearance, source, local, provider, preferences, ready }

    /// Where the AI runs, as the user chose on the source step.
    enum Path: Sendable { case local, provider, both }

    private enum Key {
        static let done = "setupDone"
    }

    static func steps(for path: Path) -> [Step] {
        switch path {
        case .local: [.welcome, .appearance, .source, .local, .preferences, .ready]
        case .provider: [.welcome, .appearance, .source, .provider, .preferences, .ready]
        case .both: [.welcome, .appearance, .source, .local, .provider, .preferences, .ready]
        }
    }

    @ObservationIgnored private let defaults: UserDefaults

    var isShowing = false
    var step: Step = .welcome
    var path: Path = .local
    /// The model picked on the model step: a rung to download, or one already on disk.
    var choice: ModelRung?
    var installedChoice: InstalledModelRecord?
    var providerURL = ""
    var providerModel = ""
    var providerKey = ""
    /// The catalog entry the provider step picked. Nil with nothing picked yet.
    var providerID: String?
    /// Local servers that answered the scan, with the models each lists.
    private(set) var localServers: [(entry: ProviderEntry, models: [String])] = []
    private(set) var isScanning = false
    /// Whether Hugging Face answered. Nil while the check runs.
    private(set) var online: Bool?
    var isSearchingHub = false
    var startMode: AppMode = .chat
    var isConfirmingSkip = false
    private(set) var downloadsStarted = false

    /// This Mac, read once: unified memory in GB, chip name, free space where models are kept.
    let memoryGB: Double
    let chip: String
    private(set) var freeBytes: Int64?

    var steps: [Step] { Self.steps(for: path) }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        memoryGB = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824
        chip = Self.chipName()
    }

    /// Opens the setup on a fresh install. Settings, models or chats already here adopt it unasked.
    func showIfNeeded(_ app: AppModel) {
        guard !defaults.bool(forKey: Key.done) else { return }
        app.models.refreshInstalled()
        let fresh = app.conversations.isEmpty && app.engine.modelPath.isEmpty && app.models.installed.isEmpty
        if fresh {
            restart()
        } else {
            defaults.set(true, forKey: Key.done)
        }
    }

    /// Settings → Run setup again.
    func restart() {
        step = .welcome
        isConfirmingSkip = false
        refreshDisk()
        checkOnline()
        scanServers()
        if choice == nil { choice = ModelLadder.recommended(memoryGB: memoryGB, chip: chip) }
        isShowing = true
    }

    func fitsOnDisk(_ rung: ModelRung) -> Bool {
        guard let freeBytes else { return true }
        return rung.sizeBytes < freeBytes
    }

    func canContinue(_ app: AppModel) -> Bool {
        switch step {
        case .welcome, .appearance, .source, .preferences:
            return true
        case .local:
            // A model already here needs nothing; a download needs room and Hugging Face.
            if installedChoice != nil { return true }
            return (choice.map(fitsOnDisk) ?? false) && online == true
        case .provider:
            let needsKey = selectedProvider?.needsKey ?? false
            return !providerURL.trimmingCharacters(in: .whitespaces).isEmpty
                && !providerModel.trimmingCharacters(in: .whitespaces).isEmpty
                && (!needsKey || !providerKey.isEmpty)
        case .ready:
            return path == .provider || downloadsStarted
        }
    }

    func next(_ app: AppModel) {
        guard canContinue(app) else { return }
        if step == .local { startDownloads(app) }
        let all = steps
        if let index = all.firstIndex(of: step), all.indices.contains(index + 1) { step = all[index + 1] }
    }

    func back() {
        let all = steps
        if let index = all.firstIndex(of: step), index > 0 { step = all[index - 1] }
    }

    /// Engine and model come down together, then the engine loads the model. The app can open meanwhile.
    func startDownloads(_ app: AppModel) {
        guard !downloadsStarted else { return }
        downloadsStarted = true
        let installed = installedChoice
        let reference = choice?.reference
        Task {
            async let engineReady: Void = app.engine.binaryPath.isEmpty ? app.engine.installEngine() : ()
            if let installed {
                app.models.use(installed)
            } else if let reference {
                await app.models.download(reference)
            }
            await engineReady
            guard !app.engine.binaryPath.isEmpty, !app.engine.modelPath.isEmpty, !app.engine.isRunning else { return }
            await app.engine.start()
        }
    }

    /// Applies the choices and opens the app. A provider answers at once; a local model when it lands.
    func finish(_ app: AppModel) {
        if path != .local {
            let address = providerURL.trimmingCharacters(in: .whitespaces)
            if !address.isEmpty { app.baseURL = address }
            let name = providerModel.trimmingCharacters(in: .whitespaces)
            if !name.isEmpty { app.modelName = name }
            if !providerKey.isEmpty { app.saveAPIKey(providerKey) }
            providerKey = ""
        }
        app.switchMode(startMode)
        defaults.set(true, forKey: Key.done)
        isShowing = false
    }

    /// Skip: the recommended model for this Mac comes down, or the one already here is used.
    func skip(_ app: AppModel) {
        path = .local
        if installedChoice == nil, app.models.installed.isEmpty {
            choice = choice ?? ModelLadder.recommended(memoryGB: memoryGB, chip: chip)
        } else if installedChoice == nil {
            installedChoice = app.models.installed.first
        }
        startDownloads(app)
        finish(app)
    }

    var selectedProvider: ProviderEntry? {
        providerID.flatMap { id in ProviderCatalog.usable().first { $0.id == id } }
    }

    /// The models the picked provider offers to start with: what a local server lists, or the catalog's picks.
    var providerModels: [String] {
        guard let entry = selectedProvider else { return [] }
        if entry.isLocal { return localServers.first { $0.entry.id == entry.id }?.models ?? [] }
        return entry.defaultModels ?? []
    }

    func pickProvider(_ entry: ProviderEntry) {
        providerID = entry.id
        providerURL = entry.chatURL ?? ""
        providerKey = ""
        providerModel = providerModels.first ?? ""
    }

    func checkOnline() {
        online = nil
        Task { online = await SetupProbe.huggingFaceReachable() }
    }

    func scanServers() {
        guard !isScanning else { return }
        isScanning = true
        Task {
            localServers = await SetupProbe.scanLocal().map { (entry: $0.0, models: $0.1) }
            isScanning = false
        }
    }

    /// A model found by search: a rung with only its reference, sized as unknown.
    func chooseSearched(_ reference: String) {
        installedChoice = nil
        choice = ModelRung(reference: reference, label: reference, params: "", sizeGB: 0, kind: .dense, memory: 0)
    }

    private func refreshDisk() {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let values = try? folder.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        freeBytes = values?.volumeAvailableCapacityForImportantUsage
    }

    private static func chipName() -> String {
        var size = 0
        guard sysctlbyname("machdep.cpu.brand_string", nil, &size, nil, 0) == 0, size > 0 else { return "" }
        var bytes = [CChar](repeating: 0, count: size)
        guard sysctlbyname("machdep.cpu.brand_string", &bytes, &size, nil, 0) == 0 else { return "" }
        return String(cString: bytes)
    }
}
