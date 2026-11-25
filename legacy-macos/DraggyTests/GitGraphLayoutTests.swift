import XCTest
@testable import Draggy

final class GitGraphLayoutTests: XCTestCase {
    private func commit(_ id: String, _ parents: [String]) -> GitCommit {
        GitCommit(id: id, hash: id, author: "a", date: "d", message: id, parents: parents)
    }

    func testStraightHistoryStaysInOneLane() {
        let rows = GraphLayout.rows(of: [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])])
        XCTAssertEqual(rows.map(\.lane), [0, 0, 0])
        XCTAssertEqual(rows[0].lines, [GraphLine(fromLane: 0, fromY: 0.5, toLane: 0, toY: 1, color: 0)])
        XCTAssertEqual(rows[1].lines.count, 2)
        XCTAssertEqual(rows[2].lines, [GraphLine(fromLane: 0, fromY: 0, toLane: 0, toY: 0.5, color: 0)])
    }

    func testMergedBranchOpensALaneAndClosesWhereItStarted() {
        // m merges s into main; s and b both come from a.
        let rows = GraphLayout.rows(of: [commit("m", ["b", "s"]), commit("s", ["a"]), commit("b", ["a"]), commit("a", [])])
        XCTAssertEqual(rows.map(\.lane), [0, 1, 0, 0])
        XCTAssertTrue(rows[0].lines.contains(GraphLine(fromLane: 0, fromY: 0.5, toLane: 1, toY: 1, color: 1)))
        XCTAssertTrue(rows[1].lines.contains(GraphLine(fromLane: 0, fromY: 0, toLane: 0, toY: 1, color: 0)))
        XCTAssertTrue(rows[3].lines.contains(GraphLine(fromLane: 1, fromY: 0, toLane: 0, toY: 0.5, color: 1)))
        XCTAssertEqual(rows[3].lanes, 2)
    }

    func testSecondBranchTipGetsItsOwnLane() {
        let rows = GraphLayout.rows(of: [commit("x", ["a"]), commit("y", ["a"]), commit("a", [])])
        XCTAssertEqual(rows.map(\.lane), [0, 1, 0])
        XCTAssertFalse(rows[1].lines.contains { $0.fromLane == 1 && $0.fromY == 0 })
    }

    func testRefListReadsKinds() {
        let refs = GitOperations.shared.refList("HEAD -> main, origin/main, tag: v1, dev")
        XCTAssertEqual(refs, [
            GitRef(name: "main", kind: .head),
            GitRef(name: "origin/main", kind: .remote),
            GitRef(name: "v1", kind: .tag),
            GitRef(name: "dev", kind: .branch),
        ])
    }

    func testSplitRowsPairRemovedWithAddedLines() {
        let lines = [
            DiffLine(type: .context, oldLineNumber: 1, newLineNumber: 1, content: "a"),
            DiffLine(type: .delete, oldLineNumber: 2, newLineNumber: nil, content: "b"),
            DiffLine(type: .delete, oldLineNumber: 3, newLineNumber: nil, content: "c"),
            DiffLine(type: .add, oldLineNumber: nil, newLineNumber: 2, content: "B"),
        ]
        let rows = SplitRow.pair(lines)
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[1].left?.content, "b")
        XCTAssertEqual(rows[1].right?.content, "B")
        XCTAssertEqual(rows[2].left?.content, "c")
        XCTAssertNil(rows[2].right)
    }
}
