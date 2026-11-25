import Foundation

public final class TTSService: Sendable {
    public static let shared = TTSService()

    public init() {}

    public func speak(text: String, useCloud: Bool = false) {
        if useCloud && TTSConsentManager.shared.hasConsent(for: "elevenlabs") {
            Task {
                _ = try? await ElevenLabsService().synthesize(text: text, apiKey: "", voice: "")
            }
        } else {
            NeuralVoice.shared.speak(text: text)
        }
    }
}
