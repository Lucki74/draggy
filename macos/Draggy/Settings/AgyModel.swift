import DraggyCore
import Foundation
import Observation

/// The Antigravity CLI account: the terms gate, sign-in and the model list. The CLI keeps the Google login itself.
@MainActor
@Observable
final class AgyModel {
    private let account: AgyAccount
    private(set) var status: AgyStatus
    private(set) var modelNames: [String] = []
    private(set) var isBusy = false
    private(set) var errorMessage: String?

    init(directory: URL = AgyModel.defaultDirectory()) {
        account = AgyAccount(dataDir: directory.path)
        status = account.status()
    }

    static func defaultDirectory() -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("Draggy", isDirectory: true).appendingPathComponent("agy", isDirectory: true)
    }

    static var termsWarning: String { agyTermsWarning() }

    /// Call only after the user accepted the warning.
    func signIn() async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            status = try await account.signIn(acknowledged: true)
        } catch let error as CoreError {
            errorMessage = AppModel.message(for: error)
            status = account.status()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut() {
        do {
            status = try account.signOut()
            modelNames = []
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func listModels() async {
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }
        do {
            modelNames = try await account.models()
        } catch let error as CoreError {
            errorMessage = AppModel.message(for: error)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// The route for a chat session, or nil when the account is not signed in.
    func config(model: String) -> AgyConfigRecord? {
        guard status.signedIn else { return nil }
        return try? account.config(model: model.isEmpty ? nil : model)
    }
}
