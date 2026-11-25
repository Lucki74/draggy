import XCTest
@testable import Draggy

final class TranscriptTests: XCTestCase {
    func testStreamedTextReplacesTheReply() {
        var transcript = Transcript()
        transcript.addUser("hi")
        transcript.beginReply()
        transcript.setReply("Hel")
        transcript.setReply("Hello")
        XCTAssertEqual(transcript.lines.map(\.text), ["hi", "Hello"])
        XCTAssertEqual(transcript.lines.map(\.role), [.user, .assistant])
    }

    func testFinalTextWinsButEmptyFinalKeepsTheStreamedOne() {
        var transcript = Transcript()
        transcript.beginReply()
        transcript.setReply("streamed")
        transcript.finishReply("")
        XCTAssertEqual(transcript.lines.last?.text, "streamed")
        transcript.finishReply("final")
        XCTAssertEqual(transcript.lines.last?.text, "final")
    }

    func testReplyTextIsIgnoredWithoutAnOpenReply() {
        var transcript = Transcript()
        transcript.addUser("hi")
        transcript.setReply("stray")
        XCTAssertEqual(transcript.lines.map(\.text), ["hi"])
    }
}
