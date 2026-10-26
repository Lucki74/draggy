import Foundation

public final class BrowserSafety: Sendable {
    public static let shared = BrowserSafety()

    public init() {}

    public func isSafeUrl(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }
}
