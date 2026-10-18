import DraggyCore
import XCTest
@testable import Draggy

@MainActor
final class McpModelTests: XCTestCase {
    private func server(_ id: String) -> McpServerRecord {
        McpServerRecord(id: id, name: id, description: "", caution: nil, remote: false, docs: "")
    }

    func testListsTheCatalogueAtStart() {
        let model = McpModel { _ in [self.server("a"), self.server("b")] }
        XCTAssertEqual(model.servers.map(\.id), ["a", "b"])
    }

    func testSearchesWithTheTrimmedQuery() {
        var seen: [String] = []
        let model = McpModel { query in
            seen.append(query)
            return []
        }
        model.query = "  git "
        XCTAssertEqual(seen.last, "git")
    }
}
