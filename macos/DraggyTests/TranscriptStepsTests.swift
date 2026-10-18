import XCTest
@testable import Draggy

final class TranscriptStepsTests: XCTestCase {
    func testStepsAndSpeedLandOnTheOpenReply() {
        var transcript = Transcript()
        transcript.addUser("hi")
        transcript.beginReply()
        let step = Transcript.Step(kind: "read", label: "read a.txt", isDone: true)
        transcript.setSteps([step])
        transcript.setSpeed(12.5)
        XCTAssertEqual(transcript.lines.last?.steps, [step])
        XCTAssertEqual(transcript.lines.last?.speed, 12.5)
        XCTAssertNil(transcript.lines.first?.speed)
    }

    func testStepDetailSurvivesSetSteps() {
        var transcript = Transcript()
        transcript.addUser("hi")
        transcript.beginReply()
        transcript.setSteps([Transcript.Step(kind: "thinking", label: "thinking", isDone: true, detail: "hmm")])
        XCTAssertEqual(transcript.lines.last?.steps.first?.detail, "hmm")
    }

    func testStepsAreIgnoredWhenTheLastLineIsTheUser() {
        var transcript = Transcript()
        transcript.addUser("hi")
        transcript.setSteps([Transcript.Step(kind: "read", label: "read a.txt", isDone: false)])
        XCTAssertEqual(transcript.lines.first?.steps, [])
    }
}
