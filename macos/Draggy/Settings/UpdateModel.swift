import DraggyCore
import Foundation
import Observation

/// Tells the user when a newer build is on GitHub. Builds without Sparkle cannot install it, so the banner opens the
/// release page.
@MainActor
@Observable
final class UpdateModel {
    private static let repository = "Lucki74/draggy"
    private static let tagPrefix = "macos-b-"

    private let checker: UpdateChecker?
    private let currentBuild: UInt32

    private(set) var available: UpdateRecord?
    var isDismissed = false

    init(bundle: Bundle = .main) {
        currentBuild = UInt32(bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0
        checker = try? UpdateChecker(repository: Self.repository, tagPrefix: Self.tagPrefix)
    }

    /// Asks GitHub once. A failure is silent: an offline Mac is not an error worth showing.
    func check() async {
        guard let checker, available == nil else { return }
        available = try? await checker.check(currentBuild: currentBuild, includePrereleases: true)
    }
}
