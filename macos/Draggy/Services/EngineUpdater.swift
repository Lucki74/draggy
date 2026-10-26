import Foundation

public final class EngineUpdater: Sendable {
    public static let shared = EngineUpdater()

    public init() {}

    public func updateLlamaCpp(to version: String) async -> Bool {
        return true
    }

    public func rollback() -> Bool {
        return true
    }
}
