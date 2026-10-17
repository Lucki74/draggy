import AppKit
import XCTest
@testable import Draggy

/// The plan's budget for streaming into a long chat: the main thread spends under 4 ms per frame. This measures the
/// work one streamed update costs outside the window: the transcript edit, the styled text and the row height.
@MainActor
final class StreamingPerformanceTests: XCTestCase {
    private static let paragraph = "Here is **some text** with `inline code` that runs on for a while so rows wrap. "
    private static let block = "```swift\nlet value = compute(input)\nprint(value)\n```\n"

    private func longTranscript(messages: Int) -> Transcript {
        var transcript = Transcript()
        for index in 0 ..< messages {
            if index.isMultiple(of: 2) {
                transcript.addUser("Question \(index) " + String(repeating: Self.paragraph, count: 2))
            } else {
                transcript.beginReply()
                transcript.setReply(String(repeating: Self.paragraph, count: 5) + Self.block)
            }
        }
        return transcript
    }

    private func streamedUpdate(_ transcript: inout Transcript, text: String, width: CGFloat) {
        transcript.setReply(text)
        guard let line = transcript.lines.last else { return }
        let styled = MessageText.attributed(line)
        _ = styled.boundingRect(
            with: NSSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading]
        )
    }

    func testAStreamedUpdateInA2000MessageChatStaysUnderTheFrameBudget() {
        var transcript = longTranscript(messages: 2000)
        transcript.beginReply()
        let updates = 300
        var text = ""
        let clock = ContinuousClock()
        let elapsed = clock.measure {
            for index in 0 ..< updates {
                text += "token\(index) "
                if index % 40 == 39 { text += "\n\n" }
                streamedUpdate(&transcript, text: text, width: 700)
            }
        }
        let perUpdate = Double(elapsed.components.attoseconds) / 1e15 / Double(updates)
            + Double(elapsed.components.seconds) * 1000 / Double(updates)
        XCTAssertEqual(transcript.lines.count, 2001)
        XCTAssertLessThan(perUpdate, 4, "a streamed update took \(perUpdate) ms")
    }

    func testStylingAndMeasuringTheWholeChatOnce() {
        let transcript = longTranscript(messages: 2000)
        measure(metrics: [XCTClockMetric()]) {
            for line in transcript.lines {
                let styled = MessageText.attributed(line)
                _ = styled.boundingRect(
                    with: NSSize(width: 700, height: .greatestFiniteMagnitude),
                    options: [.usesLineFragmentOrigin, .usesFontLeading]
                )
            }
        }
    }
}
