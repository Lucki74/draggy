import Foundation

public final class FirstDownloadTracker: Sendable {
    public static let shared = FirstDownloadTracker()

    public init() {}

    public var isFirstRun: Bool {
        return !UserDefaults.standard.bool(forKey: "has_completed_onboarding")
    }

    public func markCompleted() {
        UserDefaults.standard.set(true, forKey: "has_completed_onboarding")
    }
}
