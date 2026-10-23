import AVFoundation

/// Reads replies aloud with the system voice.
@MainActor
final class ReplySpeaker {
    private let synthesizer = AVSpeechSynthesizer()

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

    func speak(_ markdown: String) {
        stop()
        let text = Self.spoken(markdown)
        guard !text.isEmpty else { return }
        synthesizer.speak(AVSpeechUtterance(string: text))
    }

    func stop() {
        synthesizer.stopSpeaking(at: .immediate)
    }
}
