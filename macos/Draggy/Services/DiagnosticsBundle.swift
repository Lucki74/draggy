import Foundation

public final class DiagnosticsBundle: Sendable {
    public static let shared = DiagnosticsBundle()

    public init() {}

    public func exportBundle() -> String {
        let probe = HardwareProbe.shared.probe()
        let plan = TierPlanner.shared.plan(for: probe)
        return """
        # Draggy Diagnostics Bundle
        Platform: macOS (\(probe.osVersion))
        Chip: \(probe.chip)
        RAM: \(probe.ramGB) GB
        Cores: \(probe.cores)
        Recommended Tier: \(plan.tierName) (\(plan.recommendedParameterSize))
        """
    }
}
