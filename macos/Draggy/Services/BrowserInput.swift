import Foundation
import OSLog
import WebKit

@MainActor
public final class BrowserInput {
    public static let shared = BrowserInput()

    public init() {}

    public func evaluateJavascript(view: WKWebView, script: String) async -> Any? {
        do {
            return try await view.evaluateJavaScript(script)
        } catch {
            Logger.browser.error("JavaScript evaluation failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }
}
