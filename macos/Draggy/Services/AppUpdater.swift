import Foundation

public struct ReleaseInfo: Codable, Sendable {
    public let version: String
    public let downloadUrl: String
    public let releaseNotes: String
}

@MainActor
@Observable
public final class AppUpdater {
    public var isChecking: Bool = false
    public var updateAvailable: ReleaseInfo?
    public var downloadProgress: Double = 0.0

    public init() {}

    public func checkForUpdates() async {
        isChecking = true
        try? await Task.sleep(nanoseconds: 500_000_000)
        isChecking = false
    }
}
