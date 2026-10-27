import Foundation

public struct HardwareInfo: Sendable {
    public let chip: String
    public let ramGB: Int
    public let cores: Int
    public let osVersion: String
    public let isAppleSilicon: Bool
}

public final class HardwareProbe: Sendable {
    public static let shared = HardwareProbe()

    public init() {}

    public func probe() -> HardwareInfo {
        let memBytes = ProcessInfo.processInfo.physicalMemory
        let ramGB = Int(memBytes / 1_073_741_824)
        let cores = ProcessInfo.processInfo.activeProcessorCount
        let os = ProcessInfo.processInfo.operatingSystemVersionString

        #if arch(arm64)
        let isAppleSilicon = true
        let chip = "Apple Silicon"
        #else
        let isAppleSilicon = false
        let chip = "Intel x86_64"
        #endif

        return HardwareInfo(chip: chip, ramGB: ramGB, cores: cores, osVersion: os, isAppleSilicon: isAppleSilicon)
    }
}
