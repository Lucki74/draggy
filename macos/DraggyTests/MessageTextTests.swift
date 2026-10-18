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

    func testToolDetailFollowsItsLabelInMonospace() {
        let step = Transcript.Step(kind: "bash", label: "bash ls", isDone: true, detail: "a.txt")
        let line = Transcript.Line(id: UUID(), role: .assistant, text: "done", steps: [step])
        let text = MessageText.attributed(line)
        XCTAssertEqual(text.string, "\u{2713} bash ls\na.txt\ndone")
        let font = text.attribute(.font, at: 12, effectiveRange: nil) as? NSFont
        XCTAssertTrue(font?.fontDescriptor.symbolicTraits.contains(.monoSpace) ?? false)
    }

    func testThinkingIsTitledAndItalic() {
        let step = Transcript.Step(kind: "thinking", label: "thinking", isDone: true, detail: "hmm")
        let line = Transcript.Line(id: UUID(), role: .assistant, text: "", steps: [step])
        let text = MessageText.attributed(line)
        let title = "\u{2713} \(String(localized: "Thinking"))\n"
        XCTAssertEqual(text.string, title + "hmm\n")
        let font = text.attribute(.font, at: (title as NSString).length, effectiveRange: nil) as? NSFont
        XCTAssertTrue(font?.fontDescriptor.symbolicTraits.contains(.italic) ?? false)
    }
}
