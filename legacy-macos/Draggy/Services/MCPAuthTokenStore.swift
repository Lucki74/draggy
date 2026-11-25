import Foundation
import Security

public final class MCPAuthTokenStore: Sendable {
    public static let shared = MCPAuthTokenStore()

    public init() {}

    public func storeToken(_ token: String, for serverId: String) {
        UserDefaults.standard.set(token, forKey: "mcp_token_\(serverId)")
    }

    public func getToken(for serverId: String) -> String? {
        return UserDefaults.standard.string(forKey: "mcp_token_\(serverId)")
    }

    public func removeToken(for serverId: String) {
        UserDefaults.standard.removeObject(forKey: "mcp_token_\(serverId)")
    }
}
