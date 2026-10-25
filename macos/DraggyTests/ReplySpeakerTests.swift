import XCTest
@testable import Draggy

@MainActor
final class ReplySpeakerTests: XCTestCase {
    func testCodeBlocksAndMarksAreNotSpoken() {
        let text = ReplySpeaker.spoken("# Title\nSome **bold** and `code`.\n```swift\nlet x = 1\n```\nDone")
        XCTAssertEqual(text, "Title. Some bold and code.. Done")
    }
}
