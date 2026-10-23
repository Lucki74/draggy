import AVFoundation
import Speech

/// Listens through the microphone and turns one spoken message into text. It ends the message after a pause.
@MainActor
final class SpeechListener {
    /// How long a pause ends the message once something was said.
    static let pause: Duration = .milliseconds(1500)
    /// How long to wait for the user to start talking.
    static let patience: Duration = .seconds(10)

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var timer: Task<Void, Never>?
    private var heard = ""
    private var onDone: ((String) -> Void)?

    /// Asks for speech recognition and microphone access. False when either is refused.
    static func authorize() async -> Bool {
        let speech = await withCheckedContinuation { (answer: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { answer.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }

    /// Starts listening. `onDone` gets the message once, or an empty string when nothing was said or listening failed.
    func start(onDone: @escaping (String) -> Void) {
        cancel()
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(), recognizer.isAvailable
        else {
            onDone("")
            return
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.request = request
        self.onDone = onDone
        heard = ""
        let input = engine.inputNode
        Self.install(input, request: request)
        do {
            engine.prepare()
            try engine.start()
        } catch {
            finish()
            return
        }
        task = Self.recognize(recognizer, request) { [weak self] text in
            Task { @MainActor in self?.partial(text) }
        }
        arm(Self.patience)
    }

    /// Stops without reporting anything.
    func cancel() {
        onDone = nil
        finish()
    }

    private func partial(_ text: String) {
        guard onDone != nil, !text.isEmpty else { return }
        heard = text
        arm(Self.pause)
    }

    private func arm(_ wait: Duration) {
        timer?.cancel()
        timer = Task { [weak self] in
            try? await Task.sleep(for: wait)
            guard !Task.isCancelled else { return }
            self?.finish()
        }
    }

    private func finish() {
        timer?.cancel()
        timer = nil
        if engine.isRunning {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        let done = onDone
        onDone = nil
        done?(heard.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    // These run on the audio and recognition queues, so they are kept out of the main actor.
    private nonisolated static func install(_ node: AVAudioInputNode, request: SFSpeechAudioBufferRecognitionRequest) {
        node.installTap(onBus: 0, bufferSize: 1024, format: node.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
        }
    }

    private nonisolated static func recognize(
        _ recognizer: SFSpeechRecognizer,
        _ request: SFSpeechAudioBufferRecognitionRequest,
        _ deliver: @escaping @Sendable (String) -> Void
    ) -> SFSpeechRecognitionTask {
        recognizer.recognitionTask(with: request) { result, _ in
            if let result { deliver(result.bestTranscription.formattedString) }
        }
    }
}
