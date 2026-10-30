import DraggyCore
import XCTest
@testable import Draggy

@MainActor
final class BackgroundTasksTests: XCTestCase {
    private func task(_ id: String, _ status: String) -> TaskRecord {
        TaskRecord(id: id, command: "npm run dev", status: status, exitCode: nil, runningForMs: 0, lastLine: "")
    }

    func testRuntimeShowsMinutesAndSecondsThenHours() {
        XCTAssertEqual(BackgroundTasks.runtime(0), "0:00")
        XCTAssertEqual(BackgroundTasks.runtime(65_000), "1:05")
        XCTAssertEqual(BackgroundTasks.runtime(3_723_000), "1:02:03")
    }

    func testUnseenFailuresSkipsTheOpenedOnes() {
        let tasks = [task("a", "failed"), task("b", "failed"), task("c", "running")]
        XCTAssertEqual(BackgroundTasks.unseenFailures(tasks, seen: ["a"]).map(\.id), ["b"])
    }

    func testRunningKeepsOnlyTheRunningOnes() {
        let tasks = [task("a", "running"), task("b", "exited"), task("c", "running")]
        XCTAssertEqual(BackgroundTasks.running(tasks).map(\.id), ["a", "c"])
    }
}
