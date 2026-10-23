import DraggyCore
import XCTest
@testable import Draggy

final class PlanStripTests: XCTestCase {
    func testProgressCountsTheDoneSteps() {
        let steps = [
            PlanStepRecord(text: "a", status: "done"),
            PlanStepRecord(text: "b", status: "doing"),
            PlanStepRecord(text: "c", status: "todo"),
        ]
        XCTAssertEqual(PlanStrip.progress(steps), "1 of 3")
    }

    func testEachStatusHasItsOwnSymbol() {
        XCTAssertEqual(Set(["done", "doing", "todo"].map(PlanStrip.symbol)).count, 3)
    }
}
