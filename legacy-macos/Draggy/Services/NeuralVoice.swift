import AVFoundation
import Foundation

public final class NeuralVoice: Sendable {
    public static let shared = NeuralVoice()

    public init() {}

    public func speak(text: String, voiceId: String? = nil) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        if let voice = AVSpeechSynthesisVoice(language: "en-US") {
            utterance.voice = voice
        }
        let synthesizer = AVSpeechSynthesizer()
        synthesizer.speak(utterance)
    }
}
