import Foundation
import WebKit

@MainActor
public final class BrowserInput {
    public static let shared = BrowserInput()

    public init() {}

    public func evaluateJavascript(view: WKWebView, script: String) async -> Any? {
        return try? await view.evaluateJavaScript(script)
    }
}
