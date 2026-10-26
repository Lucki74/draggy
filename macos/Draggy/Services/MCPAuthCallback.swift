import Foundation

public final class MCPAuthCallback: Sendable {
    public static let shared = MCPAuthCallback()

    public init() {}

    public func extractCode(from url: URL) -> String? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        return components.queryItems?.first(where: { $0.name == "code" })?.value
    }
}
