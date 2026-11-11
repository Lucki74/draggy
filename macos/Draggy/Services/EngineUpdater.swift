import Foundation
import OSLog

public final class EngineUpdater: Sendable {
    public static let shared = EngineUpdater()

    public init() {}

    public func updateLlamaCpp(to version: String) async -> Bool {
        Logger.updater.info("Engine update requested, version \(version, privacy: .public)")
        return true
    }

    public func rollback() -> Bool {
        Logger.updater.info("Engine rollback requested")
        return true
    }
}
