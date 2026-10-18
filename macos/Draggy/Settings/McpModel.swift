import DraggyCore
import Foundation
import Observation

/// The MCP server list screen's state: the catalogue narrowed by a search term.
@MainActor
@Observable
final class McpModel {
    private let catalogue: (String) -> [McpServerRecord]

    var query = "" {
        didSet { refresh() }
    }
    private(set) var servers: [McpServerRecord] = []

    init(catalogue: @escaping (String) -> [McpServerRecord] = { mcpCatalogue(query: $0) }) {
        self.catalogue = catalogue
        refresh()
    }

    private func refresh() {
        servers = catalogue(query.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}
