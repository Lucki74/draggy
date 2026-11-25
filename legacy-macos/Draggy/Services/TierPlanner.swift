import Foundation

public struct ModelTierRecommendation: Sendable {
    public let tierName: String
    public let recommendedParameterSize: String
    public let quantization: String
    public let maxContext: Int
}

public final class TierPlanner: Sendable {
    public static let shared = TierPlanner()

    public init() {}

    public func plan(for info: HardwareInfo) -> ModelTierRecommendation {
        if info.ramGB >= 32 {
            return ModelTierRecommendation(tierName: "High", recommendedParameterSize: "14B - 32B", quantization: "Q4_K_M", maxContext: 32768)
        } else if info.ramGB >= 16 {
            return ModelTierRecommendation(tierName: "Medium", recommendedParameterSize: "7B - 8B", quantization: "Q4_K_M", maxContext: 16384)
        } else {
            return ModelTierRecommendation(tierName: "Light", recommendedParameterSize: "1B - 3B", quantization: "Q4_K_S", maxContext: 8192)
        }
    }
}
