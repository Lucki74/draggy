import DraggyCore
import Foundation
import Observation

/// The MCP server list screen's state: the catalogue narrowed by a search term.
@MainActor
@Observable
final class McpModel {
    private let catalogue: (String) -> [McpServerRecord]
    /// Runs the servers. `nil` when it could not start, and the page then only browses.
    let manager: McpManager?

    var query = "" {
        didSet { refresh() }
    }
    private(set) var servers: [McpServerRecord] = []
    private(set) var running: Set<String> = []
    private(set) var busy: Set<String> = []
    private(set) var lastError: String?

    init(
        catalogue: @escaping (String) -> [McpServerRecord] = { mcpCatalogue(query: $0) },
        manager: McpManager? = nil
    ) {
        self.catalogue = catalogue
        self.manager = manager
        refresh()
    }

    /// Reads which servers are running now.
    func reload() async {
        guard let manager else { return }
        let states = await manager.list()
        running = Set(states.filter { $0.status == "running" }.map(\.id))
    }

    /// Starts the server when it is off and stops it when it is on.
    func toggle(_ id: String) async {
        guard let manager, !busy.contains(id) else { return }
        busy.insert(id)
        defer { busy.remove(id) }
        lastError = nil
        if running.contains(id) {
            _ = await manager.stop(id: id)
        } else {
            let state = await manager.start(id: id, config: nil)
            if state.status != "running" {
                lastError = "\(id) did not start: \(state.error ?? state.status)"
            }
        }
        await reload()
    }

    private func refresh() {
        servers = catalogue(query.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}
