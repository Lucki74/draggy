import AppKit
import XCTest
@testable import Draggy

@MainActor
final class MessageTextTests: XCTestCase {
    func testFenceMarkersAreDroppedAndCodeIsMonospaced() {
        let text = MessageText.message("before\n```swift\nlet x = 1\n```\nafter")
        XCTAssertEqual(text.string, "before\nlet x = 1\nafter")
        let font = text.attribute(.font, at: 7, effectiveRange: nil) as? NSFont
        XCTAssertTrue(font?.fontDescriptor.symbolicTraits.contains(.monoSpace) ?? false)
    }

    func testInlineCodeAndBoldLoseTheirMarks() {
        let text = MessageText.message("use `ls` and **care**")
        XCTAssertEqual(text.string, "use ls and care")
        let bold = text.attribute(.font, at: 11, effectiveRange: nil) as? NSFont
        XCTAssertTrue(bold?.fontDescriptor.symbolicTraits.contains(.bold) ?? false)
    }

    func testStepsComeBeforeTheMessage() {
        let line = Transcript.Line(
            id: UUID(),
            role: .assistant,
            text: "done",
            steps: [Transcript.Step(kind: "read", label: "read a.txt", isDone: true)]
        )
        XCTAssertEqual(MessageText.attributed(line).string, "\u{2713} read a.txt\ndone")
    }
}
