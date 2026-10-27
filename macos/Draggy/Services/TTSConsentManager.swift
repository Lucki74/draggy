import Foundation

public final class TTSConsentManager: Sendable {
    public static let shared = TTSConsentManager()

    public init() {}

    public func hasConsent(for provider: String) -> Bool {
        return UserDefaults.standard.bool(forKey: "tts_consent_\(provider)")
    }

    public func grantConsent(for provider: String) {
        UserDefaults.standard.set(true, forKey: "tts_consent_\(provider)")
    }

    public func revokeConsent(for provider: String) {
        UserDefaults.standard.removeObject(forKey: "tts_consent_\(provider)")
    }
}
