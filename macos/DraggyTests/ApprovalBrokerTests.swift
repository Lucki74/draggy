import DraggyCore
import XCTest
@testable import Draggy

final class ApprovalBrokerTests: XCTestCase {
    private let request = ApprovalRecord(id: "1", tool: "edit", target: "a.txt", reason: "changes a file")

    func testResolveUnblocksTheWaitingTurn() {
        let shown = expectation(description: "question shown")
        let broker = ApprovalBroker { _ in shown.fulfill() }
        let answered = expectation(description: "turn got its answer")
        nonisolated(unsafe) var choice: ApprovalChoice?

        let turn = Thread {
            choice = broker.ask(request: self.request)
            answered.fulfill()
        }
        turn.start()

        wait(for: [shown], timeout: 5)
        broker.resolve(.workspace)
        wait(for: [answered], timeout: 5)
        XCTAssertEqual(choice, .workspace)
    }

    func testResolveWithNothingWaitingDoesNothing() {
        let broker = ApprovalBroker { _ in }
        broker.resolve(.once)
    }

    func testEachQuestionStartsFromNo() {
        let shown = expectation(description: "question shown")
        let broker = ApprovalBroker { _ in shown.fulfill() }
        broker.resolve(.once)
        let answered = expectation(description: "answered")
        nonisolated(unsafe) var choice: ApprovalChoice?
        Thread {
            choice = broker.ask(request: self.request)
            answered.fulfill()
        }.start()
        wait(for: [shown], timeout: 5)
        broker.resolve(.no)
        wait(for: [answered], timeout: 5)
        XCTAssertEqual(choice, .no)
    }
}
