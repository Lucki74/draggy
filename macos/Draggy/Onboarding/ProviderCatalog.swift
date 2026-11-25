import Foundation
import OSLog

/// One provider from the catalog both apps share, core/crates/providers/src/bundled_catalog.json.
struct ProviderEntry: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let kind: String
    let `protocol`: String?
    let baseUrl: String?
    let keyUrl: String?
    let auth: String?
    let defaultModels: [String]?
    let keyOptional: Bool?

    var isLocal: Bool { kind == "local" }
    var needsKey: Bool { !isLocal && keyOptional != true }

    /// The address the macOS core sends to. Ollama answers OpenAI requests under /v1.
    var chatURL: String? {
        guard let baseUrl else { return nil }
        return `protocol` == "ollama" ? baseUrl + "/v1" : baseUrl
    }
}

/// The catalog as macOS can use it: providers that speak the OpenAI protocol with a bearer key, or
/// local servers. Accounts, Anthropic and Gemini need protocols only the Windows gateway speaks.
enum ProviderCatalog {
    static let all: [ProviderEntry] = {
        guard let url = Bundle.main.url(forResource: "bundled_catalog", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let entries = try? JSONDecoder().decode([ProviderEntry].self, from: data)
        else {
            Logger.app.error("provider catalogue missing from the bundle")
            return []
        }
        return entries
    }()

    static func usable(_ entries: [ProviderEntry] = all) -> [ProviderEntry] {
        entries.filter { entry in
            switch entry.kind {
            case "local": entry.protocol == "openai" || entry.protocol == "ollama"
            case "cloud": entry.protocol == "openai" && entry.auth == "bearer"
            default: false
            }
        }
    }

    static var cloud: [ProviderEntry] { usable().filter { !$0.isLocal } }
    static var local: [ProviderEntry] { usable().filter(\.isLocal) }
}

/// Network checks the setup makes. Each reaches one fixed address and sends nothing of the user's.
enum SetupProbe {
    /// The Windows probe of core/crates/web/src/connectivity.rs: HEAD, three seconds, no redirects.
    static func huggingFaceReachable() async -> Bool {
        guard let url = URL(string: "https://huggingface.co/api/models?limit=1") else { return false }
        var request = URLRequest(url: url, timeoutInterval: 3)
        request.httpMethod = "HEAD"
        let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        guard let (_, response) = try? await session.data(for: request),
              let status = (response as? HTTPURLResponse)?.statusCode
        else { return false }
        return (200..<400).contains(status)
    }

    /// The model names a local server lists, or nil when nothing answers on its port.
    static func localModels(_ entry: ProviderEntry) async -> [String]? {
        guard let base = entry.chatURL, let url = URL(string: base + "/models"),
              ["127.0.0.1", "localhost"].contains(url.host ?? "")
        else { return nil }
        let request = URLRequest(url: url, timeoutInterval: 1)
        let session = URLSession(configuration: .ephemeral)
        defer { session.finishTasksAndInvalidate() }
        guard let (data, response) = try? await session.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200
        else { return nil }
        return modelIDs(in: data)
    }

    /// Reads `{"data": [{"id": ...}]}`, the OpenAI model list every local server here answers with.
    static func modelIDs(in data: Data) -> [String] {
        struct List: Decodable {
            struct Model: Decodable { let id: String }
            let data: [Model]
        }
        return (try? JSONDecoder().decode(List.self, from: data))?.data.map(\.id) ?? []
    }

    /// Every local server in the catalog that answers, scanned together. Several share a port.
    static func scanLocal() async -> [(ProviderEntry, [String])] {
        await withTaskGroup(of: (Int, ProviderEntry, [String])?.self) { group in
            for (index, entry) in ProviderCatalog.local.enumerated() {
                group.addTask {
                    guard let models = await localModels(entry) else { return nil }
                    return (index, entry, models)
                }
            }
            var found: [(Int, ProviderEntry, [String])] = []
            for await result in group {
                if let result { found.append(result) }
            }
            // Two entries on one port are one server: keep the first the catalog names.
            var seen = Set<String>()
            return found.sorted { $0.0 < $1.0 }.compactMap { _, entry, models in
                guard let url = entry.chatURL, seen.insert(url).inserted else { return nil }
                return (entry, models)
            }
        }
    }

    private final class NoRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest) async -> URLRequest? {
            nil
        }
    }
}
