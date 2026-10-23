import XCTest
@testable import Draggy

@MainActor
final class BrowserModelTests: XCTestCase {
    func testAddsHttpsToABareHost() {
        XCTAssertEqual(BrowserModel.normalize(" example.com/a "), "https://example.com/a")
    }

    func testKeepsAnAddressThatHasAScheme() {
        XCTAssertEqual(BrowserModel.normalize("http://localhost:5173"), "http://localhost:5173")
    }

    func testGoLoadsAnAllowedAddress() {
        let model = BrowserModel { _ in "" }
        model.address = "example.com"
        model.go()
        XCTAssertEqual(model.current?.absoluteString, "https://example.com")
        XCTAssertNil(model.errorMessage)
    }

    func testGoShowsTheReasonForARefusedAddress() {
        let model = BrowserModel { _ in "Refused: file addresses cannot be opened." }
        model.address = "file:///etc/passwd"
        model.go()
        XCTAssertNil(model.current)
        XCTAssertEqual(model.errorMessage, "Refused: file addresses cannot be opened.")
    }

    func testAnEmptyAddressDoesNothing() {
        let model = BrowserModel { _ in "" }
        model.go()
        XCTAssertNil(model.current)
        XCTAssertNil(model.errorMessage)
    }

    func testARefusedLinkIsNotFollowed() {
        let model = BrowserModel { $0.hasPrefix("https") ? "" : "no" }
        XCTAssertTrue(model.permits(URL(string: "https://example.com")!))
        XCTAssertFalse(model.permits(URL(string: "file:///tmp/x")!))
        XCTAssertEqual(model.errorMessage, "no")
    }

    func testAFailedDownloadShowsWhy() {
        let model = BrowserModel { _ in "" }
        model.reportFailure("disk full")
        XCTAssertEqual(model.errorMessage, "disk full")
    }
}
