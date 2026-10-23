import DraggyCore
import XCTest
@testable import Draggy

@MainActor
final class McpModelTests: XCTestCase {
    private func server(_ id: String) -> McpServerRecord {
        McpServerRecord(id: id, name: id, description: "", caution: nil, remote: false, docs: "", inputs: [])
    }

    func testListsTheCatalogueAtStart() {
        let model = McpModel { _ in [self.server("a"), self.server("b")] }
        XCTAssertEqual(model.servers.map(\.id), ["a", "b"])
    }

    private func input(_ key: String, required: Bool = false, secret: Bool = false, isEnv: Bool = true) -> McpInputRecord {
        McpInputRecord(key: key, label: "\(key) label", required: required, secret: secret, isEnv: isEnv)
    }

    func testConfigSplitsEnvAndArguments() {
        let inputs = [input("TOKEN"), input("root", isEnv: false)]
        let config = McpModel.config(inputs, ["TOKEN": " t ", "root": "/srv"])
        XCTAssertEqual(config?.env, ["TOKEN": "t"])
        XCTAssertEqual(config?.arguments, ["root": "/srv"])
    }

    func testBlankValuesGiveNoConfig() {
        XCTAssertNil(McpModel.config([input("TOKEN")], ["TOKEN": "  "]))
        XCTAssertNil(McpModel.config([input("TOKEN")], [:]))
    }

    func testNamesTheFirstMissingRequiredInput() {
        let inputs = [input("A"), input("B", required: true)]
        XCTAssertEqual(McpModel.missingRequired(inputs, ["A": "x"]), "B label")
        XCTAssertNil(McpModel.missingRequired(inputs, ["B": "y"]))
    }

    func testSavesPlainValuesAndSecretsApart() throws {
        let suite = "mcp-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let secrets = MemorySecrets()
        let model = McpModel(manager: nil, secrets: secrets, defaults: defaults)
        let inputs = [input("PATH_X"), input("TOKEN", secret: true)]
        try model.save(["PATH_X": "/a", "TOKEN": "s3"], server: "git", inputs: inputs)
        XCTAssertEqual(try secrets.secret(for: McpModel.secretName("git", "TOKEN")), "s3")
        XCTAssertNil(defaults.dictionary(forKey: McpModel.defaultsKey("git"))?["TOKEN"])
        XCTAssertEqual(model.savedValues(server: "git", inputs: inputs), ["PATH_X": "/a", "TOKEN": "s3"])
        try model.save(["PATH_X": "/a", "TOKEN": ""], server: "git", inputs: inputs)
        XCTAssertNil(try secrets.secret(for: McpModel.secretName("git", "TOKEN")))
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

private final class MemorySecrets: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: String] = [:]

    func secret(for account: String) throws -> String? {
        lock.withLock { values[account] }
    }

    func setSecret(_ value: String?, for account: String) throws {
        lock.withLock { values[account] = (value?.isEmpty ?? true) ? nil : value }
    }
}
