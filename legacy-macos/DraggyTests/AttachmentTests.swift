import XCTest
@testable import Draggy

final class AttachmentTests: XCTestCase {
    func testTheTextGoesInAfterAnEmptyDraft() {
        XCTAssertEqual(Attachment.append(" body \n", named: "a.docx", to: ""), "[a.docx]\nbody\n\n")
    }

    func testTheTextGoesInAfterWhatWasWritten() {
        XCTAssertEqual(
            Attachment.append("body", named: "a.pdf", to: "Summarise this\n"),
            "Summarise this\n\n[a.pdf]\nbody\n\n")
    }

    func testTwoFilesStackInOrder() {
        let once = Attachment.append("one", named: "1.xlsx", to: "")
        XCTAssertEqual(Attachment.append("two", named: "2.xlsx", to: once), "[1.xlsx]\none\n\n[2.xlsx]\ntwo\n\n")
    }
}
