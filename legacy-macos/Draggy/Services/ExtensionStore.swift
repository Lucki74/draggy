import Foundation

public struct RemoteServerConfig: Identifiable, Codable, Sendable {
    public let id: String
    public var name: String
    public var url: String
    public var apiKey: String?
    public var isConnected: Bool

    public init(id: String = UUID().uuidString, name: String, url: String, apiKey: String? = nil, isConnected: Bool = false) {
        self.id = id
        self.name = name
        self.url = url
        self.apiKey = apiKey
        self.isConnected = isConnected
    }
}

@MainActor
@Observable
public final class ExtensionStore {
    public var enabledSkills: Set<String> = []
    public var remoteServers: [RemoteServerConfig] = []

    public init() {}

    public func toggleSkill(_ skillId: String) {
        if enabledSkills.contains(skillId) {
            enabledSkills.remove(skillId)
        } else {
            enabledSkills.insert(skillId)
        }
    }

    public func addServer(name: String, url: String, apiKey: String? = nil) {
        let server = RemoteServerConfig(name: name, url: url, apiKey: apiKey)
        remoteServers.append(server)
    }

    public func removeServer(id: String) {
        remoteServers.removeAll { $0.id == id }
    }
}
