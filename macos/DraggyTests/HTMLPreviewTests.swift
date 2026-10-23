import XCTest
@testable import Draggy

@MainActor
final class HTMLPreviewTests: XCTestCase {
    func testHTMLFencesArePreviewedInAnyCase() {
        XCTAssertTrue(HTMLPreview.isHTML("html"))
        XCTAssertTrue(HTMLPreview.isHTML(" HTML "))
        XCTAssertFalse(HTMLPreview.isHTML("swift"))
        XCTAssertFalse(HTMLPreview.isHTML(""))
    }

    func testThePolicyComesBeforeTheMarkup() throws {
        let page = HTMLPreview.page("<p>hi</p><script>x()</script>")
        let policy = try XCTUnwrap(page.range(of: "Content-Security-Policy"))
        let markup = try XCTUnwrap(page.range(of: "<p>"))
        XCTAssertLessThan(policy.lowerBound, markup.lowerBound)
        XCTAssertTrue(page.contains("default-src 'none'"))
    }

    func testAClosedHTMLBlockGetsAPreviewLink() {
        let text = MessageText.message("```html\n<p>hi</p>\n```\nafter")
        let link = text.attribute(.link, at: 0, effectiveRange: nil)
        XCTAssertEqual((link as? HTMLPreview)?.html, "<p>hi</p>")
    }

    func testOtherBlocksAndOpenBlocksGetNoLink() {
        XCTAssertEqual(MessageText.message("```swift\nlet x = 1\n```").string, "let x = 1\n")
        XCTAssertEqual(MessageText.message("```html\n<p>hi</p>").string, "<p>hi</p>")
    }
}
