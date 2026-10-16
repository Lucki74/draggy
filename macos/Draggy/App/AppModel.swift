import DraggyCore
import Foundation
import Observation

/// Forwards a turn's batched events to the main actor. The core calls it from its own thread.
private final class EventSink: TurnObserver, @unchecked Sendable {
    private let show: @MainActor @Sendable (String) -> Void

    init(show: @escaping @MainActor @Sendable (String) -> Void) {
        self.show = show
    }

    func onEvents(events: [TurnEventRecord]) {
        var latest: String?
        for event in events {
            if case let .patch(_, textContent, _) = event {
                latest = textContent
            }
        }
        guard let text = latest else { return }
        let show = show
        Task { @MainActor in show(text) }
    }
}

@MainActor
@Observable
final class AppModel {
    private enum Key {
        static let baseURL = "serverURL"
        static let model = "modelName"
        static let apiKey = "provider-api-key"
    }

    private let defaults: UserDefaults
    private let secrets: any SecretStore
    private var session: Session?
    private var cancel: CancelToken?

    private(set) var transcript = Transcript()
    private(set) var isRunning = false
    private(set) var errorMessage: String?

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

    init(defaults: UserDefaults = .standard, secrets: any SecretStore = KeychainSecretStore()) {
        self.defaults = defaults
        self.secrets = secrets
        baseURL = defaults.string(forKey: Key.baseURL) ?? "http://127.0.0.1:8080/v1"
        modelName = defaults.string(forKey: Key.model) ?? ""
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
        session = nil
        transcript = Transcript()
        errorMessage = nil
    }

    func stop() {
        cancel?.cancel()
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isRunning else { return }
        draft = ""
        errorMessage = nil
        isRunning = true
        defer { isRunning = false }

        transcript.addUser(text)
        transcript.beginReply()
        let token = CancelToken()
        cancel = token
        let sink = EventSink { [weak self] reply in
            self?.transcript.setReply(reply)
        }

        do {
            let session = try currentSession()
            let outcome = try await session.send(text: text, observer: sink, approvals: nil, cancel: token)
            transcript.finishReply(outcome.textContent)
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
        // No folder and no commands: the shell has no approval sheet yet, so tools that ask would be refused.
        let config = SessionConfig(
            baseUrl: baseURL,
            model: modelName,
            apiKey: key,
            folder: nil,
            contextTokens: nil,
            loopLimit: nil,
            allowCommands: false,
            permissionMode: nil
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
