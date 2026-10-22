import AppKit
import XCTest
@testable import Draggy

@MainActor
final class MessageTextTests: XCTestCase {
    func testNumberedListsKeepTheirNumbersAndDrawInlineMarks() {
        XCTAssertEqual(MessageText.message("1) **one**
2. two").string, "1. one
2. two")
    }

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

    func testHeadingsLoseTheirHashesAndGrow() {
        let text = MessageText.message("## Title\nbody")
        XCTAssertEqual(text.string, "Title\nbody")
        let heading = text.attribute(.font, at: 0, effectiveRange: nil) as? NSFont
        XCTAssertGreaterThan(heading?.pointSize ?? 0, 14)
        XCTAssertTrue(heading?.fontDescriptor.symbolicTraits.contains(.bold) ?? false)
    }

    func testBulletsBecomeDots() {
        XCTAssertEqual(MessageText.message("- one\n* two").string, "\u{2022} one\n\u{2022} two")
    }

    func testLinksKeepTheirLabelAndCarryTheAddress() {
        let text = MessageText.message("see [docs](https://example.com/a) now")
        XCTAssertEqual(text.string, "see docs now")
        XCTAssertEqual(text.attribute(.link, at: 4, effectiveRange: nil) as? URL, URL(string: "https://example.com/a"))
    }

    func testOtherLinkSchemesStayAsTyped() {
        XCTAssertEqual(MessageText.message("[x](file:///etc/passwd)").string, "[x](file:///etc/passwd)")
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

    func testItalicsAndQuotesAreDrawn() {
        let line = Transcript.Line(id: UUID(), role: .assistant, text: "a *slanted* word\n> quoted", steps: [])
        let text = MessageText.attributed(line)
        XCTAssertEqual(text.string, "a slanted word\n\u{258E} quoted")
        let font = text.attribute(.font, at: 3, effectiveRange: nil) as? NSFont
        XCTAssertTrue(font?.fontDescriptor.symbolicTraits.contains(.italic) ?? false)
    }

    func testBoldAndMultiplicationAreNotItalics() {
        let line = Transcript.Line(id: UUID(), role: .assistant, text: "**bold** and 2 * 3 * 4", steps: [])
        XCTAssertEqual(MessageText.attributed(line).string, "bold and 2 * 3 * 4")
    }

    func testTableCellsAreTabbedAndHeaderIsBold() {
        let text = MessageText.message("| a | b |\n|---|:---:|\n| 1 | **2** |\nafter")
        XCTAssertEqual(text.string, "a\tb\n1\t2\nafter")
        let header = text.attribute(.font, at: 0, effectiveRange: nil) as? NSFont
        XCTAssertTrue(header?.fontDescriptor.symbolicTraits.contains(.bold) ?? false)
        let body = text.attribute(.font, at: 4, effectiveRange: nil) as? NSFont
        XCTAssertFalse(body?.fontDescriptor.symbolicTraits.contains(.bold) ?? true)
    }

    func testTableEndsAtTheFirstRowWithoutPipes() {
        XCTAssertEqual(MessageText.message("| a |\n|-|\n| 1 |\ntext").string, "a\n1\ntext")
    }

    func testPipesWithoutSeparatorStayAsTyped() {
        XCTAssertEqual(MessageText.message("a | b\nc").string, "a | b\nc")
    }

    func testTableInsideFenceIsCode() {
        XCTAssertEqual(MessageText.message("```\n| a |\n|-|\n```").string, "| a |\n|-|\n")
    }
}
