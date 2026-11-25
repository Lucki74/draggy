import Foundation

public final class AdBlockRuleManager: Sendable {
    public static let shared = AdBlockRuleManager()

    public init() {}

    public func loadBlockedDomains() -> Set<String> {
        // Read hosts file from shared fixtures or bundle
        return ["doubleclick.net", "google-analytics.com", "adnxs.com", "quantserve.com"]
    }
}
