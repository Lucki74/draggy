import Foundation

public final class LocaleDetector: Sendable {
    public static let shared = LocaleDetector()

    public init() {}

    public func detectPreferredLocale() -> String {
        let code = Locale.current.language.languageCode?.identifier ?? "en"
        let supported = ["en", "fr", "es", "ru"]
        return supported.contains(code) ? code : "en"
    }
}
