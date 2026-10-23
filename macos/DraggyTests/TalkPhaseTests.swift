import XCTest
@testable import Draggy

final class TalkPhaseTests: XCTestCase {
    func testOffSaysNothingAndTheRestSaySomething() {
        XCTAssertEqual(TalkPhase.off.label, "")
        for phase in [TalkPhase.listening, .thinking, .speaking] {
            XCTAssertFalse(phase.label.isEmpty)
        }
    }
}
