import Foundation

public final class BrowserTrace: Sendable {
    public static let shared = BrowserTrace()

    public init() {}

    public func logNavigation(url: String) {
        // Trace navigation event without logging sensitive query params
    }
}
