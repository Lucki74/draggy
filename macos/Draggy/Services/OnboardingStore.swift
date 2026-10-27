import Foundation

@MainActor
@Observable
public final class OnboardingStore {
    public var currentStep: Int = 0
    public var selectedLocale: String = LocaleDetector.shared.detectPreferredLocale()
    public var downloadProgress: Double = 0.0
    public var isDownloading: Bool = false

    public init() {}

    public func nextStep() {
        currentStep += 1
    }

    public func finish() {
        FirstDownloadTracker.shared.markCompleted()
    }
}
