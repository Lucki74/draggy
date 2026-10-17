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
    let target = record.filename ?? record.filepath ?? firstLine
    let label = target.map { "\(record.kind) \($0)" } ?? record.kind
    return Transcript.Step(kind: record.kind, label: label, isDone: record.isComplete ?? true)
}

/// How the model's tool calls are decided, as the settings offer it. Running everything unasked is left out.
enum PermissionChoice: String, CaseIterable, Identifiable {
    case ask
    case acceptEdits
    case plan

    var id: String { rawValue }

    var title: String {
        switch self {
        case .ask: "Ask before edits and commands"
        case .acceptEdits: "Edit freely, ask before commands"
        case .plan: "Read only"
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
    }

    private let defaults: UserDefaults
    private let secrets: any SecretStore
    private var session: Session?
    private var cancel: CancelToken?
    @ObservationIgnored private var broker: ApprovalBroker?

    private(set) var transcript = Transcript()
    private(set) var isRunning = false
    private(set) var errorMessage: String?
    /// The tool call that is waiting for the user's answer.
    private(set) var pendingApproval: ApprovalRecord?

    var draft = ""

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

    var permission: PermissionChoice {
        didSet {
            defaults.set(permission.rawValue, forKey: Key.permission)
            session = nil
        }
    }

    init(defaults: UserDefaults = .standard, secrets: any SecretStore = KeychainSecretStore()) {
        self.defaults = defaults
        self.secrets = secrets
        baseURL = defaults.string(forKey: Key.baseURL) ?? "http://127.0.0.1:8080/v1"
        modelName = defaults.string(forKey: Key.model) ?? ""
        folderPath = defaults.string(forKey: Key.folder) ?? ""
        allowCommands = defaults.bool(forKey: Key.commands)
        permission = defaults.string(forKey: Key.permission).flatMap(PermissionChoice.init(rawValue:)) ?? .ask
        broker = ApprovalBroker { [weak self] request in
            self?.pendingApproval = request
        }
    }

    func hasAPIKey() -> Bool {
        ((try? secrets.secret(for: Key.apiKey)) ?? nil) != nil
    }

    func saveAPIKey(_ key: String) {
        do {
            try secrets.setSecret(key, for: Key.apiKey)
            session = nil
        } catch {
            errorMessage = "The key could not be saved to the Keychain."
        }
    }

    /// A settings change starts a new conversation, as on Linux.
    func newConversation() {
        guard !isRunning else { return }
        session = nil
        transcript = Transcript()
        errorMessage = nil
    }

    /// Stops the turn. A question that is waiting for the user is answered with no, so the turn can end.
    func stop() {
        cancel?.cancel()
        answerApproval(.no)
    }

    func answerApproval(_ choice: ApprovalChoice) {
        pendingApproval = nil
        broker?.resolve(choice)
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isRunning else { return }
        draft = ""
        errorMessage = nil
        isRunning = true
        defer {
            isRunning = false
            pendingApproval = nil
        }

        transcript.addUser(text)
        transcript.beginReply()
        let token = CancelToken()
        cancel = token
        let sink = EventSink { [weak self] update in
            guard let self else { return }
            if let text = update.text { self.transcript.setReply(text) }
            if let steps = update.steps { self.transcript.setSteps(steps) }
            if let speed = update.speed { self.transcript.setSpeed(speed) }
        }

        do {
            let session = try currentSession()
            let outcome = try await session.send(text: text, observer: sink, approvals: broker, cancel: token)
            transcript.finishReply(outcome.textContent)
            transcript.setSteps(outcome.steps.map(transcriptStep))
        } catch let error as CoreError {
            errorMessage = Self.message(for: error)
        } catch {
            errorMessage = error.localizedDescription
        }
        cancel = nil
    }

    private func currentSession() throws -> Session {
        if let session { return session }
        // The key is read only here, while the request is being set up.
        let key = (try? secrets.secret(for: Key.apiKey)) ?? nil
        let folder = folderPath.isEmpty ? nil : folderPath
        let config = SessionConfig(
            baseUrl: baseURL,
            model: modelName,
            apiKey: key,
            folder: folder,
            contextTokens: nil,
            loopLimit: nil,
            allowCommands: allowCommands && folder != nil,
            permissionMode: permission.record
        )
        let created = try Session(config: config)
        session = created
        return created
    }

    private static func message(for error: CoreError) -> String {
        switch error {
        case let .invalid(message), let .engine(message), let .model(message):
            message
        default:
            "The core stopped unexpectedly."
        }
    }
}
