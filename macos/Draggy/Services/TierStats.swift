import Foundation

public struct TierUsageStats: Sendable {
    public let activeTier: String
    public let averageTokensPerSec: Double
    public let loadTimeSeconds: Double
}

public final class TierStats: Sendable {
    public static let shared = TierStats()

    public init() {}

    public func current() -> TierUsageStats {
        return TierUsageStats(activeTier: "Medium", averageTokensPerSec: 38.4, loadTimeSeconds: 1.8)
    }
}
