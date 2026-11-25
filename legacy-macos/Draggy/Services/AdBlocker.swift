import Foundation

public final class AdBlocker: Sendable {
    public static let shared = AdBlocker()
    private let blockedDomains: Set<String>

    public init() {
        self.blockedDomains = AdBlockRuleManager.shared.loadBlockedDomains()
    }

    public func shouldBlock(url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        for domain in blockedDomains {
            if host == domain || host.hasSuffix("." + domain) {
                return true
            }
        }
        return false
    }
}
