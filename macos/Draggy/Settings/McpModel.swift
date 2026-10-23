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
    private let secrets: any SecretStore
    private let defaults: UserDefaults

    var query = "" {
        didSet { refresh() }
    }
    private(set) var servers: [McpServerRecord] = []
    private(set) var running: Set<String> = []
    private(set) var busy: Set<String> = []
    private(set) var lastError: String?

    init(
        catalogue: @escaping (String) -> [McpServerRecord] = { mcpCatalogue(query: $0) },
        manager: McpManager? = nil,
        secrets: any SecretStore = KeychainSecretStore(),
        defaults: UserDefaults = .standard
    ) {
        self.catalogue = catalogue
        self.manager = manager
        self.secrets = secrets
        self.defaults = defaults
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
            let inputs = servers.first { $0.id == id }?.inputs ?? []
            let values = savedValues(server: id, inputs: inputs)
            if let label = Self.missingRequired(inputs, values) {
                lastError = String(localized: "\(id) needs \(label). Open its settings first.")
                return
            }
            let state = await manager.start(id: id, config: Self.config(inputs, values))
            if state.status != "running" {
                lastError = "\(id) did not start: \(state.error ?? state.status)"
            }
        }
        await reload()
    }

    /// What was saved for a server: plain values from the defaults, secrets from the Keychain.
    func savedValues(server: String, inputs: [McpInputRecord]) -> [String: String] {
        var values = defaults.dictionary(forKey: Self.defaultsKey(server)) as? [String: String] ?? [:]
        for input in inputs where input.secret {
            if let value = (try? secrets.secret(for: Self.secretName(server, input.key))) ?? nil {
                values[input.key] = value
            }
        }
        return values
    }

    /// Saves the values of a server. An empty secret is removed from the Keychain.
    func save(_ values: [String: String], server: String, inputs: [McpInputRecord]) throws {
        var plain: [String: String] = [:]
        for input in inputs {
            let value = (values[input.key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if input.secret {
                try secrets.setSecret(value.isEmpty ? nil : value, for: Self.secretName(server, input.key))
            } else if !value.isEmpty {
                plain[input.key] = value
            }
        }
        if plain.isEmpty {
            defaults.removeObject(forKey: Self.defaultsKey(server))
        } else {
            defaults.set(plain, forKey: Self.defaultsKey(server))
        }
    }

    nonisolated static func secretName(_ server: String, _ key: String) -> String {
        "mcp:\(server):\(key)"
    }

    nonisolated static func defaultsKey(_ server: String) -> String {
        "mcp.values.\(server)"
    }

    /// The label of the first required input with no value.
    nonisolated static func missingRequired(_ inputs: [McpInputRecord], _ values: [String: String]) -> String? {
        inputs.first { $0.required && isBlank(values[$0.key]) }?.label
    }

    /// The settings to start a server with, or `nil` when nothing was filled in so the defaults apply.
    nonisolated static func config(_ inputs: [McpInputRecord], _ values: [String: String]) -> McpServerConfigRecord? {
        var env: [String: String] = [:]
        var arguments: [String: String] = [:]
        for input in inputs {
            guard let value = values[input.key], !isBlank(value) else { continue }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if input.isEnv { env[input.key] = trimmed } else { arguments[input.key] = trimmed }
        }
        if env.isEmpty && arguments.isEmpty { return nil }
        return McpServerConfigRecord(url: nil, name: nil, package: nil, args: nil, env: env, arguments: arguments)
    }

    private nonisolated static func isBlank(_ value: String?) -> Bool {
        (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func refresh() {
        servers = catalogue(query.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}
