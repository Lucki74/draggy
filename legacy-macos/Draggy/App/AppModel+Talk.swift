import Foundation

/// Talk mode: listen, send what was said, read the reply aloud, then listen again until the user stops it.
extension AppModel {
    var isTalking: Bool { talkPhase != .off }

    func toggleTalk() {
        if isTalking {
            stopTalk()
        } else {
            Task { await startTalk() }
        }
    }

    func startTalk() async {
        guard !isRunning else { return }
        guard await SpeechListener.authorize() else {
            report(String(localized: "Allow the microphone and speech recognition for Draggy in System Settings."))
            return
        }
        report(nil)
        listen()
    }

    func stopTalk() {
        talkPhase = .off
        listener.cancel()
        speaker.stop()
    }

    private func listen() {
        talkPhase = .listening
        listener.start { [weak self] text in self?.heard(text) }
    }

    private func heard(_ text: String) {
        guard talkPhase == .listening else { return }
        guard !text.isEmpty else {
            listen()
            return
        }
        talkPhase = .thinking
        draft = text
        Task {
            await send()
            answer()
        }
    }

    private func answer() {
        guard talkPhase == .thinking else { return }
        guard errorMessage == nil, !lastReply.isEmpty else {
            listen()
            return
        }
        talkPhase = .speaking
        speaker.speak(lastReply) { [weak self] in
            guard let self, self.talkPhase == .speaking else { return }
            self.listen()
        }
    }
}
