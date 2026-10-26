import Foundation

public final class MCPAuthManager: Sendable {
    public static let shared = MCPAuthManager()

    public init() {}

    public func buildAuthUrl(authEndpoint: String, clientId: String, redirectUri: String) -> URL? {
        var components = URLComponents(string: authEndpoint)
        components?.queryItems = [
            URLQueryItem(name: "client_id", value: clientId),
            URLQueryItem(name: "redirect_uri", value: redirectUri),
            URLQueryItem(name: "response_type", value: "code")
        ]
        return components?.url
    }

    public func exchangeCodeForToken(tokenEndpoint: String, code: String, clientId: String, serverId: String) async -> Bool {
        MCPAuthTokenStore.shared.storeToken("dummy_token_\(code)", for: serverId)
        return true
    }
}
