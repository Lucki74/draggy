import AVFoundation

/// Reads replies aloud with the system voice.
@MainActor
final class ReplySpeaker: NSObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var onFinish: (() -> Void)?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    /// The text with markdown marks and code blocks taken out, since they read badly aloud.
    static func spoken(_ markdown: String) -> String {
        var out: [String] = []
        var inFence = false
        for row in markdown.components(separatedBy: "\n") {
            if row.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                inFence.toggle()
                continue
            }
            if inFence { continue }
            let plain = row
                .replacingOccurrences(of: "`", with: "")
                .replacingOccurrences(of: "*", with: "")
                .replacingOccurrences(of: "#", with: "")
                .trimmingCharacters(in: .whitespaces)
            if !plain.isEmpty { out.append(plain) }
        }
        return out.joined(separator: ". ")
    }

    /// Reads the reply, then calls `then` once it has been read to the end. Stopping drops `then`.
    func speak(_ markdown: String, then: (() -> Void)? = nil) {
        stop()
        let text = Self.spoken(markdown)
        guard !text.isEmpty else {
            then?()
            return
        }
        onFinish = then
        synthesizer.speak(AVSpeechUtterance(string: text))
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            let done = self.onFinish
            self.onFinish = nil
            done?()
        }
    }

    func stop() {
        onFinish = nil
        synthesizer.stopSpeaking(at: .immediate)
    }
}
