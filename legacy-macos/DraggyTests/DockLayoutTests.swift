import XCTest
@testable import Draggy

/// The side panel rules, checked against what win/src/app/dockLayout.ts does.
final class DockLayoutTests: XCTestCase {
    func testOpeningAddsOnceAndActivates() {
        var layout = DockLayout()
        XCTAssertFalse(layout.isOpen)
        layout.open(.files)
        layout.open(.terminal)
        layout.open(.files)
        XCTAssertEqual(layout.panes, [.files, .terminal])
        XCTAssertEqual(layout.active, .files)
        XCTAssertTrue(layout.isOpen)
    }

    func testClosingTheActiveTabMovesToTheNextThenThePrevious() {
        var layout = DockLayout()
        [DockPane.files, .diff, .terminal].forEach { layout.open($0) }
        layout.open(.diff)
        layout.close(.diff)
        XCTAssertEqual(layout.active, .terminal)
        layout.close(.terminal)
        XCTAssertEqual(layout.active, .files)
        layout.close(.files)
        XCTAssertNil(layout.active)
        XCTAssertFalse(layout.isOpen)
    }

    func testSplitShowsAnotherTabAndClearsWhenItBecomesActive() {
        var layout = DockLayout()
        layout.open(.files)
        layout.open(.diff)
        layout.toggleSplit()
        XCTAssertEqual(layout.split, .files)
        layout.open(.files)
        XCTAssertNil(layout.split)
        layout.open(.terminal, split: true)
        XCTAssertEqual(layout.active, .files)
        XCTAssertEqual(layout.split, .terminal)
        layout.close(.terminal)
        XCTAssertNil(layout.split)
    }

    func testWidthStaysInsideTheWindowsLimits() {
        var layout = DockLayout()
        layout.setWidth(100)
        XCTAssertEqual(layout.width, 260)
        layout.setWidth(5000)
        XCTAssertEqual(layout.width, 1200)
        layout.setWidth(612.4)
        XCTAssertEqual(layout.width, 612)
    }

    func testMaximizeBelongsToEachTabAndSurvivesSaving() throws {
        var layout = DockLayout()
        layout.open(.browser)
        layout.toggleMaximized(.browser)
        XCTAssertTrue(layout.isMaximized)
        layout.open(.plan)
        XCTAssertFalse(layout.isMaximized)
        layout.move(from: 1, to: 0)
        XCTAssertEqual(layout.panes, [.plan, .browser])
        let copy = try JSONDecoder().decode(DockLayout.self, from: JSONEncoder().encode(layout))
        XCTAssertEqual(copy, layout)
        layout.close(.browser)
        XCTAssertTrue(layout.maximized.isEmpty)
    }
}
