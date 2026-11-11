import Foundation

public final class DiagnosticsBundle: Sendable {
    public static let shared = DiagnosticsBundle()

    public init() {}

    public func exportBundle() -> String {
        let probe = HardwareProbe.shared.probe()
        let plan = TierPlanner.shared.plan(for: probe)
        let logFolder = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Draggy").path
        return """
        # Draggy Diagnostics Bundle
        Platform: macOS (\(probe.osVersion))
        Log folder: \(logFolder)
        Chip: \(probe.chip)
        RAM: \(probe.ramGB) GB
        Cores: \(probe.cores)
        Recommended Tier: \(plan.tierName) (\(plan.recommendedParameterSize))
        """
    }
}
