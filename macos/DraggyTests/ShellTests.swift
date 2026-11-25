import XCTest
@testable import Draggy

@MainActor
final class ShellTests: XCTestCase {
    private func hex(_ color: RGB) -> String {
        String(format: "#%02x%02x%02x", Int(color.r.rounded()), Int(color.g.rounded()), Int(color.b.rounded()))
    }

    func testVermilionShadesMatchTheWindowsTokens() {
        let light = Accent.vermilion.shades(dark: false)
        XCTAssertEqual(hex(light.ink), "#ad4c00")
        XCTAssertEqual(hex(light.soft), "#f1e0d3")
        XCTAssertEqual(hex(light.hover), "#b75100")
        let dark = Accent.vermilion.shades(dark: true)
        XCTAssertEqual(hex(dark.ink), "#d96e1a")
        XCTAssertEqual(hex(dark.soft), "#432b18")
        XCTAssertEqual(hex(dark.hover), "#db7524")
    }

    func testEveryAccentInkReadsAtAAOnThePanel() {
        for accent in Accent.allCases {
            XCTAssertGreaterThanOrEqual(accent.shades(dark: false).ink.contrast(with: RGB(hex: 0xF5F5F5)), 4.5, accent.rawValue)
            XCTAssertGreaterThanOrEqual(accent.shades(dark: true).ink.contrast(with: RGB(hex: 0x1E1E1E)), 4.5, accent.rawValue)
        }
    }

    func testEveryGlyphHasItsThreeWeightsInTheCatalogue() {
        let catalogue = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Draggy/Resources/Icons.xcassets")
        for glyph in Glyph.allCases {
            for filled in [false, true] {
                for size: CGFloat in [16, 24] {
                    let name = Icon.assetName(glyph, size: size, filled: filled)
                    let path = catalogue.appendingPathComponent("\(name).imageset/\(name).svg").path
                    XCTAssertTrue(FileManager.default.fileExists(atPath: path), name)
                }
            }
        }
    }

    private func row(_ title: String, _ updated: Date, pinned: Bool = false) -> SessionRow {
        SessionRow(id: UUID(), title: title, updated: updated, pinned: pinned)
    }

    func testSessionsFallIntoTheWindowsDateBuckets() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let now = Date(timeIntervalSince1970: 1_764_000_000)
        let day: TimeInterval = 86_400
        let rows = [
            row("today", now),
            row("yesterday", now - day),
            row("week", now - 4 * day),
            row("old", now - 30 * day),
            row("pinned", now - 60 * day, pinned: true),
        ]
        let sections = SessionArrangement.sections(rows, grouping: .date, sorting: .activity, now: now, calendar: calendar)
        XCTAssertEqual(sections.map(\.id), ["pinned", "today", "yesterday", "week", "earlier"])
        XCTAssertEqual(sections.map { $0.rows.map(\.title) }, [["pinned"], ["today"], ["yesterday"], ["week"], ["old"]])
    }

    func testNoGroupingKeepsPinnedInPlaceAndCanSortByTitle() {
        let now = Date()
        let rows = [row("beta", now), row("Alpha", now - 10, pinned: true)]
        let sections = SessionArrangement.sections(rows, grouping: .none, sorting: .title)
        XCTAssertEqual(sections.count, 1)
        XCTAssertEqual(sections[0].rows.map(\.title), ["Alpha", "beta"])
        XCTAssertTrue(SessionArrangement.sections([], grouping: .date, sorting: .activity).isEmpty)
    }

    func testTheSessionIndexKeepsNamesPinsAndProjects() {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: folder) }
        let library = ConversationLibrary(folder: folder)
        let id = UUID()
        let meta = SessionMeta(title: "Renamed", pinned: true, project: "/tmp/project")
        library.index.save([id: meta])
        XCTAssertEqual(library.index.load(), [id: meta])
        // The index sits among the conversations but is never listed as one.
        library.save([SavedMessage(role: "user", text: "hi")], as: id)
        XCTAssertEqual(library.list().map(\.id), [id])
    }

    func testMarkdownExportHasTheTitleAndEachMessage() {
        let text = SessionArrangement.markdown(title: "Starter", messages: [
            SavedMessage(role: "user", text: "How long?"),
            SavedMessage(role: "assistant", text: "Two weeks."),
        ])
        XCTAssertTrue(text.hasPrefix("# Starter\n\n"))
        XCTAssertTrue(text.contains("How long?"))
        XCTAssertTrue(text.contains("**Draggy**\n\nTwo weeks."))
    }

    func testLongChipNamesLoseTheirMiddle() {
        XCTAssertEqual(ChipLabel.shortened("weather-cli"), "weather-cli")
        let long = ChipLabel.shortened("Qwen3.6-35B-A3B-Instruct-Q4_K_M-with-a-long-tail")
        XCTAssertEqual(long.count, 31)
        XCTAssertTrue(long.hasPrefix("Qwen3.6-35B-A3B"))
        XCTAssertTrue(long.contains("\u{2026}"))
    }

    func testRepliesShowSpeedUnderneathAndYourMessagesDoNot() {
        var reply = Transcript.Line(id: UUID(), role: .assistant, text: "ok")
        XCTAssertNil(MessageLayout.footer(reply))
        reply.speed = 41.25
        XCTAssertEqual(MessageLayout.footer(reply), String(format: String(localized: "%.1f tokens/s"), 41.25))
        var mine = Transcript.Line(id: UUID(), role: .user, text: "hi")
        mine.speed = 3
        XCTAssertNil(MessageLayout.footer(mine))
        XCTAssertGreaterThan(MessageLayout.measure(mine, column: 720).bubble, 0)
        XCTAssertEqual(MessageLayout.measure(reply, column: 720).bubble, 0)
    }
}
