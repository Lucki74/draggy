import DraggyCore
import Foundation
import Observation

/// What one batch of core events changes in the open reply.
struct TurnUpdate: Sendable {
    var text: String?
    var steps: [Transcript.Step]?
    var speed: Double?

    var isEmpty: Bool { text == nil && steps == nil && speed == nil }
}

/// Forwards a turn's batched events to the main actor. The core calls it from its own thread.
private final class EventSink: TurnObserver, @unchecked Sendable {
    private let show: @MainActor @Sendable (TurnUpdate) -> Void

    init(show: @escaping @MainActor @Sendable (TurnUpdate) -> Void) {
        self.show = show
    }

    func onEvents(events: [TurnEventRecord]) {
        var update = TurnUpdate()
        for event in events {
            switch event {
            case let .patch(_, textContent, steps):
                update.text = textContent
                update.steps = steps.map(transcriptStep)
            case let .steps(steps):
                update.steps = steps.map(transcriptStep)
            case let .live(live):
                update.speed = live.tokensPerSecond
            case let .metrics(metrics):
                update.speed = metrics.tokensPerSecond
            default:
                break
            }
        }
        guard !update.isEmpty else { return }
        let show = show
        let sent = update
        Task { @MainActor in show(sent) }
    }
}

private func transcriptStep(_ record: StepRecord) -> Transcript.Step {
    let firstLine = record.content?.split(separator: "\n", maxSplits: 1).first.map(String.init)
    let isThinking = record.kind == "thinking"
    let target = isThinking ? nil : record.filename ?? record.filepath ?? firstLine
    let label = target.map { "\(record.kind) \($0)" } ?? record.kind
    let detail = [record.content, record.stdout, record.stderr]
        .compactMap { $0 }
        .filter { !$0.isEmpty }
        .joined(separator: "\n")
    return Transcript.Step(kind: record.kind, label: label, isDone: record.isComplete ?? true, detail: detail)
}

/// How the model's tool calls are decided, as the settings offer it. Running everything unasked is left out.
enum PermissionChoice: String, CaseIterable, Identifiable {
    case ask
    case acceptEdits
    case plan

    var id: String { rawValue }

    var title: String {
        switch self {
        case .ask: String(localized: "Ask before edits and commands")
        case .acceptEdits: String(localized: "Edit freely, ask before commands")
        case .plan: String(localized: "Read only")
        }
    }

    var record: PermissionModeRecord {
        switch self {
        case .ask: .ask
        case .acceptEdits: .acceptEdits
        case .plan: .plan
        }
    }
}

@MainActor
@Observable
final class AppModel {
    private enum Key {
        static let baseURL = "serverURL"
        static let model = "modelName"
        static let folder = "projectFolder"
        static let commands = "allowCommands"
        static let permission = "permissionMode"
        static let apiKey = "provider-api-key"
        static let braveKey = "brave-search-key"
        static let web = "webEnabled"
        static let searchProvider = "searchProvider"
        static let searxng = "searxngURL"
        static let agyOn = "agyOn"
        static let speakReplies = "speakReplies"
        static let agyModel = "agyModel"
    }

    private let defaults: UserDefaults
    private let secrets: any SecretStore
    let engine: EngineModel
    let models: ModelsModel
    let updates = UpdateModel()
    let skills = SkillsModel()
    let mcp = McpModel(manager: try? McpManager(nodePath: nil, extensionsDir: nil))
    let browser = BrowserModel()
    let agy = AgyModel()
    private var session: Session?
    /// The plan the model keeps for this conversation.
    private(set) var plan: [PlanStepRecord] = []
    private var cancel: CancelToken?
    @ObservationIgnored private var broker: ApprovalBroker?

    @ObservationIgnored private let library: ConversationLibrary
    private var currentID = UUID()
    private(set) var conversations: [ConversationSummary] = []
    private(set) var transcript: Transcript
    private(set) var isRunning = false
    private(set) var errorMessage: String?
    var talkPhase = TalkPhase.off
    var lastReply = ""
    @ObservationIgnored let listener = SpeechListener()

    func report(_ message: String?) { errorMessage = message }
    /// The tool call that is waiting for the user's answer.
    private(set) var pendingApproval: ApprovalRecord?

    var draft = ""
    /// Pictures waiting to go with the next message.
    private(set) var pendingImages: [ImageRecord] = []

    var baseURL: String {
        didSet {
            defaults.set(baseURL, forKey: Key.baseURL)
            session = nil
        }
    }

    var modelName: String {
        didSet {
            defaults.set(modelName, forKey: Key.model)
            session = nil
        }
    }

    /// The project folder the file tools may reach. Empty means no tools.
    var folderPath: String {
        didSet {
            defaults.set(folderPath, forKey: Key.folder)
            session = nil
        }
    }

    var allowCommands: Bool {
        didSet {
            defaults.set(allowCommands, forKey: Key.commands)
            session = nil
        }
    }

    /// Lets the model search the web and read pages.
    var webEnabled: Bool {
        didSet {
            defaults.set(webEnabled, forKey: Key.web)
            session = nil
        }
    }

    /// The id of a search engine, or empty for automatic.
    var searchProvider: String {
        didSet {
            defaults.set(searchProvider, forKey: Key.searchProvider)
            session = nil
        }
    }

    var searxngURL: String {
        didSet {
            defaults.set(searxngURL, forKey: Key.searxng)
            session = nil
        }
    }

    /// Reads each finished reply aloud with the system voice.
    var speakReplies: Bool {
        didSet {
            defaults.set(speakReplies, forKey: Key.speakReplies)
            if !speakReplies { speaker.stop() }
        }
    }

    @ObservationIgnored let speaker = ReplySpeaker()

    /// Sends chat through the Antigravity CLI. Needs a signed-in account.
    var agyEnabled: Bool {
        didSet {
            defaults.set(agyEnabled, forKey: Key.agyOn)
            session = nil
        }
    }

    var agyModel: String {
        didSet {
            defaults.set(agyModel, forKey: Key.agyModel)
            session = nil
        }
    }

    var permission: PermissionChoice {
        didSet {
            defaults.set(permission.rawValue, forKey: Key.permission)
            session = nil
        }
    }

    init(
        defaults: UserDefaults = .standard,
        secrets: any SecretStore = KeychainSecretStore(),
        library: ConversationLibrary = .standard
    ) {
        self.defaults = defaults
        self.secrets = secrets
        self.library = library
        let latest = library.list()
        conversations = latest
        if let first = latest.first { currentID = first.id }
        transcript = Transcript(restoring: latest.first.map { library.load($0.id) } ?? [])
        let engine = EngineModel(defaults: defaults)
        self.engine = engine
        models = ModelsModel { [weak engine] path in engine?.modelPath = path }
        baseURL = defaults.string(forKey: Key.baseURL) ?? "http://127.0.0.1:8080/v1"
        modelName = defaults.string(forKey: Key.model) ?? ""
        folderPath = defaults.string(forKey: Key.folder) ?? ""
        allowCommands = defaults.bool(forKey: Key.commands)
        webEnabled = defaults.bool(forKey: Key.web)
        searchProvider = defaults.string(forKey: Key.searchProvider) ?? ""
        searxngURL = defaults.string(forKey: Key.searxng) ?? ""
        permission = defaults.string(forKey: Key.permission).flatMap(PermissionChoice.init(rawValue:)) ?? .ask
        agyEnabled = defaults.bool(forKey: Key.agyOn)
        speakReplies = defaults.bool(forKey: Key.speakReplies)
        agyModel = defaults.string(forKey: Key.agyModel) ?? ""
        broker = ApprovalBroker { [weak self] request in
            self?.pendingApproval = request
        }
        engine.onReady = { [weak self] info in
            self?.baseURL = info.baseUrl
            self?.modelName = info.model
        }
    }

    func signOutAgy() {
        agy.signOut()
        agyEnabled = false
    }

    func hasAPIKey() -> Bool {
        ((try? secrets.secret(for: Key.apiKey)) ?? nil) != nil
    }

    func saveAPIKey(_ key: String) {
        do {
            try secrets.setSecret(key, for: Key.apiKey)
            session = nil
        } catch {
            errorMessage = String(localized: "The key could not be saved to the Keychain.")
        }
    }

    func hasBraveKey() -> Bool {
        ((try? secrets.secret(for: Key.braveKey)) ?? nil) != nil
    }

    /// An empty key removes the stored one.
    func saveBraveKey(_ key: String) {
        do {
            try secrets.setSecret(key.isEmpty ? nil : key, for: Key.braveKey)
            session = nil
        } catch {
            errorMessage = String(localized: "The key could not be saved to the Keychain.")
        }
    }

    /// The web settings for a session, or `nil` while the web is off.
    private func webConfig() -> WebConfigRecord? {
        guard webEnabled else { return nil }
        let brave = (try? secrets.secret(for: Key.braveKey)) ?? nil
        return WebConfigRecord(
            provider: searchProvider,
            searxngUrl: searxngURL.trimmingCharacters(in: .whitespacesAndNewlines),
            braveApiKey: brave ?? ""
        )
    }

    func newConversation() {
        guard !isRunning else { return }
        session = nil
        plan = []
        transcript = Transcript()
        currentID = UUID()
        errorMessage = nil
    }

    /// Shows a saved conversation. The core gets it back when the next message is sent.
    func open(_ id: UUID) {
        guard !isRunning, id != currentID else { return }
        session = nil
        currentID = id
        transcript = Transcript(restoring: library.load(id))
        errorMessage = nil
    }

    func delete(_ id: UUID) {
        guard !isRunning else { return }
        library.delete(id)
        if id == currentID { newConversation() }
        conversations = library.list()
    }

    private static let imageTypes = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                                     "gif": "image/gif", "webp": "image/webp"]
    private static let imageLimit = 10_000_000

    func removeImage(at index: Int) {
        guard pendingImages.indices.contains(index) else { return }
        pendingImages.remove(at: index)
    }

    /// Adds a picture to the next message.
    private func attachImage(_ url: URL, mime: String) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            errorMessage = String(localized: "The file could not be read.")
            return
        }
        guard data.count <= Self.imageLimit else {
            errorMessage = String(localized: "The picture is larger than 10 MB.")
            return
        }
        pendingImages.append(ImageRecord(name: url.lastPathComponent, mime: mime, data: data))
    }

    /// Adds a picture to the next message, or the text of a document to the message being written.
    func attach(_ url: URL) async {
        errorMessage = nil
        if let mime = Self.imageTypes[url.pathExtension.lowercased()] {
            attachImage(url, mime: mime)
            return
        }
        do {
            let text = try await readDocument(path: url.path)
            draft = Attachment.append(text, named: url.lastPathComponent, to: draft)
        } catch let error as CoreError {
            errorMessage = Self.message(for: error)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Stops the turn. A question that is waiting for the user is answered with no, so the turn can end.
    func stop() {
        speaker.stop()
        cancel?.cancel()
        answerApproval(.no)
    }

    /// Empties the plan; the model is told at its next turn.
    func clearPlan() {
        session?.clearPlan()
        plan = []
    }

    func answerApproval(_ choice: ApprovalChoice) {
        pendingApproval = nil
        broker?.resolve(choice)
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isRunning else { return }
        draft = ""
        let images = pendingImages
        pendingImages = []
        errorMessage = nil
        lastReply = ""
        isRunning = true
        defer {
            isRunning = false
            pendingApproval = nil
        }

        transcript.addUser(([text] + images.map { "[\($0.name)]" }).joined(separator: "\n"))
        transcript.beginReply()
        let token = CancelToken()
        cancel = token
        let sink = EventSink { [weak self] update in
            guard let self else { return }
            if let text = update.text { self.transcript.setReply(text) }
            if let steps = update.steps { self.transcript.setSteps(steps) }
            if let speed = update.speed { self.transcript.setSpeed(speed) }
            self.plan = self.session?.plan() ?? []
        }

        do {
            let session = try currentSession()
            let outcome = try await session.sendWithImages(
                text: text, images: images, observer: sink, approvals: broker, cancel: token)
            transcript.finishReply(outcome.textContent)
            lastReply = outcome.textContent
            if speakReplies, talkPhase == .off { speaker.speak(outcome.textContent) }
            transcript.setSteps(outcome.steps.map(transcriptStep))
            plan = session.plan()
        } catch let error as CoreError {
            errorMessage = Self.message(for: error)
        } catch {
            errorMessage = error.localizedDescription
        }
        cancel = nil
        library.save(transcript.savedMessages, as: currentID)
        conversations = library.list()
    }

    private func currentSession() throws -> Session {
        if let session { return session }
        // The key is read only here, while the request is being set up.
        let key = (try? secrets.secret(for: Key.apiKey)) ?? nil
        let folder = folderPath.isEmpty ? nil : folderPath
        let agyRoute = agyEnabled ? agy.config(model: agyModel) : nil
        let config = agyRoute.map {
            SessionConfig(
                baseUrl: "",
                model: "",
                apiKey: nil,
                folder: nil,
                contextTokens: nil,
                loopLimit: nil,
                allowCommands: false,
                permissionMode: PermissionChoice.ask.record,
                web: nil,
                agy: $0
            )
        } ?? SessionConfig(
            baseUrl: baseURL,
            model: modelName,
            apiKey: key,
            folder: folder,
            contextTokens: nil,
            loopLimit: nil,
            allowCommands: allowCommands && folder != nil,
            permissionMode: permission.record,
            web: webConfig(),
            agy: nil,
            skillsDir: SkillsModel.standardDirectory
        )
        let created: Session
        if let manager = mcp.manager {
            created = try Session.withMcp(config: config, mcp: manager)
        } else {
            created = try Session(config: config)
        }
        // The reply being filled is not finished yet, so only the exchanges before this send go to the core.
        let earlier = Transcript(restoring: transcript.savedMessages)
        let records = earlier.lines.enumerated().map { index, line in
            MessageRecord(id: "m\(index + 1)", role: line.role == .user ? "user" : "assistant", content: line.text)
        }
        if !records.isEmpty { try created.restore(saved: records) }
        session = created
        return created
    }

    static func message(for error: CoreError) -> String {
        switch error {
        case let .Invalid(message), let .Engine(message), let .Model(message):
            message
        default:
            String(localized: "The core stopped unexpectedly.")
        }
    }
}
