import Foundation

public struct UsageDataPoint: Identifiable, Sendable {
    public let id = UUID()
    public let label: String
    public let promptTokens: Int
    public let completionTokens: Int
    public var totalTokens: Int { promptTokens + completionTokens }
}

@MainActor
@Observable
public final class StatsStore {
    public var totalPromptTokens: Int = 0
    public var totalCompletionTokens: Int = 0
    public var totalCostDollars: Double = 0.0
    public var recentHistory: [UsageDataPoint] = []
    public var hardware: SystemHardwareMetrics = HardwareMetrics.shared.sample()

    public init() {
        refreshHardware()
    }

    public func recordTurn(promptTokens: Int, completionTokens: Int, cost: Double = 0.0) {
        totalPromptTokens += promptTokens
        totalCompletionTokens += completionTokens
        totalCostDollars += cost

        let point = UsageDataPoint(
            label: "T\(recentHistory.count + 1)",
            promptTokens: promptTokens,
            completionTokens: completionTokens
        )
        recentHistory.append(point)
        if recentHistory.count > 30 {
            recentHistory.removeFirst()
        }
    }

    public func refreshHardware() {
        hardware = HardwareMetrics.shared.sample()
    }
}
